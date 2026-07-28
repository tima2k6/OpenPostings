// Parses a posting's free-text location into structured fields at ingest time.
//
// Filtering used to run LIKE '%city%' over the raw string, and the raw string is whatever
// the ATS happened to render: "Sittingbourne, Kent, Kent Science Park" matched a Kent WA
// filter, a Philadelphia hotel named "The Bellevue" matched Bellevue WA, and one posting
// carried ~900 South African place names in a single value. The structured columns written
// from here are what lets a city filter be qualified by state and country instead of being
// a substring gamble.
//
// The matching primitives are shared with the app's own location filters
// (description-filters.js) rather than reimplemented, so "Perth, WA, Australia",
// "Washington, PA" and "US-WA-Redmond" all read the same way in both places.
const {
  hasStateLikeMatch,
  splitLocationIntoGroups,
  classifyLocationWorkMode,
  inferLocationGeo,
  STATE_CODE_TO_NAME,
  STATE_NAME_TO_CODE,
  COUNTRY_ALIAS_TO_CODE,
  normalizeCountryLikePart
} = require("./description-filters.js");
const { normalizeGeoText } = require("./normalize-strings.js");

// Pathological values exist in real data (the record is 91k characters). Nothing useful
// lives past the first few thousand characters, and the parser is quadratic-ish in group
// count, so both the text and the group list are capped hard.
const MAX_PARSE_CHARS = 4000;
const MAX_LOCATION_GROUPS = 40;

const NON_CITY_TERMS = new Set([
  "remote",
  "hybrid",
  "onsite",
  "on site",
  "work from home",
  "wfh",
  "flexible",
  "anywhere",
  "worldwide",
  "global",
  "international",
  "united states",
  "usa",
  "us",
  "amer",
  "americas",
  "north america",
  "south america",
  "latin america",
  "latam",
  "emea",
  "europe",
  "middle east",
  "africa",
  "apac",
  "asia",
  "asia pacific",
  "oceania",
  "various",
  "multiple locations",
  "other",
  "not specified",
  "tbd",
  "n a",
  "undefined",
  "null"
]);

function stripZip(segment) {
  return String(segment || "")
    .replace(/\s+\d{5}(-\d{4})?$/, "")
    .replace(/\s+[A-Z]\d[A-Z]\s?\d[A-Z]\d$/i, "")
    .trim();
}

// One location group ("Seattle, WA") into its comma/dash segments. Slugs like
// "US-WA-Redmond" arrive as a single segment because there is no whitespace after the
// dashes; they are handled separately in pickCity/pickStateCode.
function splitGroupSegments(group) {
  return String(group || "")
    .split(/,+|\s*-\s+/)
    .map((segment) => stripZip(segment))
    .filter(Boolean);
}

// Candidate state codes actually written in the group: bare two-letter tokens plus any
// segment that spells a state name. Each candidate is validated by hasStateLikeMatch,
// which carries the Kent/Washington-DC/foreign-subdivision guards, so a candidate here
// only has to be cheap to collect, not correct.
function pickStateCode(group, segments) {
  const candidates = [];
  const seen = new Set();
  const push = (code) => {
    const upper = String(code || "").trim().toUpperCase();
    if (!upper || seen.has(upper) || !STATE_CODE_TO_NAME[upper]) return;
    seen.add(upper);
    candidates.push(upper);
  };

  for (const match of String(group || "").matchAll(/\b[A-Za-z]{2}\b/g)) push(match[0]);
  for (const segment of segments) {
    const byName = STATE_NAME_TO_CODE.get(normalizeGeoText(segment));
    if (byName) push(byName);
  }

  for (const code of candidates) {
    if (hasStateLikeMatch(group, code)) return code;
  }
  return "";
}

