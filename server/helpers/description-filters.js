const { normalizeStringArray, normalizeLikeText, normalizeGeoText } = require("../helpers/normalize-strings")
const { getDb, setDb } = require("../services/runtime-context")
const COMPENSATION_TYPES = Object.freeze(["hourly", "salary", "both", "unknown"]);
const COMPENSATION_TYPE_LABEL_BY_VALUE = Object.freeze({
  hourly: "Hourly",
  salary: "Salary",
  both: "Hourly + Salary",
  unknown: "Unknown"
});
const IT_SOFTWARE_INDUSTRY_KEY = "information_technology_software";
const SALES_BUSINESS_INDUSTRY_KEY = "sales_business_development";
const IT_TECH_ANCHOR_PARTS = new Set([
  "software",
  "developer",
  "development",
  "engineer",
  "engineering",
  "devops",
  "platform",
  "cloud",
  "security",
  "cybersecurity",
  "cyber",
  "infrastructure",
  "network",
  "systems",
  "system",
  "administrator",
  "database",
  "sql",
  "data",
  "analytics",
  "architect",
  "automation",
  "backend",
  "frontend",
  "fullstack",
  "application",
  "applications",
  "qa",
  "test",
  "testing",
  "machine",
  "learning",
  "mlops",
  "ai"
]);
const IT_HIGH_SIGNAL_ANCHOR_PARTS = new Set([
  "software",
  "developer",
  "development",
  "engineer",
  "engineering",
  "devops",
  "platform",
  "cloud",
  "security",
  "cybersecurity",
  "cyber",
  "infrastructure",
  "network",
  "systems",
  "system",
  "administrator",
  "database",
  "sql",
  "architect",
  "automation",
  "backend",
  "frontend",
  "fullstack",
  "mlops",
  "machine",
  "learning",
  "ai"
]);
const IT_SALES_GTM_ROLE_REGEX =
  /\b(account executive|account manager|business development|brand ambassador|go[\s-]?to[\s-]?market|gtm|inside sales|outside sales|sales representative|territory manager|partnerships?|sales(?!force\b))\b/i;
const SALES_EXCLUSIVE_ROLE_REGEX =
  /\b(account executive|account manager|business development|brand ambassador|inside sales|outside sales|sales representative|sales manager|sales director|sales consultant|sales specialist|sales associate|sales advisor|presales?|telesales|territory manager|channel sales|partner sales|salesperson|salesman|salesworker|sales(?!force\b))\b/i;

const EDUCATION_LEVELS = Object.freeze([
  "high_school",
  "associate",
  "bachelor",
  "master",
  "doctorate",
  "certificate"
]);
const EDUCATION_LEVEL_LABEL_BY_VALUE = Object.freeze({
  high_school: "High School / GED",
  associate: "Associate",
  bachelor: "Bachelor",
  master: "Master",
  doctorate: "Doctorate / PhD",
  certificate: "Certificate"
});
const COMPENSATION_PAY_PERIODS = Object.freeze(["hour", "week", "month", "year"]);
const COMPENSATION_PAY_PERIOD_LABEL_BY_VALUE = Object.freeze({
  hour: "Per Hour",
  week: "Per Week",
  month: "Per Month",
  year: "Per Year"
});
const LOCATION_REGION_OPTIONS = Object.freeze([
  { value: "AMER", label: "AMER (Americas)" },
  { value: "EMEA", label: "EMEA (Europe, Middle East, Africa)" },
  { value: "APAC", label: "APAC (Asia-Pacific)" }
]);
const STATE_CODE_TO_NAME = {
  AL: "alabama",
  AK: "alaska",
  AZ: "arizona",
  AR: "arkansas",
  CA: "california",
  CO: "colorado",
  CT: "connecticut",
  DE: "delaware",
  FL: "florida",
  GA: "georgia",
  HI: "hawaii",
  ID: "idaho",
  IL: "illinois",
  IN: "indiana",
  IA: "iowa",
  KS: "kansas",
  KY: "kentucky",
  LA: "louisiana",
  ME: "maine",
  MD: "maryland",
  MA: "massachusetts",
  MI: "michigan",
  MN: "minnesota",
  MS: "mississippi",
  MO: "missouri",
  MT: "montana",
  NE: "nebraska",
  NV: "nevada",
  NH: "new hampshire",
  NJ: "new jersey",
  NM: "new mexico",
  NY: "new york",
  NC: "north carolina",
  ND: "north dakota",
  OH: "ohio",
  OK: "oklahoma",
  OR: "oregon",
  PA: "pennsylvania",
  RI: "rhode island",
  SC: "south carolina",
  SD: "south dakota",
  TN: "tennessee",
  TX: "texas",
  UT: "utah",
  VT: "vermont",
  VA: "virginia",
  WA: "washington",
  WV: "west virginia",
  WI: "wisconsin",
  WY: "wyoming",
  DC: "district of columbia"
};
const US_STATE_NAMES = new Set(Object.values(STATE_CODE_TO_NAME).map((name) => normalizeGeoText(name)));
const LOCATION_REGION_VALUES = new Set(LOCATION_REGION_OPTIONS.map((option) => option.value));
const LOCATION_NON_COUNTRY_TERMS = new Set([
  "remote",
  "hybrid",
  "onsite",
  "on site",
  "worldwide",
  "global",
  "international",
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
  "asia pacific"
]);
const DEFAULT_COUNTRY_FILTER_LABELS = Object.freeze([
  "Alberta",
  "Argentina",
  "Armenia",
  "Austria",
  "Azerbaijan",
  "Belgium",
  "Brazil",
  "Canada",
  "Chile",
  "Colombia",
  "Croatia",
  "Croydon",
  "Denmark",
  "France",
  "Germany",
  "Hillview",
  "India",
  "Ireland",
  "Jalisco",
  "Jordan",
  "K Vlinge",
  "Kazakhstan",
  "Kenya",
  "Lund",
  "Mexico",
  "Moldova",
  "Nederland",
  "Netherlands",
  "North Macedonia",
  "Nsw",
  "Ontario",
  "Philippines",
  "Poland",
  "Portugal",
  "Queensland",
  "Romania",
  "Serbia",
  "South Africa",
  "Tomelilla",
  "Turkey",
  "Undefined",
  "United Kingdom",
  "United States",
  "Venezuela"
]);

