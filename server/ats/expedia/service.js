const { cleanHtmlText, decodeHtmlEntities, DEFAULT_BROWSER_USER_AGENT } = require("../../helpers/normalize-strings");
const {
  nowEpochSeconds,
  shouldStorePostingByDate,
  parsePostingDateToEpochSeconds
} = require("../../helpers/normalize-numbers");
const { normalizeCompensationPayPeriod, normalizeCompensationCurrencyCode } = require("../../helpers/description-filters");
const { fetchWithAtsRateLimit } = require("../../services/queue");

const EXPEDIA_RATE_LIMIT_WAIT_MS = 60 * 1000;
const EXPEDIA_BASE_ORIGIN = "https://careers.expediagroup.com";
const EXPEDIA_ROBOTS_URL = `${EXPEDIA_BASE_ORIGIN}/robots.txt`;
const EXPEDIA_FALLBACK_SITEMAP_URL = `${EXPEDIA_BASE_ORIGIN}/sitemap.xml`;
const MAX_SITEMAPS_PER_SYNC = 12;
// Every candidate costs one detail fetch, so the sweep is capped even if the board
// republishes its whole sitemap with a fresh lastmod.
const MAX_JOB_PAGES_PER_SYNC = 200;
// Expedia Group posts for its brands -- Expedia, Vrbo, Hotels.com, Egencia, Expedia
// Partner Solutions and the rest -- under one careers site, which is what the estimate
// counts. Nothing here aggregates outside employers.
const EXPEDIA_ESTIMATED_COMPANY_COUNT = 8;

// The careers site is a marketing front end whose search endpoint is a vendor-private URL
// that changes whenever the vendor does. The sitemap and the schema.org JobPosting block
// on each detail page are not: Google for Jobs requires both, so they are the stable
// contract to read the board through.
function parseSitemapUrlsFromRobotsTxt(robotsText, baseOrigin = EXPEDIA_BASE_ORIGIN) {
  const urls = [];
  const seen = new Set();
  const expectedHost = new URL(baseOrigin).host.toLowerCase();

  for (const line of String(robotsText || "").split(/\r?\n/)) {
    const match = line.match(/^\s*sitemap\s*:\s*(\S+)\s*$/i);
    if (!match?.[1]) continue;

    let resolved = "";
    try {
      resolved = new URL(match[1], `${baseOrigin}/`).toString();
    } catch {
      continue;
    }
    // A robots file may advertise sitemaps on other hosts; following those would take the
    // collector off the board it is meant to sweep.
    if (new URL(resolved).host.toLowerCase() !== expectedHost) continue;
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    urls.push(resolved);
  }

  return urls;
}

function parseSitemapEntries(xml) {
  const source = String(xml || "");
  const isIndex = /<sitemapindex[\s>]/i.test(source);
  const entries = [];

  const blockPattern = /<(url|sitemap)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let blockMatch = blockPattern.exec(source);
  while (blockMatch) {
    const block = blockMatch[2] || "";
    const loc = decodeHtmlEntities(String(block.match(/<loc>([\s\S]*?)<\/loc>/i)?.[1] || "").trim());
    if (loc) {
      const lastmod = decodeHtmlEntities(String(block.match(/<lastmod>([\s\S]*?)<\/lastmod>/i)?.[1] || "").trim());
      entries.push({ loc, lastmod: lastmod || null });
    }
    blockMatch = blockPattern.exec(source);
  }

  return { is_index: isIndex, entries };
}

// Detail pages sit under /job/<title>/<location>/<requisition-id>/, while /jobs/ and its
// facet pages are the search UI. Anything with no segment past the /job(s)/ prefix, or
// whose first segment names a listing view, is not a posting.
function isExpediaJobUrl(value) {
  const url = String(value || "").trim();
  if (!url) return false;

  let parsed = null;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.host.toLowerCase() !== new URL(EXPEDIA_BASE_ORIGIN).host.toLowerCase()) return false;

  const remainder = parsed.pathname.replace(/\/+$/, "").match(/^\/jobs?\/(.+)$/i)?.[1] || "";
  if (!remainder) return false;
  return !/^(search|results|browse|all|categor(?:y|ies)|locations?|teams?)(\/|$)/i.test(remainder);
}

