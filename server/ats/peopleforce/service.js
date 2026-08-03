
const { parseUrl, decodeHtmlEntities } = require("../../helpers/normalize-strings");
const { fetchWithAtsRateLimit } = require("../../services/queue");

async function collectPostingsForPeopleforceCompany(company) {
  const config = parsePeopleforceCompany(company.url_string);
  if (!config) return [];

  const normalizedCompanyName = String(company?.company_name || "").trim();
  const companyNameForPostings = normalizedCompanyName || config.subdomainLower;
  const { pageHtml, finalUrl } = await fetchPeopleforceJobsPage(config);
  if (!pageHtml) return [];

  const finalParsed = parseUrl(finalUrl);
  const parseConfig = {
    ...config,
    baseOrigin: `${finalParsed?.protocol || "https:"}//${finalParsed?.host || config.host}`,
    jobsUrl: finalUrl || config.jobsUrl
  };
  return parsePeopleforcePostingsFromHtml(companyNameForPostings, parseConfig, pageHtml);
}


function parsePeopleforceCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;

  const host = String(parsed.hostname || "").toLowerCase();
  if (!host.endsWith(".peopleforce.io")) return null;
  if (host === "peopleforce.io" || host === "www.peopleforce.io") return null;

  const [subdomain = ""] = host.split(".");
  if (!subdomain) return null;

  const pathParts = parsed.pathname
    .split("/")
    .map((part) => String(part || "").trim())
    .filter(Boolean);
  if (pathParts.length > 0 && String(pathParts[0] || "").toLowerCase() !== "careers") return null;

  const baseOrigin = `${parsed.protocol}//${parsed.host}`;
  return {
    host,
    subdomain,
    subdomainLower: subdomain.toLowerCase(),
    baseOrigin,
    jobsUrl: `${baseOrigin}/careers`
  };
}

function cleanPeopleforceText(value) {
  return decodeHtmlEntities(String(value || "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function parsePeopleforcePostingsFromHtml(companyNameForPostings, config, pageHtml) {
  const source = String(pageHtml || "");
  const postings = [];
  const seenUrls = new Set();

  const postingPattern =
    /<a[^>]*class=["'][^"']*\bstretched-link\b[^"']*["'][^>]*href=["'](\/careers\/v\/[^"'#?]+)["'][^>]*>([\s\S]*?)<\/a>([\s\S]*?)(?=<a[^>]*class=["'][^"']*\bstretched-link\b|$)/gi;
  const locationPattern =
    /<div[^>]*class=["'][^"']*\btw-text-neutral-dark-80\b[^"']*\bsmall\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i;

  let postingMatch = postingPattern.exec(source);
  while (postingMatch) {
    const href = String(postingMatch[1] || "").trim();
    const absoluteUrl = href ? new URL(href, `${config.baseOrigin || ""}/`).toString() : "";
    if (!absoluteUrl || seenUrls.has(absoluteUrl)) {
      postingMatch = postingPattern.exec(source);
      continue;
    }

    const title = cleanPeopleforceText(postingMatch[2] || "") || "Untitled Position";
    const locationRaw = String(postingMatch[3] || "");
    const location = cleanPeopleforceText(locationRaw.match(locationPattern)?.[1] || "");

    postings.push({
      company_name: companyNameForPostings,
      position_name: title,
      job_posting_url: absoluteUrl,
      posting_date: null,
      location: location || null
    });

    seenUrls.add(absoluteUrl);
    postingMatch = postingPattern.exec(source);
  }

  return postings;
}



async function fetchPeopleforceJobsPage(config) {
  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Cache-Control": "no-cache",
    Pragma: "no-cache"
  };

  const res = await fetchWithAtsRateLimit("peopleforce", 60 * 1000, config.jobsUrl, {
    method: "GET",
    headers
  });

  let statusCode = Number(res.status || 0);
  let finalUrl = String(res.url || config.jobsUrl || "").trim();
  let pageHtml = statusCode === 200 ? await res.text() : "";

  // Disabled curl fallback to prevent external console process launches on Windows MSI runtime.

  if (statusCode !== 200) {
    throw new Error(`Peopleforce page request failed (${statusCode})`);
  }

  const finalHost = String(parseUrl(finalUrl)?.hostname || "").toLowerCase();
  if (!finalHost.endsWith(".peopleforce.io") || finalHost === "peopleforce.io" || finalHost === "www.peopleforce.io") {
    throw new Error(`Peopleforce URL redirected to unexpected host: ${finalUrl}`);
  }

  if (/\bclosed career site\b/i.test(pageHtml)) {
    return { pageHtml: "", finalUrl };
  }

  return { pageHtml, finalUrl };
}



module.exports = { collectPostingsForPeopleforceCompany, parsePeopleforceCompany };
