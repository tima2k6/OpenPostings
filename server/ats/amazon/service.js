const { cleanHtmlText, DEFAULT_BROWSER_USER_AGENT } = require("../../helpers/normalize-strings");
const { nowEpochSeconds, shouldStorePostingByDate } = require("../../helpers/normalize-numbers");
const { fetchWithAtsRateLimit } = require("../../services/queue");

const AMAZON_RATE_LIMIT_WAIT_MS = 60 * 1000;
const AMAZON_BASE_ORIGIN = "https://www.amazon.jobs";
// The board's own UI asks for 10 rows a page; larger pages are accepted, but asking for
// more than a few hundred at a time is what gets a client throttled, so stay modest.
const AMAZON_RESULT_LIMIT = 100;
const MAX_PAGES_PER_SYNC = 30;
// amazon.jobs is a single board that carries every Amazon operating company -- Amazon.com
// Services, AWS, Audible, Whole Foods, Ring, Zappos and the rest -- and each row names its
// own entity in `company_name`. The estimate counts those entities rather than pretending
// the board aggregates unrelated employers the way GovernmentJobs or Hcareers do.
const AMAZON_ESTIMATED_COMPANY_COUNT = 25;

function cleanAmazonText(value) {
  return cleanHtmlText(value);
}

function firstNonEmptyAmazonValue(job, keys) {
  for (const key of keys) {
    const value = cleanAmazonText(job?.[key]);
    if (value) return value;
  }
  return "";
}

// Rows carry the detail page as `job_path` ("/en/jobs/10485204/certified-pharmacy-technician").
//
// The fallbacks below it are ordered by what the board actually serves. `id_icims` is the
// numeric job id, and /en/jobs/<id_icims> resolves on its own (verified 200 against the live
// board). `id` is a UUID -- "6df269ff-fb01-40a9-9381-6f2dd0a9493b" -- and pasting that after
// /en/ builds a 404, so it is only usable on the older payloads where it held a path like
// "jobs/2847362". Trying it first, as this did, would turn a row missing `job_path` into a
// stored posting whose link is dead rather than one that simply falls through to the id that
// works: a broken URL is worse than a dropped row, because ATS attribution and every "open
// this job" path downstream are derived from it.
const AMAZON_ID_PATH_PATTERN = /^\/?jobs\/[0-9]+/i;

function buildAmazonJobPostingUrl(job) {
  const jobPath = cleanAmazonText(job?.job_path);
  if (jobPath) return new URL(jobPath, `${AMAZON_BASE_ORIGIN}/`).toString();

  const icimsId = cleanAmazonText(job?.id_icims);
  if (icimsId) return `${AMAZON_BASE_ORIGIN}/en/jobs/${icimsId}`;

  const id = cleanAmazonText(job?.id);
  if (id && AMAZON_ID_PATH_PATTERN.test(id)) {
    return new URL(`/en/${id.replace(/^\/+/, "")}`, `${AMAZON_BASE_ORIGIN}/`).toString();
  }

  return "";
}

function buildAmazonLocation(job) {
  const normalized = firstNonEmptyAmazonValue(job, ["normalized_location", "location"]);
  if (normalized) return normalized;

  const parts = [cleanAmazonText(job?.city), cleanAmazonText(job?.state), cleanAmazonText(job?.country_code)];
  const location = parts.filter(Boolean).join(", ");
  return location || null;
}

// `posted_date` is an absolute day ("July 25, 2026") and is the field that means what the
// column means. `updated_time` is a relative age of the last *edit*, so it is only read
// when the posted date is missing -- otherwise a months-old job retouched this morning
// would look fresh and be stored.
function extractAmazonPostingDate(job) {
  const postedDate = firstNonEmptyAmazonValue(job, ["posted_date", "posted_at", "created_at"]);
  if (postedDate) return postedDate;
  return firstNonEmptyAmazonValue(job, ["updated_time"]) || null;
}

function buildAmazonJobDescription(job) {
  const description = firstNonEmptyAmazonValue(job, ["description_short", "description"]);
  if (!description) return null;

  const qualifications = [
    cleanAmazonText(job?.basic_qualifications),
    cleanAmazonText(job?.preferred_qualifications)
  ].filter(Boolean);

  return [description, ...qualifications].join("\n\n");
}

function parseAmazonPostingsFromPayload(payload) {
  if (!payload || typeof payload !== "object") return [];
  const jobs = Array.isArray(payload.jobs) ? payload.jobs : [];
  const postings = [];
  const seenUrls = new Set();

  for (const job of jobs) {
    if (!job || typeof job !== "object") continue;

    const jobPostingUrl = buildAmazonJobPostingUrl(job);
    if (!jobPostingUrl || seenUrls.has(jobPostingUrl)) continue;

    postings.push({
      company_name: firstNonEmptyAmazonValue(job, ["company_name"]) || "Amazon",
      position_name: firstNonEmptyAmazonValue(job, ["title"]) || "Untitled Position",
      job_posting_url: jobPostingUrl,
      posting_date: extractAmazonPostingDate(job),
      location: buildAmazonLocation(job),
      job_description: buildAmazonJobDescription(job)
    });
    seenUrls.add(jobPostingUrl);
  }

  return postings;
}

async function fetchAmazonSearchPage(offset, resultLimit = AMAZON_RESULT_LIMIT) {
  const requestUrl = new URL(`${AMAZON_BASE_ORIGIN}/en/search.json`);
  requestUrl.searchParams.set("base_query", "");
  requestUrl.searchParams.set("loc_query", "");
  requestUrl.searchParams.set("offset", String(offset));
  requestUrl.searchParams.set("result_limit", String(resultLimit));
  // Without "recent" the board answers by relevance, which for an empty query is an
  // arbitrary order -- paging it would never reach today's postings.
  requestUrl.searchParams.set("sort", "recent");

  const res = await fetchWithAtsRateLimit(
    "amazon",
    AMAZON_RATE_LIMIT_WAIT_MS,
    requestUrl.toString(),
    {
      method: "GET",
      headers: {
        Accept: "application/json, text/javascript, */*; q=0.01",
        "Accept-Language": "en-US,en;q=0.9",
        Referer: `${AMAZON_BASE_ORIGIN}/en/search`,
        "X-Requested-With": "XMLHttpRequest",
        "User-Agent": DEFAULT_BROWSER_USER_AGENT
      }
    }
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Amazon Jobs request failed (${res.status}): ${body.slice(0, 180)}`);
  }

  return res.json();
}

// Paging is newest-first, so a page that contributes nothing inside the freshness window
// means every later page is older still and the sweep can stop there rather than walking
// the board's ~30k open roles.
async function collectPostingsForAmazonDynamic() {
  const referenceEpoch = nowEpochSeconds();
  const seenUrls = new Set();
  const postings = [];

  for (let pageNo = 0; pageNo < MAX_PAGES_PER_SYNC; pageNo += 1) {
    const offset = pageNo * AMAZON_RESULT_LIMIT;
    const payload = await fetchAmazonSearchPage(offset);
    const batch = parseAmazonPostingsFromPayload(payload);
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

    const hits = Number(payload?.hits);
    if (Number.isFinite(hits) && offset + AMAZON_RESULT_LIMIT >= hits) break;
  }

  return postings;
}

module.exports = {
  collectPostingsForAmazonDynamic,
  parseAmazonPostingsFromPayload,
  buildAmazonJobPostingUrl,
  AMAZON_ESTIMATED_COMPANY_COUNT
};