const COUNTRY_DEFINITIONS = Object.freeze([
  {
    code: "US",
    label: "United States",
    region: "AMER",
    aliases: ["us", "usa", "u.s.", "u.s.a.", "united states of america"]
  },
  { code: "CA", label: "Canada", region: "AMER", aliases: ["can"] },
  { code: "MX", label: "Mexico", region: "AMER", aliases: ["mex"] },
  { code: "BR", label: "Brazil", region: "AMER", aliases: ["brasil"] },
  { code: "AR", label: "Argentina", region: "AMER", aliases: [] },
  { code: "CL", label: "Chile", region: "AMER", aliases: [] },
  { code: "CO", label: "Colombia", region: "AMER", aliases: [] },
  { code: "PE", label: "Peru", region: "AMER", aliases: [] },
  { code: "UY", label: "Uruguay", region: "AMER", aliases: [] },
  { code: "PY", label: "Paraguay", region: "AMER", aliases: [] },
  { code: "BO", label: "Bolivia", region: "AMER", aliases: [] },
  { code: "EC", label: "Ecuador", region: "AMER", aliases: [] },
  { code: "VE", label: "Venezuela", region: "AMER", aliases: [] },
  { code: "CR", label: "Costa Rica", region: "AMER", aliases: [] },
  { code: "PA", label: "Panama", region: "AMER", aliases: [] },
  { code: "GT", label: "Guatemala", region: "AMER", aliases: [] },
  { code: "SV", label: "El Salvador", region: "AMER", aliases: [] },
  { code: "HN", label: "Honduras", region: "AMER", aliases: [] },
  { code: "NI", label: "Nicaragua", region: "AMER", aliases: [] },
  { code: "DO", label: "Dominican Republic", region: "AMER", aliases: [] },
  { code: "PR", label: "Puerto Rico", region: "AMER", aliases: [] },
  { code: "JM", label: "Jamaica", region: "AMER", aliases: [] },
  { code: "TT", label: "Trinidad and Tobago", region: "AMER", aliases: ["trinidad"] },
  { code: "BS", label: "Bahamas", region: "AMER", aliases: [] },
  { code: "BB", label: "Barbados", region: "AMER", aliases: [] },
  { code: "GB", label: "United Kingdom", region: "EMEA", aliases: ["uk", "u.k.", "great britain", "britain", "england", "scotland", "wales", "northern ireland"] },
  { code: "IE", label: "Ireland", region: "EMEA", aliases: ["republic of ireland"] },
  { code: "FR", label: "France", region: "EMEA", aliases: [] },
  { code: "DE", label: "Germany", region: "EMEA", aliases: ["deutschland"] },
  { code: "ES", label: "Spain", region: "EMEA", aliases: [] },
  { code: "PT", label: "Portugal", region: "EMEA", aliases: [] },
  { code: "IT", label: "Italy", region: "EMEA", aliases: [] },
  { code: "NL", label: "Netherlands", region: "EMEA", aliases: ["holland"] },
  { code: "BE", label: "Belgium", region: "EMEA", aliases: [] },
  { code: "LU", label: "Luxembourg", region: "EMEA", aliases: [] },
  { code: "CH", label: "Switzerland", region: "EMEA", aliases: [] },
  { code: "AT", label: "Austria", region: "EMEA", aliases: [] },
  { code: "SE", label: "Sweden", region: "EMEA", aliases: [] },
  { code: "NO", label: "Norway", region: "EMEA", aliases: [] },
  { code: "DK", label: "Denmark", region: "EMEA", aliases: [] },
  { code: "FI", label: "Finland", region: "EMEA", aliases: [] },
  { code: "IS", label: "Iceland", region: "EMEA", aliases: [] },
  { code: "PL", label: "Poland", region: "EMEA", aliases: [] },
  { code: "CZ", label: "Czechia", region: "EMEA", aliases: ["czech republic"] },
  { code: "SK", label: "Slovakia", region: "EMEA", aliases: [] },
  { code: "HU", label: "Hungary", region: "EMEA", aliases: [] },
  { code: "RO", label: "Romania", region: "EMEA", aliases: [] },
  { code: "BG", label: "Bulgaria", region: "EMEA", aliases: [] },
  { code: "HR", label: "Croatia", region: "EMEA", aliases: [] },
  { code: "SI", label: "Slovenia", region: "EMEA", aliases: [] },
  { code: "RS", label: "Serbia", region: "EMEA", aliases: [] },
  { code: "BA", label: "Bosnia and Herzegovina", region: "EMEA", aliases: ["bosnia"] },
  { code: "ME", label: "Montenegro", region: "EMEA", aliases: [] },
  { code: "AL", label: "Albania", region: "EMEA", aliases: [] },
  { code: "MK", label: "North Macedonia", region: "EMEA", aliases: ["macedonia"] },
  { code: "GR", label: "Greece", region: "EMEA", aliases: [] },
  { code: "CY", label: "Cyprus", region: "EMEA", aliases: [] },
  { code: "MT", label: "Malta", region: "EMEA", aliases: [] },
  { code: "EE", label: "Estonia", region: "EMEA", aliases: [] },
  { code: "LV", label: "Latvia", region: "EMEA", aliases: [] },
  { code: "LT", label: "Lithuania", region: "EMEA", aliases: [] },
  { code: "UA", label: "Ukraine", region: "EMEA", aliases: [] },
  { code: "BY", label: "Belarus", region: "EMEA", aliases: [] },
  { code: "MD", label: "Moldova", region: "EMEA", aliases: [] },
  { code: "RU", label: "Russia", region: "EMEA", aliases: ["russian federation"] },
  { code: "TR", label: "Turkey", region: "EMEA", aliases: ["turkiye"] },
  { code: "AE", label: "United Arab Emirates", region: "EMEA", aliases: ["uae", "u.a.e."] },
  { code: "SA", label: "Saudi Arabia", region: "EMEA", aliases: ["ksa"] },
  { code: "QA", label: "Qatar", region: "EMEA", aliases: [] },
  { code: "KW", label: "Kuwait", region: "EMEA", aliases: [] },
  { code: "BH", label: "Bahrain", region: "EMEA", aliases: [] },
  { code: "OM", label: "Oman", region: "EMEA", aliases: [] },
  { code: "IL", label: "Israel", region: "EMEA", aliases: [] },
  { code: "JO", label: "Jordan", region: "EMEA", aliases: [] },
  { code: "LB", label: "Lebanon", region: "EMEA", aliases: [] },
  { code: "EG", label: "Egypt", region: "EMEA", aliases: [] },
  { code: "MA", label: "Morocco", region: "EMEA", aliases: [] },
  { code: "DZ", label: "Algeria", region: "EMEA", aliases: [] },
  { code: "TN", label: "Tunisia", region: "EMEA", aliases: [] },
  { code: "ZA", label: "South Africa", region: "EMEA", aliases: [] },
  { code: "NG", label: "Nigeria", region: "EMEA", aliases: [] },
  { code: "KE", label: "Kenya", region: "EMEA", aliases: [] },
  { code: "GH", label: "Ghana", region: "EMEA", aliases: [] },
  { code: "ET", label: "Ethiopia", region: "EMEA", aliases: [] },
  { code: "UG", label: "Uganda", region: "EMEA", aliases: [] },
  { code: "TZ", label: "Tanzania", region: "EMEA", aliases: [] },
  { code: "SN", label: "Senegal", region: "EMEA", aliases: [] },
  { code: "CI", label: "Cote d Ivoire", region: "EMEA", aliases: ["cote d'ivoire", "ivory coast"] },
  { code: "CM", label: "Cameroon", region: "EMEA", aliases: [] },
  { code: "IN", label: "India", region: "APAC", aliases: [] },
  { code: "CN", label: "China", region: "APAC", aliases: ["prc", "people s republic of china"] },
  { code: "JP", label: "Japan", region: "APAC", aliases: [] },
  { code: "KR", label: "South Korea", region: "APAC", aliases: ["korea", "republic of korea", "korea south"] },
  { code: "SG", label: "Singapore", region: "APAC", aliases: [] },
  { code: "MY", label: "Malaysia", region: "APAC", aliases: [] },
  { code: "TH", label: "Thailand", region: "APAC", aliases: [] },
  { code: "VN", label: "Vietnam", region: "APAC", aliases: ["viet nam"] },
  { code: "ID", label: "Indonesia", region: "APAC", aliases: [] },
  { code: "PH", label: "Philippines", region: "APAC", aliases: [] },
  { code: "AU", label: "Australia", region: "APAC", aliases: [] },
  { code: "NZ", label: "New Zealand", region: "APAC", aliases: [] },
  { code: "HK", label: "Hong Kong", region: "APAC", aliases: ["hong kong sar"] },
  { code: "TW", label: "Taiwan", region: "APAC", aliases: [] },
  { code: "PK", label: "Pakistan", region: "APAC", aliases: [] },
  { code: "BD", label: "Bangladesh", region: "APAC", aliases: [] },
  { code: "LK", label: "Sri Lanka", region: "APAC", aliases: [] },
  { code: "NP", label: "Nepal", region: "APAC", aliases: [] },
  { code: "MM", label: "Myanmar", region: "APAC", aliases: ["burma"] },
  { code: "KH", label: "Cambodia", region: "APAC", aliases: [] },
  { code: "LA", label: "Laos", region: "APAC", aliases: ["lao pdr"] },
  { code: "BN", label: "Brunei", region: "APAC", aliases: ["brunei darussalam"] },
  { code: "MN", label: "Mongolia", region: "APAC", aliases: [] }
]);
const {
  byCode: COUNTRY_BY_CODE,
  aliasToCode: COUNTRY_ALIAS_TO_CODE,
  aliasesByCode: COUNTRY_ALIASES_BY_CODE
} = buildCountryLookupMaps();

