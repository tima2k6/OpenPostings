// Fetches a posting's own page and persists everything one visit can establish:
//
//   - job_description + description_fetched_at (P3): board listings often carry no body
//     text, so screening required opening a browser per posting. iCIMS, Paycor and
//     similar render the content inside a same-origin iframe whose outer document is
//     only navigation -- the iframe document is fetched and read instead.
//   - pay parsed from prose (P3): several boards state compensation only in the text.
//     Parsed figures fill pay_min/pay_max/pay_period ONLY when the ATS gave none.
//   - hiring_locations_json + location_conflict (P4): the body often restricts hiring to
//     a subset of the header locations ("we are hiring out of Atlanta, Charlotte...").
//     The header is not authoritative; the disagreement is flagged.
//   - status / dead_since_epoch (P5): a 404/410 marks the posting dead, and Dover,
//     Greenhouse and Ashby all sometimes return 200 with a "not found" body, so the body
//     text is checked too.
//   - requires_account (P8): whether the application flow demands a candidate account or
//     sits behind a captcha, so the UI can flag manual sign-in.
const { fetchWithAtsRateLimit } = require("./queue.js");
const { getDb } = require("./runtime-context.js");
const { nowEpochSeconds } = require("../helpers/normalize-numbers.js");
const { decodeHtmlEntities } = require("../helpers/normalize-strings.js");
const { inferAtsFromJobPostingUrl } = require("../helpers/normalize-ats.js");
const { parsePostingLocation, parseLocationsJson, serializeLocationsJson } = require("../helpers/parse-location.js");
const { normalizeGeoText } = require("../helpers/normalize-strings.js");

const FETCH_RATE_LIMIT_WAIT_MS = 30 * 1000;
const MAX_DESCRIPTION_CHARS = 60000;

// ---------------------------------------------------------------------------
// HTML → text
// ---------------------------------------------------------------------------

