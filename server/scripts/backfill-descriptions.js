// Fetches posting pages for rows with no stored description and persists what the page
// establishes: description text, prose-parsed pay, liveness, hiring-location
// restrictions, requires-account. Bounded per run; re-run until the summary reports
// nothing scanned.
//
//   node server/scripts/backfill-descriptions.js [limit] [concurrency]
const path = require("path");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const { setDb } = require("../services/runtime-context.js");

const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, "..", "..", "jobs.db");

async function main() {
  const db = await open({ filename: DB_PATH, driver: sqlite3.Database });
  await db.exec("PRAGMA busy_timeout = 30000;");
  setDb(db);

  const { runDescriptionBackfill } = require("../services/posting-page-fetcher.js");
  const limit = Number(process.argv[2]) > 0 ? Number(process.argv[2]) : 200;
  const concurrency = Number(process.argv[3]) > 0 ? Number(process.argv[3]) : 4;
  const summary = await runDescriptionBackfill({ limit, concurrency });
  console.log("[backfill-descriptions]", JSON.stringify(summary));
  await db.close();
}

main().catch((error) => {
  console.error("[backfill-descriptions] failed:", error);
  process.exit(1);
});
