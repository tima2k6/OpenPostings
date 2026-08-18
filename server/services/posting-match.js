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
const { buildCoverLetterBrief, findUnmatchedRequirementsStrict } = require("./cover-letter.js");
const { getApplicantDocument, DEFAULT_DOCUMENT_KEY, listResumeDocumentKeys } = require("./applicant-documents.js");
const { getDb, getReadDb, runInWriteTransaction } = require("./runtime-context.js");

// How many overlap terms / unmatched requirements to keep per posting. Matches the slice
// sizes computeJobFitByApplicationId already uses for display (applications.js), so a
// posting's cached row and an application's live brief show the same amount of detail.
const MAX_OVERLAP_TERMS = 10;
const MAX_UNMATCHED_REQUIREMENTS = 5;

const MATCH_INDEX_BATCH_SIZE = Number(process.env.MATCH_INDEX_BATCH_SIZE || 400);

// The forward walk only ever moves last_scored_id ahead, but the description backfill
// (posting-page-fetcher.js) runs on its own slower, independent clock (see
// enrichment-runtime.js) -- a description can arrive for a posting after the forward walk
// has already passed its id, and would otherwise never be scored short of a full rebuild.
// This bounds a second, low-priority sweep over the already-scanned range, re-checking for
// postings that gained a description after the fact. Small and fixed rather than a CLI
// flag: it is a reconciliation pass, not the primary catch-up mechanism.
const GAP_SWEEP_MAX_BATCHES = 4;