function isPlausibleCity(segment, stateCode, countryCode) {
  const normalized = normalizeGeoText(segment);
  if (!normalized || normalized.length < 2 || normalized.length > 60) return false;
  if (normalized.split(" ").length > 5) return false;
  if (NON_CITY_TERMS.has(normalized)) return false;
  if (/\d/.test(normalized)) return false;
  if (!/[a-z]/.test(normalized)) return false;
  // The matched state, spelled either way, is not the city.
  if (stateCode) {
    if (normalized === normalizeGeoText(STATE_CODE_TO_NAME[stateCode])) return false;
    if (normalized === stateCode.toLowerCase()) return false;
  }
  // Nor is the country.
  const asCountry = COUNTRY_ALIAS_TO_CODE.get(normalizeCountryLikePart(segment));
  if (asCountry && (!countryCode || asCountry === countryCode)) return false;
  // A bare two-letter token is a code of some kind, never a city name.
  if (/^[a-z] ?[a-z]$/.test(normalized)) return false;
  return true;
}

function pickCity(segments, stateCode, countryCode) {
  for (const segment of segments) {
    // Dash-delimited slugs ("US-WA-Redmond", "TX-Katy") keep the city in the last
    // hyphen part; hyphenated real city names ("Winston-Salem") have no code prefix
    // and fall through to the whole-segment check below.
    if (!/\s/.test(segment) && segment.includes("-")) {
      const parts = segment.split("-").map((part) => part.trim()).filter(Boolean);
      const codeLike = (part) =>
        /^[A-Za-z]{2}$/.test(part) &&
        (STATE_CODE_TO_NAME[part.toUpperCase()] || part.toUpperCase() === "US" || COUNTRY_ALIAS_TO_CODE.has(normalizeCountryLikePart(part)));
      if (parts.length >= 2 && codeLike(parts[0])) {
        for (const part of parts) {
          if (!codeLike(part) && isPlausibleCity(part, stateCode, countryCode)) return part;
        }
        continue;
      }
    }
    if (isPlausibleCity(segment, stateCode, countryCode)) return segment;
  }
  return "";
}

