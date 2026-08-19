// import ATS services
const { parseWorkdaySeededCompanySource } = require("./ats/workday/service.js");
const { parseAshbySeededCompanySource } = require("./ats/ashby/service.js");
const { parseGreenhouseSeededCompanySource } = require("./ats/greenhouse/service.js");
const { parseLeverSeededCompanySource } = require("./ats/lever/service.js");
const { parseJobviteCompany } = require("./ats/jobvite/service.js");
const { parseApplicantProCompany } = require("./ats/applicantpro/service.js");
const { parseApplyToJobCompany } = require("./ats/applytojob/service.js");
const { parseTheApplicantManagerCompany } = require("./ats/theapplicantmanager/service.js");
const { parseBreezyCompany } = require("./ats/breezy/service.js");
const { parseIcimsCompany } = require("./ats/icims/service.js");
const { parseZohoCompany } = require("./ats/zoho/service.js");
const { parseApplicantAiCompany } = require("./ats/applicantai/service.js");
const { parseGemCompany } = require("./ats/gem/service.js");
const { parseJobApsCompany } = require("./ats/jobaps/service.js");
const { parseJoinCompany } = require("./ats/join/service.js");
const { parseTalentreefCompany } = require("./ats/talentreef/service.js");
const { parseCareerplugCompany } = require("./ats/careerplug/service.js");
const { parseBambooHrCompany } = require("./ats/bamboohr/service.js");
const { parseAdpMyjobsCompany } = require("./ats/adp_myjobs/service.js");
const { parsePaycorCompany } = require("./ats/paycor/service.js");
const { parsePaycomonlineCompany } = require("./ats/paycomonline/service.js");
const { parsePrismhrCompany } = require("./ats/prismhr/service.js");
const { parseSilkroadCompany } = require("./ats/silkroad/service.js");
const { parseAdpWorkforcenowCompany } = require("./ats/adp_workforcenow/service.js");
const { parsePaylocityCompany } = require("./ats/paylocity/service.js");
const { parseEightfoldCompany } = require("./ats/eightfold/service.js");
const { parseOracleCompany } = require("./ats/oracle/service.js");
const { parseBrassringCompany } = require("./ats/brassring/service.js");
const { parseApplitrackCompanySource } = require("./ats/applitrack/service.js");
const { parseHibobCompany } = require("./ats/hibob/service.js");
const { parseisolvedCompany } = require("./ats/isolved/service.js");
const { parseAvatureSeededCompanySource } = require("./ats/avature/service.js");
const { parseComeetCompany } = require("./ats/comeet/service.js");
const { parseFactorialhrCompany } = require("./ats/factorialhr/service.js");
const { parseHireologyCompany } = require("./ats/hireology/service.js");
const { parseHiringplatformCompany } = require("./ats/hiringplatform/service.js");
const { parseHomerunCompany } = require("./ats/homerun/service.js");
const { parseJibeapplyCompany } = require("./ats/jibeapply/service.js");
const { parseJobs2webCompany } = require("./ats/jobs2web/service.js");
const { parseOccupopCompany } = require("./ats/occupop/service.js");
const { parsePeopleadminCompany } = require("./ats/peopleadmin/service.js");
const { parsePersonioCompany } = require("./ats/personio/service.js");
const { parseRecruiterflowCompany } = require("./ats/recruiterflow/service.js");
const { parseSoftgardenCompany } = require("./ats/softgarden/service.js");
const { parseTrakstarCompany } = require("./ats/trakstar/service.js");
const { parseYcombinatorCompany } = require("./ats/ycombinator/service.js");
const { parseYelloCompany } = require("./ats/yello/service.js");
const { parseCrelateCompany } = require("./ats/crelate/service.js");
const { parseManatalCompany } = require("./ats/manatal/service.js");
const { parseCareerspageCompany } = require("./ats/careerspage/service.js");
const { parsePageupCompany } = require("./ats/pageup/service.js");
const { parseHirebridgeCompany } = require("./ats/hirebridge/service.js");
const { parseTeamtailorCompany } = require("./ats/teamtailor/service.js");
const { parseFreshteamCompany } = require("./ats/freshteam/service.js");
const { parseAgilehrCompany } = require("./ats/agilehr/service.js");
const { parseSagehrCompany } = require("./ats/sagehr/service.js");
const { parseLoxoCompany } = require("./ats/loxo/service.js");
const { parsePeopleforceCompany } = require("./ats/peopleforce/service.js");
const { parseSimplicantCompany } = require("./ats/simplicant/service.js");
const { parsePinpointHqCompany } = require("./ats/pinpointhq/service.js");
const { parseRecruitCrmCompany } = require("./ats/recruitcrm/service.js");
const { parseRipplingCompany } = require("./ats/rippling/service.js");
const { parseCareerpuckCompany } = require("./ats/careerpuck/service.js");
const { parseFountainCompany } = require("./ats/fountain/service.js");
const { parseGetroCompany } = require("./ats/getro/service.js");
const { parseHrmDirectCompany } = require("./ats/hrmdirect/service.js");
const { parseTalentlyftCompany } = require("./ats/talentlyft/service.js");
const { parseTalexioCompany } = require("./ats/talexio/service.js");
const { parseSapHrCloudCompany } = require("./ats/saphrcloud/service.js");
const { parseRecruiteeCompany } = require("./ats/recruitee/service.js");
const { parseUltiProCompany } = require("./ats/ultipro/service.js");
const { parseUkgCompany } = require("./ats/ukg/service.js");
const { parseTaleoCompany } = require("./ats/taleonet/service.js");


// import helpers
const { nowEpochSeconds, parseNonNegativeInteger, normalizeBoolean, normalizePayFilterNumber, getPostingFreshnessWindowSeconds } = require("./helpers/normalize-numbers.js");
const { inferAtsFromJobPostingUrl, normalizeAtsFilterValue, ATS_FILTER_OPTIONS, ATS_FILTER_OPTION_ITEMS } = require("./helpers/normalize-ats.js");
const { parseCsvParam, normalizeStringArray, normalizeSourceUrlString, APPLICATION_STATUS_OPTIONS, APPLICATION_FIT_OPTIONS } = require("./helpers/normalize-strings.js");
const { normalizeRemoteFilter } = require("./helpers/description-filters.js");
const { MCP_SETTINGS_DEFAULTS } = require("./helpers/normalize-mcp-settings.js")

// import services
const { migrateSettingsAndApplicationsFromDatabase } = require("./services/migration.js");
const { ensureBlockedCompaniesTable, listBlockedCompanies, blockCompanyByName, unblockCompanyByName } = require("./services/blocked-companies.js");
const { ensurePersonalInformationTable, getPersonalInformation, upsertPersonalInformation } = require("./services/personal-info.js");
const { upsertSeededCompanySource } = require("./services/seeded-source.js");
const { getMcpSettings, upsertMcpSettings, buildMcpRunbook } = require("./services/mcp.js");
const { buildCoverLetterDraft, buildCoverLetterBrief } = require("./services/cover-letter.js");
const { listApplications, createApplication, updateApplicationStatus, updateApplicationFit, deleteApplicationById, getApplicationDenialStats } = require("./services/applications.js");
const { runAtsSync, getSyncScopeStats, syncStatus, createCanonicalPostingsTable, ensurePostingLocationStateIndex, startSyncStallWatchdog, getSyncCoverageStats, getLastSyncWriteEpoch } = require("./services/sync-runtime.js");
const {
  startEnrichmentLoops,
  getEnrichmentStatus,
  runSemanticIndexWorker
} = require("./services/enrichment-runtime.js");
const { startWriteLivenessWatchdog, getWriteLivenessStatus } = require("./services/write-liveness.js");
const { ensureSyncServiceSettingsTable, loadSyncServiceSettingsIntoRuntime, getSyncServiceSettings, upsertSyncServiceSettings } = require("./services/sync-settings.js");
const { listPostingsWithFilters, getPostingsByUrls, setPostingIgnoredState, getCounts, getWideScanStats } = require("./services/postings.js");
const { ensurePostingReviewSchema, setPostingReviewState } = require("./services/posting-review.js");
const {
  ensureSavedJobSearchesTable,
  listSavedJobSearches,
  createSavedJobSearch,
  updateSavedJobSearch,
  deleteSavedJobSearch
} = require("./services/saved-job-searches.js");
const { getPostingFilterOptions } = require("./services/filter-options.js");
const { extractDocumentText, getApplicantDocument, saveApplicantDocument, listApplicantDocuments, deleteApplicantDocument, checkConfiguredDocumentPaths, normalizeDocumentKind, MAX_DOCUMENT_KEY_LENGTH, APPLICANT_DOCUMENT_KINDS } = require("./services/applicant-documents.js");
const { ensureApplicationAnswersTable, listApplicationAnswers, setApplicationAnswers, clearApplicationAnswer } = require("./services/application-answers.js");
const { ensureErrorLogTable, recordError, listErrors, acknowledgeErrors } = require("./services/error-log.js");
const { getDb, setDb, setReaderDb, setStatusReaderDb, getSyncPromise, getAtsRequestQueueConcurrency } = require("./services/runtime-context.js");
const { getAtsRequestQueueStats } = require("./services/queue.js");

const cors = require("cors");
const express = require("express");
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");
const { openDatabase, getSqliteReadOnlyMode } = require("./db/open-database.js");
const { findCompanies, findPostings, runReadOnlyQuery, listReadableSchema, rejectUnsafeQuery, warmReadOnlyDb, MAX_ROWS } = require("./services/db-browser.js");
const { DB_BROWSER_PAGE } = require("./services/db-browser-page.js");
const { runQuery: runPostingQuery } = require("./services/db-query.js");
const { computeFacets } = require("./services/db-facets.js");
const { listSavedQueries, saveQuery, deleteQuery } = require("./services/saved-queries.js");
const { getApiHost, createOriginPolicy } = require("./config/api-network.js");


const PORT = Number(process.env.PORT || 8787);
const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, "..", "jobs.db");
const BACKEND_DATA_ROOT = path.dirname(DB_PATH);
const BACKEND_LOG_DIRECTORY_PATH = path.join(BACKEND_DATA_ROOT, "logs");
const FRONTEND_LOG_PATH = path.join(BACKEND_LOG_DIRECTORY_PATH, "frontend-client.log");
const SYNC_INTERVAL_MS = Number(process.env.SYNC_INTERVAL_MS || 10 * 60 * 1000);
// wal_autocheckpoint and journal_size_limit (set in initDb) bound how large the WAL can grow
// and passively reclaim its *content* into the main file, but neither ever shrinks the file
// itself back down. A connection that briefly holds an older snapshot open (an MCP client,
// a slow reader) can let the WAL grow all the way to journal_size_limit, and once nothing is
// left to reclaim it just sits at that size forever -- every later read and write pays the
// cost of a much bigger file with nothing gained. A periodic TRUNCATE checkpoint reclaims
// it: when it can't get the lock it just reports busy and no-ops, so the checkpoint attempt
// itself is harmless -- but see the comment in initDb() on walCheckpointDb for why it must
// not run on the shared write connection despite that.
//
// TRUNCATE (and FULL/RESTART) checkpoints block new writers for as long as the copy of
// outstanding WAL frames into the main file takes -- not just to acquire the lock, per
// https://www.sqlite.org/c3ref/wal_checkpoint_v2.html. On a multi-GB database under real
// disk contention that copy can itself run past the sync writer's 30s busy_timeout, which
// is what dropped 100-1200 postings at a time even after this connection was split out.
// PASSIVE never blocks and never invokes a busy handler -- it opportunistically checkpoints
// whatever it can concurrently with every other connection -- so running it often keeps the
// WAL small in small, harmless increments. That shrinks how much work is left for the rare
// blocking TRUNCATE, which only needs to run at all when PASSIVE couldn't keep up.
const WAL_CHECKPOINT_PASSIVE_INTERVAL_MS = Number(process.env.WAL_CHECKPOINT_PASSIVE_INTERVAL_MS || 30 * 1000);
const WAL_CHECKPOINT_TRUNCATE_INTERVAL_MS = Number(process.env.WAL_CHECKPOINT_TRUNCATE_INTERVAL_MS || 5 * 60 * 1000);
// Below this, TRUNCATE has nothing meaningful to reclaim -- skip the blocking attempt
// entirely rather than risk a collision for no gain.
const WAL_CHECKPOINT_TRUNCATE_MIN_WAL_BYTES = Number(
  process.env.WAL_CHECKPOINT_TRUNCATE_MIN_WAL_BYTES || 8 * 1024 * 1024
);

// Leading indicators for the failure modes that have actually hit this app before: a WAL
// the periodic checkpoint can't keep up with, the wide-scan queue backing up as the active
// posting set grows, and host memory pressure (swap, RSS approaching the systemd
// MemoryHigh ceiling) that stalls the process without any single request being at fault.
// None of these are checked against by throwing -- they are watch thresholds, tuned above
// the normal churn a healthy pass produces, so a poll of /sync/status can surface them
// early instead of waiting for a client timeout to notice.
const WAL_SIZE_WARNING_BYTES = Number(process.env.WAL_SIZE_WARNING_BYTES || 256 * 1024 * 1024);
const FILTERED_QUERY_QUEUE_WARNING_DEPTH = Number(process.env.FILTERED_QUERY_QUEUE_WARNING_DEPTH || 3);
// A percentage of swap_total, not a fixed MB figure: the steady-state swap usage a healthy
// host settles at (cold pages from idle processes, reclaimed to make room for page cache)
// is set by how much cold memory exists, not by how big the swap file is, so it does not
// grow when swap capacity does. A fixed MB threshold sized for one swap file need re-tuning
// every time swap is resized; a percentage keeps the same meaning -- "getting close to
// running out of swap entirely" -- regardless of capacity.
const SWAP_USED_WARNING_PERCENT = Number(process.env.SWAP_USED_WARNING_PERCENT || 80);
const PROCESS_RSS_WARNING_MB = Number(process.env.PROCESS_RSS_WARNING_MB || 3584);