async function ensureMatchTables() {
  const db = getDb();
  await db.exec(`
    CREATE TABLE IF NOT EXISTS posting_match_scores (
      posting_id INTEGER NOT NULL,
      resume_key TEXT NOT NULL DEFAULT '${DEFAULT_DOCUMENT_KEY}',
      resume_uploaded_at TEXT NOT NULL,
      requirements_total INTEGER NOT NULL DEFAULT 0,
      requirements_matched INTEGER NOT NULL DEFAULT 0,
      match_percent REAL,
      overlap_terms_json TEXT NOT NULL DEFAULT '[]',
      unmatched_requirements_json TEXT NOT NULL DEFAULT '[]',
      computed_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (posting_id, resume_key)
    );

    CREATE TABLE IF NOT EXISTS posting_match_state (
      resume_key TEXT NOT NULL PRIMARY KEY,
      last_scored_id INTEGER NOT NULL DEFAULT 0,
      resume_uploaded_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Lets sort_by=match_desc in postings.js drive the query from this table (indexed,
    -- already-sorted order) instead of sorting the whole visible Postings set in a temp
    -- b-tree on every request. See the "scored" phase in listPostingsWithFilters. resume_key
    -- leads the index because every read filters to one resume before ordering by percent.
    CREATE INDEX IF NOT EXISTS idx_posting_match_scores_percent
      ON posting_match_scores(resume_key, match_percent DESC, posting_id DESC);
  `);

  // Older databases had posting_match_scores keyed by posting_id alone and posting_match_state
  // as a single id=1 row -- both predate scoring against more than one resume. SQLite can't
  // ALTER a primary key, so rebuild onto the resume_key-keyed shape, carrying every existing
  // row forward under DEFAULT_DOCUMENT_KEY so nothing already scored gets silently rescanned
  // or lost. Same rebuild-in-a-transaction idiom as ensureApplicantDocumentsTable above.
  const scoreColumns = await db.all(`PRAGMA table_info('posting_match_scores');`);
  if (!scoreColumns.some((column) => String(column?.name || "") === "resume_key")) {
    await runInWriteTransaction(async (handle) => {
      await handle.exec(`
        CREATE TABLE posting_match_scores_migrated (
          posting_id INTEGER NOT NULL,
          resume_key TEXT NOT NULL DEFAULT '${DEFAULT_DOCUMENT_KEY}',
          resume_uploaded_at TEXT NOT NULL,
          requirements_total INTEGER NOT NULL DEFAULT 0,
          requirements_matched INTEGER NOT NULL DEFAULT 0,
          match_percent REAL,
          overlap_terms_json TEXT NOT NULL DEFAULT '[]',
          unmatched_requirements_json TEXT NOT NULL DEFAULT '[]',
          computed_at TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (posting_id, resume_key)
        );
        INSERT INTO posting_match_scores_migrated
          (posting_id, resume_key, resume_uploaded_at, requirements_total, requirements_matched,
           match_percent, overlap_terms_json, unmatched_requirements_json, computed_at)
        SELECT posting_id, '${DEFAULT_DOCUMENT_KEY}', resume_uploaded_at, requirements_total,
               requirements_matched, match_percent, overlap_terms_json,
               unmatched_requirements_json, computed_at
        FROM posting_match_scores;
        DROP TABLE posting_match_scores;
        ALTER TABLE posting_match_scores_migrated RENAME TO posting_match_scores;
        CREATE INDEX IF NOT EXISTS idx_posting_match_scores_percent
          ON posting_match_scores(resume_key, match_percent DESC, posting_id DESC);
      `);
    });
  }

  const stateColumns = await db.all(`PRAGMA table_info('posting_match_state');`);
  if (!stateColumns.some((column) => String(column?.name || "") === "resume_key")) {
    await runInWriteTransaction(async (handle) => {
      await handle.exec(`
        CREATE TABLE posting_match_state_migrated (
          resume_key TEXT NOT NULL PRIMARY KEY,
          last_scored_id INTEGER NOT NULL DEFAULT 0,
          resume_uploaded_at TEXT NOT NULL DEFAULT '',
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        INSERT INTO posting_match_state_migrated (resume_key, last_scored_id, resume_uploaded_at, updated_at)
        SELECT '${DEFAULT_DOCUMENT_KEY}', last_scored_id, resume_uploaded_at, updated_at
        FROM posting_match_state
        WHERE id = 1;
        DROP TABLE posting_match_state;
        ALTER TABLE posting_match_state_migrated RENAME TO posting_match_state;
      `);
    });
  }

  // gap_scanned_id tracks a second, independent cursor (see the gap sweep in rescoreMatches)
  // over the range the forward walk has already passed -- a posting whose description
  // arrives after last_scored_id has moved beyond it would otherwise never be revisited.
  const stateColumnsAfterKeyMigration = await db.all(`PRAGMA table_info('posting_match_state');`);
  if (!stateColumnsAfterKeyMigration.some((column) => String(column?.name || "") === "gap_scanned_id")) {
    await runInWriteTransaction(async (handle) => {
      await handle.exec(`ALTER TABLE posting_match_state ADD COLUMN gap_scanned_id INTEGER NOT NULL DEFAULT 0;`);
    });
  }
}

async function readMatchState(resumeKey) {
  const db = getDb();
  await ensureMatchTables();
  const row = await db.get(
    `SELECT last_scored_id, resume_uploaded_at, gap_scanned_id FROM posting_match_state WHERE resume_key = ?;`,
    [resumeKey]
  );
  return {
    last_scored_id: Number(row?.last_scored_id || 0),
    resume_uploaded_at: String(row?.resume_uploaded_at || ""),
    gap_scanned_id: Number(row?.gap_scanned_id || 0)
  };
}

// Upserts rather than updating a pre-seeded row -- there is no longer one singleton row to
// seed at table-creation time, since each resume key gets its own row on first use.
async function writeMatchState(resumeKey, lastScoredId, resumeUploadedAt, gapScannedId) {
  const db = getDb();
  await db.run(
    `INSERT INTO posting_match_state (resume_key, last_scored_id, resume_uploaded_at, gap_scanned_id, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(resume_key) DO UPDATE SET
       last_scored_id = excluded.last_scored_id,
       resume_uploaded_at = excluded.resume_uploaded_at,
       gap_scanned_id = excluded.gap_scanned_id,
       updated_at = datetime('now');`,
    [resumeKey, lastScoredId, resumeUploadedAt, gapScannedId]
  );
}

