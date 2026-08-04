// request-cancellation.test.js pins the request-level deadline in queue.js: a single hung
// fetch releases its ATS slot on its own, with no caller ever aborting. sync-runtime.js adds
// a second, independent deadline one level up -- SYNC_TARGET_TIMEOUT_MS wraps the *entire*
// per-company collection in raceWithAbortSignal, so a hang anywhere inside collection (not
// just inside a fetch queue.js already guards) still frees the worker. This is what actually
// protects a real pass: nothing else cancels a stuck company within minutes, so if this timer
// were ever silently dropped, a single uncooperative target would occupy a worker for the
// life of the pass exactly like the incident this whole deadline mechanism was built for.
//
// Proving it means driving a real runAtsSync() pass against a collector that hangs forever
// and never observes any signal, with SYNC_TARGET_TIMEOUT_MS turned down so the test does not
// wait out the real 10-minute default, and confirming no caller-side abort is involved.
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Module = require("module");

const { openDatabase } = require("../db/open-database.js");
const { setDb, getDb, setSyncEnabledAts } = require("../services/runtime-context.js");

const SYNC_RUNTIME_PATH = require.resolve("../services/sync-runtime.js");
const GREENHOUSE_SERVICE_PATH = require.resolve("../ats/greenhouse/service.js");

// A safety net for the assertions below, not part of the mechanism under test: if the
// self-firing deadline regresses back to an unbounded await, this fails fast with a clear
// message instead of hanging the test process forever.
function withTestDeadline(promise, ms, message) {
  let timer;
  const guard = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, guard]).finally(() => clearTimeout(timer));
}

// Loads sync-runtime.js fresh with a short SYNC_TARGET_TIMEOUT_MS and its Workday-equivalent
// collector (greenhouse, here) replaced by a promise that never settles and never looks at
// any AbortSignal -- reproducing the "response body ignored cancellation" failure mode
// without a real network call.
function loadSyncRuntimeWithHangingCollector(targetTimeoutMs) {
  const previousEnv = process.env.SYNC_TARGET_TIMEOUT_MS;
  process.env.SYNC_TARGET_TIMEOUT_MS = String(targetTimeoutMs);
  delete require.cache[SYNC_RUNTIME_PATH];

  const realLoad = Module._load;
  Module._load = function stubbedLoad(request, parent, isMain) {
    const resolved = (() => {
      try {
        return Module._resolveFilename(request, parent, isMain);
      } catch {
        return "";
      }
    })();
    if (resolved === GREENHOUSE_SERVICE_PATH) {
      return {
        ...realLoad.call(this, request, parent, isMain),
        collectPostingsForGreenhouseCompany: () => new Promise(() => {})
      };
    }
    return realLoad.call(this, request, parent, isMain);
  };

  let freshSyncRuntime;
  try {
    freshSyncRuntime = require("../services/sync-runtime.js");
  } finally {
    Module._load = realLoad;
  }

  delete require.cache[SYNC_RUNTIME_PATH];
  if (previousEnv === undefined) delete process.env.SYNC_TARGET_TIMEOUT_MS;
  else process.env.SYNC_TARGET_TIMEOUT_MS = previousEnv;
  return freshSyncRuntime;
}

async function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openpostings-target-deadline-"));
  setDb(await openDatabase({ filename: path.join(dir, "test.db") }));
  const db = getDb();
  await db.exec(`
    CREATE TABLE companies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_name TEXT NOT NULL,
      url_string TEXT NOT NULL,
      ATS_name TEXT NOT NULL,
      last_synced_epoch INTEGER
    );
    CREATE TABLE blocked_companies (
      normalized_company_name TEXT PRIMARY KEY,
      company_name TEXT NOT NULL,
      blocked_at_epoch INTEGER NOT NULL
    );
  `);
  await db.run(`INSERT INTO companies (company_name, url_string, ATS_name) VALUES (?, ?, ?);`, [
    "hanging-co",
    "https://example.com/hanging-co",
    "greenhouse"
  ]);
  // Only this platform is enabled, and BOARD_WIDE_SYNC_TARGETS is keyed by other ATS names,
  // so the one hanging company is the entire pass -- nothing else can mask a broken deadline.
  setSyncEnabledAts(new Set(["greenhouse"]));
}

async function testTargetDeadlineFreesAHangingCompanyWithNoExternalAbort() {
  await setup();
  const freshSyncRuntime = loadSyncRuntimeWithHangingCollector(50);

  const startedAtMs = Date.now();
  // runAtsSync() is called exactly as the scheduler calls it -- nothing here ever calls
  // .abort() on anything. Only SYNC_TARGET_TIMEOUT_MS can end this pass.
  await withTestDeadline(
    freshSyncRuntime.runAtsSync(),
    5000,
    "sync pass never completed -- the target-level deadline did not fire on its own"
  );
  const elapsedMs = Date.now() - startedAtMs;

  assert.strictEqual(freshSyncRuntime.syncStatus.running, false, "the pass must finish, not stay stuck running");
  assert.strictEqual(
    freshSyncRuntime.syncStatus.target_timeouts,
    1,
    "the hanging company must be counted as a target timeout"
  );
  assert.ok(
    freshSyncRuntime.syncStatus.last_target_timeout_at,
    "last_target_timeout_at must be stamped when the deadline fires"
  );
  // last_sync_summary.errors also carries unrelated system-maintenance failures (this test's
  // schema deliberately omits the Postings table, since nothing here needs it) -- so pick out
  // the hanging company's own entry rather than asserting on the total error count.
  const companyError = freshSyncRuntime.syncStatus.last_sync_summary?.errors?.find(
    (error) => error.company_name === "hanging-co"
  );
  assert.ok(companyError, "the timed-out company must be recorded as a failure, not silently dropped");
  assert.match(
    companyError.message,
    /Sync target timed out after 0s: hanging-co/,
    "the failure must be attributed to the target-level deadline, not some other error"
  );
  assert.ok(
    elapsedMs < 5000,
    `pass took ${elapsedMs}ms -- too slow to have been rescued by the 50ms target deadline specifically`
  );
}

async function main() {
  await testTargetDeadlineFreesAHangingCompanyWithNoExternalAbort();
  console.log("sync-target-hard-deadline tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