function getWalSizeBytes() {
  try {
    return fs.statSync(`${DB_PATH}-wal`).size;
  } catch {
    return 0;
  }
}

// Linux-only (the /proc filesystem doesn't exist on the macOS/Windows desktop builds this
// same server code ships in) -- returns null rather than throwing when it's unavailable.
function getHostMemorySnapshot() {
  try {
    if (process.platform !== "linux" || !fs.existsSync("/proc/meminfo")) return null;
    const meminfo = fs.readFileSync("/proc/meminfo", "utf8");
    const readKb = (label) => {
      const match = meminfo.match(new RegExp(`^${label}:\\s+(\\d+)\\s*kB`, "m"));
      return match ? Number(match[1]) * 1024 : null;
    };
    const swapTotal = readKb("SwapTotal");
    const swapFree = readKb("SwapFree");
    const memAvailable = readKb("MemAvailable");
    if (swapTotal === null || swapFree === null) return null;
    return {
      swap_used_mb: Math.round((swapTotal - swapFree) / 1048576),
      swap_total_mb: Math.round(swapTotal / 1048576),
      mem_available_mb: memAvailable !== null ? Math.round(memAvailable / 1048576) : null
    };
  } catch {
    return null;
  }
}

// Only fires recordError on the transition into a bad state (mirrors how flush_failures
// is handled below) -- /sync/status is polled continuously, so without this a sustained
// condition would spam the error log instead of writing it once and staying quiet until
// something changes.
const activeHealthWarnings = new Set();

async function checkHealthWarnings({ walSizeBytes, hostMemory, filteredQueryQueue, rssMb }) {
  const checks = [
    {
      key: "wal_size",
      active: walSizeBytes > WAL_SIZE_WARNING_BYTES,
      message: `jobs.db-wal has grown to ${Math.round(walSizeBytes / 1048576)}MB, above the ${Math.round(WAL_SIZE_WARNING_BYTES / 1048576)}MB watch threshold -- the periodic checkpoint may not be keeping up with write volume.`
    },
    {
      key: "filtered_query_queue",
      active: Number(filteredQueryQueue?.queued || 0) >= FILTERED_QUERY_QUEUE_WARNING_DEPTH,
      message: `${filteredQueryQueue?.queued} filtered posting queries are queued behind the wide-scan lock -- the active posting set may have grown past what a single scan clears quickly.`
    },
    {
      key: "swap_used",
      active: Boolean(
        hostMemory &&
        hostMemory.swap_total_mb > 0 &&
        (hostMemory.swap_used_mb / hostMemory.swap_total_mb) * 100 > SWAP_USED_WARNING_PERCENT
      ),
      message: `Host swap usage is ${hostMemory?.swap_used_mb}MB of ${hostMemory?.swap_total_mb}MB (${
        hostMemory?.swap_total_mb > 0 ? Math.round((hostMemory.swap_used_mb / hostMemory.swap_total_mb) * 100) : "?"
      }%), above the ${SWAP_USED_WARNING_PERCENT}% watch threshold -- memory pressure can stall the process independent of any single request.`
    },
    {
      key: "process_rss",
      active: rssMb > PROCESS_RSS_WARNING_MB,
      message: `API process RSS is ${rssMb}MB, above the ${PROCESS_RSS_WARNING_MB}MB watch threshold and approaching the systemd MemoryHigh ceiling.`
    }
  ];

  for (const check of checks) {
    if (check.active && !activeHealthWarnings.has(check.key)) {
      activeHealthWarnings.add(check.key);
      await recordError({
        source: "health",
        operation: `watch:${check.key}`,
        message: check.message,
        context: {}
      }).catch(() => {});
    } else if (!check.active && activeHealthWarnings.has(check.key)) {
      activeHealthWarnings.delete(check.key);
    }
  }

  return checks
    .filter((check) => check.active)
    .map((check) => ({ key: check.key, message: check.message }));
}
// Opened lazily in initDb(). Kept off the shared write connection deliberately -- see the
// comment on startWalCheckpointTasks for why sharing it caused SQLITE_BUSY elsewhere.
let walCheckpointDb = null;




const LOCALE_SEGMENT_REGEX = /^[a-z]{2}(?:-[a-z]{2})?$/i;



const DYNAMIC_ATS_OPTIONS = new Set([
  "governmentjobs",
  "smartrecruiters",
  "policeapp",
  "usajobs",
  "k12jobspot",
  "schoolspring",
  "calcareers",
  "calopps",
  "statejobsny",
  "edjoin",
  "webcruiter",
  "academicjobsonline",
  // Both sweep their whole board from a single target, so seeding one as a company row
  // would only queue the same full sweep again under a second name.
  "amazon",
  "expedia",
  "microsoft",
  "boeing"
]);
const SEEDED_ATS_OPTIONS = new Set(
  Array.from(ATS_FILTER_OPTIONS).filter((ats) => !DYNAMIC_ATS_OPTIONS.has(String(ats || "").trim().toLowerCase()))
);





function sanitizeFrontendText(value, fallback = "") {
  const source = String(value ?? "");
  if (!source) return fallback;

  let cleaned = "";
  for (let index = 0; index < source.length; index += 1) {
    const code = source.charCodeAt(index);

    if (code >= 0xd800 && code <= 0xdbff) {
      const next = source.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        index += 1;
      }
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) {
      continue;
    }

    if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) {
      continue;
    }

    cleaned += source[index];
  }

  return cleaned || fallback;
}

function sanitizeFrontendValue(value) {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return sanitizeFrontendText(value, "");
  if (Array.isArray(value)) return value.map((item) => sanitizeFrontendValue(item));
  if (typeof value === "object") {
    const normalized = {};
    for (const [key, entryValue] of Object.entries(value)) {
      normalized[key] = sanitizeFrontendValue(entryValue);
    }
    return normalized;
  }
  return value;
}

function ensureFrontendLogDirectory() {
  fs.mkdirSync(BACKEND_LOG_DIRECTORY_PATH, { recursive: true });
}

function normalizeFrontendLogLevel(value) {
  const normalized = String(value || "info")
    .trim()
    .toLowerCase();
  if (["debug", "info", "warn", "error", "fatal"].includes(normalized)) {
    return normalized;
  }
  return "info";
}

function appendFrontendLogEntry(level, eventName, message, context) {
  ensureFrontendLogDirectory();

  const timestamp = new Date().toISOString();
  const entry = {
    timestamp,
    level: normalizeFrontendLogLevel(level),
    event: sanitizeFrontendText(eventName, "frontend_event"),
    message: sanitizeFrontendText(message, ""),
    context: sanitizeFrontendValue(context || {})
  };

  const line = `${JSON.stringify(entry)}\n`;
  fs.appendFileSync(FRONTEND_LOG_PATH, line, "utf8");
}






function ensureMcpAgentEnabled(settings) {
  if (normalizeBoolean(settings?.enabled, false)) return;
  const error = /** @type {Error & { statusCode: number }} */ (
    new Error("MCP application agent is disabled in settings.")
  );
  error.statusCode = 403;
  throw error;
}






const SEEDED_COMPANY_SOURCE_PARSER_BY_ATS = Object.freeze({
  workday: parseWorkdaySeededCompanySource,
  ashby: parseAshbySeededCompanySource,
  greenhouse: parseGreenhouseSeededCompanySource,
  lever: parseLeverSeededCompanySource,
  recruitee: parseRecruiteeCompany,
  ultipro: parseUltiProCompany,
  taleo: parseTaleoCompany,
  jobvite: parseJobviteCompany,
  applicantpro: parseApplicantProCompany,
  applytojob: parseApplyToJobCompany,
  icims: parseIcimsCompany,
  theapplicantmanager: parseTheApplicantManagerCompany,
  breezy: parseBreezyCompany,
  zoho: parseZohoCompany,
  applicantai: parseApplicantAiCompany,
  careerplug: parseCareerplugCompany,
  bamboohr: parseBambooHrCompany,
  manatal: parseManatalCompany,
  careerpuck: parseCareerpuckCompany,
  fountain: parseFountainCompany,
  getro: parseGetroCompany,
  hrmdirect: parseHrmDirectCompany,
  talentlyft: parseTalentlyftCompany,
  talexio: parseTalexioCompany,
  teamtailor: parseTeamtailorCompany,
  freshteam: parseFreshteamCompany,
  agilehr: parseAgilehrCompany,
  sagehr: parseSagehrCompany,
  loxo: parseLoxoCompany,
  peopleforce: parsePeopleforceCompany,
  simplicant: parseSimplicantCompany,
  pinpointhq: parsePinpointHqCompany,
  recruitcrm: parseRecruitCrmCompany,
  rippling: parseRipplingCompany,
  gem: parseGemCompany,
  jobaps: parseJobApsCompany,
  join: parseJoinCompany,
  talentreef: parseTalentreefCompany,
  saphrcloud: parseSapHrCloudCompany,
  adp_myjobs: parseAdpMyjobsCompany,
  paycor: parsePaycorCompany,
  paycomonline: parsePaycomonlineCompany,
  prismhr: parsePrismhrCompany,
  silkroad: parseSilkroadCompany,
  adp_workforcenow: parseAdpWorkforcenowCompany,
  careerspage: parseCareerspageCompany,
  oracle: parseOracleCompany,
  paylocity: parsePaylocityCompany,
  eightfold: parseEightfoldCompany,
  hirebridge: parseHirebridgeCompany,
  pageup: parsePageupCompany,
  brassring: parseBrassringCompany,
  applitrack: parseApplitrackCompanySource,
  hibob: parseHibobCompany,
  isolved: parseisolvedCompany,
  avature: parseAvatureSeededCompanySource,
  comeet: parseComeetCompany,
  factorialhr: parseFactorialhrCompany,
  hireology: parseHireologyCompany,
  crelate: parseCrelateCompany,
  hiringplatform: parseHiringplatformCompany,
  homerun: parseHomerunCompany,
  jibeapply: parseJibeapplyCompany,
  jobs2web: parseJobs2webCompany,
  occupop: parseOccupopCompany,
  peopleadmin: parsePeopleadminCompany,
  personio: parsePersonioCompany,
  recruiterflow: parseRecruiterflowCompany,
  softgarden: parseSoftgardenCompany,
  trakstar: parseTrakstarCompany,
  ukg: parseUkgCompany,
  ycombinator: parseYcombinatorCompany,
  yello: parseYelloCompany
});

const ATS_LABEL_BY_VALUE = new Map(
  ATS_FILTER_OPTION_ITEMS.map((item) => [String(item?.value || "").trim().toLowerCase(), String(item?.label || "").trim()])
);

function isParserFieldValue(value) {
  return typeof value === "string" || typeof value === "number";
}

function isLikelyUrlFieldKey(fieldName) {
  const lower = String(fieldName || "").trim().toLowerCase();
  if (!lower) return false;
  return (
    lower.endsWith("url") ||
    lower.includes("origin") ||
    lower.includes("base") ||
    lower.includes("host") ||
    lower === "finder"
  );
}

function getCanonicalSeededSourceUrl(parsedConfig, fallbackUrl) {
  const config = parsedConfig && typeof parsedConfig === "object" ? parsedConfig : {};
  const candidateKeys = [
    "boardUrl",
    "jobsUrl",
    "searchUrl",
    "companyBaseUrl",
    "baseSectionUrl",
    "baseBoardUrl",
    "careersUrl",
    "applyUrl",
    "portalUrl",
    "publicJobsUrl",
    "siteRoot",
    "baseUrl"
  ];
  for (const key of candidateKeys) {
    const value = String(config?.[key] || "").trim();
    if (!value) continue;
    const normalized = normalizeSourceUrlString(value);
    if (normalized) return normalized;
  }
  return normalizeSourceUrlString(fallbackUrl);
}

function extractSeededCompanyIdentifier(parsedConfig) {
  const config = parsedConfig && typeof parsedConfig === "object" ? parsedConfig : {};

  const compoundIdentifiers = [
    { key: "cid+ccId", values: ["cid", "ccId"], separator: ":" },
    { key: "partnerId+siteId", values: ["partnerId", "siteId"], separator: ":" }
  ];
  for (const identifier of compoundIdentifiers) {
    const values = identifier.values
      .map((field) => String(config?.[field] ?? "").trim())
      .filter(Boolean);
    if (values.length === identifier.values.length) {
      return { key: identifier.key, value: values.join(identifier.separator) };
    }
  }

  const preferredKeys = [
    "companyIdRaw",
    "companyId",
    "organizationHostedJobsPageName",
    "boardToken",
    "organization",
    "companySlug",
    "subdomain",
    "companySubdomain",
    "companyName",
    "clientKey",
    "boardId",
    "tenant",
    "careerSection",
    "boardSlug",
    "domainSlug",
    "account",
    "slug",
    "companyCode",
    "siteNumber"
  ];
  for (const key of preferredKeys) {
    if (!isParserFieldValue(config?.[key])) continue;
    const value = String(config[key]).trim();
    if (!value) continue;
    return { key, value };
  }

  for (const [key, rawValue] of Object.entries(config)) {
    if (!isParserFieldValue(rawValue)) continue;
    if (isLikelyUrlFieldKey(key)) continue;
    const value = String(rawValue).trim();
    if (!value) continue;
    return { key, value };
  }

  return { key: "url", value: "" };
}

