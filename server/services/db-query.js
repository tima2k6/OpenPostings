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
const {
  rowMatchesLocationFilters,
  parseStateFilters,
  parseCountryFilters,
  parseRegionFilters,
  STATE_CODE_TO_NAME
} = require("../helpers/description-filters.js");
const { inferPostingLocationFromJobUrl, inferAtsFromJobPostingUrl } = require("../helpers/normalize-ats.js");

const MAX_ROWS = 1000;
// Must stay equal to FACET_CANDIDATE_CAP in db-facets.js. Both paths refine the same SQL
// superset in JS, so a smaller cap here made the result count a floor while the facet
// count was exact -- the same query reported 1,895 rows in one place and 6,744 in the
// other. Two numbers for one question is worse than one slow number.
const STATE_CANDIDATE_CAP = 250000;

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
  // Drill-down needs AND, not OR: clicking a facet must narrow the set. title_any widens
  // it, so the two cannot share a field.
  const titleAll = splitTerms(input.title_all);
  const titleNone = splitTerms(input.title_none);
  const companyAny = splitTerms(input.company_any);
  const companyNone = splitTerms(input.company_none);
  const locationAny = splitTerms(input.location_any);
  const locationNone = splitTerms(input.location_none);

  if (titleAny.length) clauses.push(anyOf("position_name", titleAny, params));
  for (const term of titleAll) clauses.push(anyOf("position_name", [term], params));
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
  // ATS is derived from the job URL rather than stored, so like states it cannot be a SQL
  // clause and is applied during the refine pass.
  //
  // Country and region are the same predicate the app's own location filter applies, and
  // they are what stops a state code standing in for a foreign subdivision. Neither narrows
  // in SQL: both are inferred from the location text rather than stored, and a country is
  // named by any of its aliases, so the refine pass is the only place they can be decided.
  const atsFilters = splitTerms(input.ats);
  const stateCodes = parseStateFilters(input.states);
  const countryFilters = parseCountryFilters(splitTerms(input.countries));
  const regionFilters = parseRegionFilters(splitTerms(input.regions));
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

  return { sql, params, where, clauses, limit, stateCodes, countryFilters, regionFilters, atsFilters };
}

// True when the SQL predicate is only a superset of what the caller asked for, so the counts
// have to come from the refined set rather than a COUNT(*) over the same WHERE.
function needsRefinePass(built) {
  return (
    built.stateCodes.length > 0 ||
    built.countryFilters.length > 0 ||
    built.regionFilters.length > 0 ||
    built.atsFilters.length > 0
  );
}

async function runQuery(input = {}) {
  const db = await getReadOnlyDb();
  const built = buildQuery(input);
  const { where, limit, stateCodes, countryFilters, regionFilters, atsFilters } = built;
  const params = built.params.slice();

  const readable = built.sql.replace(/\?/g, () => {
    const next = built.params.shift();
    return typeof next === "number" ? String(next) : `'${String(next).replace(/'/g, "''")}'`;
  });

  // No location or ATS filter: SQL is the whole predicate, so counts come straight from the
  // table.
  if (!needsRefinePass(built)) {
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

  // Location or ATS filter: take the SQL superset, then apply the predicates that only exist
  // in JS -- the segment-aware location matcher, and the ATS inferred from the URL.
  const candidateSql = built.sql
    .replace(/LIMIT \d+$/, `LIMIT ${STATE_CANDIDATE_CAP}`);
  const candidates = await db.all(candidateSql, params);

  const matched = [];
  for (const row of candidates) {
    const location =
      String(row.location || "").trim() || inferPostingLocationFromJobUrl(row.job_posting_url) || "";
    if (!rowMatchesLocationFilters(location, stateCodes, [], countryFilters, regionFilters)) continue;
    if (atsFilters.length && !atsFilters.includes(String(inferAtsFromJobPostingUrl(row.job_posting_url) || "").toLowerCase())) continue;
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

module.exports = { buildQuery, runQuery, needsRefinePass, SORTABLE, MAX_ROWS };
