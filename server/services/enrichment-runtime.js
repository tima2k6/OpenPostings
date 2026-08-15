// Background enrichment: fetching posting pages, and keeping the semantic index current.
//
// Both of these used to be tied to a completed sync pass -- the description backfill fired
// from the end of runAtsSyncInternal, and the index was only ever rebuilt by hand. On a
// small database that is fine. On a real one it means neither ever happens: a pass over
// 61,612 companies runs for hours, so the hook at the end of it had fired 12 times in two
// days, and everything that depends on fetching a posting's own page -- liveness,
// hiring-location restrictions, pay stated only in prose, whether an account is required --
// sat at zero. The semantic index had likewise gone stale at 5,168 documents while 47,000
// postings had descriptions, so similar_to was searching a ninth of what it could.
//
// So enrichment runs on its own clock here, independent of whatever the sync is doing.
// Each loop is single-flight, backs off when there is nothing to do, and never throws into
// the timer.
const { nowEpochSeconds } = require("../helpers/normalize-numbers.js");
const { getSyncDownloadJobDescriptions } = require("./runtime-context.js");
const path = require("node:path");
const { execFile } = require("node:child_process");

const DESCRIPTION_INTERVAL_MS = Number(process.env.DESCRIPTION_BACKFILL_INTERVAL_MS || 5 * 60 * 1000);
const DESCRIPTION_BATCH_LIMIT = Number(process.env.DESCRIPTION_BACKFILL_LIMIT || 200);
const DESCRIPTION_CONCURRENCY = Number(process.env.DESCRIPTION_BACKFILL_CONCURRENCY || 4);
const SEMANTIC_INTERVAL_MS = Number(process.env.SEMANTIC_INDEX_INTERVAL_MS || 15 * 60 * 1000);
const SEMANTIC_WORKER_BATCH_SIZE = Number(process.env.SEMANTIC_INDEX_WORKER_BATCH_SIZE || 25);
const SEMANTIC_WORKER_MAX_BATCHES = Number(process.env.SEMANTIC_INDEX_WORKER_MAX_BATCHES || 16);
const SEMANTIC_WORKER_TIMEOUT_MS = Number(process.env.SEMANTIC_INDEX_WORKER_TIMEOUT_MS || 10 * 60 * 1000);
const SEMANTIC_WORKER_SCRIPT = path.resolve(__dirname, "..", "scripts", "build-semantic-index.js");

const MATCH_INTERVAL_MS = Number(process.env.MATCH_INDEX_INTERVAL_MS || 15 * 60 * 1000);
const MATCH_WORKER_BATCH_SIZE = Number(process.env.MATCH_INDEX_WORKER_BATCH_SIZE || 25);
const MATCH_WORKER_MAX_BATCHES = Number(process.env.MATCH_INDEX_WORKER_MAX_BATCHES || 16);
const MATCH_WORKER_TIMEOUT_MS = Number(process.env.MATCH_INDEX_WORKER_TIMEOUT_MS || 10 * 60 * 1000);
const MATCH_WORKER_SCRIPT = path.resolve(__dirname, "..", "scripts", "build-match-index.js");

// When a run finds nothing to do, waiting the same short interval again just burns a query
// every few minutes forever. Each idle run doubles the wait; any run that does work resets
// it. Capped at 5 doublings (32x the interval) and separately at an hour, so a long-idle
// instance still notices new work within the hour.
const MAX_IDLE_DOUBLINGS = 5;
const MAX_BACKOFF_MS = 60 * 60 * 1000;

