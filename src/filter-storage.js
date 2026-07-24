import AsyncStorage from "@react-native-async-storage/async-storage";

import { normalizePersistedFilters, normalizePersistedSearch } from "./filter-normalize";

const STORAGE_KEY = "openpostings.postings-filters.v1";

export { DEFAULT_POSTINGS_FILTERS, normalizePersistedFilters } from "./filter-normalize";

export async function loadPersistedFilters() {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return {
      filters: normalizePersistedFilters(parsed?.filters),
      search: normalizePersistedSearch(parsed?.search)
    };
  } catch {
    // Unreadable or malformed: fall back to defaults rather than blocking startup.
    return null;
  }
}

export async function savePersistedFilters(filters, search) {
  try {
    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        filters: normalizePersistedFilters(filters),
        search: normalizePersistedSearch(search)
      })
    );
  } catch {
    // Persistence is a convenience; a failed write must not surface as an error.
  }
}

export async function clearPersistedFilters() {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing useful to do if the key cannot be removed.
  }
}
