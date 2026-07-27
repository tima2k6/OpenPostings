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
const { buildQuery, needsRefinePass } = require("./db-query.js");
const { rowMatchesLocationFilters, STATE_CODE_TO_NAME } = require("../helpers/description-filters.js");
const { inferPostingLocationFromJobUrl, inferAtsFromJobPostingUrl } = require("../helpers/normalize-ats.js");

// Sized against measured scan cost, not guessed: 200,000 rows resolve in ~1.2s, and the
// superset a state filter produces before the real matcher runs is far larger than the set
// it ends up matching -- WA narrows 189,807 candidates down to 1,895. Capping below the
// candidate count would refuse to build facets for a result set of under two thousand.
const FACET_CANDIDATE_CAP = 250000;
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

// The 51 codes, independent of any query. This is the primary axis and must not come from
// a facet count: a sampled scan cannot be trusted to mention every state, and the state a
// user cares about is often not one of the busiest.
const ALL_STATES = STATE_CODES.map((code) => ({ value: code, name: STATE_CODE_TO_NAME[code] }));

async function computeFacets(input = {}) {
  const db = await getReadOnlyDb();
  const built = buildQuery(input);

  // How many rows the scan would have to read. This is the SQL predicate only: when a
  // state filter is active it is a superset, since the real matcher runs in JS afterwards.
  // Gating on it bounds the work, which is the thing that actually needs bounding.
  //
  // The gate exists because facets over an unnarrowed set are worse than useless. The scan
  // is bounded and has no ORDER BY, so without this it was describing an arbitrary 3% of
  // the table while presenting the counts as the breakdown. Saying "narrow first" is more
  // honest than a number that is quietly a sample.
  const candidateRow = await db.get(`SELECT COUNT(*) AS n FROM Postings ${built.where};`, built.params);
  const candidateCount = Number(candidateRow?.n || 0);

  if (candidateCount > FACET_CANDIDATE_CAP) {
    return {
      total: candidateCount,
      scanned: 0,
      needs_narrowing: true,
      all_states: ALL_STATES,
      facets: { states: [], companies: [], title_words: [], ats: [] }
    };
  }

  const sql =
    `SELECT company_name, position_name, location, hidden, pay_min, pay_max, job_posting_url\n` +
    `FROM Postings\n${built.where}\nLIMIT ${FACET_CANDIDATE_CAP}`;
  const rows = await db.all(sql, built.params);

  const activeStates = built.stateCodes || [];
  const activeCountries = built.countryFilters || [];
  const activeRegions = built.regionFilters || [];
  const activeAts = built.atsFilters || [];
  const hasLocationFilter = activeStates.length > 0 || activeCountries.length > 0 || activeRegions.length > 0;
  // The same refine runQuery applies, so the facet totals describe the set the postings list
  // is showing rather than the SQL superset it was drawn from. The ATS half of it was
  // previously left out, which made these counts disagree with the result count whenever an
  // ATS filter was set.
  const refine = needsRefinePass(built);
  const byState = new Map();
  const byCompany = new Map();
  const byWord = new Map();
  const byAts = new Map();
  let visible = 0;
  let withPay = 0;
  let matched = 0;

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
    if (refine) {
      const location =
        String(row.location || "").trim() || inferPostingLocationFromJobUrl(row.job_posting_url) || "";
      if (hasLocationFilter && !rowMatchesLocationFilters(location, activeStates, [], activeCountries, activeRegions)) {
        continue;
      }
      if (
        activeAts.length > 0 &&
        !activeAts.includes(String(inferAtsFromJobPostingUrl(row.job_posting_url) || "").toLowerCase())
      ) {
        continue;
      }
    }

    matched += 1;
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
    // Rows that survived the JS refine, not the candidate superset that was scanned.
    total: matched,
    scanned: rows.length,
    needs_narrowing: false,
    all_states: ALL_STATES,
    // Every candidate was read, so these counts are exact rather than sampled.
    approximate: false,
    visible,
    hidden: matched - visible,
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
