// Builds the covering index that makes the /postings wide-scan search path stop reading the
// table. Run once; it is idempotent (CREATE INDEX IF NOT EXISTS).
//
//   node server/scripts/build-search-covering-index.js [--force] [--drop] [--defer-if-busy]
//
// Why this exists. The filtered-listing search matches with
// `LOWER(company_name|position_name|location) LIKE '%term%'`, which no index can seek. That
// is survivable on its own -- what is not is that SQLite has to fetch each row from the table
// to read those three columns, so a search walks the visible set as ~1M random page reads
// against an 8.7GB file. Measured 2026-08-19 on the live database:
//
//   one wide-scan chunk, term "kubernetes"        65.5s   (returned 150 rows)
//   same predicate, whole table, covering index    3.8s   (idx_postings_position_name)
//
// The difference is entirely the table lookups. An index carrying the sort keys *and* the
// three searched columns lets the same walk run index-only: SQLite scans it in
// last_seen_epoch/id order (which is already the wide scan's ORDER BY), evaluates all three
// LIKEs from the index entry, and touches the table only for the rows that survive into the
// page being returned.
//
// Column order is the query's, not alphabetical: hidden is an equality, last_seen_epoch and
// id supply the ordering (and the seek predicate the chunked walk resumes on), and the three
// text columns ride along only to be read. Reordering them would cost the free ORDER BY.
//
// Cost: ~160MB on a 1.88M-row corpus (measured: ~65 bytes of searched text per row). Building
// it holds the write lock for the duration, which is why this refuses to run while a sync is
// flushing -- see the guard below.
const path = require("path");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");

const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, "..", "..", "jobs.db");
const STATUS_URL = process.env.OPENPOSTINGS_STATUS_URL || "http://127.0.0.1:8787/sync/status";
const INDEX_NAME = "idx_postings_search_covering";

const CREATE_SQL = `
  CREATE INDEX IF NOT EXISTS ${INDEX_NAME}
    ON Postings(hidden, last_seen_epoch, id, company_name, position_name, location);
`;

// A CREATE INDEX over this table takes the write lock for minutes. The sync's flushes take it
// in bursts and have historically responded badly to being locked out (SQLITE_BUSY during a
// flush is what one earlier incident escalated into a table rebuild), so the default is to
// refuse rather than to race it. --force skips the check for the case where the API is down
// and nothing else can be writing.
async function assertNoSyncRunning(argv) {
  if (argv.includes("--force")) return;
  let status = null;
  try {
    const response = await fetch(STATUS_URL, { signal: AbortSignal.timeout(30000) });
    status = await response.json();
  } catch (error) {
    throw new Error(
      `Could not reach ${STATUS_URL} to confirm no sync is running (${error?.message || error}). ` +
        `Start the API, or pass --force if you know nothing is writing to the database.`
    );
  }
  if (status?.running) {
    const progress = status.progress || {};
    throw new Error(
      `A sync is running (${progress.current ?? "?"}/${progress.total ?? "?"} targets, ` +
        `eta ${Math.round(Number(progress.eta_seconds || 0) / 60)}m). Building this index would ` +
        `hold the write lock against its flushes. Wait for the pass to finish, or pass --force.`
    );
  }
}

async function main(argv = process.argv.slice(2)) {
  // --defer-if-busy is for the systemd timer that retries this until a sync window opens: a
  // sync in progress is the expected state most of the time, not a failure, and surfacing it
  // as one would leave the unit permanently `failed` and bury the real errors. Anything other
  // than "a sync is running" still throws.
  try {
    await assertNoSyncRunning(argv);
  } catch (error) {
    if (argv.includes("--defer-if-busy") && /A sync is running/.test(String(error?.message || ""))) {
      console.log(`[build-search-covering-index] deferred: ${error.message}`);
      return { deferred: true };
    }
    throw error;
  }

  const db = await open({ filename: DB_PATH, driver: sqlite3.Database });
  try {
    // Long, because that is the point: this statement is expected to take minutes, and a
    // short timeout would abandon the work partway rather than wait out a transient lock.
    await db.exec("PRAGMA busy_timeout = 600000;");

    if (argv.includes("--drop")) {
      const startedAt = Date.now();
      await db.exec(`DROP INDEX IF EXISTS ${INDEX_NAME};`);
      console.log(
        `[build-search-covering-index] dropped ${INDEX_NAME} in ${Math.round((Date.now() - startedAt) / 1000)}s`
      );
      return { dropped: true };
    }

    const existing = await db.get(
      `SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?;`,
      [INDEX_NAME]
    );
    if (existing) {
      console.log(`[build-search-covering-index] ${INDEX_NAME} already exists; nothing to do`);
      return { created: false };
    }

    const startedAt = Date.now();
    await db.exec(CREATE_SQL);
    const elapsedSeconds = Math.round((Date.now() - startedAt) / 1000);
    // ANALYZE so the planner has statistics for the new index rather than guessing -- without
    // it SQLite can keep preferring the narrower index it already knows.
    await db.exec("ANALYZE Postings;");
    console.log(`[build-search-covering-index] created ${INDEX_NAME} in ${elapsedSeconds}s`);
    return { created: true, elapsed_seconds: elapsedSeconds };
  } finally {
    await db.close();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error("[build-search-covering-index] failed:", error?.message || error);
    process.exit(1);
  });
}

module.exports = { main, INDEX_NAME, CREATE_SQL };
