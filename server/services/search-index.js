// A trigram FTS5 index over the three fields /postings search actually searches:
// company_name, position_name and location.
//
// Why a second index rather than reusing postings_fts: they answer different questions and
// their semantics are not interchangeable. postings_fts is a porter-stemmed index over
// position_name, company_name and job_description, built for find_similar_postings. The
// /postings search filter is a substring match -- `companyName.includes(term) ||
// positionName.includes(term) || location.includes(term)` -- over a set of fields that
// includes location and excludes descriptions. Measured on the live database, swapping the
// search filter onto postings_fts would have lost 13.5-38.5% of the results a query returns
// today ("boston" loses 38.5%, because postings_fts does not index location at all) while
// adding tens of thousands of description matches. That is a product change, not a speedup.
//
// The trigram tokenizer reproduces LIKE '%term%' exactly, infix matches included ('gineer'
// matches "Senior Engineer"), so this index returns precisely today's result set. Its only
// limit is that trigram cannot match terms shorter than 3 characters; those fall back to the
// existing LIKE prefilter. Measured cost: 270MB for 764k visible rows, ~2.5 minutes to build,
// against a LIKE wide scan that costs 3.7s for one rare term.
//
// Deliberately NOT an external content table. postings_fts is, and that is what made its
// hidden-posting bloat unfixable: deleting a row from an external content index requires
// re-supplying the exact text that was indexed, which is gone once a posting is hidden and
// its description cleared. A standard FTS5 table stores its own copy (the 270MB above
// includes it) and supports ordinary DELETE, so this index can be pruned and refreshed in
// place and cannot rot the same way.
const {
  getDb,
  getReadDb,
  runInWriteTransaction
} = require("./runtime-context.js");

const SEARCH_FTS_TABLE = "postings_search_fts";
const SEARCH_STATE_TABLE = "search_index_state";

// Trigram cannot represent a term shorter than this; callers must fall back to LIKE.
const MIN_TRIGRAM_TERM_LENGTH = 3;

const SEARCH_INDEX_BATCH_SIZE = Number(process.env.SEARCH_INDEX_BATCH_SIZE || 500);
const SEARCH_INDEX_MAX_BATCHES = Number(process.env.SEARCH_INDEX_MAX_BATCHES || 20);
// The refresh sweep re-writes rows rather than only filling gaps, so it also picks up a
// location the backfill changed and drops a posting that has since been hidden. Sized at
// 25,000 rows per run (measured ~76s) so a full cycle over ~700k visible rows takes about
// seven hours: that cycle time is the upper bound on how long a posting that flips from
// hidden back to visible can stay out of search results.
const SEARCH_REFRESH_BATCH_SIZE = Number(process.env.SEARCH_INDEX_REFRESH_BATCH_SIZE || 500);
const SEARCH_REFRESH_MAX_BATCHES = Number(process.env.SEARCH_INDEX_REFRESH_MAX_BATCHES || 50);

async function ensureSearchIndex() {
  const db = getDb();
  await db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS ${SEARCH_FTS_TABLE} USING fts5(
      company_name,
      position_name,
      location,
      tokenize='trigram'
    );
  `);
  await db.exec(`
    CREATE TABLE IF NOT EXISTS ${SEARCH_STATE_TABLE} (
      id INTEGER NOT NULL PRIMARY KEY CHECK (id = 1),
      last_indexed_id INTEGER NOT NULL DEFAULT 0,
      indexed_count INTEGER NOT NULL DEFAULT 0,
      refreshed_id INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO ${SEARCH_STATE_TABLE} (id, last_indexed_id, indexed_count)
    VALUES (1, 0, 0)
    ON CONFLICT(id) DO NOTHING;
  `);
}

async function searchIndexExists() {
  const db = getReadDb();
  const row = await db.get(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?;`, [
    SEARCH_FTS_TABLE
  ]);
  return Boolean(row);
}

async function readSearchIndexState() {
  const db = getReadDb();
  const row = await db.get(
    `SELECT last_indexed_id, indexed_count, refreshed_id FROM ${SEARCH_STATE_TABLE} WHERE id = 1;`
  );
  return {
    last_indexed_id: Number(row?.last_indexed_id || 0),
    indexed_count: Number(row?.indexed_count || 0),
    refreshed_id: Number(row?.refreshed_id || 0)
  };
}

