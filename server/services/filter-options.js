// Enumerates every value the posting filters accept.
//
// This used to live inline in the /postings/filter-options route, where only the app could
// reach it. It is a service now because the MCP apply agent needs the same list: an agent
// that cannot see the valid industry keys, county values or country codes has to guess
// them, and a guessed key does not fail loudly -- it silently matches nothing, which reads
// as "no jobs match your preferences".
const CITY_OPTIONS_PER_STATE = 60;

const { getDb } = require("./runtime-context.js");
const { normalizeSyncEnabledAts, ATS_FILTER_OPTION_ITEMS } = require("../helpers/normalize-ats.js");
const {
  COMPENSATION_TYPE_OPTION_ITEMS,
  COMPENSATION_PAY_PERIOD_OPTION_ITEMS,
  EDUCATION_LEVEL_OPTION_ITEMS,
  STATE_CODE_TO_NAME
} = require("../helpers/description-filters.js");
const { getSyncServiceSettings } = require("./sync-settings.js");
const { getPostingLocationGeoFilterOptions } = require("./postings.js");

const POSTING_SORT_OPTION_ITEMS = Object.freeze([
  { value: "recent", label: "Most Recently Seen" },
  { value: "company_asc", label: "Company (A-Z)" }
]);

async function getIndustryOptions(db) {
  try {
    return await db.all(
      `
        SELECT industry_key AS value, industry_label AS label
        FROM job_industry_categories
        ORDER BY industry_label ASC;
      `
    );
  } catch {
    return db.all(
      `
        SELECT industry_key AS value, industry_label AS label
        FROM job_position_industry
        GROUP BY industry_key, industry_label
        ORDER BY industry_label ASC;
      `
    );
  }
}

async function getStateOptions(db) {
  try {
    const stateRows = await db.all(
      `
        SELECT DISTINCT state_usps
        FROM state_location_index
        WHERE state_usps IS NOT NULL AND TRIM(state_usps) <> ''
        ORDER BY state_usps ASC;
      `
    );
    return stateRows.map((row) => {
      const code = String(row?.state_usps || "").trim().toUpperCase();
      const readableName = STATE_CODE_TO_NAME[code];
      return {
        value: code,
        label: readableName ? `${code} - ${readableName.replace(/\b\w/g, (c) => c.toUpperCase())}` : code
      };
    });
  } catch {
    return [];
  }
}

// County values are the "ST|Name" pairs the filters parse, not bare names: an unqualified
// "Washington" county exists in more than thirty states.
async function getCountyOptions(db, selectedStates) {
  try {
    let countyRows = [];
    if (selectedStates.length === 0) {
      countyRows = await db.all(
        `
          SELECT DISTINCT state_usps, search_location_name
          FROM state_location_index
          WHERE location_type = 'county'
            AND search_location_name IS NOT NULL
            AND TRIM(search_location_name) <> ''
          ORDER BY state_usps ASC, search_location_name ASC;
        `
      );
    } else {
      const placeholders = selectedStates.map(() => "?").join(", ");
      countyRows = await db.all(
        `
          SELECT DISTINCT state_usps, search_location_name
          FROM state_location_index
          WHERE location_type = 'county'
            AND search_location_name IS NOT NULL
            AND TRIM(search_location_name) <> ''
            AND state_usps IN (${placeholders})
          ORDER BY state_usps ASC, search_location_name ASC;
        `,
        selectedStates
      );
    }

    return countyRows.map((row) => {
      const stateCode = String(row?.state_usps || "").trim().toUpperCase();
      const countyName = String(row?.search_location_name || "").trim();
      return {
        value: `${stateCode}|${countyName}`,
        label: `${countyName} (${stateCode})`,
        state: stateCode,
        county: countyName
      };
    });
  } catch {
    return [];
  }
}

async function getPostingFilterOptions(options = {}) {
  const db = getDb();
  const selectedStates = (Array.isArray(options?.states) ? options.states : [])
    .map((state) => String(state || "").trim().toUpperCase())
    .filter(Boolean);

  const syncSettings = await getSyncServiceSettings();
  const enabledAts = new Set(normalizeSyncEnabledAts(syncSettings?.sync_enabled_ats));
  const ats = ATS_FILTER_OPTION_ITEMS.map((item) => ({
    value: item.value,
    label: item.label,
    enabled: enabledAts.has(item.value)
  }));

  const [industries, states, counties, locationGeoOptions] = await Promise.all([
    getIndustryOptions(db),
    getStateOptions(db),
    getCountyOptions(db, selectedStates),
    getPostingLocationGeoFilterOptions()
  ]);

  let countries = Array.isArray(locationGeoOptions?.countries) ? locationGeoOptions.countries : [];
  if (countries.length === 0 && states.length > 0) {
    countries = [
      {
        value: "US",
        label: "United States",
        region: "AMER"
      }
    ];
  }

  // Cities come from the parsed city/state_region columns rather than from location text,
  // so the values offered are the ones the filters can actually match. Scoped per state and
  // capped: there are ~38,000 distinct city/state pairs, which is not a dropdown, but the
  // busiest few dozen in each state cover real job markets. Anything outside that is still
  // reachable through the free-text city box, which takes "City, ST" directly.
  let cities = [];
  try {
    const cityRows = await db.all(
      `SELECT city, state_region, n FROM (
         SELECT city,
                state_region,
                COUNT(*) AS n,
                ROW_NUMBER() OVER (PARTITION BY state_region ORDER BY COUNT(*) DESC) AS rank
         FROM Postings
         WHERE hidden = 0
           AND city IS NOT NULL AND TRIM(city) <> ''
           AND state_region IS NOT NULL AND TRIM(state_region) <> ''
         GROUP BY city, state_region
       )
       WHERE rank <= ?
       ORDER BY state_region, n DESC;`,
      [CITY_OPTIONS_PER_STATE]
    );
    cities = cityRows.map((row) => ({
      // Same "Value|ST" shape counties use, because a bare city name is ambiguous.
      value: `${row.city}|${row.state_region}`,
      label: `${row.city}, ${row.state_region}`,
      city: row.city,
      state: row.state_region,
      count: Number(row.n || 0)
    }));
  } catch {
    // A database without the parsed columns yet simply offers no cities.
    cities = [];
  }

  return {
    ats,
    cities,
    sort_options: POSTING_SORT_OPTION_ITEMS.map((item) => ({ ...item })),
    industries,
    compensation_types: COMPENSATION_TYPE_OPTION_ITEMS,
    pay_periods: COMPENSATION_PAY_PERIOD_OPTION_ITEMS,
    education_levels: EDUCATION_LEVEL_OPTION_ITEMS,
    regions: Array.isArray(locationGeoOptions?.regions) ? locationGeoOptions.regions : [],
    countries,
    states,
    counties
  };
}

module.exports = { getPostingFilterOptions, POSTING_SORT_OPTION_ITEMS };
