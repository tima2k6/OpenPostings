const { normalizePersonalInformationInput, createDefaultPersonalInformation, PERSONAL_INFORMATION_FIELDS } = require("../helpers/personal-info-normalize")
const { getDb, getReadDb, setDb, runInWriteTransaction } = require("./runtime-context.js");

async function ensurePersonalInformationTable() {
  const db = getDb();
  await db.exec(`
    CREATE TABLE IF NOT EXISTS PersonalInformation (
      first_name TEXT NOT NULL,
      middle_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone_number TEXT NOT NULL,
      address TEXT NOT NULL,
      linkedin_url TEXT NOT NULL,
      github_url TEXT NOT NULL,
      portfolio_url TEXT NOT NULL,
      resume_file_path TEXT NOT NULL,
      projects_portfolio_file_path TEXT NOT NULL,
      certifications_folder_path TEXT NOT NULL,
      ethnicity TEXT NOT NULL,
      gender TEXT NOT NULL,
      age INTEGER NOT NULL,
      veteran_status TEXT NOT NULL,
      disability_status TEXT NOT NULL,
      education_level TEXT NOT NULL,
      years_of_experience INTEGER NOT NULL
    );
  `);

  const tableInfo = await db.all(`PRAGMA table_info('PersonalInformation');`);
  const existingColumns = new Set(tableInfo.map((column) => String(column?.name || "")));

  if (!existingColumns.has("years_of_experience")) {
    await db.exec(`
      ALTER TABLE PersonalInformation
      ADD COLUMN years_of_experience INTEGER NOT NULL DEFAULT 0;
    `);
  }
}


// On the reader connection, not the writer: this is polled by every screen that shows the
// applicant's name or documents, and queuing it behind a sync write is exactly the timeout
// the app's own error message names.
async function getPersonalInformation() {
  const db = getReadDb();
  const row = await db.get(
    `
      SELECT
        first_name,
        middle_name,
        last_name,
        email,
        phone_number,
        address,
        linkedin_url,
        github_url,
        portfolio_url,
        resume_file_path,
        projects_portfolio_file_path,
        certifications_folder_path,
        ethnicity,
        gender,
        age,
        veteran_status,
        disability_status,
        education_level,
        years_of_experience
      FROM PersonalInformation
      ORDER BY rowid ASC
      LIMIT 1;
    `
  );

  if (!row) {
    return createDefaultPersonalInformation();
  }

  return normalizePersonalInformationInput(row);
}


async function upsertPersonalInformation(value) {
  const normalized = normalizePersonalInformationInput(value);
  const values = PERSONAL_INFORMATION_FIELDS.map((field) => normalized[field]);
  const updateAssignments = PERSONAL_INFORMATION_FIELDS.map((field) => `${field} = ?`).join(", ");
  const db = getDb();
  const existing = await db.get(
    `
      SELECT rowid
      FROM PersonalInformation
      ORDER BY rowid ASC
      LIMIT 1;
    `
  );

  // Serialized with every other writer: an HTTP save landing mid-sync-batch would
  // otherwise fail with "cannot start a transaction within a transaction".
  await runInWriteTransaction(async (handle) => {
    if (existing?.rowid) {
      await handle.run(
        `
          UPDATE PersonalInformation
          SET ${updateAssignments}
          WHERE rowid = ?;
        `,
        [...values, existing.rowid]
      );

      await handle.run(`DELETE FROM PersonalInformation WHERE rowid <> ?;`, [existing.rowid]);
    } else {
      await handle.run(
        `
          INSERT INTO PersonalInformation (${PERSONAL_INFORMATION_FIELDS.join(", ")})
          VALUES (${PERSONAL_INFORMATION_FIELDS.map(() => "?").join(", ")});
        `,
        values
      );
    }
  });

  return normalized;
}

module.exports = { ensurePersonalInformationTable, getPersonalInformation, upsertPersonalInformation };