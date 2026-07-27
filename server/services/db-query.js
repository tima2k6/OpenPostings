// Composable querying over the raw Postings table.
//
// The listing UI offers one free-text box that ORs across company, title and location, and
// it only ever sees currently-visible rows. That is not enough to work a job search: the
// useful questions are shaped like "manager or director in the title, but not assistant or
// shift, in WA, paying over 140k, seen in the last three days, including the ones the app
// is currently hiding". Every clause below exists so that sentence can be expressed.
//
// This deliberately queries the table directly rather than going through
// listPostingsWithFilters. That function applies the freshness window and the hidden flag,
// and those are exactly the constraints worth looking underneath.
const { getReadOnlyDb } = require("./db-browser.js");
const { rowMatchesLocationFilters, STATE_CODE_TO_NAME } = require("../helpers/description-filters.js");
const { inferPostingLocationFromJobUrl } = require("../helpers/normalize-ats.js");

const MAX_ROWS = 1000;
// When a real state filter is active the rows have to be tested in JS, so a bounded
// candidate set is pulled first. Large enough that ordinary queries are exact, small
// enough that it cannot stall the single-threaded API.
const STATE_CANDIDATE_CAP = 40000;

const SORTABLE = new Map([
  ["last_seen", "last_seen_epoch"],
  ["first_seen", "first_seen_epoch"],
  ["company", "company_name"],
  ["position", "position_name"],
  ["location", "location"],
  ["pay", "COALESCE(pay_max, pay_min, 0)"],
  ["posted", "posting_date"]
]);

function splitTerms(value) {
  return String(value || "")
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
}

function escapeLike(term) {
  return term.replace(/[\\%_]/g, (match) => `\\${match}`);
}

// Each group is OR-ed within itself and AND-ed against the others, which is what makes
// "(manager OR director) AND NOT (assistant OR shift)" expressible without a query language.
function anyOf(column, terms, params) {
  const clause = terms
    .map(() => `LOWER(COALESCE(${column}, '')) LIKE ? ESCAPE '\\'`)
    .join(" OR ");
  for (const term of terms) params.push(`%${escapeLike(term)}%`);
  return `(${clause})`;
}

function noneOf(column, terms, params) {
  const clause = terms
    .map(() => `LOWER(COALESCE(${column}, '')) NOT LIKE ? ESCAPE '\\'`)
    .join(" AND ");
  for (const term of terms) params.push(`%${escapeLike(term)}%`);
  return `(${clause})`;
}