const REGION_HINTS_BY_VALUE = Object.freeze({
  AMER: [
    "amer",
    "americas",
    "north america",
    "south america",
    "latin america",
    "latam",
    "caribbean"
  ],
  EMEA: ["emea", "europe", "middle east", "africa"],
  APAC: ["apac", "asia pacific", "asia", "oceania"]
});

const GENERIC_TITLE_LIKE_PARTS = new Set([
  "and",
  "for",
  "with",
  "from",
  "the",
  "manager",
  "assistant",
  "associate",
  "specialist",
  "coordinator",
  "director",
  "officer",
  "analyst",
  "consultant",
  "lead",
  "senior",
  "junior",
  "staff",
  "team",
  "services",
  "service",
  "operations",
  "operation",
  "support"
]);
const WEAK_INDUSTRY_LIKE_PARTS = new Set([
  ...GENERIC_TITLE_LIKE_PARTS,
  "account",
  "accounts",
  "representative",
  "executive",
  "management",
  "area",
  "group",
  "international",
  "care",
  "inside",
  "outside",
  "hourly",
  "commission",
  "anywhere",
  "can",
  "small",
  "planning",
  "compliance",
  "core",
  "safety",
  "import",
  "export",
  "brand",
  "ambassador",
  "customer",
  "business",
  "field",
  "division",
  "product"
]);
const PHRASE_NGRAM_INDUSTRY_COVERAGE_THRESHOLD = 2;
const FALLBACK_WORD_INDUSTRY_COVERAGE_THRESHOLD = 2;
const MIN_INDUSTRY_FALLBACK_WORD_COUNT = 3;
const MIN_INDUSTRY_PHRASE_NGRAM_COUNT = 2;
const locationGeoInferenceCache = new Map();
const LOCATION_GEO_INFERENCE_CACHE_LIMIT = 30000;

let wordIndustryCoverageCache = null;
let phraseNgramIndustryCoverageCache = null;



function splitLocationIntoCountryCandidateSegments(locationText) {
  return String(locationText || "")
    .split(/[,/|;]+|\s+-\s+/)
    .map((segment) => String(segment || "").trim())
    .filter(Boolean);
}

function inferLocationGeo(locationText) {
  const location = String(locationText || "").trim();
  if (!location) {
    return {
      countryCode: "",
      countryValue: "",
      countryLabel: "",
      countryLikePart: "",
      region: ""
    };
  }

  const cached = locationGeoInferenceCache.get(location);
  if (cached) return cached;

  const inferred = inferLocationGeoUncached(location);
  if (locationGeoInferenceCache.size >= LOCATION_GEO_INFERENCE_CACHE_LIMIT) {
    locationGeoInferenceCache.clear();
  }
  locationGeoInferenceCache.set(location, inferred);
  return inferred;
}


function inferLocationGeoUncached(locationText) {
  const location = String(locationText || "").trim();
  const normalizedGeoLocation = normalizeGeoText(location);
  if (!location || !normalizedGeoLocation) {
    return {
      countryCode: "",
      countryValue: "",
      countryLabel: "",
      countryLikePart: "",
      region: ""
    };
  }

function toTitleCaseWords(value) {
  const source = normalizeGeoText(value);
  if (!source) return "";
  return source
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}



function collectCountryCandidates(locationText) {
  const segments = splitLocationIntoCountryCandidateSegments(locationText);
  if (segments.length === 0) return [];

  const candidates = [];
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const normalizedSegment = normalizeCountryLikePart(segments[index]);
    if (!normalizedSegment) continue;
    candidates.push(normalizedSegment);

    const words = normalizedSegment.split(" ").filter(Boolean);
    const maxWords = Math.min(words.length, 4);
    for (let size = maxWords; size >= 1; size -= 1) {
      const suffix = words.slice(words.length - size).join(" ");
      if (suffix) candidates.push(suffix);
    }
  }

  return Array.from(new Set(candidates));
}


  const countryCandidates = collectCountryCandidates(location);
  for (const candidate of countryCandidates) {
    const countryCode = COUNTRY_ALIAS_TO_CODE.get(candidate);
    if (!countryCode) continue;
    const country = COUNTRY_BY_CODE.get(countryCode);
    const region =
      inferRegionFromNormalizedGeoText(normalizedGeoLocation, countryCode) ||
      String(country?.region || "").trim().toUpperCase();
    return {
      countryCode,
      countryValue: countryCode,
      countryLabel: String(country?.label || countryCode),
      countryLikePart: normalizeGeoText(country?.label || candidate),
      region
    };
  }

  const segments = splitLocationIntoCountryCandidateSegments(location);
  let fallbackCountryLikePart = "";
  if (segments.length >= 2) {
    for (let index = segments.length - 1; index >= 1; index -= 1) {
      const candidate = normalizeCountryLikePart(segments[index]);
      if (!isLikelyCountryLikePart(candidate)) continue;
      fallbackCountryLikePart = candidate;
      break;
    }
  }

  const region = inferRegionFromNormalizedGeoText(normalizedGeoLocation);
  return {
    countryCode: "",
    countryValue: fallbackCountryLikePart ? `RAW:${fallbackCountryLikePart}` : "",
    countryLabel: fallbackCountryLikePart ? toTitleCaseWords(fallbackCountryLikePart) : "",
    countryLikePart: fallbackCountryLikePart,
    region
  };
}


function buildCountryLookupMaps() {
  const byCode = new Map();
  const aliasToCode = new Map();
  const aliasesByCode = new Map();

  for (const item of COUNTRY_DEFINITIONS) {
    const code = String(item?.code || "")
      .trim()
      .toUpperCase();
    if (!code) continue;

    const label = String(item?.label || code).trim();
    const region = String(item?.region || "")
      .trim()
      .toUpperCase();
    const aliasValues = [label, ...(Array.isArray(item?.aliases) ? item.aliases : [])];
    const aliasSet = new Set();
    for (const aliasValue of aliasValues) {
      const normalizedAlias = normalizeGeoText(aliasValue);
      if (!normalizedAlias) continue;
      if (!aliasToCode.has(normalizedAlias)) {
        aliasToCode.set(normalizedAlias, code);
      }
      aliasSet.add(normalizedAlias);
    }

    byCode.set(code, { code, label, region });
    aliasesByCode.set(code, aliasSet);
  }

  return { byCode, aliasToCode, aliasesByCode };
}