// Thin wrapper over buildCoverLetterBrief's requirement extraction, turned into the same
// match_percent shape computeJobFitByApplicationId already computes (applications.js) --
// requirements with no discriminative support in the resume count against the score,
// everything else counts for it. Returns available: false when the description has no
// scorable requirements, same as the application-side computation.
//
// Deliberately uses findUnmatchedRequirementsStrict here, not the same
// findUnmatchedRequirements draft_cover_letter's brief uses -- see that function's comment
// in cover-letter.js. This is the one place that distinction matters: a ranking score that
// reads 100% on a mismatched posting is actively misleading in a way a cover letter that
// under-flags one gap is not, so this path trades the letter-writing leniency for precision.
function computeMatchForPosting({ description, resume_text, posting } = {}) {
  const brief = buildCoverLetterBrief({ description, resume_text, posting });
  const { scorable, unmatched } = findUnmatchedRequirementsStrict(brief.requirements, resume_text || "");
  const requirementsTotal = scorable.length;
  const requirementsMatched = Math.max(0, requirementsTotal - unmatched.length);

  return {
    available: requirementsTotal > 0,
    requirements_total: requirementsTotal,
    requirements_matched: requirementsMatched,
    match_percent: requirementsTotal > 0 ? (requirementsMatched / requirementsTotal) * 100 : null,
    overlap_terms: brief.overlap_terms.slice(0, MAX_OVERLAP_TERMS).map((entry) => entry.term),
    unmatched_requirements: unmatched.slice(0, MAX_UNMATCHED_REQUIREMENTS)
  };
}

// Shared by both the forward walk and the gap sweep below -- same computation, same upsert,
// just fed by two different queries.
async function scoreAndUpsertRow(handle, row, resumeKey, resumeUploadedAt, resumeText) {
  const match = computeMatchForPosting({
    description: row.job_description,
    resume_text: resumeText,
    posting: { position_name: row.position_name, company_name: row.company_name }
  });
  await handle.run(
    `INSERT INTO posting_match_scores
       (posting_id, resume_key, resume_uploaded_at, requirements_total, requirements_matched,
        match_percent, overlap_terms_json, unmatched_requirements_json, computed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(posting_id, resume_key) DO UPDATE SET
       resume_uploaded_at = excluded.resume_uploaded_at,
       requirements_total = excluded.requirements_total,
       requirements_matched = excluded.requirements_matched,
       match_percent = excluded.match_percent,
       overlap_terms_json = excluded.overlap_terms_json,
       unmatched_requirements_json = excluded.unmatched_requirements_json,
       computed_at = datetime('now');`,
    [
      row.id,
      resumeKey,
      resumeUploadedAt,
      match.requirements_total,
      match.requirements_matched,
      match.match_percent,
      JSON.stringify(match.overlap_terms),
      JSON.stringify(match.unmatched_requirements)
    ]
  );
}

