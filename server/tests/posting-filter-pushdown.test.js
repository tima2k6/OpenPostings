// The filtered listing branch narrows candidates in SQL before the JS filters run. That
// pre-filter is only safe while it stays a superset of what JS would keep: too broad only
// costs speed, too narrow silently drops postings from results. These cases cover the
// edges where "too narrow" is easy to introduce -- LIKE metacharacters in a search term,
// postings whose location is not in the stored column, and one-sided pay ranges.
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { openDatabase } = require("../db/open-database.js");
const { setDb, getDb, setPostingLocationByJobUrl } = require("../services/runtime-context.js");
const { createCanonicalPostingsTable } = require("../services/sync-runtime.js");
const { listPostingsWithFilters, buildCandidatePrefilter } = require("../services/postings.js");

const NOW = Math.floor(Date.now() / 1000);

async function seed(db, postings) {
  for (const posting of postings) {
    await db.run(
      `INSERT INTO Postings
         (company_name, position_name, job_posting_url, location, posting_date,
          compensation_type, pay_min, pay_max, pay_period, education_levels,
          first_seen_epoch, last_seen_epoch, hidden)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0)`,
      [
        posting.company || "Acme",
        posting.position || "Engineer",
        posting.url,
        posting.location === undefined ? null : posting.location,
        posting.postingDate || null,
        posting.compensationType || null,
        posting.payMin ?? null,
        posting.payMax ?? null,
        posting.payPeriod || null,
        posting.education || null,
        NOW - 60,
        NOW - 60
      ]
    );
  }
}

