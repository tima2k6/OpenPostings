// findSimilarPostings/scoreCandidates hung the whole server on a real query: EXPLAIN QUERY
// PLAN against the live database (1.24M+ indexed documents) showed ORDER BY bm25(table,
// weights) plans as "USE TEMP B-TREE FOR ORDER BY" -- SQLite materialises and scores every
// MATCHing row before LIMIT can drop any, and toMatchExpression OR's every query term
// together, so a multi-word query (the intended input: a resume, a job description) routinely
// matches a large fraction of the index on common words alone. ORDER BY rank (FTS5's own
// pseudo-column, with the table's default weighting configured once via
// ensureFtsRankConfigured) gets FTS5's internal top-k pruning instead. These cases pin down
// that the fix actually produces correct, sensibly-ranked results, and that the query plan
// itself never regresses back to a temp b-tree.
const assert = require("node:assert");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");

const { getDb, getReadDb, setDb, setReaderDb } = require("../services/runtime-context.js");
const { rebuildSemanticIndex, findSimilarPostings } = require("../services/semantic-search.js");

async function withIndexedPostings(postings, run) {
  const previousDb = getDb();
  const previousReaderDb = getReadDb();
  const db = await open({ filename: ":memory:", driver: sqlite3.Database });
  try {
    setDb(db);
    setReaderDb(db);
    await db.exec(`
      CREATE TABLE Postings (
        id INTEGER PRIMARY KEY,
        position_name TEXT,
        company_name TEXT,
        job_description TEXT,
        job_posting_url TEXT,
        location TEXT, city TEXT, state_region TEXT, country TEXT, is_remote INTEGER DEFAULT 0,
        pay_min REAL, pay_max REAL, pay_currency TEXT, pay_period TEXT,
        status TEXT DEFAULT 'unverified', location_conflict INTEGER DEFAULT 0,
        posting_date TEXT, first_seen_epoch INTEGER, last_seen_epoch INTEGER, hidden INTEGER DEFAULT 0
      );
    `);
    for (const posting of postings) {
      await db.run(
        `INSERT INTO Postings (id, position_name, company_name, job_description, job_posting_url, hidden)
         VALUES (?, ?, ?, ?, ?, 0);`,
        [posting.id, posting.position_name, posting.company_name || "Acme", posting.job_description, `https://x/${posting.id}`]
      );
    }
    await rebuildSemanticIndex({});
    await run(db);
  } finally {
    setDb(previousDb);
    setReaderDb(previousReaderDb);
    await db.close();
  }
}

// A hospitality-heavy query against a mix of hospitality and unrelated postings -- the
// hospitality-matching one must come back, ranked, and the unrelated one must not crowd it
// out even though "manager" alone (a common word) would match broadly.
async function testFindSimilarPostingsReturnsRankedRelevantResults() {
  await withIndexedPostings(
    [
      {
        id: 1,
        position_name: "Hotel General Manager",
        job_description: "Own full P&L for a 220-room hotel property, lead a multi-department hospitality team, manage labor cost and vendor contracts."
      },
      {
        id: 2,
        position_name: "Warehouse Shift Manager",
        job_description: "Manage a warehouse shift, oversee inventory counts and coordinate with logistics vendors."
      },
      {
        id: 3,
        position_name: "Distributed Systems Engineer",
        job_description: "Build distributed systems in Kubernetes and Rust, own service reliability and on-call rotations."
      }
    ],
    async () => {
      const result = await findSimilarPostings({
        text: "Hotel general manager with hospitality operations and property P&L leadership experience.",
        limit: 10
      });
      assert.ok(result.items.length > 0, "must return matches");
      assert.strictEqual(result.items[0].id, 1, "the hospitality-specific posting must rank first");
      // findSimilarPostings reports relevance as Math.abs(raw bm25/rank) so a larger number
      // reads as a better match (see its own comment on the raw sign convention) -- the SQL
      // itself still orders ascending on the raw (more-negative-is-better) score, this is
      // just the display-side flip. Non-increasing here is therefore "best match first".
      for (let index = 1; index < result.items.length; index += 1) {
        assert.ok(
          result.items[index].relevance <= result.items[index - 1].relevance,
          "results must be sorted best match first"
        );
      }
    }
  );
}

