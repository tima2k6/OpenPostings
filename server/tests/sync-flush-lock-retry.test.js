// Between 2026-08-07 and 2026-09-03 the sync silently discarded 54,231 collected postings
// across 306 flush failures, every one of them SQLITE_BUSY. The batch was spliced off the
// pending list before the write, so when upsertPostings threw there was nothing left holding
// the rows -- and the pass still reported success, because progress.current had advanced.
//
// The fix retries the lock case and requeues what it cannot write. That makes
// isRetryableWriteLockError load-bearing: if it fails to recognise the error SQLite actually
// produces, the retry never engages and the rows are dropped exactly as before, with no
// visible difference. So the first case below does not assert against a hand-written message
// string -- it locks a real database and asserts on the real error object.
//
// The second half guards the opposite mistake, which has also cost data here: on 2026-07-27
// a busy handler treated SQLITE_BUSY as evidence of corruption and DROP'd the Postings
// table. Lock contention and corruption are unrelated conditions, and a corruption error
// must never be classified retryable.
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { openDatabase } = require("../db/open-database.js");
const { isRetryableWriteLockError } = require("../services/sync-runtime.js");

async function testRealLockContentionIsRecognised() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openpostings-flush-lock-"));
  const filename = path.join(dir, "lock.db");

  const holder = await openDatabase({ filename });
  const writer = await openDatabase({ filename });

  try {
    await holder.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT);");
    // Do not wait for the lock: we want the error, not a 30s stall.
    await writer.exec("PRAGMA busy_timeout = 0;");

    // An exclusive transaction on one connection blocks writes from the other.
    await holder.exec("BEGIN EXCLUSIVE TRANSACTION;");

    let caught = null;
    try {
      await writer.run("INSERT INTO t (v) VALUES (?);", ["blocked"]);
    } catch (error) {
      caught = error;
    }

    assert.ok(caught, "expected the blocked write to fail while the lock was held");
    assert.ok(
      isRetryableWriteLockError(caught),
      `a real lock error must be classified retryable, got code=${caught?.code} message=${caught?.message}`
    );

    await holder.exec("COMMIT;");

    // And once the lock clears, the same write succeeds -- which is what makes retrying the
    // correct response rather than dropping the batch.
    await writer.run("INSERT INTO t (v) VALUES (?);", ["after-commit"]);
    const row = await writer.get("SELECT COUNT(*) AS count FROM t;");
    assert.strictEqual(Number(row?.count), 1);
  } finally {
    await holder.close?.().catch?.(() => {});
    await writer.close?.().catch?.(() => {});
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function testCorruptionAndOtherErrorsAreNotRetryable() {
  const mustNotRetry = [
    Object.assign(new Error("SQLITE_CORRUPT: database disk image is malformed"), {
      code: "SQLITE_CORRUPT"
    }),
    Object.assign(new Error("SQLITE_NOTADB: file is not a database"), { code: "SQLITE_NOTADB" }),
    Object.assign(new Error("SQLITE_FULL: database or disk is full"), { code: "SQLITE_FULL" }),
    Object.assign(new Error("SQLITE_READONLY: attempt to write a readonly database"), {
      code: "SQLITE_READONLY"
    }),
    new Error("no such table: Postings"),
    new Error("cannot start a transaction within a transaction"),
    new Error("SQLITE_CONSTRAINT: UNIQUE constraint failed: Postings.url_string")
  ];

  for (const error of mustNotRetry) {
    assert.strictEqual(
      isRetryableWriteLockError(error),
      false,
      `must not be retried: ${error.message}`
    );
  }
}

function testLockErrorShapesAreRecognised() {
  const mustRetry = [
    Object.assign(new Error("SQLITE_BUSY: database is locked"), { code: "SQLITE_BUSY" }),
    Object.assign(new Error("SQLITE_LOCKED: database table is locked"), { code: "SQLITE_LOCKED" }),
    // Code missing, message only -- the wrapper does not always preserve `code`.
    new Error("SQLITE_BUSY: database is locked"),
    new Error("database is locked")
  ];

  for (const error of mustRetry) {
    assert.strictEqual(isRetryableWriteLockError(error), true, `must be retried: ${error.message}`);
  }

  // Must not throw on junk input.
  assert.strictEqual(isRetryableWriteLockError(null), false);
  assert.strictEqual(isRetryableWriteLockError(undefined), false);
  assert.strictEqual(isRetryableWriteLockError("database is locked"), true);
}

async function run() {
  await testRealLockContentionIsRecognised();
  testLockErrorShapesAreRecognised();
  testCorruptionAndOtherErrorsAreNotRetryable();
  console.log("sync-flush-lock-retry tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
