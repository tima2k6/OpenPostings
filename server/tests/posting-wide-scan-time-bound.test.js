// MAX_WIDE_SCAN_CANDIDATE_ROWS bounds the wide-scan walk by the rows a chunk *returns*, but
// the cost lives in the rows SQLite had to *examine* to produce them, and the two diverge
// exactly when a search term is selective. Measured 2026-08-19 against the live database
// (1.88M postings, 1.05M visible+fresh): one chunk searching for "kubernetes" took 65.5s and
// returned 150 rows -- charging 150 against a 50,000 budget for a minute of disk. Three such
// queries queued behind runExclusiveWideScan that morning left /health taking 243s and the
// description backfill failing 200 of 200 until they drained.
//
// MAX_WIDE_SCAN_MILLIS is the second bound, and this pins it: with the row cap raised out of
// reach, a walk that cannot converge must still stop and report scan_bounded, and one that
// converges immediately must still report false.
//
// Both limits are read once at module load, so they are set before postings.js is required.
// The row cap goes high enough that only the clock can end the walk here -- otherwise this
// test would pass for the reason the other file already covers.
process.env.POSTINGS_WIDE_SCAN_MAX_CANDIDATES = "1000000";
process.env.POSTINGS_WIDE_SCAN_MAX_MILLIS = "1";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { openDatabase } = require("../db/open-database.js");
const { setDb, getDb, setPostingLocationByJobUrl } = require("../services/runtime-context.js");
const { createCanonicalPostingsTable } = require("../services/sync-runtime.js");
const { listPostingsWithFilters } = require("../services/postings.js");
const { ensurePostingReviewSchema } = require("../services/posting-review.js");

const NOW = Math.floor(Date.now() / 1000);
const OLD_POSTING_DATE = "2020-01-01";

async function seedStaleWaPostings(db, count) {
  await db.exec("BEGIN");
  for (let index = 0; index < count; index += 1) {
    await db.run(
      `INSERT INTO Postings
         (company_name, position_name, job_posting_url, location, posting_date,
          first_seen_epoch, last_seen_epoch, hidden)
       VALUES (?, ?, ?, 'Seattle, WA', ?, ?, ?, 0)`,
      [`Company ${index}`, `Role ${index}`, `https://x/stale-${index}`, OLD_POSTING_DATE, NOW - 60, NOW - 60]
    );
  }
  await db.exec("COMMIT");
}

async function seedOneFreshWaPosting(db, url) {
  await db.run(
    `INSERT INTO Postings
       (company_name, position_name, job_posting_url, location, posting_date,
        first_seen_epoch, last_seen_epoch, hidden)
     VALUES (?, ?, ?, 'Seattle, WA', ?, ?, ?, 0)`,
    ["Acme", "Fresh Role", url, new Date(NOW * 1000).toISOString().slice(0, 10), NOW - 60, NOW - 60]
  );
}

async function withDb(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openpostings-wide-scan-time-"));
  setDb(await openDatabase({ filename: path.join(dir, "test.db") }));
  setPostingLocationByJobUrl(new Map());
  try {
    await createCanonicalPostingsTable();
    const db = getDb();
    await db.exec(`
      CREATE TABLE IF NOT EXISTS blocked_companies (
        normalized_company_name TEXT NOT NULL PRIMARY KEY,
        company_name TEXT NOT NULL, blocked_at_epoch INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS posting_application_state (
        job_posting_url TEXT NOT NULL PRIMARY KEY, applied INTEGER NOT NULL DEFAULT 0,
        applied_by_type TEXT NOT NULL DEFAULT '', applied_by_label TEXT NOT NULL DEFAULT '',
        applied_at_epoch INTEGER, last_application_id INTEGER,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        ignored INTEGER NOT NULL DEFAULT 0, ignored_at_epoch INTEGER,
        ignored_by_label TEXT NOT NULL DEFAULT '');
      CREATE TABLE IF NOT EXISTS companies (
        id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, company_name TEXT NOT NULL,
        url_string TEXT NOT NULL, ATS_name TEXT NOT NULL);
    `);
    await ensurePostingReviewSchema(db);
    await run(db);
  } finally {
    setDb(null);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// Enough postings to need more than one chunk (chunk size floors at 250), none of which pass
// the JS-only review_queue=new freshness check. The row cap is a million here, so the walk
// can only be stopped by the clock -- and a chunk of 250 rows through classification takes
// far longer than the 1ms budget, so the check on the second iteration must fire.
async function testWideScanStopsOnTheTimeBudget() {
  await withDb(async (db) => {
    await seedStaleWaPostings(db, 600);
    const result = await listPostingsWithFilters({
      states: ["WA"],
      review_queue: "new",
      limit: 10,
      offset: 0
    });
    assert.strictEqual(result.items.length, 0, "every seeded posting is stale, so none should match");
    assert.strictEqual(
      result.scan_bounded,
      true,
      "the walk ran past MAX_WIDE_SCAN_MILLIS without filling a page and must say so"
    );
  });
}

// The budget must not be a permanently-stuck true: a walk that fills its page inside the
// first chunk never reaches a second iteration, so it never tests the clock at all.
async function testConvergingWalkIsNotReportedBounded() {
  await withDb(async (db) => {
    await seedStaleWaPostings(db, 3);
    await seedOneFreshWaPosting(db, "https://x/fresh-1");
    await seedOneFreshWaPosting(db, "https://x/fresh-2");

    const result = await listPostingsWithFilters({
      states: ["WA"],
      review_queue: "new",
      limit: 10,
      offset: 0
    });
    assert.strictEqual(result.items.length, 2, "only the two fresh postings should match");
    assert.strictEqual(
      result.scan_bounded,
      false,
      "a walk that exhausted its candidates in one chunk was not cut short"
    );
  });
}

async function main() {
  await testWideScanStopsOnTheTimeBudget();
  await testConvergingWalkIsNotReportedBounded();
  console.log("posting-wide-scan-time-bound tests passed");
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = { main };