function toSeededParserPreviewFields(parsedConfig) {
  const config = parsedConfig && typeof parsedConfig === "object" ? parsedConfig : {};
  const fields = {};
  for (const [key, rawValue] of Object.entries(config)) {
    if (!isParserFieldValue(rawValue)) continue;
    if (isLikelyUrlFieldKey(key)) continue;
    const value = String(rawValue).trim();
    if (!value) continue;
    fields[key] = value;
  }
  return fields;
}

function buildSuggestedCompanyName(ats, identifierValue) {
  const label = ATS_LABEL_BY_VALUE.get(String(ats || "").trim().toLowerCase()) || String(ats || "").trim();
  const identifier = String(identifierValue || "").trim();
  if (!identifier) return label || "Company";
  return identifier.replace(/[_-]+/g, " ").trim() || label || "Company";
}

function listSeededAtsValues() {
  const parserSupported = new Set(Object.keys(SEEDED_COMPANY_SOURCE_PARSER_BY_ATS));
  return Array.from(SEEDED_ATS_OPTIONS)
    .map((value) => String(value || "").trim().toLowerCase())
    .filter((value) => parserSupported.has(value))
    .sort((a, b) => a.localeCompare(b));
}

function classifySeededCompanySourceUrl(urlString) {
  const normalizedUrl = normalizeSourceUrlString(urlString);
  if (!normalizedUrl) {
    return {
      supported: false,
      reason: "invalid_url",
      message: "URL is invalid or missing a supported protocol.",
      normalized_url: ""
    };
  }

  const inferredAts = normalizeAtsFilterValue(inferAtsFromJobPostingUrl(normalizedUrl));
  if (DYNAMIC_ATS_OPTIONS.has(inferredAts)) {
    return {
      supported: false,
      reason: "dynamic_ats_not_supported",
      message: "Dynamic ATS URLs are not supported by this extension.",
      normalized_url: normalizedUrl,
      ats: inferredAts
    };
  }

  const parserEntries = [];
  if (inferredAts && SEEDED_COMPANY_SOURCE_PARSER_BY_ATS[inferredAts]) {
    parserEntries.push([inferredAts, SEEDED_COMPANY_SOURCE_PARSER_BY_ATS[inferredAts]]);
  }
  for (const [ats, parser] of Object.entries(SEEDED_COMPANY_SOURCE_PARSER_BY_ATS)) {
    if (parserEntries.some((entry) => entry[0] === ats)) continue;
    parserEntries.push([ats, parser]);
  }

  for (const [ats, parser] of parserEntries) {
    let parsedConfig = null;
    try {
      parsedConfig = parser(normalizedUrl);
    } catch {
      parsedConfig = null;
    }
    if (!parsedConfig) continue;

    const identifier = extractSeededCompanyIdentifier(parsedConfig);
    const canonicalUrl = getCanonicalSeededSourceUrl(parsedConfig, normalizedUrl);
    const parserFields = toSeededParserPreviewFields(parsedConfig);
    const suggestedCompanyName = buildSuggestedCompanyName(ats, identifier.value);

    return {
      supported: true,
      reason: "seeded_match",
      normalized_url: normalizedUrl,
      canonical_url: canonicalUrl || normalizedUrl,
      ats,
      ats_label: ATS_LABEL_BY_VALUE.get(ats) || ats,
      company_identifier: identifier.value,
      company_identifier_key: identifier.key,
      parsed_fields: parserFields,
      suggested_company_name: suggestedCompanyName
    };
  }

  if (inferredAts && SEEDED_ATS_OPTIONS.has(inferredAts)) {
    return {
      supported: false,
      reason: "seeded_parser_not_available",
      message: `Seeded ATS '${inferredAts}' is recognized but no company source parser is available for this URL shape.`,
      normalized_url: normalizedUrl,
      ats: inferredAts
    };
  }

  return {
    supported: false,
    reason: "unrecognized_or_not_seeded",
    message: "URL does not match a supported seeded ATS company source.",
    normalized_url: normalizedUrl
  };
}

function pickCompanyId(pathParts, subdomain) {
  if (!Array.isArray(pathParts) || pathParts.length === 0) return subdomain;

  const [first = "", second = ""] = pathParts;
  if (first && LOCALE_SEGMENT_REGEX.test(first) && second) {
    return second;
  }

  return first || subdomain;
}






function buildJobUrl(companyBaseUrl, externalPath) {
  if (typeof externalPath !== "string" || !externalPath.trim()) return "";
  const normalizedPath = externalPath.startsWith("/") ? externalPath : `/${externalPath}`;
  return `${companyBaseUrl}${normalizedPath}`;
}

function formatLocationSegment(rawLocation) {
  if (typeof rawLocation !== "string") return null;
  const trimmed = rawLocation.trim();
  if (!trimmed) return null;

  const doubleDashToken = "__DOUBLE_DASH__";
  return trimmed
    .replace(/--+/g, doubleDashToken)
    .replace(/-/g, " ")
    .replace(new RegExp(doubleDashToken, "g"), "- ")
    .replace(/\s+/g, " ")
    .trim();
}





async function ensureCompaniesTableSchema() {
  const db = getDb();
  const tableInfo = await db.all(`PRAGMA table_info('companies');`);
  const columns = new Set(tableInfo.map((column) => String(column?.name || "")));
}

async function initDb() {
  setDb(await openDatabase({
    filename: DB_PATH
  }));

  // A second connection on the same file, read-only, for the endpoints the app polls.
  // Registered explicitly with DB_PATH rather than letting the helper guess, because a
  // reader pointing at a different database than the writer is a correctness bug, not a
  // performance one. Opened after the writer so a failure here degrades to sharing the
  // writer rather than preventing startup.
  try {
    const reader = await openDatabase({ filename: DB_PATH, mode: getSqliteReadOnlyMode() });
    await reader.exec("PRAGMA busy_timeout = 15000; PRAGMA cache_size = -65536;");
    setReaderDb(reader);
    console.log("[OpenPostings API] reader connection open (app reads do not queue behind sync writes)");
  } catch (error) {
    console.error("[OpenPostings API] reader connection unavailable, falling back to the shared one:", error?.message || error);
  }

  // A fourth connection, dedicated to the cheap, continuously-polled reads (/sync/status's
  // counts and coverage stats). See the comment on getStatusReadDb() in runtime-context.js:
  // these shared the connection above with listPostingsWithFilters, so a slow wide-scan
  // /postings query (states + review_queue filters) could make status polling queue behind
  // it and blow through the client's 30s timeout even though nothing was actually down.
  // Small cache -- these are aggregate queries over a handful of tables, not the hot listing
  // path -- so it isn't worth duplicating the 64MB the listing reader keeps warm.
  try {
    const statusReader = await openDatabase({ filename: DB_PATH, mode: getSqliteReadOnlyMode() });
    await statusReader.exec("PRAGMA busy_timeout = 15000; PRAGMA cache_size = -16384;");
    setStatusReaderDb(statusReader);
    console.log("[OpenPostings API] status reader connection open (status polling does not queue behind wide-scan postings queries)");
  } catch (error) {
    console.error("[OpenPostings API] status reader connection unavailable, falling back to the shared reader:", error?.message || error);
  }

  // A fifth connection: the read-only /db browser's. It used to open itself on the first
  // request, which put a thread-pool-queued open in front of a user who had just clicked
  // "DB" -- 80.5s mid-sync, against 2.8ms for every request after it. Opening it here costs
  // the same work at a moment nobody is waiting on it. Non-fatal: /db still works without
  // it, just as slowly on the first hit as it did before.
  try {
    await warmReadOnlyDb();
    console.log("[OpenPostings API] db browser connection open (first /db request does not pay for the open)");
  } catch (error) {
    console.error("[OpenPostings API] db browser connection unavailable, /db will open one on demand:", error?.message || error);
  }

  // A third connection, dedicated to the periodic WAL truncate checkpoint below. TRUNCATE
  // mode needs to briefly block new writers while it acquires the checkpoint lock, and it
  // retries for as long as its connection's busy_timeout allows -- if it ran on the shared
  // write connection (30s busy_timeout), it queued up behind every other statement on that
  // connection and every statement after it queued up behind the checkpoint's own retry
  // loop, which is exactly the shape of the SQLITE_BUSY failures the sync's flush started
  // hitting. Its own busy_timeout is short on purpose: a checkpoint that cannot get the
  // lock quickly should skip this round and try again next interval, not hold anything up.
  try {
    walCheckpointDb = await openDatabase({ filename: DB_PATH });
    await walCheckpointDb.exec("PRAGMA busy_timeout = 200;");
  } catch (error) {
    console.error("[OpenPostings API] WAL checkpoint connection unavailable, periodic truncation disabled:", error?.message || error);
    walCheckpointDb = null;
  }

  const db = getDb();

  await db.exec(`
    -- Other processes legitimately hold the write lock for moments at a time (the MCP
    -- server's startup DDL, maintenance scripts). Without a timeout a locked write fails
    -- instantly with SQLITE_BUSY, and the sync's storage-error handling once escalated
    -- exactly that into dropping the Postings table. Wait instead.
    PRAGMA busy_timeout = 30000;

    -- 2 MB of page cache for a 2.4 GB database meant almost every read touched disk. 256 MB
    -- is still small relative to the file but covers the hot indexes.
    PRAGMA cache_size = -262144;

    -- The WAL sat at 412 MB for days. Raising the checkpoint threshold to 20,000 pages was
    -- the wrong direction: it let the file grow further, and every reader scans it, so reads
    -- got slower rather than faster. Worse, SQLite checkpoints on the last connection close,
    -- so a 412 MB WAL added fourteen seconds to every shutdown -- the bulk of what was left
    -- of the restart window after the process layers were removed.
    --
    -- 4,000 pages checkpoints often enough to keep the file small, and journal_size_limit is
    -- what actually stops it growing without bound: without it the WAL is checkpointed but
    -- never truncated, so it stays at its high-water mark forever.
    PRAGMA wal_autocheckpoint = 4000;
    PRAGMA journal_size_limit = 67108864;

    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS companies (
      id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      company_name TEXT NOT NULL,
      url_string TEXT NOT NULL,
      ATS_name TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_url_string
      ON companies(url_string);

    CREATE INDEX IF NOT EXISTS idx_companies_company_name
      ON companies(company_name);
  `);

  await ensurePostingsTable();
  await ensurePostingLocationStateIndex();
  await ensurePersonalInformationTable();
  await ensureApplicationsTable();
  await ensureBlockedCompaniesTable();
  await ensureApplicationAnswersTable();
  await ensureErrorLogTable();
  await ensureSavedJobSearchesTable();
  // Real wall-clock time of the last sync write. Kept separate from Postings.last_seen_epoch,
  // which records when a pass started rather than when a row was written.
  await db.exec(`
    CREATE TABLE IF NOT EXISTS sync_write_heartbeat (
      id INTEGER NOT NULL PRIMARY KEY CHECK (id = 1),
      wrote_at_epoch INTEGER NOT NULL
    );
  `);
  await ensureSyncServiceSettingsTable();
  await loadSyncServiceSettingsIntoRuntime();
  await ensureCompaniesTableSchema();
  await refreshQueryPlannerStats();
}

// Without sqlite_stat1 the planner has no way to tell idx_postings_hidden_last_seen_epoch
// is worth using for the listing sort, and falls back to sorting the whole visible set in
// a temp b-tree -- measured at 1004ms against 3ms once stats exist. Existing installs have
// never had stats, since nothing in the app has ever run ANALYZE. PRAGMA optimize only
// analyses what has drifted, so it costs ~28ms here rather than the ~206ms of a full
// ANALYZE, and is safe to repeat.
async function refreshQueryPlannerStats() {
  const db = getDb();
  try {
    await db.exec(`PRAGMA optimize;`);
  } catch (error) {
    // Stats are an optimisation, never a correctness requirement: a failure here should
    // leave the server running on the old plans rather than refusing to start.
    console.error(`PRAGMA optimize failed: ${String(error?.message || error)}`);
  }
}


