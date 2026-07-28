const { parseUrl, decodeHtmlEntities, DEFAULT_BROWSER_USER_AGENT } = require("../../helpers/normalize-strings");
const { fetchWithAtsRateLimit } = require("../../services/queue");

const DOVER_RATE_LIMIT_WAIT_MS = 1000;

function cleanDoverText(value) {
  return decodeHtmlEntities(String(value || "").replace(/<[^>]+>/g, " "))
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseDoverCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;

  const host = String(parsed.hostname || "").toLowerCase();
  if (host !== "app.dover.com" && host !== "www.app.dover.com") return null;

  const pathParts = String(parsed.pathname || "")
    .split("/")
    .map((part) => String(part || "").trim())
    .filter(Boolean);
  if (pathParts.length < 2 || String(pathParts[0] || "").toLowerCase() !== "jobs") return null;

  const slug = String(pathParts[pathParts.length - 1] || "").trim();
  if (!slug) return null;

  return {
    host,
    slug,
    slugLower: slug.toLowerCase(),
    boardUrl: `${parsed.protocol}//${parsed.host}/jobs/${encodeURIComponent(slug)}`,
    clientApiUrl: `https://app.dover.com/api/v1/careers-page-slug/${encodeURIComponent(slug)}`
  };
}

// Dover's per-job page lives at /apply/<slug>/<jobId>/ -- the shape its own careers page
// links to. This used to build /jobs/<slug>/<jobId>, which Dover's client-side router
// does not serve: it renders "404 - Page Not Found" for every posting while still
// answering the HTTP request with 200 and the SPA shell, so nothing server-side noticed.
// Every Dover posting stored before this fix carries an unreachable URL and needs a
// re-sync (or the migration in scripts/fix-dover-urls.js) to become applyable.
function buildDoverJobPostingUrl(slug, jobId) {
  const cleanSlug = cleanDoverText(slug);
  const cleanJobId = cleanDoverText(jobId);
  if (!cleanSlug || !cleanJobId) return "";
  return `https://app.dover.com/apply/${encodeURIComponent(cleanSlug)}/${encodeURIComponent(cleanJobId)}/`;
}

function buildDoverLocationLabel(locations) {
  const labels = [];
  const seen = new Set();

  for (const location of Array.isArray(locations) ? locations : []) {
    if (!location || typeof location !== "object") continue;

    const locationType = cleanDoverText(location?.location_type);
    const locationOption = location?.location_option && typeof location.location_option === "object"
      ? location.location_option
      : {};
    const displayName = cleanDoverText(locationOption?.display_name) || cleanDoverText(location?.name);
    const label = [locationType, displayName].filter(Boolean).join(", ").trim();
    const normalized = label.toLowerCase();
    if (!label || seen.has(normalized)) continue;
    seen.add(normalized);
    labels.push(label);
  }

  return labels.join(" | ") || null;
}

function parseDoverPostingsFromPayload(companyNameForPostings, slug, jobGroupsPayload) {
  const groups = Array.isArray(jobGroupsPayload) ? jobGroupsPayload : [];
  const postings = [];
  const seenUrls = new Set();

  for (const group of groups) {
    if (!group || typeof group !== "object") continue;

    const departmentName = cleanDoverText(group?.name) || null;
    const jobs = Array.isArray(group?.jobs) ? group.jobs : [];
    for (const job of jobs) {
      if (!job || typeof job !== "object") continue;
      if (!Boolean(job?.is_published) || Boolean(job?.is_sample)) continue;

      const jobId = cleanDoverText(job?.id);
      const postingUrl = buildDoverJobPostingUrl(slug, jobId);
      if (!postingUrl || seenUrls.has(postingUrl)) continue;

      postings.push({
        company_name: companyNameForPostings,
        position_name: cleanDoverText(job?.title) || "Untitled Position",
        job_posting_url: postingUrl,
        posting_date: null,
        location: buildDoverLocationLabel(job?.locations),
        department: departmentName
      });
      seenUrls.add(postingUrl);
    }
  }

  return postings;
}

async function fetchDoverJson(rateLimitKey, url) {
  const res = await fetchWithAtsRateLimit(rateLimitKey, DOVER_RATE_LIMIT_WAIT_MS, url, {
    method: "GET",
    headers: {
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "en-US,en;q=0.9",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
      "User-Agent": DEFAULT_BROWSER_USER_AGENT
    }
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Dover request failed (${res.status}): ${body.slice(0, 180)}`);
  }

  return res.json();
}

async function collectPostingsForDoverCompany(company) {
  const config = parseDoverCompany(company?.url_string);
  if (!config) return [];

  const normalizedCompanyName = String(company?.company_name || "").trim();
  const clientPayload = await fetchDoverJson("dover", config.clientApiUrl);
  const clientId = cleanDoverText(clientPayload?.id);
  if (!clientId) return [];

  const jobsApiUrl = `https://app.dover.com/api/v1/job-groups/${encodeURIComponent(clientId)}/job-groups`;
  const jobGroupsPayload = await fetchDoverJson("dover", jobsApiUrl);
  const companyNameForPostings =
    normalizedCompanyName ||
    cleanDoverText(clientPayload?.name) ||
    config.slugLower;

  return parseDoverPostingsFromPayload(companyNameForPostings, config.slug, jobGroupsPayload);
}

module.exports = { collectPostingsForDoverCompany, parseDoverCompany };
