// listApplications gained two additive, opt-in fields (job_fit, last_status_change_epoch)
// for the redesigned Applications page's status-priority grouping and follow-up flag -- see
// server/services/applications.js. The cases that matter: existing callers (the
// list_applications MCP tool among them) must see no shape change by default, opting in must
// actually compute both fields correctly, and status_bucket -- the field grouping is meant
// to key off, not the display-only status field -- must correctly resolve legacy free-text
// statuses ("rejected") the same way getApplicationDenialStats already does, instead of
// collapsing them into "applied" the way the display status field does.
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { openDatabase } = require("../db/open-database.js");
const { setDb, getDb } = require("../services/runtime-context.js");
const { listApplications } = require("../services/applications.js");

async function seedSchema(db) {
  await db.exec(`
    CREATE TABLE companies (
      id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      company_name TEXT NOT NULL,
      url_string TEXT NOT NULL DEFAULT '',
      ATS_name TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE applications (
      id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER,
      company_name TEXT NOT NULL DEFAULT '',
      position_name TEXT NOT NULL,
      application_date INTEGER NOT NULL,
      status TEXT,
      job_posting_url TEXT NOT NULL DEFAULT '',
      fit_assessment TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE application_status_history (
      application_id INTEGER NOT NULL,
      previous_status TEXT,
      new_status TEXT NOT NULL,
      changed_at_epoch INTEGER NOT NULL
    );
    CREATE TABLE application_attribution (
      application_id INTEGER NOT NULL PRIMARY KEY,
      applied_by_type TEXT NOT NULL DEFAULT '',
      applied_by_label TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE Postings (
      id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      job_posting_url TEXT,
      job_description TEXT
    );
  `);
}

async function seedApplication(db, { position, status, applicationDate, jobPostingUrl = "" }) {
  const result = await db.run(
    `INSERT INTO applications (company_name, position_name, application_date, status, job_posting_url)
     VALUES ('Acme', ?, ?, ?, ?);`,
    [position, applicationDate, status, jobPostingUrl]
  );
  await db.run(
    `INSERT INTO application_status_history (application_id, previous_status, new_status, changed_at_epoch)
     VALUES (?, NULL, ?, ?);`,
    [result.lastID, status, applicationDate]
  );
  return result.lastID;
}

async function withDb(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openpostings-applications-list-"));
  const previousDb = getDb();
  setDb(await openDatabase({ filename: path.join(dir, "test.db") }));
  try {
    await seedSchema(getDb());
    await run(getDb());
  } finally {
    setDb(previousDb);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function testDefaultCallDoesNotAddNewFields() {
  await withDb(async (db) => {
    await seedApplication(db, { position: "Engineer", status: "applied", applicationDate: 1000 });
    const result = await listApplications({});
    assert.strictEqual(result.items.length, 1);
    const item = result.items[0];
    assert.strictEqual(
      Object.prototype.hasOwnProperty.call(item, "job_fit"),
      false,
      "job_fit must be absent unless include_job_fit is requested"
    );
    assert.strictEqual(
      Object.prototype.hasOwnProperty.call(item, "last_status_change_epoch"),
      false,
      "last_status_change_epoch must be absent unless include_job_fit is requested"
    );
    // status_bucket is always present -- it is cheap (pure computation, no extra query) and
    // status grouping needs it to be correct by default, not opt-in.
    assert.strictEqual(item.status_bucket, "applied");
  });
}

async function testIncludeJobFitAddsBothFields() {
  await withDb(async (db) => {
    const now = Math.floor(Date.now() / 1000);
    const id = await seedApplication(db, { position: "Engineer", status: "applied", applicationDate: now - 86400 * 20 });
    // A later status change -- last_status_change_epoch must reflect this, not the original
    // application_date, since that is the whole point of tracking it separately.
    await db.run(
      `UPDATE applications SET status = 'awaiting response' WHERE id = ?;`,
      [id]
    );
    const changedAt = now - 86400 * 5;
    await db.run(
      `INSERT INTO application_status_history (application_id, previous_status, new_status, changed_at_epoch)
       VALUES (?, 'applied', 'awaiting response', ?);`,
      [id, changedAt]
    );

    const result = await listApplications({ include_job_fit: true });
    assert.strictEqual(result.items.length, 1);
    const item = result.items[0];
    assert.ok(item.job_fit && typeof item.job_fit === "object", "job_fit must be present and an object");
    // No linked posting (job_posting_url was left blank) -- a legitimate, well-shaped
    // unavailable result, not an error.
    assert.strictEqual(item.job_fit.available, false);
    assert.strictEqual(item.last_status_change_epoch, changedAt, "must be the most recent change, not application_date");
  });
}

async function testLegacyStatusResolvesToTheCorrectBucket() {
  await withDb(async (db) => {
    // "rejected" predates normalizeApplicationStatus and is not in APPLICATION_STATUS_OPTIONS
    // (see LEGACY_STATUS_ALIASES) -- getApplicationDenialStats already counts it as denied
    // for the denial-rate math; status_bucket must agree, even though the display-only
    // status field (below) still collapses it to "applied".
    await seedApplication(db, { position: "Analyst", status: "rejected", applicationDate: 1000 });
    const result = await listApplications({});
    const item = result.items[0];
    assert.strictEqual(item.status, "applied", "display status keeps its existing, safe default for unrecognized text");
    assert.strictEqual(item.status_bucket, "denied", "status_bucket must resolve the legacy alias correctly");
  });
}

async function testGenuinelyUnrecognizedStatusBucketIsNull() {
  await withDb(async (db) => {
    await seedApplication(db, { position: "Analyst", status: "some future ATS status", applicationDate: 1000 });
    const result = await listApplications({});
    assert.strictEqual(result.items[0].status_bucket, null, "a genuinely unrecognized status must not guess a bucket");
  });
}

async function main() {
  await testDefaultCallDoesNotAddNewFields();
  await testIncludeJobFitAddsBothFields();
  await testLegacyStatusResolvesToTheCorrectBucket();
  await testGenuinelyUnrecognizedStatusBucketIsNull();
  console.log("applications-list tests passed");
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = { main };