async function ensurePostingsTable() {
  const db = getDb();
  const tableInfo = await db.all(`PRAGMA table_info('Postings');`);

  if (!Array.isArray(tableInfo) || tableInfo.length === 0) {
    await createCanonicalPostingsTable();
    return;
  }

  const requiredColumns = new Set(["id", "company_name", "position_name", "job_posting_url", "posting_date"]);
  const existingColumns = new Set(tableInfo.map((column) => String(column.name)));
  const requiredPresent = Array.from(requiredColumns).every((column) => existingColumns.has(column));

  let incompatibleExtraRequiredColumns = false;
  for (const column of tableInfo) {
    const name = String(column.name);
    if (requiredColumns.has(name)) continue;
    if (Number(column.notnull) === 1 && column.dflt_value === null) {
      incompatibleExtraRequiredColumns = true;
      break;
    }
  }

  if (!requiredPresent || incompatibleExtraRequiredColumns) {
    const db = getDb();
    await db.exec(`DROP TABLE IF EXISTS Postings;`);
    await createCanonicalPostingsTable();
    return;
  }

  if (!existingColumns.has("last_seen_epoch")) {
    await db.exec(`ALTER TABLE Postings ADD COLUMN last_seen_epoch INTEGER;`);
    await db.run(`UPDATE Postings SET last_seen_epoch = ? WHERE last_seen_epoch IS NULL;`, [nowEpochSeconds()]);
  }

  if (!existingColumns.has("first_seen_epoch")) {
    await db.exec(`ALTER TABLE Postings ADD COLUMN first_seen_epoch INTEGER;`);
  }
  // Runs on every startup, not just when the column is added: the freshness predicates in
  // pruneExpiredPostings and the listing queries read first_seen_epoch bare so the planner
  // can use idx_postings_hidden_first_seen_epoch, which relies on it never being NULL.
  await db.run(
    `
      UPDATE Postings
      SET first_seen_epoch = COALESCE(first_seen_epoch, last_seen_epoch, ?)
      WHERE first_seen_epoch IS NULL;
    `,
    [nowEpochSeconds()]
  );

  if (!existingColumns.has("hidden")) {
    await db.exec(`ALTER TABLE Postings ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;`);
  }

  if (!existingColumns.has("hidden_at_epoch")) {
    await db.exec(`ALTER TABLE Postings ADD COLUMN hidden_at_epoch INTEGER;`);
  }

  if (!existingColumns.has("job_description")) {
    await db.exec(`ALTER TABLE Postings ADD COLUMN job_description TEXT;`);
  }

  // Location used to live only in an in-memory map, so it was lost on every restart
  // and location filters silently matched nothing for postings the running sync had
  // not re-crawled yet. Existing rows backfill from that map as the sync touches them.
  if (!existingColumns.has("location")) {
    await db.exec(`ALTER TABLE Postings ADD COLUMN location TEXT;`);
  }

  if (!existingColumns.has("compensation_type")) {
    await db.exec(`ALTER TABLE Postings ADD COLUMN compensation_type TEXT;`);
  }

  if (!existingColumns.has("education_levels")) {
    await db.exec(`ALTER TABLE Postings ADD COLUMN education_levels TEXT;`);
  }

  if (!existingColumns.has("pay_min")) {
    await db.exec(`ALTER TABLE Postings ADD COLUMN pay_min REAL;`);
  }

  if (!existingColumns.has("pay_max")) {
    await db.exec(`ALTER TABLE Postings ADD COLUMN pay_max REAL;`);
  }

  if (!existingColumns.has("pay_currency")) {
    await db.exec(`ALTER TABLE Postings ADD COLUMN pay_currency TEXT;`);
  }

  if (!existingColumns.has("pay_period")) {
    await db.exec(`ALTER TABLE Postings ADD COLUMN pay_period TEXT;`);
  }

  if (!existingColumns.has("pay_raw")) {
    await db.exec(`ALTER TABLE Postings ADD COLUMN pay_raw TEXT;`);
  }

  // Structured location fields, parsed from the raw location string at ingest
  // (helpers/parse-location.js). The raw string stays in `location` for display; these
  // are what filters match against, so a Kent WA filter cannot match Kent, England.
  if (!existingColumns.has("city")) {
    await db.exec(`ALTER TABLE Postings ADD COLUMN city TEXT;`);
  }
  if (!existingColumns.has("state_region")) {
    await db.exec(`ALTER TABLE Postings ADD COLUMN state_region TEXT;`);
  }
  if (!existingColumns.has("country")) {
    await db.exec(`ALTER TABLE Postings ADD COLUMN country TEXT;`);
  }
  if (!existingColumns.has("is_remote")) {
    await db.exec(`ALTER TABLE Postings ADD COLUMN is_remote INTEGER NOT NULL DEFAULT 0;`);
  }
  if (!existingColumns.has("locations_json")) {
    await db.exec(`ALTER TABLE Postings ADD COLUMN locations_json TEXT;`);
  }

  // Where the body of the description says hiring is restricted to a subset of the header
  // locations, the subset lives here and location_conflict flags the disagreement.
  if (!existingColumns.has("hiring_locations_json")) {
    await db.exec(`ALTER TABLE Postings ADD COLUMN hiring_locations_json TEXT;`);
  }
  if (!existingColumns.has("location_conflict")) {
    await db.exec(`ALTER TABLE Postings ADD COLUMN location_conflict INTEGER NOT NULL DEFAULT 0;`);
  }

  // When the description text was last fetched from the posting page, as opposed to
  // arriving inline with the board listing.
  if (!existingColumns.has("description_fetched_at")) {
    await db.exec(`ALTER TABLE Postings ADD COLUMN description_fetched_at INTEGER;`);
  }

  // Liveness: 'active' (verified reachable), 'dead' (404 or soft-404), 'unverified'
  // (never checked). Dead postings are excluded from candidate lists by default.
  if (!existingColumns.has("status")) {
    await db.exec(`ALTER TABLE Postings ADD COLUMN status TEXT NOT NULL DEFAULT 'unverified';`);
  }
  if (!existingColumns.has("dead_since_epoch")) {
    await db.exec(`ALTER TABLE Postings ADD COLUMN dead_since_epoch INTEGER;`);
  }

  // Whether the application flow demands a candidate account (NULL = not yet detected),
  // so the UI can flag applications that need a manual sign-in.
  if (!existingColumns.has("requires_account")) {
    await db.exec(`ALTER TABLE Postings ADD COLUMN requires_account INTEGER;`);
  }

  // Why a posting is hidden, not just that it is. Two unrelated pruners set hidden = 1:
  // one for postings the ATS has stopped listing ('delisted'), one for postings whose
  // posting_date falls outside the freshness window ('outside_date_window'). The second
  // kind is still live and still applyable -- a DoorDash role open 22 days reads exactly
  // like one that was taken down -- and with a single boolean there was no way to ask for
  // one and not the other. Empty means visible.
  // Sync progress, so a pass survives a restart. Without it every pass walked the company
  // table in rowid order from the top, and since a pass takes hours, any restart re-crawled
  // the same front of the list and never reached the tail -- whole ATS platforms could go
  // permanently unsynced.
  const companyColumns = await db.all(`PRAGMA table_info('companies');`);
  if (!companyColumns.some((column) => String(column?.name) === "last_synced_epoch")) {
    await db.exec(`ALTER TABLE companies ADD COLUMN last_synced_epoch INTEGER;`);
  }
  // The sync orders every pass by this column, so it needs to be an index scan rather than
  // a sort of 61,612 rows on each start.
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_companies_last_synced ON companies (last_synced_epoch, id);`);

  if (!existingColumns.has("hidden_reason")) {
    await db.exec(`ALTER TABLE Postings ADD COLUMN hidden_reason TEXT NOT NULL DEFAULT '';`);
    // Existing hidden rows predate the column. last_seen_epoch is what distinguishes the
    // two: a row the sync has seen recently was hidden for its date, not for going away.
    await db.run(
      `UPDATE Postings
       SET hidden_reason = CASE WHEN last_seen_epoch >= ? THEN 'outside_date_window' ELSE 'delisted' END
       WHERE hidden = 1 AND hidden_reason = '';`,
      [nowEpochSeconds() - getPostingFreshnessWindowSeconds()]
    );
  }

  await db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_postings_job_posting_url
      ON Postings(job_posting_url);

    CREATE INDEX IF NOT EXISTS idx_postings_company_name
      ON Postings(company_name);

    CREATE INDEX IF NOT EXISTS idx_postings_position_name
      ON Postings(position_name);

    CREATE INDEX IF NOT EXISTS idx_postings_last_seen_epoch
      ON Postings(last_seen_epoch);

    CREATE INDEX IF NOT EXISTS idx_postings_first_seen_epoch
      ON Postings(first_seen_epoch);

    CREATE INDEX IF NOT EXISTS idx_postings_hidden_first_seen_epoch
      ON Postings(hidden, first_seen_epoch);

    CREATE INDEX IF NOT EXISTS idx_postings_hidden_hidden_at_epoch
      ON Postings(hidden, hidden_at_epoch);

    CREATE INDEX IF NOT EXISTS idx_postings_hidden_last_seen_epoch
      ON Postings(hidden, last_seen_epoch);

    CREATE INDEX IF NOT EXISTS idx_postings_location
      ON Postings(location);

    CREATE INDEX IF NOT EXISTS idx_postings_state_region
      ON Postings(state_region);
  `);
}