// Job detail pages are only worth fetching when the sitemap says the page changed inside
// the freshness window. Entries the board leaves undated sort last and are only reached
// when the cap has room, so an undated sitemap degrades to a bounded sweep instead of
// either a full crawl or nothing at all.
function selectExpediaJobCandidates(entries, referenceEpoch = nowEpochSeconds(), limit = MAX_JOB_PAGES_PER_SYNC) {
  const seen = new Set();
  const dated = [];
  const undated = [];

  for (const entry of Array.isArray(entries) ? entries : []) {
    const loc = String(entry?.loc || "").trim();
    if (!isExpediaJobUrl(loc) || seen.has(loc)) continue;
    seen.add(loc);

    const lastmod = String(entry?.lastmod || "").trim();
    if (!lastmod) {
      undated.push({ loc, lastmod_epoch: null });
      continue;
    }
    if (!shouldStorePostingByDate(lastmod, referenceEpoch)) continue;
    dated.push({ loc, lastmod_epoch: parsePostingDateToEpochSeconds(lastmod, referenceEpoch) || 0 });
  }

  dated.sort((a, b) => b.lastmod_epoch - a.lastmod_epoch);
  return [...dated, ...undated].slice(0, Math.max(0, limit)).map((candidate) => candidate.loc);
}

function extractJsonLdObjects(html) {
  const source = String(html || "");
  const objects = [];
  const scriptPattern = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

  let scriptMatch = scriptPattern.exec(source);
  while (scriptMatch) {
    const raw = decodeHtmlEntities(String(scriptMatch[1] || "").trim());
    if (raw) {
      let parsed = null;
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = null;
      }
      // A block may be a bare object, a list of them, or a @graph wrapper; flatten all
      // three so the JobPosting is found wherever the page keeps it.
      const queue = [parsed];
      while (queue.length > 0) {
        const current = queue.shift();
        if (!current) continue;
        if (Array.isArray(current)) {
          queue.push(...current);
          continue;
        }
        if (typeof current !== "object") continue;
        objects.push(current);
        if (Array.isArray(current["@graph"])) queue.push(...current["@graph"]);
      }
    }
    scriptMatch = scriptPattern.exec(source);
  }

  return objects;
}

function isJobPostingObject(value) {
  const type = value?.["@type"];
  if (Array.isArray(type)) return type.some((item) => String(item || "").toLowerCase() === "jobposting");
  return String(type || "").toLowerCase() === "jobposting";
}

function extractSchemaOrgName(value) {
  if (!value) return "";
  if (typeof value === "string") return cleanHtmlText(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const name = extractSchemaOrgName(item);
      if (name) return name;
    }
    return "";
  }
  return cleanHtmlText(value?.name);
}

function buildExpediaLocation(jobPosting) {
  const locations = Array.isArray(jobPosting?.jobLocation) ? jobPosting.jobLocation : [jobPosting?.jobLocation];
  for (const location of locations) {
    const address = location?.address;
    if (!address) continue;
    if (typeof address === "string") {
      const value = cleanHtmlText(address);
      if (value) return value;
      continue;
    }

    const parts = [
      cleanHtmlText(address?.addressLocality),
      cleanHtmlText(address?.addressRegion),
      extractSchemaOrgName(address?.addressCountry) || cleanHtmlText(address?.addressCountry)
    ].filter(Boolean);
    if (parts.length > 0) return parts.join(", ");
  }

  const locationType = String(jobPosting?.jobLocationType || "").trim().toUpperCase();
  if (locationType === "TELECOMMUTE") return "Remote";
  return null;
}

function toPositiveNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function extractExpediaCompensation(jobPosting) {
  const empty = {
    compensation_type: "unknown",
    pay_min: null,
    pay_max: null,
    pay_currency: null,
    pay_period: null,
    pay_raw: null
  };

  const baseSalary = jobPosting?.baseSalary;
  if (!baseSalary || typeof baseSalary !== "object") return empty;

  const amount = baseSalary?.value && typeof baseSalary.value === "object" ? baseSalary.value : baseSalary;
  const exact = toPositiveNumber(amount?.value);
  const payMin = toPositiveNumber(amount?.minValue) ?? exact;
  const payMax = toPositiveNumber(amount?.maxValue) ?? exact;
  if (!payMin && !payMax) return empty;

  const payPeriod = normalizeCompensationPayPeriod(String(amount?.unitText || "").toLowerCase());
  const payCurrency = normalizeCompensationCurrencyCode(baseSalary?.currency || amount?.currency);

  const rangeLabel = payMin && payMax && payMin !== payMax
    ? `${payMin} - ${payMax}`
    : String(payMin || payMax);
  const payRaw = [payCurrency, rangeLabel, payPeriod ? `per ${payPeriod}` : ""]
    .filter(Boolean)
    .join(" ")
    .trim();

  let compensationType = "unknown";
  if (payPeriod === "hour") compensationType = "hourly";
  else if (payPeriod) compensationType = "salary";

  return {
    compensation_type: compensationType,
    pay_min: payMin,
    pay_max: payMax,
    pay_currency: payCurrency || null,
    pay_period: payPeriod || null,
    pay_raw: payRaw || null
  };
}

