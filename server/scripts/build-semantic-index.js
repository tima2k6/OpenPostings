// Builds (or refreshes) the FTS5 index that backs find_similar_postings / similar_to.
// Incremental by default: only postings newer than the highest indexed id are added, so
// running this after a sync pass is cheap. Pass --rebuild to discard and start over,
// which is what you want after descriptions have been re-fetched in place.
//
//   node server/scripts/build-semantic-index.js [--rebuild]
const path = require("path");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const { setDb } = require("../services/runtime-context.js");

const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, "..", "..", "jobs.db");

async function main() {
  const db = await open({ filename: DB_PATH, driver: sqlite3.Database });
  await db.exec("PRAGMA busy_timeout = 30000;");
  setDb(db);

  const { rebuildSemanticIndex } = require("../services/semantic-search.js");
  const startedAt = Date.now();
  const summary = await rebuildSemanticIndex({ rebuild: process.argv.includes("--rebuild") });
  console.log(
    `[build-semantic-index] ${JSON.stringify(summary)} in ${Math.round((Date.now() - startedAt) / 1000)}s`
  );
  await db.close();
}

main().catch((error) => {
  console.error("[build-semantic-index] failed:", error);
  process.exit(1);
});