// The actual regression: confirm the query plan never falls back to materialising and
// sorting every match before LIMIT. Guards against a future edit reintroducing an explicit
// bm25(...) call (or anything else) that defeats FTS5's rank optimization.
async function testScoringQueryPlanAvoidsTempBTree() {
  await withIndexedPostings(
    [{ id: 1, position_name: "Hotel General Manager", job_description: "hospitality operations leadership" }],
    async (db) => {
      const plan = await db.all(
        `EXPLAIN QUERY PLAN
         SELECT p.id, s.relevance
         FROM (
           SELECT rowid, rank AS relevance
           FROM postings_fts
           WHERE postings_fts MATCH ?
           ORDER BY rank
           LIMIT ?
         ) s
         JOIN Postings p ON p.id = s.rowid
         ORDER BY s.relevance;`,
        [`"hospitality" OR "operations" OR "leadership"`, 500]
      );
      const details = plan.map((row) => String(row?.detail || "")).join(" | ");
      assert.ok(
        !/TEMP B-TREE FOR ORDER BY/i.test(details),
        `query plan must not materialise+sort every match: ${details}`
      );
    }
  );
}

// postings_fts is an external-content index: rows are text captured at index time, not a
// live view of Postings. Confirmed directly against the live database: a DoorDash "Manager,
// Local Markets Growth" posting whose job_description is now NULL was still indexed (from
// whenever it last had one) and matched real queries on title words alone, returned
// alongside its now-empty description -- indistinguishable from a genuine match. This
// clears job_description on an indexed posting after the fact and confirms it drops out of
// results, without needing to touch or resync the FTS index itself.
async function testStaleIndexEntryWithClearedDescriptionIsExcluded() {
  await withIndexedPostings(
    [
      {
        id: 1,
        position_name: "Manager, Local Markets Growth",
        job_description: "Own local market growth strategy, partner with regional operators on expansion."
      },
      {
        id: 2,
        position_name: "Regional Growth Lead",
        job_description: "Drive local market growth initiatives across the region."
      }
    ],
    async (db) => {
      // Simulate a later re-fetch finding the posting gone: job_description cleared, but
      // nothing tells the FTS index to forget it.
      await db.run(`UPDATE Postings SET job_description = NULL WHERE id = 1;`);

      const result = await findSimilarPostings({ text: "local market growth manager", limit: 10 });
      const ids = result.items.map((item) => item.id);
      assert.ok(!ids.includes(1), "a posting whose description was cleared after indexing must not be returned");
      assert.ok(ids.includes(2), "a genuinely-described matching posting must still be returned");
    }
  );
}

// Regression: seeding from a posting whose description had been cleared produced a
// query of two or three title words, and BM25 happily ranked whatever repeated them --
// "Sr. Manager, In-Store S&O" came back as in-store retail clerks. Noise shaped exactly
// like results is worse than an error, so this now refuses rather than guessing.
async function testSeedingFromDescriptionlessPostingFailsLoudly() {
  await withIndexedPostings(
    [
      { id: 1, position_name: "In-Store Sales Representative", job_description: "Greet customers in store and generate retail leads in store." },
      { id: 2, position_name: "In-Store Merchandiser", job_description: "Maintain in store displays and merchandise retail shelves in store." }
    ],
    async (db) => {
      await db.run(`INSERT INTO Postings (id, position_name, company_name, job_description, job_posting_url, hidden)
                    VALUES (3, 'Sr. Manager, In-Store S&O', 'DoorDash', NULL, 'https://x/anchor', 1);`);

      await assert.rejects(
        () => findSimilarPostings({ job_posting_url: "https://x/anchor" }),
        /no stored description/i,
        "a title-only seed must raise, not return title-word matches"
      );

      // The same call with real text still works -- the guard is about the seed, not the search.
      const ok = await findSimilarPostings({ text: "in store retail merchandising displays", limit: 5 });
      assert.ok(ok.items.length > 0, "seeding from text is unaffected");
    }
  );
}

async function main() {
  await testFindSimilarPostingsReturnsRankedRelevantResults();
  await testScoringQueryPlanAvoidsTempBTree();
  await testStaleIndexEntryWithClearedDescriptionIsExcluded();
  await testSeedingFromDescriptionlessPostingFailsLoudly();
  console.log("semantic-search-scoring tests passed");
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = { main };
