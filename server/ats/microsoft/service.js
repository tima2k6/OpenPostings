const { cleanHtmlText, DEFAULT_BROWSER_USER_AGENT } = require("../../helpers/normalize-strings");
const { nowEpochSeconds, shouldStorePostingByDate } = require("../../helpers/normalize-numbers");
const { fetchWithAtsRateLimit } = require("../../services/queue");

const MICROSOFT_RATE_LIMIT_WAIT_MS = 60 * 1000;
const MICROSOFT_BOARD_ORIGIN = "https://jobs.careers.microsoft.com";
// The board is a single-page app; this is the service its own search calls.
const MICROSOFT_SEARCH_ORIGIN = "https://gcsservices.careers.microsoft.com";
const MICROSOFT_PAGE_SIZE = 20;
const MAX_PAGES_PER_SYNC = 40;
// One board for Microsoft proper. The subsidiaries that recruit separately -- LinkedIn on
// its own site, GitHub on Greenhouse -- are not here, so this is a single employer rather
// than the dozens an aggregator would carry.
const MICROSOFT_ESTIMATED_COMPANY_COUNT = 1;

function cleanMicrosoftText(value) {
  return cleanHtmlText(value);
}

function firstNonEmptyMicrosoftValue(source, keys) {
  for (const key of keys) {
    const value = cleanMicrosoftText(source?.[key]);
    if (value) return value;
  }
  return "";
}

// Share links keep the title beside the id ("/job/1858732/Senior-Software-Engineer"), and
// the id alone resolves too. Build the titled form when there is a title so a stored row
// links the way the board's own copy button would.
function buildMicrosoftJobPostingUrl(jobId, title) {
  const id = cleanMicrosoftText(jobId);
  if (!id) return "";

  const slug = cleanMicrosoftText(title)
    .replace(/[^0-9A-Za-z]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug
    ? `${MICROSOFT_BOARD_ORIGIN}/global/en/job/${id}/${slug}`
    : `${MICROSOFT_BOARD_ORIGIN}/global/en/job/${id}`;
}

function buildMicrosoftLocation(properties) {
  const primary = firstNonEmptyMicrosoftValue(properties, ["primaryLocation", "location"]);
  if (primary) return primary;

  const locations = Array.isArray(properties?.locations) ? properties.locations : [];
  for (const entry of locations) {
    // Entries are plain strings today and were objects in an earlier revision.
    const value = typeof entry === "string" ? cleanMicrosoftText(entry) : firstNonEmptyMicrosoftValue(entry, ["name", "displayName"]);
    if (value) return value;
  }
  return null;
}

// The search rows carry a teaser rather than the full posting; the work-site flexibility
// line is kept beside it because on this board it is the only statement of whether a role
// can be worked remotely.
function buildMicrosoftJobDescription(properties) {
  const description = firstNonEmptyMicrosoftValue(properties, ["description", "shortDescription", "responsibilities"]);
  const flexibility = firstNonEmptyMicrosoftValue(properties, ["workSiteFlexibility"]);
  const parts = [description, flexibility ? `Work site flexibility: ${flexibility}` : ""].filter(Boolean);
  return parts.length > 0 ? parts.join("\n\n") : null;
}

function extractMicrosoftJobRows(payload) {
  if (!payload || typeof payload !== "object") return [];
  const result = payload?.operationResult?.result;
  if (Array.isArray(result?.jobs)) return result.jobs;
  if (Array.isArray(payload?.jobs)) return payload.jobs;
  return [];
}

function extractMicrosoftTotalJobs(payload) {
  const result = payload?.operationResult?.result;
  const total = Number(result?.totalJobs ?? payload?.totalJobs);
  return Number.isFinite(total) && total >= 0 ? total : null;
}

function parseMicrosoftPostingsFromPayload(payload) {
  const postings = [];
  const seenUrls = new Set();

  for (const job of extractMicrosoftJobRows(payload)) {
    if (!job || typeof job !== "object") continue;

    const properties = job?.properties && typeof job.properties === "object" ? job.properties : {};
    const positionName = firstNonEmptyMicrosoftValue(job, ["title"]) || "Untitled Position";
    const jobPostingUrl = buildMicrosoftJobPostingUrl(job?.jobId ?? job?.id, positionName);
    if (!jobPostingUrl || seenUrls.has(jobPostingUrl)) continue;

    postings.push({
      company_name: firstNonEmptyMicrosoftValue(properties, ["company"]) || "Microsoft",
      position_name: positionName,
      job_posting_url: jobPostingUrl,
      posting_date: firstNonEmptyMicrosoftValue(job, ["postingDate", "postedDate"]) || null,
      location: buildMicrosoftLocation(properties),
      job_description: buildMicrosoftJobDescription(properties)
    });
    seenUrls.add(jobPostingUrl);
  }

  return postings;
}

async function fetchMicrosoftSearchPage(pageNo, pageSize = MICROSOFT_PAGE_SIZE) {
  const requestUrl = new URL(`${MICROSOFT_SEARCH_ORIGIN}/search/api/v1/search`);
  requestUrl.searchParams.set("q", "");
  requestUrl.searchParams.set("l", "en_us");
  requestUrl.searchParams.set("pg", String(pageNo));
  requestUrl.searchParams.set("pgSz", String(pageSize));
  // Without "Recent" the board answers by relevance, which for an empty query is an
  // arbitrary order -- paging it would never reliably reach today's postings.
  requestUrl.searchParams.set("o", "Recent");
  requestUrl.searchParams.set("flt", "true");

  const res = await fetchWithAtsRateLimit(
    "microsoft",
    MICROSOFT_RATE_LIMIT_WAIT_MS,
    requestUrl.toString(),
    {
      method: "GET",
      headers: {
        Accept: "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
        Origin: MICROSOFT_BOARD_ORIGIN,
        Referer: `${MICROSOFT_BOARD_ORIGIN}/`,
        "User-Agent": DEFAULT_BROWSER_USER_AGENT
      }
    }
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Microsoft Careers request failed (${res.status}): ${body.slice(0, 180)}`);
  }

  return res.json();
}

// Paging is newest-first, so the first page with nothing inside the freshness window ends
// the sweep rather than walking the board's several thousand open roles.
async function collectPostingsForMicrosoftDynamic() {
  const referenceEpoch = nowEpochSeconds();
  const seenUrls = new Set();
  const postings = [];

  for (let pageNo = 1; pageNo <= MAX_PAGES_PER_SYNC; pageNo += 1) {
    const payload = await fetchMicrosoftSearchPage(pageNo);
    const batch = parseMicrosoftPostingsFromPayload(payload);
    if (batch.length === 0) break;

    let hasWithin24h = false;
    for (const posting of batch) {
      const postingUrl = String(posting?.job_posting_url || "").trim();
      if (!postingUrl || seenUrls.has(postingUrl)) continue;
      if (!shouldStorePostingByDate(posting?.posting_date, referenceEpoch)) continue;
      hasWithin24h = true;
      seenUrls.add(postingUrl);
      postings.push(posting);
    }

    if (!hasWithin24h) break;

    const totalJobs = extractMicrosoftTotalJobs(payload);
    if (totalJobs !== null && pageNo * MICROSOFT_PAGE_SIZE >= totalJobs) break;
  }

  return postings;
}

module.exports = {
  collectPostingsForMicrosoftDynamic,
  parseMicrosoftPostingsFromPayload,
  buildMicrosoftJobPostingUrl,
  MICROSOFT_ESTIMATED_COMPANY_COUNT
};