function createLikeParts(value) {
  const normalized = normalizeLikeText(value);
  if (!normalized) return [];
  return normalized
    .split(/[^a-z0-9]+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 3 && !GENERIC_TITLE_LIKE_PARTS.has(part));
}

function buildWordNgrams(words, minSize = 2, maxSize = 3) {
  const source = Array.isArray(words) ? words : [];
  const ngrams = [];
  for (let size = minSize; size <= maxSize; size += 1) {
    if (source.length < size) continue;
    for (let index = 0; index <= source.length - size; index += 1) {
      const gram = source.slice(index, index + size).join(" ").trim();
      if (gram) ngrams.push(gram);
    }
  }
  return ngrams;
}


// Only treats a state name (e.g. "washington") as a match when it's the entire content of a
// comma/dash-separated segment, e.g. "Seattle, Washington" — not when it's merely one word inside
// a longer place name segment like "Fort Washington" or "West Virginia".
function hasStateNameSegmentMatch(locationText, stateName) {
  const segments = splitLocationIntoCountryCandidateSegments(locationText);
  return segments.some((segment) => normalizeGeoText(segment) === stateName);
}

// Only treats a bare code (e.g. "OR", "IN", "ME") as a state-code match when it stands alone
// as a leading/trailing token of a comma/dash-separated segment (optionally with a trailing zip),
// e.g. "Portland, OR" or "OR 97201" — not when it's just an English word inside a longer phrase
// like "Chicago, IL or Remote" or "based in USA".
function hasBareStateCodeSegmentMatch(locationText, code) {
  const segments = splitLocationIntoCountryCandidateSegments(locationText).map((segment) =>
    segment.toUpperCase()
  );
  for (const segment of segments) {
    const words = segment.split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;
    if (words[0] === code) return true;
    const lastWord = words[words.length - 1];
    if (lastWord === code) return true;
    if (words.length >= 2 && words[words.length - 2] === code && /^\d{5}(-\d{4})?$/.test(lastWord)) {
      return true;
    }
  }
  return false;
}

// Some ATS exports encode the whole location as one hyphenated slug with no spaces:
// "US-WA-Redmond", "US-Texas-Fort Worth", "TX-Katy-77494". hasBareStateCodeSegmentMatch
// cannot see the state there because nothing splits it into its own token -- the segment
// splitter only breaks on " - " with spaces, so the slug stays a single word.
//
// Only two shapes are read, both unambiguous about being American. A leading "US" names
// the country outright, and a trailing US ZIP does the same by implication. That second
// signal is what keeps the state and country readings of a shared code apart in this data:
// "IN-Mishawaka-46544" is Indiana, "IN-HR-Gurgaon" is India, and only the first has a ZIP.
// A bare "CA-ON-Toronto" is left alone for the same reason.
function hasStateCodeSlugMatch(locationText, code) {
  const stateName = STATE_CODE_TO_NAME[code];

  return splitLocationIntoCountryCandidateSegments(locationText).some((segment) => {
    const parts = String(segment)
      .split("-")
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length < 2) return false;

    if (parts[0].toUpperCase() === "US") {
      if (parts[1].toUpperCase() === code) return true;
      if (stateName && normalizeGeoText(parts[1]) === stateName) return true;
    }

    if (parts[0].toUpperCase() !== code) return false;
    // The zip can carry a trailing qualifier ("45402 Hybrid"), so read its first token.
    const lastToken = String(parts[parts.length - 1]).split(/\s+/)[0];
    return /^\d{5}$/.test(lastToken);
  });
}

// A segment that is exactly a state name usually is that state ("Seattle, Washington"),
// but most state names are also town names somewhere else: Washington PA and Washington IN,
// Indiana PA, California MD, Nevada MO, Wyoming MI, Delaware OH. US locations are written
// city-first, so when the segment right after the name is an explicit *different* state,
// the name is the city and the token after it is the state.
//
// Deliberately adjacency-based rather than "any other state appears anywhere": the segment
// splitter also breaks on "/", so a multi-location posting like "Seattle, Washington /
// Portland, OR" flattens into one list, and a whole-string rule would drop its genuine WA
// match. This also subsumes the Washington/DC case, though the explicit DC guards below
// stay for the fused spellings ("washingtondc") that never produce a clean segment.
function isDifferentState(segment, code) {
  const segmentCode = String(segment || "").trim().toUpperCase();
  if (STATE_CODE_TO_NAME[segmentCode] && segmentCode !== code) return true;

  const segmentName = normalizeGeoText(segment);
  for (const [otherCode, otherName] of Object.entries(STATE_CODE_TO_NAME)) {
    if (otherCode !== code && segmentName === otherName) return true;
  }
  return false;
}

function isNonUsCountry(segment) {
  const countryCode = COUNTRY_ALIAS_TO_CODE.get(normalizeCountryLikePart(segment));
  return Boolean(countryCode) && countryCode !== "US";
}

// A segment that is exactly a state name usually is that state ("Seattle, Washington"), but
// most state names are also town names somewhere else -- Washington PA and Washington IN,
// Indiana PA, California MD, Nevada MO, Wyoming MI, Delaware OH -- and abroad, such as
// Washington in Tyne and Wear. Two signals distinguish the town from the state:
//
//   - US locations are written city-first, so an explicit *different* state in the very
//     next position means the name was the city ("Washington, PA").
//   - a non-US country anywhere alongside it means it is not a US state at all
//     ("Washington, Tyne and Wear, United Kingdom").
//
// Both are scoped to one location. "/" and friends separate whole locations, and a posting
// listing many of them flattens into a single string, so the check runs per location group
// and any one clean group is a match. Otherwise "Seattle, Washington / Portland, OR" would
// lose its genuine WA match to the other location's state.
function hasStateNameGroupMatch(locationText, stateName, code) {
  const groups = String(locationText || "")
    .split(/[/|;]+/)
    .map((group) => group.trim())
    .filter(Boolean);

  return groups.some((group) => {
    const segments = group
      .split(/,+|\s+-\s+/)
      .map((segment) => segment.trim())
      .filter(Boolean);

    const nameIndex = segments.findIndex((segment) => normalizeGeoText(segment) === stateName);
    if (nameIndex < 0) return false;

    const next = segments[nameIndex + 1];
    if (next && isDifferentState(next, code)) return false;

    return !segments.some((segment) => isNonUsCountry(segment));
  });
}