// Remote-ness is a property of the whole entry, not a city name: "Mumbai Remote" is
// Mumbai, remotely. Strip the mode words before a segment is considered as a city.
function cleanCitySegment(segment) {
  return String(segment || "")
    .replace(/\b(remote|hybrid|on[- ]?site|work from home|wfh|based|only)\b/gi, " ")
    .replace(/[()\[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// A segment that *is* a state, written either way ("WA", "Washington").
function segmentAsStateCode(segment) {
  const upper = String(segment || "").trim().toUpperCase();
  if (STATE_CODE_TO_NAME[upper]) return upper;
  return STATE_NAME_TO_CODE.get(normalizeGeoText(segment)) || "";
}

// Comma-run multi-location strings -- "Denver, CO, Seattle, WA" -- flatten several places
// into one group. Walking city/state pairs recovers each of them; losing the later pairs
// is how a Seattle filter missed postings that plainly listed Seattle.
function extractCityStatePairs(group, segments, isRemote) {
  const entries = [];
  for (let index = 0; index < segments.length - 1; index += 1) {
    const stateCode = segmentAsStateCode(segments[index + 1]);
    if (!stateCode) continue;
    // Group-level guards still apply: "Perth, WA, Australia" must not yield a WA pair.
    if (!hasStateLikeMatch(group, stateCode)) continue;
    const city = cleanCitySegment(segments[index]);
    if (!isPlausibleCity(city, stateCode, "US")) continue;
    entries.push({ city, state_region: stateCode, country: "US", is_remote: isRemote });
    index += 1;
  }
  return entries;
}

// "Florence Kentucky" -- no comma, state name fused onto the city. Only read this way when
// the group names no other country.
function splitFusedCityState(segment, group) {
  const words = String(segment || "").trim().split(/\s+/);
  if (words.length < 2) return null;
  for (const nameLength of [2, 1]) {
    if (words.length <= nameLength) continue;
    const stateCode = segmentAsStateCode(words.slice(-nameLength).join(" "));
    if (!stateCode) continue;
    const geo = inferLocationGeo(group);
    if (geo.countryCode && geo.countryCode !== "US") return null;
    const city = words.slice(0, words.length - nameLength).join(" ");
    return { city, stateCode };
  }
  return null;
}

function parseLocationGroup(group) {
  const segments = splitGroupSegments(group);
  const workMode = classifyLocationWorkMode(group);
  const isRemote = workMode === "remote";

  const pairs = extractCityStatePairs(group, segments, isRemote);
  if (pairs.length > 0) return pairs;

  const stateCode = pickStateCode(group, segments);
  const geo = inferLocationGeo(group);
  // A recognised US state settles the country; inferLocationGeo only reports countries
  // that are explicitly written.
  let country = geo.countryCode || (stateCode ? "US" : "");
  let city = pickCity(segments.map(cleanCitySegment).filter(Boolean), stateCode, country || geo.countryCode);
  let resolvedState = stateCode;

  if (city && !resolvedState) {
    const fused = splitFusedCityState(city, group);
    if (fused && isPlausibleCity(fused.city, fused.stateCode, "US")) {
      city = fused.city;
      resolvedState = fused.stateCode;
      country = country || "US";
    }
  }

  return [
    {
      city: city || null,
      state_region: resolvedState || null,
      country: country || null,
      is_remote: isRemote
    }
  ];
}

// The full parse: every location group in the string, deduplicated and capped, plus the
// primary fields the flat columns store. Returns nulls rather than empty strings so the
// columns read as "unknown", matching how pay handles missing data.
function parsePostingLocation(rawLocation) {
  const raw = String(rawLocation || "").trim().slice(0, MAX_PARSE_CHARS);
  if (!raw) {
    return { city: null, state_region: null, country: null, is_remote: 0, locations: [] };
  }

  const groups = splitLocationIntoGroups(raw).slice(0, MAX_LOCATION_GROUPS);
  const locations = [];
  const seen = new Set();
  let anyRemote = false;

  for (const group of groups) {
    for (const parsed of parseLocationGroup(group)) {
      if (parsed.is_remote) anyRemote = true;
      if (!parsed.city && !parsed.state_region && !parsed.country && !parsed.is_remote) continue;
      const key = `${normalizeGeoText(parsed.city || "")}|${parsed.state_region || ""}|${parsed.country || ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      locations.push(parsed);
    }
    if (locations.length >= MAX_LOCATION_GROUPS) break;
  }

  // "Remote" with no place name still deserves a row entry, so remote_only filters and
  // the JSON view agree.
  if (locations.length === 0 && anyRemote) {
    locations.push({ city: null, state_region: null, country: null, is_remote: true });
  }

  const primary = locations.find((entry) => entry.city) || locations[0] || null;
  return {
    city: primary?.city || null,
    state_region: primary?.state_region || null,
    country: primary?.country || null,
    is_remote: anyRemote ? 1 : 0,
    locations
  };
}

function serializeLocationsJson(locations) {
  if (!Array.isArray(locations) || locations.length === 0) return null;
  return JSON.stringify(locations);
}

function parseLocationsJson(text) {
  const raw = String(text || "").trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry) => ({
        city: String(entry?.city || "").trim() || null,
        state_region: String(entry?.state_region || "").trim() || null,
        country: String(entry?.country || "").trim() || null,
        is_remote: Boolean(entry?.is_remote)
      }))
      .filter((entry) => entry.city || entry.state_region || entry.country || entry.is_remote);
  } catch {
    return [];
  }
}

// A location_any term names a city, optionally qualified: "Kent", "Kent, WA",
// "Kent, WA, US". The qualifiers restrict which parsed entries the city may match, which
// is what keeps Kent WA from answering for Kent, England.
function parseLocationAnyTerm(term) {
  const parts = String(term || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;

  const city = normalizeGeoText(parts[0]);
  if (!city) return null;

  let stateCode = "";
  let countryCode = "";
  for (const part of parts.slice(1)) {
    const upper = part.toUpperCase();
    if (!stateCode && (STATE_CODE_TO_NAME[upper] || STATE_NAME_TO_CODE.get(normalizeGeoText(part)))) {
      stateCode = STATE_CODE_TO_NAME[upper] ? upper : STATE_NAME_TO_CODE.get(normalizeGeoText(part));
      continue;
    }
    const asCountry = COUNTRY_ALIAS_TO_CODE.get(normalizeCountryLikePart(part));
    if (!countryCode && asCountry) countryCode = asCountry;
  }
  return { city, stateCode, countryCode };
}

// One parsed location entry against every active constraint at once. Constraints must all
// hold on the *same* entry: a posting listing "Kent, England / Nashville, TN" must not
// satisfy city=Kent + state=WA by mixing entries.
function locationEntryMatches(entry, terms, stateCodes, countryCodes) {
  if (Array.isArray(terms) && terms.length > 0) {
    const cityMatches = terms.some((term) => {
      if (!term) return false;
      if (normalizeGeoText(entry.city || "") !== term.city) return false;
      if (term.stateCode && entry.state_region !== term.stateCode) return false;
      if (term.countryCode && entry.country && entry.country !== term.countryCode) return false;
      return true;
    });
    if (!cityMatches) return false;
  }

  if (Array.isArray(stateCodes) && stateCodes.length > 0) {
    if (!entry.state_region || !stateCodes.includes(entry.state_region)) return false;
    // A US state code only counts when the entry is not explicitly somewhere else.
    if (entry.country && entry.country !== "US") return false;
  }

  if (Array.isArray(countryCodes) && countryCodes.length > 0) {
    if (!entry.country || !countryCodes.includes(entry.country)) return false;
  }

  return true;
}


// City filters, as the app, the /db page and the MCP tools all express them. The wire form
// is "City|ST" -- the same shape counties already use -- because a bare city name is not a
// filter anyone can trust: Kent is in Washington, England and (as Kentucky) a state name,
// and Bellevue is in Washington, Nebraska, Ohio and South Africa. A city with no state is
// still accepted, since a user typing one into a free-text box means the obvious thing,
// but it matches every city of that name.
function parseCityFilters(values) {
  const list = Array.isArray(values) ? values : String(values || "").split(",");
  const terms = [];
  const seen = new Set();
  for (const raw of list) {
    const text = String(raw || "").trim();
    if (!text) continue;
    // "Seattle|WA" from a dropdown, "Seattle, WA" from a text box.
    const term = parseLocationAnyTerm(text.replace(/\|/g, ", "));
    if (!term || !term.city) continue;
    // parseLocationAnyTerm returns stateCode/countryCode, not the row-shaped field names.
    // Getting this wrong collapsed Kent|WA and Kent|OH onto the same key and silently
    // dropped the second filter.
    const key = `${term.city}|${term.stateCode || ""}|${term.countryCode || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    terms.push(term);
  }
  return terms;
}

// True when any one parsed location entry satisfies any one city filter. Same-entry, for
// the reason the rest of this file exists: a posting listing "Kent, England / Seattle, WA"
// must not answer a search for Kent, WA just because both halves appear somewhere in it.
function rowMatchesCityFilters(entries, cityTerms) {
  if (!Array.isArray(cityTerms) || cityTerms.length === 0) return true;
  if (!Array.isArray(entries) || entries.length === 0) return false;
  return entries.some((entry) => locationEntryMatches(entry, cityTerms, [], []));
}

module.exports = {
  parseCityFilters,
  rowMatchesCityFilters,
  parsePostingLocation,
  parseLocationGroup,
  serializeLocationsJson,
  parseLocationsJson,
  parseLocationAnyTerm,
  locationEntryMatches,
  MAX_PARSE_CHARS,
  MAX_LOCATION_GROUPS
};
