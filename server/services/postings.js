const { normalizePostingSort } = require("../helpers/normalize-strings");
const { normalizeAtsFilters, normalizeAtsFilterValue, inferAtsFromJobPostingUrl, inferPostingLocationFromJobUrl  } = require("../helpers/normalize-ats");
const { normalizeStringArray, normalizeLikeText, normalizeAppliedByType, normalizeAppliedByLabel, normalizeIgnoredByLabel, cleanHtmlText } = require("../helpers/normalize-strings");
const { normalizeCompensationType, normalizeCompensationPayPeriod, normalizeEducationLevels, parseEducationLevels, normalizeCompensationCurrencyCode, parseCountyFilters, parseCountryFilters, parseRegionFilters, normalizeRemoteFilters, buildIndustryMatchersByKey, rowMatchesIndustryLikeParts, rowMatchesEducationFilter, rowMatchesCompensationFilter, rowMatchesCompensationRangeFilter, rowMatchesLocationFilters, rowMatchesRemoteFilter, buildDefaultCountryFilterOptions, inferLocationGeo, LOCATION_REGION_OPTIONS, STATE_CODE_TO_NAME } = require("../helpers/description-filters");
const { normalizePayFilterNumber, normalizeBoolean, parseNonNegativeInteger, nowEpochSeconds, parsePostingDateToEpochSeconds, getPostingFreshnessWindowSeconds } = require("../helpers/normalize-numbers");
const { inferAshbyLocationFromDescription } = require("../ats/ashby/service.js");
const { getDb, setDb, getReadDb, getStatusReadDb, getPostingLocationByJobUrl } = require("../services/runtime-context")
const { parseCityFilters, rowMatchesCityFilters, parseLocationsJson, parsePostingLocation } = require("../helpers/parse-location")
const { enrichPostingClassification, classifyPosting } = require("./posting-classification.js");
const { setPostingIgnoredCompatibility } = require("./posting-review.js");
const { getMatchesByPostingIdsForKeys } = require("./posting-match.js");
const { DEFAULT_DOCUMENT_KEY, listResumeDocumentKeys } = require("./applicant-documents.js");

const DEFAULT_COUNTRY_FILTER_OPTIONS = buildDefaultCountryFilterOptions();
let postingLocationGeoFilterOptionsCache = {
  mapRef: null,
  mapSize: -1,
  countries: [],
  regions: []
};

function getPostingsOrderByClause(sortBy) {
  if (sortBy === "company_asc") {
    return "company_name ASC, position_name ASC";
  }
  // "Newest to this instance". last_seen_epoch below cannot answer that: it records when
  // the sync last touched a row, every row in a sync batch shares one timestamp, and the
  // company order within a pass is shuffled -- so sorting by it is close to sync noise.
  // first_seen_epoch is the discovery time and does not move once set. Bare column, so
  // this streams from idx_postings_hidden_first_seen_epoch the same way the default does.
  if (sortBy === "first_seen_desc") {
    return "first_seen_epoch DESC, id DESC";
  }
  // Deliberately not COALESCE(last_seen_epoch, 0): wrapping the column made the sort key
  // an opaque expression, which forced a full scan even on the bounded page query. SQLite
  // already sorts NULLs last under DESC, which is where COALESCE-to-zero put them anyway.
  // Bare, it is served by idx_postings_hidden_last_seen_epoch, which lets the page stream
  // from the index and stop at LIMIT rather than sorting the visible set in a temp b-tree.
  return "last_seen_epoch DESC, id DESC";
}

// Postings are hidden by pruneExpiredPostings during sync, but reads must not depend on
// a sync having happened recently, so the visible set is bounded by the same freshness
// window here. This replaces a pruneExpiredPostings() call that used to run - as a write
// transaction - on every listing request.
//
// The callers compare this against last_seen_epoch, matching pruneExpiredPostings. They
// used to compare it against first_seen_epoch, which quietly re-imposed the age-based
// cutoff at query time: a posting the sync had correctly revived was still filtered out
// of every listing because it had been *discovered* more than one window ago. Keeping the
// two sides on the same column is what makes the visible set mean "the ATS still lists
// this". Bare column, not COALESCE, to preserve the covering index range scan.
function getPostingFreshnessCutoffEpoch() {
  return nowEpochSeconds() - getPostingFreshnessWindowSeconds();
}