function hasStateLikeMatch(locationText, stateCode) {
  const code = String(stateCode || "").trim().toUpperCase();
  if (!code) return false;
  const normalizedGeoLocation = normalizeGeoText(locationText);

  if (hasBareStateCodeSegmentMatch(locationText, code)) {
    // Guard against state-code / country-code collisions (e.g. IN/India, LA/Laos, IL/Israel,
    // MT/Malta, ME/Montenegro) when the full country name is also explicitly present.
    const inferredGeo = COUNTRY_BY_CODE.has(code) ? inferLocationGeo(locationText) : null;
    const isActuallyThatCountry = Boolean(inferredGeo?.countryCode) && inferredGeo.countryCode === code;
    if (!isActuallyThatCountry) return true;
  }

  // No country guard needed here: both slug shapes already establish the location is US.
  if (hasStateCodeSlugMatch(locationText, code)) return true;

  const stateName = STATE_CODE_TO_NAME[code];
  if (!stateName) return false;
  if (!hasStateNameGroupMatch(locationText, stateName, code)) return false;

  if (code === "WA") {
    if (containsGeoPhrase(normalizedGeoLocation, STATE_CODE_TO_NAME.DC)) return false;
    if (containsGeoPhrase(normalizedGeoLocation, "washington dc")) return false;
    if (containsGeoPhrase(normalizedGeoLocation, "washington d c")) return false;
    // Catches fused/slug variants: "washington dcmetro area", "washington-dc", "washingtondc"
    if (/\bwashington\s*[- ]?\s*dc/i.test(normalizedGeoLocation)) return false;
  }
  return true;
}

function classifyLocationWorkMode(locationText) {
  const normalized = normalizeLikeText(locationText);
  if (!normalized) return "non_remote";
  const hasHybrid = normalized.includes("hybrid");
  const hasRemote = normalized.includes("remote") || normalized.includes("work from home") || normalized.includes("wfh");
  if (hasHybrid) return "hybrid";
  if (hasRemote) return "remote";
  return "non_remote";
}


function isWeakFallbackWord(word, wordIndustryCoverage) {
  if (!word) return true;
  if (WEAK_INDUSTRY_LIKE_PARTS.has(word)) return true;
  const industryCoverage = Number(wordIndustryCoverage?.get(word) || 0);
  return industryCoverage >= FALLBACK_WORD_INDUSTRY_COVERAGE_THRESHOLD;
}

function isWeakPhraseNgram(ngram, phraseNgramIndustryCoverage) {
  if (!ngram) return true;
  const parts = ngram.split(" ").map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return true;
  if (parts.every((part) => WEAK_INDUSTRY_LIKE_PARTS.has(part))) return true;
  const industryCoverage = Number(phraseNgramIndustryCoverage?.get(ngram) || 0);
  return industryCoverage >= PHRASE_NGRAM_INDUSTRY_COVERAGE_THRESHOLD;
}





function isLikelyCountryLikePart(value) {
  const candidate = normalizeCountryLikePart(value);
  if (!candidate) return false;
  if (candidate.length < 3 || candidate.length > 40) return false;
  if (candidate.split(" ").length > 4) return false;
  if (/\d/.test(candidate)) return false;
  if (LOCATION_NON_COUNTRY_TERMS.has(candidate)) return false;
  if (US_STATE_NAMES.has(candidate)) return false;
  if (/^[a-z]{2}$/.test(candidate)) return false;
  return true;
}

function containsGeoPhrase(normalizedGeoTextValue, phrase) {
  const haystack = String(normalizedGeoTextValue || "").trim();
  const needle = normalizeGeoText(phrase);
  if (!haystack || !needle) return false;
  return ` ${haystack} `.includes(` ${needle} `);
}

function inferRegionFromLocationText(locationText, countryCode = "") {
  return inferRegionFromNormalizedGeoText(normalizeGeoText(locationText), countryCode);
}

function inferRegionFromNormalizedGeoText(normalizedGeoTextValue, countryCode = "") {
  for (const region of ["AMER", "EMEA", "APAC"]) {
    const hints = REGION_HINTS_BY_VALUE[region] || [];
    const hasHint = hints.some((hint) => containsGeoPhrase(normalizedGeoTextValue, hint));
    if (hasHint) return region;
  }

  const explicitCountryCode = String(countryCode || "").trim().toUpperCase();
  if (explicitCountryCode) {
    return String(COUNTRY_BY_CODE.get(explicitCountryCode)?.region || "").trim().toUpperCase();
  }

  return "";
}

function buildDefaultCountryFilterOptions() {
  const options = [];
  const seenValues = new Set();

  for (const rawLabel of DEFAULT_COUNTRY_FILTER_LABELS) {
    const label = String(rawLabel || "").trim();
    if (!label) continue;

    const explicitCode = label.toUpperCase();
    const normalizedLabel = normalizeCountryLikePart(label);
    const matchedCode = COUNTRY_BY_CODE.has(explicitCode)
      ? explicitCode
      : COUNTRY_ALIAS_TO_CODE.get(normalizedLabel);
    const matchedCountry = matchedCode ? COUNTRY_BY_CODE.get(matchedCode) : null;

    let value = label;
    let region = "";
    if (matchedCountry) {
      value = matchedCountry.code;
      region = String(matchedCountry.region || "").trim().toUpperCase();
    } else if (isLikelyCountryLikePart(normalizedLabel)) {
      value = `RAW:${normalizedLabel}`;
      region = inferRegionFromLocationText(label);
    }

    if (seenValues.has(value)) continue;
    seenValues.add(value);
    options.push({
      value,
      label,
      region
    });
  }

  return Object.freeze(options);
}


function normalizeCountryLikePart(value) {
  return normalizeGeoText(value)
    .replace(/\b(country|republic|federation|state)\b/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeCompensationType(value, fallbackValue = "unknown") {
  const fallback = String(fallbackValue || "unknown").trim().toLowerCase();
  const normalized = String(value || "").trim().toLowerCase();

  if (normalized === "hourly") return "hourly";
  if (normalized === "salary") return "salary";
  if (normalized === "both") return "both";
  if (normalized === "unknown") return "unknown";

  if (
    normalized === "wage" ||
    normalized === "wages" ||
    normalized === "per_hour" ||
    normalized === "per-hour" ||
    normalized === "hour"
  ) {
    return "hourly";
  }

  if (
    normalized === "annual" ||
    normalized === "annually" ||
    normalized === "yearly" ||
    normalized === "per_year" ||
    normalized === "per-year" ||
    normalized === "year"
  ) {
    return "salary";
  }

  if (COMPENSATION_TYPES.includes(fallback)) return fallback;
  return "unknown";
}

function normalizeCompensationPayPeriod(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "hour" || normalized === "week" || normalized === "month" || normalized === "year") {
    return normalized;
  }
  return "";
}

function normalizeEducationLevel(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return "";

  if (normalized === "high_school" || normalized === "high school" || normalized === "ged") {
    return "high_school";
  }
  if (normalized === "associate" || normalized === "associates" || normalized === "associate_degree") {
    return "associate";
  }
  if (
    normalized === "bachelor" ||
    normalized === "bachelors" ||
    normalized === "ba" ||
    normalized === "bs" ||
    normalized === "b.a." ||
    normalized === "b.s."
  ) {
    return "bachelor";
  }
  if (
    normalized === "master" ||
    normalized === "masters" ||
    normalized === "mba" ||
    normalized === "ms" ||
    normalized === "ma" ||
    normalized === "m.s." ||
    normalized === "m.a."
  ) {
    return "master";
  }
  if (
    normalized === "doctorate" ||
    normalized === "doctoral" ||
    normalized === "doctor" ||
    normalized === "phd" ||
    normalized === "ph.d."
  ) {
    return "doctorate";
  }
  if (
    normalized === "certificate" ||
    normalized === "certification" ||
    normalized === "certified" ||
    normalized === "diploma"
  ) {
    return "certificate";
  }

  return "";
}

function normalizeEducationLevels(values) {
  let sourceValues = [];

  if (Array.isArray(values)) {
    sourceValues = values;
  } else if (typeof values === "string") {
    const raw = String(values || "").trim();
    if (raw.startsWith("[") && raw.endsWith("]")) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          sourceValues = parsed;
        } else {
          sourceValues = raw.split(",");
        }
      } catch {
        sourceValues = raw.split(",");
      }
    } else {
      sourceValues = raw ? raw.split(",") : [];
    }
  }

  const seen = new Set();
  const normalizedValues = [];
  for (const value of sourceValues) {
    const normalized = normalizeEducationLevel(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    normalizedValues.push(normalized);
  }
  return normalizedValues;
}

