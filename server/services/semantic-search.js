// Relevance search over posting descriptions, for the queries keyword filters structurally
// cannot express.
//
// The problem this exists for: title_any is a substring match on position_name, so a search
// anchored on operations-leadership titles never surfaces "Manager, Local Markets Growth"
// even though the role is a strong match on responsibilities. Cross-industry discovery
// needs to match on what the job *is*, not what it is called.
//
// Backend is SQLite's own FTS5 with BM25 ranking, over an external-content index (the text
// is not duplicated; the index references Postings by rowid). That choice is deliberate:
// this app runs offline and ships to Android and Windows through nodejs-mobile, so a cloud
// embeddings API would add a key requirement, a per-posting cost and a network dependency
// to a local-first tool, and a local transformer model would add hundreds of megabytes to
// a bundled app.
//
// What that buys and what it does not: BM25 over the full description ranks by weighted
// shared vocabulary, where rare terms count for more. A hotel GM resume speaking of P&L
// ownership, labor cost, vendor negotiation and multi-site teams therefore ranks a
// marketplace operations role highly on the substance of the text -- which is the
// cross-industry reach that matters here -- but it matches words, not meaning, so it will
// not connect two texts that describe the same work in entirely disjoint vocabulary. If a
// neural backend is ever wanted, `scoreCandidates` is the seam: replace it and leave the
// rest.
const { getDb } = require("./runtime-context.js");

const FTS_TABLE = "postings_fts";
const MAX_QUERY_TERMS = 60;

// Terms that appear in nearly every posting or resume carry no discriminating signal, and
// including them makes BM25 rank on document length instead of relevance.
const STOPWORDS = new Set([
  "the", "and", "for", "with", "you", "your", "our", "are", "will", "that", "this", "have",
  "has", "from", "not", "but", "all", "can", "who", "was", "were", "been", "their", "them",
  "they", "its", "it's", "into", "out", "about", "over", "under", "more", "most", "other",
  "such", "than", "then", "there", "these", "those", "some", "any", "each", "how", "what",
  "when", "where", "which", "while", "would", "should", "could", "may", "might", "must",
  "job", "jobs", "role", "roles", "position", "positions", "work", "working", "years",
  "year", "experience", "ability", "able", "including", "include", "includes", "required",
  "require", "requirements", "preferred", "responsibilities", "qualifications", "skills",
  "candidate", "candidates", "applicant", "applicants", "apply", "application", "employer",
  "employment", "company", "companies", "team", "teams", "new", "high", "strong", "well",
  "also", "one", "two", "three", "per", "via", "etc", "inc", "llc", "opportunity", "equal",
  "benefits", "salary", "full", "time", "part", "day", "days", "week", "month", "please",
  "resume", "email", "phone", "name", "address", "city", "state", "www", "http", "https",
  "com", "org", "net"
]);

