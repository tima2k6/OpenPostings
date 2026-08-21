const { parseUrl, decodeHtmlEntities } = require("../../helpers/normalize-strings");
const { fetchWithAtsRateLimit } = require("../../services/queue");
const JOBVITE_RATE_LIMIT_WAIT_MS = 60 * 1000;

async function collectPostingsForJobviteCompany(company) {
  const config = parseJobviteCompany(company.url_string);
  if (!config) return [];

  const normalizedCompanyName = String(company?.company_name || "").trim();
  const companyNameForPostings =
    normalizedCompanyName &&
    normalizedCompanyName.toLowerCase() !== "jobs" &&
    normalizedCompanyName.toLowerCase() !== "careers"
      ? normalizedCompanyName
      : config.companySlugLower;

  const pageHtml = await fetchJobviteJobsPage(config.jobsUrl);
  return parseJobvitePostingsFromHtml(companyNameForPostings, config, pageHtml);
}


function parseJobviteCompany(urlString) {
  const parsed = parseUrl(urlString);
  if (!parsed) return null;

  const host = String(parsed.hostname || "").toLowerCase();
  if (host !== "jobs.jobvite.com" && host !== "careers.jobvite.com") return null;

  const pathParts = parsed.pathname
    .split("/")
    .map((part) => String(part || "").trim())
    .filter(Boolean);
  if (pathParts.length === 0) return null;

  const companySlug = String(pathParts[0] || "").trim();
  if (!companySlug) return null;

  return {
    host,
    companySlug,
    companySlugLower: companySlug.toLowerCase(),
    baseOrigin: `${parsed.protocol}//${parsed.host}`,
    jobsUrl: `${parsed.protocol}//${parsed.host}/${companySlug}/jobs`
  };
}



function cleanJobviteText(value) {
  return decodeHtmlEntities(String(value || "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*/g, ", ")
    .trim();
}

function parseJobvitePostingsFromHtml(companyNameForPostings, config, pageHtml) {
  const source = String(pageHtml || "");
  const tablePattern =
    /<h3[^>]*>([\s\S]*?)<\/h3>\s*<table[^>]*class=["'][^"']*\bjv-job-list\b[^"']*["'][^>]*>([\s\S]*?)<\/table>/gi;
  // One regex per row, not one regex spanning a row. The previous pattern chained six
  // `[\s\S]*?` runs across the whole <tr>...</tr>, and on a page where the fields do not
  // appear in the expected order the engine has to try every way of splitting the text
  // between those runs before it can fail -- catastrophic backtracking. It is not slow, it
  // effectively never finishes: measured against the live jobs.jobvite.com/fieldcore-review
  // page (91KB), a single exec() had not returned after 20 seconds, and in production it
  // spun one core for 15 minutes and took the whole API down with it, because this runs on
  // the sync's turn of the event loop.
  //
  // No loop guard could have caught that -- the process was stuck inside one exec() call,
  // never returning to any loop. The fix has to be the pattern itself: split rows on a
  // single lazy run, then read each field with its own anchored pattern. Every regex below
  // has one `[\s\S]*?` between fixed delimiters, so each is linear in the text it scans and
  // the work is bounded by the row rather than by the document.
  const rowSplitPattern = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const nameCellPattern = /<td[^>]*class=["'][^"']*\bjv-job-list-name\b[^"']*["'][^>]*>([\s\S]*?)<\/td>/i;
  const anchorPattern = /<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i;
  // Jobvite serves two layouts, and the change between them is what actually broke this
  // parser. The older one puts the location in its own cell, a sibling of the name cell;
  // the current one (jobs.jobvite.com/fieldcore-review, captured as this ATS's fixture)
  // nests it in a <div> *inside* the name cell's anchor, alongside a <div class="title">.
  // Matching only the <td> form meant the current layout produced no rows at all -- which
  // is what pushed every such page into the whole-document fallback below, where the old
  // row pattern then backtracked forever. Accepting either element keeps both working.
  const locationPattern = /<(?:td|div)[^>]*class=["'][^"']*\bjv-job-list-location\b[^"']*["'][^>]*>([\s\S]*?)<\/(?:td|div)>/i;
  // In the nested layout the anchor's text is title + location run together ("Buyer Remote,
  // Mexico"), so the title div is what the position name has to come from when it is there.
  const titlePattern = /<div[^>]*class=["'][^"']*\btitle\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i;

  const postings = [];
  const seenUrls = new Set();

  const pushRows = (rowsHtml, department = "") => {
    rowSplitPattern.lastIndex = 0;
    let rowMatch = rowSplitPattern.exec(rowsHtml);
    while (rowMatch) {
      const rowHtml = String(rowMatch[1] || "");
      const nameCell = nameCellPattern.exec(rowHtml);
      // Searched across the whole row, so it finds the sibling <td> of the older layout and
      // the nested <div> of the current one without caring which produced it.
      const locationCell = locationPattern.exec(rowHtml);
      const anchor = nameCell ? anchorPattern.exec(String(nameCell[1] || "")) : null;
      const title = anchor ? titlePattern.exec(String(anchor[2] || "")) : null;
      rowMatch = rowSplitPattern.exec(rowsHtml);
      if (!anchor) continue;

      const href = String(anchor[1] || "").trim();
      let absoluteUrl = "";
      if (href) {
        try {
          absoluteUrl = new URL(href, `${config.baseOrigin}/`).toString();
        } catch {
          // A malformed href is one bad row, not a reason to abandon the company.
          absoluteUrl = "";
        }
      }
      if (!absoluteUrl || seenUrls.has(absoluteUrl)) continue;

      postings.push({
        company_name: companyNameForPostings,
        position_name: cleanJobviteText(title ? title[1] : anchor[2]) || "Untitled Position",
        job_posting_url: absoluteUrl,
        posting_date: null,
        location: locationCell ? cleanJobviteText(locationCell[1]) || null : null,
        department: cleanJobviteText(department) || null
      });
      seenUrls.add(absoluteUrl);
    }
    rowSplitPattern.lastIndex = 0;
  };

  let tableMatch = tablePattern.exec(source);
  while (tableMatch) {
    pushRows(String(tableMatch[2] || ""), String(tableMatch[1] || ""));
    tableMatch = tablePattern.exec(source);
  }

  if (postings.length === 0) {
    pushRows(source, "");
  }

  return postings;
}

async function fetchJobviteJobsPage(jobsUrl) {
  const res = await fetchWithAtsRateLimit("jobvite", JOBVITE_RATE_LIMIT_WAIT_MS, jobsUrl, {
    method: "GET",
    headers: {
      Accept: "text/html,application/xhtml+xml"
    }
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Jobvite request failed (${res.status}): ${body.slice(0, 180)}`);
  }

  return res.text();
}

module.exports = { collectPostingsForJobviteCompany, parseJobviteCompany, parseJobvitePostingsFromHtml };
