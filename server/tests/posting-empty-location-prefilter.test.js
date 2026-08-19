// The candidate prefilter used to keep every row with an empty stored location, on the
// grounds that its real location might come from somewhere SQL cannot see. That was true but
// far too broad: 160,383 of 1,039,785 visible+fresh rows have no stored location, and all of
// them were dragged through the JS filter on every single search.
//
// What the JS filter actually compares against is `storedLocation || mappedLocation ||
// inferredLocation` (enrichRowForFiltering). For an empty stored location the other two
// collapse to a knowable set: inferPostingLocationFromJobUrl parses the URL only for
// myworkdayjobs.com, and otherwise returns postingLocationByJobUrl.get(url) -- the same
// in-memory map mappedLocation reads. So the prefilter now keeps an empty-location row only
// when its URL is in that map or it is a Workday URL.
//
// The whole risk of that change is losing a posting whose location is known only at runtime,
// which is precisely what this pins.
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
const TODAY = new Date(NOW * 1000).toISOString().slice(0, 10);

const MAPPED_URL = "https://jobs.lever.co/acme/runtime-known";
const UNMAPPED_URL = "https://jobs.lever.co/acme/never-known";
const WORKDAY_URL = "https://acme.wd1.myworkdayjobs.com/en-US/careers/job/Seattle/Engineer_R-1";

async function insertPosting(db, { company, position, url, location }) {
  await db.run(
    `INSERT INTO Postings
       (company_name, position_name, job_posting_url, location, posting_date,
        first_seen_epoch, last_seen_epoch, hidden)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
    [company, position, url, location, TODAY, NOW - 60, NOW - 60]
  );
}

async function withDb(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openpostings-empty-location-"));
  setDb(await openDatabase({ filename: path.join(dir, "test.db") }));
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
    setPostingLocationByJobUrl(new Map());
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// The row this change could have broken: no stored location, and the only thing that makes it
// a Seattle posting is the runtime map. It has to survive the prefilter and come back.
async function testRuntimeMappedLocationIsStillFound() {
  await withDb(async (db) => {
    await insertPosting(db, { company: "Acme", position: "Engineer", url: MAPPED_URL, location: "" });
    setPostingLocationByJobUrl(new Map([[MAPPED_URL, "Seattle, WA"]]));

    const result = await listPostingsWithFilters({ search: "seattle", limit: 50, offset: 0 });
    assert.strictEqual(result.items.length, 1, "a posting located only via the runtime map must still be found");
    assert.strictEqual(result.items[0].job_posting_url, MAPPED_URL);
  });
}

// The rows the change is meant to shed. They were never returned -- their enriched location is
// "" -- they were only ever dragged through the JS filter. Behaviour must be identical.
async function testUnmappedEmptyLocationStillDoesNotMatch() {
  await withDb(async (db) => {
    await insertPosting(db, { company: "Acme", position: "Engineer", url: UNMAPPED_URL, location: "" });
    setPostingLocationByJobUrl(new Map());

    const result = await listPostingsWithFilters({ search: "seattle", limit: 50, offset: 0 });
    assert.strictEqual(result.items.length, 0, "an empty-location posting with no known location must not match a place");
  });
}

// Workday is the one host whose location really is parsed out of the URL, so those rows stay
// candidates regardless of the map.
async function testWorkdayUrlLocationIsStillFound() {
  await withDb(async (db) => {
    await insertPosting(db, { company: "Acme", position: "Engineer", url: WORKDAY_URL, location: "" });
    setPostingLocationByJobUrl(new Map());

    const result = await listPostingsWithFilters({ search: "seattle", limit: 50, offset: 0 });
    assert.strictEqual(result.items.length, 1, "a Workday posting's URL-parsed location must still be searchable");
    assert.strictEqual(result.items[0].job_posting_url, WORKDAY_URL);
  });
}

// A search that matches on company or title must be unaffected by any of this.
async function testNonLocationSearchIsUnaffected() {
  await withDb(async (db) => {
    await insertPosting(db, { company: "Acme", position: "Kubernetes Engineer", url: UNMAPPED_URL, location: "" });
    setPostingLocationByJobUrl(new Map());

    const result = await listPostingsWithFilters({ search: "kubernetes", limit: 50, offset: 0 });
    assert.strictEqual(result.items.length, 1, "a title match must not depend on the location clause");
  });
}

async function main() {
  await testRuntimeMappedLocationIsStillFound();
  await testUnmappedEmptyLocationStillDoesNotMatch();
  await testWorkdayUrlLocationIsStillFound();
  await testNonLocationSearchIsUnaffected();
  console.log("posting-empty-location-prefilter tests passed");
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = { main };