function serializeEducationLevels(values) {
  const normalized = normalizeEducationLevels(values);
  if (normalized.length === 0) return null;
  return normalized.join(",");
}

function parseEducationLevels(value) {
  return normalizeEducationLevels(value);
}

function formatCompensationTypeLabel(value) {
  const normalized = normalizeCompensationType(value, "unknown");
  return COMPENSATION_TYPE_LABEL_BY_VALUE[normalized] || COMPENSATION_TYPE_LABEL_BY_VALUE.unknown;
}

function formatEducationLevelLabel(value) {
  const normalized = normalizeEducationLevel(value);
  if (!normalized) return "";
  return EDUCATION_LEVEL_LABEL_BY_VALUE[normalized] || normalized;
}

function formatCompensationPayPeriodLabel(value) {
  const normalized = normalizeCompensationPayPeriod(value);
  if (!normalized) return "";
  return COMPENSATION_PAY_PERIOD_LABEL_BY_VALUE[normalized] || normalized;
}

const COMPENSATION_TYPE_OPTION_ITEMS = Object.freeze(
  COMPENSATION_TYPES.map((value) => ({
    value,
    label: formatCompensationTypeLabel(value)
  }))
);

const EDUCATION_LEVEL_OPTION_ITEMS = Object.freeze(
  EDUCATION_LEVELS.map((value) => ({
    value,
    label: formatEducationLevelLabel(value)
  }))
);

const COMPENSATION_PAY_PERIOD_OPTION_ITEMS = Object.freeze(
  COMPENSATION_PAY_PERIODS.map((value) => ({
    value,
    label: formatCompensationPayPeriodLabel(value)
  }))
);

function normalizeCompensationCurrencyCode(value) {
  const normalized = String(value || "").trim().toUpperCase();
  if (!normalized) return null;
  const allowedCodes = new Set(["USD", "CAD", "AUD", "EUR", "GBP", "JPY", "NZD", "CHF", "SEK", "NOK", "DKK", "INR"]);
  if (!allowedCodes.has(normalized)) return null;
  return normalized;
}


