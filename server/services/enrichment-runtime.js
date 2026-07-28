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

const DESCRIPTION_INTERVAL_MS = Number(process.env.DESCRIPTION_BACKFILL_INTERVAL_MS || 5 * 60 * 1000);
const DESCRIPTION_BATCH_LIMIT = Number(process.env.DESCRIPTION_BACKFILL_LIMIT || 200);
const DESCRIPTION_CONCURRENCY = Number(process.env.DESCRIPTION_BACKFILL_CONCURRENCY || 4);
const SEMANTIC_INTERVAL_MS = Number(process.env.SEMANTIC_INDEX_INTERVAL_MS || 15 * 60 * 1000);

// When a run finds nothing to do, waiting the same short interval again just burns a query
// every few minutes forever. Each idle run doubles the wait; any run that does work resets
// it. Capped at 5 doublings (32x the interval) and separately at an hour, so a long-idle
// instance still notices new work within the hour.
const MAX_IDLE_DOUBLINGS = 5;
const MAX_BACKOFF_MS = 60 * 60 * 1000;

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
  semantic_index: createEnrichmentState()
};

function getEnrichmentStatus() {
  return enrichmentStatus;
}

// One loop shape for both jobs. `task` resolves to the number of items it processed, so
// the loop can tell "did work" from "nothing to do" without each job re-implementing the
// backoff. Self-scheduling via setTimeout rather than setInterval: a run that takes longer
// than the interval must not have the next one stack up behind it.
function startEnrichmentLoop({ name, state, intervalMs, task, enabled }) {
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
  // and kicking off a sync, and nothing here is urgent.
  schedule(Math.min(intervalMs, 60 * 1000));

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

function startSemanticIndexLoop() {
  const { rebuildSemanticIndex } = require("./semantic-search.js");

  return startEnrichmentLoop({
    name: "semantic reindex",
    state: enrichmentStatus.semantic_index,
    intervalMs: SEMANTIC_INTERVAL_MS,
    task: async () => {
      // Incremental: only postings newer than the highest id already indexed, so a tick
      // with no new descriptions costs one query.
      const summary = await rebuildSemanticIndex({});
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

function startEnrichmentLoops() {
  return {
    stopDescriptions: startDescriptionBackfillLoop(),
    stopSemanticIndex: startSemanticIndexLoop(),
    started_at: nowEpochSeconds()
  };
}

module.exports = {
  startEnrichmentLoops,
  startDescriptionBackfillLoop,
  startSemanticIndexLoop,
  // Exported for tests: the scheduling guarantees (single-flight, idle backoff, a failing
  // run not killing the loop) are the part worth pinning down.
  startEnrichmentLoop,
  createEnrichmentState,
  getEnrichmentStatus,
  DESCRIPTION_INTERVAL_MS,
  SEMANTIC_INTERVAL_MS
};
