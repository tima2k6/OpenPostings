// Builds (or refreshes) the trigram FTS5 index that backs the /postings search filter.
// Incremental by default; --rebuild discards and starts over.
//
//   node server/scripts/build-search-index.js [--rebuild] [--batch-size 500] [--max-batches 20]
//   node server/scripts/build-search-index.js --refresh-only
//
// Runs in its own process so a long build never occupies the API's event loop, matching how
// the semantic and match index workers are run.
const path = require("path");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const { setDb } = require("../services/runtime-context.js");
const { readPositiveIntegerArg } = require("./build-semantic-index.js");

const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, "..", "..", "jobs.db");

async function main(argv = process.argv.slice(2)) {
  const db = await open({ filename: DB_PATH, driver: sqlite3.Database });
  try {
    await db.exec("PRAGMA busy_timeout = 30000;");
    setDb(db);

    const { buildSearchIndex, refreshSearchIndex } = require("../services/search-index.js");
    const startedAt = Date.now();
    const rebuild = argv.includes("--rebuild");
    const refreshOnly = argv.includes("--refresh-only");

    const summary = refreshOnly
      ? { indexed: 0, skipped_forward_pass: true }
      : await buildSearchIndex({
          rebuild,
          batch_size: readPositiveIntegerArg(argv, "--batch-size", undefined),
          max_batches: readPositiveIntegerArg(argv, "--max-batches", undefined)
        });

    // The forward pass only moves up. The sweep is what keeps already-indexed rows correct:
    // it re-writes each row it visits, so a location the backfill changed is picked up and a
    // posting that has since been hidden is dropped. Skipped right after a --rebuild, which
    // has just written every visible row from scratch.
    if (!rebuild) {
      try {
        const refreshed = await refreshSearchIndex({
          batch_size: readPositiveIntegerArg(argv, "--refresh-batch-size", undefined),
          max_batches: readPositiveIntegerArg(argv, "--refresh-max-batches", undefined)
        });
        summary.refreshed = refreshed.refreshed;
        summary.pruned = refreshed.pruned;
        summary.refreshed_id = refreshed.refreshed_id;
        summary.refresh_complete = refreshed.complete;
      } catch (error) {
        summary.refresh_error = String(error?.message || error);
      }
    }

    console.log(
      `[build-search-index] ${JSON.stringify(summary)} in ${Math.round((Date.now() - startedAt) / 1000)}s`
    );
    return summary;
  } finally {
    setDb(null);
    await db.close();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error("[build-search-index] failed:", error);
    process.exit(1);
  });
}

module.exports = { main };
