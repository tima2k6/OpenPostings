const { cleanHtmlText, decodeHtmlEntities, DEFAULT_BROWSER_USER_AGENT } = require("../../helpers/normalize-strings");
const {
  nowEpochSeconds,
  shouldStorePostingByDate,
  parsePostingDateToEpochSeconds
} = require("../../helpers/normalize-numbers");
const { normalizeCompensationPayPeriod, normalizeCompensationCurrencyCode } = require("../../helpers/description-filters");
const { fetchWithAtsRateLimit } = require("../../services/queue");

const CAREER_SITE_RATE_LIMIT_WAIT_MS = 60 * 1000;
const MAX_SITEMAPS_PER_SYNC = 12;
// Every candidate costs one detail fetch, so a sweep is capped even if a site republishes
// its whole sitemap with a fresh lastmod.
const MAX_JOB_PAGES_PER_SYNC = 200;

// Large employers who run their own careers platform have no ATS vendor host to seed a
// company row against, and each one's search endpoint is private and moves when its vendor
// does. What none of them can drop is the sitemap and the schema.org JobPosting block on
// each detail page: Google for Jobs requires both, and these employers depend on being
// indexed there. That standard pair is the contract this collector reads them through, so
// adding an employer is a config entry rather than another bespoke parser.
//
// job_path_pattern is matched against the URL path with any trailing slash removed. Getting
// it wrong costs wasted detail fetches on listing pages, not bad rows -- a page with no
// JobPosting block yields nothing.
const CAREER_SITE_CONFIGS = Object.freeze({
  expedia: {
    label: "Expedia Group",
    origin: "https://careers.expediagroup.com",
    job_path_pattern: /^\/jobs?\/(?!search|results|browse|all|categor(?:y|ies)|locations?|teams?)[^/]+/i,
    default_company_name: "Expedia Group",
    // Expedia, Vrbo, Hotels.com, Egencia, Expedia Partner Solutions and the rest post here.
    estimated_company_count: 8
  },
  apple: {
    label: "Apple",
    origin: "https://jobs.apple.com",
    job_path_pattern: /^\/[a-z]{2}(?:-[a-z]{2})?\/details\/[^/]+/i,
    default_company_name: "Apple",
    estimated_company_count: 1
  },
  meta: {
    label: "Meta",
    origin: "https://www.metacareers.com",
    job_path_pattern: /^\/jobs\/\d+/i,
    default_company_name: "Meta",
    estimated_company_count: 1
  },
  walmart: {
    label: "Walmart",
    origin: "https://careers.walmart.com",
    job_path_pattern: /^\/(?:us\/)?jobs?\/[^/]+/i,
    default_company_name: "Walmart",
    // Walmart US, Sam's Club and Walmart Global Tech all post to this site.
    estimated_company_count: 3
  },
  disney: {
    label: "Disney",
    origin: "https://jobs.disneycareers.com",
    job_path_pattern: /^\/job\/[^/]+/i,
    default_company_name: "The Walt Disney Company",
    // ESPN, ABC, Marvel, Pixar, Disney Parks and the studios share one board.
    estimated_company_count: 6
  },
  boeing: {
    label: "Boeing",
    origin: "https://jobs.boeing.com",
    job_path_pattern: /^\/job\/[^/]+/i,
    default_company_name: "Boeing",
    estimated_company_count: 1
  }
});

const CAREER_SITE_KEYS = Object.freeze(Object.keys(CAREER_SITE_CONFIGS));

function getCareerSiteConfig(siteKey) {
  const config = CAREER_SITE_CONFIGS[String(siteKey || "").trim().toLowerCase()];
  if (!config) throw new Error(`Unknown career site '${String(siteKey)}'`);
  return config;
}

function careerSiteHost(config) {
  return new URL(config.origin).host.toLowerCase();
}