// Incremental: only postings above last_scored_id are scored, so a run after a sync pass is
// cheap. A resume re-upload is detected by comparing its uploaded_at against the state row
// and treated as an implicit rebuild -- callers never need to invalidate this explicitly.
//
// resume_key selects which uploaded document to score against (see DEFAULT_DOCUMENT_KEY and
// listResumeDocumentKeys in applicant-documents.js); each key keeps its own state row and its
// own rows in posting_match_scores, scored independently.
async function rescoreMatches({
  resume_key: resumeKeyOption = DEFAULT_DOCUMENT_KEY,
  rebuild = false,
  batch_size = MATCH_INDEX_BATCH_SIZE,
  max_batches = Number.POSITIVE_INFINITY
} = {}) {
  const db = getDb();
  await ensureMatchTables();

  const resumeKey = String(resumeKeyOption || "").trim() || DEFAULT_DOCUMENT_KEY;
  const resumeDocument = await getApplicantDocument(resumeKey);
  const resumeText = String(resumeDocument?.text || "").trim();
  const resumeUploadedAt = String(resumeDocument?.uploaded_at || "");

  const batchSize = Math.max(1, Math.floor(Number(batch_size) || MATCH_INDEX_BATCH_SIZE));
  const maxBatches = Number.isFinite(Number(max_batches))
    ? Math.max(1, Math.floor(Number(max_batches)))
    : Number.POSITIVE_INFINITY;

  const state = await readMatchState(resumeKey);
  // A new (or newly removed) resume invalidates every score computed against the old one --
  // restart the walk from the top rather than leaving stale rows mixed in with fresh ones.
  const resumeChanged = state.resume_uploaded_at !== resumeUploadedAt;
  const effectiveRebuild = rebuild || resumeChanged;

  if (effectiveRebuild) {
    await db.run(`DELETE FROM posting_match_scores WHERE resume_key = ?;`, [resumeKey]);
    await writeMatchState(resumeKey, 0, resumeUploadedAt, 0);
  }

  let lastId = effectiveRebuild ? 0 : state.last_scored_id;
  let gapCursor = effectiveRebuild ? 0 : state.gap_scanned_id;
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
        await scoreAndUpsertRow(handle, row, resumeKey, resumeUploadedAt, resumeText);
        lastId = Number(row.id);
        scored += 1;
      }
      await writeMatchState(resumeKey, lastId, resumeUploadedAt, gapCursor);
    });
    batches += 1;

    if (rows.length < batchSize) {
      complete = true;
      break;
    }
  }

  // Gap sweep: re-check the range the forward walk has already passed for postings whose
  // description arrived late (see the GAP_SWEEP_MAX_BATCHES comment above). Skipped on a
  // rebuild -- everything up to lastId was just freshly scanned, so there are no gaps yet.
  let gapScored = 0;
  if (!effectiveRebuild) {
    const ceiling = lastId;
    let gapBatches = 0;
    while (gapBatches < GAP_SWEEP_MAX_BATCHES && gapCursor < ceiling) {
      const gapRows = await db.all(
        `SELECT p.id, p.position_name, p.company_name, p.job_description
         FROM Postings p
         LEFT JOIN posting_match_scores m ON m.posting_id = p.id AND m.resume_key = ?
         WHERE p.id > ? AND p.id <= ? AND m.posting_id IS NULL
           AND p.job_description IS NOT NULL AND TRIM(p.job_description) <> ''
         ORDER BY p.id
         LIMIT ?;`,
        [resumeKey, gapCursor, ceiling, batchSize]
      );
      if (gapRows.length === 0) {
        // Nothing left in [gapCursor, ceiling) -- wrap around so the sweep keeps
        // re-covering the whole scored range over time, not just today's backlog.
        gapCursor = 0;
        break;
      }

      await runInWriteTransaction(async (handle) => {
        for (const row of gapRows) {
          await scoreAndUpsertRow(handle, row, resumeKey, resumeUploadedAt, resumeText);
          gapCursor = Number(row.id);
          gapScored += 1;
        }
        await writeMatchState(resumeKey, lastId, resumeUploadedAt, gapCursor);
      });
      gapBatches += 1;

      if (gapRows.length < batchSize) {
        gapCursor = 0;
        break;
      }
    }
    if (gapCursor >= ceiling) gapCursor = 0;
    await writeMatchState(resumeKey, lastId, resumeUploadedAt, gapCursor);
  }

  return {
    resume_key: resumeKey,
    scored,
    since_id: effectiveRebuild ? 0 : state.last_scored_id,
    last_id: lastId,
    batches,
    complete,
    rebuilt: effectiveRebuild,
    gap_scored: gapScored
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
// instead of recomputing the brief live for every application on every request, and by the
// match_desc sort phase in postings.js, both of which only ever need one resume's scores.
async function getMatchesByPostingIds(postingIds, resumeKey = DEFAULT_DOCUMENT_KEY) {
  const ids = Array.from(new Set((postingIds || []).map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0)));
  if (ids.length === 0) return new Map();

  const db = getReadDb();
  const placeholders = ids.map(() => "?").join(", ");
  const rows = await db.all(
    `SELECT posting_id, match_percent, requirements_total, requirements_matched,
            overlap_terms_json, unmatched_requirements_json, computed_at
     FROM posting_match_scores
     WHERE resume_key = ? AND posting_id IN (${placeholders});`,
    [resumeKey, ...ids]
  );

  const byId = new Map();
  for (const row of rows) {
    const mapped = mapMatchRow(row);
    if (mapped) byId.set(mapped.posting_id, mapped);
  }
  return byId;
}

