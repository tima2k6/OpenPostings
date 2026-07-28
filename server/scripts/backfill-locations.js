// One-time backfill of the structured location columns (city, state_region, country,
// is_remote, locations_json) for rows written before the columns existed.
//
// Safe to run while the API server is up: it waits out write locks and commits in small
// batches. Resumable: rows are marked with locations_json='[]' when the parse yields
// nothing, so only never-parsed rows (locations_json IS NULL) are picked up on a re-run.
//
//   node server/scripts/backfill-locations.js
const path = require("path");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const { parsePostingLocation, serializeLocationsJson } = require("../helpers/parse-location.js");
const { inferPostingLocationFromJobUrl } = require("../helpers/normalize-ats.js");

const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, "..", "..", "jobs.db");
const BATCH_SIZE = 5000;

const COLUMN_MIGRATIONS = [
  ["city", "ALTER TABLE Postings ADD COLUMN city TEXT;"],
  ["state_region", "ALTER TABLE Postings ADD COLUMN state_region TEXT;"],
  ["country", "ALTER TABLE Postings ADD COLUMN country TEXT;"],
  ["is_remote", "ALTER TABLE Postings ADD COLUMN is_remote INTEGER NOT NULL DEFAULT 0;"],
  ["locations_json", "ALTER TABLE Postings ADD COLUMN locations_json TEXT;"]
];

async function main() {
  const db = await open({ filename: DB_PATH, driver: sqlite3.Database });
  await db.exec("PRAGMA busy_timeout = 30000;");

  const columns = new Set((await db.all(`PRAGMA table_info('Postings');`)).map((c) => String(c?.name || "")));
  for (const [name, ddl] of COLUMN_MIGRATIONS) {
    if (!columns.has(name)) await db.exec(ddl);
  }

  const parseCache = new Map();
  const parseFor = (locationText) => {
    const key = String(locationText || "");
    const cached = parseCache.get(key);
    if (cached) return cached;
    const parsed = parsePostingLocation(key);
    if (parseCache.size > 200000) parseCache.clear();
    parseCache.set(key, parsed);
    return parsed;
  };

  let updated = 0;
  let lastId = 0;
  const startedAt = Date.now();
  for (;;) {
    const rows = await db.all(
      `SELECT id, location, job_posting_url
       FROM Postings
       WHERE locations_json IS NULL AND id > ?
       ORDER BY id
       LIMIT ${BATCH_SIZE};`,
      [lastId]
    );
    if (rows.length === 0) break;

    await db.exec("BEGIN TRANSACTION;");
    try {
      for (const row of rows) {
        lastId = Number(row.id);
        const locationText =
          String(row.location || "").trim() || inferPostingLocationFromJobUrl(row.job_posting_url) || "";
        const parsed = parseFor(locationText);
        await db.run(
          `UPDATE Postings
           SET city = ?, state_region = ?, country = ?, is_remote = ?,
               locations_json = ?
           WHERE id = ?;`,
          [
            parsed.city,
            parsed.state_region,
            parsed.country,
            parsed.is_remote,
            serializeLocationsJson(parsed.locations) || "[]",
            row.id
          ]
        );
        updated += 1;
      }
      await db.exec("COMMIT;");
    } catch (error) {
      await db.exec("ROLLBACK;");
      throw error;
    }
    if (updated % 50000 < BATCH_SIZE) {
      console.log(`[backfill-locations] ${updated} rows, ${Math.round((Date.now() - startedAt) / 1000)}s elapsed`);
    }
  }

  console.log(`[backfill-locations] done: ${updated} rows in ${Math.round((Date.now() - startedAt) / 1000)}s`);
  await db.close();
}

main().catch((error) => {
  console.error("[backfill-locations] failed:", error);
  process.exit(1);
});
