const { parseUrl, decodeHtmlEntities } = require("../../helpers/normalize-strings");
const { fetchWithAtsRateLimit, sleep } = require("../../services/queue");
const LOXO_RATE_LIMIT_WAIT_MS = 5 * 1000;

async function collectPostingsForLoxoCompany(company) {
  const config = parseLoxoCompany(company.url_string);
  if (!config) return [];

  const normalizedCompanyName = String(company?.company_name || "").trim();
  const companyNameForPostings = normalizedCompanyName || config.companySlugLower;
  const { pageHtml, finalUrl } = await fetchLoxoJobsPage(config);
  const finalParsed = parseUrl(finalUrl);
  const parseConfig = {
    ...config,
    baseOrigin: `${finalParsed?.protocol || "https:"}//${finalParsed?.host || config.host}`,
    boardUrl: finalUrl || config.boardUrl
  };
  return parseLoxoPostingsFromHtml(companyNameForPostings, parseConfig, pageHtml);
}


function parseLoxoCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;

  const host = String(parsed.hostname || "").toLowerCase();
  if (host !== "app.loxo.co" && host !== "www.app.loxo.co") return null;

  const pathParts = parsed.pathname
    .split("/")
    .map((part) => String(part || "").trim())
    .filter(Boolean);
  if (pathParts.length === 0) return null;
  if (String(pathParts[0] || "").toLowerCase() === "job") return null;

  const companySlug = String(pathParts[0] || "").trim();
  if (!companySlug) return null;

  const boardUrl = new URL(`${parsed.protocol}//${parsed.host}/${companySlug}`);
  boardUrl.search = "";
  boardUrl.hash = "";

  return {
    host,
    companySlug,
    companySlugLower: companySlug.toLowerCase(),
    baseOrigin: `${parsed.protocol}//${parsed.host}`,
    boardUrl: boardUrl.toString()
  };
}


function cleanLoxoText(value) {
  return decodeHtmlEntities(String(value || "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function parseLoxoPostingsFromHtml(companyNameForPostings, config, pageHtml) {
  const source = String(pageHtml || "");
  const postings = [];
  const seenUrls = new Set();

  const cardPattern =
    /<div[^>]*class=['"][^'"]*\bjobs-listing-card\b[^'"]*['"][^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<div[^>]*class=['"][^'"]*\bdata-cell\b[^'"]*['"][^>]*>[\s\S]*?<div[^>]*class=['"][^'"]*\bjob-location\b[^'"]*['"][^>]*>([\s\S]*?)<\/div>/gi;
  const hrefPattern = /<a[^>]*class=['"][^'"]*\bjob-title\b[^'"]*['"][^>]*href=['"]([^"']+)['"][^>]*>([\s\S]*?)<\/a>/i;
  const datePattern = /<div[^>]*class=['"][^'"]*\bjob-date\b[^'"]*['"][^>]*>([\s\S]*?)<\/div>/i;

  let match = cardPattern.exec(source);
  while (match) {
    const cardHtml = String(match[1] || "");
    const locationHtml = String(match[2] || "");
    const hrefMatch = cardHtml.match(hrefPattern);
    const href = String(hrefMatch?.[1] || "").trim();
    const absoluteUrl = href ? new URL(href, `${config.baseOrigin || ""}/`).toString() : "";
    if (!absoluteUrl || seenUrls.has(absoluteUrl)) {
      match = cardPattern.exec(source);
      continue;
    }

    const title = cleanLoxoText(hrefMatch?.[2] || "") || "Untitled Position";
    const postingDate = cleanLoxoText(cardHtml.match(datePattern)?.[1] || "");
    const location = cleanLoxoText(locationHtml).replace(/\blocation_on\b/gi, "").trim();

    postings.push({
      company_name: companyNameForPostings,
      position_name: title,
      job_posting_url: absoluteUrl,
      posting_date: postingDate || null,
      location: location || null
    });

    seenUrls.add(absoluteUrl);
    match = cardPattern.exec(source);
  }

  return postings;
}

async function fetchLoxoJobsPage(config) {
  const headers = {
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
  };

  const doRequest = async () =>
    fetchWithAtsRateLimit("loxo", LOXO_RATE_LIMIT_WAIT_MS, config.boardUrl, {
      method: "GET",
      headers
    });

  let res = await doRequest();
  if (Number(res.status || 0) === 429) {
    await sleep(LOXO_RATE_LIMIT_WAIT_MS);
    res = await doRequest();
  }

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Loxo page request failed (${res.status}): ${body.slice(0, 180)}`);
  }

  const finalUrl = String(res.url || config.boardUrl || "").trim();
  const finalHost = String(parseUrl(finalUrl)?.hostname || "").toLowerCase();
  if (finalHost !== "app.loxo.co" && finalHost !== "www.app.loxo.co") {
    throw new Error(`Loxo URL redirected to unexpected host: ${finalUrl}`);
  }

  return { pageHtml: await res.text(), finalUrl };
}

module.exports = { collectPostingsForLoxoCompany, parseLoxoCompany };
