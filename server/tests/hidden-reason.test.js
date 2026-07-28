// Why a posting is hidden, not just that it is.
//
// Two unrelated pruners set hidden = 1. One hides postings the ATS has stopped listing;
// the other hides postings whose posting_date is older than the freshness window. Only the
// first is actually gone -- the second is still open and still applyable, which is exactly
// the confusion that prompted this: a DoorDash role live on the board, hidden for being 22
// days old, looked identical to one that had been taken down. These cases exist to keep
// the two states distinguishable.
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "openpostings-hidden-"));
process.env.DB_PATH = path.join(fixtureDir, "test.db");

const { openDatabase } = require("../db/open-database.js");
const { setDb, getDb, setPostingLocationByJobUrl } = require("../services/runtime-context.js");
const {
  createCanonicalPostingsTable,
  upsertPostingsBatch,
  pruneExpiredPostings
} = require("../services/sync-runtime.js");
const { listPostingsWithFilters } = require("../services/postings.js");

const NOW = Math.floor(Date.now() / 1000);
const DAY = 86400;

async function setup() {
  setDb(await openDatabase({ filename: process.env.DB_PATH }));
  setPostingLocationByJobUrl(new Map());
  await createCanonicalPostingsTable();
  const db = getDb();
  await db.exec(`
    CREATE TABLE IF NOT EXISTS companies (
      id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      company_name TEXT NOT NULL, url_string TEXT NOT NULL, ATS_name TEXT NOT NULL);
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
  `);
}

async function seed() {
  const db = getDb();
  await upsertPostingsBatch(
    [
      { company_name: "live", position_name: "Ops Manager", job_posting_url: "https://x/live", location: "Seattle, WA" },
      { company_name: "old", position_name: "Ops Manager", job_posting_url: "https://x/old", location: "Seattle, WA" },
      { company_name: "gone", position_name: "Ops Manager", job_posting_url: "https://x/gone", location: "Seattle, WA" }
    ],
    NOW
  );

  // "gone" was last seen long ago -- the ATS has stopped listing it.
  await db.run(`UPDATE Postings SET last_seen_epoch = ? WHERE job_posting_url = 'https://x/gone';`, [NOW - 60 * DAY]);
  await pruneExpiredPostings(NOW);

  // "old" is still being listed (recent last_seen) but its posting_date is out of window.
  // Applied directly rather than through the date pruner so the fixture does not depend on
  // the configured window length.
  await db.run(
    `UPDATE Postings
     SET hidden = 1, hidden_at_epoch = ?, hidden_reason = 'outside_date_window'
     WHERE job_posting_url = 'https://x/old';`,
    [NOW]
  );
}

async function testReasonsAreRecordedDistinctly() {
  const db = getDb();
  const rows = await db.all(`SELECT job_posting_url, hidden, hidden_reason FROM Postings ORDER BY job_posting_url;`);
  const byUrl = Object.fromEntries(rows.map((row) => [row.job_posting_url, row]));

  assert.strictEqual(byUrl["https://x/live"].hidden, 0);
  assert.strictEqual(byUrl["https://x/live"].hidden_reason, "", "a visible posting carries no reason");

  assert.strictEqual(byUrl["https://x/gone"].hidden, 1);
  assert.strictEqual(
    byUrl["https://x/gone"].hidden_reason,
    "delisted",
    "the staleness pruner must record that the ATS stopped listing it"
  );

  assert.strictEqual(byUrl["https://x/old"].hidden, 1);
  assert.strictEqual(byUrl["https://x/old"].hidden_reason, "outside_date_window");
}

async function testStaleDatedIsOptInButReachable() {
  // Default listing: neither hidden posting appears.
  const base = await listPostingsWithFilters({ limit: 50 });
  assert.deepStrictEqual(
    base.items.map((item) => item.job_posting_url),
    ["https://x/live"],
    "hidden postings stay out of the default listing"
  );

  // Opting in brings back the still-listed-but-old one, and only that one. A delisted
  // posting must never come back this way -- it cannot be applied to.
  const withStale = await listPostingsWithFilters({ limit: 50, include_stale_dated: true });
  const urls = withStale.items.map((item) => item.job_posting_url).sort();
  assert.deepStrictEqual(urls, ["https://x/live", "https://x/old"]);
  assert.ok(!urls.includes("https://x/gone"), "include_stale_dated must not resurrect delisted postings");

  // The reason travels with the row, so a caller can label it rather than guess.
  const stale = withStale.items.find((item) => item.job_posting_url === "https://x/old");
  assert.strictEqual(stale.hidden_reason, "outside_date_window");
  assert.strictEqual(stale.hidden, true);
  const live = withStale.items.find((item) => item.job_posting_url === "https://x/live");
  assert.strictEqual(live.hidden_reason, "");
}

async function testRevivalClearsTheReason() {
  // Seeing a posting again means it is open, whichever way it was hidden. The reason has
  // to be cleared with the flag, or a revived posting keeps claiming it was delisted.
  await upsertPostingsBatch(
    [{ company_name: "gone", position_name: "Ops Manager", job_posting_url: "https://x/gone", location: "Seattle, WA" }],
    NOW
  );
  const row = await getDb().get(`SELECT hidden, hidden_reason FROM Postings WHERE job_posting_url = 'https://x/gone';`);
  assert.strictEqual(row.hidden, 0);
  assert.strictEqual(row.hidden_reason, "", "a revived posting must not keep a stale reason");
}

async function main() {
  await setup();
  await seed();
  await testReasonsAreRecordedDistinctly();
  await testStaleDatedIsOptInButReachable();
  await testRevivalClearsTheReason();
  console.log("hidden-reason tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
