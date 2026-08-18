// The wide-scan chunked walk (listPostingsWithFilters, the candidateQuery branch) used to
// have no bound on total work: its only exits were "found a full page" or "exhausted every
// SQL candidate in every phase" -- i.e. the entire visible Postings table, if a filter
// combination is rare enough that a JS-only predicate (review_queue=new's freshness
// classification, industries, ...) almost never matches. Each chunk yields to the event loop,
// so it was never a true infinite loop, but at production scale (tens of millions of rows) a
// rare combination could still mean tens of thousands of chunks -- confirmed directly against
// the live database: one such request degraded the API to the point of not responding to
// SIGTERM for 90+ seconds, twice, needing a hard kill. MAX_WIDE_SCAN_CANDIDATE_ROWS (see
// postings.js) caps total candidates scanned per request; this pins that cap actually stops
// the walk early (scan_bounded: true) without disturbing ordinary queries that converge well
// within it (scan_bounded: false).
//
// A small cap is set via POSTINGS_WIDE_SCAN_MAX_CANDIDATES before postings.js is first
// required below, since the module reads it once at load time.
process.env.POSTINGS_WIDE_SCAN_MAX_CANDIDATES = "100";

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openpostings-wide-scan-bound-"));
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

// More than one chunk's worth (chunk size floors at 250) of postings that all fail the
// JS-only review_queue=new freshness check -- none of them are fresh, and none of them are
// findable within the 100-row cap, so the walk must give up early rather than exhaust all 300.
async function testWideScanStopsEarlyAndReportsBounded() {
  await withDb(async (db) => {
    await seedStaleWaPostings(db, 300);
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
      "the walk scanned past MAX_WIDE_SCAN_CANDIDATE_ROWS without finding a full page and must say so"
    );
  });
}

// A handful of postings, well within the cap, where matches genuinely exist and are found in
// the first chunk -- scan_bounded must read false here, not just be a permanently-stuck true.
async function testWideScanReportsNotBoundedWhenItConverges() {
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
    assert.strictEqual(result.scan_bounded, false);
  });
}

// A request that never needs the wide-scan walk at all (no search/structured filters/review
// queue/match join) must not carry scan_bounded -- existing callers must see no shape change.
async function testScanBoundedIsAbsentWithoutAWideScan() {
  await withDb(async (db) => {
    await seedOneFreshWaPosting(db, "https://x/plain");
    const result = await listPostingsWithFilters({ limit: 10, offset: 0 });
    assert.strictEqual(
      Object.prototype.hasOwnProperty.call(result, "scan_bounded"),
      false,
      "a plain, unfiltered listing must not gain a new field"
    );
  });
}

async function main() {
  await testWideScanStopsEarlyAndReportsBounded();
  await testWideScanReportsNotBoundedWhenItConverges();
  await testScanBoundedIsAbsentWithoutAWideScan();
  console.log("posting-wide-scan-bound tests passed");
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = { main };
