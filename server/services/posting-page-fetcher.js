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
// Application-form and legal boilerplate
// ---------------------------------------------------------------------------

// CONTENT_CONTAINER_PATTERNS deliberately runs a match to the end of the file -- losing
// body text is worse than over-capturing -- so what gets stored is the role followed by
// whatever the page puts after it: the EEO self-identification survey, the application
// form's own UI, and the employer's legal footer.
//
// That tail is not inert. buildQueryTerms ranks a similarity query by raw term frequency,
// and the survey repeats "select", "veteran", "disability", "status", "gender" more often
// than the role states its own subject. Seeding from a real Strategy & Operations posting
// produced: ethos, veteran, business, select, disability, across, initiatives, life,
// product, status, disorder -- twelve of the top twenty-five terms from the form, and
// results to match. The same text also inflates every description's length, which BM25
// uses for normalisation.
//
// Two passes, because the boilerplate comes in two shapes. Everything from the point the
// application form starts is dropped outright; scattered legal sentences and form-widget
// fragments are dropped line by line.

// Lines that mean "the posting has ended and the form begins". Only honoured past
// TAIL_CUT_MIN_RATIO of the text, so a posting that merely mentions one of these phrases
// early -- an EEO-forward employer describing its own hiring practice -- keeps its body.
const APPLICATION_TAIL_MARKERS = [
  /^voluntary self[-\s]?identification/i,
  /^self[-\s]?identification of disability/i,
  /public burden statement/i,
  /paperwork reduction act/i,
  /omb control number/i,
  /^(?:apply for this job|apply now|submit application|start your application|application form)\b/i,
  /^equal employment opportunity information/i,
  /^gender\s*\*?\s*select/i,
  /are you hispanic or latin[xo]\b/i,
  /^race\s*\*?\s*(?:\(|select)/i,
  /^(?:protected )?veteran status\s*\*?\s*select/i,
  /^disability status\s*\*?\s*select/i,
  /^how do you want to be addressed/i,
  /all fields marked with \*+ are required/i
];

// Dropped wherever they appear: form widgets, portal chrome, and the legal notices that
// are identical across thousands of postings and so carry no distinguishing signal.
const BOILERPLATE_LINE_PATTERNS = [
  /select\.\.\./i,
  /^\s*-?\s*select\s*\*?\s*$/i,
  /message (?:and data rates may apply|frequency will vary)/i,
  /logged out due to inactivity/i,
  /keep your session active/i,
  /^last refresh:/i,
  /participates in e-verify/i,
  /\be-verify\b.*\b(?:social security administration|department of homeland security)\b/i,
  /^share (?:on|this job)\b/i,
  /you(?:'|’)?ve already applied for this job/i,
  /your application has been successfully submitted/i,
  /^(?:all done!|send|submit|back to all jobs|other jobs|powered by\b).{0,40}$/i,
  /qualified applicants with (?:arrest or conviction|criminal) records/i,
  /fair chance (?:ordinance|act|initiative)/i,
  /lie detector test as a condition of employment/i,
  /(?:reasonable )?accommodation.{0,80}(?:please )?(?:contact|email|call)\b/i,
  /if you (?:require|need) (?:an? )?accommodation/i,
  /^\s*[\w.+-]+@[\w-]+\.[\w.]+\s*$/,
  /this (?:employer|company) is an equal opportunity employer/i,
  /\bE\.?O\.?E\.?\b.{0,30}$/
];

// A protected-class list is the one reliable tell for an EEO statement, whose wording
// varies too much to enumerate. Three or more classes in a sentence that also carries
// discrimination language is a legal notice, not a description of the work.
const PROTECTED_CLASS_TOKENS = /\b(?:race|color|colour|religion|creed|sex|gender identity|gender expression|sexual orientation|national origin|ancestry|age|disabilit(?:y|ies)|veteran status|marital status|pregnancy|genetic information|citizenship|military status|protected class)\b/gi;
const DISCRIMINATION_CONTEXT = /\b(?:without regard to|regardless of|protected by (?:applicable )?law|equal (?:opportunity|employment)|discriminat|affirmative action)\b/i;

function looksLikeEeoStatement(line) {
  if (!DISCRIMINATION_CONTEXT.test(line)) return false;
  const matches = String(line).match(PROTECTED_CLASS_TOKENS);
  return Boolean(matches && matches.length >= 3);
}

// Never trust the patterns enough to gut a posting: if stripping removed most of the text,
// something matched that should not have, and the original is the safer answer.
const TAIL_CUT_MIN_RATIO = 0.3;
const STRIP_MIN_KEPT_RATIO = 0.4;
const STRIP_MIN_KEPT_CHARS = 200;
// Workday and other JSON-LD boards hand back the whole description as one unbroken line --
// 10,092 characters with no newline in a measured Expedia posting -- so filtering by line
// alone would leave every one of them untouched. Long lines are split into sentences and
// filtered at that granularity, which is also what lets the tail cut land mid-paragraph.
const SEGMENT_SPLIT_MIN_LINE_CHARS = 300;
// Some boards store the description with its markup intact, so a "sentence" can come back
// as a 4,000-character blob that sentence splitting cannot break up. Dropping one of those
// because a legal notice is buried inside it costs the whole block of real content -- a Bob
// Evans posting lost its benefits and purpose sections that way. Boilerplate sentences are
// short; anything this long is mixed content and is kept whatever it matches.
const MAX_DROPPABLE_SEGMENT_CHARS = 600;

function toSegments(text) {
  const segments = [];
  for (const line of String(text).split("\n")) {
    if (line.length <= SEGMENT_SPLIT_MIN_LINE_CHARS) {
      segments.push({ text: line, startsLine: true });
      continue;
    }
    const sentences = line.split(/(?<=[.!?])\s+/);
    sentences.forEach((sentence, index) => {
      segments.push({ text: sentence, startsLine: index === 0 });
    });
  }
  return segments;
}

function joinSegments(segments) {
  let out = "";
  segments.forEach((segment, index) => {
    if (index === 0) out = segment.text;
    else out += segment.startsLine ? `\n${segment.text}` : ` ${segment.text}`;
  });
  return out;
}

function stripApplicationBoilerplate(text) {
  const original = String(text || "");
  if (original.length < STRIP_MIN_KEPT_CHARS) return original;

  const segments = toSegments(original);
  const totalChars = original.length;

  let cutIndex = -1;
  let consumed = 0;
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index].text.trim();
    consumed += segments[index].text.length + 1;
    if (!segment) continue;
    if (consumed / totalChars < TAIL_CUT_MIN_RATIO) continue;
    if (APPLICATION_TAIL_MARKERS.some((pattern) => pattern.test(segment))) {
      cutIndex = index;
      break;
    }
  }

  const kept = (cutIndex >= 0 ? segments.slice(0, cutIndex) : segments).filter((segment) => {
    const line = segment.text.trim();
    if (!line) return true;
    if (line.length > MAX_DROPPABLE_SEGMENT_CHARS) return true;
    if (BOILERPLATE_LINE_PATTERNS.some((pattern) => pattern.test(line))) return false;
    if (looksLikeEeoStatement(line)) return false;
    return true;
  });

  const stripped = joinSegments(kept).replace(/\n{3,}/g, "\n\n").trim();
  if (stripped.length < STRIP_MIN_KEPT_CHARS) return original;
  if (stripped.length / original.length < STRIP_MIN_KEPT_RATIO) return original;
  return stripped;
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
  description = stripApplicationBoilerplate(description).slice(0, MAX_DESCRIPTION_CHARS);

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

  if (!inspection.ok) {
    // Left untouched, this row (description_fetched_at still NULL) reappears at the front
    // of every single backfill cycle -- a host that reliably 500s or 406s (session-gated
    // Taleo pages, TheApplicantManager's content negotiation) burned ~45% of every cycle's
    // budget retrying the same doomed URLs forever. Recording the failure lets the query
    // back off for DESCRIPTION_FETCH_FAILURE_COOLDOWN_SECONDS instead, freeing that budget
    // for postings that can actually succeed, while still retrying occasionally in case the
    // host recovers.
    await db.run(`UPDATE Postings SET description_fetch_failed_at = ? WHERE id = ?;`, [now, row.id]);
    return { url: row.job_posting_url, ok: false, error: inspection.error };
  }

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

// A permanently-failing host (session-gated Taleo detail pages, TheApplicantManager's
// content negotiation) would otherwise sit at the front of "newest, no description" and
// fail again on every single cycle forever. This is how long a failed row sits out before
// being retried, in case the host recovers.
const DESCRIPTION_FETCH_FAILURE_COOLDOWN_SECONDS = Number(
  process.env.DESCRIPTION_FETCH_FAILURE_COOLDOWN_SECONDS || 24 * 60 * 60
);

// The backfill: rows with no description at all, newest first, bounded.
//
// Scope is deliberate. A page fetch establishes several things at once -- description,
// liveness, hiring restrictions, prose pay, whether an account is needed -- and the last
// four would be worth having on every posting. But there are hundreds of thousands of
// postings and each needs its own rate-limited request, so fetching them all is not on the
// table. The split is: this bulk pass targets postings with no description, because that
// is the one gap that blocks screening entirely, while get_posting_details fetches on
// demand for the handful actually being considered, which is where the liveness and
// hiring-restriction fields earn their keep. refresh_all widens this to re-visit rows
// whose fetch has gone stale, which is what notices postings that have died since.
// anchors_only re-fetches the descriptions of postings the user applied to or shortlisted
// whose text was cleared before sync-runtime started preserving them. It is deliberately
// separate from the normal backfill and off by default: those rows are hidden, and the
// `hidden = 0` guard on the queries below is right for every other purpose -- a hidden
// posting is not a thing to spend fetches on. It is scoped to 'outside_date_window', the
// hidden_reason that means the employer still lists the role, because a 'delisted' posting
// is gone from the board and re-fetching it only burns a request on a 404.
async function selectAnchorRowsToRecover(db, limit) {
  return db.all(
    `SELECT p.id, p.job_posting_url, p.locations_json, p.pay_min, p.pay_max
       FROM posting_application_state state
       JOIN Postings p ON p.job_posting_url = state.job_posting_url
      WHERE (COALESCE(state.applied, 0) = 1 OR state.shortlisted_at_epoch IS NOT NULL)
        AND p.hidden = 1
        AND p.hidden_reason = 'outside_date_window'
        AND (p.job_description IS NULL OR TRIM(p.job_description) = '')
      ORDER BY p.last_seen_epoch DESC
      LIMIT ?;`,
    [limit]
  );
}

async function runDescriptionBackfill({ limit = 200, concurrency = 4, refresh_all = false, anchors_only = false, max_age_seconds = 7 * 86400 } = {}) {
  const db = getDb();
  const cutoff = nowEpochSeconds() - Math.max(3600, Number(max_age_seconds) || 7 * 86400);
  const failureCutoff = nowEpochSeconds() - DESCRIPTION_FETCH_FAILURE_COOLDOWN_SECONDS;
  const rows = anchors_only ? await selectAnchorRowsToRecover(db, limit) : await db.all(
    refresh_all
      ? `SELECT id, job_posting_url, locations_json, pay_min, pay_max
         FROM Postings
         WHERE hidden = 0 AND (description_fetched_at IS NULL OR description_fetched_at < ?)
           AND (description_fetch_failed_at IS NULL OR description_fetch_failed_at < ?)
         ORDER BY (description_fetched_at IS NOT NULL), last_seen_epoch DESC
         LIMIT ?;`
      : `SELECT id, job_posting_url, locations_json, pay_min, pay_max
         FROM Postings
         WHERE hidden = 0 AND description_fetched_at IS NULL
           AND (job_description IS NULL OR TRIM(job_description) = '')
           AND (description_fetch_failed_at IS NULL OR description_fetch_failed_at < ?)
         ORDER BY last_seen_epoch DESC
         LIMIT ?;`,
    refresh_all ? [cutoff, failureCutoff, limit] : [failureCutoff, limit]
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
  selectAnchorRowsToRecover,
  stripApplicationBoilerplate,
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
