// Facet counts for the current result set, so the postings view can be explored by
// clicking rather than described up front.
//
// The form-based builder assumed you already know what you are looking for. Facets invert
// that: run a broad query, see how it decomposes -- which states, which employers, which
// role words, how much of it the app is hiding -- and narrow by clicking. That is the
// difference between "type manager, director, head of and hope" and seeing that the set is
// mostly 'assistant manager' with 40 'director of operations' in it.
//
// Everything is computed from one bounded candidate read rather than a GROUP BY per facet.
// State cannot be grouped in SQL at all (it needs the segment-aware matcher), ATS is
// derived from the URL and not stored, and title words need tokenising -- so a single scan
// in JS is both simpler and the only option that keeps every facet consistent with the
// others.
const { getReadOnlyDb } = require("./db-browser.js");
const { buildQuery } = require("./db-query.js");
const { rowMatchesLocationFilters, STATE_CODE_TO_NAME } = require("../helpers/description-filters.js");
const { inferPostingLocationFromJobUrl, inferAtsFromJobPostingUrl } = require("../helpers/normalize-ats.js");

const FACET_CANDIDATE_CAP = 25000;
// Facets populate dropdowns rather than a truncated chip list, so every observed value is
// returned. The bound exists only to stop a pathological set producing an unbounded
// response; on this data the largest facet (title words) is well under it.
const TOP_N = 20000;

// Words that appear in so many titles that counting them says nothing about the set.
const TITLE_STOPWORDS = new Set([
  "and", "or", "of", "the", "for", "to", "in", "at", "with", "a", "an", "on", "by",
  "i", "ii", "iii", "iv", "jr", "sr", "new", "job", "we", "you", "our", "is", "are",
  "full", "part", "time", "hire", "hiring", "opening", "opportunity", "position", "role"
]);

const STATE_CODES = Object.keys(STATE_CODE_TO_NAME);

function tally(map, key, weight = 1) {
  if (!key) return;
  map.set(key, (map.get(key) || 0) + weight);
}

function top(map, limit = TOP_N) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
    .slice(0, limit)
    .map(([value, count]) => ({ value, count }));
}

function titleWords(positionName) {
  return String(positionName || "")
    .toLowerCase()
    .replace(/[^a-z0-9&/\s-]/g, " ")
    .split(/[\s/-]+/)
    .filter((word) => word.length > 2 && !TITLE_STOPWORDS.has(word) && !/^\d+$/.test(word));
}

async function computeFacets(input = {}) {
  const db = await getReadOnlyDb();
  const built = buildQuery(input);

  // Reuse the builder's predicate but ignore its ordering and page size: facets describe
  // the whole matching set, not the page being displayed.
  const sql =
    `SELECT company_name, position_name, location, hidden, pay_min, pay_max, job_posting_url\n` +
    `FROM Postings\n${built.where}\nLIMIT ${FACET_CANDIDATE_CAP}`;
  const rows = await db.all(sql, built.params);

  const activeStates = built.stateCodes || [];
  const byState = new Map();
  const byCompany = new Map();
  const byWord = new Map();
  const byAts = new Map();
  let visible = 0;
  let withPay = 0;

  // Location strings repeat heavily, and the state matcher is the expensive part of this
  // loop, so each distinct string is resolved once and reused.
  const stateCache = new Map();
  const statesFor = (location) => {
    if (stateCache.has(location)) return stateCache.get(location);
    const matched = [];
    if (location) {
      // The matcher is the expensive part, and a location can only match a state whose
      // code or name is present in the text at all. Screening on that first turns 51
      // matcher calls per distinct location into one or two.
      const haystack = location.toLowerCase();
      for (const code of STATE_CODES) {
        if (!haystack.includes(code.toLowerCase()) && !haystack.includes(STATE_CODE_TO_NAME[code])) continue;
        if (rowMatchesLocationFilters(location, [code], [], [], [])) matched.push(code);
      }
    }
    stateCache.set(location, matched);
    return matched;
  };

  for (const row of rows) {
    if (activeStates.length > 0) {
      const location =
        String(row.location || "").trim() || inferPostingLocationFromJobUrl(row.job_posting_url) || "";
      if (!rowMatchesLocationFilters(location, activeStates, [], [], [])) continue;
    }

    if (Number(row.hidden) === 0) visible += 1;
    if (Number(row.pay_max || row.pay_min || 0) > 0) withPay += 1;

    tally(byCompany, String(row.company_name || "").trim());
    tally(byAts, inferAtsFromJobPostingUrl(row.job_posting_url) || "unknown");

    const location =
      String(row.location || "").trim() || inferPostingLocationFromJobUrl(row.job_posting_url) || "";
    for (const code of statesFor(location)) tally(byState, code);

    for (const word of new Set(titleWords(row.position_name))) tally(byWord, word);
  }

  return {
    scanned: rows.length,
    // True when the cap was hit, so the counts are a sample rather than the whole set.
    approximate: rows.length >= FACET_CANDIDATE_CAP,
    visible,
    hidden: rows.length - visible,
    with_pay: withPay,
    facets: {
      states: top(byState),
      companies: top(byCompany),
      title_words: top(byWord),
      ats: top(byAts)
    }
  };
}

module.exports = { computeFacets, titleWords, FACET_CANDIDATE_CAP };