function stripNonContentMarkup(html) {
  return String(html || "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
}

function htmlFragmentToText(html) {
  const withBreaks = stripNonContentMarkup(html)
    .replace(/<(?:br|\/p|\/div|\/li|\/h[1-6]|\/tr)\b[^>]*>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n- ");
  return decodeHtmlEntities(withBreaks.replace(/<[^>]+>/g, " "))
    .replace(/&nbsp;/gi, " ")
    .replace(/ /g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// The one structured source most boards agree on: a JSON-LD JobPosting block. When
// present its `description` is the job body with none of the page chrome.
function extractJsonLdJobPosting(html) {
  const blocks = String(html || "").matchAll(
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  );
  for (const block of blocks) {
    let parsed;
    try {
      parsed = JSON.parse(block[1].trim());
    } catch {
      continue;
    }
    const candidates = Array.isArray(parsed) ? parsed : [parsed, ...(Array.isArray(parsed?.["@graph"]) ? parsed["@graph"] : [])];
    for (const candidate of candidates) {
      const type = candidate?.["@type"];
      const isJobPosting = type === "JobPosting" || (Array.isArray(type) && type.includes("JobPosting"));
      if (isJobPosting) return candidate;
    }
  }
  return null;
}

// The content iframe, when the outer document is only a shell. iCIMS names its iframe;
// Paycor and others are caught by src patterns.
function extractContentIframeUrl(html, baseUrl) {
  const source = String(html || "");
  const patterns = [
    /<iframe[^>]*id=["']icims_content_iframe["'][^>]*src=["']([^"']+)["']/i,
    /<iframe[^>]*src=["']([^"']*in_iframe=1[^"']*)["']/i,
    /<iframe[^>]*src=["']([^"']*(?:jobs?|careers?|posting|position)[^"']*)["'][^>]*>/i
  ];
  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (!match) continue;
    try {
      const resolved = new URL(decodeHtmlEntities(match[1]), baseUrl);
      const base = new URL(baseUrl);
      // Same-origin only: a cross-origin iframe is an embed (maps, videos), not content.
      if (resolved.origin === base.origin) return resolved.toString();
    } catch {}
  }
  return null;
}

// Known per-ATS content containers, tried before falling back to <main>/<body>. Matching
// is on a container-opening tag; the fragment runs to the last closing tag of the file,
// which over-captures footer text but never loses body text.
const CONTENT_CONTAINER_PATTERNS = [
  /<div[^>]*class=["'][^"']*\biCIMS_JobContent\b[^"']*["'][^>]*>([\s\S]*)/i,
  /<div[^>]*class=["'][^"']*\bjob-description\b[^"']*["'][^>]*>([\s\S]*)/i,
  /<div[^>]*class=["'][^"']*\bjob__description\b[^"']*["'][^>]*>([\s\S]*)/i,
  /<div[^>]*id=["']job-details["'][^>]*>([\s\S]*)/i,
  /<div[^>]*id=["']content["'][^>]*>([\s\S]*)/i,
  /<main\b[^>]*>([\s\S]*?)<\/main>/i
];

function extractDescriptionTextFromHtml(html) {
  for (const pattern of CONTENT_CONTAINER_PATTERNS) {
    const match = String(html || "").match(pattern);
    if (match) {
      const text = htmlFragmentToText(match[1]);
      if (text.length >= 200) return text;
    }
  }
  const withoutChrome = String(html || "")
    .replace(/<header\b[\s\S]*?<\/header>/gi, " ")
    .replace(/<nav\b[\s\S]*?<\/nav>/gi, " ")
    .replace(/<footer\b[\s\S]*?<\/footer>/gi, " ");
  const bodyMatch = withoutChrome.match(/<body\b[^>]*>([\s\S]*)<\/body>/i);
  return htmlFragmentToText(bodyMatch ? bodyMatch[1] : withoutChrome);
}

// ---------------------------------------------------------------------------
// Pay from prose
// ---------------------------------------------------------------------------

function parsePayNumber(raw) {
  const cleaned = String(raw || "").replace(/[,\s]/g, "");
  const kMatch = cleaned.match(/^\$?(\d+(?:\.\d+)?)k$/i);
  if (kMatch) return Number(kMatch[1]) * 1000;
  const match = cleaned.match(/^\$?(\d+(?:\.\d+)?)$/);
  return match ? Number(match[1]) : NaN;
}

// "$136,000 - $200,000", "$105,000 to $110,000", "between $95k and $120k",
// "$28.50/hour", "USD 140,000 per year". Applied to prose only when the ATS exposed no
// structured pay; a wrong guess here is visible in pay_raw for auditing.
function extractPayFromText(text) {
  const source = String(text || "");
  if (!source) return null;

  const amount = "\\$\\s*\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\$\\s*\\d+(?:\\.\\d+)?k?|\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?";
  const rangePattern = new RegExp(
    `(${amount})\\s*(?:-|–|—|to|and)\\s*(${amount})`,
    "i"
  );
  // A lone figure must carry a dollar sign -- the line-level vocabulary gate is not
  // enough on its own to tell "$28.50 per hour" from "5 years of experience".
  const singlePattern = new RegExp(`(\\$\\s*\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\$\\s*\\d+(?:\\.\\d+)?k?)`, "i");

  // Only read amounts near compensation vocabulary, or dollar-signed ranges; a bare
  // number range in a job description is usually years of experience or a shift window.
  const contexts = source.match(
    /[^\n]*(?:salary|compensation|pay range|pay rate|pay:|wage|per hour|per year|annually|hourly|base pay|remuneration|\$)[^\n]*/gi
  ) || [];

  for (const line of contexts) {
    const range = line.match(rangePattern);
    if (range) {
      const hasDollar = /\$/.test(range[1]) || /\$/.test(range[2]);
      const hasVocabulary = /salary|compensation|pay|wage|remuneration|hour|year|annum|annual/i.test(line);
      if (!hasDollar && !hasVocabulary) continue;
      let low = parsePayNumber(range[1]);
      let high = parsePayNumber(range[2]);
      if (!Number.isFinite(low) || !Number.isFinite(high) || low <= 0 || high <= 0) continue;
      if (high < low) [low, high] = [high, low];
      // "$136,000—$200" is a truncated render of 200,000; a range whose top is under
      // 1% of its bottom is a parse artifact, not an offer.
      if (high < low * 0.01) continue;
      const period = resolvePayPeriod(line, high);
      if (!period) continue;
      return { pay_min: low, pay_max: high, pay_period: period, pay_raw: range[0].trim() };
    }
  }

  for (const line of contexts) {
    if (!/salary|compensation|pay|wage|rate/i.test(line)) continue;
    const single = line.match(singlePattern);
    if (!single) continue;
    const value = parsePayNumber(single[1]);
    if (!Number.isFinite(value) || value <= 0) continue;
    const period = resolvePayPeriod(line, value);
    if (!period) continue;
    return { pay_min: value, pay_max: value, pay_period: period, pay_raw: single[0].trim() };
  }

  return null;
}

function resolvePayPeriod(context, upperAmount) {
  if (/hour|hr\b|hourly/i.test(context)) return "hour";
  if (/week|weekly/i.test(context)) return "week";
  if (/month|monthly/i.test(context)) return "month";
  if (/year|annual|annum|yearly/i.test(context)) return "year";
  // No explicit period: magnitude decides, and mid-range amounts are too ambiguous to
  // guess.
  if (upperAmount >= 20000) return "year";
  if (upperAmount <= 500) return "hour";
  return "";
}

// ---------------------------------------------------------------------------
// Liveness, account requirement, hiring restrictions
// ---------------------------------------------------------------------------

const SOFT_404_PATTERNS = [
  /job (?:posting |opening )?(?:was |is )?not found/i,
  /(?:position|job|posting|opening|role) (?:is |has been |was )?(?:no longer|not) (?:available|active|open|accepting)/i,
  /no longer accepting applications/i,
  /this (?:job|position|posting|listing) (?:has been )?(?:closed|filled|removed|expired)/i,
  /position has been filled/i,
  /page (?:you(?:'| a)re looking for )?(?:could not be found|doesn'?t exist|cannot be found|was not found)/i,
  /sorry.{0,40}(?:job|page|posting).{0,40}(?:not found|no longer exists|doesn'?t exist)/i
];

function detectSoftNotFound(text) {
  const sample = String(text || "").slice(0, 8000);
  return SOFT_404_PATTERNS.some((pattern) => pattern.test(sample));
}

function detectRequiresAccount(html, text) {
  const merged = `${String(html || "").slice(0, 200000)}\n${String(text || "").slice(0, 8000)}`;
  return (
    // hCaptcha's own markup uses the class "h-captcha", so the hyphen has to be optional.
    /h-?captcha|re-?captcha|turnstile/i.test(merged) ||
    /(?:sign|log) ?in to (?:apply|continue|your account)/i.test(merged) ||
    /create (?:an? )?(?:candidate )?account(?: to apply)?/i.test(merged) ||
    /(?:candidate|applicant) (?:login|sign ?in|home|portal|dashboard)/i.test(merged)
  );
}

// "We are hiring out of Atlanta, Charlotte, Nashville, Austin, or Houston" -- the body
// clause that overrides the header's location list.
const HIRING_RESTRICTION_PATTERNS = [
  /(?:hiring|hire)(?: candidates)?(?: only)? (?:out of|in|from)[:\s]+([^.;\n!?]{3,300})/gi,
  /this (?:role|position|job) (?:is|will be) based (?:out of|in)[:\s]+([^.;\n!?]{3,300})/gi,
  /must (?:be located|be based|reside|live|currently reside) (?:in|near|within)[:\s]+([^.;\n!?]{3,300})/gi,
  /candidates? must be (?:located|based) (?:in|near)[:\s]+([^.;\n!?]{3,300})/gi,
  /open (?:only )?to candidates (?:located |based )?in[:\s]+([^.;\n!?]{3,300})/gi
];

function extractHiringLocations(descriptionText) {
  const source = String(descriptionText || "");
  if (!source) return [];

  const found = [];
  const seen = new Set();
  for (const pattern of HIRING_RESTRICTION_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of source.matchAll(pattern)) {
      // "Atlanta, Charlotte, Nashville, Austin, or Houston" -> individual place names.
      const chunk = match[1].replace(/\b(?:or|and)\b/gi, ",");
      const parsed = parsePostingLocation(chunk.split(",").map((part) => part.trim()).filter(Boolean).join("; "));
      for (const entry of parsed.locations) {
        if (!entry.city && !entry.state_region && !entry.country) continue;
        const key = `${normalizeGeoText(entry.city || "")}|${entry.state_region || ""}|${entry.country || ""}`;
        if (seen.has(key)) continue;
        seen.add(key);
        found.push(entry);
      }
    }
  }
  return found;
}

// The header disagrees with the body when the body names hiring locations and at least
// one header location is not covered by them.
//
// "Covered" has to account for the two being written at different granularities: DoorDash
// lists "Phoenix, AZ" in the header and says "we are hiring out of Arizona, Denver, and
// Seattle" in the body. Phoenix is not named, but Arizona is, and a state-level permission
// covers every city in it -- flagging that as a conflict would be wrong. So a header entry
// passes if its city is named, or if a hiring entry names only its state.
function headerConflictsWithHiringLocations(headerEntries, hiringEntries) {
  if (!Array.isArray(headerEntries) || headerEntries.length === 0) return false;
  if (!Array.isArray(hiringEntries) || hiringEntries.length === 0) return false;

  const hiringCities = new Set(
    hiringEntries.map((entry) => normalizeGeoText(entry.city || "")).filter(Boolean)
  );
  // Only entries that name a state *without* a city grant state-wide coverage: "Austin,
  // TX" permits Austin, not all of Texas.
  const hiringStates = new Set(
    hiringEntries.filter((entry) => !entry.city && entry.state_region).map((entry) => entry.state_region)
  );
  if (hiringCities.size === 0 && hiringStates.size === 0) return false;

  return headerEntries.some((entry) => {
    const city = normalizeGeoText(entry.city || "");
    if (!city) return false;
    if (hiringCities.has(city)) return false;
    if (entry.state_region && hiringStates.has(entry.state_region)) return false;
    return true;
  });
}

// ---------------------------------------------------------------------------
// Fetch + persist
// ---------------------------------------------------------------------------

async function fetchPageHtml(url) {
  const ats = inferAtsFromJobPostingUrl(url) || "unknown";
  // No User-Agent, matching the sync collectors: iCIMS answers 405 to a browser UA
  // coming from a non-browser client, and every board the sync crawls already accepts
  // the bare fetch default.
  const response = await fetchWithAtsRateLimit(`desc:${ats}`, FETCH_RATE_LIMIT_WAIT_MS, url, {
    headers: {
      Accept: "text/html,application/xhtml+xml"
    },
    redirect: "follow"
  });
  const html = await response.text();
  return { status: response.status, html, finalUrl: String(response.url || url) };
}

// Everything one page visit can establish, as a plain object; persistence is separate so
// this stays testable against fixture HTML.
async function inspectPostingPage(url) {
  let page;
  try {
    page = await fetchPageHtml(url);
  } catch (error) {
    return { ok: false, error: String(error?.message || error) };
  }

  if (page.status === 404 || page.status === 410) {
    return { ok: true, dead: true, http_status: page.status };
  }
  if (page.status >= 400) {
    // 403/429/5xx say nothing about the posting itself. Report the failure and leave
    // the row as it was.
    return { ok: false, error: `HTTP ${page.status}`, http_status: page.status };
  }

  let html = page.html;
  // Outer document may be a shell around a same-origin content iframe (iCIMS, Paycor).
  const iframeUrl = extractContentIframeUrl(html, page.finalUrl);
  if (iframeUrl) {
    try {
      const inner = await fetchPageHtml(iframeUrl);
      if (inner.status < 400 && String(inner.html || "").length > 500) {
        html = inner.html;
      }
    } catch {}
  }

  const jsonLd = extractJsonLdJobPosting(html) || extractJsonLdJobPosting(page.html);
  let description = "";
  if (jsonLd?.description) {
    description = htmlFragmentToText(String(jsonLd.description));
  }
  if (description.length < 100) {
    description = extractDescriptionTextFromHtml(html);
  }
  description = description.slice(0, MAX_DESCRIPTION_CHARS);

  // A single-page app serves the same shell for a live posting and a deleted one, and
  // renders the 404 only after its JS runs -- Dover does exactly this. Server-side there
  // is no body text to read either way, so such a page is left `unverified` rather than
  // guessed at in either direction; only a page that actually says it is gone, or a real
  // 404 status, marks a posting dead.
  const looksLikeUnrenderedShell = !jsonLd && description.length < 200;
  const dead = !jsonLd && detectSoftNotFound(description);
  const requiresAccount = detectRequiresAccount(page.html, description) || detectRequiresAccount(html, "");

  const result = {
    ok: true,
    dead,
    unverified: !dead && looksLikeUnrenderedShell,
    http_status: page.status,
    description: dead ? "" : description,
    requires_account: requiresAccount ? 1 : 0,
    pay: null,
    hiring_locations: []
  };
  if (!dead && description) {
    result.pay = extractPayFromText(description);
    result.hiring_locations = extractHiringLocations(description);
  }
  return result;
}

async function persistInspection(row, inspection) {
  const db = getDb();
  const now = nowEpochSeconds();

  if (!inspection.ok) return { url: row.job_posting_url, ok: false, error: inspection.error };

  if (inspection.dead) {
    await db.run(
      `UPDATE Postings
       SET status = 'dead',
           dead_since_epoch = COALESCE(dead_since_epoch, ?),
           description_fetched_at = ?
       WHERE id = ?;`,
      [now, now, row.id]
    );
    return { url: row.job_posting_url, ok: true, dead: true };
  }

  const headerEntries = parseLocationsJson(row.locations_json);
  const hiringEntries = inspection.hiring_locations || [];
  const conflict = headerConflictsWithHiringLocations(headerEntries, hiringEntries) ? 1 : 0;

  const structuredPayMissing = !(Number(row.pay_min) > 0) && !(Number(row.pay_max) > 0);
  const parsedPay = structuredPayMissing ? inspection.pay : null;

  await db.run(
    `UPDATE Postings
     SET job_description = CASE WHEN ? <> '' THEN ? ELSE job_description END,
         description_fetched_at = ?,
         status = ?,
         dead_since_epoch = NULL,
         requires_account = ?,
         hiring_locations_json = ?,
         location_conflict = ?,
         -- NULLIF because these columns hold '' as often as NULL for "not known", and a
         -- bare COALESCE treats an empty string as a real value and keeps it.
         pay_min = COALESCE(pay_min, ?),
         pay_max = COALESCE(pay_max, ?),
         pay_period = COALESCE(NULLIF(pay_period, ''), ?),
         pay_raw = COALESCE(NULLIF(pay_raw, ''), ?)
     WHERE id = ?;`,
    [
      inspection.description,
      inspection.description,
      now,
      // A JS-rendered shell proves nothing about liveness either way.
      inspection.unverified ? "unverified" : "active",
      inspection.requires_account,
      hiringEntries.length > 0 ? serializeLocationsJson(hiringEntries) : null,
      conflict,
      parsedPay?.pay_min ?? null,
      parsedPay?.pay_max ?? null,
      parsedPay?.pay_period || null,
      parsedPay?.pay_raw || null,
      row.id
    ]
  );
  return {
    url: row.job_posting_url,
    ok: true,
    dead: false,
    description_chars: inspection.description.length,
    pay_parsed: Boolean(parsedPay),
    location_conflict: Boolean(conflict)
  };
}

// Fetch + persist for one posting row (needs id, job_posting_url, locations_json,
// pay_min, pay_max).
async function refreshPostingFromPage(row) {
  const inspection = await inspectPostingPage(row.job_posting_url);
  return persistInspection(row, inspection);
}

// The backfill: rows with no fetched description, newest first, bounded. Also the
// re-verification pass -- refresh_all re-visits rows whose fetch is older than
// max_age_seconds, which is what notices postings that have died since.
async function runDescriptionBackfill({ limit = 200, concurrency = 4, refresh_all = false, max_age_seconds = 7 * 86400 } = {}) {
  const db = getDb();
  const cutoff = nowEpochSeconds() - Math.max(3600, Number(max_age_seconds) || 7 * 86400);
  const rows = await db.all(
    refresh_all
      ? `SELECT id, job_posting_url, locations_json, pay_min, pay_max
         FROM Postings
         WHERE hidden = 0 AND (description_fetched_at IS NULL OR description_fetched_at < ?)
         ORDER BY (description_fetched_at IS NOT NULL), last_seen_epoch DESC
         LIMIT ?;`
      : `SELECT id, job_posting_url, locations_json, pay_min, pay_max
         FROM Postings
         WHERE hidden = 0 AND description_fetched_at IS NULL
           AND (job_description IS NULL OR TRIM(job_description) = '')
         ORDER BY last_seen_epoch DESC
         LIMIT ?;`,
    refresh_all ? [cutoff, limit] : [limit]
  );

  const summary = { scanned: rows.length, updated: 0, dead: 0, failed: 0, pay_parsed: 0, conflicts: 0 };
  let index = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(16, concurrency)) }, async () => {
    while (index < rows.length) {
      const row = rows[index];
      index += 1;
      try {
        const result = await refreshPostingFromPage(row);
        if (!result.ok) summary.failed += 1;
        else if (result.dead) summary.dead += 1;
        else {
          summary.updated += 1;
          if (result.pay_parsed) summary.pay_parsed += 1;
          if (result.location_conflict) summary.conflicts += 1;
        }
      } catch {
        summary.failed += 1;
      }
    }
  });
  await Promise.all(workers);
  return summary;
}

module.exports = {
  inspectPostingPage,
  refreshPostingFromPage,
  runDescriptionBackfill,
  extractPayFromText,
  extractHiringLocations,
  headerConflictsWithHiringLocations,
  extractJsonLdJobPosting,
  extractContentIframeUrl,
  extractDescriptionTextFromHtml,
  detectSoftNotFound,
  detectRequiresAccount,
  htmlFragmentToText
};
