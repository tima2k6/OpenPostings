// runInWriteTransaction serializes every explicit transaction in the process, because they
// all share one SQLite connection and SQLite has no nested transactions.
//
// The distinction these cases exist for cost real data. The first version of the nesting
// guard used a module-level boolean set while a transaction ran, and threw if a caller found
// it set. That rejects *concurrent* callers, not nested ones -- and concurrency is the entire
// reason the queue exists. In production it meant the sync flushing postings while a
// background enrichment pass held the transaction threw instead of waiting, dropping 152
// postings each time it happened.
//
// So: concurrent callers must queue and all succeed. Nested callers must still fail loudly,
// because a nested call waits on the chain its own caller is holding and hangs forever.
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { openDatabase } = require("../db/open-database.js");
const { setDb, getDb, runInWriteTransaction } = require("../services/runtime-context.js");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openpostings-tx-"));
  setDb(await openDatabase({ filename: path.join(dir, "test.db") }));
  await getDb().exec(`CREATE TABLE IF NOT EXISTS t (id INTEGER PRIMARY KEY AUTOINCREMENT, tag TEXT NOT NULL);`);
}

// The actual regression shape, and the one a simultaneous-launch test misses. Four calls
// fired in the same tick all check the guard before the first transaction has opened, so a
// call-time flag looks clear to all of them. The production failure was staggered: the sync
// arrived while a background enrichment transaction was already open and had already set the
// flag. This starts one transaction, waits until it is provably running, and only then calls
// the second -- which is the case that dropped 152 postings a time.
async function testCallerArrivingMidTransactionQueues() {
  let firstIsRunning;
  const firstStarted = new Promise((resolve) => {
    firstIsRunning = resolve;
  });

  const first = runInWriteTransaction(async (handle) => {
    await handle.run(`INSERT INTO t (tag) VALUES ('enrichment');`);
    firstIsRunning();
    // Hold the transaction open so the second caller genuinely overlaps it.
    await sleep(60);
    return "enrichment";
  });

  await firstStarted;
  // Arrives from an unrelated async context while the first transaction is open. It is not
  // nested and must queue rather than be rejected.
  const second = runInWriteTransaction(async (handle) => {
    await handle.run(`INSERT INTO t (tag) VALUES ('sync-flush');`);
    return "sync-flush";
  });

  const settled = await Promise.allSettled([first, second]);
  const rejected = settled.filter((entry) => entry.status === "rejected");
  assert.deepStrictEqual(
    rejected.map((entry) => String(entry.reason?.message || entry.reason)),
    [],
    "a writer arriving mid-transaction must queue, not be rejected as nested"
  );

  const rows = await getDb().all(`SELECT tag FROM t WHERE tag IN ('enrichment', 'sync-flush') ORDER BY id;`);
  assert.deepStrictEqual(rows.map((row) => row.tag), ["enrichment", "sync-flush"]);
}

// Two unrelated writers starting in the same tick. Cheaper to hit and still worth pinning.
async function testConcurrentCallersAllSucceed() {
  const results = await Promise.allSettled(
    ["sync", "descriptions", "semantic", "api"].map((tag) =>
      runInWriteTransaction(async (handle) => {
        // Overlapping windows -- without queueing these would collide on BEGIN.
        await handle.run(`INSERT INTO t (tag) VALUES (?);`, [tag]);
        await sleep(20);
        return tag;
      })
    )
  );

  const rejected = results.filter((entry) => entry.status === "rejected");
  assert.deepStrictEqual(
    rejected.map((entry) => String(entry.reason?.message || entry.reason)),
    [],
    "concurrent writers must queue, not be rejected as if they were nested"
  );

  // Scoped to this case's own tags -- earlier cases share the table.
  const rows = await getDb().all(
    `SELECT tag FROM t WHERE tag IN ('sync', 'descriptions', 'semantic', 'api') ORDER BY id;`
  );
  assert.strictEqual(rows.length, 4, "every concurrent transaction must have committed");
  assert.deepStrictEqual(rows.map((row) => row.tag).sort(), ["api", "descriptions", "semantic", "sync"]);
}

