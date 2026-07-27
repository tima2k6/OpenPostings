const { decodeHtmlEntities } = require("../../helpers/normalize-strings");
const { fetchWithAtsRateLimit } = require("../../services/queue.js");
const { shouldStorePostingByDate, nowEpochSeconds } = require("../../helpers/normalize-numbers.js");
const { urljoin } = require("../../helpers/normalize-strings.js");
const ACADEMICJOBSONLINE_ESTIMATED_COMPANY_COUNT = 2159;

function cleanAcademicJobsOnlineText(value) {
  return decodeHtmlEntities(String(value || "").replace(/<[^>]+>/g, " "))
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseAcademicJobsOnlinePostedDate(value) {
  const raw = cleanAcademicJobsOnlineText(value);
  if (!raw) return null;
  const match = raw.match(/(\d{4})\/(\d{2})\/(\d{2})/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  const dt = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString();
}

function parseAcademicJobsOnlineHeading(blockHtml) {
  const source = String(blockHtml || "");
  const h3Match = source.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i);
  const h3Html = String(h3Match?.[1] || "");
  if (!h3Html) {
    return { companyName: "Unknown Company", location: null };
  }

  const anchorRegex = /<a\b[^>]*>([\s\S]*?)<\/a>/gi;
  const headingParts = [];
  let anchorMatch = anchorRegex.exec(h3Html);
  while (anchorMatch) {
    const value = cleanAcademicJobsOnlineText(anchorMatch[1]);
    if (value) headingParts.push(value);
    anchorMatch = anchorRegex.exec(h3Html);
  }

  if (headingParts.length > 0) {
    const companyName = headingParts[0] || "Unknown Company";
    const location = headingParts.slice(1).join(", ").trim() || null;
    return { companyName, location };
  }

  const fallbackHeading = cleanAcademicJobsOnlineText(h3Html);
  if (!fallbackHeading) {
    return { companyName: "Unknown Company", location: null };
  }

  const fallbackParts = fallbackHeading.split(",").map((part) => part.trim()).filter(Boolean);
  const companyName = fallbackParts[0] || "Unknown Company";
  const location = fallbackParts.slice(1).join(", ").trim() || null;
  return { companyName, location };
}

function parseAcademicJobsOnlinePostingsFromHtml(pageHtml, baseUrl) {
  const source = String(pageHtml || "");
  if (!source) return [];

  const postings = [];
  const seenUrls = new Set();
  // The final block on a listing page is not followed by another block; it ends with the
  // "(N positions listed)" summary and an <hr class="clr">, so both must terminate a block.
  const blockRegex = /<div class="clr">([\s\S]*?)<\/div>\s*(?=<div class="clr">|<hr\b|<p class="sml">|<\/main>)/gi;
  const liRegex = /<li>([\s\S]*?)<\/li>/gi;
  const hrefRegex = /href="(\/ajo\/jobs\/\d+)"/i;
  const titleRegex = /id="j\d+"[^>]*>([\s\S]*?)<\/span>/i;
  const postedRegex = /posted\s*<span[^>]*>([\s\S]*?)<\/span>/i;

  let blockMatch = blockRegex.exec(source);
  while (blockMatch) {
    const blockHtml = String(blockMatch[1] || "");
    const heading = parseAcademicJobsOnlineHeading(blockHtml);
    const companyName = heading.companyName;
    const blockLocation = heading.location;

    let liMatch = liRegex.exec(blockHtml);
    while (liMatch) {
      const liHtml = String(liMatch[1] || "");
      const hrefMatch = hrefRegex.exec(liHtml);
      if (!hrefMatch?.[1]) {
        liMatch = liRegex.exec(blockHtml);
        continue;
      }

      const jobUrl = urljoin(baseUrl, cleanAcademicJobsOnlineText(hrefMatch[1]));
      if (!jobUrl || seenUrls.has(jobUrl)) {
        liMatch = liRegex.exec(blockHtml);
        continue;
      }

      const titleMatch = titleRegex.exec(liHtml);
      const postedMatch = postedRegex.exec(liHtml);
      const postingDate = parseAcademicJobsOnlinePostedDate(postedMatch?.[1] || "");

      postings.push({
        company_name: companyName,
        position_name: cleanAcademicJobsOnlineText(titleMatch?.[1] || "") || "Untitled Position",
        job_posting_url: jobUrl,
        posting_date: postingDate,
        location: blockLocation
      });
      seenUrls.add(jobUrl);
      liMatch = liRegex.exec(blockHtml);
    }

    blockMatch = blockRegex.exec(source);
  }

  return postings;
}

async function collectPostingsForAcademicJobsOnlineDynamic() {
  // The leading field id in the joblst query scopes the page to one subject area. It was pinned
  // to 44, which lists ~31 positions whose newest posting was days old, so the 24h filter below
  // emptied every run. Leaving the id blank lists the whole board (~500 open positions); the
  // trailing "p" keeps it sorted by posted date so the fresh rows are at the top.
  const endpoint = "https://academicjobsonline.org/ajo?joblst---0----0-p--";
  const res = await fetchWithAtsRateLimit("academicjobsonline", 60 * 1000, endpoint, {
    method: "GET",
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9"
    }
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`AcademicJobsOnline request failed (${res.status}): ${body.slice(0, 180)}`);
  }
  const pageHtml = await res.text();
  const referenceEpoch = nowEpochSeconds();
  const allPostings = parseAcademicJobsOnlinePostingsFromHtml(pageHtml, res.url || endpoint);
  return allPostings.filter(
    (posting) => Boolean(posting?.posting_date) && shouldStorePostingByDate(posting.posting_date, referenceEpoch)
  );
}

module.exports = {
  collectPostingsForAcademicJobsOnlineDynamic,
  parseAcademicJobsOnlinePostingsFromHtml,
  ACADEMICJOBSONLINE_ESTIMATED_COMPANY_COUNT
};