async function writeSearchIndexState(fields) {
  const db = getDb();
  const sets = [];
  const params = [];
  for (const [column, value] of Object.entries(fields)) {
    sets.push(`${column} = ?`);
    params.push(value);
  }
  if (sets.length === 0) return;
  await db.run(
    `UPDATE ${SEARCH_STATE_TABLE} SET ${sets.join(", ")}, updated_at = datetime('now') WHERE id = 1;`,
    params
  );
}

// Delete-then-insert, so this is equally an insert and a refresh. FTS5 does not enforce
// rowid uniqueness, so a bare INSERT would silently duplicate a row that is already indexed.
async function writeIndexRows(handle, rows) {
  for (const row of rows) {
    await handle.run(`DELETE FROM ${SEARCH_FTS_TABLE} WHERE rowid = ?;`, [row.id]);
    await handle.run(
      `INSERT INTO ${SEARCH_FTS_TABLE}(rowid, company_name, position_name, location)
       VALUES (?, ?, ?, ?);`,
      [row.id, row.company_name || "", row.position_name || "", row.location || ""]
    );
  }
}

// NOT INDEXED throughout: `ORDER BY id` combined with a `hidden` filter makes the planner
// take idx_postings_hidden_last_seen_epoch and then sort into a temp b-tree, which
// re-materialises the whole visible set on every batch. That mistake cost 87,561ms per batch
// against 27ms in the semantic index; see the comment in semantic-search.js.
async function buildSearchIndex({
  rebuild = false,
  batch_size = SEARCH_INDEX_BATCH_SIZE,
  max_batches = SEARCH_INDEX_MAX_BATCHES
} = {}) {
  const db = getDb();
  await ensureSearchIndex();

  const batchSize = Math.max(1, Math.floor(Number(batch_size) || SEARCH_INDEX_BATCH_SIZE));
  const maxBatches = Number.isFinite(Number(max_batches))
    ? Math.max(1, Math.floor(Number(max_batches)))
    : Number.POSITIVE_INFINITY;

  if (rebuild) {
    await db.run(`DELETE FROM ${SEARCH_FTS_TABLE};`);
    await writeSearchIndexState({ last_indexed_id: 0, indexed_count: 0, refreshed_id: 0 });
  }

  const state = await readSearchIndexState();
  let lastId = rebuild ? 0 : state.last_indexed_id;
  let totalIndexed = rebuild ? 0 : state.indexed_count;
  let indexed = 0;
  let batches = 0;
  let complete = false;

  while (batches < maxBatches) {
    const rows = await db.all(
      `SELECT id, company_name, position_name, location
       FROM Postings NOT INDEXED
       WHERE id > ? AND hidden = 0
       ORDER BY id
       LIMIT ?;`,
      [lastId, batchSize]
    );
    if (rows.length === 0) {
      complete = true;
      break;
    }

    await runInWriteTransaction(async (handle) => {
      await writeIndexRows(handle, rows);
      lastId = Number(rows[rows.length - 1].id);
      indexed += rows.length;
      totalIndexed += rows.length;
      await handle.run(
        `UPDATE ${SEARCH_STATE_TABLE} SET last_indexed_id = ?, indexed_count = ?, updated_at = datetime('now') WHERE id = 1;`,
        [lastId, totalIndexed]
      );
    });
    batches += 1;

    if (rows.length < batchSize) {
      complete = true;
      break;
    }
  }

  return { indexed, total_indexed: totalIndexed, last_id: lastId, batches, complete };
}

