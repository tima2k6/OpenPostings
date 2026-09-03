// The semantic index had two independent defects, both measured on the live database on
// 2026-09-03 and both fixed by the code these cases cover.
//
// 1. It indexed hidden postings. Search filters them out of every result and nothing ever
//    removed them, so they accumulated: ~87.7% of 1.59M indexed documents were postings no
//    query could return. They cannot be deleted retroactively either -- postings_fts is an
//    FTS5 external content table, so deleting a row requires re-supplying the exact text
//    that was indexed, and hidden postings have had their descriptions cleared (5,000 of
//    5,000 sampled were empty). The only defence is never to index them.
//
// 2. It lost visible postings permanently. The forward cursor skipped rows with no
//    description but still advanced past them, and the description backfill then filled
//    those descriptions in place, below the cursor, where nothing looked again. Sampled miss
//    rate among rows that had a description and sat below the cursor ran 7.5-22.2%, worsening
//    with age. gapScanSemanticIndex is the sweep back, mirroring the gap_scanned_id column
//    posting_match_state already used for the identical problem.
const assert = require("node:assert");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");

const { getDb, setDb } = require("../services/runtime-context.js");
const { rebuildSemanticIndex, gapScanSemanticIndex } = require("../services/semantic-search.js");

async function withDb(run) {
  const previousDb = getDb();
  const db = await open({ filename: ":memory:", driver: sqlite3.Database });
  try {
    setDb(db);
    await db.exec(`
      CREATE TABLE Postings (
        id INTEGER PRIMARY KEY,
        position_name TEXT,
        company_name TEXT,
        job_description TEXT,
        hidden INTEGER NOT NULL DEFAULT 0
      );
    `);
    await run(db);
  } finally {
    setDb(previousDb);
    await db.close();
  }
}

const insert = (db, id, { hidden = 0, description = `alphaword duties for posting ${id}` } = {}) =>
  db.run(
    `INSERT INTO Postings (id, position_name, company_name, job_description, hidden)
     VALUES (?, ?, ?, ?, ?);`,
    [id, `Role ${id}`, "Example", description, hidden]
  );

const indexedIds = async (db) =>
  (await db.all(`SELECT id FROM postings_fts_docsize ORDER BY id;`)).map((row) => Number(row.id));

async function testForwardPassSkipsHiddenPostings() {
  await withDb(async (db) => {
    await insert(db, 1);
    await insert(db, 2, { hidden: 1 });
    await insert(db, 3);

    await rebuildSemanticIndex({ batch_size: 10, max_batches: 5 });

    assert.deepStrictEqual(await indexedIds(db), [1, 3], "hidden postings must never be indexed");
  });
}

// The exact production sequence: a posting arrives with no description, the forward pass
// skips it but advances past it, and the backfill fills the description afterwards.
async function testGapScanRecoversADescriptionFilledAfterTheCursorPassed() {
  await withDb(async (db) => {
    await insert(db, 1);
    await insert(db, 2, { description: null });
    await insert(db, 3);

    await rebuildSemanticIndex({ batch_size: 10, max_batches: 5 });
    assert.deepStrictEqual(await indexedIds(db), [1, 3], "row 2 has no description yet");

    // The backfill fills it in, below the forward cursor.
    await db.run(`UPDATE Postings SET job_description = ? WHERE id = 2;`, [
      "alphaword duties for posting 2"
    ]);

    // The forward pass alone cannot see it -- this is the bug.
    const forwardOnly = await rebuildSemanticIndex({ batch_size: 10, max_batches: 5 });
    assert.strictEqual(forwardOnly.indexed, 0, "forward pass only ever moves up");
    assert.deepStrictEqual(await indexedIds(db), [1, 3]);

    const gap = await gapScanSemanticIndex({ batch_size: 10, max_batches: 5 });
    assert.strictEqual(gap.indexed, 1);
    assert.deepStrictEqual(await indexedIds(db), [1, 2, 3], "gap scan must recover it");

    const matches = await db.all(
      `SELECT rowid FROM postings_fts WHERE postings_fts MATCH 'alphaword' ORDER BY rowid;`
    );
    assert.deepStrictEqual(matches.map((row) => row.rowid), [1, 2, 3], "and it must be searchable");
  });
}

async function testGapScanSkipsHiddenAndDescriptionlessRows() {
  await withDb(async (db) => {
    await insert(db, 1);
    await insert(db, 2, { hidden: 1 });
    await insert(db, 3, { description: "   " });
    await insert(db, 4, { description: null });
    await insert(db, 5);

    await rebuildSemanticIndex({ batch_size: 10, max_batches: 5 });
    assert.deepStrictEqual(await indexedIds(db), [1, 5]);

    const gap = await gapScanSemanticIndex({ batch_size: 10, max_batches: 5 });
    assert.strictEqual(gap.indexed, 0, "nothing below the cursor newly qualifies");
    assert.deepStrictEqual(await indexedIds(db), [1, 5]);
  });
}

// FTS5 does not enforce uniqueness on rowid, so re-inserting an already-indexed document
// silently duplicates its terms and corrupts ranking. The membership test is what prevents
// that, and it has to run against the docsize shadow table -- `SELECT rowid FROM postings_fts
// WHERE rowid = ?` reads through to the content table and returns a row even for postings
// that were never indexed (verified against the live database).
async function testGapScanDoesNotDoubleIndex() {
  await withDb(async (db) => {
    await insert(db, 1);
    await insert(db, 2);
    await insert(db, 3);

    await rebuildSemanticIndex({ batch_size: 10, max_batches: 5 });

    for (let pass = 0; pass < 3; pass += 1) {
      const gap = await gapScanSemanticIndex({ batch_size: 10, max_batches: 5 });
      assert.strictEqual(gap.indexed, 0, "already-indexed rows must not be re-inserted");
    }

    const counts = await db.get(
      `SELECT COUNT(*) AS total, COUNT(DISTINCT id) AS distinct_ids FROM postings_fts_docsize;`
    );
    assert.strictEqual(Number(counts.total), Number(counts.distinct_ids), "no duplicate documents");
    assert.strictEqual(Number(counts.total), 3);
  });
}

// A sweep that finished must start again from the bottom, otherwise drift that appears below
// a parked cursor is never picked up.
async function testGapScanCyclesBackToTheBottom() {
  await withDb(async (db) => {
    for (let id = 1; id <= 4; id += 1) await insert(db, id);
    await rebuildSemanticIndex({ batch_size: 10, max_batches: 5 });

    // Walk the sweep to completion in small slices.
    let complete = false;
    for (let attempt = 0; attempt < 10 && !complete; attempt += 1) {
      complete = (await gapScanSemanticIndex({ batch_size: 2, max_batches: 1 })).complete;
    }
    assert.ok(complete, "sweep should reach the forward cursor");

    const state = await db.get(`SELECT gap_scanned_id FROM semantic_index_state WHERE id = 1;`);
    assert.strictEqual(Number(state.gap_scanned_id), 0, "cursor resets for the next sweep");
  });
}

async function run() {
  await testForwardPassSkipsHiddenPostings();
  await testGapScanRecoversADescriptionFilledAfterTheCursorPassed();
  await testGapScanSkipsHiddenAndDescriptionlessRows();
  await testGapScanDoesNotDoubleIndex();
  await testGapScanCyclesBackToTheBottom();
  console.log("semantic index gap scan tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