async function ensureApplicationsTable() {
  const db = getDb();
  await db.exec(`
    CREATE TABLE IF NOT EXISTS applications (
      id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL,
      position_name TEXT NOT NULL,
      application_date INTEGER NOT NULL,
      status TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_applications_company_id
      ON applications(company_id);

    CREATE INDEX IF NOT EXISTS idx_applications_application_date
      ON applications(application_date);

    CREATE INDEX IF NOT EXISTS idx_applications_status
      ON applications(status);

    -- Every status transition an application goes through, so denial-rate and
    -- time-to-decision metrics can be computed without applications.status having
    -- already overwritten the prior value.
    CREATE TABLE IF NOT EXISTS application_status_history (
      id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      application_id INTEGER NOT NULL,
      previous_status TEXT,
      new_status TEXT NOT NULL,
      changed_at_epoch INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_application_status_history_application_id
      ON application_status_history(application_id);

    CREATE INDEX IF NOT EXISTS idx_application_status_history_new_status
      ON application_status_history(new_status, changed_at_epoch);

    CREATE TABLE IF NOT EXISTS application_attribution (
      application_id INTEGER NOT NULL PRIMARY KEY,
      applied_by_type TEXT NOT NULL,
      applied_by_label TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS posting_application_state (
      job_posting_url TEXT NOT NULL PRIMARY KEY,
      applied INTEGER NOT NULL DEFAULT 0,
      applied_by_type TEXT NOT NULL,
      applied_by_label TEXT NOT NULL,
      applied_at_epoch INTEGER,
      last_application_id INTEGER,
      ignored INTEGER NOT NULL DEFAULT 0,
      ignored_at_epoch INTEGER,
      ignored_by_label TEXT NOT NULL DEFAULT '',
      review_state TEXT NOT NULL DEFAULT 'unseen',
      review_state_changed_at_epoch INTEGER,
      viewed_at_epoch INTEGER,
      shortlisted_at_epoch INTEGER,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_posting_application_state_applied
      ON posting_application_state(applied);

    CREATE INDEX IF NOT EXISTS idx_posting_application_state_ignored
      ON posting_application_state(ignored);

    CREATE TABLE IF NOT EXISTS McpSettings (
      id INTEGER NOT NULL PRIMARY KEY CHECK (id = 1),
      enabled INTEGER NOT NULL DEFAULT 0,
      preferred_agent_name TEXT NOT NULL DEFAULT 'OpenPostings Agent',
      mfa_login_email TEXT NOT NULL DEFAULT '',
      mfa_login_notes TEXT NOT NULL DEFAULT '',
      dry_run_only INTEGER NOT NULL DEFAULT 1,
      require_final_approval INTEGER NOT NULL DEFAULT 1,
      max_applications_per_run INTEGER NOT NULL DEFAULT 10,
      preferred_search TEXT NOT NULL DEFAULT '',
      preferred_remote TEXT NOT NULL DEFAULT 'all',
      preferred_industries TEXT NOT NULL DEFAULT '[]',
      preferred_regions TEXT NOT NULL DEFAULT '[]',
      preferred_countries TEXT NOT NULL DEFAULT '[]',
      preferred_states TEXT NOT NULL DEFAULT '[]',
      preferred_counties TEXT NOT NULL DEFAULT '[]',
      instructions_for_agent TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  await db.run(
    `
      INSERT INTO McpSettings (
        id,
        enabled,
        preferred_agent_name,
        mfa_login_email,
        mfa_login_notes,
        dry_run_only,
        require_final_approval,
        max_applications_per_run,
        preferred_search,
        preferred_remote,
        preferred_industries,
        preferred_regions,
        preferred_countries,
        preferred_states,
        preferred_counties,
        instructions_for_agent
      ) VALUES (1, 0, ?, '', '', 1, 1, 10, '', 'all', '[]', '[]', '[]', '[]', '[]', '')
      ON CONFLICT(id) DO NOTHING;
    `,
    [MCP_SETTINGS_DEFAULTS.preferred_agent_name]
  );

  const postingStateColumns = await db.all(`PRAGMA table_info('posting_application_state');`);
  const postingStateColumnNames = new Set(postingStateColumns.map((column) => String(column?.name || "")));
  const mcpSettingsColumns = await db.all(`PRAGMA table_info('McpSettings');`);
  const mcpSettingsColumnNames = new Set(mcpSettingsColumns.map((column) => String(column?.name || "")));

  if (!postingStateColumnNames.has("ignored")) {
    await db.exec(`
      ALTER TABLE posting_application_state
      ADD COLUMN ignored INTEGER NOT NULL DEFAULT 0;
    `);
  }
  if (!postingStateColumnNames.has("ignored_at_epoch")) {
    await db.exec(`
      ALTER TABLE posting_application_state
      ADD COLUMN ignored_at_epoch INTEGER;
    `);
  }
  if (!postingStateColumnNames.has("ignored_by_label")) {
    await db.exec(`
      ALTER TABLE posting_application_state
      ADD COLUMN ignored_by_label TEXT NOT NULL DEFAULT '';
    `);
  }
  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_posting_application_state_ignored
      ON posting_application_state(ignored);
  `);
  await ensurePostingReviewSchema(db);

  // These columns used to hold the agent's login email and password in plaintext, handed
  // to the agent so it could create accounts and sign in as the user. That capability is
  // gone. SQLite before 3.35 cannot DROP COLUMN and the column may be NOT NULL, so the
  // values are overwritten with empty strings here and simply never read again -- which
  // also scrubs the secret from any database that already stored one.

  // An application records something that happened in the real world, so it must be
  // storable whether or not the employer is in the crawl table. It was not: company_id was
  // NOT NULL and had to point at a `companies` row matched by exact lowercase name, and
  // Amazon's postings carry legal entity names ("Amazon.com Services LLC", "Amazon Data
  // Services, Inc.") that have no such row -- nor does plain "Amazon". Submissions really
  // made were thrown away at the last step because of an internal join.
  //
  // company_name is denormalised onto the row so the employer survives regardless, and
  // company_id becomes optional. SQLite cannot drop a NOT NULL constraint, so the table is
  // rebuilt when the old one is still in place. Ids are preserved: application_attribution
  // and posting_application_state.last_application_id both reference them.
  const applicationColumns = await db.all(`PRAGMA table_info('applications');`);
  const applicationColumnNames = new Set(applicationColumns.map((column) => String(column?.name || "")));
  if (!applicationColumnNames.has("company_name")) {
    await db.exec(`ALTER TABLE applications ADD COLUMN company_name TEXT NOT NULL DEFAULT '';`);
  }
  // Recorded so a denial dashboard can pull the posting's job_description back up later --
  // previously job_posting_url was only ever used transiently at creation (to resolve the
  // company and update posting_application_state) and then discarded, so there was no way
  // to go from an existing application back to what it was actually applied to.
  if (!applicationColumnNames.has("job_posting_url")) {
    await db.exec(`ALTER TABLE applications ADD COLUMN job_posting_url TEXT NOT NULL DEFAULT '';`);
  }
  // A user's own read on how the role matched them -- independent of the posting/resume
  // keyword comparison, since "overqualified" or "stretch" is a judgment the applicant
  // makes, not something derivable from text overlap.
  if (!applicationColumnNames.has("fit_assessment")) {
    await db.exec(`ALTER TABLE applications ADD COLUMN fit_assessment TEXT NOT NULL DEFAULT '';`);
  }
  const companyIdIsRequired = applicationColumns.some(
    (column) => String(column?.name) === "company_id" && Number(column?.notnull) === 1
  );
  if (companyIdIsRequired) {
    await db.exec("BEGIN TRANSACTION;");
    try {
      await db.exec(`
        CREATE TABLE applications_migrated (
          id INTEGER NOT NULL PRIMARY KEY,
          company_id INTEGER,
          company_name TEXT NOT NULL DEFAULT '',
          position_name TEXT NOT NULL,
          application_date INTEGER NOT NULL,
          status TEXT,
          job_posting_url TEXT NOT NULL DEFAULT '',
          fit_assessment TEXT NOT NULL DEFAULT ''
        );
        INSERT INTO applications_migrated (id, company_id, company_name, position_name, application_date, status, job_posting_url, fit_assessment)
        SELECT a.id, a.company_id,
               CASE WHEN TRIM(COALESCE(a.company_name, '')) <> '' THEN a.company_name
                    ELSE COALESCE(c.company_name, '') END,
               a.position_name, a.application_date, a.status,
               COALESCE(a.job_posting_url, ''), COALESCE(a.fit_assessment, '')
        FROM applications a
        LEFT JOIN companies c ON c.id = a.company_id;
        DROP TABLE applications;
        ALTER TABLE applications_migrated RENAME TO applications;
      `);
      await db.exec("COMMIT;");
    } catch (error) {
      await db.exec("ROLLBACK;");
      throw error;
    }
  }

  // Applications that predate application_status_history get one seed row so every
  // application has a starting point for the denial dashboard, even though the real
  // moment of that status (e.g. an old denial) was never recorded and this backfill
  // can only use application_date as a stand-in.
  await db.run(`
    INSERT INTO application_status_history (application_id, previous_status, new_status, changed_at_epoch)
    SELECT a.id, NULL, COALESCE(a.status, 'applied'), a.application_date
    FROM applications a
    WHERE NOT EXISTS (
      SELECT 1 FROM application_status_history h WHERE h.application_id = a.id
    );
  `);

  // job_posting_url is only recorded going forward (see createApplication), so existing
  // applications get it filled in from the one place that already tracked the link:
  // posting_application_state.last_application_id. That pointer only ever names the most
  // recent application against a posting, so an application superseded by a later
  // re-application to the same posting is not recoverable here and is left blank.
  await db.run(`
    UPDATE applications
    SET job_posting_url = (
      SELECT p.job_posting_url
      FROM posting_application_state p
      WHERE p.last_application_id = applications.id
      LIMIT 1
    )
    WHERE TRIM(COALESCE(job_posting_url, '')) = ''
      AND EXISTS (
        SELECT 1 FROM posting_application_state p WHERE p.last_application_id = applications.id
      );
  `);

  if (mcpSettingsColumnNames.has("agent_login_password")) {
    await db.run(`UPDATE McpSettings SET agent_login_password = '' WHERE agent_login_password <> '';`);
  }
  if (mcpSettingsColumnNames.has("agent_login_email")) {
    await db.run(`UPDATE McpSettings SET agent_login_email = '' WHERE agent_login_email <> '';`);
  }
  if (!mcpSettingsColumnNames.has("preferred_regions")) {
    await db.exec(`
      ALTER TABLE McpSettings
      ADD COLUMN preferred_regions TEXT NOT NULL DEFAULT '[]';
    `);
  }
  if (!mcpSettingsColumnNames.has("preferred_countries")) {
    await db.exec(`
      ALTER TABLE McpSettings
      ADD COLUMN preferred_countries TEXT NOT NULL DEFAULT '[]';
    `);
  }
}



async function buildSettingsExportPayload(options = {}) {
  const includeMcpSettings = options.include_mcp !== false;
  const [personalInformation, syncServiceSettings, blockedCompanies] = await Promise.all([
    getPersonalInformation(),
    getSyncServiceSettings(),
    listBlockedCompanies()
  ]);

  const payload = {
    exported_at: new Date().toISOString(),
    db_path: DB_PATH,
    item: {
      personal_information: personalInformation,
      sync_settings: syncServiceSettings,
      blocked_companies: blockedCompanies
    }
  };

  if (includeMcpSettings) {
    payload.item.mcp_settings = await getMcpSettings();
  }

  return payload;
}

// Recorded once at load so we can tell which source files were edited after this
// process read them — those edits are only live after a restart.
const PROCESS_START_MS = Date.now();
const REPO_ROOT_PATH = path.join(__dirname, "..");
const CODE_SCAN_SKIP_DIRECTORIES = new Set(["node_modules", ".git", "tests"]);
// The MCP apply agent is a standalone stdio server, so its edits never require
// restarting this process.
const CODE_SCAN_SKIP_FILES = new Set(["mcp-apply-server.js"]);

function listPendingCodeChanges() {
  const changed = [];

  const walk = (directory) => {
    let entries = [];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (CODE_SCAN_SKIP_DIRECTORIES.has(entry.name)) continue;
        walk(fullPath);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".js")) continue;
      if (CODE_SCAN_SKIP_FILES.has(entry.name)) continue;
      try {
        if (fs.statSync(fullPath).mtimeMs > PROCESS_START_MS) {
          changed.push(path.relative(REPO_ROOT_PATH, fullPath));
        }
      } catch {
        // Unreadable file: nothing useful to report, so leave it out.
      }
    }
  };

  walk(__dirname);
  return changed.sort();
}

// Restarting into code that does not parse would leave systemd crash-looping the
// service, taking the UI down with it, so every pending edit is checked first.
function checkPendingCodeSyntax(relativeFilePaths) {
  return Promise.all(
    relativeFilePaths.map(
      (relativeFilePath) =>
        new Promise((resolve) => {
          execFile(
            process.execPath,
            ["--check", path.join(REPO_ROOT_PATH, relativeFilePath)],
            { timeout: 20000 },
            (error, _stdout, stderr) => {
              resolve({
                file: relativeFilePath,
                ok: !error,
                message: error ? String(stderr || error.message || error).trim().slice(0, 2000) : ""
              });
            }
          );
        })
    )
  );
}

// systemd sets INVOCATION_ID for units it manages. Without it nothing would
// bring the process back after it exits, so a restart request must be refused.
function isManagedBySystemd() {
  return Boolean(String(process.env.INVOCATION_ID || "").trim());
}

let restartInProgress = false;

