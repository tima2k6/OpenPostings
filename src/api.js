import { Platform } from "react-native";

const DEFAULT_API_BASE_URL =
  Platform.OS === "android" ? "http://127.0.0.1:8787" : "http://localhost:8787";

const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL || DEFAULT_API_BASE_URL;
const IS_ANDROID_LOCAL_BACKEND =
  Platform.OS === "android" &&
  (API_BASE_URL.startsWith("http://127.0.0.1:") || API_BASE_URL.startsWith("http://localhost:"));
// Android first launch can take longer while nodejs assets are copied.
const ANDROID_LOCAL_BACKEND_RETRY_DELAYS_MS = [500, 1000, 1500, 2000, 2500, 3000, 4000, 5000, 6000, 8000, 10000];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientAndroidLocalBackendError(errorValue) {
  const message = String(errorValue?.message || errorValue || "").toLowerCase();
  if (!message) return false;
  return (
    message.includes("network request failed") ||
    message.includes("failed to fetch") ||
    message.includes("connection refused") ||
    message.includes("timed out")
  );
}

// Without this, a request that hangs never settles: the caller sits on the promise, its
// catch never runs, and the page renders with no data and no error -- indistinguishable
// from "there are no postings". The API is single-threaded on one SQLite connection that
// it shares with the sync, so a stall is a realistic state, not a hypothetical one. The
// window is deliberately generous: a slow response is still worth waiting for, and the
// point is to eventually say something rather than to fail fast.
const REQUEST_TIMEOUT_MS = 30000;

// The browser deliberately refuses to distinguish a refused connection from a blocked
// CORS response -- both surface as an opaque TypeError -- so this cannot claim which one
// happened. It reports what is actually known, and names the address being called, which
// is the thing most often wrong when the app is opened from a different host.
function describeRequestError(errorValue, url) {
  if (errorValue?.name === "AbortError") {
    return new Error(
      `Request to ${url} timed out after ${Math.round(REQUEST_TIMEOUT_MS / 1000)}s. ` +
        "The API may be busy (a sync competes with it for the same database connection)."
    );
  }

  const message = String(errorValue?.message || errorValue || "");
  const looksUnreachable =
    errorValue instanceof TypeError ||
    /failed to fetch|network request failed|load failed/i.test(message);

  if (looksUnreachable) {
    return new Error(
      `Could not reach the API at ${url}. It may be down, or unreachable from this device.`
    );
  }

  return errorValue;
}

async function request(path, options = {}) {
  const url = `${API_BASE_URL}${path}`;
  const requestOptions = {
    headers: { "Content-Type": "application/json" },
    ...options
  };
  let lastError;

  for (let attempt = 0; attempt <= ANDROID_LOCAL_BACKEND_RETRY_DELAYS_MS.length; attempt += 1) {
    // A controller cannot be reused once aborted, so each attempt gets its own.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, { ...requestOptions, signal: controller.signal });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status}: ${text}`);
      }

      return await res.json();
    } catch (errorValue) {
      const described = describeRequestError(errorValue, url);
      lastError = described;
      const shouldRetry =
        IS_ANDROID_LOCAL_BACKEND &&
        attempt < ANDROID_LOCAL_BACKEND_RETRY_DELAYS_MS.length &&
        isTransientAndroidLocalBackendError(described);

      if (!shouldRetry) {
        throw described;
      }

      await sleep(ANDROID_LOCAL_BACKEND_RETRY_DELAYS_MS[attempt]);
    } finally {
      // Always cleared: leaving it pending would abort a later, unrelated request on a
      // reused controller, and keeps a timer alive for every request the app makes.
      clearTimeout(timeoutId);
    }
  }

  throw lastError || new Error("Request failed.");
}

