// One-time physical compaction after a large retention purge or index rebuild.
//
// Stop the API server, MCP server and every other process using the database first, then:
//   npm run maintenance:compact-db -- --yes
//
// VACUUM rewrites the database and can need temporary disk space close to the compacted
// database's final size. It is intentionally never run from the API process: on a multi-GB
// database it is an explicit maintenance window, not background work.
const fs = require("fs");
const path = require("path");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");

const DEFAULT_DB_PATH = path.resolve(__dirname, "..", "..", "jobs.db");

function formatBytes(value) {
  const bytes = Math.max(0, Number(value) || 0);
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KiB", "MiB", "GiB", "TiB"];
  let amount = bytes;
  let unit = "B";
  for (const nextUnit of units) {
    amount /= 1024;
    unit = nextUnit;
    if (amount < 1024) break;
  }
  return `${amount.toFixed(2)} ${unit}`;
}

async function compactDatabase({ filename = process.env.DB_PATH || DEFAULT_DB_PATH } = {}) {
  const resolvedPath = path.resolve(filename);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Database does not exist: ${resolvedPath}`);
  }

  const beforeBytes = fs.statSync(resolvedPath).size;
  const db = await open({ filename: resolvedPath, driver: sqlite3.Database });
  try {
    // Fail quickly when the caller forgot to stop a service instead of waiting behind it
    // and making the maintenance window ambiguous.
    await db.exec(`PRAGMA busy_timeout = 1000;`);
    await db.exec(`PRAGMA wal_checkpoint(TRUNCATE);`);
    await db.exec(`PRAGMA auto_vacuum = INCREMENTAL;`);
    await db.exec(`VACUUM;`);
    await db.exec(`PRAGMA optimize;`);
  } catch (error) {
    if (/SQLITE_BUSY|database is locked/i.test(String(error?.message || error))) {
      throw new Error("Database is in use. Stop the API and MCP processes before compacting.");
    }
    throw error;
  } finally {
    await db.close();
  }

  const afterBytes = fs.statSync(resolvedPath).size;
  return {
    path: resolvedPath,
    before_bytes: beforeBytes,
    after_bytes: afterBytes,
    reclaimed_bytes: Math.max(0, beforeBytes - afterBytes)
  };
}

async function main(argv = process.argv.slice(2)) {
  if (!argv.includes("--yes")) {
    throw new Error(
      "Refusing to rewrite the database without --yes. Stop the API/MCP services and ensure there is enough temporary disk space first."
    );
  }
  const summary = await compactDatabase();
  console.log(
    `[compact-database] ${summary.path}: ${formatBytes(summary.before_bytes)} -> ` +
      `${formatBytes(summary.after_bytes)} (${formatBytes(summary.reclaimed_bytes)} reclaimed)`
  );
  return summary;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[compact-database] failed: ${String(error?.message || error)}`);
    process.exit(1);
  });
}

module.exports = { compactDatabase, formatBytes, main };
