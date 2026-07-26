const { decodeHtmlEntities } = require("../../helpers/normalize-strings");
const { nowEpochSeconds, shouldStorePostingByDate } = require("../../helpers/normalize-numbers");
const { fetchWithAtsRateLimit } = require("../../services/queue");
const HCAREERS_RATE_LIMIT_WAIT_MS = 60 * 1000;
const HCAREERS_BASE_ORIGIN = "https://www.hcareers.com";
const MAX_PAGES_PER_SYNC = 40;
const HCAREERS_ESTIMATED_COMPANY_COUNT = 4200;

function cleanHcareersText(value) {
  return decodeHtmlEntities(String(value || "").replace(/<[^>]+>/g, " "))
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// The board prints relative ages like "5 minutes ago", "about 16 hours ago" and
// "less than a minute ago". The shared date parser understands "N days ago" and
// "N hours ago", but for the other units only the suffix-less form, so the trailing
// "ago" is dropped and bare articles are expanded to a count it can read.
function normalizeHcareersPostedAge(value) {
  const text = cleanHcareersText(value);
  if (!text) return null;

  const lowered = text.toLowerCase();
  if (lowered.startsWith("less than")) return "just now";

  const relativeMatch = lowered.match(
    /^(?:about\s+|over\s+|almost\s+)?(\d+|an?)\s+(minute|hour|day|week|month|year)s?\s+ago$/i
  );
  if (!relativeMatch) return text;

  const amount = /^an?$/.test(relativeMatch[1]) ? "1" : relativeMatch[1];
  return `${amount} ${relativeMatch[2]}${amount === "1" ? "" : "s"}`;
}

function extractHcareersCompensationType(compensationText) {
  const text = String(compensationText || "").toLowerCase();
  if (!text) return null;
  const hasHourly = /per\s+hour|hourly|\/\s*hour|an\s+hour/.test(text);
  const hasSalary = /per\s+year|annually|yearly|\/\s*year|a\s+year|per\s+month|salary/.test(text);
  if (hasHourly && hasSalary) return "both";
  if (hasHourly) return "hourly";
  if (hasSalary) return "salary";
  return null;
}

function splitHcareersCards(html) {
  const source = String(html || "");
  if (!source) return [];
  const parts = source.split(/<div class="card job-card/i);
  return parts.slice(1);
}

function parseHcareersCard(cardHtml) {
  const source = String(cardHtml || "");

  const linkMatch = source.match(
    /<a[^>]*class=["'][^"']*stretched-link[^"']*["'][^>]*href=["'](\/jobs\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/i
  );
  if (!linkMatch) return null;

  const jobPostingUrl = new URL(cleanHcareersText(linkMatch[1]), `${HCAREERS_BASE_ORIGIN}/`).toString();
  const positionName = cleanHcareersText(linkMatch[2]) || "Untitled Position";

  const employerMatch = source.match(
    /<div[^>]*class=["'][^"']*employer-info[^"']*["'][^>]*>([\s\S]*?)<\/div>/i
  );
  const employerLines = String(employerMatch?.[1] || "")
    .split(/<br\s*\/?>/i)
    .map((line) => cleanHcareersText(line))
    .filter(Boolean);
  const employerName = employerLines[0] || "";
  const location = employerLines[1] || null;

  const managedByMatch = source.match(
    /<div[^>]*class=["'][^"']*managed-by[^"']*["'][^>]*>[\s\S]*?<strong>([\s\S]*?)<\/strong>/i
  );
  const managingCompany = cleanHcareersText(managedByMatch?.[1] || "");

  const postedAgeMatch = source.match(
    /<small[^>]*class=["'][^"']*text-muted[^"']*["'][^>]*>([\s\S]*?)<\/small>/i
  );
  const postingDate = normalizeHcareersPostedAge(postedAgeMatch?.[1] || "");

  const compensationMatch = source.match(
    /<div[^>]*class=["'][^"']*compensation-value[^"']*["'][^>]*>([\s\S]*?)<\/div>/i
  );
  const payRaw = cleanHcareersText(compensationMatch?.[1] || "") || null;

  return {
    company_name: employerName || managingCompany || "Unknown Company",
    position_name: positionName,
    job_posting_url: jobPostingUrl,
    posting_date: postingDate,
    location,
    pay_raw: payRaw,
    compensation_type: extractHcareersCompensationType(payRaw)
  };
}

function parseHcareersPostingsFromHtml(responseHtml) {
  const postings = [];
  for (const cardHtml of splitHcareersCards(responseHtml)) {
    const posting = parseHcareersCard(cardHtml);
    if (!posting) continue;
    postings.push(posting);
  }
  return postings;
}

async function fetchHcareersRecentPage(pageNo) {
  const requestUrl = new URL(`${HCAREERS_BASE_ORIGIN}/jobs/recent`);
  requestUrl.searchParams.set("page", String(pageNo));

  const res = await fetchWithAtsRateLimit(
    "hcareers",
    HCAREERS_RATE_LIMIT_WAIT_MS,
    requestUrl.toString(),
    {
      method: "GET",
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
        Referer: `${HCAREERS_BASE_ORIGIN}/jobs`,
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
      }
    }
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Hcareers request failed (${res.status}): ${body.slice(0, 180)}`);
  }

  return res.text();
}

// /jobs/recent is ordered newest first, so paging stops as soon as a page contributes
// nothing inside the freshness window instead of walking all ~300 pages.
async function collectPostingsForHcareersDynamic() {
  const referenceEpoch = nowEpochSeconds();
  const seenUrls = new Set();
  const postings = [];

  for (let pageNo = 1; pageNo <= MAX_PAGES_PER_SYNC; pageNo += 1) {
    const html = await fetchHcareersRecentPage(pageNo);
    const batch = parseHcareersPostingsFromHtml(html);
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
  }

  return postings;
}

module.exports = {
  collectPostingsForHcareersDynamic,
  parseHcareersPostingsFromHtml,
  HCAREERS_ESTIMATED_COMPANY_COUNT
};