function createServer() {
  const app = express();
  const db = getDb();
  app.use(cors({ origin: createOriginPolicy() }));
  app.use((error, _req, res, next) => {
    if (String(error?.message || "").startsWith("CORS origin is not allowed:")) {
      return res.status(403).json({ ok: false, error: "Origin is not allowed by the local API policy." });
    }
    return next(error);
  });
  // 25mb: document uploads (/settings/applicant-documents) arrive as base64 JSON, and the
  // default 100kb cap cannot fit a resume PDF. Local/self-hosted API, per the security notes.
  app.use(express.json({ limit: "25mb" }));

  app.post("/frontend/log", async (req, res) => {
    try {
      appendFrontendLogEntry(
        req.body?.level,
        req.body?.event,
        req.body?.message,
        req.body?.context && typeof req.body.context === "object" ? req.body.context : {}
      );
      res.status(202).json({ ok: true });
    } catch (error) {
      res.status(400).json({
        ok: false,
        error: String(error?.message || error)
      });
    }
  });

  const handleSyncRequest = async (req, res) => {
    const wait = String(req.query.wait || "").toLowerCase();
    const shouldWait = wait === "1" || wait === "true";
    const wasRunning = Boolean(getSyncPromise());
    const promise = runAtsSync();

    if (shouldWait) {
      await promise;
      const [counts, syncScopeStats] = await Promise.all([getCounts(), getSyncScopeStats()]);
      return res.json({
        ok: true,
        started: !wasRunning,
        running: syncStatus.running,
        ...syncStatus,
        ...syncScopeStats,
        ...counts
      });
    }

    return res.status(202).json({
      ok: true,
      started: !wasRunning,
      running: true
    });
  };

  // Read-only database browser. See server/services/db-browser.js for why it exists and
  // how it is constrained.
  app.get("/db", (_req, res) => {
    res.type("html").send(DB_BROWSER_PAGE.replace(">500<", `>${MAX_ROWS}<`));
  });

  app.get("/db/companies", async (req, res) => {
    try {
      res.json({ items: await findCompanies(req.query.q) });
    } catch (error) {
      res.status(500).json({ error: String(error?.message || error) });
    }
  });

  app.get("/db/postings", async (req, res) => {
    try {
      const items = await findPostings({
        search: req.query.q,
        hiddenState: String(req.query.state || "visible")
      });
      res.json({ items });
    } catch (error) {
      res.status(500).json({ error: String(error?.message || error) });
    }
  });

  // Fetch posting pages for rows missing a description (or re-verify old fetches with
  // refresh_all=true). Persists description, prose-parsed pay, liveness status,
  // hiring-location restrictions and the requires-account flag.
  app.post("/descriptions/backfill", async (req, res) => {
    try {
      const { runDescriptionBackfill } = require("./services/posting-page-fetcher.js");
      res.json(
        await runDescriptionBackfill({
          limit: parseNonNegativeInteger(req.body?.limit) || 200,
          concurrency: parseNonNegativeInteger(req.body?.concurrency) || 4,
          refresh_all: normalizeBoolean(req.body?.refresh_all, false)
        })
      );
    } catch (error) {
      res.status(500).json({ error: String(error?.message || error) });
    }
  });

  // Refreshes the FTS index behind similar_to. Incremental unless rebuild=true.
  app.post("/semantic/reindex", async (req, res) => {
    try {
      res.json(
        await runSemanticIndexWorker({
          rebuild: normalizeBoolean(req.body?.rebuild, false),
          maxBatches: parseNonNegativeInteger(req.body?.max_batches) || undefined
        })
      );
    } catch (error) {
      res.status(500).json({ error: String(error?.message || error) });
    }
  });

  // Relevance ranking over descriptions; see server/services/semantic-search.js.
  app.post("/semantic/similar", async (req, res) => {
    try {
      const { findSimilarPostings } = require("./services/semantic-search.js");
      res.json(await findSimilarPostings(req.body || {}));
    } catch (error) {
      res.status(400).json({ error: String(error?.message || error) });
    }
  });

  // Composable querying over the raw table; see server/services/db-query.js.
  app.get("/db/search", async (req, res) => {
    try {
      res.json(await runPostingQuery(req.query));
    } catch (error) {
      res.status(400).json({ error: String(error?.message || error) });
    }
  });

  // Saved queries live on the server so they survive a browser eviction, a different
  // device, and the overnight sync they are usually waiting on.
  app.get("/db/saved", (_req, res) => {
    res.json({ items: listSavedQueries() });
  });

  app.post("/db/saved", (req, res) => {
    try {
      res.json({ item: saveQuery({ name: req.body?.name, state: req.body?.state }) });
    } catch (error) {
      res.status(400).json({ error: String(error?.message || error) });
    }
  });

  app.delete("/db/saved/:id", (req, res) => {
    res.json({ deleted: deleteQuery(req.params.id) });
  });

  app.get("/db/facets", async (req, res) => {
    try {
      res.json(await computeFacets(req.query));
    } catch (error) {
      res.status(400).json({ error: String(error?.message || error) });
    }
  });

  app.post("/db/query", async (req, res) => {
    const sql = String(req.body?.sql || "");
    const rejection = rejectUnsafeQuery(sql);
    if (rejection) {
      res.status(400).json({ error: rejection });
      return;
    }
    try {
      res.json(await runReadOnlyQuery(sql));
    } catch (error) {
      res.status(400).json({ error: String(error?.message || error) });
    }
  });

  app.get("/db/schema", async (_req, res) => {
    try {
      res.json({ tables: await listReadableSchema() });
    } catch (error) {
      res.status(500).json({ error: String(error?.message || error) });
    }
  });

  // What the background enrichment loops have been doing: page fetches and semantic
  // reindexing. Worth checking when liveness or hiring-location fields look empty.
  app.get("/enrichment/status", (_req, res) => {
    res.json({ ...getEnrichmentStatus(), write_liveness: getWriteLivenessStatus() });
  });

  app.get("/health", async (_req, res) => {
    const counts = await getCounts();
    res.json({
      ok: true,
      db_path: DB_PATH,
      ...counts
    });
  });

  app.get("/extension/seeded-source/options", async (_req, res) => {
    const seededAts = listSeededAtsValues().map((value) => ({
      value,
      label: ATS_LABEL_BY_VALUE.get(value) || value
    }));
    res.json({
      ok: true,
      item: {
        seeded_ats: seededAts,
        dynamic_ats: Array.from(DYNAMIC_ATS_OPTIONS).sort((a, b) => a.localeCompare(b))
      }
    });
  });

  app.post("/extension/seeded-source/classify", async (req, res) => {
    const sourceUrl = String(req.body?.url_string || req.body?.url || "").trim();
    if (!sourceUrl) {
      return res.status(400).json({
        ok: false,
        error: "Source URL is required."
      });
    }

    const item = classifySeededCompanySourceUrl(sourceUrl);
    return res.json({
      ok: true,
      item
    });
  });

  app.post("/extension/seeded-source/upsert", async (req, res) => {
    try {
      const sourceUrlInput = String(req.body?.url_string || req.body?.url || "").trim();
      if (!sourceUrlInput) {
        throw new Error("Source URL is required.");
      }

      const classification = classifySeededCompanySourceUrl(sourceUrlInput);
      if (!classification.supported) {
        throw new Error(
          String(classification?.message || "URL does not match a supported seeded ATS company source.")
        );
      }
      if (!SEEDED_ATS_OPTIONS.has(classification.ats)) {
        throw new Error("Only seeded ATS sources can be added.");
      }
      if (DYNAMIC_ATS_OPTIONS.has(classification.ats)) {
        throw new Error("Dynamic ATS sources are not supported.");
      }

      const normalizedUrl = normalizeSourceUrlString(classification.canonical_url || sourceUrlInput);
      if (!normalizedUrl) {
        throw new Error("Source URL is invalid.");
      }

      const fallbackCompanyName =
        String(classification.suggested_company_name || "").trim() ||
        String(classification.company_identifier || "").trim() ||
        "Company";
      const companyName = String(req.body?.company_name || fallbackCompanyName).trim();
      if (!companyName) {
        throw new Error("Company name is required.");
      }

      const result = await upsertSeededCompanySource(db, {
        company_name: companyName,
        url_string: normalizedUrl,
        ATS_name: classification.ats
      });

      return res.json({
        ok: true,
        item: {
          id: Number(result?.row?.id || 0),
          company_name: String(result?.row?.company_name || companyName),
          url_string: String(result?.row?.url_string || normalizedUrl),
          ATS_name: String(result?.row?.ATS_name || classification.ats),
          action: String(result?.action || "updated"),
          classification
        }
      });
    } catch (error) {
      return res.status(400).json({
        ok: false,
        error: String(error?.message || error)
      });
    }
  });

  app.get("/sync/status", async (_req, res) => {
    try {
      const [counts, syncScopeStats, syncSettings, coverage, lastWriteEpoch] = await Promise.all([
        getCounts(),
        getSyncScopeStats(),
        getSyncServiceSettings(),
        // Survives restarts, unlike syncStatus.progress, so this is what answers "is
        // anything being starved" after an interrupted pass.
        getSyncCoverageStats().catch(() => null),
        getLastSyncWriteEpoch()
      ]);
      const durableLastWriteEpoch = Number(lastWriteEpoch || 0);
      const nowEpoch = Math.floor(Date.now() / 1000);
      const processMemory = process.memoryUsage();
      const rssMb = Math.round(processMemory.rss / 1048576);
      const walSizeBytes = getWalSizeBytes();
      const hostMemory = getHostMemorySnapshot();
      const filteredQueryQueue = getWideScanStats();
      const healthWarnings = await checkHealthWarnings({
        walSizeBytes,
        hostMemory,
        filteredQueryQueue,
        rssMb
      });
      const payload = sanitizeFrontendValue({
        ...syncStatus,
        active_targets: (syncStatus.active_targets || []).map((target) => ({
          ...target,
          age_seconds: target?.started_at
            ? Math.max(0, Math.floor((Date.now() - Date.parse(target.started_at)) / 1000))
            : null
        })),
        last_progress_age_seconds: syncStatus.last_progress_at
          ? Math.max(0, Math.floor((Date.now() - Date.parse(syncStatus.last_progress_at)) / 1000))
          : null,
        service_uptime_seconds: Math.floor(process.uptime()),
        process_memory: {
          rss_mb: rssMb,
          heap_used_mb: Math.round(processMemory.heapUsed / 1048576),
          heap_total_mb: Math.round(processMemory.heapTotal / 1048576),
          external_mb: Math.round(processMemory.external / 1048576),
          array_buffers_mb: Math.round((processMemory.arrayBuffers || 0) / 1048576)
        },
        wal_size_mb: Math.round(walSizeBytes / 1048576),
        host_memory: hostMemory,
        health_warnings: healthWarnings,
        scraper_request_queue: getAtsRequestQueueStats(),
        ...syncScopeStats,
        filtered_query_queue: filteredQueryQueue,
        sync_coverage: coverage,
        posting_freshness_hours: syncSettings?.posting_freshness_hours,
        active_posting_freshness_hours: syncSettings?.active_posting_freshness_hours,
        min_posting_freshness_hours: syncSettings?.min_posting_freshness_hours,
        max_posting_freshness_hours: syncSettings?.max_posting_freshness_hours,
        last_write_at:
          syncStatus.last_write_at ||
          (durableLastWriteEpoch > 0 ? new Date(durableLastWriteEpoch * 1000).toISOString() : null),
        last_write_age_seconds:
          durableLastWriteEpoch > 0 ? Math.max(0, nowEpoch - durableLastWriteEpoch) : null,
        ...counts
      });
      return res.json(payload);
    } catch (error) {
      const fallbackPayload = sanitizeFrontendValue({
        ...syncStatus,
        last_error: syncStatus?.last_error || String(error?.message || error),
        company_count: 0,
        posting_count: 0,
        company_count_by_ats: {},
        sync_enabled_company_count: 0,
        configured_enabled_ats_count: 0,
        excluded_ats_count: 0
      });
      return res.status(200).json(fallbackPayload);
    }
  });

  app.get("/system/code-status", (_req, res) => {
    const changedFiles = listPendingCodeChanges();
    return res.json(
      sanitizeFrontendValue({
        restart_required: changedFiles.length > 0,
        changed_files: changedFiles,
        restart_supported: isManagedBySystemd(),
        process_started_at: new Date(PROCESS_START_MS).toISOString(),
        uptime_seconds: Math.round(process.uptime())
      })
    );
  });

  // Exits the process so systemd's Restart=always starts it again on the new
  // code. Deliberately takes no request parameters: there is nothing a caller
  // can supply that reaches a shell or selects a different unit.
  app.post("/system/restart", async (_req, res) => {
    if (!isManagedBySystemd()) {
      return res.status(503).json({
        error:
          "This server is not running under systemd, so it cannot restart itself. Restart it however it was started."
      });
    }

    if (restartInProgress) {
      return res.status(409).json({ error: "A restart is already in progress." });
    }

    const changedFiles = listPendingCodeChanges();
    const syntaxResults = await checkPendingCodeSyntax(changedFiles);
    const failures = syntaxResults.filter((result) => !result.ok);
    if (failures.length > 0) {
      return res.status(422).json(
        sanitizeFrontendValue({
          error: "Refusing to restart: some changed files do not compile.",
          failures
        })
      );
    }

    restartInProgress = true;
    res.status(202).json(sanitizeFrontendValue({ restarting: true, changed_files: changedFiles }));

    // Give the response time to flush before dropping the process.
    setTimeout(() => {
      console.log("[OpenPostings API] restart requested via /system/restart; exiting for systemd");
      process.exit(0);
    }, 300);
  });

  app.post("/sync/workday", handleSyncRequest);
  app.post("/sync/ats", handleSyncRequest);

  app.get("/postings/filter-options", async (req, res) => {
    const options = await getPostingFilterOptions({ states: parseCsvParam(req.query.states) });
    res.json(options);
  });

  app.get("/postings/details", async (req, res) => {
    const jobPostingUrl = String(req.query.job_posting_url || "").trim();
    if (!jobPostingUrl) return res.status(400).json({ ok: false, error: "job_posting_url is required" });
    const [item] = await getPostingsByUrls([jobPostingUrl]);
    if (!item) return res.status(404).json({ ok: false, error: "posting not found" });
    return res.json({ ok: true, item: sanitizeFrontendValue(item) });
  });

  app.get("/settings/personal-information", async (_req, res) => {
    const item = await getPersonalInformation();
    res.json({ item });
  });

  app.put("/settings/personal-information", async (req, res) => {
    const item = await upsertPersonalInformation(req.body);
    res.json({
      ok: true,
      item
    });
  });

  app.get("/settings/mcp", async (_req, res) => {
    const item = await getMcpSettings();
    res.json({ item });
  });

  app.put("/settings/mcp", async (req, res) => {
    const item = await upsertMcpSettings(req.body || {});
    res.json({
      ok: true,
      item
    });
  });

  app.get("/settings/sync", async (_req, res) => {
    const item = await getSyncServiceSettings();
    res.json({ item });
  });

  app.put("/settings/sync", async (req, res) => {
    const item = await upsertSyncServiceSettings(req.body || {});
    res.json({
      ok: true,
      item
    });
  });

  app.get("/settings/sync/blocked-companies", async (_req, res) => {
    const items = await listBlockedCompanies();
    res.json({
      ok: true,
      items,
      count: items.length
    });
  });

  app.post("/settings/sync/blocked-companies", async (req, res) => {
    try {
      const item = await blockCompanyByName(req.body?.company_name);
      const items = await listBlockedCompanies();
      res.json({
        ok: true,
        item: {
          normalized_company_name: String(item?.normalized_company_name || ""),
          company_name: String(item?.company_name || ""),
          blocked_at_epoch: Number(item?.blocked_at_epoch || 0)
        },
        items,
        count: items.length
      });
    } catch (error) {
      res.status(400).json({
        ok: false,
        error: String(error?.message || error)
      });
    }
  });

  app.post("/settings/sync/blocked-companies/unblock", async (req, res) => {
    try {
      const deleted = await unblockCompanyByName(req.body?.company_name);
      const items = await listBlockedCompanies();
      res.json({
        ok: true,
        deleted,
        items,
        count: items.length
      });
    } catch (error) {
      res.status(400).json({
        ok: false,
        error: String(error?.message || error)
      });
    }
  });

  app.post("/settings/migrate-db", async (req, res) => {
    try {
      const summary = await migrateSettingsAndApplicationsFromDatabase(req.body?.source_db_path, {
        personal_information: req.body?.personal_information,
        mcp_settings: req.body?.mcp_settings,
        blocked_companies: req.body?.blocked_companies,
        applications: req.body?.applications
      });
      const [personalInformation, mcpSettings, syncServiceSettings, blockedCompanies, applications] =
        await Promise.all([
          getPersonalInformation(),
          getMcpSettings(),
          getSyncServiceSettings(),
          listBlockedCompanies(),
          listApplications({ limit: 50, offset: 0 })
        ]);

      res.json({
        ok: true,
        summary,
        item: {
          personal_information: personalInformation,
          mcp_settings: mcpSettings,
          sync_settings: syncServiceSettings,
          blocked_companies_count: blockedCompanies.length,
          applications_count: Number(applications?.count || 0)
        }
      });
    } catch (error) {
      res.status(400).json({
        ok: false,
        error: String(error?.message || error)
      });
    }
  });

  app.get("/settings/export", async (req, res) => {
    try {
      const includeMcpSettings = normalizeBoolean(req.query.include_mcp, true);
      const payload = await buildSettingsExportPayload({ include_mcp: includeMcpSettings });
      res.json({
        ok: true,
        ...payload
      });
    } catch (error) {
      res.status(400).json({
        ok: false,
        error: String(error?.message || error)
      });
    }
  });

  app.get("/mcp/candidates", async (req, res) => {
    const settings = await getMcpSettings();
    try {
      ensureMcpAgentEnabled(settings);
    } catch (error) {
      return res.status(Number(error?.statusCode || 403)).json({
        ok: false,
        error: String(error?.message || error)
      });
    }
    const personalInformation = await getPersonalInformation();

    const useSettings = normalizeBoolean(req.query.use_settings, true);
    const overrideSearch = String(req.query.search || "").trim();
    const overrideAts = parseCsvParam(req.query.ats);
    const overrideIndustries = parseCsvParam(req.query.industries);
    const overrideCompensationTypes = parseCsvParam(req.query.compensation_types);
    const overridePayPeriods = parseCsvParam(req.query.pay_periods);
    const overridePayMin = normalizePayFilterNumber(req.query.pay_min);
    const overridePayMax = normalizePayFilterNumber(req.query.pay_max);
    const overrideEducationLevels = parseCsvParam(req.query.education_levels);
    const overrideStates = parseCsvParam(req.query.states);
    const overrideCounties = parseCsvParam(req.query.counties);
    const overrideCountries = parseCsvParam(req.query.countries);
    const overrideRegions = parseCsvParam(req.query.regions);
    const overrideRemote = normalizeRemoteFilter(req.query.remote);
    const includeApplied = normalizeBoolean(req.query.include_applied, false);

    const preferredMax = Math.max(
      1,
      parseNonNegativeInteger(settings?.max_applications_per_run) || MCP_SETTINGS_DEFAULTS.max_applications_per_run
    );
    const requestedLimit = parseNonNegativeInteger(req.query.limit);
    const limit = Math.max(1, Math.min(2000, requestedLimit || preferredMax));

    const search = overrideSearch || (useSettings ? String(settings?.preferred_search || "").trim() : "");
    const ats = overrideAts.length > 0 ? overrideAts : [];
    const industries =
      overrideIndustries.length > 0
        ? overrideIndustries
        : useSettings
          ? normalizeStringArray(settings?.preferred_industries)
          : [];
    const compensationTypes = overrideCompensationTypes.length > 0 ? overrideCompensationTypes : [];
    const payPeriods = overridePayPeriods.length > 0 ? overridePayPeriods : [];
    const payMin = overridePayMin;
    const payMax = overridePayMax;
    const educationLevels = overrideEducationLevels.length > 0 ? overrideEducationLevels : [];
    const states =
      overrideStates.length > 0
        ? overrideStates
        : useSettings
          ? normalizeStringArray(settings?.preferred_states)
          : [];
    const counties =
      overrideCounties.length > 0
        ? overrideCounties
        : useSettings
          ? normalizeStringArray(settings?.preferred_counties)
          : [];
    const countries =
      overrideCountries.length > 0
        ? overrideCountries
        : useSettings
          ? normalizeStringArray(settings?.preferred_countries)
          : [];
    const regions =
      overrideRegions.length > 0
        ? overrideRegions
        : useSettings
          ? normalizeStringArray(settings?.preferred_regions)
          : [];
    const remote = req.query.remote ? overrideRemote : useSettings ? settings?.preferred_remote : "all";

    const result = await listPostingsWithFilters({
      search,
      limit,
      offset: 0,
      ats,
      industries,
      compensation_types: compensationTypes,
      pay_periods: payPeriods,
      pay_min: payMin,
      pay_max: payMax,
      education_levels: educationLevels,
      states,
      counties,
      countries,
      regions,
      remote,
      include_applied: includeApplied
    });

    const candidates = (result?.items || []).slice(0, limit);
    const runbook = buildMcpRunbook(settings, personalInformation, candidates);

    res.json({
      ok: true,
      count: candidates.length,
      limit,
      filters: result.filters,
      settings,
      personal_information: personalInformation,
      runbook,
      candidates
    });
  });

  app.get("/mcp/resume", async (req, res) => {
    const settings = await getMcpSettings();
    try {
      ensureMcpAgentEnabled(settings);
    } catch (error) {
      return res.status(Number(error?.statusCode || 403)).json({
        ok: false,
        error: String(error?.message || error)
      });
    }
    const which = String(req.query.document || "") === "projects_portfolio" ? "projects_portfolio" : "resume";

    const stored = await getApplicantDocument(which);
    if (stored) {
      return res.json({ document: which, source: "database", ok: true, ...stored });
    }

    const personalInformation = await getPersonalInformation();
    const filePath =
      which === "projects_portfolio"
        ? personalInformation?.projects_portfolio_file_path
        : personalInformation?.resume_file_path;

    const result = await extractDocumentText(filePath);
    if (!result.ok) {
      result.error += " To make the document permanently available to this server, upload it once via POST /settings/applicant-documents.";
    }
    res.json({ document: which, source: "file", ...result });
  });

  // The upload that makes the resume the server's own. The client machine (where the file
  // lives) POSTs it once; from then on get_resume and /mcp/resume serve the stored copy no
  // matter which machine either side runs on. Unlike the /mcp/* routes this is not gated on
  // the agent being enabled -- the document belongs to profile setup, like the rest of
  // /settings, and uploading it before enabling the agent is the natural order.
  app.post("/settings/applicant-documents", async (req, res) => {
    // Any slug is accepted, so several tailored resumes can coexist under their own keys.
    const kind = normalizeDocumentKind(req.body?.kind || req.body?.key || "resume");
    if (!kind) {
      return res.status(400).json({
        ok: false,
        error:
          "kind must be a slug: lowercase letters, digits and underscores, starting with a letter " +
          `(for example 'resume', 'resume_hospitality', 'portfolio'), at most ${MAX_DOCUMENT_KEY_LENGTH} characters.`
      });
    }

    const contentBase64 = String(req.body?.content_base64 || "").trim();
    if (!contentBase64) {
      return res.status(400).json({ ok: false, error: "content_base64 is required." });
    }

    let content;
    try {
      content = Buffer.from(contentBase64, "base64");
    } catch {
      content = Buffer.alloc(0);
    }
    if (content.length === 0) {
      return res.status(400).json({ ok: false, error: "content_base64 did not decode to any bytes." });
    }

    try {
      const saved = await saveApplicantDocument({
        kind,
        file_name: req.body?.file_name,
        label: req.body?.label,
        target_roles: req.body?.target_roles,
        content
      });
      res.json({ ok: true, ...saved });
    } catch (error) {
      res.status(400).json({ ok: false, error: String(error?.message || error) });
    }
  });

  // Failures worth telling the user about, newest first. The app polls the unacknowledged
  // count so a lost application cannot pass unnoticed the way the Amazon ones did.
  app.get("/errors", async (req, res) => {
    try {
      const sources = String(req.query.sources || "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      res.json(await listErrors({
        limit: parseNonNegativeInteger(req.query.limit) || 50,
        include_acknowledged: normalizeBoolean(req.query.include_acknowledged, false),
        sources: sources.length > 0 ? sources : null
      }));
    } catch (error) {
      res.status(500).json({ error: String(error?.message || error) });
    }
  });

  // Dismiss without deleting: the record is the point, the notice is not.
  app.post("/errors/acknowledge", async (req, res) => {
    try {
      res.json({ ok: true, ...(await acknowledgeErrors(req.body?.ids)) });
    } catch (error) {
      res.status(400).json({ ok: false, error: String(error?.message || error) });
    }
  });

  // The answers application forms ask for. Seeded with the standard questions at empty
  // values; an empty value means "still to ask the user", never "fill this in yourself".
  app.get("/settings/application-answers", async (_req, res) => {
    try {
      res.json({ ok: true, items: await listApplicationAnswers() });
    } catch (error) {
      res.status(500).json({ ok: false, error: String(error?.message || error) });
    }
  });

  // Accepts one {key, value, ...} or {items: [...]} for a bulk fill.
  app.put("/settings/application-answers", async (req, res) => {
    try {
      const items = Array.isArray(req.body?.items) ? req.body.items : [req.body];
      res.json({ ok: true, saved: await setApplicationAnswers(items) });
    } catch (error) {
      res.status(400).json({ ok: false, error: String(error?.message || error) });
    }
  });

  app.delete("/settings/application-answers/:key", async (req, res) => {
    try {
      res.json({ ok: true, ...(await clearApplicationAnswer(req.params.key)) });
    } catch (error) {
      res.status(400).json({ ok: false, error: String(error?.message || error) });
    }
  });

  app.get("/settings/applicant-documents", async (_req, res) => {
    try {
      res.json({
        ok: true,
        items: await listApplicantDocuments(),
        // Readability of the paths configured in personal information, so an unreachable
        // one is visible here rather than only when an application is being drafted.
        configured_paths: await checkConfiguredDocumentPaths()
      });
    } catch (error) {
      res.status(500).json({ ok: false, error: String(error?.message || error) });
    }
  });

  app.delete("/settings/applicant-documents/:kind", async (req, res) => {
    try {
      res.json({ ok: true, ...(await deleteApplicantDocument(req.params.kind)) });
    } catch (error) {
      res.status(400).json({ ok: false, error: String(error?.message || error) });
    }
  });

  // Serves the original bytes back, so the machine driving a browser can attach the real
  // file to an application form even when the upload happened from somewhere else.
  app.get("/settings/applicant-documents/:kind/file", async (req, res) => {
    const kind = normalizeDocumentKind(req.params.kind);
    const stored = kind ? await getApplicantDocument(kind, { includeContent: true }) : null;
    if (!stored) {
      return res.status(404).json({ ok: false, error: "No such document uploaded." });
    }
    res.setHeader("Content-Disposition", `attachment; filename="${stored.file_name.replace(/"/g, "")}"`);
    res.setHeader("Content-Type", "application/octet-stream");
    res.send(stored.content);
  });

  app.post("/mcp/cover-letter-draft", async (req, res) => {
    const settings = await getMcpSettings();
    try {
      ensureMcpAgentEnabled(settings);
    } catch (error) {
      return res.status(Number(error?.statusCode || 403)).json({
        ok: false,
        error: String(error?.message || error)
      });
    }
    const personalInformation = await getPersonalInformation();
    const jobPostingUrl = String(req.body?.job_posting_url || "").trim();
    const requestCompanyName = String(req.body?.company_name || "").trim();
    const requestPositionName = String(req.body?.position_name || "").trim();

    let posting = {
      job_posting_url: jobPostingUrl,
      company_name: requestCompanyName,
      position_name: requestPositionName
    };

    if (jobPostingUrl && (!requestCompanyName || !requestPositionName)) {
      const row = await db.get(
        `
          SELECT company_name, position_name, job_posting_url
          FROM Postings
          WHERE job_posting_url = ?
          LIMIT 1;
        `,
        [jobPostingUrl]
      );
      posting = {
        job_posting_url: jobPostingUrl,
        company_name: requestCompanyName || String(row?.company_name || "").trim(),
        position_name: requestPositionName || String(row?.position_name || "").trim()
      };
    }

    const instructions = String(req.body?.instructions || settings?.instructions_for_agent || "").trim();

    // The brief is what makes the letter about this job: the posting's own requirements,
    // the resume lines that speak to them, and the ones nothing in the resume supports.
    const documentKey = normalizeDocumentKind(req.body?.document || "resume") || "resume";
    const sourceDocument = await getApplicantDocument(documentKey);
    let description = "";
    if (jobPostingUrl) {
      const descriptionRow = await db.get(
        `SELECT job_description FROM Postings WHERE job_posting_url = ? LIMIT 1;`,
        [jobPostingUrl]
      );
      description = String(descriptionRow?.job_description || "").trim();
    }
    const brief = buildCoverLetterBrief({
      description,
      resume_text: sourceDocument?.text || "",
      posting
    });
    const draft = buildCoverLetterDraft(personalInformation, posting, instructions, brief);

    res.json({
      ok: true,
      posting,
      brief,
      draft
    });
  });

  app.post("/mcp/applications/complete", async (req, res) => {
    try {
      const settings = await getMcpSettings();
      ensureMcpAgentEnabled(settings);
      const commit = normalizeBoolean(req.body?.commit, false);
      const approvedByUser = normalizeBoolean(req.body?.approved_by_user, false);
      const jobPostingUrl = String(req.body?.job_posting_url || "").trim();
      const agentName =
        String(req.body?.agent_name || settings?.preferred_agent_name || MCP_SETTINGS_DEFAULTS.preferred_agent_name)
          .trim() || MCP_SETTINGS_DEFAULTS.preferred_agent_name;

      let companyName = String(req.body?.company_name || "").trim();
      let positionName = String(req.body?.position_name || "").trim();

      if (jobPostingUrl && (!companyName || !positionName)) {
        const posting = await db.get(
          `
            SELECT company_name, position_name
            FROM Postings
            WHERE job_posting_url = ?
            LIMIT 1;
          `,
          [jobPostingUrl]
        );
        companyName = companyName || String(posting?.company_name || "").trim();
        positionName = positionName || String(posting?.position_name || "").trim();
      }

      if (!companyName || !positionName) {
        return res.status(400).json({
          ok: false,
          error: "company_name and position_name are required (or provide a valid job_posting_url)."
        });
      }

      if (commit && settings?.require_final_approval && !approvedByUser) {
        return res.status(400).json({
          ok: false,
          error: "Final approval is required by MCP settings. Set approved_by_user=true to commit."
        });
      }

      const payload = {
        company_name: companyName,
        position_name: positionName,
        job_posting_url: jobPostingUrl,
        application_date: parseNonNegativeInteger(req.body?.application_date) || nowEpochSeconds(),
        status: req.body?.status || "applied",
        applied_by_type: "agent",
        applied_by_label: `${agentName} applied on behalf of user`
      };

      const shouldDryRun = !commit || Boolean(settings?.dry_run_only);
      if (shouldDryRun) {
        return res.json({
          ok: true,
          committed: false,
          dry_run: true,
          payload
        });
      }

      const item = await createApplication(payload);
      return res.status(201).json({
        ok: true,
        committed: true,
        item
      });
    } catch (error) {
      return res.status(Number(error?.statusCode || 400)).json({
        ok: false,
        error: String(error?.message || error)
      });
    }
  });

  app.get("/applications", async (req, res) => {
    const limit = Math.max(1, Math.min(2000, Number(req.query.limit || 500)));
    const offset = Math.max(0, Number(req.query.offset || 0));
    const status = String(req.query.status || "").trim();

    const payload = await listApplications({
      limit,
      offset,
      status
    });

    res.json({
      ...payload,
      status_options: Array.from(APPLICATION_STATUS_OPTIONS),
      fit_options: Array.from(APPLICATION_FIT_OPTIONS)
    });
  });

  app.get("/applications/stats", async (req, res) => {
    const stats = await getApplicationDenialStats();
    res.json({
      ok: true,
      ...stats
    });
  });

  app.post("/applications", async (req, res) => {
    try {
      const item = await createApplication(req.body || {});
      res.status(201).json({
        ok: true,
        item
      });
    } catch (error) {
      // Same reasoning as the MCP path: by the time this is called the application has
      // usually already been sent, so a failure here loses a fact about the real world
      // rather than just failing a request.
      await recordError({
        source: "api",
        operation: "POST /applications",
        message: `Application could not be logged: ${String(error?.message || error)}`,
        context: {
          company_name: req.body?.company_name,
          position_name: req.body?.position_name,
          job_posting_url: req.body?.job_posting_url
        }
      });
      res.status(400).json({
        ok: false,
        error: String(error?.message || error)
      });
    }
  });

  app.patch("/applications/:id", async (req, res) => {
    const applicationId = Number(req.params.id);
    if (!Number.isFinite(applicationId) || applicationId <= 0) {
      return res.status(400).json({
        ok: false,
        error: "application id must be a positive number"
      });
    }

    const body = req.body || {};
    const hasStatus = Object.prototype.hasOwnProperty.call(body, "status");
    const hasFitAssessment = Object.prototype.hasOwnProperty.call(body, "fit_assessment");
    if (!hasStatus && !hasFitAssessment) {
      return res.status(400).json({
        ok: false,
        error: "status or fit_assessment is required"
      });
    }

    let item = null;
    if (hasStatus) {
      item = await updateApplicationStatus(applicationId, body.status);
      if (!item) {
        return res.status(404).json({
          ok: false,
          error: "application not found"
        });
      }
    }
    if (hasFitAssessment) {
      item = await updateApplicationFit(applicationId, body.fit_assessment);
      if (!item) {
        return res.status(404).json({
          ok: false,
          error: "application not found"
        });
      }
    }

    return res.json({
      ok: true,
      item
    });
  });

  app.delete("/applications/:id", async (req, res) => {
    const applicationId = Number(req.params.id);
    if (!Number.isFinite(applicationId) || applicationId <= 0) {
      return res.status(400).json({
        ok: false,
        error: "application id must be a positive number"
      });
    }

    const deleted = await deleteApplicationById(applicationId);
    if (!deleted) {
      return res.status(404).json({
        ok: false,
        error: "application not found"
      });
    }

    return res.json({
      ok: true,
      deleted: true
    });
  });

  app.get("/job-searches", async (_req, res) => {
    const items = await listSavedJobSearches();
    res.json({
      ok: true,
      items,
      count: items.length
    });
  });

  app.post("/job-searches", async (req, res) => {
    try {
      const item = await createSavedJobSearch({
        name: req.body?.name,
        search: req.body?.search,
        filters: req.body?.filters
      });
      res.status(201).json({
        ok: true,
        item
      });
    } catch (error) {
      res.status(400).json({
        ok: false,
        error: String(error?.message || error)
      });
    }
  });

  app.put("/job-searches/:id", async (req, res) => {
    const searchId = Number(req.params.id);
    if (!Number.isFinite(searchId) || searchId <= 0) {
      return res.status(400).json({
        ok: false,
        error: "job search id must be a positive number"
      });
    }

    try {
      const item = await updateSavedJobSearch(searchId, {
        name: req.body?.name,
        search: req.body?.search,
        filters: req.body?.filters
      });
      if (!item) {
        return res.status(404).json({
          ok: false,
          error: "saved job search not found"
        });
      }
      return res.json({
        ok: true,
        item
      });
    } catch (error) {
      return res.status(400).json({
        ok: false,
        error: String(error?.message || error)
      });
    }
  });

  app.delete("/job-searches/:id", async (req, res) => {
    const searchId = Number(req.params.id);
    if (!Number.isFinite(searchId) || searchId <= 0) {
      return res.status(400).json({
        ok: false,
        error: "job search id must be a positive number"
      });
    }

    const deleted = await deleteSavedJobSearch(searchId);
    if (!deleted) {
      return res.status(404).json({
        ok: false,
        error: "saved job search not found"
      });
    }

    return res.json({
      ok: true,
      deleted: true
    });
  });

  app.post("/postings/ignore", async (req, res) => {
    try {
      const item = await setPostingIgnoredState(req.body || {});
      res.json({
        ok: true,
        item
      });
    } catch (error) {
      res.status(400).json({
        ok: false,
        error: String(error?.message || error)
      });
    }
  });

  app.patch("/postings/review-state", async (req, res) => {
    try {
      const item = await setPostingReviewState(req.body || {});
      res.json({ ok: true, item });
    } catch (error) {
      res.status(400).json({ ok: false, error: String(error?.message || error) });
    }
  });

  app.get("/postings", async (req, res) => {
    const abortController = new AbortController();
    const abortDisconnectedRequest = () => {
      if (!res.writableEnded) abortController.abort();
    };
    req.once("aborted", abortDisconnectedRequest);
    res.once("close", abortDisconnectedRequest);
    try {
      const result = await listPostingsWithFilters({
        search: String(req.query.search || "").trim(),
        limit: Number(req.query.limit || 500),
        offset: Number(req.query.offset || 0),
        sort_by: String(req.query.sort_by || "").trim(),
        resume_key: String(req.query.resume || "").trim(),
        ats: parseCsvParam(req.query.ats),
        industries: parseCsvParam(req.query.industries),
        compensation_types: parseCsvParam(req.query.compensation_types),
        pay_periods: parseCsvParam(req.query.pay_periods),
        pay_min: req.query.pay_min,
        pay_max: req.query.pay_max,
        education_levels: parseCsvParam(req.query.education_levels),
        states: parseCsvParam(req.query.states),
        counties: parseCsvParam(req.query.counties),
        cities: parseCsvParam(req.query.cities),
        countries: parseCsvParam(req.query.countries),
        regions: parseCsvParam(req.query.regions),
        remote: req.query.remote,
        hide_no_date: normalizeBoolean(req.query.hide_no_date, false),
        include_applied: normalizeBoolean(req.query.include_applied, true),
        include_ignored: normalizeBoolean(req.query.include_ignored, false),
        include_descriptions: normalizeBoolean(req.query.include_descriptions, true),
        review_queue: String(req.query.review_queue || "").trim(),
        include_match: normalizeBoolean(req.query.include_match, false),
        min_match_percent: req.query.min_match_percent,
        signal: abortController.signal
      });

      if (abortController.signal.aborted || res.writableEnded) return;
      res.json({
        items: sanitizeFrontendValue(result.items),
        count: result.count,
        limit: result.limit,
        offset: result.offset,
        // Present (true/false) only when this request actually needed the wide-scan walk;
        // true means it hit MAX_WIDE_SCAN_CANDIDATE_ROWS before filling the page, so a short
        // or empty result may mean "the scan gave up," not "there is nothing more" -- see
        // postings.js's listPostingsWithFilters.
        ...(result.scan_bounded !== undefined ? { scan_bounded: result.scan_bounded } : {})
      });
    } catch (error) {
      if (error?.name === "AbortError" || abortController.signal.aborted) return;
      throw error;
    } finally {
      req.off("aborted", abortDisconnectedRequest);
      res.off("close", abortDisconnectedRequest);
    }
  });

  return app;
}

