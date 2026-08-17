// Builds (or refreshes) the resume-to-posting match cache that backs sort_by=match_desc and
// the min_match_percent filter. Incremental by default: only postings newer than the highest
// scored id are added, and a resume re-upload is detected automatically (see
// posting-match.js) and triggers a full rescore. Pass --rebuild to force one regardless.
//
// Runs once per uploaded resume-like document (listResumeDocumentKeys: "resume" plus any
// "resume_*" variant), so a second tailored resume gets scanned the moment it is uploaded
// with no further configuration. Pass --resume <key> to scan only that one key instead.
//
//   node server/scripts/build-match-index.js [--rebuild] [--batch-size 25] [--max-batches 16] [--resume <key>]
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

function readStringArg(argv, name) {
  const index = argv.indexOf(name);
  if (index < 0) return undefined;
  const value = String(argv[index + 1] || "").trim();
  return value || undefined;
}

async function main(argv = process.argv.slice(2)) {
  const db = await open({ filename: DB_PATH, driver: sqlite3.Database });
  try {
    await db.exec("PRAGMA busy_timeout = 30000;");
    setDb(db);

    const { rescoreMatches } = require("../services/posting-match.js");
    const { listResumeDocumentKeys } = require("../services/applicant-documents.js");
    const resumeArg = readStringArg(argv, "--resume");
    const resumeKeys = resumeArg ? [resumeArg] : await listResumeDocumentKeys();

    const startedAt = Date.now();
    const perResume = {};
    let scored = 0;
    let rebuilt = false;
    for (const resumeKey of resumeKeys) {
      // Sequential, not Promise.all: every resume's scan writes through the same serialized
      // write-transaction chain (runInWriteTransaction) regardless, so there is no
      // concurrency to gain by running these in parallel.
      const summary = await rescoreMatches({
        resume_key: resumeKey,
        rebuild: argv.includes("--rebuild"),
        batch_size: readPositiveIntegerArg(argv, "--batch-size", undefined),
        max_batches: readPositiveIntegerArg(argv, "--max-batches", undefined)
      });
      perResume[resumeKey] = summary;
      scored += summary.scored;
      rebuilt = rebuilt || summary.rebuilt;
    }

    const summary = { scored, rebuilt, per_resume: perResume };
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
