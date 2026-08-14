const { getDb } = require("./runtime-context.js");
const { nowEpochSeconds } = require("../helpers/normalize-numbers.js");

async function ensureSavedJobSearchesTable() {
  const db = getDb();
  await db.exec(`
    CREATE TABLE IF NOT EXISTS saved_job_searches (
      id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      search_text TEXT NOT NULL DEFAULT '',
      filters_json TEXT NOT NULL DEFAULT '{}',
      created_at_epoch INTEGER NOT NULL,
      updated_at_epoch INTEGER NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_saved_job_searches_name
      ON saved_job_searches(LOWER(name));
  `);
}

function toItem(row) {
  let filters = {};
  try {
    const parsed = JSON.parse(row?.filters_json || "{}");
    filters = parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    filters = {};
  }
  return {
    id: Number(row?.id || 0),
    name: String(row?.name || ""),
    search: String(row?.search_text || ""),
    filters,
    created_at_epoch: Number(row?.created_at_epoch || 0),
    updated_at_epoch: Number(row?.updated_at_epoch || 0)
  };
}

function isUniqueConstraintError(error) {
  return String(error?.message || "").includes("UNIQUE");
}

async function listSavedJobSearches() {
  const db = getDb();
  const rows = await db.all(`
    SELECT id, name, search_text, filters_json, created_at_epoch, updated_at_epoch
    FROM saved_job_searches
    ORDER BY LOWER(name) ASC;
  `);
  return rows.map(toItem);
}

async function createSavedJobSearch({ name, search, filters } = {}) {
  const trimmedName = String(name || "").trim();
  if (!trimmedName) {
    throw new Error("name is required");
  }
  const db = getDb();
  const now = nowEpochSeconds();
  let insertedId;
  try {
    const result = await db.run(
      `
        INSERT INTO saved_job_searches (name, search_text, filters_json, created_at_epoch, updated_at_epoch)
        VALUES (?, ?, ?, ?, ?);
      `,
      [trimmedName, String(search || ""), JSON.stringify(filters && typeof filters === "object" ? filters : {}), now, now]
    );
    insertedId = result?.lastID;
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new Error(`A saved search named "${trimmedName}" already exists`);
    }
    throw error;
  }

  const row = await db.get(`SELECT * FROM saved_job_searches WHERE id = ?;`, [insertedId]);
  return toItem(row);
}

async function updateSavedJobSearch(id, { name, search, filters } = {}) {
  const searchId = Number(id);
  if (!Number.isFinite(searchId) || searchId <= 0) {
    throw new Error("id must be a positive number");
  }
  const db = getDb();
  const existing = await db.get(`SELECT * FROM saved_job_searches WHERE id = ?;`, [searchId]);
  if (!existing) {
    return null;
  }

  const nextName = name !== undefined ? String(name || "").trim() : existing.name;
  if (!nextName) {
    throw new Error("name is required");
  }
  const nextSearch = search !== undefined ? String(search || "") : existing.search_text;
  const nextFiltersJson =
    filters !== undefined ? JSON.stringify(filters && typeof filters === "object" ? filters : {}) : existing.filters_json;

  try {
    await db.run(
      `
        UPDATE saved_job_searches
        SET name = ?, search_text = ?, filters_json = ?, updated_at_epoch = ?
        WHERE id = ?;
      `,
      [nextName, nextSearch, nextFiltersJson, nowEpochSeconds(), searchId]
    );
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new Error(`A saved search named "${nextName}" already exists`);
    }
    throw error;
  }

  const row = await db.get(`SELECT * FROM saved_job_searches WHERE id = ?;`, [searchId]);
  return toItem(row);
}

async function deleteSavedJobSearch(id) {
  const searchId = Number(id);
  if (!Number.isFinite(searchId) || searchId <= 0) {
    throw new Error("id must be a positive number");
  }
  const db = getDb();
  const result = await db.run(`DELETE FROM saved_job_searches WHERE id = ?;`, [searchId]);
  return Number(result?.changes || 0) > 0;
}

module.exports = {
  ensureSavedJobSearchesTable,
  listSavedJobSearches,
  createSavedJobSearch,
  updateSavedJobSearch,
  deleteSavedJobSearch
};
