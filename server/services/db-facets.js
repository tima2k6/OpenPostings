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
const { parseLocationsJson, parsePostingLocation } = require("../helpers/parse-location.js");

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

// The two facets that can be counted exactly over the whole corpus without the candidate
// scan, for the case where the scan is refused. Sequential and cheapest-first, with a budget
// between them: a GROUP BY that rides a covering index is fast but not free, and this runs on
// the same read-only connection the rest of /db uses. If the first one overruns, the second
// is skipped rather than compounding it -- a state breakdown alone is still a way in, and an
// empty companies list renders as no dropdown rather than as a wrong one.
const WIDE_FACET_BUDGET_MS = Number(process.env.DB_FACETS_WIDE_BUDGET_MS || 6000);

async function computeIndexedFacets(db, stateCodes = []) {
  const startedAt = Date.now();
  const states = await db.all(
    `SELECT state_region AS value, COUNT(*) AS count
     FROM posting_location_states
     GROUP BY state_region
     ORDER BY count DESC, value ASC;`
  );
  if (Date.now() - startedAt >= WIDE_FACET_BUDGET_MS) {
    return { states, companies: [] };
  }
  // Scoped to the chosen states when there are any, by driving from the projection rather
  // than from the state filter's own SQL clause. That clause is a deliberate superset: it
  // keeps every row with no parsed location so the refine pass can try URL inference on it,
  // which is 299,010 of WA's 308,696 candidates -- 97% of the scan, and the reason a state
  // filter alone can never get under the cap. Driving from posting_location_states instead
  // reads WA's 20,468 rows.
  //
  // What that leaves out is exactly those URL-inferred matches, so these counts are a floor
  // for the state, not a total, and the page says so. That trade is confined to the facet
  // panel: the posting list and the filters themselves still run the full refine and are
  // unchanged. A floor you can act on beats an empty panel you cannot.
  const companies = stateCodes.length > 0
    ? await db.all(
        `SELECT p.company_name AS value, COUNT(*) AS count
         FROM posting_location_states s
         JOIN Postings p ON p.id = s.posting_id
         WHERE s.state_region IN (${stateCodes.map(() => "?").join(", ")})
         GROUP BY p.company_name
         ORDER BY count DESC, value ASC
         LIMIT ${TOP_N};`,
        stateCodes
      )
    : await db.all(
        `SELECT company_name AS value, COUNT(*) AS count
         FROM Postings
         GROUP BY company_name
         ORDER BY count DESC, value ASC
         LIMIT ${TOP_N};`
      );
  return { states, companies };
}

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
    // Refusing to sample was right; offering nothing in its place was not. The narrowing
    // branch handed back 51 bare state codes and no numbers, so the only way to find out
    // whether a state held 75,000 postings or 300 was to pick it and see -- and the facets
    // that exist to guide narrowing were exactly what stayed hidden until you had already
    // narrowed. Two of them do not need the scan at all: state counts come from
    // posting_location_states (the same projection the state filter itself matches against,
    // so the values are the ones the filter consumes), and company counts from a GROUP BY
    // that idx_postings_company_name covers. Both are exact over the whole corpus, not
    // sampled, so they carry none of the dishonesty this gate was built to prevent.
    // Measured on the live database: 0.32s and 2.17s respectively.
    //
    // Only when nothing is narrowed yet. With a filter active the aggregates would have to
    // join or re-scan under a predicate SQL cannot serve from an index, which is the cost
    // this branch exists to avoid -- and a filtered set that is still over the cap is the
    // rarer case anyway.
    // Nothing narrowed yet, or narrowed by state alone -- the two cases the projection can
    // answer exactly. A state filter contributes exactly one clause however many states it
    // names, so clauses.length === 1 alongside stateCodes means state is the only filter;
    // any other filter present would not be reflected in the projection aggregates, and a
    // count that silently ignores an active filter is worse than no count.
    const stateOnly = built.stateCodes.length > 0 && built.clauses.length === 1;
    const wideFacets = built.clauses.length === 0 || stateOnly
      ? await computeIndexedFacets(db, stateOnly ? built.stateCodes : [])
      : { states: [], companies: [] };
    const stateCountByCode = new Map(wideFacets.states.map((row) => [row.value, row.count]));
    return {
      total: candidateCount,
      scanned: 0,
      needs_narrowing: true,
      // Still every state, still in a fixed order -- a state with no postings has to stay
      // selectable, and a zero is itself the useful signal. But only when the counts were
      // actually computed: when they were skipped, every state must come back with no count
      // at all rather than a zero, which would render as "TX (0)" and read as fact.
      all_states: ALL_STATES.map((state) =>
        stateCountByCode.size > 0 ? { ...state, count: stateCountByCode.get(state.value) ?? 0 } : { ...state }
      ),
      // True when the company counts cover only the postings whose state is resolved in the
      // projection, so the page can label them as a floor rather than a total.
      companies_are_state_floor: stateOnly,
      facets: { states: wideFacets.states, cities: [], companies: wideFacets.companies, title_words: [], ats: [] }
    };
  }

  const sql =
    `SELECT company_name, position_name, location, locations_json, hidden, pay_min, pay_max, job_posting_url\n` +
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
  const byCity = new Map();
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

    // Cities from the parsed entries, keyed "City|ST" so the value can be handed straight
    // back as a filter. Unqualified cities are skipped: "Kent" on its own is not a filter
    // anyone can act on.
    const entries = row.locations_json ? parseLocationsJson(row.locations_json) : parsePostingLocation(location).locations;
    for (const entry of entries) {
      if (!entry.city || !entry.state_region) continue;
      tally(byCity, entry.city + "|" + entry.state_region);
    }

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
      cities: top(byCity),
      companies: top(byCompany),
      title_words: top(byWord),
      ats: top(byAts)
    }
  };
}

module.exports = { computeFacets, titleWords, FACET_CANDIDATE_CAP };
