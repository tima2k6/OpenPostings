// The entire premise of this index is that it returns *exactly* what the current search
// returns, only fast. Measured on the live database, the obvious alternative -- reusing
// postings_fts -- would have lost 13.5-38.5% of the results a query returns today, because
// postings_fts is porter-stemmed and does not index location at all. So the cases that matter
// most here are the equivalence cases: for every term of 3+ characters, a trigram MATCH must
// select the same rows as `company.includes(term) || position.includes(term) ||
// location.includes(term)`.
//
// The second group covers the maintenance properties postings_fts could not have, because it
// is an external content table and this one is not: rows can be deleted when a posting is
// hidden, and re-indexed when a field changes underneath (the description backfill rewrites
// `location` in place, and a stale entry means a posting silently stops matching).
const assert = require("node:assert");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");

const { getDb, setDb } = require("../services/runtime-context.js");
const {
  buildSearchIndex,
  refreshSearchIndex,
  findSearchCandidateIds,
  canUseTrigramSearch,
  buildTrigramMatchExpression,
  SEARCH_FTS_TABLE
} = require("../services/search-index.js");

const ROWS = [
  { id: 1, company_name: "Acme Corp", position_name: "Senior Engineer", location: "Boston, MA" },
  { id: 2, company_name: "Globex", position_name: "Registered Nurse", location: "Austin, TX" },
  { id: 3, company_name: "Initech", position_name: "Data Scientist", location: "Boston, MA" },
  { id: 4, company_name: "Boston Dynamics", position_name: "Robotics Lead", location: "Waltham" },
  { id: 5, company_name: "Umbrella", position_name: "Nursing Assistant", location: "Remote" }
];

async function withDb(run) {
  const previousDb = getDb();
  const db = await open({ filename: ":memory:", driver: sqlite3.Database });
  try {
    setDb(db);
    await db.exec(`
      CREATE TABLE Postings (
        id INTEGER PRIMARY KEY,
        company_name TEXT,
        position_name TEXT,
        location TEXT,
        hidden INTEGER NOT NULL DEFAULT 0
      );
    `);
    for (const row of ROWS) {
      await db.run(
        `INSERT INTO Postings (id, company_name, position_name, location) VALUES (?, ?, ?, ?);`,
        [row.id, row.company_name, row.position_name, row.location]
      );
    }
    await run(db);
  } finally {
    setDb(previousDb);
    await db.close();
  }
}

// The behaviour the index has to reproduce, written out plainly.
function likeSemantics(rows, terms) {
  return rows
    .filter((row) =>
      terms.every((term) => {
        const t = term.toLowerCase();
        return (
          String(row.company_name || "").toLowerCase().includes(t) ||
          String(row.position_name || "").toLowerCase().includes(t) ||
          String(row.location || "").toLowerCase().includes(t)
        );
      })
    )
    .map((row) => row.id);
}

async function testMatchesLikeSemanticsExactly() {
  await withDb(async () => {
    await buildSearchIndex({ rebuild: true, batch_size: 2, max_batches: 100 });

    const queries = [
      ["boston"], // matches via location AND via company name
      ["nurse"], // "Registered Nurse" and, as an infix, "Nursing Assistant"
      ["gineer"], // infix -- the case a stemmed index cannot do
      ["eng"], // short prefix, still 3 chars
      ["acme"],
      ["remote"],
      ["boston", "engineer"], // multi-term AND across different fields
      ["nurse", "austin"],
      ["zzzznope"]
    ];

    for (const terms of queries) {
      const expected = likeSemantics(ROWS, terms).sort((a, b) => a - b);
      const result = await findSearchCandidateIds(terms);
      assert.ok(result, `index should answer for ${JSON.stringify(terms)}`);
      const actual = [...result.ids].sort((a, b) => a - b);
      assert.deepStrictEqual(
        actual,
        expected,
        `trigram result must equal LIKE semantics for ${JSON.stringify(terms)}`
      );
    }
  });
}

async function testShortTermsFallBackRatherThanReturningWrongResults() {
  await withDb(async () => {
    await buildSearchIndex({ rebuild: true, batch_size: 10, max_batches: 10 });

    // Trigram cannot represent a 1-2 character term. Returning [] here would silently show
    // the user an empty result set for a valid search, so the contract is to return null and
    // let the caller keep the LIKE path.
    assert.strictEqual(canUseTrigramSearch(["ma"]), false);
    assert.strictEqual(canUseTrigramSearch(["a"]), false);
    assert.strictEqual(canUseTrigramSearch(["boston", "ma"]), false, "one short term disqualifies");
    assert.strictEqual(canUseTrigramSearch(["boston"]), true);

    assert.strictEqual(await findSearchCandidateIds(["ma"]), null);
    assert.strictEqual(await findSearchCandidateIds([]), null);
  });
}

