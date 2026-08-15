const { getDb, getReadDb, setDb } = require("./runtime-context.js");
const { normalizeCompanyNameForBlockList } = require("../helpers/normalize-ats.js")
const { nowEpochSeconds } = require("../helpers/normalize-numbers.js")
async function ensureBlockedCompaniesTable() {
  const db = getDb();
  await db.exec(`
    CREATE TABLE IF NOT EXISTS blocked_companies (
      normalized_company_name TEXT NOT NULL PRIMARY KEY,
      company_name TEXT NOT NULL,
      blocked_at_epoch INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_blocked_companies_company_name
      ON blocked_companies(company_name);
  `);
}

// On the reader connection, not the writer -- see getPersonalInformation for why.
async function listBlockedCompanies() {
  const db = getReadDb();
  const rows = await db.all(`
    SELECT normalized_company_name, company_name, blocked_at_epoch
    FROM blocked_companies
    ORDER BY company_name ASC;
  `);

  return rows.map((row) => ({
    normalized_company_name: String(row?.normalized_company_name || ""),
    company_name: String(row?.company_name || ""),
    blocked_at_epoch: Number(row?.blocked_at_epoch || 0)
  }));
}

async function blockCompanyByName(rawCompanyName) {
  const companyName = String(rawCompanyName || "").trim();
  const normalizedCompanyName = normalizeCompanyNameForBlockList(companyName);
  if (!companyName || !normalizedCompanyName) {
    throw new Error("company_name is required");
  }
  const db = getDb();
  await db.run(
    `
      INSERT INTO blocked_companies (
        normalized_company_name,
        company_name,
        blocked_at_epoch
      ) VALUES (?, ?, ?)
      ON CONFLICT(normalized_company_name) DO UPDATE SET
        company_name = excluded.company_name,
        blocked_at_epoch = excluded.blocked_at_epoch;
    `,
    [normalizedCompanyName, companyName, nowEpochSeconds()]
  );

  return db.get(
    `
      SELECT normalized_company_name, company_name, blocked_at_epoch
      FROM blocked_companies
      WHERE normalized_company_name = ?
      LIMIT 1;
    `,
    [normalizedCompanyName]
  );
}

async function unblockCompanyByName(rawCompanyName) {
  const normalizedCompanyName = normalizeCompanyNameForBlockList(rawCompanyName);
  if (!normalizedCompanyName) {
    throw new Error("company_name is required");
  }
  const db = getDb();
  const result = await db.run(
    `
      DELETE FROM blocked_companies
      WHERE normalized_company_name = ?;
    `,
    [normalizedCompanyName]
  );

  return Number(result?.changes || 0) > 0;
}

module.exports = { ensureBlockedCompaniesTable, listBlockedCompanies, blockCompanyByName, unblockCompanyByName };