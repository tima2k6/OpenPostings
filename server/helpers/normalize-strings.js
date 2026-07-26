const POSTING_SORT_OPTIONS = new Set(["recent", "company_asc", "first_seen_desc"]);
const APPLICATION_STATUS_OPTIONS = new Set([
  "applied",
  "interview scheduled",
  "awaiting response",
  "offer received",
  "withdrawn",
  "denied"
]);
const DEFAULT_BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function parseUrl(urlString) {
  if (!urlString) return null;
  try {
    return new URL(urlString);
  } catch {
    return null;
  }
}

function parseCsvParam(value) {
  return String(value || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function parseJsonArray(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean);
  }
  try {
    const parsed = JSON.parse(String(value || "[]"));
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => String(item || "").trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeGeoText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || "").trim())
    .filter(Boolean);
}

function normalizeSourceUrlString(urlString) {
  const raw = String(urlString || "").trim();
  if (!raw) return "";
  const direct = parseUrl(raw);
  if (direct) return direct.toString();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) return "";
  const withScheme = parseUrl(`https://${raw}`);
  return withScheme ? withScheme.toString() : "";
}

function urljoin(baseUrl, urlPart) {
  const baseRaw = String(baseUrl || "").trim();
  const partRaw = String(urlPart || "").trim();
  if (!partRaw) return "";

  const direct = parseUrl(partRaw);
  if (direct) {
    const protocol = String(direct.protocol || "").toLowerCase();
    return protocol === "http:" || protocol === "https:" ? direct.toString() : "";
  }

  const baseNormalized = normalizeSourceUrlString(baseRaw);
  if (!baseNormalized) return "";

  try {
    const resolved = new URL(partRaw, baseNormalized);
    const protocol = String(resolved.protocol || "").toLowerCase();
    return protocol === "http:" || protocol === "https:" ? resolved.toString() : "";
  } catch {
    return "";
  }
}

function normalizeLikeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function toTitleCase(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&#(\d+);/g, (_match, codePoint) => String.fromCharCode(Number(codePoint)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, codePoint) => String.fromCharCode(parseInt(codePoint, 16)))
    .replace(/&quot;/g, "\"")
    .replace(/&#34;/g, "\"")
    .replace(/&#x22;/gi, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function cleanHtmlText(value) {
  return decodeHtmlEntities(String(value || "").replace(/<[^>]+>/g, " "))
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanText(value) {
  return decodeHtmlEntities(String(value || ""))
    .replace(/\u00a0/g, " ")
    .trim();
}

function toCleanString(value) {
  return cleanText(value);
}

function stripHtml(value) {
  return String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractCompanyNameFromUrlString(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  const normalizedUrl = normalizeSourceUrlString(raw);
  const parsed = parseUrl(normalizedUrl || raw);
  let host = String(parsed?.hostname || "").trim().toLowerCase();

  if (!host) {
    host = raw
      .toLowerCase()
      .replace(/^[a-z][a-z0-9+.-]*:\/\//i, "")
      .split(/[/?#:]/)[0]
      .trim();
  }
  if (!host) return "";

  const hostParts = host.split(".").map((part) => part.trim()).filter(Boolean);
  if (hostParts.length === 0) return "";

  let companyPart = hostParts[0];
  if (
    hostParts.length > 1 &&
    ["www", "jobs", "job", "careers", "career", "apply", "recruiting", "app", "openings"].includes(companyPart)
  ) {
    companyPart = hostParts[1];
  }

  return toCleanString(companyPart.replace(/[-_]+/g, " "));
}

function extractCookieHeaderFromResponse(response) {
  const setCookieValues =
    typeof response?.headers?.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : String(response?.headers?.get("set-cookie") || "")
          .split(/,(?=[^;]+=)/g)
          .map((item) => item.trim())
          .filter(Boolean);
  const cookiePairs = [];
  const seenNames = new Set();
  for (const rawCookie of setCookieValues) {
    const cookie = String(rawCookie || "").trim();
    if (!cookie) continue;
    const firstPart = cookie.split(";")[0]?.trim() || "";
    if (!firstPart || !firstPart.includes("=")) continue;
    const name = firstPart.split("=")[0]?.trim().toLowerCase();
    if (!name || seenNames.has(name)) continue;
    seenNames.add(name);
    cookiePairs.push(firstPart);
  }
  return cookiePairs.join("; ");
}

function decodeBase64Utf8(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    return Buffer.from(raw, "base64").toString("utf8");
  } catch {
    return "";
  }
}

function normalizeApplicationStatus(value) {
  const normalized = normalizeLikeText(value);
  if (APPLICATION_STATUS_OPTIONS.has(normalized)) {
    return normalized;
  }
  return "applied";
}

function normalizeAppliedByType(value) {
  const normalized = normalizeLikeText(value);
  if (normalized === "ai" || normalized === "agent") return normalized;
  return "manual";
}

function normalizeAppliedByLabel(value, appliedByType = "manual") {
  const explicit = String(value || "").trim();
  if (explicit) return explicit;
  if (appliedByType === "ai" || appliedByType === "agent") {
    return "AI agent applied on behalf of user";
  }
  return "Manually applied by user";
}

function normalizeIgnoredByLabel(value) {
  const explicit = String(value || "").trim();
  if (explicit) return explicit;
  return "Ignored by user";
}

function normalizePostingSort(value) {
  const normalized = normalizeLikeText(value);
  if (normalized === "company_asc" || normalized === "alphabetical") {
    return "company_asc";
  }
  if (POSTING_SORT_OPTIONS.has(normalized)) {
    return normalized;
  }
  return "recent";
}


module.exports = { parseUrl, parseCsvParam, parseJsonArray, escapeRegExp, normalizeGeoText, normalizeStringArray, normalizeSourceUrlString, urljoin, normalizeLikeText, toTitleCase, decodeHtmlEntities, cleanHtmlText, cleanText, toCleanString, stripHtml, extractCompanyNameFromUrlString, extractCookieHeaderFromResponse, decodeBase64Utf8, normalizeApplicationStatus, normalizeAppliedByType, normalizeAppliedByLabel, normalizeIgnoredByLabel, normalizePostingSort, APPLICATION_STATUS_OPTIONS, DEFAULT_BROWSER_USER_AGENT };