function normalizeCountyName(value) {
  return normalizeLikeText(value)
    .replace(/\b(county|parish|borough|census area|municipality)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseCountyFilters(values) {
  const parsed = [];
  for (const rawValue of values) {
    const value = String(rawValue || "").trim();
    if (!value) continue;

    if (value.includes("|")) {
      const [stateRaw, countyRaw] = value.split("|");
      const stateCode = String(stateRaw || "").trim().toUpperCase();
      const countyLikePart = normalizeCountyName(countyRaw);
      if (!countyLikePart) continue;
      parsed.push({ stateCode, countyLikePart });
      continue;
    }

    const countyLikePart = normalizeCountyName(value);
    if (!countyLikePart) continue;
    parsed.push({ stateCode: "", countyLikePart });
  }
  return parsed;
}


function parseCountryFilters(values) {
  const parsed = [];
  const seen = new Set();
  for (const rawValue of normalizeStringArray(values)) {
    const value = String(rawValue || "").trim();
    if (!value) continue;

    let nextFilter = null;
    if (/^raw:/i.test(value)) {
      const rawLikePart = normalizeCountryLikePart(value.slice(4));
      if (isLikelyCountryLikePart(rawLikePart)) {
        nextFilter = {
          type: "raw",
          rawLikePart,
          value: `RAW:${rawLikePart}`
        };
      }
    } else {
      const asCode = value.toUpperCase();
      if (COUNTRY_BY_CODE.has(asCode)) {
        nextFilter = {
          type: "code",
          code: asCode,
          value: asCode
        };
      } else {
        const aliasCountryCode = COUNTRY_ALIAS_TO_CODE.get(normalizeCountryLikePart(value));
        if (aliasCountryCode) {
          nextFilter = {
            type: "code",
            code: aliasCountryCode,
            value: aliasCountryCode
          };
        } else {
          const rawLikePart = normalizeCountryLikePart(value);
          if (isLikelyCountryLikePart(rawLikePart)) {
            nextFilter = {
              type: "raw",
              rawLikePart,
              value: `RAW:${rawLikePart}`
            };
          }
        }
      }
    }

    if (!nextFilter) continue;
    if (seen.has(nextFilter.value)) continue;
    seen.add(nextFilter.value);
    parsed.push(nextFilter);
  }
  return parsed;
}

function parseRegionFilters(values) {
  const normalized = normalizeStringArray(values)
    .map((value) => String(value || "").trim().toUpperCase())
    .filter((value) => LOCATION_REGION_VALUES.has(value));
  return Array.from(new Set(normalized));
}


function normalizeRemoteFilter(value) {
  const normalized = String(value || "all")
    .trim()
    .toLowerCase();
  if (normalized === "remote" || normalized === "hybrid" || normalized === "non_remote") return normalized;
  return "all";
}

function normalizeRemoteFilters(value) {
  if (Array.isArray(value)) {
    const normalizedArray = value
      .map((item) => normalizeRemoteFilter(item))
      .filter((item) => item !== "all");
    const unique = Array.from(new Set(normalizedArray));
    return unique.length > 0 ? unique : ["all"];
  }

  const raw = String(value || "all").trim();
  if (!raw) return ["all"];

  const parts = raw
    .split(",")
    .map((part) => String(part || "").trim())
    .filter(Boolean);
  if (parts.length === 0) return ["all"];

  const normalizedParts = parts.map((part) => normalizeRemoteFilter(part));
  if (normalizedParts.includes("all")) return ["all"];

  const unique = Array.from(new Set(normalizedParts.filter((part) => part !== "all")));
  return unique.length > 0 ? unique : ["all"];
}


async function buildIndustryMatchersByKey(industryKeys) {
  if (!Array.isArray(industryKeys) || industryKeys.length === 0) {
    return new Map();
  }

  const [wordIndustryCoverage, phraseNgramIndustryCoverage] = await Promise.all([
    getWordIndustryCoverageMap(),
    getPhraseNgramIndustryCoverageMap()
  ]);

  const placeholders = industryKeys.map(() => "?").join(", ");
  let rows = [];
  const db = getDb()
  try {
    rows = await db.all(
      `
        SELECT industry_key, normalized_job_title
        FROM job_position_industry
        WHERE industry_key IN (${placeholders});
      `,
      industryKeys
    );
  } catch {
    return new Map();
  }

  const byIndustry = new Map();
  for (const key of industryKeys) {
    byIndustry.set(key, {
      exactTitles: new Set(),
      phraseNgrams: new Set(),
      fallbackWords: new Set(),
      wordCounts: new Map(),
      phraseCounts: new Map()
    });
  }

  for (const row of rows) {
    const key = String(row?.industry_key || "").trim();
    if (!key || !byIndustry.has(key)) continue;
    const normalizedTitle = normalizeLikeText(row?.normalized_job_title);
    const words = createLikeParts(normalizedTitle);
    const target = byIndustry.get(key);
    if (normalizedTitle) {
      target.exactTitles.add(normalizedTitle);
    }

    for (const word of new Set(words)) {
      target.wordCounts.set(word, (target.wordCounts.get(word) || 0) + 1);
    }

    for (const ngram of new Set(buildWordNgrams(words, 2, 3))) {
      target.phraseCounts.set(ngram, (target.phraseCounts.get(ngram) || 0) + 1);
    }
  }

  const finalized = new Map();
  for (const [industryKey, matcher] of byIndustry.entries()) {
    const fallbackWords = new Set();
    for (const [word, count] of matcher.wordCounts.entries()) {
      if (count < MIN_INDUSTRY_FALLBACK_WORD_COUNT) continue;
      if (isWeakFallbackWord(word, wordIndustryCoverage)) continue;
      fallbackWords.add(word);
    }

    const phraseNgrams = new Set();
    for (const [ngram, count] of matcher.phraseCounts.entries()) {
      if (count < MIN_INDUSTRY_PHRASE_NGRAM_COUNT) continue;
      if (isWeakPhraseNgram(ngram, phraseNgramIndustryCoverage)) continue;
      phraseNgrams.add(ngram);
    }

    finalized.set(industryKey, {
      exactTitles: matcher.exactTitles,
      phraseNgrams,
      fallbackWords
    });
  }

  return finalized;
}

async function getWordIndustryCoverageMap() {
  if (wordIndustryCoverageCache instanceof Map) {
    return wordIndustryCoverageCache;
  }

  const db = getDb()
  let rows = [];
  try {
    rows = await db.all(
      `
        SELECT industry_key, normalized_job_title
        FROM job_position_industry;
      `
    );
  } catch {
    wordIndustryCoverageCache = new Map();
    return wordIndustryCoverageCache;
  }

  const wordIndustrySets = new Map();
  for (const row of rows) {
    const industryKey = String(row?.industry_key || "").trim();
    if (!industryKey) continue;

    const words = new Set(createLikeParts(row?.normalized_job_title));
    for (const word of words) {
      if (!wordIndustrySets.has(word)) {
        wordIndustrySets.set(word, new Set());
      }
      wordIndustrySets.get(word).add(industryKey);
    }
  }

  const coverageMap = new Map();
  for (const [word, keys] of wordIndustrySets.entries()) {
    coverageMap.set(word, keys.size);
  }

  wordIndustryCoverageCache = coverageMap;
  return coverageMap;
}

async function getPhraseNgramIndustryCoverageMap() {
  if (phraseNgramIndustryCoverageCache instanceof Map) {
    return phraseNgramIndustryCoverageCache;
  }

  let rows = [];
  try {
  const db = getDb()
    rows = await db.all(
      `
        SELECT industry_key, normalized_job_title
        FROM job_position_industry;
      `
    );
  } catch {
    phraseNgramIndustryCoverageCache = new Map();
    return phraseNgramIndustryCoverageCache;
  }

  const ngramIndustrySets = new Map();
  for (const row of rows) {
    const industryKey = String(row?.industry_key || "").trim();
    if (!industryKey) continue;

    const words = createLikeParts(row?.normalized_job_title);
    const ngrams = new Set(buildWordNgrams(words, 2, 3));
    for (const ngram of ngrams) {
      if (!ngramIndustrySets.has(ngram)) {
        ngramIndustrySets.set(ngram, new Set());
      }
      ngramIndustrySets.get(ngram).add(industryKey);
    }
  }

  const coverageMap = new Map();
  for (const [ngram, keys] of ngramIndustrySets.entries()) {
    coverageMap.set(ngram, keys.size);
  }

  phraseNgramIndustryCoverageCache = coverageMap;
  return coverageMap;
}



function rowMatchesIndustryLikeParts(positionName, selectedIndustryKeys, industryMatchersByKey) {
  if (!Array.isArray(selectedIndustryKeys) || selectedIndustryKeys.length === 0) return true;
  if (!(industryMatchersByKey instanceof Map) || industryMatchersByKey.size === 0) return false;

  const titleText = String(positionName || "");
  const selectedKeySet = new Set(
    selectedIndustryKeys.map((key) => String(key || "").trim().toLowerCase()).filter(Boolean)
  );
  const isSalesExclusiveRole = SALES_EXCLUSIVE_ROLE_REGEX.test(titleText);
  if (isSalesExclusiveRole && !selectedKeySet.has(SALES_BUSINESS_INDUSTRY_KEY)) {
    return false;
  }

  const normalizedPosition = normalizeLikeText(positionName);
  const postingWords = createLikeParts(positionName);
  if (postingWords.length === 0) return false;
  const postingWordSet = new Set(postingWords);
  const postingPhraseSet = new Set(buildWordNgrams(postingWords, 2, 3));

  for (const industryKey of selectedIndustryKeys) {
    const matcher = industryMatchersByKey.get(industryKey);
    const exactTitles = matcher?.exactTitles;
    const phraseNgrams = matcher?.phraseNgrams;
    const fallbackWords = matcher?.fallbackWords;
    const hasMatcherData =
      exactTitles instanceof Set || phraseNgrams instanceof Set || fallbackWords instanceof Set;
    if (!hasMatcherData) continue;

    if (exactTitles instanceof Set && normalizedPosition && exactTitles.has(normalizedPosition)) {
      if (industryKey === IT_SOFTWARE_INDUSTRY_KEY && IT_SALES_GTM_ROLE_REGEX.test(titleText)) {
        continue;
      }

      const hasStrongPhrase =
        phraseNgrams instanceof Set &&
        Array.from(postingPhraseSet).some((postingPhrase) => phraseNgrams.has(postingPhrase));
      const hasStrongWord =
        fallbackWords instanceof Set &&
        Array.from(postingWordSet).some((word) => fallbackWords.has(word));
      if (hasStrongPhrase || hasStrongWord) {
        return true;
      }
      if (
        industryKey === IT_SOFTWARE_INDUSTRY_KEY &&
        Array.from(postingWordSet).some((word) => IT_HIGH_SIGNAL_ANCHOR_PARTS.has(word))
      ) {
        return true;
      }
    }

    if (industryKey === IT_SOFTWARE_INDUSTRY_KEY) {
      if (IT_SALES_GTM_ROLE_REGEX.test(titleText)) continue;
      const hasTechAnchor = Array.from(postingWordSet).some((part) => IT_TECH_ANCHOR_PARTS.has(part));
      if (!hasTechAnchor) continue;
    }

    if (phraseNgrams instanceof Set && phraseNgrams.size > 0) {
      for (const postingPhrase of postingPhraseSet) {
        if (phraseNgrams.has(postingPhrase)) {
          return true;
        }
      }
    }

    if (fallbackWords instanceof Set && fallbackWords.size > 0) {
      for (const word of postingWordSet) {
        if (fallbackWords.has(word)) {
          if (
            industryKey !== IT_SOFTWARE_INDUSTRY_KEY ||
            postingWordSet.size === 1 ||
            IT_HIGH_SIGNAL_ANCHOR_PARTS.has(word)
          ) {
            return true;
          }
        }
      }
    }

    if (industryKey === IT_SOFTWARE_INDUSTRY_KEY) {
      for (const word of postingWordSet) {
        if (IT_HIGH_SIGNAL_ANCHOR_PARTS.has(word) && fallbackWords instanceof Set && fallbackWords.has(word)) {
          return true;
        }
      }
    }
  }

  return false;
}


function rowMatchesCompensationFilter(compensationType, selectedCompensationTypes) {
  const selected = Array.isArray(selectedCompensationTypes) ? selectedCompensationTypes : [];
  if (selected.length === 0) return true;
  const normalizedRowValue = normalizeCompensationType(compensationType, "unknown");
  return selected.includes(normalizedRowValue);
}

function rowMatchesCompensationRangeFilter(
  rowPayMin,
  rowPayMax,
  rowPayPeriod,
  selectedPayMin,
  selectedPayMax,
  selectedPayPeriods
) {
  const payPeriods = Array.isArray(selectedPayPeriods) ? selectedPayPeriods.filter(Boolean) : [];
  const hasRangeFilter = Number.isFinite(selectedPayMin) || Number.isFinite(selectedPayMax);
  const hasPeriodFilter = payPeriods.length > 0;
  if (!hasRangeFilter && !hasPeriodFilter) return true;

  const normalizedRowPayPeriod = normalizeCompensationPayPeriod(rowPayPeriod);
  if (hasPeriodFilter) {
    if (!normalizedRowPayPeriod || !payPeriods.includes(normalizedRowPayPeriod)) return false;
  }

  const parsedRowPayMin = Number(rowPayMin);
  const parsedRowPayMax = Number(rowPayMax);
  const normalizedRowPayMin = Number.isFinite(parsedRowPayMin) && parsedRowPayMin > 0 ? parsedRowPayMin : null;
  const normalizedRowPayMax = Number.isFinite(parsedRowPayMax) && parsedRowPayMax > 0 ? parsedRowPayMax : null;

  if (!hasRangeFilter) return true;

  const rowLower = normalizedRowPayMin !== null ? normalizedRowPayMin : normalizedRowPayMax;
  const rowUpper = normalizedRowPayMax !== null ? normalizedRowPayMax : normalizedRowPayMin;
  if (rowLower === null || rowUpper === null) return false;

  if (Number.isFinite(selectedPayMin) && rowUpper < selectedPayMin) return false;
  if (Number.isFinite(selectedPayMax) && rowLower > selectedPayMax) return false;
  return true;
}

function rowMatchesEducationFilter(educationLevels, selectedEducationLevels) {
  const selected = normalizeEducationLevels(selectedEducationLevels);
  if (selected.length === 0) return true;

  const rowValues = parseEducationLevels(educationLevels);
  if (rowValues.length === 0) return false;

  const rowSet = new Set(rowValues);
  return selected.some((value) => rowSet.has(value));
}


function rowMatchesLocationFilters(
  locationText,
  selectedStateCodes,
  countyFilters,
  countryFilters = [],
  selectedRegions = []
) {
  const stateCodes = Array.isArray(selectedStateCodes) ? selectedStateCodes : [];
  const counties = Array.isArray(countyFilters) ? countyFilters : [];
  const countries = Array.isArray(countryFilters) ? countryFilters : [];
  const regions = Array.isArray(selectedRegions) ? selectedRegions : [];
  if (stateCodes.length === 0 && counties.length === 0 && countries.length === 0 && regions.length === 0) return true;

  const location = String(locationText || "").trim();
  if (!location) return false;
  const normalizedLocation = normalizeLikeText(location);
  const normalizedGeoLocation = normalizeGeoText(location);
  const inferredGeo = inferLocationGeo(location);

  if (stateCodes.length > 0) {
    const hasSelectedState = stateCodes.some((stateCode) => hasStateLikeMatch(location, stateCode));
    if (!hasSelectedState) return false;
  }

  if (counties.length > 0) {
    const matchesCounty = counties.some((countyFilter) => {
      const countyLikePart = String(countyFilter?.countyLikePart || "").trim();
      if (!countyLikePart) return false;

      if (countyFilter.stateCode && !hasStateLikeMatch(location, countyFilter.stateCode)) {
        return false;
      }

      return (
        normalizedLocation.includes(countyLikePart) ||
        normalizedLocation.includes(`${countyLikePart} county`) ||
        normalizedLocation.includes(`${countyLikePart} parish`) ||
        normalizedLocation.includes(`${countyLikePart} borough`) ||
        normalizedLocation.includes(`${countyLikePart} census area`)
      );
    });

    if (!matchesCounty) return false;
  }

  if (countries.length > 0) {
    const matchesCountry = countries.some((countryFilter) => {
      if (countryFilter?.type === "code") {
        const selectedCountryCode = String(countryFilter?.code || "").trim().toUpperCase();
        if (!selectedCountryCode) return false;
        if (inferredGeo.countryCode && inferredGeo.countryCode === selectedCountryCode) {
          return true;
        }

        const aliases = COUNTRY_ALIASES_BY_CODE.get(selectedCountryCode);
        if (!(aliases instanceof Set)) return false;
        return Array.from(aliases).some((alias) => containsGeoPhrase(normalizedGeoLocation, alias));
      }

      const rawLikePart = String(countryFilter?.rawLikePart || "").trim();
      if (!rawLikePart) return false;
      return containsGeoPhrase(normalizedGeoLocation, rawLikePart);
    });

    if (!matchesCountry) return false;
  }

  if (regions.length > 0) {
    const region = inferredGeo.region || inferRegionFromNormalizedGeoText(normalizedGeoLocation, inferredGeo.countryCode);
    if (!region || !regions.includes(region)) return false;
  }

  return true;
}

function rowMatchesRemoteFilter(locationText, remoteFilter) {
  const normalizedFilters = normalizeRemoteFilters(remoteFilter);
  if (normalizedFilters.includes("all")) return true;
  const mode = classifyLocationWorkMode(locationText);
  return normalizedFilters.includes(mode);
}



module.exports = {
  COMPENSATION_TYPES,
  COMPENSATION_PAY_PERIODS,
  EDUCATION_LEVELS,
  COMPENSATION_TYPE_OPTION_ITEMS,
  COMPENSATION_PAY_PERIOD_OPTION_ITEMS,
  EDUCATION_LEVEL_OPTION_ITEMS,
  STATE_CODE_TO_NAME,
  LOCATION_REGION_OPTIONS,
  buildDefaultCountryFilterOptions,
  inferLocationGeo,
  parseCountyFilters,
  parseCountryFilters,
  parseRegionFilters,
  normalizeRemoteFilter,
  normalizeRemoteFilters,
  buildIndustryMatchersByKey,
  normalizeCompensationType,
  normalizeCompensationPayPeriod,
  normalizeEducationLevel,
  normalizeCompensationCurrencyCode,
  normalizeEducationLevels,
  serializeEducationLevels,
  parseEducationLevels,
  rowMatchesIndustryLikeParts,
  rowMatchesEducationFilter,
  rowMatchesCompensationFilter,
  rowMatchesCompensationRangeFilter,
  rowMatchesLocationFilters,
  rowMatchesRemoteFilter,
  formatCompensationTypeLabel,
  formatCompensationPayPeriodLabel,
  formatEducationLevelLabel,
  normalizeCountryLikePart
};
