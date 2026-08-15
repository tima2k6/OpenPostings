// Resume-to-posting match scoring, run over every synced posting rather than only the ones
// already applied to.
//
// The scoring itself is not new: server/services/cover-letter.js already extracts a
// posting's requirements/responsibilities and diffs them against the resume
// (findOverlapTerms, findUnmatchedRequirements) to write a cover-letter brief, and
// applications.js's computeJobFitByApplicationId already turns that into a match_percent --
// but only for applications already submitted, recomputed live on every request. This
// module runs the same computation over the whole Postings table and caches it, so the
// webapp can sort and filter by fit before an application exists at all.
//
// Why this is cached in a sibling table instead of computed per request: buildCoverLetterBrief
// does regex-heavy section extraction and tokenization over the full description text, and
// server/services/enrichment-runtime.js documents that this kind of synchronous work over
// as few as ~100 documents blocked the API event loop for ~10s. Doing it inline for every
// row of a postings list would reintroduce exactly the timeout problem the reader-connection
// fix elsewhere addresses. Instead it runs as a batched background job (see
// server/scripts/build-match-index.js), mirroring semantic-search.js's rebuildSemanticIndex.
const { buildCoverLetterBrief } = require("./cover-letter.js");
const { getApplicantDocument, DEFAULT_DOCUMENT_KEY } = require("./applicant-documents.js");
const { getDb, getReadDb, runInWriteTransaction } = require("./runtime-context.js");

// How many overlap terms / unmatched requirements to keep per posting. Matches the slice
// sizes computeJobFitByApplicationId already uses for display (applications.js), so a
// posting's cached row and an application's live brief show the same amount of detail.
const MAX_OVERLAP_TERMS = 10;
const MAX_UNMATCHED_REQUIREMENTS = 5;

const MATCH_INDEX_BATCH_SIZE = Number(process.env.MATCH_INDEX_BATCH_SIZE || 400);

async function ensureMatchTables() {
  const db = getDb();
  await db.exec(`
    CREATE TABLE IF NOT EXISTS posting_match_scores (
      posting_id INTEGER NOT NULL PRIMARY KEY,
      resume_uploaded_at TEXT NOT NULL,
      requirements_total INTEGER NOT NULL DEFAULT 0,
      requirements_matched INTEGER NOT NULL DEFAULT 0,
      match_percent REAL,
      overlap_terms_json TEXT NOT NULL DEFAULT '[]',
      unmatched_requirements_json TEXT NOT NULL DEFAULT '[]',
      computed_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS posting_match_state (
      id INTEGER NOT NULL PRIMARY KEY CHECK (id = 1),
      last_scored_id INTEGER NOT NULL DEFAULT 0,
      resume_uploaded_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO posting_match_state (id, last_scored_id, resume_uploaded_at)
    VALUES (1, 0, '')
    ON CONFLICT(id) DO NOTHING;

    -- Lets sort_by=match_desc in postings.js drive the query from this table (indexed,
    -- already-sorted order) instead of sorting the whole visible Postings set in a temp
    -- b-tree on every request. See the "scored" phase in listPostingsWithFilters.
    CREATE INDEX IF NOT EXISTS idx_posting_match_scores_percent
      ON posting_match_scores(match_percent DESC, posting_id DESC);
  `);
}

async function readMatchState() {
  const db = getDb();
  await ensureMatchTables();
  const row = await db.get(`SELECT last_scored_id, resume_uploaded_at FROM posting_match_state WHERE id = 1;`);
  return {
    last_scored_id: Number(row?.last_scored_id || 0),
    resume_uploaded_at: String(row?.resume_uploaded_at || "")
  };
}

async function writeMatchState(lastScoredId, resumeUploadedAt) {
  const db = getDb();
  await db.run(
    `UPDATE posting_match_state
     SET last_scored_id = ?, resume_uploaded_at = ?, updated_at = datetime('now')
     WHERE id = 1;`,
    [lastScoredId, resumeUploadedAt]
  );
}

// Thin wrapper over buildCoverLetterBrief's requirement diff, turned into the same
// match_percent shape computeJobFitByApplicationId already computes (applications.js) --
// requirements with no keyword support in the resume count against the score, everything
// else counts for it. Returns available: false when the description has no detectable
// requirements section, same as the application-side computation.
function computeMatchForPosting({ description, resume_text, posting } = {}) {
  const brief = buildCoverLetterBrief({ description, resume_text, posting });
  const requirementsTotal = brief.requirements.length;
  const requirementsUnmatched = brief.unmatched_requirements.length;
  const requirementsMatched = Math.max(0, requirementsTotal - requirementsUnmatched);

  return {
    available: requirementsTotal > 0,
    requirements_total: requirementsTotal,
    requirements_matched: requirementsMatched,
    match_percent: requirementsTotal > 0 ? (requirementsMatched / requirementsTotal) * 100 : null,
    overlap_terms: brief.overlap_terms.slice(0, MAX_OVERLAP_TERMS).map((entry) => entry.term),
    unmatched_requirements: brief.unmatched_requirements.slice(0, MAX_UNMATCHED_REQUIREMENTS)
  };
}