async function testHiddenPostingsAreNotIndexedAndArePrunedLater() {
  await withDb(async (db) => {
    await buildSearchIndex({ rebuild: true, batch_size: 10, max_batches: 10 });
    let result = await findSearchCandidateIds(["boston"]);
    assert.deepStrictEqual(result.ids.sort((a, b) => a - b), [1, 3, 4]);

    // A posting is hidden after it was indexed. This is exactly how postings_fts filled up
    // with ~1.39M unreachable documents.
    await db.run(`UPDATE Postings SET hidden = 1 WHERE id = 3;`);

    const sweep = await refreshSearchIndex({ batch_size: 10, max_batches: 10 });
    assert.strictEqual(sweep.pruned, 1, "the hidden posting must be removed from the index");

    result = await findSearchCandidateIds(["boston"]);
    assert.deepStrictEqual(result.ids.sort((a, b) => a - b), [1, 4]);
  });
}

// The description backfill rewrites `location` in place. A forward-only index would keep the
// old value and the posting would stop matching a search it should match -- the same class of
// silent loss the semantic index's gap scan exists to fix.
async function testRefreshPicksUpAChangedLocation() {
  await withDb(async (db) => {
    await buildSearchIndex({ rebuild: true, batch_size: 10, max_batches: 10 });
    assert.deepStrictEqual((await findSearchCandidateIds(["austin"])).ids, [2]);

    await db.run(`UPDATE Postings SET location = ? WHERE id = 2;`, ["Denver, CO"]);

    // Stale until the sweep runs.
    assert.deepStrictEqual((await findSearchCandidateIds(["denver"])).ids, []);

    await refreshSearchIndex({ batch_size: 10, max_batches: 10 });

    assert.deepStrictEqual((await findSearchCandidateIds(["denver"])).ids, [2]);
    assert.deepStrictEqual((await findSearchCandidateIds(["austin"])).ids, [], "old value gone");
  });
}

async function testNoDuplicateDocumentsAcrossRepeatedRuns() {
  await withDb(async (db) => {
    await buildSearchIndex({ rebuild: true, batch_size: 2, max_batches: 100 });
    for (let i = 0; i < 3; i += 1) await refreshSearchIndex({ batch_size: 2, max_batches: 100 });

    // FTS5 does not enforce rowid uniqueness; a bare INSERT on re-index would duplicate rows
    // and each duplicate would be returned again by MATCH.
    const rows = await db.all(
      `SELECT rowid AS id FROM ${SEARCH_FTS_TABLE} WHERE ${SEARCH_FTS_TABLE} MATCH ?;`,
      ["boston"]
    );
    const ids = rows.map((r) => r.id);
    assert.strictEqual(ids.length, new Set(ids).size, "no duplicate documents");
  });
}

// User input reaches FTS5 as query syntax. Without quoting, a stray quote or a bare boolean
// keyword is a syntax error and the endpoint 500s on an ordinary search.
async function testHostileInputIsQuotedNotExecuted() {
  await withDb(async () => {
    await buildSearchIndex({ rebuild: true, batch_size: 10, max_batches: 10 });

    assert.strictEqual(buildTrigramMatchExpression(['say "hi"']), '"say ""hi"""');

    for (const terms of [['acme"'], ["AND"], ["OR NOT"], ["foo*"], ["(bar"], ["a b c"]]) {
      const result = await findSearchCandidateIds(terms);
      assert.ok(result, `must not throw for ${JSON.stringify(terms)}`);
      assert.ok(Array.isArray(result.ids));
    }
  });
}

async function run() {
  await testMatchesLikeSemanticsExactly();
  await testShortTermsFallBackRatherThanReturningWrongResults();
  await testHiddenPostingsAreNotIndexedAndArePrunedLater();
  await testRefreshPicksUpAChangedLocation();
  await testNoDuplicateDocumentsAcrossRepeatedRuns();
  await testHostileInputIsQuotedNotExecuted();
  console.log("search index tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