function parseJsonArraySafe(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// A plain LEFT JOIN's null match_percent can't distinguish "never scored" from "scored, but
// nothing to score against" (see posting-match.js's computeMatchForPosting: available:false
// when requirements_total is 0). Both used to collapse into the same
// match_available/match_percent shape, which is what let match_available: true ship with a
// null percent, and let an unscored resume key disappear from match_scores instead of
// reading as pending. rowExists tells the two apart; descriptionAvailable further splits
// "not scored yet" from "nothing to score" for a row that was never even attempted.
function deriveMatchStatus({ rowExists, matchPercent, descriptionAvailable }) {
  if (!rowExists) return descriptionAvailable ? "pending" : "no_description";
  return matchPercent === null || matchPercent === undefined ? "no_requirements_detected" : "scored";
}

function normalizeMatchPercentFilter(value) {
  if (value === undefined || value === null || value === "") return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.max(0, Math.min(100, numeric));
}

// A search term is user text, so % and _ arrive as literals but mean "anything" to LIKE.
// Leaving them unescaped cannot return a wrong row -- the JS filter still decides -- but a
// term containing % would match every posting and hand the whole table back to JS, which
// is the exact cost this pre-filter exists to avoid.
function escapeLikeTerm(term) {
  return String(term).replace(/[\\%_]/g, (match) => `\\${match}`);
}

// Narrows the candidate set for the filtered branch. Every clause here has to be a
// superset of the JS predicate it mirrors -- the JS filter still runs afterwards and stays
// the authority, so a clause that is too broad only costs speed, while one that is too
// narrow silently loses postings. Only filters that can be proven superset-safe against a
// stored column are included; ats, industry, location and remote all match on values
// derived at read time (inferred from the URL, joined from companies) and are left to JS.
function buildCandidatePrefilter({ searchTerms, payMinFilter, payMaxFilter, payPeriods, stateCodes, stateLocationFallbackUrls = [], includeUnknownPay = true }) {
  const clauses = [];
  const params = [];

  // The JS search matches company_name, position_name and the *enriched* location. The
  // enriched value is `storedLocation || mappedLocation || inferredLocation || ...`, so
  // whenever the stored column is non-empty it is exactly what JS compares against, and a
  // LIKE on the column is faithful. When the column is empty the enriched value can come
  // from somewhere this query cannot see, so those rows are always kept as candidates.
  for (const term of searchTerms) {
    clauses.push(`
      AND (
        LOWER(company_name) LIKE ? ESCAPE '\\'
        OR LOWER(position_name) LIKE ? ESCAPE '\\'
        OR LOWER(COALESCE(location, '')) LIKE ? ESCAPE '\\'
        OR location IS NULL
        OR TRIM(location) = ''
      )`);
    const pattern = `%${escapeLikeTerm(term)}%`;
    params.push(pattern, pattern, pattern);
  }

  // Mirrors rowMatchesCompensationRangeFilter, including its treatment of unknown pay:
  // when unknowns are kept (the default), a row with no figure must survive the prefilter
  // too, otherwise the SQL narrows below what JS would keep and postings vanish silently.
  // When unknowns are excluded, only ~4% of rows carry a figure, so this is where the
  // branch sheds the most work.
  const hasRangeFilter = Number.isFinite(payMinFilter) || Number.isFinite(payMaxFilter);
  if (hasRangeFilter) {
    const knownPayClauses = [`(COALESCE(pay_min, 0) > 0 OR COALESCE(pay_max, 0) > 0)`];
    if (Number.isFinite(payMinFilter)) {
      // rowUpper >= selectedPayMin, where rowUpper falls back to pay_min.
      knownPayClauses.push(`(CASE WHEN COALESCE(pay_max, 0) > 0 THEN pay_max ELSE pay_min END) >= ?`);
      params.push(payMinFilter);
    }
    if (Number.isFinite(payMaxFilter)) {
      // rowLower <= selectedPayMax, where rowLower falls back to pay_max.
      knownPayClauses.push(`(CASE WHEN COALESCE(pay_min, 0) > 0 THEN pay_min ELSE pay_max END) <= ?`);
      params.push(payMaxFilter);
    }
    const knownPay = knownPayClauses.join("\n    AND ");
    clauses.push(
      includeUnknownPay
        ? `AND ((COALESCE(pay_min, 0) <= 0 AND COALESCE(pay_max, 0) <= 0) OR (${knownPay}))`
        : `AND (${knownPay})`
    );
  }

  // Prefer the indexed projection of parsed state columns/JSON. The old LIKE-only prefilter treated a two-letter
  // state code as an arbitrary substring ("WA" matched Warsaw), which left hundreds of
  // thousands of false candidates for JavaScript to materialise and discard. Multi-location
  // postings need the projection because the flat column intentionally stores only the
  // primary location.
  //
  // Empty stored locations are covered by separator-bounded URL matches and by explicit
  // runtime-map URLs below. Retaining every empty row was correct but expensive: it forced
  // roughly 150k known non-matches through JavaScript for every state-filtered refresh.
  if (Array.isArray(stateCodes) && stateCodes.length > 0) {
    const structuredStatePlaceholders = stateCodes.map(() => "?").join(", ");
    const legacyStateClauses = [];
    const urlStateClauses = [];
    const legacyStateParams = [];
    const urlStateParams = [];
    const fallbackUrlParams = [];
    for (const code of stateCodes) {
      const stateName = STATE_CODE_TO_NAME[String(code || "").trim().toUpperCase()];
      legacyStateClauses.push(`LOWER(location) LIKE ? ESCAPE '\\'`);
      legacyStateParams.push(`%${escapeLikeTerm(String(code || "").toLowerCase())}%`);
      if (stateName) {
        legacyStateClauses.push(`LOWER(location) LIKE ? ESCAPE '\\'`);
        legacyStateParams.push(`%${escapeLikeTerm(stateName)}%`);
        urlStateClauses.push(`LOWER(job_posting_url) LIKE ? ESCAPE '\\'`);
        urlStateParams.push(`%${escapeLikeTerm(stateName)}%`);
      }
      // URL-derived locations are the reason empty stored locations previously had to be
      // retained wholesale. Match only separator-bounded state slugs here: an arbitrary
      // "%wa%" URL search also matches words such as "software" and recreates the scan.
      urlStateClauses.push(`LOWER(job_posting_url) GLOB ?`);
      urlStateParams.push(`*[-/_]${String(code || "").toLowerCase()}[-/_]*`);
    }

    const fallbackUrlClauses = [];
    for (let index = 0; index < stateLocationFallbackUrls.length; index += 400) {
      const chunk = stateLocationFallbackUrls.slice(index, index + 400);
      fallbackUrlClauses.push(`job_posting_url IN (${chunk.map(() => "?").join(", ")})`);
      fallbackUrlParams.push(...chunk);
    }
    params.push(
      ...stateCodes,
      ...legacyStateParams,
      ...urlStateParams,
      ...fallbackUrlParams
    );
    clauses.push(`
      AND (
        id IN (
          SELECT posting_id
          FROM posting_location_states
          WHERE state_region IN (${structuredStatePlaceholders})
        )
        OR (
          (locations_json IS NULL OR TRIM(locations_json) = '' OR locations_json = '[]')
          AND location IS NOT NULL
          AND TRIM(location) <> ''
          AND (${legacyStateClauses.join("\n          OR ")})
        )
        OR ${urlStateClauses.join("\n        OR ")}
        ${fallbackUrlClauses.length > 0 ? `OR ${fallbackUrlClauses.join("\n        OR ")}` : ""}
      )`);
  }

  // A row whose pay_period is absent can never be in the selected set, since the JS filter
  // requires the normalised period to appear in it. The values themselves are not compared
  // here: normalisation happens in JS and stored spellings vary.
  if (Array.isArray(payPeriods) && payPeriods.length > 0) {
    clauses.push(`AND pay_period IS NOT NULL AND TRIM(pay_period) <> ''`);
  }

  return { sql: clauses.join("\n"), params };
}

// Resumes the wide-scan candidate walk without SQL OFFSET. OFFSET has no bookmark: every
// chunk call re-walks the ordering index from the start and re-discards everything before
// it, so cost compounds across chunks whenever the JS-only filters don't converge in the
// first one or two -- confirmed against production data (states=WA + review_queue=new),
// this turned a 6s single scan into 45s of paging and is what was timing out real requests.
// A `WHERE (sort key) < (last cursor)` predicate lets SQLite resume through the same
// ordering index where the previous chunk stopped, so total cost across every chunk stays
// proportional to the candidates scanned once, not to chunk_count * rows_already_skipped.
function buildSeekPredicate(sortBy, cursor) {
  if (!cursor) return { sql: "", params: [] };
  if (sortBy === "company_asc") {
    return {
      sql: `AND (
        p.company_name > ?
        OR (p.company_name = ? AND p.position_name > ?)
        OR (p.company_name = ? AND p.position_name = ? AND p.id > ?)
      )`,
      params: [
        cursor.company_name, cursor.company_name, cursor.position_name,
        cursor.company_name, cursor.position_name, cursor.id
      ]
    };
  }
  if (sortBy === "match_desc") {
    // Same three-tier descending tuple as the last_seen_epoch/id case below, with
    // match_sort_key (COALESCE(m.match_percent, -1), see candidateQuery above) as the
    // leading column -- a plain descending seek predicate works because -1 sorting below
    // every real 0-100 score already gives "never scored" rows the nulls-last position,
    // with no separate NULL-aware branch needed here.
    return {
      sql: `AND (
        COALESCE(m.match_percent, -1) < ?
        OR (COALESCE(m.match_percent, -1) = ? AND p.last_seen_epoch < ?)
        OR (COALESCE(m.match_percent, -1) = ? AND p.last_seen_epoch = ? AND p.id < ?)
      )`,
      params: [
        cursor.match_sort_key, cursor.match_sort_key, cursor.last_seen_epoch,
        cursor.match_sort_key, cursor.last_seen_epoch, cursor.id
      ]
    };
  }
  const column = sortBy === "first_seen_desc" ? "first_seen_epoch" : "last_seen_epoch";
  return {
    sql: `AND (
      p.${column} < ?
      OR (p.${column} = ? AND p.id < ?)
    )`,
    params: [cursor[column], cursor[column], cursor.id]
  };
}

function extractSeekCursor(sortBy, row) {
  if (!row) return null;
  if (sortBy === "company_asc") {
    return { company_name: row.company_name, position_name: row.position_name, id: row.id };
  }
  if (sortBy === "match_desc") {
    return { match_sort_key: Number(row.match_sort_key), last_seen_epoch: row.last_seen_epoch, id: row.id };
  }
  const column = sortBy === "first_seen_desc" ? "first_seen_epoch" : "last_seen_epoch";
  return { [column]: row[column], id: row.id };
}

function formatEpochDateLabel(epochValue) {
  const epoch = Number(epochValue);
  if (!Number.isFinite(epoch) || epoch <= 0) return "";
  return new Date(epoch * 1000).toISOString().slice(0, 10);
}

function buildSyncedFallbackPostingDate(firstSeenEpoch, lastSeenEpoch) {
  const syncedDate = formatEpochDateLabel(firstSeenEpoch || lastSeenEpoch);
  if (!syncedDate) return "Source date unavailable (synced to database)";
  return `Source date unavailable (synced to database on ${syncedDate})`;
}

function buildSyncedAndSourceDateLabel(firstSeenEpoch, lastSeenEpoch, sourceDateLabel, sourceDatePrefix = "Source date") {
  const syncedDate = formatEpochDateLabel(firstSeenEpoch || lastSeenEpoch);
  const sourceDate = String(sourceDateLabel || "").trim();
  if (syncedDate && sourceDate) {
    return `Synced to database on ${syncedDate} - ${sourceDatePrefix}: ${sourceDate}`;
  }
  if (sourceDate) return sourceDate;
  return buildSyncedFallbackPostingDate(firstSeenEpoch, lastSeenEpoch);
}

const SYNC_DATE_FALLBACK_ATS = new Set([
  "theapplicantmanager",
  "teamtailor",
  "taleo",
  "talentlyft",
  "talentreef",
  "applicantai",
  "applitrack",
  "applytojob",
  "avature",
  "careerplug",
  "careerspage",
  "factorialhr",
  "freshteam",
  "gem",
  "hiringplatform",
  "homerun",
  "jobaps",
  "jobvite",
  "peopleforce",
  "prismhr",
  "recruitee",
  "rippling",
  "sagehr",
  "silkroad",
  "simplicant"
]);

const SYNC_FALLBACK_ISO_ATS = new Set(["paycor", "prismhr"]);

function hasRealSourcePostingDate(rawPostingDate, ats, firstSeenEpoch, lastSeenEpoch) {
  const raw = String(rawPostingDate || "").trim();
  if (!raw) return false;

  const lower = raw.toLowerCase();
  if (lower.includes("source date unavailable") || lower.includes("synced to database")) {
    return false;
  }

  const referenceEpoch = Number(lastSeenEpoch || firstSeenEpoch || nowEpochSeconds());
  const parsedEpoch = parsePostingDateToEpochSeconds(raw, Number.isFinite(referenceEpoch) ? referenceEpoch : nowEpochSeconds());
  if (!parsedEpoch) return false;

  if (SYNC_FALLBACK_ISO_ATS.has(String(ats || "").trim().toLowerCase())) {
    const seenEpochs = [Number(firstSeenEpoch), Number(lastSeenEpoch)].filter(
      (value) => Number.isFinite(value) && value > 0
    );
    if (seenEpochs.some((value) => Math.abs(parsedEpoch - value) <= 5)) {
      return false;
    }
  }

  return true;
}


// Distinct locations are read from the stored column, not just the in-memory map:
// the map is empty after a restart, which used to shrink the country list to the
// static defaults until a full sync pass had run. Cached for a short interval because
// the underlying DISTINCT scans the visible set.
const LOCATION_GEO_OPTIONS_TTL_MS = 60000;

// The wide-scan chunked walk (see the candidateQuery branch below) had no bound on total
// work: its only exits were "found a full page" or "exhausted every SQL candidate in every
// phase" -- i.e., the entire visible Postings table, if a filter combination is rare enough
// that JS-side predicates (industries, states, review_queue's freshness classification...)
// almost never match. Each chunk yields to the event loop (yieldToEventLoop), so it was
// never a true infinite loop, but at this table's current size (tens of millions of rows)
// a genuinely rare combination can still mean tens of thousands of chunks -- observed
// directly: one such request degraded the whole API to the point of not responding to
// SIGTERM for 90+ seconds, twice, needing a hard kill. Capping total candidates scanned
// trades an always-eventually-complete page for a bounded worst case; scan_bounded on the
// response tells a caller the page may be incomplete because the scan gave up, not because
// there is truly nothing more to find, so a UI can suggest narrowing the filter.
const MAX_WIDE_SCAN_CANDIDATE_ROWS = Number(process.env.POSTINGS_WIDE_SCAN_MAX_CANDIDATES || 50000);

async function readDistinctStoredLocations() {
  // Read-only, and called from the filter-options bootstrap request -- getReadDb() keeps it
  // off the sync's write connection so it does not queue behind an in-progress flush.
  const db = getReadDb();
  try {
    const rows = await db.all(
      `
        SELECT DISTINCT location
        FROM Postings
        WHERE ${visibilityPredicate}
          AND last_seen_epoch >= ?
          AND location IS NOT NULL
          AND TRIM(location) <> '';
      `,
      [getPostingFreshnessCutoffEpoch()]
    );
    return rows.map((row) => String(row?.location || "").trim()).filter(Boolean);
  } catch {
    // Fall back to whatever the in-memory map has rather than failing the request.
    return [];
  }
}

async function getPostingLocationGeoFilterOptions() {
  const postingLocationByJobUrl = getPostingLocationByJobUrl();
  const now = Date.now();
  if (
    postingLocationGeoFilterOptionsCache.mapRef === postingLocationByJobUrl &&
    postingLocationGeoFilterOptionsCache.mapSize === postingLocationByJobUrl.size &&
    now - Number(postingLocationGeoFilterOptionsCache.builtAtMs || 0) < LOCATION_GEO_OPTIONS_TTL_MS
  ) {
    return postingLocationGeoFilterOptionsCache;
  }

  const storedLocations = await readDistinctStoredLocations();

  const countriesByValue = new Map(DEFAULT_COUNTRY_FILTER_OPTIONS.map((country) => [country.value, { ...country }]));
  const defaultCountryValues = new Set(DEFAULT_COUNTRY_FILTER_OPTIONS.map((country) => country.value));
  const presentRegions = new Set();
  for (const country of DEFAULT_COUNTRY_FILTER_OPTIONS) {
    const region = String(country?.region || "").trim().toUpperCase();
    if (region) presentRegions.add(region);
  }

  // The map can be ahead of the stored column for rows the running sync has touched
  // but not yet flushed, so consider both.
  const allLocations = new Set([...storedLocations, ...postingLocationByJobUrl.values()]);
  // Only locations that resolve to an ISO country contribute an option. inferLocationGeo
  // leaves countryCode empty for the rest, which is most of them -- two thirds of the
  // distinct locations in a full database name no country at all.
  for (const location of allLocations) {
    const inferred = inferLocationGeo(location);
    if (inferred.countryCode && inferred.countryLabel) {
      const existing = countriesByValue.get(inferred.countryCode);
      if (!existing) {
        countriesByValue.set(inferred.countryCode, {
          value: inferred.countryCode,
          label: inferred.countryLabel,
          region: inferred.region || ""
        });
      } else if (!existing.label && inferred.countryLabel) {
        existing.label = inferred.countryLabel;
      } else if (!existing.region && inferred.region) {
        existing.region = inferred.region;
      }
    }
    if (inferred.region) presentRegions.add(inferred.region);
  }

  const defaultCountriesInOrder = DEFAULT_COUNTRY_FILTER_OPTIONS.map((country) => countriesByValue.get(country.value))
    .filter(Boolean);
  const dynamicCountries = Array.from(countriesByValue.values())
    .filter((country) => !defaultCountryValues.has(country.value))
    .sort((a, b) =>
      String(a?.label || "").localeCompare(String(b?.label || ""))
    );
  const countries = [...defaultCountriesInOrder, ...dynamicCountries].sort((a, b) => {
    const aIsDefault = defaultCountryValues.has(a?.value);
    const bIsDefault = defaultCountryValues.has(b?.value);
    if (aIsDefault && !bIsDefault) return -1;
    if (!aIsDefault && bIsDefault) return 1;
    if (aIsDefault && bIsDefault) {
      const aIndex = DEFAULT_COUNTRY_FILTER_OPTIONS.findIndex((country) => country.value === a.value);
      const bIndex = DEFAULT_COUNTRY_FILTER_OPTIONS.findIndex((country) => country.value === b.value);
      return aIndex - bIndex;
    }
    return String(a?.label || "").localeCompare(String(b?.label || ""));
  });
  const regions = LOCATION_REGION_OPTIONS.filter(
    (option) => presentRegions.size === 0 || presentRegions.has(option.value)
  ).map((option) => ({ ...option }));

  postingLocationGeoFilterOptionsCache = {
    mapRef: postingLocationByJobUrl,
    mapSize: postingLocationByJobUrl.size,
    builtAtMs: now,
    countries,
    regions
  };
  return postingLocationGeoFilterOptionsCache;
}

// A filtered query has to scan the whole visible set, because the predicates are
// evaluated in JS and the page cannot be cut until they have run. That scan costs
// hundreds of MB and currently takes several seconds — longer than the client's
// debounce — so adjusting a few filters in a row could leave two or three scans
// resident at once and multiply the cost into an out-of-memory kill. Only one wide
// scan is allowed to be in flight at a time; the rest queue.
let wideScanChain = Promise.resolve();
let wideScanActive = false;
let wideScanQueued = 0;
let wideScanPeakQueued = 0;

function createRequestAbortedError() {
  const error = new Error("Request was canceled before the posting scan completed.");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw createRequestAbortedError();
}

function yieldToEventLoop() {
  return new Promise((resolve) => setImmediate(resolve));
}

function runExclusiveWideScan(task, signal) {
  if (signal?.aborted) return Promise.reject(createRequestAbortedError());
  wideScanQueued += 1;
  if (wideScanQueued > wideScanPeakQueued) wideScanPeakQueued = wideScanQueued;
  if (wideScanActive) {
    console.log(`[OpenPostings API] filtered query waiting; ${wideScanQueued} queued`);
  }

  const run = wideScanChain.then(
    async () => {
      wideScanActive = true;
      try {
        throwIfAborted(signal);
        return await task();
      } finally {
        wideScanActive = false;
        wideScanQueued -= 1;
      }
    },
    async () => {
      // The previous scan failed; that must not stop this one from running.
      wideScanActive = true;
      try {
        throwIfAborted(signal);
        return await task();
      } finally {
        wideScanActive = false;
        wideScanQueued -= 1;
      }
    }
  );

  // Keep the chain usable no matter how this task settled.
  wideScanChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

function getWideScanStats() {
  return { active: wideScanActive, queued: wideScanQueued, peak_queued: wideScanPeakQueued };
}

function normalizeJobDescription(rawJobDescription, ats) {
  if (ats === "workday") return cleanHtmlText(rawJobDescription) || null;
  return String(rawJobDescription || "").trim() || null;
}

// Fills in job_description for an already-paginated set of rows. The filtered query
// omits the column so it can scan the whole visible set cheaply, which means only the
// handful of rows actually being returned need the text.
async function hydrateJobDescriptions(db, items) {
  const pending = items.filter((item) => item?.job_description === undefined && item?.id !== undefined);
  if (pending.length === 0) {
    return items.map((item) =>
      item?.job_description === undefined ? { ...item, job_description: null } : item
    );
  }

  const descriptionById = new Map();
  const CHUNK_SIZE = 400; // Stay well inside SQLite's bound-parameter limit.
  for (let index = 0; index < pending.length; index += CHUNK_SIZE) {
    const chunk = pending.slice(index, index + CHUNK_SIZE);
    const placeholders = chunk.map(() => "?").join(", ");
    const rows = await db.all(
      `SELECT id, job_description FROM Postings WHERE id IN (${placeholders});`,
      chunk.map((item) => item.id)
    );
    for (const row of rows) {
      descriptionById.set(row?.id, row?.job_description);
    }
  }

  return items.map((item) => {
    if (item?.job_description !== undefined) return item;
    return {
      ...item,
      job_description: normalizeJobDescription(descriptionById.get(item?.id), item?.ats)
    };
  });
}

async function listPostingsWithFilters(options = {}) {
  // The reader connection, not the writer. This is the app's hottest read, and on the
  // shared connection every call queued behind whatever write transaction the sync was in
  // -- which is exactly the timeout the app reports ("a sync competes with it for the same
  // database connection"). WAL lets a separate reader see committed data without taking a
  // lock, so it neither blocks the sync nor waits on it.
  const db = getReadDb();
  const signal = options?.signal;
  throwIfAborted(signal);
  const classificationNowEpoch = nowEpochSeconds();
  const classificationWindowSeconds = getPostingFreshnessWindowSeconds();
  const classificationOptions = {
    now_epoch: classificationNowEpoch,
    freshness_window_seconds: classificationWindowSeconds
  };
  const freshnessCutoffEpoch = classificationNowEpoch - classificationWindowSeconds;
  const search = String(options?.search || "").trim();
  const limit = Math.max(1, Math.min(2000, Number(options?.limit || 500)));
  const offset = Math.max(0, Number(options?.offset || 0));
  const sortBy = normalizePostingSort(options?.sort_by);
  const orderByClause = getPostingsOrderByClause(sortBy);
  const atsFilters = normalizeAtsFilters(options?.ats || []);
  const industryKeys = normalizeStringArray(options?.industries).map((key) => normalizeLikeText(key));
  const compensationTypes = normalizeStringArray(options?.compensation_types).map((value) =>
    normalizeCompensationType(value, "unknown")
  );
  const payPeriods = normalizeStringArray(options?.pay_periods)
    .map((value) => normalizeCompensationPayPeriod(value))
    .filter(Boolean);
  const payMinFilter = normalizePayFilterNumber(options?.pay_min);
  const payMaxFilter = normalizePayFilterNumber(options?.pay_max);
  const minMatchPercentFilter = normalizeMatchPercentFilter(options?.min_match_percent);
  // Which resume's cached scores drive sort_by=match_desc and min_match_percent. Every
  // uploaded resume's score is still attached to each returned row when include_match is on
  // (see the match_scores enrichment below) -- this only picks the one axis SQL can order/
  // filter by in a single query.
  const resumeKey = String(options?.resume_key || "").trim() || DEFAULT_DOCUMENT_KEY;
  // include_match defaults false: joining posting_match_scores forces this into the
  // wide-scan branch below (see needsMatchJoin), so an unrequested join must not turn every
  // ordinary page load into a chunked scan. sort_by=match_desc or min_match_percent opt in
  // implicitly, since a match-ordered or match-filtered result is meaningless without it.
  const includeMatch = normalizeBoolean(options?.include_match, false);
  // Most rows carry no pay figure at all, so a pay range that dropped them excluded whole
  // employers rather than out-of-range offers. Unknown pay stays in unless opted out.
  const includeUnknownPay = normalizeBoolean(options?.include_unknown_pay, true);
  const educationLevels = normalizeEducationLevels(options?.education_levels);
  const stateCodes = normalizeStringArray(options?.states).map((state) => state.toUpperCase());
  const countyFilters = parseCountyFilters(normalizeStringArray(options?.counties));
  const countryFilters = parseCountryFilters(normalizeStringArray(options?.countries));
  const regionFilters = parseRegionFilters(normalizeStringArray(options?.regions));
  const remoteFilters = normalizeRemoteFilters(options?.remote);
  const hideNoDate = normalizeBoolean(options?.hide_no_date, false);
  const includeApplied = normalizeBoolean(options?.include_applied, true);
  const includeIgnored = normalizeBoolean(options?.include_ignored, false);
  // Defaults true so existing callers, including the MCP tools, are unaffected.
  const includeDescriptions = normalizeBoolean(options?.include_descriptions, true);
  // Postings verified gone (404, or a page that says the role is filled/closed) stay out
  // of candidate lists unless explicitly asked for. 'unverified' rows are still shown --
  // most rows have never been fetched, and absence of proof is not proof of death.
  const includeDead = normalizeBoolean(options?.include_dead, false);
  // Postings the employer is still listing but whose posting_date fell outside the
  // freshness window. They are hidden, but unlike delisted ones they can still be applied
  // to, so this is opt-in rather than lumped in with "hidden".
  const includeStaleDated = normalizeBoolean(options?.include_stale_dated, false);
  const reviewQueue = String(options?.review_queue || "").trim().toLowerCase();
  if (reviewQueue && !["new", "shortlisted", "reviewed"].includes(reviewQueue)) {
    throw new Error("review_queue must be one of: new, shortlisted, reviewed");
  }
  // "Seattle|WA" from the dropdowns, "Seattle, WA" from a text box; both land here.
  const cityFilters = parseCityFilters(options?.cities);
  const visibilityPredicate = includeStaleDated
    ? "(hidden = 0 OR hidden_reason = 'outside_date_window')"
    : "hidden = 0";
  const visibilityPredicateAliased = includeStaleDated
    ? "(p.hidden = 0 OR p.hidden_reason = 'outside_date_window')"
    : "p.hidden = 0";
  const hasStructuredFilters =
    atsFilters.length > 0 ||
    industryKeys.length > 0 ||
    compensationTypes.length > 0 ||
    payPeriods.length > 0 ||
    payMinFilter !== null ||
    payMaxFilter !== null ||
    educationLevels.length > 0 ||
    stateCodes.length > 0 ||
    countyFilters.length > 0 ||
    countryFilters.length > 0 ||
    regionFilters.length > 0 ||
    // Without this a city filter is accepted, stored, and then silently ignored: the
    // no-filter branch skips the JS predicate entirely, so the query returned the whole
    // unfiltered listing while looking like it had filtered.
    cityFilters.length > 0 ||
    !(remoteFilters.length === 1 && remoteFilters[0] === "all") ||
    minMatchPercentFilter !== null;

  // Ordering or filtering by a joined column has no place in the bounded branch's plain
  // `ORDER BY ... LIMIT ? OFFSET ?` -- it needs the chunked/seek-predicate machinery below,
  // the same as any other filter SQL alone cannot express.
  const needsMatchJoin = includeMatch || minMatchPercentFilter !== null || sortBy === "match_desc";
  const needsWideScan = Boolean(search) || hasStructuredFilters || Boolean(reviewQueue) || needsMatchJoin;
  const postingLocationByJobUrl = getPostingLocationByJobUrl();
  const stateLocationFallbackUrls = stateCodes.length > 0
    ? Array.from(postingLocationByJobUrl.entries())
        .filter(([, location]) => rowMatchesLocationFilters(location, stateCodes, [], [], []))
        .map(([jobPostingUrl]) => String(jobPostingUrl || "").trim())
        .filter(Boolean)
        // Persisted rows are covered by state_region/locations_json. This fallback is for
        // the at-most-one flush batch whose runtime location is ahead of SQLite; bounding it
        // avoids exceeding SQLite's parameter limit on multi-state searches.
        .slice(-1000)
    : [];

  const runPostingsQuery = async () => {
  let rows = [];
  let candidateQuery = null;
  if (!search && !hasStructuredFilters && !reviewQueue && !needsMatchJoin) {
    if (includeApplied && includeIgnored) {
      rows = await db.all(
        `
          SELECT id, company_name, position_name, job_posting_url, posting_date, location, locations_json, status, location_conflict, requires_account, hidden, hidden_reason, job_description, compensation_type, education_levels, pay_min, pay_max, pay_currency, pay_period, pay_raw, first_seen_epoch, last_seen_epoch
          FROM Postings
          WHERE ${visibilityPredicate}
            AND last_seen_epoch >= ?
            AND (? = 0 OR (posting_date IS NOT NULL AND TRIM(posting_date) <> ''))
            AND NOT EXISTS (
              SELECT 1
              FROM blocked_companies b
              WHERE b.normalized_company_name = LOWER(TRIM(Postings.company_name))
            )
          ORDER BY ${orderByClause}
          LIMIT ? OFFSET ?;
        `,
        [freshnessCutoffEpoch, hideNoDate ? 1 : 0, limit, offset]
      );
    } else {
      rows = await db.all(
        `
          SELECT p.id, p.company_name, p.position_name, p.job_posting_url, p.posting_date, p.location, p.locations_json, p.status, p.location_conflict, p.requires_account, p.hidden, p.hidden_reason, p.job_description, p.compensation_type, p.education_levels, p.pay_min, p.pay_max, p.pay_currency, p.pay_period, p.pay_raw, p.first_seen_epoch, p.last_seen_epoch
          FROM Postings p
          LEFT JOIN posting_application_state s
            ON s.job_posting_url = p.job_posting_url
            AND (
              (${includeApplied ? 0 : 1} = 1 AND COALESCE(s.applied, 0) = 1)
              OR
              (${includeIgnored ? 0 : 1} = 1 AND COALESCE(s.ignored, 0) = 1)
            )
          WHERE ${visibilityPredicateAliased}
            AND p.last_seen_epoch >= ?
            AND (? = 0 OR (p.posting_date IS NOT NULL AND TRIM(p.posting_date) <> ''))
            AND NOT EXISTS (
              SELECT 1
              FROM blocked_companies b
              WHERE b.normalized_company_name = LOWER(TRIM(p.company_name))
            )
            AND s.job_posting_url IS NULL
          ORDER BY ${orderByClause}
          LIMIT ? OFFSET ?;
        `,
        [freshnessCutoffEpoch, hideNoDate ? 1 : 0, limit, offset]
      );
    }
  } else {
    // This branch cannot use LIMIT: the filters below are evaluated in JS, so the
    // whole candidate set has to be scanned before the page can be cut. job_description
    // is therefore deliberately not selected here — no filter predicate reads it, and
    // including it pulled hundreds of MB of text (which V8 then doubles as UTF-16, and
    // doubles again when the rows are enriched) into memory on every filtered request.
    // Descriptions are fetched for the returned page only, once the slice is known.
    //
    // The candidate set is narrowed first by buildCandidatePrefilter. Profiling this
    // branch at 650k rows put almost none of the 12.6s in the filter predicate itself
    // (~110ms): the cost is fetching the rows, materialising them in the driver, the GC
    // that follows, and enriching rows that are about to be discarded. Dropping rows in
    // SQL is the only thing that touches all four at once.
    const prefilter = buildCandidatePrefilter({
      searchTerms: search.toLowerCase().split(/\s+/).filter(Boolean),
      payMinFilter,
      payMaxFilter,
      payPeriods,
      stateCodes,
      stateLocationFallbackUrls,
      includeUnknownPay
    });
    const reviewStateSql = reviewQueue === "new"
      ? "AND COALESCE(NULLIF(s.review_state, ''), CASE WHEN COALESCE(s.ignored, 0) = 1 THEN 'ignored' ELSE 'unseen' END) = 'unseen'"
      : reviewQueue === "shortlisted"
        ? "AND COALESCE(s.review_state, '') = 'shortlisted'"
        : reviewQueue === "reviewed"
          ? "AND (COALESCE(s.review_state, '') IN ('viewed', 'ignored') OR COALESCE(s.ignored, 0) = 1)"
          : "";
    const reviewStateSelect = reviewQueue
      ? "COALESCE(NULLIF(s.review_state, ''), CASE WHEN COALESCE(s.ignored, 0) = 1 THEN 'ignored' ELSE 'unseen' END)"
      : "'unseen'";
    const reviewStateJoin = reviewQueue
      ? `LEFT JOIN (
          SELECT job_posting_url AS state_job_posting_url, review_state, ignored
          FROM posting_application_state
        ) s ON s.state_job_posting_url = p.job_posting_url`
      : `LEFT JOIN (
          SELECT job_posting_url AS state_job_posting_url
          FROM posting_application_state
        ) s ON s.state_job_posting_url = p.job_posting_url`;
    const reviewVisibilitySql = reviewQueue === "shortlisted" || reviewQueue === "reviewed"
      ? "1 = 1"
      : "p.hidden = 0 AND p.last_seen_epoch >= ?";
    const reviewVisibilityParams = reviewQueue === "shortlisted" || reviewQueue === "reviewed"
      ? []
      : [freshnessCutoffEpoch];
    // company_asc has no id tiebreak in getPostingsOrderByClause because the bounded (cheap)
    // branch never needs one -- a single query with its own OFFSET is internally consistent
    // either way. The wide-scan walk below resumes the same order across many separate
    // queries, so ties between company_name+position_name have to be broken the same way
    // every time or a row can be skipped or repeated at the chunk boundary.
    const wideScanOrderByClause = sortBy === "company_asc"
      ? "company_name ASC, position_name ASC, id ASC"
      : orderByClause;
    const baseSelect = `p.id, p.company_name, p.position_name, p.job_posting_url, p.posting_date,
               p.location, p.locations_json, p.status, p.location_conflict,
               p.requires_account, p.hidden, p.hidden_reason, p.compensation_type,
               p.education_levels, p.pay_min, p.pay_max, p.pay_currency, p.pay_period,
               p.pay_raw, p.first_seen_epoch, p.last_seen_epoch,
               CASE WHEN p.job_description IS NOT NULL AND TRIM(p.job_description) <> '' THEN 1 ELSE 0 END AS description_available,
               ${reviewStateSelect} AS _review_state`;
    const baseWhere = `WHERE ${reviewVisibilitySql}
          AND NOT EXISTS (
          SELECT 1
          FROM blocked_companies b
          WHERE b.normalized_company_name = LOWER(TRIM(p.company_name))
        )
        ${reviewStateSql}`;
    const baseParams = [...reviewVisibilityParams, ...prefilter.params];
    // Every phase's WHERE places its own extra predicate (if any) between baseWhere's `?`
    // and prefilter.sql's `?`s -- textually right after reviewStateSql, same position in
    // every phase below -- so this ordering has to match each phase's SQL text exactly.
    const paramsWithExtra = (extra) => [...reviewVisibilityParams, ...extra, ...prefilter.params];

    if (sortBy === "match_desc") {
      // A LEFT JOIN ordered by COALESCE(m.match_percent, -1) has no index to serve the
      // ORDER BY -- SQLite falls back to sorting the entire visible Postings set in a temp
      // b-tree (measured ~30s against 1.7M rows). Splitting into two phases lets each one
      // use an index for its own ordering instead: phase 1 drives from
      // posting_match_scores' own index (idx_posting_match_scores_percent, cost
      // proportional to how many postings are scored, not the whole table); phase 2 covers
      // postings with no score yet using the same last_seen_epoch/id index the default sort
      // already relies on. CROSS JOIN is a documented SQLite idiom that pins the join order
      // to the FROM-clause order -- without it the planner still preferred driving from
      // Postings' own index and lost the free ordering from idx_posting_match_scores_percent.
      const scoredPhase = {
        sql: `
          SELECT ${baseSelect}, m.match_percent AS match_sort_key, m.match_percent AS match_percent,
                 m.overlap_terms_json AS match_overlap_terms_json,
                 m.unmatched_requirements_json AS match_unmatched_requirements_json,
                 1 AS match_row_exists
          FROM posting_match_scores m
          CROSS JOIN Postings p ON p.id = m.posting_id
          ${reviewStateJoin}
          ${baseWhere}
          AND m.resume_key = ?
          ${minMatchPercentFilter !== null ? "AND m.match_percent >= ?" : ""}
          ${prefilter.sql}
          __SEEK_PREDICATE__
          ORDER BY m.match_percent DESC, p.last_seen_epoch DESC, p.id DESC
        `,
        params: paramsWithExtra([resumeKey, ...(minMatchPercentFilter !== null ? [minMatchPercentFilter] : [])]),
        seekSortBy: "match_desc"
      };
      // Unscored postings can never satisfy a positive match threshold (there is nothing
      // to compare), so this phase is pure waste once min_match_percent has excluded them
      // all anyway.
      const unscoredPhase = minMatchPercentFilter !== null
        ? null
        : {
            sql: `
              SELECT ${baseSelect}, -1 AS match_sort_key, NULL AS match_percent,
                     NULL AS match_overlap_terms_json, NULL AS match_unmatched_requirements_json,
                     0 AS match_row_exists
              FROM Postings p
              ${reviewStateJoin}
              ${baseWhere}
              AND NOT EXISTS (SELECT 1 FROM posting_match_scores m2 WHERE m2.posting_id = p.id AND m2.resume_key = ?)
              ${prefilter.sql}
              __SEEK_PREDICATE__
              ORDER BY p.last_seen_epoch DESC, p.id DESC
            `,
            params: paramsWithExtra([resumeKey]),
            seekSortBy: "recent"
          };
      candidateQuery = {
        phases: [scoredPhase, ...(unscoredPhase ? [unscoredPhase] : [])],
        sortBy
      };
    } else {
      // resume_key belongs in the ON clause, not a later WHERE: this is a LEFT JOIN, and a
      // posting with no score at all (m.resume_key IS NULL) must stay in the result with a
      // null match_percent. Filtering resume_key after the join would also fan a posting out
      // into one row per resume it happens to be scored against instead of the one being
      // asked for.
      const matchJoinSql = needsMatchJoin
        ? "LEFT JOIN posting_match_scores m ON m.posting_id = p.id AND m.resume_key = ?"
        : "";
      const matchJoinParams = needsMatchJoin ? [resumeKey] : [];
      const matchSelectSql = needsMatchJoin
        ? `, COALESCE(m.match_percent, -1) AS match_sort_key, m.match_percent AS match_percent,
               m.overlap_terms_json AS match_overlap_terms_json,
               m.unmatched_requirements_json AS match_unmatched_requirements_json,
               (m.posting_id IS NOT NULL) AS match_row_exists`
        : "";
      const minMatchPercentSql = minMatchPercentFilter !== null ? "AND COALESCE(m.match_percent, -1) >= ?" : "";
      candidateQuery = {
        phases: [
          {
            sql: `
              SELECT ${baseSelect}${matchSelectSql}
              FROM Postings p
              ${reviewStateJoin}
              ${matchJoinSql}
              ${baseWhere}
              ${minMatchPercentSql}
              ${prefilter.sql}
              __SEEK_PREDICATE__
              ORDER BY ${wideScanOrderByClause}
            `,
            params: [
              ...matchJoinParams,
              ...paramsWithExtra(minMatchPercentFilter !== null ? [minMatchPercentFilter] : [])
            ],
            seekSortBy: sortBy
          }
        ],
        sortBy
      };
    }
  }

  const loadCompanyAtsByNormalizedName = async (candidateRows) => {
    const companyAtsByNormalizedName = new Map();
    const normalizedCompanyNames = Array.from(
      new Set(
        candidateRows
          .map((row) => normalizeLikeText(row?.company_name))
          .filter(Boolean)
      )
    );
    if (normalizedCompanyNames.length === 0) return companyAtsByNormalizedName;

    const placeholders = normalizedCompanyNames.map(() => "?").join(", ");
    const companyRows = await db.all(
      `
        SELECT LOWER(TRIM(company_name)) AS normalized_company_name, ATS_name
        FROM companies
        WHERE LOWER(TRIM(company_name)) IN (${placeholders});
      `,
      normalizedCompanyNames
    );
    for (const companyRow of companyRows) {
      const normalizedCompanyName = String(companyRow?.normalized_company_name || "").trim();
      const normalizedAts = normalizeAtsFilterValue(companyRow?.ATS_name);
      if (!normalizedCompanyName || !normalizedAts) continue;
      if (!companyAtsByNormalizedName.has(normalizedCompanyName)) {
        companyAtsByNormalizedName.set(normalizedCompanyName, normalizedAts);
      }
    }
    return companyAtsByNormalizedName;
  };

  // Split in two on purpose. Everything the filters read is computed for every candidate;
  // everything only the response needs -- the posting_date label above all, which parses
  // and reformats a date per row -- is deferred to buildPostingDisplayFields and runs on
  // the returned page instead. Profiling the filtered branch at 650k rows attributed
  // ~1.3s to date-label construction alone, all of it on rows about to be discarded.
  const enrichRowForFiltering = (row, companyAtsByNormalizedName) => {
    const normalizedCompanyName = normalizeLikeText(row?.company_name);
    const companyAts = normalizedCompanyName ? companyAtsByNormalizedName.get(normalizedCompanyName) : "";
    const ats = normalizeAtsFilterValue(companyAts || inferAtsFromJobPostingUrl(row?.job_posting_url));
    // The stored column is preferred because it survives restarts. The in-memory map
    // stays ahead of it for rows the current sync has touched but not yet flushed, and
    // covers rows persisted before the column existed.
    const storedLocation = String(row?.location || "").trim() || null;
    const mappedLocation = String(postingLocationByJobUrl.get(row?.job_posting_url) || "").trim() || null;
    const inferredLocation = inferPostingLocationFromJobUrl(row?.job_posting_url);
    const location =
      storedLocation ||
      mappedLocation ||
      inferredLocation ||
      (ats === "ashby" ? inferAshbyLocationFromDescription(row?.job_description) : null);
    const payMinValue = Number(row?.pay_min);
    const payMaxValue = Number(row?.pay_max);

    return {
      ...row,
      compensation_type: normalizeCompensationType(row?.compensation_type, "unknown"),
      education_levels: parseEducationLevels(row?.education_levels),
      pay_min: Number.isFinite(payMinValue) ? payMinValue : null,
      pay_max: Number.isFinite(payMaxValue) ? payMaxValue : null,
      pay_period: normalizeCompensationPayPeriod(row?.pay_period),
      location,
      ats
    };
  };

  const buildPostingDisplayFields = (row) => {
    const ats = row?.ats;
    const rawPostingDate = String(row?.posting_date || "").trim();
    let postingDate = rawPostingDate;
    const isSapHrCloudPosting =
      ats === "saphrcloud" ||
      /\.jobs\.hr\.cloud\.sap\/(?:job|search)\//i.test(String(row?.job_posting_url || ""));
    if (isSapHrCloudPosting) {
      postingDate = buildSyncedAndSourceDateLabel(
        row?.first_seen_epoch,
        row?.last_seen_epoch,
        rawPostingDate,
        "Closing date"
      );
    }
    if (!postingDate && SYNC_DATE_FALLBACK_ATS.has(ats)) {
      postingDate = buildSyncedFallbackPostingDate(row?.first_seen_epoch, row?.last_seen_epoch);
    }
    // Safety net: never surface a blank date label when we have sync timestamps.
    if (!postingDate) {
      postingDate = buildSyncedFallbackPostingDate(row?.first_seen_epoch, row?.last_seen_epoch);
    }
    // undefined means the description was not selected (filtered path) and will be
    // hydrated for the returned page; null/"" means there genuinely isn't one.
    const normalizedJobDescription =
      row?.job_description === undefined ? undefined : normalizeJobDescription(row?.job_description, ats);
    const classification = classifyPosting({
      ...row,
      posting_date: rawPostingDate,
      job_description: normalizedJobDescription
    }, classificationOptions);
    const matchStatus = needsMatchJoin
      ? deriveMatchStatus({
          rowExists: Boolean(Number(row?.match_row_exists || 0)),
          matchPercent: row?.match_percent,
          descriptionAvailable: Boolean(Number(row?.description_available || 0))
        })
      : null;

    return {
      ...row,
      ...classification,
      posting_date: postingDate || null,
      job_description: normalizedJobDescription,
      status: String(row?.status || "unverified"),
      hidden: Boolean(Number(row?.hidden || 0)),
      // '' when visible; 'delisted' when the ATS stopped listing it; 'outside_date_window'
      // when it is still listed but older than the freshness window -- the latter is still
      // applyable, which is the whole reason the two are told apart.
      hidden_reason: String(row?.hidden_reason || ""),
      // True when the description restricts hiring to fewer places than the header lists,
      // so a candidate does not shortlist a city the employer will not hire into.
      location_conflict: Boolean(Number(row?.location_conflict || 0)),
      requires_account:
        row?.requires_account === null || row?.requires_account === undefined
          ? null
          : Boolean(Number(row?.requires_account)),
      pay_currency: normalizeCompensationCurrencyCode(row?.pay_currency),
      pay_raw: String(row?.pay_raw || "").trim() || null,
      // Only present when the query actually joined posting_match_scores (see
      // needsMatchJoin) -- undefined keys are dropped by JSON.stringify, so a caller that
      // never asked for match data sees no shape change at all. match_sort_key and the raw
      // *_json columns are internal to the seek predicate above and never shipped.
      ...(needsMatchJoin
        ? {
            // Which resume the flat match_* fields below were computed against -- lets a
            // caller with more than one resume uploaded tell them apart from the other
            // entries in match_scores without guessing from the percentage alone.
            match_resume: resumeKey,
            // match_status distinguishes "scored" from "no requirements to score" from
            // "not scored yet" from "no description at all" -- see deriveMatchStatus.
            // match_available stays a plain boolean (true only for "scored") for callers
            // that don't need the detail.
            match_status: matchStatus,
            match_available: matchStatus === "scored",
            match_percent:
              row?.match_percent === null || row?.match_percent === undefined
                ? null
                : Math.round(Number(row.match_percent) * 10) / 10,
            match_overlap_terms: parseJsonArraySafe(row?.match_overlap_terms_json),
            match_unmatched_requirements: parseJsonArraySafe(row?.match_unmatched_requirements_json)
          }
        : {}),
      match_sort_key: undefined,
      match_row_exists: undefined,
      match_overlap_terms_json: undefined,
      match_unmatched_requirements_json: undefined
    };
  };

  // hide_no_date is the one filter that needs a value derived from the posting date, so it
  // is the only reason to pay for that derivation before the page is cut.
  const withHasRealSourcePostingDate = (row) => ({
    ...row,
    _has_real_source_posting_date: hasRealSourcePostingDate(
      String(row?.posting_date || "").trim(),
      row?.ats,
      row?.first_seen_epoch,
      row?.last_seen_epoch
    )
  });

  const searchTerms = search.toLowerCase().split(/\s+/).filter(Boolean);
  const industryMatchersByKey = await buildIndustryMatchersByKey(industryKeys);

  const rowMatchesRequestedFilters = (row) => {
      const companyName = String(row?.company_name || "").toLowerCase();
      const positionName = String(row?.position_name || "").toLowerCase();
      const location = String(row?.location || "").toLowerCase();
      const ats = String(row?.ats || "").toLowerCase();

      const matchesSearch = searchTerms.every(
        (term) => companyName.includes(term) || positionName.includes(term) || location.includes(term)
      );
      if (!matchesSearch) return false;

      if (atsFilters.length > 0 && !atsFilters.includes(ats)) return false;

      const matchesIndustry = rowMatchesIndustryLikeParts(
        row?.position_name,
        industryKeys,
        industryMatchersByKey
      );
      if (!matchesIndustry) return false;

      const matchesCompensation = rowMatchesCompensationFilter(row?.compensation_type, compensationTypes);
      if (!matchesCompensation) return false;

      const matchesCompensationRange = rowMatchesCompensationRangeFilter(
        row?.pay_min,
        row?.pay_max,
        row?.pay_period,
        payMinFilter,
        payMaxFilter,
        payPeriods,
        includeUnknownPay
      );
      if (!matchesCompensationRange) return false;

      const matchesEducation = rowMatchesEducationFilter(row?.education_levels, educationLevels);
      if (!matchesEducation) return false;

      const matchesLocation = rowMatchesLocationFilters(
        row?.location,
        stateCodes,
        countyFilters,
        countryFilters,
        regionFilters
      );
      if (!matchesLocation) return false;

      // Cities match against parsed location entries rather than the raw text, and every
      // part of a filter has to hold on one entry -- so "Kent, WA" cannot be answered by a
      // posting listing Kent, England alongside somewhere in Washington. Rows written
      // before the parsed columns existed are parsed on the fly from the same text.
      if (cityFilters.length > 0) {
        const entries = row?.locations_json
          ? parseLocationsJson(row.locations_json)
          : parsePostingLocation(String(row?.location || "")).locations;
        if (!rowMatchesCityFilters(entries, cityFilters)) return false;
      }

      const matchesRemote = rowMatchesRemoteFilter(row?.location, remoteFilters);
      if (!matchesRemote) return false;

      if (hideNoDate && !Boolean(row?._has_real_source_posting_date)) return false;

      return true;
  };

  const prepareCandidateRows = async (candidateRows) => {
    throwIfAborted(signal);
    const companyAtsByNormalizedName = await loadCompanyAtsByNormalizedName(candidateRows);
    let enrichedRows = candidateRows.map((row) =>
      enrichRowForFiltering(row, companyAtsByNormalizedName)
    );
    if (reviewQueue === "new") {
      enrichedRows = enrichedRows.filter((row) => {
        const key = classifyPosting(row, classificationOptions).freshness.key;
        return key === "confirmed_recent" || key === "newly_discovered";
      });
    }
    if (hideNoDate) {
      enrichedRows = enrichedRows.map(withHasRealSourcePostingDate);
    }
    if (search || hasStructuredFilters || reviewQueue) {
      enrichedRows = enrichedRows.filter(rowMatchesRequestedFilters);
    }
    return enrichedRows;
  };

  let items;
  let scanBounded = false;
  if (candidateQuery) {
    // The old wide branch materialised every SQL candidate before applying the exact JS
    // predicates. On the production database that meant hundreds of MB per request and a
    // queue of already-timed-out scans. Walk the same stable ordering in bounded chunks and
    // stop once this page is full. Results and offset semantics stay the same; peak memory
    // is now proportional to the chunk rather than to the database. Chunks are resumed with
    // a seek predicate (see buildSeekPredicate), not OFFSET -- OFFSET re-walks from the start
    // of the index on every call, which made this loop quadratic whenever the JS-only filters
    // didn't converge in the first chunk or two.
    const targetMatchCount = offset + limit;
    const chunkSize = Math.max(250, Math.min(1000, limit * 4));
    const matchingRows = [];
    // Almost always one phase -- see candidateQuery above. sort_by=match_desc is the one
    // exception, with a second phase for postings that have not been scored yet; each
    // phase has its own stable ordering and therefore its own seek cursor, reset when the
    // walk moves on to the next one.
    let phaseIndex = 0;
    let cursor = null;
    let candidatesScanned = 0;

    while (matchingRows.length < targetMatchCount && phaseIndex < candidateQuery.phases.length) {
      if (candidatesScanned >= MAX_WIDE_SCAN_CANDIDATE_ROWS) {
        scanBounded = true;
        break;
      }
      throwIfAborted(signal);
      const phase = candidateQuery.phases[phaseIndex];
      const seek = buildSeekPredicate(phase.seekSortBy, cursor);
      const candidateRows = await db.all(
        `${phase.sql.replace("__SEEK_PREDICATE__", seek.sql)} LIMIT ?;`,
        [...phase.params, ...seek.params, chunkSize]
      );
      if (candidateRows.length === 0) {
        phaseIndex += 1;
        cursor = null;
        continue;
      }
      candidatesScanned += candidateRows.length;
      cursor = extractSeekCursor(phase.seekSortBy, candidateRows[candidateRows.length - 1]);

      const filteredRows = await prepareCandidateRows(candidateRows);
      const remaining = targetMatchCount - matchingRows.length;
      matchingRows.push(...filteredRows.slice(0, remaining));
      if (candidateRows.length < chunkSize) {
        phaseIndex += 1;
        cursor = null;
        continue;
      }

      // Let status and other lightweight requests run between chunks. SQLite work is
      // asynchronous, but the classification/filter loop above is CPU-bound JavaScript.
      await yieldToEventLoop();
    }
    items = matchingRows.slice(offset, targetMatchCount);
  } else {
    items = await prepareCandidateRows(rows);
  }

  // Only now, on the page that is actually being returned, is it worth building the
  // display-only fields.
  items = items.map(({ _has_real_source_posting_date, ...row }) => buildPostingDisplayFields(row));
  // Descriptions are the bulk of the payload -- on one instance 435MB of a 931MB database
  // lived in them -- and the listing has a toggle that hides them outright. When the client
  // says it is not rendering them, neither fetching nor shipping them is worth it. The
  // field is still present and null so consumers do not have to special-case its absence.
  items = includeDescriptions
    ? await hydrateJobDescriptions(db, items)
    : items.map((item) => ({ ...item, job_description: null }));
  throwIfAborted(signal);
  items = await enrichPostingsWithApplicationState(items);

  if (!includeApplied) {
    items = items.filter((item) => !item.applied);
  }
  if (!includeIgnored) {
    items = items.filter((item) => !item.ignored);
  }
  if (!includeDead) {
    items = items.filter((item) => String(item?.status || "unverified") !== "dead");
  }

  // Every uploaded resume's score, not just the one that drove sort_by/min_match_percent
  // above -- computed only for the page being returned (cheap: one query keyed by this
  // page's ids), not joined into the wide-scan SQL above, which stays scoped to a single
  // resume_key for its ordering/filtering.
  if (includeMatch && items.length > 0) {
    const resumeKeys = await listResumeDocumentKeys();
    const matchesByPosting = await getMatchesByPostingIdsForKeys(items.map((item) => item.id), resumeKeys);
    items = items.map((item) => {
      const perResume = matchesByPosting.get(item.id);
      const matchScores = {};
      // Every known resume key gets an entry, even one with no row yet -- omitting a key
      // entirely (the old behavior) is indistinguishable from "this resume doesn't exist"
      // and is exactly why a freshly-uploaded resume_secondary looked silently absent
      // instead of pending. See deriveMatchStatus for the same four-state logic used above.
      for (const key of resumeKeys) {
        const match = perResume ? perResume.get(key) : undefined;
        const matchPercent =
          match && match.match_percent !== null && match.match_percent !== undefined
            ? Math.round(Number(match.match_percent) * 10) / 10
            : null;
        const matchStatus = deriveMatchStatus({
          rowExists: Boolean(match),
          matchPercent,
          descriptionAvailable: Boolean(item.description_available)
        });
        matchScores[key] = {
          match_status: matchStatus,
          match_available: matchStatus === "scored",
          match_percent: matchPercent,
          match_overlap_terms: match ? match.overlap_terms : [],
          match_unmatched_requirements: match ? match.unmatched_requirements : []
        };
      }
      return { ...item, match_scores: matchScores };
    });
  }

  return {
    items,
    count: items.length,
    // How many returned items carry no pay figure -- the rows the pay range kept blindly.
    pay_unknown_count: items.filter(
      (item) => !(Number(item?.pay_min) > 0) && !(Number(item?.pay_max) > 0)
    ).length,
    // True only when the wide-scan walk (candidateQuery) hit MAX_WIDE_SCAN_CANDIDATE_ROWS
    // before filling this page -- the page may be short or empty not because there is
    // nothing more to find, but because the scan gave up. Absent (not false) for requests
    // that never needed the wide-scan walk at all, so existing callers see no shape change.
    ...(candidateQuery ? { scan_bounded: scanBounded } : {}),
    limit,
    offset,
    filters: {
      search,
      ats: atsFilters,
      sort_by: sortBy,
      resume: resumeKey,
      industries: industryKeys,
      compensation_types: compensationTypes,
      pay_periods: payPeriods,
      min_match_percent: minMatchPercentFilter,
      pay_min: payMinFilter,
      pay_max: payMaxFilter,
      include_unknown_pay: includeUnknownPay,
      include_stale_dated: includeStaleDated,
      review_queue: reviewQueue,
      education_levels: educationLevels,
      states: stateCodes,
      counties: countyFilters.map((filter) =>
        filter?.stateCode ? `${filter.stateCode}|${filter.countyLikePart}` : filter.countyLikePart
      ),
      countries: countryFilters.map((filter) => filter.value),
      regions: regionFilters,
      remote: remoteFilters,
      hide_no_date: hideNoDate,
      include_ignored: includeIgnored
    }
  };
  };

  // Bounded queries read a single page and are cheap, so they are not made to wait
  // behind a wide scan.
  if (!needsWideScan) return runPostingsQuery();
  return runExclusiveWideScan(runPostingsQuery, signal);
}

async function enrichPostingsWithApplicationState(items) {
  const db = getReadDb()
  const rows = Array.isArray(items) ? items : [];
  const urls = rows
    .map((row) => String(row?.job_posting_url || "").trim())
    .filter(Boolean);
  if (urls.length === 0) return rows;

  const uniqueUrls = Array.from(new Set(urls));
  const placeholders = uniqueUrls.map(() => "?").join(", ");
  const stateRows = await db.all(
    `
      SELECT *
      FROM posting_application_state
      WHERE job_posting_url IN (${placeholders});
    `,
    uniqueUrls
  );

  const byUrl = new Map();
  for (const row of stateRows) {
    byUrl.set(String(row?.job_posting_url || "").trim(), row);
  }

  return rows.map((item) => {
    const key = String(item?.job_posting_url || "").trim();
    const state = byUrl.get(key);
    const applied = Boolean(Number(state?.applied || 0));
    const ignored = Boolean(Number(state?.ignored || 0));
    const reviewState = ignored
      ? "ignored"
      : ["unseen", "viewed", "shortlisted", "ignored"].includes(String(state?.review_state || ""))
        ? String(state.review_state)
        : "unseen";
    const appliedByType = applied ? normalizeAppliedByType(state?.applied_by_type) : "";
    const classifiedItem = item?.freshness ? item : enrichPostingClassification(item);
    return {
      ...classifiedItem,
      applied,
      ignored,
      review_state: reviewState,
      review_state_changed_at_epoch: Number(state?.review_state_changed_at_epoch || 0),
      viewed_at_epoch: Number(state?.viewed_at_epoch || 0),
      shortlisted_at_epoch: Number(state?.shortlisted_at_epoch || 0),
      applied_by_type: appliedByType,
      applied_by_label: applied ? normalizeAppliedByLabel(state?.applied_by_label, appliedByType) : "",
      applied_at_epoch: Number(state?.applied_at_epoch || 0),
      last_application_id: Number(state?.last_application_id || 0),
      ignored_at_epoch: Number(state?.ignored_at_epoch || 0),
      ignored_by_label: ignored ? normalizeIgnoredByLabel(state?.ignored_by_label) : ""
    };
  });
}

// Full detail for a handful of named postings, so a caller holding URLs from a shortlist
// can screen them before applying. The listing query cannot answer this: it pages over
// filters and treats the description as a cost to avoid, while screening is exactly the
// moment the description is the point.
async function getPostingsByUrls(jobPostingUrls) {
  const db = getReadDb()
  const urls = Array.from(
    new Set(
      (Array.isArray(jobPostingUrls) ? jobPostingUrls : [])
        .map((url) => String(url || "").trim())
        .filter(Boolean)
    )
  );
  if (urls.length === 0) return [];

  const placeholders = urls.map(() => "?").join(", ");
  const rows = await db.all(
    `
      SELECT id, company_name, position_name, job_posting_url, posting_date, location,
             city, state_region, country, is_remote, locations_json,
             hiring_locations_json, location_conflict, status, dead_since_epoch,
             requires_account, description_fetched_at, hidden_reason,
             job_description, compensation_type, education_levels, pay_min, pay_max,
             pay_currency, pay_period, pay_raw, hidden, first_seen_epoch, last_seen_epoch
      FROM Postings
      WHERE job_posting_url IN (${placeholders});
    `,
    urls
  );

  const items = rows.map((row) => {
    const ats = inferAtsFromJobPostingUrl(row?.job_posting_url);
    let locations = [];
    let hiringLocations = [];
    try {
      locations = JSON.parse(row?.locations_json || "[]");
      hiringLocations = JSON.parse(row?.hiring_locations_json || "[]");
    } catch {}
    return enrichPostingClassification({
      ...row,
      ats,
      location: String(row?.location || "").trim() || inferPostingLocationFromJobUrl(row?.job_posting_url) || "",
      locations_json: undefined,
      hiring_locations_json: undefined,
      locations,
      // Non-empty when the description restricts hiring to fewer places than the
      // header lists; location_conflict is set when the two disagree.
      hiring_locations: hiringLocations,
      location_conflict: Boolean(Number(row?.location_conflict || 0)),
      is_remote: Boolean(Number(row?.is_remote || 0)),
      requires_account:
        row?.requires_account === null || row?.requires_account === undefined
          ? null
          : Boolean(Number(row?.requires_account)),
      status: String(row?.status || "unverified"),
      hidden_reason: String(row?.hidden_reason || ""),
      education_levels: parseEducationLevels(row?.education_levels),
      job_description: normalizeJobDescription(row?.job_description, ats),
      pay_currency: normalizeCompensationCurrencyCode(row?.pay_currency),
      pay_raw: String(row?.pay_raw || "").trim() || null
    });
  });

  return enrichPostingsWithApplicationState(items);
}


async function markPostingAppliedState(payload) {
  const db = getDb()
  const jobPostingUrl = String(payload?.job_posting_url || "").trim();
  if (!jobPostingUrl) return;

  const applied = normalizeBoolean(payload?.applied, true);
  const appliedByType = normalizeAppliedByType(payload?.applied_by_type);
  const appliedByLabel = normalizeAppliedByLabel(payload?.applied_by_label, appliedByType);
  const appliedAtEpoch = parseNonNegativeInteger(payload?.applied_at_epoch) || nowEpochSeconds();
  const lastApplicationId = parseNonNegativeInteger(payload?.last_application_id) || null;

  await db.run(
    `
      INSERT INTO posting_application_state (
        job_posting_url,
        applied,
        applied_by_type,
        applied_by_label,
        applied_at_epoch,
        last_application_id,
        ignored,
        ignored_at_epoch,
        ignored_by_label,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 0, NULL, '', datetime('now'))
      ON CONFLICT(job_posting_url) DO UPDATE SET
        applied = excluded.applied,
        applied_by_type = excluded.applied_by_type,
        applied_by_label = excluded.applied_by_label,
        applied_at_epoch = excluded.applied_at_epoch,
        last_application_id = excluded.last_application_id,
        ignored = 0,
        ignored_at_epoch = NULL,
        ignored_by_label = '',
        updated_at = datetime('now');
    `,
    [jobPostingUrl, applied ? 1 : 0, appliedByType, appliedByLabel, appliedAtEpoch, lastApplicationId]
  );

  // Application lifecycle remains independent, but saving an application is also an
  // intentional review action. Keep an existing shortlist; otherwise move unseen/ignored
  // rows to viewed while leaving `applied` as the durable submission indicator.
  try {
    await db.run(
      `UPDATE posting_application_state
       SET review_state = CASE WHEN review_state = 'shortlisted' THEN review_state ELSE 'viewed' END,
           review_state_changed_at_epoch = CASE WHEN review_state = 'shortlisted'
             THEN review_state_changed_at_epoch ELSE ? END,
           viewed_at_epoch = COALESCE(viewed_at_epoch, ?),
           ignored = 0, ignored_at_epoch = NULL, ignored_by_label = ''
       WHERE job_posting_url = ?;`,
      [appliedAtEpoch, appliedAtEpoch, jobPostingUrl]
    );
  } catch (error) {
    // Compatibility for focused service tests or a database opened before startup
    // migrations. The application write above remains valid on the legacy schema.
    if (!String(error?.message || error).includes("no such column")) throw error;
  }
}


async function setPostingIgnoredState(payload) {
  return setPostingIgnoredCompatibility({
    ...payload,
    ignored: normalizeBoolean(payload?.ignored, true)
  });
}


async function getCounts() {
  // Dedicated status reader connection: /sync/status is polled continuously and its COUNT(*)
  // over ~930k postings has no business queueing behind a sync write transaction, or behind
  // an unrelated slow /postings wide scan sharing the general reader connection.
  const db = getStatusReadDb()
  const companyRow = await db.get(`SELECT COUNT(*) AS count FROM companies;`);
  const postingRow = await db.get(
    `
      SELECT COUNT(*) AS count
      FROM Postings
      WHERE hidden = 0
        AND last_seen_epoch >= ?;
    `,
    [getPostingFreshnessCutoffEpoch()]
  );
  const byAtsRows = await db.all(`
    SELECT ATS_name, COUNT(*) AS count
    FROM companies
    GROUP BY ATS_name;
  `);

  const companyCountByAts = {};
  for (const row of byAtsRows) {
    const key = String(row?.ATS_name || "").trim() || "Unknown";
    companyCountByAts[key] = Number(row?.count || 0);
  }

  return {
    company_count: Number(companyRow?.count || 0),
    posting_count: Number(postingRow?.count || 0),
    company_count_by_ats: companyCountByAts
  };
}

module.exports = { listPostingsWithFilters, setPostingIgnoredState, getCounts, getPostingLocationGeoFilterOptions, markPostingAppliedState, getWideScanStats, buildCandidatePrefilter, getPostingsByUrls, enrichPostingsWithApplicationState }
