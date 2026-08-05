// A durable record of failures the user would want to know about.
//
// This exists because of a specific loss. record_application_result threw while logging an
// Amazon submission, the agent mentioned it in one line of prose and carried on, and the
// application was gone. Nothing in the app showed it, nothing was written anywhere, and the
// only trace was a sentence in a chat transcript. By the time it surfaced, several
// applications had been submitted and not recorded.
//
// So the bar here is narrow and deliberate: this is not a debug log. It records operations
// that failed in a way that costs the user something -- an application not logged, a
// document not saved -- so the app can say so. logs/frontend-client.log still exists for
// diagnostics; that is a file nobody reads, which is exactly the problem.
const { getDb } = require("./runtime-context.js");
const { nowEpochSeconds } = require("../helpers/normalize-numbers.js");

const MAX_CONTEXT_CHARS = 4000;
const MAX_MESSAGE_CHARS = 1000;

async function ensureErrorLogTable() {
  const db = getDb();
  if (!db) return;
  await db.exec(`
    CREATE TABLE IF NOT EXISTS error_log (
      id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      occurred_at_epoch INTEGER NOT NULL,
      source TEXT NOT NULL DEFAULT '',
      operation TEXT NOT NULL DEFAULT '',
      message TEXT NOT NULL DEFAULT '',
      context TEXT NOT NULL DEFAULT '',
      acknowledged INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_error_log_unack
      ON error_log (acknowledged, occurred_at_epoch DESC);
  `);
}

// Never throws. A failure while recording a failure must not replace the original error
// with a less useful one, and must not take down the operation that was already failing.
//
// Deliberately not called inside a write transaction: the thing being reported is usually a
// transaction that is about to roll back, and a log written inside it would be rolled back
// with it -- erasing the only record of what happened.
async function recordError({ source, operation, message, context } = {}) {
  try {
    const db = getDb();
    if (!db) return null;
    await ensureErrorLogTable();

    let serializedContext = "";
    try {
      serializedContext = context === undefined ? "" : JSON.stringify(context);
    } catch {
      serializedContext = "[context could not be serialized]";
    }

    const result = await db.run(
      `INSERT INTO error_log (occurred_at_epoch, source, operation, message, context)
       VALUES (?, ?, ?, ?, ?);`,
      [
        nowEpochSeconds(),
        String(source || "unknown").slice(0, 80),
        String(operation || "").slice(0, 120),
        String(message || "").slice(0, MAX_MESSAGE_CHARS),
        String(serializedContext || "").slice(0, MAX_CONTEXT_CHARS)
      ]
    );
    return Number(result?.lastID || 0) || null;
  } catch {
    // Swallowed on purpose; see above.
    return null;
  }
}

function mapRow(row) {
  let context = null;
  try {
    context = row?.context ? JSON.parse(row.context) : null;
  } catch {
    context = String(row?.context || "");
  }
  return {
    id: Number(row?.id || 0),
    occurred_at_epoch: Number(row?.occurred_at_epoch || 0),
    source: String(row?.source || ""),
    operation: String(row?.operation || ""),
    message: String(row?.message || ""),
    context,
    acknowledged: Boolean(Number(row?.acknowledged || 0))
  };
}

// `sources` scopes the result to a caller's concern -- the error_log table is shared by
// application-submission failures ("api", "mcp") and operational/infra warnings ("sync",
// "health"), and a caller for one must not surface the other. Omitting it returns everything,
// for callers (or ad-hoc inspection) that genuinely want the whole log.
async function listErrors({ limit = 50, include_acknowledged = false, sources = null } = {}) {
  await ensureErrorLogTable();
  const db = getDb();
  const bounded = Math.max(1, Math.min(500, Number(limit) || 50));
  const sourceList = Array.isArray(sources)
    ? sources.map((value) => String(value || "").trim()).filter(Boolean)
    : [];
  const sourceClause = sourceList.length > 0
    ? `AND source IN (${sourceList.map(() => "?").join(", ")})`
    : "";
  const rows = await db.all(
    include_acknowledged
      ? `SELECT * FROM error_log WHERE 1 = 1 ${sourceClause} ORDER BY occurred_at_epoch DESC, id DESC LIMIT ?;`
      : `SELECT * FROM error_log WHERE acknowledged = 0 ${sourceClause} ORDER BY occurred_at_epoch DESC, id DESC LIMIT ?;`,
    [...sourceList, bounded]
  );
  const unacknowledged = await db.get(
    `SELECT COUNT(*) AS n FROM error_log WHERE acknowledged = 0 ${sourceClause};`,
    sourceList
  );
  return {
    items: rows.map(mapRow),
    unacknowledged_count: Number(unacknowledged?.n || 0)
  };
}

// Acknowledging hides a failure from the banner without deleting it. The record is the
// point -- an application that was never logged stays worth knowing about after the notice
// has been dismissed.
async function acknowledgeErrors(ids) {
  await ensureErrorLogTable();
  const db = getDb();
  const list = (Array.isArray(ids) ? ids : [ids])
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0);

  if (list.length === 0) {
    const result = await db.run(`UPDATE error_log SET acknowledged = 1 WHERE acknowledged = 0;`);
    return { acknowledged: Number(result?.changes || 0) };
  }
  const placeholders = list.map(() => "?").join(", ");
  const result = await db.run(
    `UPDATE error_log SET acknowledged = 1 WHERE id IN (${placeholders});`,
    list
  );
  return { acknowledged: Number(result?.changes || 0) };
}

module.exports = {
  ensureErrorLogTable,
  recordError,
  listErrors,
  acknowledgeErrors
};