// Both ticks share walCheckpointDb, so this keeps them from overlapping on the same
// connection -- a PASSIVE tick landing mid-TRUNCATE would just queue behind it and add
// nothing, and skipping it is free since there is always another tick 30s later.
let walCheckpointInFlight = false;

// See WAL_CHECKPOINT_PASSIVE_INTERVAL_MS above for why this exists: PASSIVE never blocks a
// writer or reader, so running it often is pure upside -- it keeps the WAL small in small
// increments instead of leaving it all for the rare blocking TRUNCATE to deal with at once.
// Runs on walCheckpointDb, not the shared write connection -- see the comment where that
// connection is opened in initDb().
function startWalCheckpointTasks() {
  const passiveTimer = setInterval(async () => {
    if (!walCheckpointDb || walCheckpointInFlight) return;
    walCheckpointInFlight = true;
    try {
      await walCheckpointDb.all("PRAGMA wal_checkpoint(PASSIVE);");
    } catch (error) {
      console.error("[OpenPostings API] periodic WAL passive checkpoint failed:", error?.message || error);
    } finally {
      walCheckpointInFlight = false;
    }
  }, WAL_CHECKPOINT_PASSIVE_INTERVAL_MS);
  if (typeof passiveTimer.unref === "function") passiveTimer.unref();

  // Actually shrinks the file back down, unlike PASSIVE -- but only worth the collision
  // risk when there is a meaningful amount to reclaim. With PASSIVE running every 30s this
  // should usually find little left to do; skip it outright when the file says so.
  const truncateTimer = setInterval(async () => {
    if (!walCheckpointDb || walCheckpointInFlight) return;
    try {
      const walSizeBytes = fs.statSync(`${DB_PATH}-wal`, { throwIfNoEntry: false })?.size || 0;
      if (walSizeBytes < WAL_CHECKPOINT_TRUNCATE_MIN_WAL_BYTES) return;
      walCheckpointInFlight = true;
      await walCheckpointDb.all("PRAGMA wal_checkpoint(TRUNCATE);");
    } catch (error) {
      console.error("[OpenPostings API] periodic WAL truncate checkpoint failed:", error?.message || error);
    } finally {
      walCheckpointInFlight = false;
    }
  }, WAL_CHECKPOINT_TRUNCATE_INTERVAL_MS);
  if (typeof truncateTimer.unref === "function") truncateTimer.unref();

  return { passiveTimer, truncateTimer };
}