// The startup stagger (see initialDelayMs below) only keeps the semantic reindex and match
// index children apart for their first run. Each one's later schedule shifts on its own --
// idle backoff doubles the wait whenever a run finds nothing to do, and resets the moment
// one does -- so the two drift independently and can land on top of each other again hours
// into a run. That happened on this box at 16:05:54Z: both children started within 719ms of
// each other, and the ATS request queue logged a burst of 12s timeouts at the same instant.
// Both children are already isolated from the API's event loop (see the comments on
// runSemanticIndexWorker/runMatchIndexWorker), but that isolation is logical, not physical:
// on a 2-CPU host, two simultaneous CPU-bound children leave the main process fighting them
// for scheduler time, and HTTP handling -- including /sync/status on its own DB connection
// -- goes slow right along with the ATS fetches. Chaining both through the same promise
// queue guarantees at most one of them is ever running, no matter how their independent
// backoff timers drift.
let heavyEnrichmentWorkerChain = Promise.resolve();
function runHeavyEnrichmentWorker(startWorker) {
  const run = heavyEnrichmentWorkerChain.then(startWorker, startWorker);
  heavyEnrichmentWorkerChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

function createEnrichmentState() {
  return {
    running: false,
    last_run_at: null,
    last_summary: null,
    last_error: null,
    runs: 0,
    idle_streak: 0
  };
}

const enrichmentStatus = {
  descriptions: createEnrichmentState(),
  semantic_index: createEnrichmentState(),
  match_index: createEnrichmentState()
};

function getEnrichmentStatus() {
  return enrichmentStatus;
}

// One loop shape for both jobs. `task` resolves to the number of items it processed, so
// the loop can tell "did work" from "nothing to do" without each job re-implementing the
// backoff. Self-scheduling via setTimeout rather than setInterval: a run that takes longer
// than the interval must not have the next one stack up behind it.
function startEnrichmentLoop({ name, state, intervalMs, task, enabled, initialDelayMs }) {
  let stopped = false;

  const schedule = (delayMs) => {
    if (stopped) return null;
    const timer = setTimeout(run, delayMs);
    // Never hold the process open for a background refresh.
    if (typeof timer.unref === "function") timer.unref();
    return timer;
  };

  const run = async () => {
    if (stopped) return;
    if (state.running) {
      schedule(intervalMs);
      return;
    }

    if (typeof enabled === "function" && !enabled()) {
      schedule(intervalMs);
      return;
    }

    state.running = true;
    let processed = 0;
    try {
      processed = Number(await task()) || 0;
      state.last_error = null;
    } catch (error) {
      // A failing enrichment run must never take the server down or stop the loop; the
      // next tick tries again.
      state.last_error = String(error?.message || error);
      console.error(`[OpenPostings API] ${name} failed:`, error);
    } finally {
      state.running = false;
      state.runs += 1;
      state.last_run_at = new Date().toISOString();
    }

    state.idle_streak = processed > 0 ? 0 : Math.min(state.idle_streak + 1, MAX_IDLE_DOUBLINGS);
    const backoff = intervalMs * 2 ** state.idle_streak;
    schedule(Math.min(backoff, MAX_BACKOFF_MS));
  };

  // Stagger the first run: startup is already busy opening the database, loading settings
  // and kicking off a sync, and nothing here is urgent. Each loop's own default lands at
  // the same ~60s mark, though -- callers running genuinely heavy work alongside others
  // (see startSemanticIndexLoop/startMatchIndexLoop) pass an explicit initialDelayMs so
  // their first runs don't all land in the same few seconds after boot, competing with the
  // sync's own startup burst for CPU. This is what caused a real, observed /sync/status
  // timeout: a fresh restart's first minute had the sync ramping up, the semantic reindex,
  // and a freshly-enlarged match-index batch (10,000 rows) all firing at once.
  schedule(initialDelayMs ?? Math.min(intervalMs, 60 * 1000));

  return () => {
    stopped = true;
  };
}

function startDescriptionBackfillLoop() {
  const { runDescriptionBackfill } = require("./posting-page-fetcher.js");

  return startEnrichmentLoop({
    name: "description backfill",
    state: enrichmentStatus.descriptions,
    intervalMs: DESCRIPTION_INTERVAL_MS,
    // Respects the same setting the sync uses for pulling descriptions at all.
    enabled: () => getSyncDownloadJobDescriptions(),
    task: async () => {
      const summary = await runDescriptionBackfill({
        limit: DESCRIPTION_BATCH_LIMIT,
        concurrency: DESCRIPTION_CONCURRENCY
      });
      enrichmentStatus.descriptions.last_summary = summary;
      if (summary.scanned > 0) {
        console.log(
          `[OpenPostings API] description backfill: ${summary.updated} updated, ${summary.dead} dead, ` +
            `${summary.pay_parsed} pay parsed, ${summary.conflicts} location conflicts, ${summary.failed} failed ` +
            `of ${summary.scanned}`
        );
      }
      return summary.scanned;
    }
  });
}

// FTS5 tokenization is native, synchronous work. Even a little over a hundred documents
// was enough to stop the API event loop from returning a single byte for ten seconds.
// Running it in a child keeps HTTP handling responsive; small transactions and a hard
// batch ceiling also keep its SQLite writer lock bounded.
function runSemanticIndexWorker({
  rebuild = false,
  batchSize = SEMANTIC_WORKER_BATCH_SIZE,
  maxBatches = SEMANTIC_WORKER_MAX_BATCHES
} = {}) {
  const args = [
    SEMANTIC_WORKER_SCRIPT,
    "--batch-size",
    String(Math.max(1, Math.floor(Number(batchSize) || SEMANTIC_WORKER_BATCH_SIZE))),
    "--max-batches",
    String(Math.max(1, Math.floor(Number(maxBatches) || SEMANTIC_WORKER_MAX_BATCHES)))
  ];
  if (rebuild) args.push("--rebuild");

  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      args,
      {
        env: process.env,
        timeout: SEMANTIC_WORKER_TIMEOUT_MS,
        maxBuffer: 1024 * 1024,
        windowsHide: true
      },
      (error, stdout, stderr) => {
        if (error) {
          const detail = String(stderr || stdout || error.message).trim();
          reject(new Error(`Semantic index worker failed: ${detail}`));
          return;
        }

        const line = String(stdout)
          .split(/\r?\n/)
          .find((candidate) => candidate.startsWith("[build-semantic-index] "));
        const match = line?.match(/^\[build-semantic-index\] (\{.*\}) in \d+s$/);
        if (!match) {
          reject(new Error(`Semantic index worker returned unexpected output: ${String(stdout).trim()}`));
          return;
        }

        try {
          resolve(JSON.parse(match[1]));
        } catch (parseError) {
          reject(new Error(`Semantic index worker returned invalid JSON: ${parseError.message}`));
        }
      }
    );
  });
}