function buildQuery(input = {}) {
  const clauses = [];
  const params = [];

  const titleAny = splitTerms(input.title_any);
  const titleNone = splitTerms(input.title_none);
  const companyAny = splitTerms(input.company_any);
  const companyNone = splitTerms(input.company_none);
  const locationAny = splitTerms(input.location_any);
  const locationNone = splitTerms(input.location_none);

  if (titleAny.length) clauses.push(anyOf("position_name", titleAny, params));
  if (titleNone.length) clauses.push(noneOf("position_name", titleNone, params));
  if (companyAny.length) clauses.push(anyOf("company_name", companyAny, params));
  if (companyNone.length) clauses.push(noneOf("company_name", companyNone, params));
  if (locationAny.length) clauses.push(anyOf("location", locationAny, params));
  if (locationNone.length) clauses.push(noneOf("location", locationNone, params));

  // Pay is stored on only a small fraction of rows, so a range filter silently means
  // "and has a pay figure at all". Callers opt in knowingly.
  const payMin = Number(input.pay_min);
  if (Number.isFinite(payMin) && payMin > 0) {
    clauses.push("(COALESCE(pay_max, pay_min, 0) >= ?)");
    params.push(payMin);
  }
  const payMax = Number(input.pay_max);
  if (Number.isFinite(payMax) && payMax > 0) {
    clauses.push("(COALESCE(pay_min, pay_max, 0) <= ?)");
    params.push(payMax);
  }

  // "Still listed within N days" -- the honest freshness signal, independent of the
  // hidden flag and of the posting_date window the sync applies.
  const seenDays = Number(input.seen_days);
  if (Number.isFinite(seenDays) && seenDays > 0) {
    clauses.push("(last_seen_epoch >= ?)");
    params.push(Math.floor(Date.now() / 1000) - seenDays * 86400);
  }
  const foundDays = Number(input.found_days);
  if (Number.isFinite(foundDays) && foundDays > 0) {
    clauses.push("(first_seen_epoch >= ?)");
    params.push(Math.floor(Date.now() / 1000) - foundDays * 86400);
  }

  // A proper state filter, as opposed to substring matching on the location text: "WA"
  // as a raw LIKE also matches Warwick, Wailea and Sweetwater. The real test needs the
  // segment-aware matcher, which only runs in JS, so SQL narrows to a superset here and
  // runQuery applies the real predicate afterwards. Rows with no stored location are kept
  // because their value is inferred from the job URL, which this query cannot see.
  const stateCodes = splitTerms(input.states).map((code) => code.toUpperCase());
  if (stateCodes.length) {
    const parts = [];
    for (const code of stateCodes) {
      parts.push(`LOWER(COALESCE(location, '')) LIKE ? ESCAPE '\\'`);
      params.push(`%${escapeLike(code.toLowerCase())}%`);
      const name = STATE_CODE_TO_NAME[code];
      if (name) {
        parts.push(`LOWER(COALESCE(location, '')) LIKE ? ESCAPE '\\'`);
        params.push(`%${escapeLike(name)}%`);
      }
    }
    clauses.push(`(location IS NULL OR TRIM(location) = '' OR ${parts.join(" OR ")})`);
  }

  if (input.visibility === "visible") clauses.push("hidden = 0");
  if (input.visibility === "hidden") clauses.push("hidden = 1");

  if (input.has_pay === "1") clauses.push("(COALESCE(pay_max, pay_min, 0) > 0)");

  const sortColumn = SORTABLE.get(String(input.sort || "last_seen")) || "last_seen_epoch";
  const direction = String(input.dir || "desc").toLowerCase() === "asc" ? "ASC" : "DESC";
  // A non-positive or unparseable limit means "unspecified", not "one row": clamping a
  // stray "-5" to 1 would look like the query matched almost nothing.
  const requestedLimit = Number(input.limit);
  const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
    ? Math.min(MAX_ROWS, Math.floor(requestedLimit))
    : 200;

  const where = clauses.length ? `WHERE ${clauses.join("\n  AND ")}` : "";
  const sql =
    `SELECT id, company_name, position_name, location, posting_date,\n` +
    `       pay_min, pay_max, pay_currency, pay_period, hidden,\n` +
    `       first_seen_epoch, last_seen_epoch, job_posting_url\n` +
    `FROM Postings\n${where}\n` +
    `ORDER BY ${sortColumn} ${direction}, id DESC\n` +
    `LIMIT ${limit}`;

  return { sql, params, where, clauses, limit, stateCodes };
}

async function runQuery(input = {}) {
  const db = await getReadOnlyDb();
  const built = buildQuery(input);
  const { where, limit, stateCodes } = built;
  const params = built.params.slice();

  const readable = built.sql.replace(/\?/g, () => {
    const next = built.params.shift();
    return typeof next === "number" ? String(next) : `'${String(next).replace(/'/g, "''")}'`;
  });

  // No state filter: SQL is the whole predicate, so counts come straight from the table.
  if (stateCodes.length === 0) {
    const rows = await db.all(built.sql, params);
    const totals = await db.get(
      `SELECT COUNT(*) AS total, SUM(CASE WHEN hidden = 0 THEN 1 ELSE 0 END) AS visible
       FROM Postings ${where};`,
      params
    );
    return {
      rows,
      total: Number(totals?.total || 0),
      visible: Number(totals?.visible || 0),
      shown: rows.length,
      limit,
      approximate: false,
      sql: readable
    };
  }

  // State filter: take the SQL superset, then apply the real segment-aware matcher.
  const candidateSql = built.sql
    .replace(/LIMIT \d+$/, `LIMIT ${STATE_CANDIDATE_CAP}`);
  const candidates = await db.all(candidateSql, params);

  const matched = [];
  for (const row of candidates) {
    const location =
      String(row.location || "").trim() || inferPostingLocationFromJobUrl(row.job_posting_url) || "";
    if (!rowMatchesLocationFilters(location, stateCodes, [], [], [])) continue;
    matched.push({ ...row, location: row.location || location });
  }

  const visible = matched.filter((row) => Number(row.hidden) === 0).length;
  return {
    rows: matched.slice(0, limit),
    total: matched.length,
    visible,
    shown: Math.min(matched.length, limit),
    limit,
    // True when the superset filled the candidate cap, so counts are a floor not a total.
    approximate: candidates.length >= STATE_CANDIDATE_CAP,
    sql: readable
  };
}

module.exports = { buildQuery, runQuery, SORTABLE, MAX_ROWS };