function parseSitemapUrlsFromRobotsTxt(robotsText, config) {
  const urls = [];
  const seen = new Set();
  const expectedHost = careerSiteHost(config);

  for (const line of String(robotsText || "").split(/\r?\n/)) {
    const match = line.match(/^\s*sitemap\s*:\s*(\S+)\s*$/i);
    if (!match?.[1]) continue;

    let resolved = "";
    try {
      resolved = new URL(match[1], `${config.origin}/`).toString();
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

function isCareerSiteJobUrl(config, value) {
  const url = String(value || "").trim();
  if (!url) return false;

  let parsed = null;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.host.toLowerCase() !== careerSiteHost(config)) return false;

  return config.job_path_pattern.test(parsed.pathname.replace(/\/+$/, ""));
}

// Job detail pages are only worth fetching when the sitemap says the page changed inside
// the freshness window. Entries a site leaves undated sort last and are only reached when
// the cap has room, so an undated sitemap degrades to a bounded sweep instead of either a
// full crawl or nothing at all.
function selectCareerSiteJobCandidates(
  config,
  entries,
  referenceEpoch = nowEpochSeconds(),
  limit = MAX_JOB_PAGES_PER_SYNC
) {
  const seen = new Set();
  const dated = [];
  const undated = [];

  for (const entry of Array.isArray(entries) ? entries : []) {
    const loc = String(entry?.loc || "").trim();
    if (!isCareerSiteJobUrl(config, loc) || seen.has(loc)) continue;
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

function buildCareerSiteLocation(jobPosting) {
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

function extractCareerSiteCompensation(jobPosting) {
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

// Which ATS a posting belongs to is derived from its stored URL everywhere it matters --
// the postings list, the facet counts and the MCP candidate search all call
// inferAtsFromJobPostingUrl rather than reading a column. A JSON-LD block that advertises
// its apply vendor's host in `url` would therefore store a row no ATS filter can reach, so
// the canonical URL is only taken when it stays on the employer's own site.
function resolveCareerSiteJobUrl(config, jobPosting, pageUrl) {
  const canonical = String(cleanHtmlText(jobPosting?.url) || "").trim();
  if (canonical) {
    try {
      if (new URL(canonical).host.toLowerCase() === careerSiteHost(config)) return canonical;
    } catch {
      // A malformed canonical URL is no better than an absent one.
    }
  }
  return String(pageUrl || "").trim();
}

function parseCareerSiteJobPostingFromHtml(config, html, pageUrl) {
  const jobPosting = extractJsonLdObjects(html).find((object) => isJobPostingObject(object));
  if (!jobPosting) return null;

  const jobPostingUrl = resolveCareerSiteJobUrl(config, jobPosting, pageUrl);
  if (!jobPostingUrl) return null;

  const compensation = extractCareerSiteCompensation(jobPosting);

  return {
    company_name: extractSchemaOrgName(jobPosting?.hiringOrganization) || config.default_company_name,
    position_name: cleanHtmlText(jobPosting?.title) || "Untitled Position",
    job_posting_url: jobPostingUrl,
    posting_date: cleanHtmlText(jobPosting?.datePosted) || null,
    location: buildCareerSiteLocation(jobPosting),
    job_description: cleanHtmlText(jobPosting?.description) || null,
    compensation_type: compensation.compensation_type,
    pay_min: compensation.pay_min,
    pay_max: compensation.pay_max,
    pay_currency: compensation.pay_currency,
    pay_period: compensation.pay_period,
    pay_raw: compensation.pay_raw
  };
}

async function fetchCareerSiteText(siteKey, requestKind, url, accept) {
  const res = await fetchWithAtsRateLimit(siteKey, CAREER_SITE_RATE_LIMIT_WAIT_MS, url, {
    method: "GET",
    headers: {
      Accept: accept,
      "Accept-Language": "en-US,en;q=0.9",
      "User-Agent": DEFAULT_BROWSER_USER_AGENT
    }
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${siteKey} ${requestKind} request failed (${res.status}): ${body.slice(0, 180)}`);
  }

  return res.text();
}

async function discoverCareerSiteSitemapUrls(siteKey, config) {
  let robotsText = "";
  try {
    robotsText = await fetchCareerSiteText(siteKey, "robots", `${config.origin}/robots.txt`, "text/plain,*/*");
  } catch {
    // A missing or blocked robots.txt only costs the discovery shortcut; the conventional
    // sitemap location still has to be tried before the sweep can be called a failure.
    robotsText = "";
  }

  const advertised = parseSitemapUrlsFromRobotsTxt(robotsText, config);
  return advertised.length > 0 ? advertised : [`${config.origin}/sitemap.xml`];
}

// Sitemap indexes point at child sitemaps; job URLs live one level down. Children whose own
// lastmod is outside the window are skipped, and job-named children are preferred so the
// per-sync sitemap budget is not spent on a site's marketing pages.
async function collectCareerSiteSitemapEntries(siteKey, config, referenceEpoch) {
  const pending = await discoverCareerSiteSitemapUrls(siteKey, config);
  const visited = new Set();
  const entries = [];
  let fetchedSitemaps = 0;
  let lastSitemapError = null;

  while (pending.length > 0 && fetchedSitemaps < MAX_SITEMAPS_PER_SYNC) {
    const sitemapUrl = pending.shift();
    if (!sitemapUrl || visited.has(sitemapUrl)) continue;
    visited.add(sitemapUrl);

    let xml = "";
    try {
      xml = await fetchCareerSiteText(siteKey, "sitemap", sitemapUrl, "application/xml,text/xml,*/*");
    } catch (error) {
      lastSitemapError = error;
      continue;
    }
    fetchedSitemaps += 1;

    const parsed = parseSitemapEntries(xml);
    if (!parsed.is_index) {
      entries.push(...parsed.entries);
      continue;
    }

    // robots.txt entries are host-checked on the way in; child sitemaps have to be too, or
    // an index naming a CDN or a partner host would walk the sweep off the employer's site
    // and past the one host an operator allowlisted for it.
    const children = parsed.entries.filter((entry) => {
      if (entry.lastmod && !shouldStorePostingByDate(entry.lastmod, referenceEpoch)) return false;
      try {
        return new URL(entry.loc).host.toLowerCase() === careerSiteHost(config);
      } catch {
        return false;
      }
    });
    const jobChildren = children.filter((entry) => /job/i.test(String(entry.loc || "")));
    for (const child of jobChildren.length > 0 ? jobChildren : children) {
      if (!visited.has(child.loc)) pending.push(child.loc);
    }
  }

  // Reaching no sitemap at all is not "this employer posted nothing today" -- it means the
  // sweep never started. Returning an empty list would report that as a clean zero and hide
  // a blocked host, a moved sitemap or a dead site behind a number that looks like a quiet
  // hiring day, on a collector whose whole job is to notice new postings.
  if (fetchedSitemaps === 0) {
    throw lastSitemapError ||
      new Error(`${siteKey} sitemap sweep found no readable sitemap under ${config.origin}`);
  }

  return entries;
}

async function collectPostingsForCareerSiteDynamic(siteKey) {
  const config = getCareerSiteConfig(siteKey);
  const referenceEpoch = nowEpochSeconds();
  const sitemapEntries = await collectCareerSiteSitemapEntries(siteKey, config, referenceEpoch);
  const candidateUrls = selectCareerSiteJobCandidates(config, sitemapEntries, referenceEpoch);

  const seenUrls = new Set();
  const postings = [];
  let failedJobPages = 0;
  let lastJobPageError = null;

  for (const candidateUrl of candidateUrls) {
    let html = "";
    try {
      html = await fetchCareerSiteText(siteKey, "job", candidateUrl, "text/html,application/xhtml+xml");
    } catch (error) {
      // One unreachable detail page should not abandon the rest of the sweep.
      failedJobPages += 1;
      lastJobPageError = error;
      continue;
    }

    const posting = parseCareerSiteJobPostingFromHtml(config, html, candidateUrl);
    if (!posting) continue;

    const postingUrl = String(posting?.job_posting_url || "").trim();
    if (!postingUrl || seenUrls.has(postingUrl)) continue;
    if (!shouldStorePostingByDate(posting?.posting_date, referenceEpoch)) continue;

    seenUrls.add(postingUrl);
    postings.push(posting);
  }

  // Same reasoning one level down: if the sitemap named fresh jobs and every single one of
  // them failed to load, the sweep found nothing because it could not read, not because
  // there was nothing to read.
  if (candidateUrls.length > 0 && failedJobPages === candidateUrls.length) {
    throw lastJobPageError ||
      new Error(`${siteKey} could not read any of its ${candidateUrls.length} candidate job pages`);
  }

  return postings;
}

function getCareerSiteEstimatedCompanyCount(siteKey) {
  return getCareerSiteConfig(siteKey).estimated_company_count;
}

module.exports = {
  CAREER_SITE_CONFIGS,
  CAREER_SITE_KEYS,
  getCareerSiteConfig,
  getCareerSiteEstimatedCompanyCount,
  collectPostingsForCareerSiteDynamic,
  parseSitemapUrlsFromRobotsTxt,
  parseSitemapEntries,
  selectCareerSiteJobCandidates,
  parseCareerSiteJobPostingFromHtml,
  isCareerSiteJobUrl
};