async function withDb(postings, run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openpostings-pushdown-"));
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
      CREATE TABLE IF NOT EXISTS job_industry_categories (
        id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, industry_key TEXT NOT NULL UNIQUE,
        industry_label TEXT NOT NULL, priority INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')));
      CREATE TABLE IF NOT EXISTS job_position_industry (
        id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, job_title TEXT NOT NULL,
        normalized_job_title TEXT NOT NULL UNIQUE, industry_key TEXT NOT NULL,
        industry_label TEXT NOT NULL, matched_rules TEXT NOT NULL,
        confidence_score REAL NOT NULL, rule_version TEXT NOT NULL DEFAULT 'v4',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')));
    `);
    await seed(db, postings);
    await run(db);
  } finally {
    setDb(null);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const urlsOf = (result) => result.items.map((item) => item.job_posting_url).sort();

// Asserted against the generated SQL rather than against results: because the JS filter
// runs afterwards and decides, unescaped metacharacters produce correct output either way.
// The only observable symptom is the pre-filter matching everything, so the escaping has
// to be checked where it happens.
function testLikeMetacharactersAreEscapedInGeneratedSql() {
  const percent = buildCandidatePrefilter({ searchTerms: ["100%"], payPeriods: [] });
  assert.ok(percent.sql.includes("ESCAPE '\\'"), "LIKE clauses must declare an escape character");
  assert.deepStrictEqual(
    percent.params,
    ["%100\\%%", "%100\\%%", "%100\\%%"],
    "a literal % in a search term must be escaped, or the clause matches every posting"
  );

  const underscore = buildCandidatePrefilter({ searchTerms: ["a_b"], payPeriods: [] });
  assert.deepStrictEqual(underscore.params, ["%a\\_b%", "%a\\_b%", "%a\\_b%"]);

  const backslash = buildCandidatePrefilter({ searchTerms: ["c\\d"], payPeriods: [] });
  assert.deepStrictEqual(backslash.params, ["%c\\\\d%", "%c\\\\d%", "%c\\\\d%"]);

  // No filters set means no clauses: the branch must not pay for an empty pre-filter.
  const empty = buildCandidatePrefilter({ searchTerms: [], payPeriods: [] });
  assert.strictEqual(empty.sql, "");
  assert.deepStrictEqual(empty.params, []);
}

async function testLikeMetacharactersInSearchAreLiteral() {
  await withDb(
    [
      { url: "https://x/a", position: "100% Remote Engineer" },
      { url: "https://x/b", position: "Regular Engineer" },
      { url: "https://x/c", position: "Under_score Engineer" },
      { url: "https://x/d", position: "Underscore Engineer" }
    ],
    async () => {
      // Unescaped, "%" and "_" are LIKE wildcards and would drag in every other row.
      const percent = await listPostingsWithFilters({ search: "100%" });
      assert.deepStrictEqual(urlsOf(percent), ["https://x/a"], "% must be matched literally");

      const underscore = await listPostingsWithFilters({ search: "under_score" });
      assert.deepStrictEqual(urlsOf(underscore), ["https://x/c"], "_ must be matched literally");

      const backslash = await listPostingsWithFilters({ search: "\\" });
      assert.deepStrictEqual(urlsOf(backslash), [], "a lone backslash must not break the query");
    }
  );
}

async function testSearchMatchesLocationOnlyKnownOutsideTheColumn() {
  // The stored column is empty, so the enriched location comes from the in-memory map.
  // The pre-filter cannot see that value and must keep the row as a candidate anyway.
  await withDb(
    [
      { url: "https://x/mapped", position: "Engineer", location: null },
      { url: "https://x/other", position: "Engineer", location: "Denver, CO" }
    ],
    async () => {
      setPostingLocationByJobUrl(new Map([["https://x/mapped", "Reykjavik, Iceland"]]));
      const result = await listPostingsWithFilters({ search: "reykjavik" });
      assert.deepStrictEqual(
        urlsOf(result),
        ["https://x/mapped"],
        "a posting whose location is only in the runtime map must still be findable"
      );
    }
  );
}

async function testSearchMatchesStoredLocation() {
  await withDb(
    [
      { url: "https://x/austin", position: "Engineer", location: "Austin, TX" },
      { url: "https://x/denver", position: "Engineer", location: "Denver, CO" }
    ],
    async () => {
      const result = await listPostingsWithFilters({ search: "austin" });
      assert.deepStrictEqual(urlsOf(result), ["https://x/austin"]);
    }
  );
}

async function testMultiTermSearchRequiresEveryTerm() {
  await withDb(
    [
      { url: "https://x/both", company: "Globex", position: "Senior Engineer" },
      { url: "https://x/one", company: "Initech", position: "Senior Analyst" }
    ],
    async () => {
      const result = await listPostingsWithFilters({ search: "senior engineer" });
      assert.deepStrictEqual(urlsOf(result), ["https://x/both"]);
    }
  );
}

async function testPayRangeBoundaries() {
  await withDb(
    [
      { url: "https://x/min-only", payMin: 100000, payPeriod: "year" },
      { url: "https://x/max-only", payMax: 80000, payPeriod: "year" },
      { url: "https://x/both", payMin: 90000, payMax: 120000, payPeriod: "year" },
      { url: "https://x/zero", payMin: 0, payMax: 0, payPeriod: "year" },
      { url: "https://x/none" }
    ],
    async () => {
      // rowUpper falls back to pay_min, so min-only sits at exactly 100000.
      const atBoundary = await listPostingsWithFilters({ pay_min: 100000 });
      assert.deepStrictEqual(
        urlsOf(atBoundary),
        ["https://x/both", "https://x/min-only"],
        "boundary must be inclusive and one-sided rows must not be lost"
      );

      const aboveBoundary = await listPostingsWithFilters({ pay_min: 100001 });
      assert.deepStrictEqual(urlsOf(aboveBoundary), ["https://x/both"]);

      // rowLower falls back to pay_max for the max-only row.
      const capped = await listPostingsWithFilters({ pay_max: 80000 });
      assert.deepStrictEqual(urlsOf(capped), ["https://x/max-only"]);

      const banded = await listPostingsWithFilters({ pay_min: 85000, pay_max: 95000 });
      assert.deepStrictEqual(urlsOf(banded), ["https://x/both"]);
    }
  );
}

async function testPayPeriodFilterKeepsOnlyPeriodedRows() {
  await withDb(
    [
      { url: "https://x/yearly", payMin: 100000, payPeriod: "year" },
      { url: "https://x/hourly", payMin: 50, payPeriod: "hour" },
      { url: "https://x/blank", payMin: 100000, payPeriod: null }
    ],
    async () => {
      const result = await listPostingsWithFilters({ pay_periods: ["year"] });
      assert.deepStrictEqual(urlsOf(result), ["https://x/yearly"]);
    }
  );
}

async function testUnfilteredListingIsUnaffected() {
  await withDb(
    [
      { url: "https://x/a", position: "Engineer" },
      { url: "https://x/b", position: "Analyst" }
    ],
    async () => {
      const result = await listPostingsWithFilters({});
      assert.strictEqual(result.count, 2);
      // The display fields are built after the page is cut; they still have to be present.
      for (const item of result.items) {
        assert.ok(item.posting_date, "posting_date label must be populated on returned rows");
        assert.ok("pay_currency" in item, "pay_currency must be present on returned rows");
        assert.ok("pay_raw" in item, "pay_raw must be present on returned rows");
        assert.ok(!("_has_real_source_posting_date" in item), "internal flag must not leak");
      }
    }
  );
}

async function testFilteredRowsCarryDisplayFields() {
  await withDb([{ url: "https://x/a", position: "Engineer", location: "Austin, TX" }], async () => {
    const result = await listPostingsWithFilters({ search: "engineer" });
    assert.strictEqual(result.count, 1);
    const [item] = result.items;
    assert.ok(item.posting_date, "deferred date label must still be built for filtered results");
    assert.ok("pay_currency" in item);
    assert.ok(!("_has_real_source_posting_date" in item));
  });
}

async function main() {
  testLikeMetacharactersAreEscapedInGeneratedSql();
  await testLikeMetacharactersInSearchAreLiteral();
  await testSearchMatchesLocationOnlyKnownOutsideTheColumn();
  await testSearchMatchesStoredLocation();
  await testMultiTermSearchRequiresEveryTerm();
  await testPayRangeBoundaries();
  await testPayPeriodFilterKeepsOnlyPeriodedRows();
  await testUnfilteredListingIsUnaffected();
  await testFilteredRowsCarryDisplayFields();
  console.log("posting-filter-pushdown tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
