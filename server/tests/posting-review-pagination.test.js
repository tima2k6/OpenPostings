const assert = require("assert");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const { setDb, setPostingLocationByJobUrl } = require("../services/runtime-context.js");
const { createCanonicalPostingsTable, upsertPostingsBatch } = require("../services/sync-runtime.js");
const { ensurePostingReviewSchema, setPostingReviewState } = require("../services/posting-review.js");
const { listPostingsWithFilters } = require("../services/postings.js");

async function main() {
  const db = await open({ filename: ":memory:", driver: sqlite3.Database });
  setDb(db);
  setPostingLocationByJobUrl(new Map());
  await createCanonicalPostingsTable();
  await db.exec(`
    CREATE TABLE companies (
      id INTEGER PRIMARY KEY, company_name TEXT NOT NULL, url_string TEXT NOT NULL, ATS_name TEXT NOT NULL
    );
    CREATE TABLE blocked_companies (
      normalized_company_name TEXT PRIMARY KEY, company_name TEXT NOT NULL, blocked_at_epoch INTEGER NOT NULL
    );
    CREATE TABLE posting_application_state (
      job_posting_url TEXT PRIMARY KEY,
      applied INTEGER NOT NULL DEFAULT 0,
      applied_by_type TEXT NOT NULL DEFAULT 'manual',
      applied_by_label TEXT NOT NULL DEFAULT '',
      applied_at_epoch INTEGER,
      last_application_id INTEGER,
      ignored INTEGER NOT NULL DEFAULT 0,
      ignored_at_epoch INTEGER,
      ignored_by_label TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  await ensurePostingReviewSchema(db);

  const now = Math.floor(Date.now() / 1000);
  const postings = Array.from({ length: 6 }, (_, index) => ({
    company_name: `Company ${index}`,
    position_name: `Role ${index}`,
    job_posting_url: `https://example.com/${index}`,
    posting_date: "",
    location: "Remote"
  }));
  await upsertPostingsBatch(postings, now);
  await db.run(
    `UPDATE Postings SET hidden = 1, hidden_reason = 'delisted', status = 'dead' WHERE job_posting_url = ?;`,
    ["https://example.com/5"]
  );

  const first = await listPostingsWithFilters({ review_queue: "new", limit: 2, offset: 0, include_descriptions: false });
  const third = await listPostingsWithFilters({ review_queue: "new", limit: 2, offset: 2, include_descriptions: false });
  assert.strictEqual(first.items.length, 2);
  assert.strictEqual(third.items.length, 2, "offset pagination must reach beyond the first page");
  assert(first.items.every((item) => item.freshness.key === "newly_discovered"));
  assert(![...first.items, ...third.items].some((item) => item.job_posting_url === "https://example.com/5"));

  const viewedUrl = first.items[0].job_posting_url;
  await setPostingReviewState({ job_posting_url: viewedUrl, review_state: "viewed" });
  const refreshedNew = await listPostingsWithFilters({ review_queue: "new", limit: 10, include_descriptions: false });
  assert(!refreshedNew.items.some((item) => item.job_posting_url === viewedUrl), "viewed roles leave New");

  await setPostingReviewState({ job_posting_url: viewedUrl, review_state: "shortlisted", transition_epoch: now });
  await setPostingReviewState({ job_posting_url: viewedUrl, review_state: "shortlisted", transition_epoch: now + 10 });
  const shortlist = await listPostingsWithFilters({ review_queue: "shortlisted", limit: 10, include_descriptions: false });
  assert.strictEqual(shortlist.items.length, 1);
  assert.strictEqual(shortlist.items[0].review_state, "shortlisted");

  await db.close();
  console.log("posting-review-pagination tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
