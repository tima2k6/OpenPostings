const assert = require("assert");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const { setDb } = require("../services/runtime-context.js");
const {
  ensurePostingReviewSchema,
  setPostingReviewState,
  setPostingIgnoredCompatibility
} = require("../services/posting-review.js");

async function main() {
  const db = await open({ filename: ":memory:", driver: sqlite3.Database });
  setDb(db);
  await db.exec(`
    CREATE TABLE posting_application_state (
      job_posting_url TEXT NOT NULL PRIMARY KEY,
      applied INTEGER NOT NULL DEFAULT 0,
      applied_by_type TEXT NOT NULL DEFAULT 'manual',
      applied_by_label TEXT NOT NULL DEFAULT '',
      applied_at_epoch INTEGER,
      last_application_id INTEGER,
      ignored INTEGER NOT NULL DEFAULT 0,
      ignored_at_epoch INTEGER,
      ignored_by_label TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO posting_application_state
      (job_posting_url, applied, ignored, ignored_at_epoch, ignored_by_label)
    VALUES ('https://example.com/ignored', 0, 1, 100, 'Old ignore');
    INSERT INTO posting_application_state
      (job_posting_url, applied, ignored)
    VALUES ('https://example.com/applied', 1, 0);
  `);

  await ensurePostingReviewSchema(db);
  const migratedIgnored = await db.get(
    `SELECT review_state, applied FROM posting_application_state WHERE job_posting_url = 'https://example.com/ignored';`
  );
  assert.strictEqual(migratedIgnored.review_state, "ignored", "legacy ignored rows must not resurface");
  const migratedApplied = await db.get(
    `SELECT review_state, applied FROM posting_application_state WHERE job_posting_url = 'https://example.com/applied';`
  );
  assert.strictEqual(migratedApplied.applied, 1, "migration must preserve application lifecycle state");

  const shortlisted = await setPostingReviewState({
    job_posting_url: "https://example.com/role",
    review_state: "shortlisted",
    transition_epoch: 200
  });
  const shortlistedAgain = await setPostingReviewState({
    job_posting_url: "https://example.com/role",
    review_state: "shortlisted",
    transition_epoch: 300
  });
  assert.strictEqual(shortlisted.review_state, "shortlisted");
  assert.strictEqual(shortlistedAgain.shortlisted_at_epoch, 200, "idempotent transitions preserve their first timestamp");

  const unshortlisted = await setPostingReviewState({
    job_posting_url: "https://example.com/role",
    review_state: "viewed",
    transition_epoch: 400
  });
  assert.strictEqual(unshortlisted.review_state, "viewed");
  const unshortlistedAgain = await setPostingReviewState({
    job_posting_url: "https://example.com/role",
    review_state: "viewed",
    transition_epoch: 450
  });
  assert.strictEqual(
    unshortlistedAgain.review_state_changed_at_epoch,
    unshortlisted.review_state_changed_at_epoch,
    "repeating an un-shortlist transition is idempotent"
  );

  const ignored = await setPostingIgnoredCompatibility({
    job_posting_url: "https://example.com/applied",
    ignored: true,
    ignored_by_label: "Not a fit",
    ignored_at_epoch: 500
  });
  assert.strictEqual(ignored.review_state, "ignored");
  assert.strictEqual(ignored.applied, true, "review state must not erase applied state");

  const restored = await setPostingIgnoredCompatibility({
    job_posting_url: "https://example.com/applied",
    ignored: false
  });
  assert.strictEqual(restored.review_state, "viewed");
  assert.strictEqual(restored.applied, true);

  await db.close();
  console.log("posting-review tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
