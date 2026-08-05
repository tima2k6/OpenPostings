// The error log exists because a failure was invisible. record_application_result threw
// while logging Amazon submissions, the agent mentioned it in one line of prose and carried
// on, and several real applications went untracked with nothing in the app to show it.
//
// So the cases here are about the two ways this feature can fail to do its job: not
// recording when it should, and recording somewhere that gets thrown away.
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { openDatabase } = require("../db/open-database.js");
const { setDb, getDb, runInWriteTransaction } = require("../services/runtime-context.js");
const { ensureErrorLogTable, recordError, listErrors, acknowledgeErrors } = require("../services/error-log.js");

async function withDb(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openpostings-errorlog-"));
  setDb(await openDatabase({ filename: path.join(dir, "test.db") }));
  await ensureErrorLogTable();
  await run();
}

async function testRecordsWhatIsNeededToRecoverByHand() {
  await recordError({
    source: "mcp",
    operation: "record_application_result",
    message: "Application was submitted but could not be logged: boom",
    context: {
      company_name: "Amazon",
      position_name: "Principal Program Manager",
      job_posting_url: "https://www.amazon.jobs/en/jobs/123/x"
    }
  });

  const { items, unacknowledged_count: unacknowledged } = await listErrors({});
  assert.strictEqual(items.length, 1);
  assert.strictEqual(unacknowledged, 1);

  const [entry] = items;
  assert.strictEqual(entry.source, "mcp");
  assert.strictEqual(entry.operation, "record_application_result");
  assert.match(entry.message, /could not be logged/i);
  // The context is the recovery path: without the posting URL and the role, a lost
  // application cannot be re-entered from the notice alone.
  assert.strictEqual(entry.context.company_name, "Amazon");
  assert.strictEqual(entry.context.job_posting_url, "https://www.amazon.jobs/en/jobs/123/x");
}

// The single most important property. The thing being reported is usually a transaction
// that is about to roll back; a log written inside it would be rolled back with it, and the
// only record of the failure would be destroyed by the failure.
async function testSurvivesTheRollbackItReports() {
  const before = (await listErrors({})).items.length;

  await assert.rejects(
    () =>
      runInWriteTransaction(async (handle) => {
        await handle.run(
          `INSERT INTO error_log (occurred_at_epoch, source, operation, message, context)
           VALUES (?, 'inside', 'doomed', 'written inside the doomed transaction', '');`,
          [1]
        );
        throw new Error("the operation failed");
      }),
    /the operation failed/
  );

  const afterRollback = await listErrors({});
  assert.ok(
    !afterRollback.items.some((item) => item.source === "inside"),
    "a row written inside the failing transaction is rolled back with it -- which is why recordError must not use one"
  );

  // Recording after the rollback, the way the real call sites do, persists.
  await recordError({ source: "api", operation: "POST /applications", message: "the operation failed" });
  const finalState = await listErrors({});
  assert.strictEqual(finalState.items.length, before + 1);
  assert.ok(finalState.items.some((item) => item.operation === "POST /applications"));
}

// recordError is called from inside catch blocks. If it throws, it replaces the real error
// with a worse one and can take down an operation that was only partly failing.
async function testNeverThrows() {
  const previousDb = getDb();
  setDb(null);
  try {
    const result = await recordError({ source: "api", operation: "x", message: "y" });
    assert.strictEqual(result, null, "with no database it returns null rather than throwing");
  } finally {
    setDb(previousDb);
  }

  // Context that cannot be serialized must not break the recording either.
  const circular = {};
  circular.self = circular;
  await recordError({ source: "api", operation: "circular", message: "z", context: circular });
  const { items } = await listErrors({ include_acknowledged: true });
  const entry = items.find((item) => item.operation === "circular");
  assert.ok(entry, "an unserializable context still produces a record");
}

// Dismissing clears the notice, not the history: an application that was never logged stays
// worth knowing about after the banner is gone.
async function testAcknowledgeHidesButKeeps() {
  const openBefore = await listErrors({});
  assert.ok(openBefore.items.length > 0);

  await acknowledgeErrors([]);
  const afterAck = await listErrors({});
  assert.strictEqual(afterAck.items.length, 0, "acknowledged entries leave the banner");
  assert.strictEqual(afterAck.unacknowledged_count, 0);

  const withHistory = await listErrors({ include_acknowledged: true });
  assert.ok(withHistory.items.length > 0, "the records themselves are kept");
  assert.ok(withHistory.items.every((item) => item.acknowledged));
}

// Regression: a health/infra warning (source "health", e.g. the swap-usage watch check)
// once showed up in the Applications page's error banner, which reads this same table but
// exists to surface application-submission failures ("api", "mcp"). The banner now asks for
// those sources explicitly, so this pins the filter it depends on.
async function testSourcesFilterScopesToTheCallersConcern() {
  await recordError({ source: "health", operation: "watch:swap_used", message: "swap high" });
  await recordError({ source: "api", operation: "POST /applications", message: "could not log" });

  const applicationsOnly = await listErrors({ sources: ["api", "mcp"] });
  assert.ok(
    applicationsOnly.items.every((item) => item.source === "api" || item.source === "mcp"),
    "a health-sourced row must not appear when the caller asked for application sources only"
  );
  assert.ok(
    applicationsOnly.items.some((item) => item.operation === "POST /applications"),
    "the actual application failure must still appear"
  );
  assert.strictEqual(
    applicationsOnly.unacknowledged_count,
    applicationsOnly.items.length,
    "the unacknowledged count must be scoped by the same filter, not the whole table"
  );

  const unfiltered = await listErrors({});
  assert.ok(
    unfiltered.items.some((item) => item.source === "health"),
    "omitting sources must still return everything for a caller that wants the whole log"
  );
}

async function main() {
  await withDb(async () => {
    await testRecordsWhatIsNeededToRecoverByHand();
    await testSurvivesTheRollbackItReports();
    await testNeverThrows();
    await testSourcesFilterScopesToTheCallersConcern();
    await testAcknowledgeHidesButKeeps();
  });
  console.log("error-log tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