// A rolling sweep below the forward cursor. Unlike the semantic index's gap scan this
// rewrites every row it visits rather than only filling in missing ones, because the fields
// it indexes change in place -- the description backfill rewrites `location` -- and a stale
// entry means a posting silently stops matching a search it should match. It also drops rows
// that have since been hidden, which is the accumulation problem postings_fts could not fix.
async function refreshSearchIndex({
  batch_size = SEARCH_REFRESH_BATCH_SIZE,
  max_batches = SEARCH_REFRESH_MAX_BATCHES
} = {}) {
  const readDb = getReadDb();
  await ensureSearchIndex();

  const batchSize = Math.max(1, Math.floor(Number(batch_size) || SEARCH_REFRESH_BATCH_SIZE));
  const maxBatches = Math.max(1, Math.floor(Number(max_batches) || 1));

  const state = await readSearchIndexState();
  const ceiling = state.last_indexed_id;
  let cursor = state.refreshed_id;
  let refreshed = 0;
  let pruned = 0;
  let batches = 0;
  let complete = false;

  while (batches < maxBatches) {
    if (cursor >= ceiling) {
      cursor = 0;
      complete = true;
      break;
    }

    const rows = await readDb.all(
      `SELECT id, company_name, position_name, location, hidden
       FROM Postings NOT INDEXED
       WHERE id > ? AND id <= ?
       ORDER BY id
       LIMIT ?;`,
      [cursor, ceiling, batchSize]
    );
    if (rows.length === 0) {
      cursor = ceiling;
      complete = true;
      break;
    }

    const visible = rows.filter((row) => Number(row.hidden) === 0);
    const hidden = rows.filter((row) => Number(row.hidden) !== 0);

    await runInWriteTransaction(async (handle) => {
      await writeIndexRows(handle, visible);
      for (const row of hidden) {
        await handle.run(`DELETE FROM ${SEARCH_FTS_TABLE} WHERE rowid = ?;`, [row.id]);
      }
      refreshed += visible.length;
      pruned += hidden.length;
      cursor = Number(rows[rows.length - 1].id);
      await handle.run(
        `UPDATE ${SEARCH_STATE_TABLE} SET refreshed_id = ?, updated_at = datetime('now') WHERE id = 1;`,
        [cursor]
      );
    });
    batches += 1;
  }

  await writeSearchIndexState({ refreshed_id: cursor });
  return { refreshed, pruned, refreshed_id: cursor, ceiling, batches, complete };
}

// FTS5 treats a bare string as query syntax, so every term is wrapped in double quotes and
// its own quotes doubled. Without this a search for `foo"` or for a bare `AND` is a syntax
// error rather than a search, and the endpoint 500s on ordinary user input.
function quoteTrigramTerm(term) {
  return `"${String(term).replace(/"/g, '""')}"`;
}

function canUseTrigramSearch(terms) {
  if (!Array.isArray(terms) || terms.length === 0) return false;
  return terms.every((term) => String(term || "").length >= MIN_TRIGRAM_TERM_LENGTH);
}

// AND across terms, matching the JS filter's `searchTerms.every(...)`: FTS5 applies AND at
// row level and a row spans all three indexed columns, so "each term appears in company OR
// position OR location" is exactly what this asks for.
function buildTrigramMatchExpression(terms) {
  return terms.map((term) => quoteTrigramTerm(term)).join(" AND ");
}

// Returns the candidate ids for the search terms, or null when the index cannot answer --
// no index yet, or a term too short for trigram -- in which case the caller keeps the
// existing LIKE prefilter. Never returns a partial set silently: a bounded result is
// reported through `bounded` so the caller can decide, because quietly truncating candidates
// would drop postings from a user's results.
async function findSearchCandidateIds(terms, { limit = 200000 } = {}) {
  if (!canUseTrigramSearch(terms)) return null;
  if (!(await searchIndexExists())) return null;

  const db = getReadDb();
  const expression = buildTrigramMatchExpression(terms);
  const rows = await db.all(
    `SELECT rowid AS id FROM ${SEARCH_FTS_TABLE} WHERE ${SEARCH_FTS_TABLE} MATCH ? LIMIT ?;`,
    [expression, limit + 1]
  );
  if (rows.length > limit) return { ids: null, bounded: true };
  return { ids: rows.map((row) => Number(row.id)), bounded: false };
}

module.exports = {
  ensureSearchIndex,
  searchIndexExists,
  buildSearchIndex,
  refreshSearchIndex,
  readSearchIndexState,
  findSearchCandidateIds,
  canUseTrigramSearch,
  buildTrigramMatchExpression,
  quoteTrigramTerm,
  SEARCH_FTS_TABLE,
  SEARCH_STATE_TABLE,
  MIN_TRIGRAM_TERM_LENGTH
};
