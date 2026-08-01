const { nowEpochSeconds, normalizeBoolean } = require("../helpers/normalize-numbers.js");
const { normalizeIgnoredByLabel } = require("../helpers/normalize-strings.js");
const { getDb, runInWriteTransaction } = require("./runtime-context.js");

const REVIEW_STATES = Object.freeze(["unseen", "viewed", "shortlisted", "ignored"]);

function normalizeReviewState(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!REVIEW_STATES.includes(normalized)) {
    throw new Error(`review_state must be one of: ${REVIEW_STATES.join(", ")}`);
  }
  return normalized;
}

async function ensurePostingReviewSchema(db = getDb()) {
  const columns = await db.all(`PRAGMA table_info('posting_application_state');`);
  const names = new Set(columns.map((column) => String(column?.name || "")));
  if (!names.has("review_state")) {
    await db.exec(`ALTER TABLE posting_application_state ADD COLUMN review_state TEXT NOT NULL DEFAULT 'unseen';`);
  }
  if (!names.has("review_state_changed_at_epoch")) {
    await db.exec(`ALTER TABLE posting_application_state ADD COLUMN review_state_changed_at_epoch INTEGER;`);
  }
  if (!names.has("viewed_at_epoch")) {
    await db.exec(`ALTER TABLE posting_application_state ADD COLUMN viewed_at_epoch INTEGER;`);
  }
  if (!names.has("shortlisted_at_epoch")) {
    await db.exec(`ALTER TABLE posting_application_state ADD COLUMN shortlisted_at_epoch INTEGER;`);
  }

  // Old ignored rows are authoritative. Migrating them before reads prevents a previously
  // rejected role from resurfacing in the New queue.
  await db.run(`
    UPDATE posting_application_state
    SET review_state = 'ignored',
        review_state_changed_at_epoch = COALESCE(review_state_changed_at_epoch, ignored_at_epoch),
        viewed_at_epoch = COALESCE(viewed_at_epoch, ignored_at_epoch)
    WHERE COALESCE(ignored, 0) = 1 AND review_state <> 'ignored';
  `);
  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_posting_application_state_review_state
      ON posting_application_state(review_state);
    CREATE INDEX IF NOT EXISTS idx_posting_application_state_review_changed
      ON posting_application_state(review_state, review_state_changed_at_epoch);
  `);
}

function mapReviewRow(row, jobPostingUrl) {
  const reviewState = REVIEW_STATES.includes(String(row?.review_state || ""))
    ? String(row.review_state)
    : Boolean(Number(row?.ignored || 0))
      ? "ignored"
      : "unseen";
  return {
    job_posting_url: jobPostingUrl,
    review_state: reviewState,
    review_state_changed_at_epoch: Number(row?.review_state_changed_at_epoch || 0),
    viewed_at_epoch: Number(row?.viewed_at_epoch || 0),
    shortlisted_at_epoch: Number(row?.shortlisted_at_epoch || 0),
    ignored: reviewState === "ignored",
    ignored_at_epoch: Number(row?.ignored_at_epoch || 0),
    ignored_by_label: reviewState === "ignored" ? normalizeIgnoredByLabel(row?.ignored_by_label) : "",
    applied: Boolean(Number(row?.applied || 0))
  };
}

async function setPostingReviewState(payload) {
  const jobPostingUrl = String(payload?.job_posting_url || "").trim();
  if (!jobPostingUrl) throw new Error("job_posting_url is required");
  const reviewState = normalizeReviewState(payload?.review_state);
  const transitionEpoch = Number(payload?.transition_epoch || nowEpochSeconds());
  const ignoredByLabel = normalizeIgnoredByLabel(payload?.ignored_by_label);

  return runInWriteTransaction(async (db) => {
    const existing = await db.get(
      `SELECT * FROM posting_application_state WHERE job_posting_url = ? LIMIT 1;`,
      [jobPostingUrl]
    );
    const previousState = existing
      ? Boolean(Number(existing?.ignored || 0))
        ? "ignored"
        : String(existing?.review_state || "unseen")
      : "unseen";
    const changed = previousState !== reviewState;

    await db.run(
      `
        INSERT INTO posting_application_state (
          job_posting_url, applied, applied_by_type, applied_by_label,
          ignored, ignored_at_epoch, ignored_by_label,
          review_state, review_state_changed_at_epoch, viewed_at_epoch,
          shortlisted_at_epoch, updated_at
        ) VALUES (?, 0, 'manual', '', ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(job_posting_url) DO UPDATE SET
          review_state = excluded.review_state,
          review_state_changed_at_epoch = CASE
            WHEN posting_application_state.review_state = excluded.review_state
              THEN posting_application_state.review_state_changed_at_epoch
            ELSE excluded.review_state_changed_at_epoch
          END,
          viewed_at_epoch = CASE
            WHEN excluded.review_state IN ('viewed', 'shortlisted', 'ignored')
              THEN COALESCE(posting_application_state.viewed_at_epoch, excluded.viewed_at_epoch)
            ELSE posting_application_state.viewed_at_epoch
          END,
          shortlisted_at_epoch = CASE
            WHEN excluded.review_state = 'shortlisted'
              THEN COALESCE(posting_application_state.shortlisted_at_epoch, excluded.shortlisted_at_epoch)
            ELSE posting_application_state.shortlisted_at_epoch
          END,
          ignored = excluded.ignored,
          ignored_at_epoch = CASE WHEN excluded.ignored = 1
            THEN COALESCE(posting_application_state.ignored_at_epoch, excluded.ignored_at_epoch)
            ELSE NULL END,
          ignored_by_label = CASE WHEN excluded.ignored = 1 THEN excluded.ignored_by_label ELSE '' END,
          updated_at = CASE WHEN posting_application_state.review_state = excluded.review_state
            THEN posting_application_state.updated_at ELSE datetime('now') END;
      `,
      [
        jobPostingUrl,
        reviewState === "ignored" ? 1 : 0,
        reviewState === "ignored" ? transitionEpoch : null,
        reviewState === "ignored" ? ignoredByLabel : "",
        reviewState,
        changed ? transitionEpoch : existing?.review_state_changed_at_epoch || null,
        ["viewed", "shortlisted", "ignored"].includes(reviewState) ? transitionEpoch : null,
        reviewState === "shortlisted" ? transitionEpoch : null
      ]
    );

    const row = await db.get(
      `SELECT * FROM posting_application_state WHERE job_posting_url = ? LIMIT 1;`,
      [jobPostingUrl]
    );
    return mapReviewRow(row, jobPostingUrl);
  });
}

async function setPostingIgnoredCompatibility(payload) {
  const jobPostingUrl = String(payload?.job_posting_url || "").trim();
  if (!jobPostingUrl) throw new Error("job_posting_url is required");
  const ignored = normalizeBoolean(payload?.ignored, true);
  if (ignored) {
    return setPostingReviewState({
      ...payload,
      job_posting_url: jobPostingUrl,
      review_state: "ignored",
      transition_epoch: payload?.ignored_at_epoch
    });
  }

  const existing = await getDb().get(
    `SELECT review_state, ignored FROM posting_application_state WHERE job_posting_url = ? LIMIT 1;`,
    [jobPostingUrl]
  );
  const currentState = Boolean(Number(existing?.ignored || 0)) ? "ignored" : String(existing?.review_state || "unseen");
  return setPostingReviewState({
    job_posting_url: jobPostingUrl,
    review_state: currentState === "ignored" ? "viewed" : currentState
  });
}

module.exports = {
  REVIEW_STATES,
  normalizeReviewState,
  ensurePostingReviewSchema,
  setPostingReviewState,
  setPostingIgnoredCompatibility,
  mapReviewRow
};
