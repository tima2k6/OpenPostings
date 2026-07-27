const { decodeHtmlEntities, DEFAULT_BROWSER_USER_AGENT } = require("../../helpers/normalize-strings");
const { shouldStorePostingByDate, nowEpochSeconds } = require("../../helpers/normalize-numbers");
const { fetchWithAtsRateLimit } = require("../../services/queue");

const SNAPHUNT_RATE_LIMIT_WAIT_MS = 1000;
const SNAPHUNT_API_URL = "https://api.snaphunt.com/v2/jobs";
const SNAPHUNT_DEFAULT_PAGE_SIZE = 300;
const SNAPHUNT_ESTIMATED_COMPANY_COUNT = 10000;

function cleanSnaphuntText(value) {
  return decodeHtmlEntities(String(value || "").replace(/<[^>]+>/g, " "))
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toSnaphuntPositiveNumber(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return numeric;
}

function buildSnaphuntPhysicalLocation(locationEntries) {
  const labels = [];
  const seen = new Set();

  for (const entry of Array.isArray(locationEntries) ? locationEntries : []) {
    let label = "";
    if (typeof entry === "string") {
      label = cleanSnaphuntText(entry);
    } else if (entry && typeof entry === "object") {
      label =
        cleanSnaphuntText(entry?.name) ||
        cleanSnaphuntText(entry?.locationName) ||
        cleanSnaphuntText(entry?.formattedAddress);

      if (!label) {
        const parts = [
          cleanSnaphuntText(entry?.city),
          cleanSnaphuntText(entry?.state || entry?.province),
          cleanSnaphuntText(entry?.country),
          cleanSnaphuntText(entry?.postalCode)
        ].filter(Boolean);
        label = parts.join(", ");
      }
    }

    const normalized = label.toLowerCase();
    if (!label || seen.has(normalized)) continue;
    seen.add(normalized);
    labels.push(label);
  }

  return labels.join(" / ") || null;
}

function buildSnaphuntRemoteLocationSuffix(remoteLocation) {
  const remote = remoteLocation && typeof remoteLocation === "object" ? remoteLocation : {};
  const region = cleanSnaphuntText(remote?.region);
  const countries = Array.isArray(remote?.countries)
    ? remote.countries.map((country) => cleanSnaphuntText(country)).filter(Boolean)
    : [];

  if (region) return region;
  if (countries.length === 1) return countries[0];
  if (countries.length > 1) return countries.join(", ");
  return "";
}

function buildSnaphuntLocation(posting) {
  const jobLocationType = cleanSnaphuntText(posting?.jobLocationType).toLowerCase();
  const physicalLocation = buildSnaphuntPhysicalLocation(posting?.location);
  const remoteSuffix = buildSnaphuntRemoteLocationSuffix(posting?.remoteLocation);

  if (jobLocationType === "hybrid") {
    const hybridLabel = physicalLocation || remoteSuffix;
    return hybridLabel ? `Hybrid - ${hybridLabel}` : "Hybrid";
  }

  if (jobLocationType === "remote") {
    const remoteLabel = remoteSuffix || physicalLocation;
    return remoteLabel ? `Remote - ${remoteLabel}` : "Remote";
  }

  if (physicalLocation) return physicalLocation;
  if (remoteSuffix) return remoteSuffix;
  return null;
}

function buildSnaphuntJobPostingUrl(posting) {
  const jobReferenceId = cleanSnaphuntText(posting?.jobReferenceId);
  const company = posting?.company && typeof posting.company === "object" ? posting.company : {};
  const companySubdomain = cleanSnaphuntText(company?.subdomain);
  if (!jobReferenceId || !companySubdomain) return "";
  return `https://${encodeURIComponent(companySubdomain)}.snaphunt.com/job/${encodeURIComponent(jobReferenceId)}`;
}

function buildSnaphuntPayRaw(payMin, payMax, payCurrency, showSalary) {
  if (!showSalary) return null;
  if (!payMin && !payMax) return null;

  const currency = cleanSnaphuntText(payCurrency);
  const formattedMin = payMin ? String(payMin) : "";
  const formattedMax = payMax ? String(payMax) : "";

  if (formattedMin && formattedMax && formattedMin !== formattedMax) {
    return [currency, `${formattedMin} - ${formattedMax}`].filter(Boolean).join(" ").trim() || null;
  }

  const singleValue = formattedMax || formattedMin;
  if (!singleValue) return null;
  return [currency, singleValue].filter(Boolean).join(" ").trim() || null;
}

function parseSnaphuntPostingsFromPayload(payload) {
  const rows = Array.isArray(payload?.body?.list) ? payload.body.list : [];
  const postings = [];
  const seenUrls = new Set();

  for (const row of rows) {
    if (!row || typeof row !== "object") continue;

    const jobPostingUrl = buildSnaphuntJobPostingUrl(row);
    if (!jobPostingUrl || seenUrls.has(jobPostingUrl)) continue;

    const company = row?.company && typeof row.company === "object" ? row.company : {};
    const payMin = toSnaphuntPositiveNumber(row?.minSalary);
    const payMax = toSnaphuntPositiveNumber(row?.maxSalary);
    const payCurrency = payMin || payMax ? cleanSnaphuntText(row?.currency) || null : null;

    postings.push({
      company_name:
        cleanSnaphuntText(company?.companyName) ||
        cleanSnaphuntText(company?.subdomain) ||
        "Unknown Company",
      position_name: cleanSnaphuntText(row?.jobTitle) || "Untitled Position",
      job_posting_url: jobPostingUrl,
      posting_date: cleanSnaphuntText(row?.updatedAt) || null,
      location: buildSnaphuntLocation(row),
      job_description: cleanSnaphuntText(row?.jobDescription) || null,
      pay_min: payMin,
      pay_max: payMax,
      pay_currency: payCurrency,
      pay_raw: buildSnaphuntPayRaw(payMin, payMax, payCurrency, Boolean(row?.showSalary))
    });
    seenUrls.add(jobPostingUrl);
  }

  return postings;
}

async function fetchSnaphuntPayload(nextToken = "", pageSize = SNAPHUNT_DEFAULT_PAGE_SIZE) {
  const endpoint = new URL(SNAPHUNT_API_URL);
  endpoint.searchParams.set("jobLocationType", "onsite,hybrid,remote");
  endpoint.searchParams.set("pageSize", String(Math.max(1, Math.min(300, Number(pageSize) || SNAPHUNT_DEFAULT_PAGE_SIZE))));
  endpoint.searchParams.set("isFeatured", "false");
  if (nextToken) {
    endpoint.searchParams.set("next", nextToken);
  }

  const res = await fetchWithAtsRateLimit("snaphunt", SNAPHUNT_RATE_LIMIT_WAIT_MS, endpoint.toString(), {
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
    throw new Error(`Snaphunt request failed (${res.status}): ${body.slice(0, 180)}`);
  }

  return res.json();
}

// api.snaphunt.com no longer resolves and snaphunt.com carries no job board, so a bare
// "fetch failed" here reads as a transient network blip when it is really a dead source.
function describeSnaphuntFetchFailure(error) {
  const code = String(error?.cause?.code || "");
  if (code !== "ENOTFOUND" && code !== "EAI_AGAIN") return error;
  return new Error(
    `Snaphunt host ${new URL(SNAPHUNT_API_URL).hostname} does not resolve (${code}); ` +
      "the public Snaphunt job feed appears to have been retired."
  );
}

async function collectPostingsForSnaphuntDynamic(pageSize = SNAPHUNT_DEFAULT_PAGE_SIZE) {
  const postings = [];
  const seenUrls = new Set();
  const referenceEpoch = nowEpochSeconds();
  let nextToken = "";

  while (true) {
    let payload;
    try {
      payload = await fetchSnaphuntPayload(nextToken, pageSize);
    } catch (error) {
      throw describeSnaphuntFetchFailure(error);
    }
    const batch = parseSnaphuntPostingsFromPayload(payload);
    if (batch.length === 0) break;

    let hasPostingWithinFreshnessWindow = false;
    for (const posting of batch) {
      const postingUrl = String(posting?.job_posting_url || "").trim();
      if (!postingUrl || seenUrls.has(postingUrl)) continue;
      if (!shouldStorePostingByDate(posting?.posting_date, referenceEpoch)) continue;
      hasPostingWithinFreshnessWindow = true;
      postings.push(posting);
      seenUrls.add(postingUrl);
    }

    const meta = payload?.body?.meta && typeof payload.body.meta === "object" ? payload.body.meta : {};
    const hasNext = Boolean(meta?.hasNext);
    nextToken = cleanSnaphuntText(meta?.next) || "";

    if (!hasPostingWithinFreshnessWindow) break;
    if (!hasNext || !nextToken) break;
  }

  return postings;
}

module.exports = {
  collectPostingsForSnaphuntDynamic,
  parseSnaphuntPostingsFromPayload,
  describeSnaphuntFetchFailure,
  SNAPHUNT_ESTIMATED_COMPANY_COUNT
};
