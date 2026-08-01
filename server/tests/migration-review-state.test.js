const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "openpostings-review-migration-"));
const targetPath = path.join(directory, "target.db");
const sourcePath = path.join(directory, "source.db");
process.env.DB_PATH = targetPath;

const { setDb } = require("../services/runtime-context.js");
const { migrateSettingsAndApplicationsFromDatabase } = require("../services/migration.js");

const STATE_SCHEMA = `
  CREATE TABLE posting_application_state (
    job_posting_url TEXT PRIMARY KEY,
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
`;

async function main() {
  const target = await open({ filename: targetPath, driver: sqlite3.Database });
  setDb(target);
  await target.exec(`
    CREATE TABLE companies (id INTEGER PRIMARY KEY, company_name TEXT NOT NULL, url_string TEXT NOT NULL, ATS_name TEXT NOT NULL);
    INSERT INTO companies VALUES (1, 'Example Co', 'https://example.com', 'greenhouse');
    CREATE TABLE applications (
      id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER, company_name TEXT NOT NULL DEFAULT '',
      position_name TEXT NOT NULL, application_date INTEGER NOT NULL, status TEXT
    );
    CREATE TABLE application_attribution (
      application_id INTEGER PRIMARY KEY, applied_by_type TEXT NOT NULL, applied_by_label TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    ${STATE_SCHEMA}
  `);

  const source = await open({ filename: sourcePath, driver: sqlite3.Database });
  await source.exec(`
    CREATE TABLE companies (id INTEGER PRIMARY KEY, company_name TEXT NOT NULL);
    INSERT INTO companies VALUES (9, 'Example Co');
    CREATE TABLE applications (
      id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL, position_name TEXT NOT NULL,
      application_date INTEGER NOT NULL, status TEXT
    );
    INSERT INTO applications VALUES (7, 9, 'Engineer', 1234, 'applied');
    CREATE TABLE application_attribution (
      application_id INTEGER PRIMARY KEY, applied_by_type TEXT NOT NULL, applied_by_label TEXT NOT NULL
    );
    INSERT INTO application_attribution VALUES (7, 'manual', 'Imported application');
    ${STATE_SCHEMA}
    INSERT INTO posting_application_state (
      job_posting_url, applied, applied_by_type, applied_by_label, applied_at_epoch,
      last_application_id, ignored, ignored_at_epoch, ignored_by_label
    ) VALUES ('https://example.com/role', 1, 'manual', 'Imported application', 1234, 7, 1, 1300, 'Not a fit');
  `);
  await source.close();

  const summary = await migrateSettingsAndApplicationsFromDatabase(sourcePath, {
    personal_information: false,
    mcp_settings: false,
    blocked_companies: false,
    applications: true
  });
  assert.strictEqual(summary.applications_inserted, 1);
  assert.strictEqual(summary.posting_application_state_upserts, 1);
  const state = await target.get(`SELECT * FROM posting_application_state WHERE job_posting_url = ?;`, ["https://example.com/role"]);
  assert.strictEqual(state.applied, 1, "existing application state must survive migration");
  assert.strictEqual(state.review_state, "ignored", "legacy ignored state must migrate canonically");
  assert.strictEqual(state.ignored, 1, "the compatibility projection remains available");
  assert(state.last_application_id, "the imported state points to the migrated application id");

  await target.close();
  console.log("migration-review-state tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