function parseExpediaJobPostingFromHtml(html, pageUrl) {
  const jobPosting = extractJsonLdObjects(html).find((object) => isJobPostingObject(object));
  if (!jobPosting) return null;

  const jobPostingUrl = String(cleanHtmlText(jobPosting?.url) || pageUrl || "").trim();
  if (!jobPostingUrl) return null;

  const compensation = extractExpediaCompensation(jobPosting);
  const description = cleanHtmlText(jobPosting?.description) || null;

  return {
    company_name: extractSchemaOrgName(jobPosting?.hiringOrganization) || "Expedia Group",
    position_name: cleanHtmlText(jobPosting?.title) || "Untitled Position",
    job_posting_url: jobPostingUrl,
    posting_date: cleanHtmlText(jobPosting?.datePosted) || null,
    location: buildExpediaLocation(jobPosting),
    job_description: description,
    compensation_type: compensation.compensation_type,
    pay_min: compensation.pay_min,
    pay_max: compensation.pay_max,
    pay_currency: compensation.pay_currency,
    pay_period: compensation.pay_period,
    pay_raw: compensation.pay_raw
  };
}

async function fetchExpediaText(rateLimitKey, url, accept) {
  const res = await fetchWithAtsRateLimit("expedia", EXPEDIA_RATE_LIMIT_WAIT_MS, url, {
    method: "GET",
    headers: {
      Accept: accept,
      "Accept-Language": "en-US,en;q=0.9",
      Referer: `${EXPEDIA_BASE_ORIGIN}/`,
      "User-Agent": DEFAULT_BROWSER_USER_AGENT
    }
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Expedia ${rateLimitKey} request failed (${res.status}): ${body.slice(0, 180)}`);
  }

  return res.text();
}

async function discoverExpediaSitemapUrls() {
  let robotsText = "";
  try {
    robotsText = await fetchExpediaText("robots", EXPEDIA_ROBOTS_URL, "text/plain,*/*");
  } catch {
    // A missing or blocked robots.txt only costs the discovery shortcut; the conventional
    // sitemap location still has to be tried before the sweep can be called a failure.
    robotsText = "";
  }

  const advertised = parseSitemapUrlsFromRobotsTxt(robotsText);
  return advertised.length > 0 ? advertised : [EXPEDIA_FALLBACK_SITEMAP_URL];
}

// Sitemap indexes point at child sitemaps; job URLs live one level down. Children whose
// own lastmod is outside the window are skipped, and job-named children are preferred so
// the per-sync sitemap budget is not spent on the site's marketing pages.
async function collectExpediaSitemapEntries(referenceEpoch) {
  const pending = await discoverExpediaSitemapUrls();
  const visited = new Set();
  const entries = [];
  let fetchedSitemaps = 0;

  while (pending.length > 0 && fetchedSitemaps < MAX_SITEMAPS_PER_SYNC) {
    const sitemapUrl = pending.shift();
    if (!sitemapUrl || visited.has(sitemapUrl)) continue;
    visited.add(sitemapUrl);

    let xml = "";
    try {
      xml = await fetchExpediaText("sitemap", sitemapUrl, "application/xml,text/xml,*/*");
    } catch {
      continue;
    }
    fetchedSitemaps += 1;

    const parsed = parseSitemapEntries(xml);
    if (!parsed.is_index) {
      entries.push(...parsed.entries);
      continue;
    }

    const children = parsed.entries.filter(
      (entry) => !entry.lastmod || shouldStorePostingByDate(entry.lastmod, referenceEpoch)
    );
    const jobChildren = children.filter((entry) => /job/i.test(String(entry.loc || "")));
    for (const child of jobChildren.length > 0 ? jobChildren : children) {
      if (!visited.has(child.loc)) pending.push(child.loc);
    }
  }

  return entries;
}

async function collectPostingsForExpediaDynamic() {
  const referenceEpoch = nowEpochSeconds();
  const sitemapEntries = await collectExpediaSitemapEntries(referenceEpoch);
  const candidateUrls = selectExpediaJobCandidates(sitemapEntries, referenceEpoch);

  const seenUrls = new Set();
  const postings = [];

  for (const candidateUrl of candidateUrls) {
    let html = "";
    try {
      html = await fetchExpediaText("job", candidateUrl, "text/html,application/xhtml+xml");
    } catch {
      // One unreachable detail page should not abandon the rest of the sweep.
      continue;
    }

    const posting = parseExpediaJobPostingFromHtml(html, candidateUrl);
    if (!posting) continue;

    const postingUrl = String(posting?.job_posting_url || "").trim();
    if (!postingUrl || seenUrls.has(postingUrl)) continue;
    if (!shouldStorePostingByDate(posting?.posting_date, referenceEpoch)) continue;

    seenUrls.add(postingUrl);
    postings.push(posting);
  }

  return postings;
}

module.exports = {
  collectPostingsForExpediaDynamic,
  parseSitemapUrlsFromRobotsTxt,
  parseSitemapEntries,
  selectExpediaJobCandidates,
  parseExpediaJobPostingFromHtml,
  isExpediaJobUrl,
  EXPEDIA_ESTIMATED_COMPANY_COUNT
};
