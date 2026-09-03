// Coverage metrics for the two search indexes.
//
// This exists because the failure it measures ran undetected for months. postings_fts drifted
// to ~88% documents that no query could return, while simultaneously *missing* 7.5-22% of the
// postings that could be returned -- and nothing anywhere reported a number that would have
// shown it. Row counts looked fine; the index was there; search returned results. The only
// way to see it was to go looking, which nobody does until something is visibly broken.
//
// So: a sampled miss rate, cheap enough to run on a timer, for each index.
//
// Deliberately NOT computed inside /sync/status. That endpoint is polled continuously and
// COUNT(*) on the search index alone is ~1.3s -- putting it there would undo the caching that
// took /health from 8s to 1.5ms. A background timer refreshes this, /index/status serves what
// the timer produced, and the health warning reads the same cached value. Nothing on a
// request path ever pays for it.
const { getStatusReadDb } = require("./runtime-context.js");
const { SEARCH_FTS_TABLE } = require("./search-index.js");
const { FTS_TABLE } = require("./semantic-search.js");

const FTS_DOCSIZE_TABLE = `${FTS_TABLE}_docsize`;

// Spread across the id space rather than taken from one end: the miss rate is not uniform.
// When postings_fts was measured, the newest 4,000 documents were 0% hidden and the oldest
// 4,000 were 91.5% hidden, so a sample from either end alone would have been badly wrong.
const SAMPLE_BANDS = 8;
const SAMPLE_PER_BAND = 250;

let cached = null;
let cachedAtMs = 0;

function chunkPlaceholders(ids) {
  return ids.map(() => "?").join(",");
}

// Membership only. For the trigram index this is a real test: it is a standard FTS5 table, so
// its content *is* the index. The same query against postings_fts would be meaningless --
// that one is external content, so a rowid lookup reads through to Postings and returns a row
// for postings that were never indexed at all. Hence the docsize shadow table for that one.
async function countIndexed(db, table, column, ids) {
  if (ids.length === 0) return 0;
  const row = await db.get(
    `SELECT COUNT(*) AS c FROM ${table} WHERE ${column} IN (${chunkPlaceholders(ids)});`,
    ids
  );
  return Number(row?.c || 0);
}

async function sampleCoverage(db, maxId) {
  const step = Math.max(1, Math.floor(maxId / SAMPLE_BANDS));
  let searchSampled = 0;
  let searchMissing = 0;
  let semanticSampled = 0;
  let semanticMissing = 0;

  for (let band = 0; band < SAMPLE_BANDS; band += 1) {
    const from = band * step;
    // NOT INDEXED: `ORDER BY id` with a `hidden` filter otherwise plans as an index scan plus
    // a temp b-tree sort over the whole visible set -- see semantic-search.js.
    const rows = await db.all(
      `SELECT id, job_description IS NOT NULL AND TRIM(job_description) <> '' AS has_description
       FROM Postings NOT INDEXED
       WHERE id > ? AND hidden = 0
       ORDER BY id
       LIMIT ?;`,
      [from, SAMPLE_PER_BAND]
    );
    if (rows.length === 0) continue;

    const ids = rows.map((row) => Number(row.id));
    searchSampled += ids.length;
    searchMissing += ids.length - (await countIndexed(db, SEARCH_FTS_TABLE, "rowid", ids));

    // The semantic index only ever covers postings that have description text, so rows
    // without one are not missing from it -- counting them would invent a permanent gap.
    const describedIds = rows.filter((row) => Number(row.has_description) === 1).map((r) => Number(r.id));
    semanticSampled += describedIds.length;
    semanticMissing += describedIds.length - (await countIndexed(db, FTS_DOCSIZE_TABLE, "id", describedIds));
  }

  const rate = (missing, sampled) => (sampled > 0 ? Number(((missing / sampled) * 100).toFixed(2)) : null);
  return {
    search_index: { sampled: searchSampled, missing: searchMissing, miss_percent: rate(searchMissing, searchSampled) },
    semantic_index: { sampled: semanticSampled, missing: semanticMissing, miss_percent: rate(semanticMissing, semanticSampled) }
  };
}

async function computeIndexHealth() {
  const db = getStatusReadDb();
  const visibleRow = await db.get(`SELECT COUNT(*) AS c FROM Postings WHERE hidden = 0;`);
  const maxRow = await db.get(`SELECT MAX(id) AS max_id FROM Postings;`);
  const visible = Number(visibleRow?.c || 0);
  const maxId = Number(maxRow?.max_id || 0);

  const readOptional = async (sql, params = []) => {
    try {
      return await db.get(sql, params);
    } catch {
      return null;
    }
  };

  const searchDocs = await readOptional(`SELECT COUNT(*) AS c FROM ${SEARCH_FTS_TABLE};`);
  const semanticDocs = await readOptional(`SELECT COUNT(*) AS c FROM ${FTS_DOCSIZE_TABLE};`);
  const searchState = await readOptional(`SELECT last_indexed_id, refreshed_id FROM search_index_state WHERE id = 1;`);
  const semanticState = await readOptional(`SELECT last_indexed_id, gap_scanned_id FROM semantic_index_state WHERE id = 1;`);

  const sampled = maxId > 0 ? await sampleCoverage(db, maxId) : null;
  const pct = (value) => (maxId > 0 ? Number(((value / maxId) * 100).toFixed(2)) : null);

  return {
    computed_at: new Date().toISOString(),
    visible_postings: visible,
    max_posting_id: maxId,
    search_index: {
      table: SEARCH_FTS_TABLE,
      documents: searchDocs ? Number(searchDocs.c) : null,
      // Every visible posting belongs in this index, so the difference is a real gap.
      document_gap: searchDocs ? visible - Number(searchDocs.c) : null,
      forward_cursor_id: Number(searchState?.last_indexed_id || 0),
      refresh_cursor_id: Number(searchState?.refreshed_id || 0),
      refresh_sweep_percent: pct(Number(searchState?.refreshed_id || 0)),
      ...(sampled?.search_index || {})
    },
    semantic_index: {
      table: FTS_TABLE,
      documents: semanticDocs ? Number(semanticDocs.c) : null,
      // No document_gap: this index covers only postings that have description text, so the
      // visible count is not its target and subtracting them would report a phantom deficit.
      forward_cursor_id: Number(semanticState?.last_indexed_id || 0),
      gap_cursor_id: Number(semanticState?.gap_scanned_id || 0),
      gap_sweep_percent: pct(Number(semanticState?.gap_scanned_id || 0)),
      ...(sampled?.semantic_index || {})
    }
  };
}

function getCachedIndexHealth() {
  if (!cached) return null;
  return { ...cached, cached_age_seconds: Math.max(0, Math.round((Date.now() - cachedAtMs) / 1000)) };
}

async function refreshIndexHealth() {
  cached = await computeIndexHealth();
  cachedAtMs = Date.now();
  return cached;
}

// Serves the cached value, computing only if nothing has been produced yet (or when a caller
// explicitly asks for fresh numbers).
async function getIndexHealth({ refresh = false } = {}) {
  if (refresh || !cached) return { ...(await refreshIndexHealth()), cached_age_seconds: 0 };
  return getCachedIndexHealth();
}

module.exports = {
  getIndexHealth,
  getCachedIndexHealth,
  refreshIndexHealth,
  computeIndexHealth
};