function startSemanticIndexLoop() {
  return startEnrichmentLoop({
    name: "semantic reindex",
    state: enrichmentStatus.semantic_index,
    intervalMs: SEMANTIC_INTERVAL_MS,
    // Second in the startup stagger -- see the comment in startEnrichmentLoop.
    initialDelayMs: 100 * 1000,
    task: async () => {
      // Incremental: only postings newer than the highest id already indexed. The worker
      // is isolated from the API event loop and bounded even if a large backlog forms.
      // Serialized against the match index worker -- see runHeavyEnrichmentWorker.
      const summary = await runHeavyEnrichmentWorker(() => runSemanticIndexWorker({}));
      enrichmentStatus.semantic_index.last_summary = summary;
      if (summary.indexed > 0) {
        console.log(
          `[OpenPostings API] semantic reindex: +${summary.indexed} documents (${summary.total_indexed} total)`
        );
      }
      return summary.indexed;
    }
  });
}

// Same reasoning as runSemanticIndexWorker: buildCoverLetterBrief's section extraction and
// tokenization is synchronous, regex-heavy work over full description text, and running it
// over a batch inline would block the API event loop the same way FTS5 indexing did.
function runMatchIndexWorker({
  rebuild = false,
  batchSize = MATCH_WORKER_BATCH_SIZE,
  maxBatches = MATCH_WORKER_MAX_BATCHES
} = {}) {
  const args = [
    MATCH_WORKER_SCRIPT,
    "--batch-size",
    String(Math.max(1, Math.floor(Number(batchSize) || MATCH_WORKER_BATCH_SIZE))),
    "--max-batches",
    String(Math.max(1, Math.floor(Number(maxBatches) || MATCH_WORKER_MAX_BATCHES)))
  ];
  if (rebuild) args.push("--rebuild");

  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      args,
      {
        env: process.env,
        timeout: MATCH_WORKER_TIMEOUT_MS,
        maxBuffer: 1024 * 1024,
        windowsHide: true
      },
      (error, stdout, stderr) => {
        if (error) {
          const detail = String(stderr || stdout || error.message).trim();
          reject(new Error(`Match index worker failed: ${detail}`));
          return;
        }

        const line = String(stdout)
          .split(/\r?\n/)
          .find((candidate) => candidate.startsWith("[build-match-index] "));
        const match = line?.match(/^\[build-match-index\] (\{.*\}) in \d+s$/);
        if (!match) {
          reject(new Error(`Match index worker returned unexpected output: ${String(stdout).trim()}`));
          return;
        }

        try {
          resolve(JSON.parse(match[1]));
        } catch (parseError) {
          reject(new Error(`Match index worker returned invalid JSON: ${parseError.message}`));
        }
      }
    );
  });
}

function startMatchIndexLoop() {
  return startEnrichmentLoop({
    name: "match index",
    state: enrichmentStatus.match_index,
    intervalMs: MATCH_INTERVAL_MS,
    // Third and last in the startup stagger -- see the comment in startEnrichmentLoop. This
    // one matters most: its batch is 10,000 rows (vs. 400 for semantic reindex), so it is
    // the heaviest of the three first-boot jobs.
    initialDelayMs: 150 * 1000,
    task: async () => {
      // Incremental, and self-invalidating on a resume re-upload -- see posting-match.js.
      // Serialized against the semantic index worker -- see runHeavyEnrichmentWorker.
      const summary = await runHeavyEnrichmentWorker(() => runMatchIndexWorker({}));
      enrichmentStatus.match_index.last_summary = summary;
      if (summary.scored > 0) {
        console.log(
          `[OpenPostings API] match index: +${summary.scored} postings scored${summary.rebuilt ? " (resume changed, rebuilt)" : ""}`
        );
      }
      return summary.scored;
    }
  });
}

function startEnrichmentLoops() {
  return {
    stopDescriptions: startDescriptionBackfillLoop(),
    stopSemanticIndex: startSemanticIndexLoop(),
    stopMatchIndex: startMatchIndexLoop(),
    started_at: nowEpochSeconds()
  };
}

module.exports = {
  startEnrichmentLoops,
  startDescriptionBackfillLoop,
  startSemanticIndexLoop,
  startMatchIndexLoop,
  // Exported for tests: the scheduling guarantees (single-flight, idle backoff, a failing
  // run not killing the loop) are the part worth pinning down.
  startEnrichmentLoop,
  runSemanticIndexWorker,
  runMatchIndexWorker,
  createEnrichmentState,
  getEnrichmentStatus,
  DESCRIPTION_INTERVAL_MS,
  SEMANTIC_INTERVAL_MS,
  SEMANTIC_WORKER_BATCH_SIZE,
  SEMANTIC_WORKER_MAX_BATCHES,
  MATCH_INTERVAL_MS,
  MATCH_WORKER_BATCH_SIZE,
  MATCH_WORKER_MAX_BATCHES
};
