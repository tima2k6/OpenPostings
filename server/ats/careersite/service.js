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
//
// sitemap_paths is only needed by boards whose robots.txt names no sitemap and which do not
// keep one at /sitemap.xml either. It is a list of paths to try instead of that guess, not
// an extra crawl surface: everything reached through it is still same-host and still spends
// the same per-sync sitemap budget.
//
// Every employer listed here was checked against the live board on 2026-07-27: the sitemap
// resolves, job_path_pattern matches the URLs it actually contains, and the detail pages
// carry a schema.org JobPosting block. Employers whose boards fail any of those three are
// deliberately absent -- see the note below the table.
const CAREER_SITE_CONFIGS = Object.freeze({
  expedia: {
    label: "Expedia Group",
    origin: "https://careers.expediagroup.com",
    // Live URLs are /job/<title-slug>/<location-slug>/<req-id>/, so the pattern has to admit
    // a multi-segment tail while still rejecting the /jobs/search-style listing pages.
    job_path_pattern: /^\/jobs?\/(?!search|results|browse|all|categor(?:y|ies)|locations?|teams?)[^/]+/i,
    default_company_name: "Expedia Group",
    // Expedia, Vrbo, Hotels.com, Egencia, Expedia Partner Solutions and the rest post here.
    estimated_company_count: 8
  },
  microsoft: {
    label: "Microsoft Careers",
    // The board that answered at jobs.careers.microsoft.com through its own search service
    // has been retired: that host 301s here, and the gcsservices.careers.microsoft.com API it
    // used to call no longer even presents a certificate for its own name. What replaced it
    // is a Phenom site, which is exactly the sitemap + JobPosting pair this engine reads.
    origin: "https://apply.careers.microsoft.com",
    job_path_pattern: /^\/careers\/job\/[^/]+/i,
    // robots.txt here allows the board but advertises no sitemap, and /sitemap.xml is a 404.
    sitemap_paths: ["/careers/sitemap.xml"],
    default_company_name: "Microsoft",
    // One board for Microsoft proper. LinkedIn and GitHub recruit on their own sites.
    estimated_company_count: 1
  },
  boeing: {
    label: "Boeing",
    origin: "https://jobs.boeing.com",
    job_path_pattern: /^\/job\/[^/]+/i,
    default_company_name: "Boeing",
    estimated_company_count: 1
  }
});

// Deliberately not in the table, each checked against the live board on 2026-07-27:
//
//   apple    jobs.apple.com publishes no sitemap at all (/robots.txt, /sitemap.xml and
//            /sitemap_index.xml are all 404s, and /en-us/sitemap.xml is the SPA shell
//            answering 200 with HTML), and its detail pages carry no JSON-LD of any kind.
//            Neither half of the contract is there.
//   meta     www.metacareers.com advertises two sitemaps in robots.txt and serves neither to
//            this collector: the .gz answers 403 and /jobsearch/sitemap.xml answers 400. The
//            same robots.txt states that automated collection is prohibited without written
//            permission, so the block is a decision rather than a fault to route around.
//   walmart  careers.walmart.com does publish a sitemap listing all ~15k jobs, but its detail
//            pages are a Next.js app that keeps the posting in __NEXT_DATA__ and emits no
//            JobPosting block. Reading it means parsing that blob, which is a bespoke
//            collector, not this engine.
//   disney   jobs.disneycareers.com publishes a good sitemap and its job URLs match the shape
//            this engine expects, but the detail pages carry no JSON-LD -- checked on three
//            separate postings. Boeing runs the same vendor and does emit it, so this is a
//            per-tenant setting Disney has off rather than something the engine can fix.
//
// All four need their own collector or should stay dropped; none of them can be made to work
// by widening a pattern here.

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
// Microsoft and Expedia both publish their canonical URL as http:// even though the board
// only answers on https and redirects there. Storing the http:// form gives every reader a
// link that costs a redirect, so the scheme is taken from the configured origin while the
// rest of the canonical URL is kept exactly as published.
function resolveCareerSiteJobUrl(config, jobPosting, pageUrl) {
  const originProtocol = new URL(config.origin).protocol;
  const canonical = String(cleanHtmlText(jobPosting?.url) || "").trim();
  if (canonical) {
    try {
      const parsed = new URL(canonical);
      if (parsed.host.toLowerCase() === careerSiteHost(config)) {
        if (parsed.protocol !== originProtocol) parsed.protocol = originProtocol;
        return parsed.toString();
      }
    } catch {
      // A malformed canonical URL is no better than an absent one.
    }
  }

  const fallback = String(pageUrl || "").trim();
  if (!fallback) return "";
  try {
    const parsed = new URL(fallback);
    if (parsed.host.toLowerCase() === careerSiteHost(config) && parsed.protocol !== originProtocol) {
      parsed.protocol = originProtocol;
      return parsed.toString();
    }
  } catch {
    // Fall through to the raw candidate URL; it is what the sweep actually fetched.
  }
  return fallback;
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
  if (advertised.length > 0) return advertised;

  // A board that names no sitemap is usually still keeping one at the conventional path, so
  // that guess stays the default. sitemap_paths is for the ones that are not -- it replaces
  // the guess rather than adding to it, so a configured board does not also pay for a fetch
  // of a path its operator already knows is a 404.
  const configuredPaths = Array.isArray(config.sitemap_paths) ? config.sitemap_paths : [];
  if (configuredPaths.length > 0) {
    return configuredPaths.map((sitemapPath) => new URL(sitemapPath, `${config.origin}/`).toString());
  }

  return [`${config.origin}/sitemap.xml`];
}

// A single-page careers site answers an unknown path with its own HTML shell and a 200
// rather than a 404, so "the fetch succeeded" is not the same as "a sitemap was read".
// Counting that shell as a readable sitemap is what turns a moved sitemap into a clean zero
// instead of the error the sweep is supposed to raise, so a document has to actually look
// like one before it counts.
function looksLikeSitemapXml(xml) {
  return /<(?:urlset|sitemapindex)[\s>]/i.test(String(xml || ""));
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
    if (!looksLikeSitemapXml(xml)) {
      lastSitemapError = new Error(`${siteKey} sitemap request to ${sitemapUrl} answered with a non-sitemap document`);
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
  isCareerSiteJobUrl,
  looksLikeSitemapXml,
  discoverCareerSiteSitemapUrls
};
