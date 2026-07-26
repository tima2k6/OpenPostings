// Guards the index work: these queries are fast only because SQLite can reach them
// through an index, and nothing about the SQL itself makes that obvious. Wrapping an
// indexed column in COALESCE, or dropping the ANALYZE stats the planner needs, silently
// turns any of them back into a full scan with no test failure anywhere else.
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { openDatabase } = require("../db/open-database.js");
const { setDb, getDb } = require("../services/runtime-context.js");
const { createCanonicalPostingsTable } = require("../services/sync-runtime.js");

const ROWS = 5000;
const NOW = 1800000000;

// The planner only prefers an index once it believes the table is big enough to matter,
// so the fixture has to carry enough rows to be representative rather than a handful.
async function seed(db) {
  await db.exec("BEGIN");
  for (let i = 0; i < ROWS; i += 1) {
    const seen = NOW - i;
    const hidden = i % 50 === 0 ? 1 : 0;
    await db.run(
      `INSERT INTO Postings
         (company_name, position_name, job_posting_url, first_seen_epoch, last_seen_epoch, hidden, hidden_at_epoch)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [`Company ${i % 500}`, `Engineer ${i % 50}`, `https://example.test/${i}`, seen, seen, hidden, hidden ? seen : null]
    );
  }
  await db.exec("COMMIT");
  await db.exec("PRAGMA optimize;");
}

async function planFor(db, sql, params) {
  const rows = await db.all(`EXPLAIN QUERY PLAN ${sql}`, params);
  return rows.map((row) => String(row?.detail || "")).join(" | ");
}

async function withSeededDb(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openpostings-plan-"));
  setDb(await openDatabase({ filename: path.join(dir, "test.db") }));
  try {
    await createCanonicalPostingsTable();
    const db = getDb();
    await seed(db);
    await run(db);
  } finally {
    setDb(null);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function testListingSortStreamsFromIndex() {
  await withSeededDb(async (db) => {
    const plan = await planFor(
      db,
      `SELECT id, company_name, last_seen_epoch
       FROM Postings
       WHERE hidden = 0 AND last_seen_epoch >= ?
       ORDER BY last_seen_epoch DESC, id DESC
       LIMIT 500`,
      [NOW - 86400]
    );
    assert.ok(
      plan.includes("idx_postings_hidden_last_seen_epoch"),
      `listing sort should use the ordering index, got: ${plan}`
    );
    assert.ok(
      !plan.includes("TEMP B-TREE"),
      `listing sort must not fall back to sorting the visible set, got: ${plan}`
    );
  });
}

async function testPrunePredicateUsesIndex() {
  await withSeededDb(async (db) => {
    const plan = await planFor(db, `SELECT id FROM Postings WHERE hidden = 0 AND last_seen_epoch < ?`, [NOW]);
    assert.ok(
      plan.includes("idx_postings_hidden_last_seen_epoch"),
      `prune predicate should use the freshness index, got: ${plan}`
    );
    assert.ok(!plan.includes("SCAN Postings"), `prune predicate must not scan the table, got: ${plan}`);
  });
}

async function testRetentionSweepUsesIndex() {
  await withSeededDb(async (db) => {
    const plan = await planFor(
      db,
      `SELECT id FROM Postings WHERE hidden = 1 AND hidden_at_epoch IS NOT NULL AND hidden_at_epoch < ?`,
      [NOW]
    );
    assert.ok(
      plan.includes("idx_postings_hidden_hidden_at_epoch"),
      `retention sweep should use the hidden_at index, got: ${plan}`
    );
    assert.ok(!plan.includes("SCAN Postings"), `retention sweep must not scan the table, got: ${plan}`);
  });
}

// Not asserted here: that wrapping a column in COALESCE forces a scan. It does on a
// database with no ANALYZE stats, which is what made the original 1145ms prune slow, but
// once stats exist SQLite can recover the same index through a skip-scan on the low
// cardinality of hidden. Pinning that would be pinning planner internals, not our code.

async function main() {
  await testListingSortStreamsFromIndex();
  await testPrunePredicateUsesIndex();
  await testRetentionSweepUsesIndex();
  console.log("posting-query-plan tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