// Incremental: only postings above last_scored_id are scored, so a run after a sync pass is
// cheap. A resume re-upload is detected by comparing its uploaded_at against the state row
// and treated as an implicit rebuild -- callers never need to invalidate this explicitly.
async function rescoreMatches({
  rebuild = false,
  batch_size = MATCH_INDEX_BATCH_SIZE,
  max_batches = Number.POSITIVE_INFINITY
} = {}) {
  const db = getDb();
  await ensureMatchTables();

  const resumeDocument = await getApplicantDocument(DEFAULT_DOCUMENT_KEY);
  const resumeText = String(resumeDocument?.text || "").trim();
  const resumeUploadedAt = String(resumeDocument?.uploaded_at || "");

  const batchSize = Math.max(1, Math.floor(Number(batch_size) || MATCH_INDEX_BATCH_SIZE));
  const maxBatches = Number.isFinite(Number(max_batches))
    ? Math.max(1, Math.floor(Number(max_batches)))
    : Number.POSITIVE_INFINITY;

  const state = await readMatchState();
  // A new (or newly removed) resume invalidates every score computed against the old one --
  // restart the walk from the top rather than leaving stale rows mixed in with fresh ones.
  const resumeChanged = state.resume_uploaded_at !== resumeUploadedAt;
  const effectiveRebuild = rebuild || resumeChanged;

  if (effectiveRebuild) {
    await db.exec(`DELETE FROM posting_match_scores;`);
    await writeMatchState(0, resumeUploadedAt);
  }

  let lastId = effectiveRebuild ? 0 : state.last_scored_id;
  let scored = 0;
  let batches = 0;
  let complete = false;

  while (batches < maxBatches) {
    const rows = await db.all(
      `SELECT id, position_name, company_name, job_description
       FROM Postings
       WHERE id > ? AND job_description IS NOT NULL AND TRIM(job_description) <> ''
       ORDER BY id
       LIMIT ?;`,
      [lastId, batchSize]
    );
    if (rows.length === 0) {
      complete = true;
      break;
    }

    // Serialized against every other writer, same reasoning as rebuildSemanticIndex: this
    // runs on its own clock alongside the sync and any other background writer.
    await runInWriteTransaction(async (handle) => {
      for (const row of rows) {
        const match = computeMatchForPosting({
          description: row.job_description,
          resume_text: resumeText,
          posting: { position_name: row.position_name, company_name: row.company_name }
        });
        await handle.run(
          `INSERT INTO posting_match_scores
             (posting_id, resume_uploaded_at, requirements_total, requirements_matched,
              match_percent, overlap_terms_json, unmatched_requirements_json, computed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
           ON CONFLICT(posting_id) DO UPDATE SET
             resume_uploaded_at = excluded.resume_uploaded_at,
             requirements_total = excluded.requirements_total,
             requirements_matched = excluded.requirements_matched,
             match_percent = excluded.match_percent,
             overlap_terms_json = excluded.overlap_terms_json,
             unmatched_requirements_json = excluded.unmatched_requirements_json,
             computed_at = datetime('now');`,
          [
            row.id,
            resumeUploadedAt,
            match.requirements_total,
            match.requirements_matched,
            match.match_percent,
            JSON.stringify(match.overlap_terms),
            JSON.stringify(match.unmatched_requirements)
          ]
        );
        lastId = Number(row.id);
        scored += 1;
      }
      await writeMatchState(lastId, resumeUploadedAt);
    });
    batches += 1;

    if (rows.length < batchSize) {
      complete = true;
      break;
    }
  }

  return {
    scored,
    since_id: effectiveRebuild ? 0 : state.last_scored_id,
    last_id: lastId,
    batches,
    complete,
    rebuilt: effectiveRebuild
  };
}

function mapMatchRow(row) {
  if (!row) return null;
  let overlapTerms = [];
  let unmatchedRequirements = [];
  try {
    overlapTerms = JSON.parse(row.overlap_terms_json || "[]");
  } catch {
    overlapTerms = [];
  }
  try {
    unmatchedRequirements = JSON.parse(row.unmatched_requirements_json || "[]");
  } catch {
    unmatchedRequirements = [];
  }
  return {
    posting_id: Number(row.posting_id),
    match_percent: row.match_percent === null || row.match_percent === undefined ? null : Number(row.match_percent),
    requirements_total: Number(row.requirements_total || 0),
    requirements_matched: Number(row.requirements_matched || 0),
    overlap_terms: overlapTerms,
    unmatched_requirements: unmatchedRequirements,
    computed_at: String(row.computed_at || "")
  };
}

// On the reader connection, not the writer -- see personal-info.js's getPersonalInformation
// for why. Used by computeJobFitByApplicationId (applications.js) to read cached scores
// instead of recomputing the brief live for every application on every request.
async function getMatchesByPostingIds(postingIds) {
  const ids = Array.from(new Set((postingIds || []).map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0)));
  if (ids.length === 0) return new Map();

  const db = getReadDb();
  const placeholders = ids.map(() => "?").join(", ");
  const rows = await db.all(
    `SELECT posting_id, match_percent, requirements_total, requirements_matched,
            overlap_terms_json, unmatched_requirements_json, computed_at
     FROM posting_match_scores
     WHERE posting_id IN (${placeholders});`,
    ids
  );

  const byId = new Map();
  for (const row of rows) {
    const mapped = mapMatchRow(row);
    if (mapped) byId.set(mapped.posting_id, mapped);
  }
  return byId;
}

module.exports = {
  ensureMatchTables,
  computeMatchForPosting,
  rescoreMatches,
  getMatchesByPostingIds,
  MAX_OVERLAP_TERMS,
  MAX_UNMATCHED_REQUIREMENTS
};