export function fetchPostings(search = "", limit = 500, offset = 0, filters = {}) {
  const params = new URLSearchParams({
    search,
    limit: String(limit),
    offset: String(offset),
    _ts: String(Date.now()),
    include_applied: filters?.include_applied === undefined ? "0" : filters?.include_applied ? "1" : "0",
    include_ignored: filters?.include_ignored === undefined ? "0" : filters?.include_ignored ? "1" : "0"
  });

  const atsArray = Array.isArray(filters?.ats) ? filters.ats.filter(Boolean) : [];
  const atsSingle = !Array.isArray(filters?.ats) ? String(filters?.ats || "").trim().toLowerCase() : "";
  const industries = Array.isArray(filters?.industries) ? filters.industries.filter(Boolean) : [];
  const compensationTypes = Array.isArray(filters?.compensation_types)
    ? filters.compensation_types.filter(Boolean)
    : [];
  const payPeriods = Array.isArray(filters?.pay_periods) ? filters.pay_periods.filter(Boolean) : [];
  const payMin = String(filters?.pay_min ?? "").trim();
  const payMax = String(filters?.pay_max ?? "").trim();
  const educationLevels = Array.isArray(filters?.education_levels) ? filters.education_levels.filter(Boolean) : [];
  const states = Array.isArray(filters?.states) ? filters.states.filter(Boolean) : [];
  const counties = Array.isArray(filters?.counties) ? filters.counties.filter(Boolean) : [];
  const countries = Array.isArray(filters?.countries) ? filters.countries.filter(Boolean) : [];
  const regions = Array.isArray(filters?.regions) ? filters.regions.filter(Boolean) : [];
  const remoteValues = Array.isArray(filters?.remote)
    ? filters.remote
        .map((value) => String(value || "").trim().toLowerCase())
        .filter(Boolean)
    : String(filters?.remote || "all")
        .split(",")
        .map((value) => String(value || "").trim().toLowerCase())
        .filter(Boolean);

  if (atsArray.length > 0) {
    params.set("ats", atsArray.join(","));
  } else if (atsSingle && atsSingle !== "all") {
    params.set("ats", atsSingle);
  }
  if (industries.length > 0) {
    params.set("industries", industries.join(","));
  }
  if (compensationTypes.length > 0) {
    params.set("compensation_types", compensationTypes.join(","));
  }
  if (payPeriods.length > 0) {
    params.set("pay_periods", payPeriods.join(","));
  }
  if (payMin) {
    params.set("pay_min", payMin);
  }
  if (payMax) {
    params.set("pay_max", payMax);
  }
  if (educationLevels.length > 0) {
    params.set("education_levels", educationLevels.join(","));
  }
  if (states.length > 0) {
    params.set("states", states.join(","));
  }
  if (counties.length > 0) {
    params.set("counties", counties.join(","));
  }
  if (countries.length > 0) {
    params.set("countries", countries.join(","));
  }
  if (regions.length > 0) {
    params.set("regions", regions.join(","));
  }
  const normalizedRemoteValues = Array.from(new Set(remoteValues));
  if (normalizedRemoteValues.length > 0 && !normalizedRemoteValues.includes("all")) {
    params.set("remote", normalizedRemoteValues.join(","));
  }
  if (filters?.hide_no_date) {
    params.set("hide_no_date", "1");
  }
  if (filters?.sort_by) {
    params.set("sort_by", String(filters.sort_by));
  }
  // Descriptions dominate the response size, and the listing has a toggle that hides them.
  // When it is off there is no reason to ship them.
  if (filters?.include_descriptions === false) {
    params.set("include_descriptions", "0");
  }

  return request(`/postings?${params.toString()}`);
}

export function fetchPostingFilterOptions() {
  return request("/postings/filter-options");
}

export function fetchApplications(limit = 500, offset = 0, status = "") {
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
    _ts: String(Date.now())
  });
  if (String(status || "").trim()) {
    params.set("status", String(status).trim());
  }
  return request(`/applications?${params.toString()}`);
}

export function createApplication(payload) {
  return request("/applications", {
    method: "POST",
    body: JSON.stringify(payload || {})
  });
}

export function ignorePosting(payload) {
  return request("/postings/ignore", {
    method: "POST",
    body: JSON.stringify(payload || {})
  });
}

export function updateApplicationStatus(applicationId, status) {
  return request(`/applications/${applicationId}`, {
    method: "PATCH",
    body: JSON.stringify({ status })
  });
}

export function deleteApplication(applicationId) {
  return request(`/applications/${applicationId}`, {
    method: "DELETE"
  });
}

export function fetchSyncStatus() {
  return request(`/sync/status?_ts=${Date.now()}`);
}

export function triggerAtsSync(wait = false) {
  const suffix = wait ? "?wait=1" : "";
  return request(`/sync/ats${suffix}`, { method: "POST" });
}

export function triggerWorkdaySync(wait = false) {
  return triggerAtsSync(wait);
}

export function fetchCodeStatus() {
  return request(`/system/code-status?_ts=${Date.now()}`);
}

export function restartServer() {
  return request("/system/restart", { method: "POST" });
}

export function fetchPersonalInformation() {
  return request("/settings/personal-information");
}

export function savePersonalInformation(payload) {
  return request("/settings/personal-information", {
    method: "PUT",
    body: JSON.stringify(payload || {})
  });
}