// Like getMatchesByPostingIds, but for every resume key at once -- used to attach every
// uploaded resume's score to a page of rows (see listPostingsWithFilters's include_match
// handling), so a caller sees how a posting scores against each resume without one query per
// resume. Returns posting_id -> (resume_key -> match row), only for pairs that have been
// scored.
async function getMatchesByPostingIdsForKeys(postingIds, resumeKeys) {
  const byPosting = new Map();
  const ids = Array.from(new Set((postingIds || []).map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0)));
  const keys = Array.from(new Set((resumeKeys || []).map((key) => String(key || "").trim()).filter(Boolean)));
  if (ids.length === 0 || keys.length === 0) return byPosting;

  const db = getReadDb();
  const idPlaceholders = ids.map(() => "?").join(", ");
  const keyPlaceholders = keys.map(() => "?").join(", ");
  const rows = await db.all(
    `SELECT posting_id, resume_key, match_percent, requirements_total, requirements_matched,
            overlap_terms_json, unmatched_requirements_json, computed_at
     FROM posting_match_scores
     WHERE posting_id IN (${idPlaceholders}) AND resume_key IN (${keyPlaceholders});`,
    [...ids, ...keys]
  );

  for (const row of rows) {
    const mapped = mapMatchRow(row);
    if (!mapped) continue;
    const resumeKey = String(row.resume_key || "");
    if (!byPosting.has(mapped.posting_id)) byPosting.set(mapped.posting_id, new Map());
    byPosting.get(mapped.posting_id).set(resumeKey, mapped);
  }
  return byPosting;
}

// What get_applicant_context surfaces so a caller can tell fresh scores from a backfill
// still in progress, instead of a freshly-uploaded resume silently reading as broken (see
// the match-index.conf systemd drop-in: a full corpus rescore is a ~1.5-2 day operation, not
// instant). last_run_at/last_error live in enrichment-runtime.js's in-memory state, which
// belongs to the API server process, not this one when called from mcp-apply-server.js (a
// separate process with its own DB connection) -- so this reports only what the database
// itself can answer: per-resume checkpoint position and scored/pending counts.
async function getMatchScoringStatus() {
  const db = getReadDb();
  await ensureMatchTables();

  const totalRow = await db.get(
    `SELECT COUNT(*) AS n FROM Postings WHERE job_description IS NOT NULL AND TRIM(job_description) <> '';`
  );
  const totalWithDescription = Number(totalRow?.n || 0);

  const resumeKeys = await listResumeDocumentKeys();
  const perResume = [];
  for (const resumeKey of resumeKeys) {
    const state = await readMatchState(resumeKey);
    const scoredRow = await db.get(
      `SELECT COUNT(*) AS n FROM posting_match_scores WHERE resume_key = ?;`,
      [resumeKey]
    );
    const stateRow = await db.get(
      `SELECT updated_at FROM posting_match_state WHERE resume_key = ?;`,
      [resumeKey]
    );
    const scoredCount = Number(scoredRow?.n || 0);
    const pendingCount = Math.max(0, totalWithDescription - scoredCount);
    perResume.push({
      resume_key: resumeKey,
      resume_uploaded_at: state.resume_uploaded_at,
      last_scored_id: state.last_scored_id,
      last_run_at: String(stateRow?.updated_at || "") || null,
      scored_count: scoredCount,
      pending_count: pendingCount,
      caught_up: pendingCount === 0
    });
  }

  return { total_postings_with_description: totalWithDescription, per_resume: perResume };
}

module.exports = {
  ensureMatchTables,
  computeMatchForPosting,
  rescoreMatches,
  getMatchesByPostingIds,
  getMatchesByPostingIdsForKeys,
  getMatchScoringStatus,
  MAX_OVERLAP_TERMS,
  MAX_UNMATCHED_REQUIREMENTS
};
