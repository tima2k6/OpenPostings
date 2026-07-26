// Pure filter-shape helpers, deliberately free of storage/native imports so they
// can be unit tested in plain Node.

export const DEFAULT_POSTINGS_FILTERS = Object.freeze({
  ats: "all",
  industries: [],
  regions: [],
  countries: [],
  states: [],
  counties: [],
  remote: ["all"],
  hide_no_date: false,
  sort_by: "recent"
});

const REMOTE_FILTER_VALUES = ["all", "remote", "hybrid", "non_remote"];
// Mirrors POSTING_SORT_OPTIONS in server/helpers/normalize-strings.js. An unknown stored
// value falls back to the default rather than being sent on to the API.
const POSTING_SORT_VALUES = ["recent", "first_seen_desc", "company_asc"];

function toStringArray(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const normalized = [];
  for (const item of value) {
    const text = String(item ?? "").trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    normalized.push(text);
  }
  return normalized;
}

// Stored filters are untrusted: they may come from an older build with a
// different shape, or have been hand-edited. Rebuild them field by field on top
// of the defaults so an unexpected value can never reach the query layer.
export function normalizePersistedFilters(stored) {
  const source = stored && typeof stored === "object" ? stored : {};
  const remote = toStringArray(source.remote).filter((value) => REMOTE_FILTER_VALUES.includes(value));

  return {
    ...DEFAULT_POSTINGS_FILTERS,
    ats: String(source.ats ?? "").trim() || DEFAULT_POSTINGS_FILTERS.ats,
    industries: toStringArray(source.industries),
    regions: toStringArray(source.regions),
    countries: toStringArray(source.countries),
    states: toStringArray(source.states),
    counties: toStringArray(source.counties),
    remote: remote.length > 0 ? remote : ["all"],
    hide_no_date: source.hide_no_date === true,
    sort_by: POSTING_SORT_VALUES.includes(String(source.sort_by ?? ""))
      ? String(source.sort_by)
      : DEFAULT_POSTINGS_FILTERS.sort_by
  };
}

export function normalizePersistedSearch(value) {
  return String(value ?? "");
}
