// Builds (or refreshes) the resume-to-posting match cache that backs sort_by=match_desc and
// the min_match_percent filter. Incremental by default: only postings newer than the highest
// scored id are added, and a resume re-upload is detected automatically (see
// posting-match.js) and triggers a full rescore. Pass --rebuild to force one regardless.
//
//   node server/scripts/build-match-index.js [--rebuild] [--batch-size 25] [--max-batches 16]
const path = require("path");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const { setDb } = require("../services/runtime-context.js");

const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, "..", "..", "jobs.db");

function readPositiveIntegerArg(argv, name, fallback) {
  const index = argv.indexOf(name);
  if (index < 0) return fallback;
  const value = Number(argv[index + 1]);
  if (!Number.isFinite(value) || value < 1) {
    throw new Error(`${name} requires a positive integer.`);
  }
  return Math.floor(value);
}

async function main(argv = process.argv.slice(2)) {
  const db = await open({ filename: DB_PATH, driver: sqlite3.Database });
  try {
    await db.exec("PRAGMA busy_timeout = 30000;");
    setDb(db);

    const { rescoreMatches } = require("../services/posting-match.js");
    const startedAt = Date.now();
    const summary = await rescoreMatches({
      rebuild: argv.includes("--rebuild"),
      batch_size: readPositiveIntegerArg(argv, "--batch-size", undefined),
      max_batches: readPositiveIntegerArg(argv, "--max-batches", undefined)
    });
    console.log(
      `[build-match-index] ${JSON.stringify(summary)} in ${Math.round((Date.now() - startedAt) / 1000)}s`
    );
    return summary;
  } finally {
    setDb(null);
    await db.close();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error("[build-match-index] failed:", error);
    process.exit(1);
  });
}

module.exports = { main, readPositiveIntegerArg };