function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s+#-]/g, " ")
    .split(/\s+/)
    .map((token) => token.replace(/^[-+#]+|[-+#]+$/g, ""))
    .filter((token) => token.length >= 3 && token.length <= 30 && !STOPWORDS.has(token) && !/^\d+$/.test(token));
}

// The query terms, most-repeated first. Repetition within the source text is the only
// signal available about which terms the author considers central, and BM25 supplies the
// corpus-side weighting (rare terms score higher) on the other end.
function buildQueryTerms(text) {
  const counts = new Map();
  for (const token of tokenize(text)) {
    counts.set(token, (counts.get(token) || 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, MAX_QUERY_TERMS)
    .map(([term]) => term);
}

// FTS5 treats bare terms as syntax (AND/OR/NOT/NEAR, column filters, prefixes), so every
// term is passed as a quoted string literal. Embedded quotes are doubled per FTS5's own
// escaping rule.
function toMatchExpression(terms) {
  return terms.map((term) => `"${term.replace(/"/g, '""')}"`).join(" OR ");
}

async function ftsIndexExists() {
  const db = getDb();
  const row = await db.get(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1;`,
    [FTS_TABLE]
  );
  return Boolean(row?.name);
}

// Progress is tracked here rather than read back off the index. An external-content FTS5
// table proxies unindexed queries like MAX(rowid) and COUNT(*) straight through to its
// content table, so asking the index how far it had got returned MAX(Postings.id) -- the
// whole table -- and the incremental build concluded it had nothing to do.
async function ensureIndexStateTable() {
  const db = getDb();
  await db.exec(`
    CREATE TABLE IF NOT EXISTS semantic_index_state (
      id INTEGER NOT NULL PRIMARY KEY CHECK (id = 1),
      last_indexed_id INTEGER NOT NULL DEFAULT 0,
      indexed_count INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO semantic_index_state (id, last_indexed_id, indexed_count)
    VALUES (1, 0, 0)
    ON CONFLICT(id) DO NOTHING;
  `);
}

async function readIndexState() {
  const db = getDb();
  await ensureIndexStateTable();
  const row = await db.get(`SELECT last_indexed_id, indexed_count FROM semantic_index_state WHERE id = 1;`);
  return {
    last_indexed_id: Number(row?.last_indexed_id || 0),
    indexed_count: Number(row?.indexed_count || 0)
  };
}

async function writeIndexState(lastIndexedId, indexedCount) {
  const db = getDb();
  await db.run(
    `UPDATE semantic_index_state
     SET last_indexed_id = ?, indexed_count = ?, updated_at = datetime('now')
     WHERE id = 1;`,
    [lastIndexedId, indexedCount]
  );
}

async function ensureFtsIndex() {
  const db = getDb();
  await ensureIndexStateTable();
  if (await ftsIndexExists()) return false;
  // External content: the index stores only the inverted terms and points back at
  // Postings.id, so descriptions are not duplicated on disk.
  await db.exec(`
    CREATE VIRTUAL TABLE ${FTS_TABLE} USING fts5(
      position_name,
      company_name,
      job_description,
      content='Postings',
      content_rowid='id',
      tokenize='porter unicode61'
    );
  `);
  return true;
}

// Populates the index for rows that have description text. Incremental: only ids above
// `since_id` are added, so a rebuild after a sync pass is cheap. Pass rebuild=true to
// discard and rebuild from scratch (needed after descriptions change in place).
async function rebuildSemanticIndex({ rebuild = false, batch_size = 5000 } = {}) {
  const db = getDb();
  await ensureFtsIndex();

  if (rebuild) {
    // 'delete-all' is the external-content table's own reset command; a plain DELETE
    // would try to read the content rows back to remove their terms.
    await db.run(`INSERT INTO ${FTS_TABLE}(${FTS_TABLE}) VALUES('delete-all');`);
    await writeIndexState(0, 0);
  }

  const state = await readIndexState();
  const since = rebuild ? 0 : state.last_indexed_id;

  let lastId = since;
  let indexed = 0;
  let totalIndexed = rebuild ? 0 : state.indexed_count;
  for (;;) {
    const rows = await db.all(
      `SELECT id, position_name, company_name, job_description
       FROM Postings
       WHERE id > ? AND job_description IS NOT NULL AND TRIM(job_description) <> ''
       ORDER BY id
       LIMIT ?;`,
      [lastId, batch_size]
    );
    if (rows.length === 0) break;

    await db.exec("BEGIN TRANSACTION;");
    try {
      for (const row of rows) {
        await db.run(
          `INSERT INTO ${FTS_TABLE}(rowid, position_name, company_name, job_description)
           VALUES (?, ?, ?, ?);`,
          [row.id, row.position_name || "", row.company_name || "", row.job_description || ""]
        );
        lastId = Number(row.id);
        indexed += 1;
        totalIndexed += 1;
      }
      await writeIndexState(lastId, totalIndexed);
      await db.exec("COMMIT;");
    } catch (error) {
      await db.exec("ROLLBACK;");
      throw error;
    }
  }

  return { indexed, total_indexed: totalIndexed, since_id: since, last_id: lastId };
}

// The ranking step, isolated so a different backend can replace it without touching the
// query plumbing above or the tool surface below.
async function scoreCandidates(queryText, { limit = 50, pool = 500 } = {}) {
  const db = getDb();
  const terms = buildQueryTerms(queryText);
  if (terms.length === 0) return { terms, rows: [] };

  // bm25() returns a negative score where more-negative is a better match, so ascending
  // order is best-first. Column weights put the title above the body: a term in the title
  // says more about the role than the same term buried in boilerplate.
  const rows = await db.all(
    `SELECT p.id, p.company_name, p.position_name, p.job_posting_url, p.location,
            p.city, p.state_region, p.country, p.is_remote,
            p.pay_min, p.pay_max, p.pay_currency, p.pay_period,
            p.status, p.location_conflict, p.posting_date,
            p.first_seen_epoch, p.last_seen_epoch, p.hidden,
            bm25(${FTS_TABLE}, 3.0, 0.5, 1.0) AS relevance
     FROM ${FTS_TABLE}
     JOIN Postings p ON p.id = ${FTS_TABLE}.rowid
     WHERE ${FTS_TABLE} MATCH ?
     ORDER BY relevance
     LIMIT ?;`,
    [toMatchExpression(terms), Math.max(limit, Math.min(pool, 2000))]
  );

  return { terms, rows };
}

// similar_to: free text (a resume, a job description, a paragraph describing the work) or
// an existing posting's URL/id, whose stored description becomes the query.
async function findSimilarPostings(options = {}) {
  const db = getDb();
  if (!(await ftsIndexExists())) {
    throw new Error(
      "Semantic index has not been built. Run `node server/scripts/build-semantic-index.js` or POST /semantic/reindex."
    );
  }

  const limit = Math.max(1, Math.min(200, Number(options.limit) || 25));
  let queryText = String(options.text || "").trim();
  let sourcePosting = null;

  const postingRef = String(options.posting_id || options.job_posting_url || "").trim();
  if (!queryText && postingRef) {
    const row = /^\d+$/.test(postingRef)
      ? await db.get(`SELECT id, position_name, job_description FROM Postings WHERE id = ?;`, [Number(postingRef)])
      : await db.get(
          `SELECT id, position_name, job_description FROM Postings WHERE job_posting_url = ?;`,
          [postingRef]
        );
    if (!row) throw new Error(`No posting found for '${postingRef}'.`);
    sourcePosting = { id: row.id, position_name: row.position_name };
    queryText = `${row.position_name || ""}\n${row.job_description || ""}`.trim();
    if (!queryText) throw new Error(`Posting '${postingRef}' has no stored description to compare against.`);
  }

  if (!queryText) throw new Error("similar_to requires either text or a posting id/url.");

  const excludeDead = !options.include_dead;
  const { terms, rows } = await scoreCandidates(queryText, { limit: limit * 4 });

  const items = rows
    .filter((row) => {
      if (sourcePosting && Number(row.id) === Number(sourcePosting.id)) return false;
      if (excludeDead && String(row.status || "") === "dead") return false;
      if (!options.include_hidden && Number(row.hidden) === 1) return false;
      return true;
    })
    .slice(0, limit)
    .map((row) => ({
      ...row,
      is_remote: Boolean(Number(row.is_remote || 0)),
      location_conflict: Boolean(Number(row.location_conflict || 0)),
      // Reported as a positive number where larger is a better match, since the raw BM25
      // sign convention is an implementation detail of the backend.
      relevance: Math.round(Math.abs(Number(row.relevance || 0)) * 1000) / 1000
    }));

  return {
    count: items.length,
    query_terms: terms,
    source_posting: sourcePosting,
    items
  };
}

module.exports = {
  findSimilarPostings,
  rebuildSemanticIndex,
  ensureFtsIndex,
  ftsIndexExists,
  buildQueryTerms,
  toMatchExpression,
  tokenize,
  FTS_TABLE
};