async function start() {
  await initDb();

  const app = createServer();
  const host = getApiHost();
  const server = app.listen(PORT, host, () => {
    console.log(`[OpenPostings API] listening on http://${host}:${PORT}`);
    console.log(`[OpenPostings API] using database ${DB_PATH}`);
    console.log(
      `[OpenPostings API] ATS request queue concurrency (runtime): ${getAtsRequestQueueConcurrency()} (saved changes apply after restart)`
    );
  });

  // Shut down promptly and predictably. A restart leaves the app unable to reach the API
  // for however long this takes, and the app surfaces that as a hard error rather than a
  // known maintenance window -- so the window has to be short. The deadline is the point:
  // a sync pass holds in-flight HTTP requests with 30s timeouts, and waiting politely for
  // those turns a one-second restart into a minute of downtime.
  const shutdown = (signal) => {
    console.log(`[OpenPostings API] ${signal} received; shutting down`);
    const deadline = setTimeout(() => {
      console.log("[OpenPostings API] shutdown deadline reached; exiting now");
      process.exit(0);
    }, 2000);
    // Never let the deadline itself hold the process open.
    if (typeof deadline.unref === "function") deadline.unref();
    try {
      server.close(() => process.exit(0));
    } catch {
      process.exit(0);
    }
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  // Watches for a pass that stops making progress and abandons it, so a wedged sync
  // does not leave the cached promise in place and stop syncing until a restart.
  startSyncStallWatchdog();
  startWalCheckpointTasks();

  // Fetching posting pages and keeping the semantic index current run on their own
  // clocks, deliberately not tied to a sync pass finishing.
  startEnrichmentLoops();

  // Notices a write path that has gone quiet, which no error can report because nothing
  // throws. This is what would have caught the transaction wedge in an hour instead of
  // twenty.
  startWriteLivenessWatchdog();

  runAtsSync().catch((error) => {
    console.error("[OpenPostings API] initial sync failed:", error);
  });

  setInterval(() => {
    runAtsSync().catch((error) => {
      console.error("[OpenPostings API] scheduled sync failed:", error);
    });
  }, SYNC_INTERVAL_MS);
}

if (require.main === module) {
  start().catch((error) => {
    console.error("[OpenPostings API] startup failed:", error);
    process.exit(1);
  });
}

module.exports = {
  classifySeededCompanySourceUrl,
  listSeededAtsValues,
  normalizeSourceUrlString,
  DYNAMIC_ATS_OPTIONS,
  SEEDED_ATS_OPTIONS,
  createServer,
  start
};
