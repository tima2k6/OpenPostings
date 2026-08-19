const { parseUrl, decodeHtmlEntities } = require("../../helpers/normalize-strings");
const { fetchWithAtsRateLimit } = require("../../services/queue");


const APPLITRACK_RATE_LIMIT_WAIT_MS = 60 * 1000;

function cleanApplitrackText(value) {
  return decodeHtmlEntities(String(value || "").replace(/<[^>]+>/g, " "))
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}


function normalizeApplitrackUrl(url) {
  const normalizedUrl = String(url || "").trim();
  if (!normalizedUrl) throw new Error("Applitrack URL is required");

  const parsed = parseUrl(normalizedUrl);
  if (!parsed || !parsed.protocol || !parsed.host) {
    throw new Error("Invalid Applitrack URL");
  }

  const host = String(parsed.hostname || "").toLowerCase();
  if (!host.endsWith(".applitrack.com")) {
    throw new Error(`Unexpected Applitrack host: ${parsed.host}`);
  }

  const base = `${parsed.protocol}//${parsed.host}`;
  const pathValue = String(parsed.pathname || "/");
  const rootPath = pathValue.endsWith("default.aspx")
    ? pathValue.slice(0, -1 * "default.aspx".length)
    : pathValue;
  const normalizedRootPath = rootPath.endsWith("/") ? rootPath : `${rootPath}/`;
  return `${base}${normalizedRootPath}`;
}

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractApplitrackPostingBlock(page, anchorIndex) {
  const startIndex = page.lastIndexOf("<ul class='postingsList'", anchorIndex);
  if (startIndex < 0) return "";
  const endIndex = page.indexOf("</ul>", anchorIndex);
  if (endIndex < 0 || endIndex <= startIndex) return "";
  return page.slice(startIndex, endIndex + "</ul>".length);
}

function extractApplitrackTitle(postingBlock) {
  const match = String(postingBlock || "").match(/<td[^>]*id=['"]wrapword['"][^>]*>([\s\S]*?)<\/td>/i);
  return cleanApplitrackText(match?.[1] || "");
}

function extractApplitrackLabeledValue(postingBlock, labelText) {
  if (!postingBlock || !labelText) return "";
  const pattern = new RegExp(
    `<span[^>]*class=['"]label['"][^>]*>\\s*${escapeRegex(labelText)}\\s*<\\/span>\\s*<br\\s*\\/?>\\s*(?:&nbsp;\\s*)*<span[^>]*class=['"]normal['"][^>]*>([\\s\\S]*?)<\\/span>`,
    "i"
  );
  const match = String(postingBlock).match(pattern);
  return cleanApplitrackText(match?.[1] || "");
}

function parseApplitrackPostings(outputHtml, siteRoot, companyName) {
  const page = String(outputHtml || "").replace(/\\'/g, "'");
  const postings = [];
  const seenIds = new Set();
  const applyPattern = /applyFor\(\s*'(?<job_id>\d+)'\s*,\s*'(?<category>[^']*)'\s*,\s*'(?<specialty>[^']*)'\s*\)/gi;
  let match = applyPattern.exec(page);

  while (match) {
    const groups = match.groups || {};
    const jobId = cleanApplitrackText(groups.job_id);
    if (!jobId || seenIds.has(jobId)) {
      match = applyPattern.exec(page);
      continue;
    }

    const category = cleanApplitrackText(groups.category);
    const specialty = cleanApplitrackText(groups.specialty);
    const postingBlock = extractApplitrackPostingBlock(page, match.index);
    const extractedTitle = extractApplitrackTitle(postingBlock);
    const title = extractedTitle || [category, specialty].filter(Boolean).join(" - ") || `Job ${jobId}`;
    const postingDate = extractApplitrackLabeledValue(postingBlock, "Date Posted:") || null;
    const location = extractApplitrackLabeledValue(postingBlock, "Location:") || null;
    const jobUrl = new URL(`default.aspx?JobID=${encodeURIComponent(jobId)}`, siteRoot).toString();

    postings.push({
      company_name: companyName,
      position_name: title,
      job_posting_url: jobUrl,
      posting_date: postingDate,
      location
    });
    seenIds.add(jobId);
    match = applyPattern.exec(page);
  }

  return postings;
}

async function collectPostingsForApplitrackCompany(company) {
  const siteRoot = normalizeApplitrackUrl(company?.url_string);
  const outputUrl = new URL("jobpostings/Output.asp?all=1", siteRoot).toString();
  const res = await fetchWithAtsRateLimit("applitrack", APPLITRACK_RATE_LIMIT_WAIT_MS, outputUrl, {
    method: "GET",
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9"
    }
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Applitrack request failed (${res.status}): ${body.slice(0, 180)}`);
  }

  const pageHtml = await res.text();
  const companyName = String(company?.company_name || "").trim() || "Unknown Company";
  return parseApplitrackPostings(pageHtml, siteRoot, companyName);
}

// Applitrack hosts every employer on the same domain and distinguishes them by the first
// path segment: www.applitrack.com/**aacs**/onlineapp/. Returning only siteRoot left
// extractSeededCompanyIdentifier (server/index.js) with nothing it recognises -- siteRoot is
// a URL-shaped field, so the identifier fell through to the URL itself and the suggested
// company name came out as "https://www.applitrack.com/aacs/onlineapp/". Whatever consumed
// that reduced it to the hostname's first label, which is why 1,323 distinct Applitrack
// employers were all stored as the company "www", sharing one bucket of 43,404 postings.
//
// companySlug is already a first-class key in that identifier's preferred list, so exposing
// the segment is all that is needed for the name to come out as the tenant.
function parseApplitrackCompanySource(urlString) {
  try {
    const siteRoot = normalizeApplitrackUrl(urlString);
    if (!siteRoot) return null;
    const companySlug = extractApplitrackCompanySlug(siteRoot);
    return companySlug ? { siteRoot, companySlug } : { siteRoot };
  } catch {
    return null;
  }
}

// The tenant is the first path segment. "onlineapp" is Applitrack's own directory, never an
// employer, so a URL that somehow starts there yields nothing rather than a wrong name.
function extractApplitrackCompanySlug(siteRootUrl) {
  const parsed = parseUrl(String(siteRootUrl || ""));
  if (!parsed) return "";
  const segments = String(parsed.pathname || "")
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);
  const slug = segments[0] || "";
  if (!slug || slug.toLowerCase() === "onlineapp") return "";
  return slug;
}

module.exports = { collectPostingsForApplitrackCompany, parseApplitrackCompanySource, extractApplitrackCompanySlug };
