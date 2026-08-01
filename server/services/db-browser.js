// A read-only browser for the local database, served by the API the app already talks to.
//
// Why it exists: answering "is this employer even tracked?", "does it have postings but
// hidden ones?", or "what did we see in Seattle yesterday?" previously meant writing a
// throwaway script against jobs.db. The listing UI cannot answer them -- it only shows
// postings that are currently visible, so a tracked-but-stale employer and an employer
// that was never added look identical.
//
// Safety. This opens its OWN connection in SQLITE_OPEN_READONLY rather than reusing the
// application's handle. That is the real guarantee: a write is refused by SQLite itself,
// not by inspection of the SQL text. The checks below are a second layer for things a
// read-only connection still permits -- reading rows that should not be exposed, and
// queries expensive enough to stall the single-threaded API.
const path = require("path");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");

const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, "..", "..", "jobs.db");
const MAX_ROWS = 500;
const QUERY_TIMEOUT_MS = 15000;

// These hold credentials and personal details. The API binds to every interface with
// permissive CORS, so anything readable here is readable by anything on the network --
// see the note in the page footer.
// application_answers holds salary expectations and personal circumstances alongside the
// rest; it belongs on this list for the same reason PersonalInformation does.
const DENIED_TABLES = ["mcpsettings", "personalinformation", "applicant_documents", "application_answers"];

function isReadableTableName(name) {
  const normalized = String(name || "").toLowerCase();
  return Boolean(normalized) && !normalized.startsWith("sqlite_") && !DENIED_TABLES.includes(normalized);
}

let readOnlyDb = null;

async function getReadOnlyDb() {
  if (readOnlyDb) return readOnlyDb;
  readOnlyDb = await open({
    filename: DB_PATH,
    driver: sqlite3.Database,
    mode: sqlite3.OPEN_READONLY
  });
  // Reads can still hit SQLITE_BUSY around checkpoints; wait rather than fail.
  await readOnlyDb.exec("PRAGMA busy_timeout = 15000;");
  return readOnlyDb;
}

function rejectUnsafeQuery(sql) {
  const trimmed = String(sql || "").trim().replace(/;+\s*$/, "");
  if (!trimmed) return "Query is empty.";

  // A read-only connection already refuses writes; this is only to give a clearer message
  // than SQLite's, and to stop PRAGMA/ATTACH reaching for files outside this database.
  if (!/^(select|with)\b/i.test(trimmed)) {
    return "Only SELECT (or WITH ... SELECT) is allowed.";
  }
  if (/;/.test(trimmed)) {
    return "Only a single statement is allowed.";
  }
  if (/\b(attach|pragma)\b/i.test(trimmed)) {
    return "ATTACH and PRAGMA are not allowed.";
  }
  for (const table of DENIED_TABLES) {
    if (new RegExp(`\\b${table}\\b`, "i").test(trimmed)) {
      return `Table '${table}' holds credentials and personal information and is not readable here.`;
    }
  }
  return null;
}

async function runReadOnlyQuery(sql) {
  const db = await getReadOnlyDb();
  const wrapped = `SELECT * FROM (${String(sql).trim().replace(/;+\s*$/, "")}) LIMIT ${MAX_ROWS + 1}`;

  const rows = await Promise.race([
    db.all(wrapped),
    new Promise((_resolve, reject) =>
      setTimeout(
        () => reject(new Error(`Query exceeded ${QUERY_TIMEOUT_MS / 1000}s and was abandoned.`)),
        QUERY_TIMEOUT_MS
      )
    )
  ]);

  const truncated = rows.length > MAX_ROWS;
  return { rows: truncated ? rows.slice(0, MAX_ROWS) : rows, truncated };
}

// A discoverable schema makes the SQL console usable without exposing the names or
// columns of protected tables. Table names originate from sqlite_master, then are quoted
// before being passed to SQLite's table_info pragma.
async function listReadableSchema() {
  const db = await getReadOnlyDb();
  const tables = await db.all(
    `SELECT name
     FROM sqlite_master
     WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
     ORDER BY LOWER(name)`
  );
  const visible = tables.filter((row) => isReadableTableName(row.name));
  return Promise.all(
    visible.map(async (row) => {
      const quoted = String(row.name).replace(/"/g, '""');
      const columns = await db.all(`PRAGMA table_info("${quoted}")`);
      return {
        name: row.name,
        columns: columns.map((column) => ({
          name: column.name,
          type: column.type || "",
          primary_key: Boolean(column.pk)
        }))
      };
    })
  );
}

// Companies matter most when they have NO visible postings, which is exactly the case the
// listing cannot show. Counts come from one grouped query over the matched names rather
// than a correlated subquery per row, so the company_name index does the work.
async function findCompanies(searchTerm) {
  const db = await getReadOnlyDb();
  const term = `%${String(searchTerm || "").trim().toLowerCase()}%`;

  const companies = await db.all(
    `SELECT id, company_name, url_string, ATS_name
     FROM companies
     WHERE LOWER(company_name) LIKE ? OR LOWER(url_string) LIKE ?
     ORDER BY company_name
     LIMIT 100;`,
    [term, term]
  );
  if (companies.length === 0) return [];

  const names = companies.map((row) => row.company_name);
  const placeholders = names.map(() => "?").join(", ");
  const stats = await db.all(
    `SELECT company_name,
            COUNT(*) AS total,
            SUM(CASE WHEN hidden = 0 THEN 1 ELSE 0 END) AS visible,
            MAX(last_seen_epoch) AS last_seen_epoch
     FROM Postings
     WHERE company_name IN (${placeholders})
     GROUP BY company_name;`,
    names
  );

  const byName = new Map(stats.map((row) => [row.company_name, row]));
  return companies.map((row) => {
    const stat = byName.get(row.company_name) || {};
    return {
      ...row,
      total: Number(stat.total || 0),
      visible: Number(stat.visible || 0),
      last_seen_epoch: Number(stat.last_seen_epoch || 0)
    };
  });
}

async function findPostings({ search, hiddenState }) {
  const db = await getReadOnlyDb();
  const clauses = [];
  const params = [];

  const term = String(search || "").trim().toLowerCase();
  if (term) {
    clauses.push(
      "(LOWER(company_name) LIKE ? OR LOWER(position_name) LIKE ? OR LOWER(COALESCE(location,'')) LIKE ?)"
    );
    params.push(`%${term}%`, `%${term}%`, `%${term}%`);
  }
  if (hiddenState === "visible") clauses.push("hidden = 0");
  if (hiddenState === "hidden") clauses.push("hidden = 1");

  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  return db.all(
    `SELECT id, company_name, position_name, location, posting_date, hidden,
            first_seen_epoch, last_seen_epoch, job_posting_url
     FROM Postings
     ${where}
     ORDER BY last_seen_epoch DESC, id DESC
     LIMIT ${MAX_ROWS};`,
    params
  );
}

module.exports = {
  findCompanies,
  findPostings,
  runReadOnlyQuery,
  listReadableSchema,
  isReadableTableName,
  rejectUnsafeQuery,
  getReadOnlyDb,
  MAX_ROWS
};