export function fetchMcpSettings() {
  return request("/settings/mcp");
}

export function saveMcpSettings(payload) {
  return request("/settings/mcp", {
    method: "PUT",
    body: JSON.stringify(payload || {})
  });
}

export function fetchSyncServiceSettings() {
  return request("/settings/sync");
}

export function saveSyncServiceSettings(payload) {
  return request("/settings/sync", {
    method: "PUT",
    body: JSON.stringify(payload || {})
  });
}

export function fetchBlockedCompanies() {
  return request("/settings/sync/blocked-companies");
}

export function blockCompany(payload) {
  return request("/settings/sync/blocked-companies", {
    method: "POST",
    body: JSON.stringify(payload || {})
  });
}

export function unblockCompany(payload) {
  return request("/settings/sync/blocked-companies/unblock", {
    method: "POST",
    body: JSON.stringify(payload || {})
  });
}

export function migrateDatabaseSettings(payload) {
  return request("/settings/migrate-db", {
    method: "POST",
    body: JSON.stringify(payload || {})
  });
}

export function fetchSettingsExport(options = {}) {
  const includeMcp = options?.include_mcp !== false;
  const suffix = includeMcp ? "?include_mcp=1" : "?include_mcp=0";
  return request(`/settings/export${suffix}`);
}

export function fetchMcpCandidates(filters = {}) {
  const params = new URLSearchParams();
  const limit = Number(filters?.limit || 0);

  if (filters?.search) params.set("search", String(filters.search).trim());
  if (Array.isArray(filters?.ats) && filters.ats.length > 0) {
    params.set("ats", filters.ats.filter(Boolean).join(","));
  } else if (filters?.ats && String(filters.ats).trim().toLowerCase() !== "all") {
    params.set("ats", String(filters.ats).trim().toLowerCase());
  }
  if (Array.isArray(filters?.industries) && filters.industries.length > 0) {
    params.set("industries", filters.industries.filter(Boolean).join(","));
  }
  if (Array.isArray(filters?.compensation_types) && filters.compensation_types.length > 0) {
    params.set("compensation_types", filters.compensation_types.filter(Boolean).join(","));
  }
  if (Array.isArray(filters?.pay_periods) && filters.pay_periods.length > 0) {
    params.set("pay_periods", filters.pay_periods.filter(Boolean).join(","));
  }
  if (String(filters?.pay_min ?? "").trim()) {
    params.set("pay_min", String(filters.pay_min).trim());
  }
  if (String(filters?.pay_max ?? "").trim()) {
    params.set("pay_max", String(filters.pay_max).trim());
  }
  if (Array.isArray(filters?.education_levels) && filters.education_levels.length > 0) {
    params.set("education_levels", filters.education_levels.filter(Boolean).join(","));
  }
  if (Array.isArray(filters?.states) && filters.states.length > 0) {
    params.set("states", filters.states.filter(Boolean).join(","));
  }
  if (Array.isArray(filters?.counties) && filters.counties.length > 0) {
    params.set("counties", filters.counties.filter(Boolean).join(","));
  }
  if (Array.isArray(filters?.countries) && filters.countries.length > 0) {
    params.set("countries", filters.countries.filter(Boolean).join(","));
  }
  if (Array.isArray(filters?.regions) && filters.regions.length > 0) {
    params.set("regions", filters.regions.filter(Boolean).join(","));
  }
  if (filters?.remote) params.set("remote", String(filters.remote));
  if (filters?.include_applied !== undefined) {
    params.set("include_applied", filters.include_applied ? "1" : "0");
  }
  if (filters?.use_settings !== undefined) {
    params.set("use_settings", filters.use_settings ? "1" : "0");
  }
  if (Number.isFinite(limit) && limit > 0) {
    params.set("limit", String(limit));
  }

  const suffix = params.toString() ? `?${params.toString()}` : "";
  return request(`/mcp/candidates${suffix}`);
}

export function fetchMcpCoverLetterDraft(payload) {
  return request("/mcp/cover-letter-draft", {
    method: "POST",
    body: JSON.stringify(payload || {})
  });
}

export function completeMcpApplication(payload) {
  return request("/mcp/applications/complete", {
    method: "POST",
    body: JSON.stringify(payload || {})
  });
}

export async function postFrontendLog(payload) {
  try {
    return await request("/frontend/log", {
      method: "POST",
      body: JSON.stringify(payload || {})
    });
  } catch {
    return { ok: false };
  }
}

export { API_BASE_URL };