// Still has to fail: a nested call would deadlock against its own caller.
async function testNestedStillThrows() {
  await assert.rejects(
    () =>
      runInWriteTransaction(async () => {
        await runInWriteTransaction(async () => "inner");
      }),
    /cannot be nested/,
    "a call originating inside a transaction task must be rejected"
  );

  // Rejecting the nested call must not poison the chain for later work.
  const after = await runInWriteTransaction(async (handle) => {
    await handle.run(`INSERT INTO t (tag) VALUES ('after-nested');`);
    return "ok";
  });
  assert.strictEqual(after, "ok");
}

// A failing task rolls back and must not stop the queue.
async function testFailureIsolation() {
  await assert.rejects(
    () =>
      runInWriteTransaction(async (handle) => {
        await handle.run(`INSERT INTO t (tag) VALUES ('doomed');`);
        throw new Error("task failed");
      }),
    /task failed/
  );

  const doomed = await getDb().get(`SELECT id FROM t WHERE tag = 'doomed';`);
  assert.ok(!doomed, "a failed task must roll back its writes");

  const survivor = await runInWriteTransaction(async (handle) => {
    await handle.run(`INSERT INTO t (tag) VALUES ('survivor');`);
    return "still working";
  });
  assert.strictEqual(survivor, "still working", "one failure must not close the queue");
}

// The line that turned a glitch into a 20-hour outage. The previous version set its
// in-transaction flag *before* BEGIN and outside the try/finally, so a BEGIN that failed --
// which is exactly what happens when another writer already holds one -- left the flag set
// with nothing to clear it. Every subsequent write in the process then threw "cannot be
// nested" until restart. The sync stopped storing postings, last_seen_epoch stopped
// advancing, and 24 hours later the app's freshness window emptied the listing.
//
// So: a failed BEGIN must fail exactly one transaction and leave the queue usable.
async function testBeginFailureDoesNotWedgeTheQueue() {
  const realDb = getDb();
  let failNextBegin = true;
  // Passes everything through except the first BEGIN, which fails the way a busy database
  // does.
  const flaky = {
    exec: async (sql) => {
      if (failNextBegin && /^\s*BEGIN/i.test(String(sql))) {
        failNextBegin = false;
        throw new Error("SQLITE_BUSY: database is locked");
      }
      return realDb.exec(sql);
    },
    run: (...args) => realDb.run(...args),
    get: (...args) => realDb.get(...args),
    all: (...args) => realDb.all(...args)
  };

  setDb(flaky);
  try {
    await assert.rejects(
      () => runInWriteTransaction(async () => "never runs"),
      /database is locked/,
      "a failed BEGIN surfaces to its own caller"
    );

    // The assertion that matters: the next unrelated write must still work.
    const recovered = await runInWriteTransaction(async (handle) => {
      await handle.run(`INSERT INTO t (tag) VALUES ('after-begin-failure');`);
      return "recovered";
    });
    assert.strictEqual(recovered, "recovered", "a failed BEGIN must not wedge every later transaction");

    // And repeatedly, since the real outage was a permanent wedge rather than one bad call.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const again = await runInWriteTransaction(async () => "still fine");
      assert.strictEqual(again, "still fine");
    }
  } finally {
    setDb(realDb);
  }

  const row = await getDb().get(`SELECT tag FROM t WHERE tag = 'after-begin-failure';`);
  assert.ok(row, "the transaction after the failure committed for real");
}

// Serialization is the actual guarantee: never two transactions open at once.
async function testNeverTwoOpenAtOnce() {
  let open = 0;
  let maxOpen = 0;
  await Promise.all(
    Array.from({ length: 8 }, (_, index) =>
      runInWriteTransaction(async (handle) => {
        open += 1;
        maxOpen = Math.max(maxOpen, open);
        await handle.run(`INSERT INTO t (tag) VALUES (?);`, [`batch-${index}`]);
        await sleep(5);
        open -= 1;
      })
    )
  );
  assert.strictEqual(maxOpen, 1, "only one write transaction may be open at a time");
}

async function main() {
  await setup();
  await testCallerArrivingMidTransactionQueues();
  await testConcurrentCallersAllSucceed();
  await testNestedStillThrows();
  await testFailureIsolation();
  await testBeginFailureDoesNotWedgeTheQueue();
  await testNeverTwoOpenAtOnce();
  console.log("write-transaction tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
