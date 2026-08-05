import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppRegistry,
  AppState,
  FlatList,
  Image,
  Linking,
  Modal,
  PermissionsAndroid,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  StatusBar,
  Switch,
  Text,
  TextInput,
  View
} from "react-native";
import {
  API_BASE_URL,
  blockCompany,
  createApplication,
  deleteApplication,
  fetchApplicantDocuments,
  acknowledgeErrors,
  fetchApplicationAnswers,
  fetchErrors,
  fetchApplications,
  fetchApplicationStats,
  fetchBlockedCompanies,
  fetchMcpCandidates,
  fetchMcpSettings,
  fetchCodeStatus,
  fetchPostingFilterOptions,
  fetchPostingDetails,
  fetchPersonalInformation,
  fetchPostings,
  fetchSettingsExport,
  restartServer,
  postFrontendLog,
  fetchSyncServiceSettings,
  fetchSyncStatus,
  ignorePosting,
  setPostingReviewState,
  migrateDatabaseSettings,
  saveApplicationAnswers,
  saveMcpSettings,
  savePersonalInformation,
  saveSyncServiceSettings,
  triggerWorkdaySync,
  unblockCompany,
  updateApplicationStatus,
  updateApplicationFit,
  uploadApplicantDocument
} from "./src/api";
import {
  DEFAULT_POSTINGS_FILTERS,
  loadPersistedFilters,
  savePersistedFilters
} from "./src/filter-storage";

// "recent" is last_seen_epoch, i.e. when the sync last touched the row -- rows in a batch
// share a timestamp and company order is shuffled, so it reads as arbitrary. "first_seen"
// is discovery time and is what answers "what showed up since I last looked".
const POSTING_SORT_OPTIONS = [
  { value: "first_seen_desc", label: "Newest found" },
  { value: "recent", label: "Recently synced" },
  { value: "company_asc", label: "Company A-Z" }
];

// A backgrounded tab or app has no one looking at it, but its polling intervals keep
// firing: every open tab was pulling a full postings page every refresh cycle, so load
// scaled with how many tabs existed rather than with how many were being used. The
// server is single-threaded on one SQLite connection and shares it with the sync, so
// those idle polls compete with the reads someone is actually waiting on.
function isAppForeground() {
  if (Platform.OS === "web") {
    if (typeof document === "undefined") return true;
    return document.visibilityState !== "hidden";
  }
  return AppState.currentState !== "background";
}

const PAGE_KEYS = {
  POSTINGS: "postings",
  APPLICATIONS: "applications",
  APPLICATION_METRICS: "application_metrics",
  SCRAPER_PERFORMANCE: "scraper_performance",
  SETTINGS_APPLICANTEE: "settings_applicantee_information",
  SETTINGS_SYNC: "settings_sync",
  SETTINGS_MCP: "settings_mcp"
};

const PAGE_TITLES = {
  [PAGE_KEYS.POSTINGS]: "Postings",
  [PAGE_KEYS.APPLICATIONS]: "Applications",
  [PAGE_KEYS.APPLICATION_METRICS]: "Application Metrics",
  [PAGE_KEYS.SCRAPER_PERFORMANCE]: "Scraper Performance",
  [PAGE_KEYS.SETTINGS_APPLICANTEE]: "Settings / Applicantee Information",
  [PAGE_KEYS.SETTINGS_SYNC]: "Settings / Sync Settings",
  [PAGE_KEYS.SETTINGS_MCP]: "Settings / MCP Settings"
};
const IS_ANDROID = Platform.OS === "android";
let fileSystemModule;
function getFileSystemModule() {
  if (fileSystemModule !== undefined) return fileSystemModule;
  if (Platform.OS === "windows") {
    fileSystemModule = null;
    return fileSystemModule;
  }
  try {
    fileSystemModule = require("expo-file-system/legacy");
  } catch {
    try {
      fileSystemModule = require("expo-file-system");
    } catch {
      fileSystemModule = null;
    }
  }
  return fileSystemModule;
}

const PLATFORM_DISPLAY_NAME = (() => {
  if (Platform.OS !== "web") return Platform.OS;
  const runtimePlatform = String(globalThis?.openpostings?.platform || "")
    .trim()
    .toLowerCase();
  if (runtimePlatform === "macos") return "macOS";
  return "web";
})();
const ANDROID_STATUS_BAR_TOP_OFFSET = IS_ANDROID ? Math.max(0, Number(StatusBar.currentHeight || 0)) : 0;
const ANDROID_BACKEND_TASK_BASE_NAME = "OpenPostingsBackendService";
const ANDROID_BACKEND_TASK_REGISTRATION_COUNT = 16;
const ANDROID_BACKEND_NOTIFICATION_OPTIONS = {
  taskName: ANDROID_BACKEND_TASK_BASE_NAME,
  taskTitle: "OpenPostings Backend Running",
  taskDesc: "Sync service is active on this device.",
  taskIcon: {
    name: "ic_launcher",
    type: "mipmap"
  },
  color: "#0b6e4f",
  foregroundServiceType: ["dataSync"],
  parameters: {
    delayMs: 3000
  }
};
let androidNodeRuntimeModule;
let androidBackgroundServiceModule;

function getAndroidNodeRuntime() {
  if (!IS_ANDROID) return null;
  if (androidNodeRuntimeModule !== undefined) return androidNodeRuntimeModule;
  try {
    androidNodeRuntimeModule = require("nodejs-mobile-react-native");
  } catch {
    androidNodeRuntimeModule = null;
  }
  return androidNodeRuntimeModule;
}

function getAndroidBackgroundService() {
  if (!IS_ANDROID) return null;
  if (androidBackgroundServiceModule !== undefined) return androidBackgroundServiceModule;
  try {
    const moduleValue = require("react-native-background-actions");
    androidBackgroundServiceModule = moduleValue?.default || moduleValue;
  } catch {
    androidBackgroundServiceModule = null;
  }
  return androidBackgroundServiceModule;
}

function sleepAsync(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runAndroidBackendForegroundTask(parameters = {}) {
  const delayMs = Math.max(1000, Number(parameters?.delayMs || 3000));
  while (true) {
    const backgroundService = getAndroidBackgroundService();
    if (!backgroundService || !backgroundService.isRunning()) break;
    await sleepAsync(delayMs);
  }
}

function registerAndroidBackendHeadlessTasks() {
  if (!IS_ANDROID) return;

  const globalScope = globalThis;
  if (globalScope.__openPostingsAndroidBackendTasksRegistered) return;

  for (let index = 1; index <= ANDROID_BACKEND_TASK_REGISTRATION_COUNT; index += 1) {
    const taskKey = `${ANDROID_BACKEND_TASK_BASE_NAME}${index}`;
    AppRegistry.registerHeadlessTask(taskKey, () => runAndroidBackendForegroundTask);
  }

  globalScope.__openPostingsAndroidBackendTasksRegistered = true;
}

registerAndroidBackendHeadlessTasks();

async function ensureAndroidNotificationPermission() {
  if (!IS_ANDROID) return true;
  if (Number(Platform.Version || 0) < 33) return true;
  const permissionName = PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS;
  const alreadyGranted = await PermissionsAndroid.check(permissionName);
  if (alreadyGranted) return true;
  const requestResult = await PermissionsAndroid.request(permissionName);
  return requestResult === PermissionsAndroid.RESULTS.GRANTED;
}

const APPLICATION_STATUS_OPTIONS = [
  "applied",
  "interview scheduled",
  "awaiting response",
  "offer received",
  "withdrawn",
  "denied"
];
const APPLICATION_FIT_OPTIONS = ["good fit", "stretch", "overqualified", "underqualified"];
const DEFAULT_SYNC_INTERVAL_SECONDS = 3600;
const FRONTEND_POSTINGS_FETCH_LIMIT = 50;
const POSTING_REVIEW_QUEUES = Object.freeze([
  { value: "new", label: "New" },
  { value: "shortlisted", label: "Shortlisted" },
  { value: "reviewed", label: "Reviewed" }
]);
const MIN_SYNC_INTERVAL_SECONDS = 60;
const MAX_SYNC_INTERVAL_SECONDS = 24 * 60 * 60;
const SYNC_PERFORMANCE_SAMPLE_INTERVAL_MS = 15 * 1000;
const MAX_SYNC_PERFORMANCE_SAMPLES = 40;
const DEFAULT_ATS_REQUEST_QUEUE_CONCURRENCY = 1;
const MIN_ATS_REQUEST_QUEUE_CONCURRENCY = 1;
const MAX_ATS_REQUEST_QUEUE_CONCURRENCY = 20;
const DEFAULT_POSTING_FRESHNESS_HOURS = 24;
const MIN_POSTING_FRESHNESS_HOURS = 24;
const MAX_POSTING_FRESHNESS_HOURS = 24 * 7;
const DEFAULT_ATS_FILTER_OPTIONS = [
  { value: "adp_myjobs", label: "ADP MyJobs" },
  { value: "paycor", label: "Paycor" },
  { value: "paycomonline", label: "PaycomOnline" },
  { value: "prismhr", label: "PrismHR" },
  { value: "silkroad", label: "SilkRoad" },
  { value: "adp_workforcenow", label: "ADP Workforce Now" },
  { value: "applicantai", label: "ApplicantAI" },
  { value: "applitrack", label: "Applitrack" },
  { value: "applicantpro", label: "ApplicantPro" },
  { value: "applytojob", label: "ApplyToJob" },
  { value: "ashby", label: "Ashby" },
  { value: "bamboohr", label: "BambooHR" },
  { value: "brassring", label: "BrassRing" },
  { value: "breezy", label: "BreezyHR" },
  { value: "careerplug", label: "CareerPlug" },
  { value: "careerpuck", label: "CareerPuck" },
  { value: "careerspage", label: "CareersPage" },
  { value: "dayforcehcm", label: "Dayforce" },
  { value: "eightfold", label: "Eightfold" },
  { value: "fountain", label: "Fountain" },
  { value: "freshteam", label: "Freshteam" },
  { value: "agilehr", label: "AgileHR" },
  { value: "avature", label: "Avature" },
  { value: "comeet", label: "Comeet" },
  { value: "factorialhr", label: "FactorialHR" },
  { value: "hireology", label: "Hireology" },
  { value: "crelate", label: "Crelate" },
  { value: "hiringplatform", label: "HiringPlatform" },
  { value: "homerun", label: "Homerun" },
  { value: "jibeapply", label: "JibeApply" },
  { value: "jobs2web", label: "Jobs2Web" },
  { value: "occupop", label: "Occupop" },
  { value: "peopleadmin", label: "PeopleAdmin" },
  { value: "personio", label: "Personio" },
  { value: "recruiterflow", label: "Recruiterflow" },
  { value: "softgarden", label: "Softgarden" },
  { value: "trakstar", label: "Trakstar" },
  { value: "ukg", label: "UKG" },
  { value: "ycombinator", label: "YCombinator" },
  { value: "yello", label: "Yello" },
  { value: "gem", label: "Gem" },
  { value: "getro", label: "Getro" },
  { value: "governmentjobs", label: "GovernmentJobs" },
  { value: "smartrecruiters", label: "SmartRecruiters" },
  { value: "policeapp", label: "PoliceApp" },
  { value: "usajobs", label: "USAJobs" },
  { value: "k12jobspot", label: "K12JobSpot" },
  { value: "snaphunt", label: "Snaphunt" },
  { value: "dover", label: "Dover" },
  { value: "oorwin", label: "Oorwin" },
  { value: "schoolspring", label: "SchoolSpring" },
  { value: "calcareers", label: "CalCareers" },
  { value: "calopps", label: "CalOpps" },
  { value: "statejobsny", label: "StateJobsNY" },
  { value: "edjoin", label: "EdJoin" },
  { value: "webcruiter", label: "Webcruiter" },
  { value: "academicjobsonline", label: "AcademicJobsOnline" },
  { value: "amazon", label: "Amazon Jobs" },
  { value: "expedia", label: "Expedia Group" },
  { value: "microsoft", label: "Microsoft Careers" },
  { value: "boeing", label: "Boeing" },
  { value: "hibob", label: "HiBob" },
  { value: "isolved", label: "isolved" },
  { value: "greenhouse", label: "Greenhouse" },
  { value: "hirebridge", label: "Hirebridge" },
  { value: "hcareers", label: "Hcareers" },
  { value: "hrmdirect", label: "HRMDirect" },
  { value: "icims", label: "iCIMS" },
  { value: "jobaps", label: "JobAps" },
  { value: "jobvite", label: "Jobvite" },
  { value: "join", label: "JOIN" },
  { value: "lever", label: "Lever" },
  { value: "loxo", label: "Loxo" },
  { value: "manatal", label: "Manatal" },
  { value: "oracle", label: "Oracle" },
  { value: "pageup", label: "PageUp" },
  { value: "paylocity", label: "Paylocity" },
  { value: "peopleforce", label: "PeopleForce" },
  { value: "pinpointhq", label: "PinpointHQ" },
  { value: "recruitcrm", label: "RecruitCRM" },
  { value: "recruitee", label: "Recruitee" },
  { value: "rippling", label: "Rippling" },
  { value: "sagehr", label: "SageHR" },
  { value: "saphrcloud", label: "SAP HR Cloud" },
  { value: "simplicant", label: "Simplicant" },
  { value: "talentlyft", label: "Talentlyft" },
  { value: "talentreef", label: "TalentReef" },
  { value: "taleo", label: "Taleo" },
  { value: "talexio", label: "Talexio" },
  { value: "teamtailor", label: "Teamtailor" },
  { value: "theapplicantmanager", label: "The Applicant Manager" },
  { value: "ultipro", label: "UltiPro" },
  { value: "workday", label: "Workday" },
  { value: "zoho", label: "Zoho Recruit" }
];
const ATS_LABEL_BY_VALUE = {
  adp_myjobs: "ADP MyJobs",
  paycor: "Paycor",
  paycomonline: "PaycomOnline",
  prismhr: "PrismHR",
  silkroad: "SilkRoad",
  adp_workforcenow: "ADP Workforce Now",
  applicantai: "ApplicantAI",
  applitrack: "Applitrack",
  applicantpro: "ApplicantPro",
  applytojob: "ApplyToJob",
  ashby: "Ashby",
  bamboohr: "BambooHR",
  brassring: "BrassRing",
  breezy: "BreezyHR",
  careerplug: "CareerPlug",
  careerpuck: "CareerPuck",
  careerspage: "CareersPage",
  dayforcehcm: "Dayforce",
  eightfold: "Eightfold",
  fountain: "Fountain",
  freshteam: "Freshteam",
  agilehr: "AgileHR",
  avature: "Avature",
  comeet: "Comeet",
  factorialhr: "FactorialHR",
  hireology: "Hireology",
  crelate: "Crelate",
  hiringplatform: "HiringPlatform",
  homerun: "Homerun",
  jibeapply: "JibeApply",
  jobs2web: "Jobs2Web",
  occupop: "Occupop",
  peopleadmin: "PeopleAdmin",
  personio: "Personio",
  recruiterflow: "Recruiterflow",
  softgarden: "Softgarden",
  trakstar: "Trakstar",
  ukg: "UKG",
  ycombinator: "YCombinator",
  yello: "Yello",
  gem: "Gem",
  getro: "Getro",
  governmentjobs: "GovernmentJobs",
  smartrecruiters: "SmartRecruiters",
  policeapp: "PoliceApp",
  usajobs: "USAJobs",
  k12jobspot: "K12JobSpot",
  snaphunt: "Snaphunt",
  dover: "Dover",
  oorwin: "Oorwin",
  schoolspring: "SchoolSpring",
  calcareers: "CalCareers",
  calopps: "CalOpps",
  statejobsny: "StateJobsNY",
  edjoin: "EdJoin",
  webcruiter: "Webcruiter",
  academicjobsonline: "AcademicJobsOnline",
  amazon: "Amazon Jobs",
  expedia: "Expedia Group",
  microsoft: "Microsoft Careers",
  apple: "Apple",
  meta: "Meta",
  walmart: "Walmart",
  disney: "Disney",
  boeing: "Boeing",
  hibob: "HiBob",
  isolved: "isolved",
  greenhouse: "Greenhouse",
  hirebridge: "Hirebridge",
  hcareers: "Hcareers",
  hrmdirect: "HRMDirect",
  icims: "iCIMS",
  jobaps: "JobAps",
  jobvite: "Jobvite",
  join: "JOIN",
  lever: "Lever",
  loxo: "Loxo",
  manatal: "Manatal",
  oracle: "Oracle",
  pageup: "PageUp",
  paylocity: "Paylocity",
  peopleforce: "PeopleForce",
  pinpointhq: "PinpointHQ",
  recruitcrm: "RecruitCRM",
  recruitee: "Recruitee",
  rippling: "Rippling",
  sagehr: "SageHR",
  saphrcloud: "SAP HR Cloud",
  simplicant: "Simplicant",
  talentlyft: "Talentlyft",
  talentreef: "TalentReef",
  taleo: "Taleo",
  talexio: "Talexio",
  teamtailor: "Teamtailor",
  theapplicantmanager: "The Applicant Manager",
  ultipro: "UltiPro",
  workday: "Workday",
  zoho: "Zoho Recruit"
};

let androidNetInfoModule;

function getAndroidNetInfo() {
  if (Platform.OS !== "android") return null;
  if (androidNetInfoModule !== undefined) {
    return androidNetInfoModule;
  }
  try {
    androidNetInfoModule = require("@react-native-community/netinfo").default;
  } catch {
    androidNetInfoModule = null;
  }
  return androidNetInfoModule;
}

function sanitizeDisplayText(value, fallback = "") {
  const source = String(value ?? "");
  if (!source) return fallback;

  let cleaned = "";
  for (let index = 0; index < source.length; index += 1) {
    const code = source.charCodeAt(index);

    // Drop surrogate pairs and lone surrogate code units to avoid unstable
    // rendering behavior in some Windows/Hermes combinations.
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

    // Keep printable characters plus tab/newline/carriage return.
    if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) {
      continue;
    }

    cleaned += source[index];
  }

  return cleaned || fallback;
}

function formatDateTimeSafe(value, fallback = "Unknown time") {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return fallback;
  }
  const pad = (part) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(
    date.getMinutes()
  )}:${pad(date.getSeconds())}`;
}

function formatTimeSafe(value, fallback = "Unknown time") {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return fallback;
  }
  const pad = (part) => String(part).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function formatDurationCompact(secondsValue) {
  const seconds = Number(secondsValue);
  if (!Number.isFinite(seconds) || seconds < 0) return "unknown";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

function formatDaysCompact(daysValue) {
  const days = Number(daysValue);
  if (!Number.isFinite(days) || days < 0) return "unknown";
  if (days < 1) return `${Math.round(days * 24)}h`;
  return `${days.toFixed(1)}d`;
}

function formatApplicationDate(value) {
  const epochSeconds = Number(value);
  if (!Number.isFinite(epochSeconds) || epochSeconds <= 0) {
    return "Unknown date";
  }

  const date = new Date(epochSeconds * 1000);
  if (Number.isNaN(date.getTime())) {
    return "Unknown date";
  }

  const pad = (part) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(
    date.getMinutes()
  )}`;
}

function normalizeApplicationItem(item) {
  const source = item && typeof item === "object" ? item : {};
  return {
    ...source,
    id: Number(source.id || 0),
    company_name: sanitizeDisplayText(source.company_name, ""),
    position_name: sanitizeDisplayText(source.position_name, ""),
    status: sanitizeDisplayText(source.status, "applied"),
    fit_assessment: sanitizeDisplayText(source.fit_assessment, ""),
    applied_by_label: sanitizeDisplayText(source.applied_by_label, "")
  };
}

function normalizePostingItem(item, index = 0) {
  const source = item && typeof item === "object" ? item : {};
  const urlValue = sanitizeDisplayText(source.job_posting_url, "").trim();
  const companyName = sanitizeDisplayText(source.company_name, "");
  const positionName = sanitizeDisplayText(source.position_name, "");
  const fallbackCompanyPart = normalizeCompanyName(companyName) || "company";
  const fallbackPositionPart =
    String(positionName || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "-") || "position";
  return {
    ...source,
    company_name: companyName,
    position_name: positionName,
    location: sanitizeDisplayText(source.location, ""),
    posting_date: sanitizeDisplayText(source.posting_date, ""),
    job_description: sanitizeDisplayText(source.job_description, ""),
    ats: sanitizeDisplayText(source.ats, ""),
    applied_by_label: sanitizeDisplayText(source.applied_by_label, ""),
    ignored_by_label: sanitizeDisplayText(source.ignored_by_label, ""),
    job_posting_url: urlValue,
    _row_fallback_key: urlValue || `${fallbackCompanyPart}-${fallbackPositionPart}-${index}`
  };
}

function normalizePostingItems(items) {
  const source = Array.isArray(items) ? items : [];
  return source.map((item, index) => normalizePostingItem(item, index));
}

function getPostingFreshnessLabel(item) {
  return sanitizeDisplayText(item?.freshness?.label, "Posting date confidence unavailable");
}

function getPostingConfidenceLabels(item) {
  const confidence = item?.confidence && typeof item.confidence === "object" ? item.confidence : {};
  const labels = [];
  if (confidence.description === "available") labels.push("Description");
  if (confidence.location === "available") labels.push("Location");
  if (confidence.location === "conflict") labels.push("Location conflict");
  if (confidence.compensation === "available") labels.push("Pay");
  if (confidence.liveness === "confirmed_live") labels.push("Live checked");
  if (confidence.liveness === "delisted") labels.push("Delisted");
  return labels;
}

function formatPostingCompensationAmount(value, currencyCode = "") {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue <= 0) return "";

  const usesFractionDigits = Math.abs(numericValue % 1) > 0;
  const fractionDigits = usesFractionDigits ? 2 : 0;
  const normalizedCurrencyCode = sanitizeDisplayText(currencyCode, "").toUpperCase();

  if (normalizedCurrencyCode) {
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: normalizedCurrencyCode,
        minimumFractionDigits: fractionDigits,
        maximumFractionDigits: fractionDigits
      }).format(numericValue);
    } catch {
      return `${normalizedCurrencyCode} ${new Intl.NumberFormat(undefined, {
        minimumFractionDigits: fractionDigits,
        maximumFractionDigits: fractionDigits
      }).format(numericValue)}`.trim();
    }
  }

  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits
  }).format(numericValue);
}

function formatPostingCompensationLabel(item) {
  const payRaw = sanitizeDisplayText(item?.pay_raw, "");
  if (payRaw) return payRaw;

  const payMin = Number(item?.pay_min);
  const payMax = Number(item?.pay_max);
  const hasMin = Number.isFinite(payMin) && payMin > 0;
  const hasMax = Number.isFinite(payMax) && payMax > 0;
  if (!hasMin && !hasMax) return "";

  const payCurrency = sanitizeDisplayText(item?.pay_currency, "");
  const payPeriod = sanitizeDisplayText(item?.pay_period, "");
  const suffix = payPeriod ? ` per ${payPeriod}` : "";

  if (hasMin && hasMax) {
    if (payMin === payMax) {
      return `Structured pay fallback (exact value): ${formatPostingCompensationAmount(payMin, payCurrency)}${suffix}`;
    }
    return `Structured pay fallback (min/max): ${formatPostingCompensationAmount(payMin, payCurrency)} - ${formatPostingCompensationAmount(payMax, payCurrency)}${suffix}`;
  }
  if (hasMin) {
    return `Structured pay fallback (min only): ${formatPostingCompensationAmount(payMin, payCurrency)}${suffix}`;
  }
  return `Structured pay fallback (max only): ${formatPostingCompensationAmount(payMax, payCurrency)}${suffix}`;
}

function normalizeAtsValue(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return "";
  if (normalized === "ashbyhq") return "ashby";
  if (normalized === "greenhouseio" || normalized === "greenhouse.io") return "greenhouse";
  if (normalized === "leverco" || normalized === "lever.co") return "lever";
  if (normalized === "dayforce" || normalized === "dayforcehcm" || normalized === "dayforcehcm.com") {
    return "dayforcehcm";
  }
  if (normalized === "jobvitecom" || normalized === "jobvite.com") return "jobvite";
  if (normalized === "hibob.com" || normalized === "hibobcom" || normalized === "hibob" || normalized === "careers.hibob.com" || normalized === "careershibobcom") return "hibob";
  if (normalized === "hiringplatform" || normalized === "hiringplatform.com" || normalized === "hiringplatformcom") {
    return "hiringplatform";
  }
  if (normalized === "homerun" || normalized === "homerun.co" || normalized === "homerunco") {
    return "homerun";
  }
  if (normalized === "jibeapply" || normalized === "jibeapply.com" || normalized === "jibeapplycom") {
    return "jibeapply";
  }
  if (normalized === "jobs2web" || normalized === "jobs2web.com" || normalized === "jobs2webcom") {
    return "jobs2web";
  }
  if (
    normalized === "occupop" ||
    normalized === "occupop.com" ||
    normalized === "occupopcom" ||
    normalized === "occupop-careers.com" ||
    normalized === "occupopcareerscom"
  ) {
    return "occupop";
  }
  if (
    normalized === "peopleadmin" ||
    normalized === "peopleadmin.com" ||
    normalized === "peopleadmincom"
  ) {
    return "peopleadmin";
  }
  if (
    normalized === "personio" ||
    normalized === "personio.com" ||
    normalized === "personiocom" ||
    normalized === "jobs.personio.com" ||
    normalized === "jobspersoniocom"
  ) {
    return "personio";
  }
  if (
    normalized === "recruiterflow" ||
    normalized === "recruiterflow.com" ||
    normalized === "recruiterflowcom" ||
    normalized === "www.recruiterflow.com" ||
    normalized === "wwwrecruiterflowcom"
  ) {
    return "recruiterflow";
  }
  if (normalized === "softgarden" || normalized === "softgarden.io" || normalized === "softgardenio") {
    return "softgarden";
  }
  if (
    normalized === "trakstar" ||
    normalized === "hire.trakstar.com" ||
    normalized === "hiretrakstarcom" ||
    normalized === "recruiterbox.com" ||
    normalized === "recruiterboxcom" ||
    normalized === "trakstarhire.com" ||
    normalized === "trakstarhirecom"
  ) {
    return "trakstar";
  }
  if (
    normalized === "ycombinator" ||
    normalized === "ycombinator.com" ||
    normalized === "ycombinatorcom" ||
    normalized === "www.ycombinator.com" ||
    normalized === "wwwycombinatorcom"
  ) {
    return "ycombinator";
  }
  if (
    normalized === "yello" ||
    normalized === "yello.co" ||
    normalized === "yelloco" ||
    normalized === "www.yello.co" ||
    normalized === "wwwyelloco"
  ) {
    return "yello";
  }
  // "isolvisolvedhire" is the typo this client used as the canonical value before it
  // was reconciled with the server; keep accepting it so stored settings survive.
  if (normalized === "isolvisolvedhire" || normalized === "isolvedhire" || normalized === "isolvedhire.com" || normalized === "isolvedhirecom" || normalized === "isolved") {
    return "isolved";
  }
  if (normalized === "agilehr.com" || normalized === "agilehrcom" || normalized === "agilehr") return "agilehr";
  if (normalized === "avature" || normalized === "avature.net" || normalized === "avaturenet") return "avature";
  if (normalized === "comeet" || normalized === "comeet.com" || normalized === "comeetcom" || normalized === "www.comeet.com" || normalized === "wwwcomeetcom") return "comeet";
  if (normalized === "applicantprocom" || normalized === "applicantpro.com") return "applicantpro";
  if (normalized === "applitrackcom" || normalized === "applitrack.com") return "applitrack";
  if (normalized === "bamboohrcom" || normalized === "bamboohr.com") return "bamboohr";
  if (normalized === "freshteamcom" || normalized === "freshteam.com") return "freshteam";
  if (normalized === "governmentjobscom" || normalized === "governmentjobs.com") return "governmentjobs";
  if (normalized === "policeappcom" || normalized === "policeapp.com" || normalized === "www.policeapp.com" || normalized === "policeapp") return "policeapp";
  if (normalized === "usajobsgov" || normalized === "usajobs.gov" || normalized === "www.usajobs.gov" || normalized === "usajobs") return "usajobs";
  if (normalized === "k12jobspotcom" || normalized === "k12jobspot.com" || normalized === "www.k12jobspot.com" || normalized === "api.k12jobspot.com" || normalized === "k12jobspot") return "k12jobspot";
  if (normalized === "schoolspringcom" || normalized === "schoolspring.com" || normalized === "www.schoolspring.com" || normalized === "api.schoolspring.com" || normalized === "schoolspring") return "schoolspring";
  if (normalized === "calcareers" || normalized === "calcareers.ca.gov" || normalized === "www.calcareers.ca.gov" || normalized === "calcareerscagov" || normalized === "wwwcalcareerscagov") return "calcareers";
  if (normalized === "calopps" || normalized === "calopps.org" || normalized === "www.calopps.org" || normalized === "caloppsorg" || normalized === "wwwcaloppsorg") return "calopps";
  if (normalized === "statejobsny" || normalized === "statejobsny.com" || normalized === "www.statejobsny.com" || normalized === "statejobsnycom" || normalized === "wwwstatejobsnycom") return "statejobsny";
  if (normalized === "edjoin" || normalized === "edjoin.org" || normalized === "www.edjoin.org" || normalized === "edjoinorg" || normalized === "wwwedjoinorg") return "edjoin";
  if (normalized === "webcruiter" || normalized === "webcruiter.com" || normalized === "webcruitercom" || normalized === "candidate.webcruiter.com" || normalized === "candidatewebcruitercom") return "webcruiter";
  if (normalized === "academicjobsonline" || normalized === "academicjobsonline.org" || normalized === "www.academicjobsonline.org" || normalized === "academicjobsonlineorg" || normalized === "wwwacademicjobsonlineorg") return "academicjobsonline";
  if (
    normalized === "smartrecruiterscom" ||
    normalized === "smartrecruiters.com" ||
    normalized === "jobs.smartrecruiters.com" ||
    normalized === "jobssmartrecruiterscom"
  ) {
    return "smartrecruiters";
  }
  if (
    normalized === "sagehr" ||
    normalized === "sage.hr" ||
    normalized === "talent.sage.hr" ||
    normalized === "talentsagehr"
  ) {
    return "sagehr";
  }
  if (normalized === "peopleforceio" || normalized === "peopleforce.io") return "peopleforce";
  if (normalized === "simplicantcom" || normalized === "simplicant.com") return "simplicant";
  if (normalized === "pinpointhqcom" || normalized === "pinpointhq.com") return "pinpointhq";
  if (normalized === "recruitcrmiocom" || normalized === "recruitcrm.io" || normalized === "recruitcrmio") return "recruitcrm";
  if (normalized === "rippling.com" || normalized === "ripplingcom" || normalized === "ats.rippling.com" || normalized === "atsripplingcom") {
    return "rippling";
  }
  if (normalized === "applytojobcom" || normalized === "applytojob.com") return "applytojob";
  if (normalized === "theapplicantmanagercom" || normalized === "theapplicantmanager.com") {
    return "theapplicantmanager";
  }
  if (normalized === "icimscom" || normalized === "icims.com") return "icims";
  if (normalized === "jobs.gem.com" || normalized === "gem.com" || normalized === "gemcom") return "gem";
  if (normalized === "jobapscloud.com" || normalized === "jobapscloudcom") return "jobaps";
  if (
    normalized === "jobappnetwork.com" ||
    normalized === "jobappnetworkcom" ||
    normalized === "apply.jobappnetwork.com" ||
    normalized === "applyjobappnetworkcom"
  ) {
    return "talentreef";
  }
  if (normalized === "adp_myjobs" || normalized === "adpmyjobs") return "adp_myjobs";
  if (
    normalized === "paycor" ||
    normalized === "recruitingbypaycor.com" ||
    normalized === "recruitingbypaycorcom" ||
    normalized === "www.recruitingbypaycor.com" ||
    normalized === "wwwrecruitingbypaycorcom"
  ) {
    return "paycor";
  }
  if (normalized === "paycomonline" || normalized === "paycomonline.net" || normalized === "paycomonlinenet" || normalized === "www.paycomonline.net" || normalized === "wwwpaycomonlinenet") return "paycomonline";
  if (normalized === "prismhr" || normalized === "prismhr-hire.com" || normalized === "prismhrhirecom" || normalized === "www.prismhr-hire.com" || normalized === "wwwprismhrhirecom") return "prismhr";
  if (normalized === "silkroad" || normalized === "jobs.silkroad.com" || normalized === "jobssilkroadcom" || normalized === "www.jobs.silkroad.com" || normalized === "wwwjobssilkroadcom") return "silkroad";
  if (
    normalized === "paylocity" ||
    normalized === "paylocity.com" ||
    normalized === "paylocitycom" ||
    normalized === "recruiting.paylocity.com" ||
    normalized === "recruitingpaylocitycom"
  ) {
    return "paylocity";
  }
  if (normalized === "eightfold" || normalized === "eightfold.ai" || normalized === "eightfoldai") {
    return "eightfold";
  }
  if (
    normalized === "oracle" ||
    normalized === "oraclecloud" ||
    normalized === "oraclecloud.com" ||
    normalized === "oraclecloudcom"
  ) {
    return "oracle";
  }
  if (normalized === "careerspage" || normalized === "careerspage.io" || normalized === "careerspageio") {
    return "careerspage";
  }
  if (
    normalized === "hirebridge" ||
    normalized === "hirebridge.com" ||
    normalized === "hirebridgecom" ||
    normalized === "recruit.hirebridge.com" ||
    normalized === "recruithirebridgecom"
  ) {
    return "hirebridge";
  }
  if (
    normalized === "saphrcloud.com" ||
    normalized === "saphrcloudcom" ||
    normalized === "jobs.hr.cloud.sap" ||
    normalized === "jobshrcloudsap"
  ) {
    return "saphrcloud";
  }
  if (normalized === "recruiteecom" || normalized === "recruitee.com") return "recruitee";
  if (
    normalized === "ukg" ||
    normalized === "ukg.net" ||
    normalized === "ukgnet" ||
    normalized === "rec.pro.ukg.net" ||
    normalized === "recproukgnet"
  ) {
    return "ukg";
  }
  if (normalized === "taleonet" || normalized === "taleo.net") return "taleo";
  return normalized;
}

function normalizeCompanyName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function getAtsDisplayLabel(value) {
  const normalized = normalizeAtsValue(value);
  if (!normalized) return "ATS unavailable";
  return ATS_LABEL_BY_VALUE[normalized] || normalized;
}

function mergeAtsFilterOptions(options) {
  const byValue = new Map();
  const source = Array.isArray(options) ? options : [];

  for (const option of source) {
    const value = normalizeAtsValue(option?.value);
    if (!value) continue;
    const fallbackLabel = getAtsDisplayLabel(value);
    const label = String(option?.label || "").trim() || fallbackLabel;
    byValue.set(value, { value, label, enabled: option?.enabled !== false });
  }

  for (const option of DEFAULT_ATS_FILTER_OPTIONS) {
    if (!byValue.has(option.value)) {
      byValue.set(option.value, { ...option, enabled: true });
    }
  }

  return Array.from(byValue.values());
}

function normalizeSyncIntervalSeconds(value) {
  const parsed = Number.parseInt(String(value || "").trim(), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_SYNC_INTERVAL_SECONDS;
  if (parsed < MIN_SYNC_INTERVAL_SECONDS) return MIN_SYNC_INTERVAL_SECONDS;
  if (parsed > MAX_SYNC_INTERVAL_SECONDS) return MAX_SYNC_INTERVAL_SECONDS;
  return parsed;
}

function formatSyncIntervalLabel(seconds) {
  const value = normalizeSyncIntervalSeconds(seconds);
  if (value % 3600 === 0) {
    const hours = value / 3600;
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }
  if (value % 60 === 0) {
    const minutes = value / 60;
    return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  }
  return `${value} seconds`;
}

function normalizeAtsRequestQueueConcurrency(value) {
  const parsed = Number.parseInt(String(value || "").trim(), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_ATS_REQUEST_QUEUE_CONCURRENCY;
  if (parsed < MIN_ATS_REQUEST_QUEUE_CONCURRENCY) return MIN_ATS_REQUEST_QUEUE_CONCURRENCY;
  if (parsed > MAX_ATS_REQUEST_QUEUE_CONCURRENCY) return MAX_ATS_REQUEST_QUEUE_CONCURRENCY;
  return parsed;
}

function normalizePostingFreshnessHours(value) {
  const parsed = Number.parseInt(String(value || "").trim(), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_POSTING_FRESHNESS_HOURS;
  if (parsed < MIN_POSTING_FRESHNESS_HOURS) return MIN_POSTING_FRESHNESS_HOURS;
  if (parsed > MAX_POSTING_FRESHNESS_HOURS) return MAX_POSTING_FRESHNESS_HOURS;
  return parsed;
}

function normalizeSyncEnabledAts(value, fallback = DEFAULT_ATS_FILTER_OPTIONS.map((option) => option.value)) {
  const allowed = new Set(DEFAULT_ATS_FILTER_OPTIONS.map((option) => option.value));
  const source = (Array.isArray(value) ? value : []).filter((item) => String(item || "").trim());
  const normalized = [];
  for (const item of source) {
    const atsValue = normalizeAtsValue(item);
    if (!atsValue || !allowed.has(atsValue) || normalized.includes(atsValue)) continue;
    normalized.push(atsValue);
  }
  if (normalized.length > 0) return normalized;

  // Matches the server: a selection that named ATSs but matched none of them stays
  // narrow instead of expanding to every ATS. Only an absent selection takes the
  // default, and the toggle list below refuses to clear the last entry.
  if (source.length > 0) return [];

  const fallbackList = Array.isArray(fallback) ? fallback : [];
  const fallbackNormalized = [];
  for (const item of fallbackList) {
    const atsValue = normalizeAtsValue(item);
    if (!atsValue || !allowed.has(atsValue) || fallbackNormalized.includes(atsValue)) continue;
    fallbackNormalized.push(atsValue);
  }
  if (fallbackNormalized.length > 0) return fallbackNormalized;
  return DEFAULT_ATS_FILTER_OPTIONS.map((option) => option.value);
}

function createDefaultSyncServiceSettings() {
  return {
    ats_request_queue_concurrency: String(DEFAULT_ATS_REQUEST_QUEUE_CONCURRENCY),
    sync_enabled_ats: DEFAULT_ATS_FILTER_OPTIONS.map((option) => option.value),
    posting_freshness_hours: String(DEFAULT_POSTING_FRESHNESS_HOURS),
    active_posting_freshness_hours: String(DEFAULT_POSTING_FRESHNESS_HOURS),
    min_posting_freshness_hours: MIN_POSTING_FRESHNESS_HOURS,
    max_posting_freshness_hours: MAX_POSTING_FRESHNESS_HOURS,
    active_ats_request_queue_concurrency: String(DEFAULT_ATS_REQUEST_QUEUE_CONCURRENCY),
    min_ats_request_queue_concurrency: MIN_ATS_REQUEST_QUEUE_CONCURRENCY,
    max_ats_request_queue_concurrency: MAX_ATS_REQUEST_QUEUE_CONCURRENCY,
    applies_after_service_restart: true
  };
}

function toFormSyncServiceSettings(value) {
  const defaults = createDefaultSyncServiceSettings();
  const source = value && typeof value === "object" ? value : {};
  const configured = normalizeAtsRequestQueueConcurrency(source.ats_request_queue_concurrency);
  const active = normalizeAtsRequestQueueConcurrency(
    source.active_ats_request_queue_concurrency ?? configured
  );
  const postingFreshness = normalizePostingFreshnessHours(source.posting_freshness_hours);
  const activePostingFreshness = normalizePostingFreshnessHours(
    source.active_posting_freshness_hours ?? postingFreshness
  );
  const syncEnabledAts = normalizeSyncEnabledAts(source.sync_enabled_ats, defaults.sync_enabled_ats);
  const minValue = normalizeAtsRequestQueueConcurrency(source.min_ats_request_queue_concurrency || defaults.min_ats_request_queue_concurrency);
  const maxValue = normalizeAtsRequestQueueConcurrency(source.max_ats_request_queue_concurrency || defaults.max_ats_request_queue_concurrency);
  const minPostingFreshness = normalizePostingFreshnessHours(
    source.min_posting_freshness_hours || defaults.min_posting_freshness_hours
  );
  const maxPostingFreshness = normalizePostingFreshnessHours(
    source.max_posting_freshness_hours || defaults.max_posting_freshness_hours
  );

  return {
    ats_request_queue_concurrency: String(configured),
    sync_enabled_ats: syncEnabledAts,
    posting_freshness_hours: String(postingFreshness),
    active_posting_freshness_hours: String(activePostingFreshness),
    min_posting_freshness_hours: Math.min(minPostingFreshness, maxPostingFreshness),
    max_posting_freshness_hours: Math.max(minPostingFreshness, maxPostingFreshness),
    active_ats_request_queue_concurrency: String(active),
    min_ats_request_queue_concurrency: Math.min(minValue, maxValue),
    max_ats_request_queue_concurrency: Math.max(minValue, maxValue),
    applies_after_service_restart: source.applies_after_service_restart !== false
  };
}

// Grouping for the application-questions form. The server owns the category values; these
// only decide display order and wording, and any category not listed here is skipped, so a
// server that adds one is a UI change rather than a silent omission.
const APPLICATION_ANSWER_CATEGORY_ORDER = ["eligibility", "compensation", "logistics", "background", "narrative", "other"];
const APPLICATION_ANSWER_CATEGORY_LABELS = {
  eligibility: "Work eligibility",
  compensation: "Compensation",
  logistics: "Availability and location",
  background: "Background checks and history",
  narrative: "Your story",
  other: "Other"
};

const PERSONAL_INFORMATION_FIELDS = [
  { key: "first_name", label: "First Name", placeholder: "Jane", autoCapitalize: "words" },
  { key: "middle_name", label: "Middle Name", placeholder: "Alex", autoCapitalize: "words" },
  { key: "last_name", label: "Last Name", placeholder: "Doe", autoCapitalize: "words" },
  { key: "email", label: "Email", placeholder: "jane@example.com", keyboardType: "email-address" },
  { key: "phone_number", label: "Phone Number", placeholder: "(555) 555-5555", keyboardType: "phone-pad" },
  { key: "address", label: "Address", placeholder: "123 Main St, Seattle, WA", autoCapitalize: "words", multiline: true },
  { key: "linkedin_url", label: "LinkedIn URL", placeholder: "https://linkedin.com/in/username", keyboardType: "url" },
  { key: "github_url", label: "GitHub URL", placeholder: "https://github.com/username", keyboardType: "url" },
  { key: "portfolio_url", label: "Portfolio URL", placeholder: "https://yourportfolio.com", keyboardType: "url" },
  { key: "resume_file_path", label: "Resume File Path", placeholder: "C:\\Users\\You\\Documents\\resume.pdf" },
  { key: "projects_portfolio_file_path", label: "Projects Portfolio File Path", placeholder: "C:\\Users\\You\\Documents\\projects.pdf" },
  { key: "certifications_folder_path", label: "Certifications Folder Path", placeholder: "C:\\Users\\You\\Documents\\certifications" },
  { key: "ethnicity", label: "Ethnicity", placeholder: "Optional value" },
  { key: "gender", label: "Gender", placeholder: "Optional value" },
  { key: "age", label: "Age", placeholder: "29", keyboardType: "numeric" },
  { key: "years_of_experience", label: "Years of Experience", placeholder: "6", keyboardType: "numeric" },
  { key: "veteran_status", label: "Veteran Status", placeholder: "Optional value" },
  { key: "disability_status", label: "Disability Status", placeholder: "Optional value" },
  { key: "education_level", label: "Education Level", placeholder: "Bachelor's Degree" }
];

function createEmptyPersonalInformation() {
  return PERSONAL_INFORMATION_FIELDS.reduce((accumulator, field) => {
    accumulator[field.key] = "";
    return accumulator;
  }, {});
}

function toFormPersonalInformation(value) {
  const source = value && typeof value === "object" ? value : {};
  const formValue = createEmptyPersonalInformation();

  for (const field of PERSONAL_INFORMATION_FIELDS) {
    if (field.key === "age" || field.key === "years_of_experience") {
      const numericValue = source[field.key];
      formValue[field.key] =
        numericValue === null || numericValue === undefined || Number(numericValue) === 0 ? "" : String(numericValue);
      continue;
    }
    formValue[field.key] = String(source[field.key] ?? "");
  }

  return formValue;
}

function createDefaultMcpSettings() {
  return {
    enabled: false,
    preferred_agent_name: "OpenPostings Agent",
    mfa_login_notes: "",
    dry_run_only: true,
    require_final_approval: true,
    max_applications_per_run: "10",
    preferred_search: "",
    preferred_remote: "all",
    preferred_industries: [],
    preferred_regions: [],
    preferred_countries: [],
    preferred_states: [],
    preferred_counties: [],
    instructions_for_agent: ""
  };
}

function toFormMcpSettings(value) {
  const defaults = createDefaultMcpSettings();
  const source = value && typeof value === "object" ? value : {};
  return {
    ...defaults,
    enabled: Boolean(source.enabled),
    preferred_agent_name: String(source.preferred_agent_name || defaults.preferred_agent_name),
    mfa_login_notes: String(source.mfa_login_notes || ""),
    dry_run_only: source.dry_run_only === undefined ? defaults.dry_run_only : Boolean(source.dry_run_only),
    require_final_approval:
      source.require_final_approval === undefined
        ? defaults.require_final_approval
        : Boolean(source.require_final_approval),
    max_applications_per_run: String(
      source.max_applications_per_run === undefined || source.max_applications_per_run === null
        ? defaults.max_applications_per_run
        : source.max_applications_per_run
    ),
    preferred_search: String(source.preferred_search || ""),
    preferred_remote: ["remote", "hybrid", "non_remote"].includes(source.preferred_remote)
      ? source.preferred_remote
      : "all",
    preferred_industries: Array.isArray(source.preferred_industries) ? source.preferred_industries.filter(Boolean) : [],
    preferred_regions: Array.isArray(source.preferred_regions) ? source.preferred_regions.filter(Boolean) : [],
    preferred_countries: Array.isArray(source.preferred_countries) ? source.preferred_countries.filter(Boolean) : [],
    preferred_states: Array.isArray(source.preferred_states) ? source.preferred_states.filter(Boolean) : [],
    preferred_counties: Array.isArray(source.preferred_counties) ? source.preferred_counties.filter(Boolean) : [],
    instructions_for_agent: String(source.instructions_for_agent || "")
  };
}

function toApiMcpSettings(value) {
  const source = value && typeof value === "object" ? value : {};
  const parsedMax = Number.parseInt(String(source.max_applications_per_run || "").trim(), 10);
  const maxApplications = Number.isFinite(parsedMax) && parsedMax > 0 ? parsedMax : 10;
  return {
    enabled: Boolean(source.enabled),
    preferred_agent_name: String(source.preferred_agent_name || "").trim() || "OpenPostings Agent",
    mfa_login_notes: String(source.mfa_login_notes || "").trim(),
    dry_run_only: Boolean(source.dry_run_only),
    require_final_approval: Boolean(source.require_final_approval),
    max_applications_per_run: maxApplications,
    preferred_search: String(source.preferred_search || "").trim(),
    preferred_remote: ["remote", "hybrid", "non_remote"].includes(source.preferred_remote)
      ? source.preferred_remote
      : "all",
    preferred_industries: Array.isArray(source.preferred_industries) ? source.preferred_industries.filter(Boolean) : [],
    preferred_regions: Array.isArray(source.preferred_regions) ? source.preferred_regions.filter(Boolean) : [],
    preferred_countries: Array.isArray(source.preferred_countries) ? source.preferred_countries.filter(Boolean) : [],
    preferred_states: Array.isArray(source.preferred_states) ? source.preferred_states.filter(Boolean) : [],
    preferred_counties: Array.isArray(source.preferred_counties) ? source.preferred_counties.filter(Boolean) : [],
    instructions_for_agent: String(source.instructions_for_agent || "").trim()
  };
}

function PostingCard({
  item,
  onOpenDetails,
  onSetReviewState,
  onTrackApplication,
  onIgnorePosting,
  onBlockCompany,
  savingApplicationIds,
  ignoringPostingIds,
  blockedCompanyNames,
  blockingCompanyNames,
  reviewingPostingIds,
  showDescriptions
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const postingUrl = String(item?.job_posting_url || "").trim();
  const onOpenPosting = useCallback(() => onOpenDetails(item), [item, onOpenDetails]);

  const isSaving = Boolean(savingApplicationIds?.[postingUrl]);
  const isIgnoring = Boolean(ignoringPostingIds?.[postingUrl]);
  const isReviewing = Boolean(reviewingPostingIds?.[postingUrl]);
  const normalizedCompanyName = normalizeCompanyName(item?.company_name);
  const isCompanyBlocked = blockedCompanyNames?.has(normalizedCompanyName);
  const isBlockingCompany = blockingCompanyNames?.has(normalizedCompanyName);
  const isApplied = Boolean(item?.applied);
  const saveDisabled = isSaving || isApplied || isIgnoring;
  const ignoreDisabled = isIgnoring;
  const blockDisabled = isCompanyBlocked || isBlockingCompany;
  const atsLabel = getAtsDisplayLabel(item?.ats);
  const positionName = sanitizeDisplayText(item?.position_name, "Unknown position");
  const locationLabel = sanitizeDisplayText(item?.location, "Location unavailable");
  const companyLabel = sanitizeDisplayText(item?.company_name, "Unknown company");
  const postingDateLabel = sanitizeDisplayText(item?.posting_date, "Posting date unavailable");
  const postingCompensationLabel = formatPostingCompensationLabel(item);
  const postingDescriptionLabel = sanitizeDisplayText(item?.job_description, "");
  const appliedByLabel = sanitizeDisplayText(item?.applied_by_label, "Application already tracked");
  const postingUrlLabel = sanitizeDisplayText(item?.job_posting_url, "");
  const shouldRenderDescription = Boolean(showDescriptions) && Boolean(postingDescriptionLabel);
  const reviewState = String(item?.review_state || "unseen");
  const freshnessLabel = getPostingFreshnessLabel(item);
  const confidenceLabels = getPostingConfidenceLabels(item);

  return (
    <View style={[styles.card, reviewState === "ignored" ? styles.cardIgnored : null, menuOpen ? styles.cardMenuOpen : null]}>
      <View style={styles.postingCardTopRow}>
        <Pressable onPress={onOpenPosting} style={styles.postingCardMainPressArea}>
          <Text style={styles.position}>{positionName}</Text>
          <Text style={styles.location}>{locationLabel}</Text>
          <Text style={styles.company}>{companyLabel}</Text>
          <Text style={styles.ats}>ATS: {atsLabel}</Text>
          <Text style={styles.posted}>{postingDateLabel}</Text>
          <Text style={styles.postingFreshness}>{freshnessLabel}</Text>
          <View style={styles.postingBadgesRow}>
            <Text style={[styles.postingReviewBadge, reviewState === "ignored" ? styles.postingReviewBadgeIgnored : null]}>
              {reviewState === "shortlisted" ? "Shortlisted" : reviewState === "ignored" ? "Ignored" : reviewState === "viewed" ? "Viewed" : "New"}
            </Text>
            {confidenceLabels.map((label) => <Text key={label} style={styles.postingConfidenceBadge}>{label}</Text>)}
          </View>
          {postingCompensationLabel ? <Text style={styles.postingCompensation}>{postingCompensationLabel}</Text> : null}
          {shouldRenderDescription ? (
            <Text style={styles.postingDescription}>{postingDescriptionLabel}</Text>
          ) : null}
          {isApplied ? (
            <Text style={styles.postingAppliedNotice}>{appliedByLabel}</Text>
          ) : null}
          <Text numberOfLines={1} style={styles.url}>
            {postingUrlLabel}
          </Text>
        </Pressable>

        <View style={styles.postingCardMenuAnchor}>
          <Pressable
            onPress={() => setMenuOpen((prev) => !prev)}
            style={styles.postingCardMenuTrigger}
          >
            <Text style={styles.postingCardMenuTriggerText}>...</Text>
          </Pressable>

          {menuOpen ? (
            <View style={[styles.postingCardMenu, { zIndex: 99999, elevation: 99999 }]}>
              <Pressable
                onPress={() => {
                  setMenuOpen(false);
                  onSetReviewState(item, reviewState === "shortlisted" ? "viewed" : "shortlisted");
                }}
                disabled={isReviewing}
                style={[styles.postingCardMenuItem, isReviewing ? styles.postingCardMenuItemDisabled : null]}
              >
                <Text style={styles.postingCardMenuItemText}>
                  {reviewState === "shortlisted" ? "Remove From Shortlist" : "Shortlist"}
                </Text>
              </Pressable>

              <Pressable
                onPress={() => {
                  setMenuOpen(false);
                  onSetReviewState(item, "viewed");
                }}
                disabled={isReviewing || reviewState === "viewed"}
                style={[styles.postingCardMenuItem, isReviewing || reviewState === "viewed" ? styles.postingCardMenuItemDisabled : null]}
              >
                <Text style={styles.postingCardMenuItemText}>{reviewState === "viewed" ? "Already Viewed" : "Mark Viewed"}</Text>
              </Pressable>

              <Pressable
                onPress={() => {
                  setMenuOpen(false);
                  onTrackApplication(item);
                }}
                disabled={saveDisabled}
                style={[styles.postingCardMenuItem, saveDisabled ? styles.postingCardMenuItemDisabled : null]}
              >
                <Text style={styles.postingCardMenuItemText}>
                  {isSaving ? "Saving..." : isApplied ? "Already Applied" : "Save To Applications"}
                </Text>
              </Pressable>

              <Pressable
                onPress={() => {
                  setMenuOpen(false);
                  onIgnorePosting(item);
                }}
                disabled={ignoreDisabled}
                style={[styles.postingCardMenuItem, ignoreDisabled ? styles.postingCardMenuItemDisabled : null]}
              >
                <Text style={styles.postingCardMenuItemText}>{isIgnoring ? "Ignoring..." : "Ignore Job Posting"}</Text>
              </Pressable>

              <Pressable
                onPress={() => {
                  setMenuOpen(false);
                  onBlockCompany(item);
                }}
                disabled={blockDisabled}
                style={[
                  styles.postingCardMenuItem,
                  styles.postingCardMenuItemDestructive,
                  blockDisabled ? styles.postingCardMenuItemDisabled : null
                ]}
              >
                <Text style={[styles.postingCardMenuItemText, styles.postingCardMenuItemTextDestructive]}>
                  {isBlockingCompany ? "Blocking company..." : isCompanyBlocked ? "Company Blocked" : "Block Company"}
                </Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
}

function DrawerItem({ label, selected, onPress }) {
  return (
    <Pressable onPress={onPress} style={[styles.drawerItem, selected ? styles.drawerItemSelected : null]}>
      <Text style={[styles.drawerItemText, selected ? styles.drawerItemTextSelected : null]}>{label}</Text>
    </Pressable>
  );
}

function MultiSelectDropdown({
  label,
  options,
  selectedValues,
  onToggleValue,
  onClear,
  emptyText,
  maxVisibleOptions = 80
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const selectedArray = Array.isArray(selectedValues) ? selectedValues : [];
  const normalizedOptions = Array.isArray(options) ? options : [];

  const filteredOptions = useMemo(() => {
    const needle = String(search || "").trim().toLowerCase();
    if (!needle) return normalizedOptions.slice(0, maxVisibleOptions);
    return normalizedOptions
      .filter((option) => String(option?.label || "").toLowerCase().includes(needle))
      .slice(0, maxVisibleOptions);
  }, [maxVisibleOptions, normalizedOptions, search]);

  const selectedCount = selectedArray.length;

  return (
    <View style={styles.dropdownWrap}>
      <Pressable onPress={() => setOpen((prev) => !prev)} style={styles.dropdownTrigger}>
        <Text style={styles.dropdownTriggerLabel}>{label}</Text>
        <Text style={styles.dropdownTriggerValue}>{selectedCount > 0 ? `${selectedCount} selected` : "Any"}</Text>
      </Pressable>

      {open ? (
        <View style={styles.dropdownPanel}>
          <TextInput
            style={styles.dropdownSearch}
            value={search}
            onChangeText={setSearch}
            placeholder={`Search ${label.toLowerCase()}`}
            autoCapitalize="none"
          />

          <ScrollView
            style={styles.dropdownOptionsScroll}
            nestedScrollEnabled={IS_ANDROID}
            keyboardShouldPersistTaps="handled"
          >
            {filteredOptions.length === 0 ? (
              <Text style={styles.dropdownEmpty}>{emptyText || "No matches."}</Text>
            ) : (
              filteredOptions.map((option) => {
                const value = String(option?.value || "");
                const isSelected = selectedArray.includes(value);
                return (
                  <Pressable
                    key={value}
                    onPress={() => onToggleValue(value)}
                    style={[styles.dropdownOption, isSelected ? styles.dropdownOptionSelected : null]}
                  >
                    <Text style={[styles.dropdownOptionLabel, isSelected ? styles.dropdownOptionLabelSelected : null]}>
                      {option?.label}
                    </Text>
                  </Pressable>
                );
              })
            )}
          </ScrollView>

          <Pressable onPress={onClear} style={styles.dropdownClearBtn}>
            <Text style={styles.dropdownClearBtnText}>Clear {label}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function SingleSelectDropdown({ label, options, selectedValue, onSelectValue, anyLabel = "Any" }) {
  const [open, setOpen] = useState(false);
  const normalizedOptions = Array.isArray(options) ? options : [];
  const selected = String(selectedValue || "all");
  const selectedOption = normalizedOptions.find((option) => String(option?.value || "") === selected);

  return (
    <View style={styles.dropdownWrap}>
      <Pressable onPress={() => setOpen((prev) => !prev)} style={styles.dropdownTrigger}>
        <Text style={styles.dropdownTriggerLabel}>{label}</Text>
        <Text style={styles.dropdownTriggerValue}>{selectedOption?.label || anyLabel}</Text>
      </Pressable>

      {open ? (
        <View style={styles.dropdownPanel}>
          <ScrollView
            style={styles.dropdownOptionsScroll}
            nestedScrollEnabled={IS_ANDROID}
            keyboardShouldPersistTaps="handled"
          >
            <Pressable
              onPress={() => {
                onSelectValue("all");
                setOpen(false);
              }}
              style={[styles.dropdownOption, selected === "all" ? styles.dropdownOptionSelected : null]}
            >
              <Text style={[styles.dropdownOptionLabel, selected === "all" ? styles.dropdownOptionLabelSelected : null]}>
                {anyLabel}
              </Text>
            </Pressable>

            {normalizedOptions.map((option) => {
              const value = String(option?.value || "");
              const isSelected = selected === value;
              const isEnabled = option?.enabled !== false;
              return (
                <Pressable
                  key={value}
                  onPress={() => {
                    if (!isEnabled) return;
                    onSelectValue(value || "all");
                    setOpen(false);
                  }}
                  style={[
                    styles.dropdownOption,
                    isSelected ? styles.dropdownOptionSelected : null,
                    !isEnabled ? styles.dropdownOptionDisabled : null
                  ]}
                >
                  <Text
                    style={[
                      styles.dropdownOptionLabel,
                      isSelected ? styles.dropdownOptionLabelSelected : null,
                      !isEnabled ? styles.dropdownOptionLabelDisabled : null
                    ]}
                  >
                    {option?.label}
                    {!isEnabled ? " (Sync off)" : ""}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

function ToggleRow({ label, value, onValueChange }) {
  return (
    <View style={styles.toggleRow}>
      <Text style={styles.toggleLabel}>{label}</Text>
      <Switch value={Boolean(value)} onValueChange={onValueChange} />
    </View>
  );
}

function PerformanceMetric({ label, value, hint, tone = "neutral" }) {
  const toneStyle =
    tone === "good"
      ? styles.performanceMetricGood
      : tone === "warning"
        ? styles.performanceMetricWarning
        : tone === "critical"
          ? styles.performanceMetricCritical
          : null;
  return (
    <View style={[styles.performanceMetric, toneStyle]}>
      <Text style={styles.performanceMetricLabel}>{label}</Text>
      <Text style={styles.performanceMetricValue}>{value}</Text>
      {hint ? <Text style={styles.performanceMetricHint}>{hint}</Text> : null}
    </View>
  );
}

function RateSparkline({ samples }) {
  const recent = Array.isArray(samples) ? samples.slice(-32) : [];
  const rates = recent.map((sample) => Math.max(0, Number(sample?.rate || 0)));
  const maximum = Math.max(1, ...rates);
  if (recent.length < 2) {
    return <Text style={styles.performanceEmptyText}>Collecting rate history…</Text>;
  }
  return (
    <View>
      <View style={styles.performanceSparkline} accessibilityLabel="Recent sync throughput trend">
        {recent.map((sample, index) => {
          const rate = Math.max(0, Number(sample?.rate || 0));
          return (
            <View
              key={`${sample.at}-${index}`}
              style={[
                styles.performanceSparkBar,
                { height: Math.max(4, Math.round((rate / maximum) * 52)) }
              ]}
            />
          );
        })}
      </View>
      <View style={styles.performanceSparkLegend}>
        <Text style={styles.performanceMetricHint}>{`${rates[0].toFixed(1)}/min`}</Text>
        <Text style={styles.performanceMetricHint}>{`Peak ${maximum.toFixed(1)}/min`}</Text>
        <Text style={styles.performanceMetricHint}>{`${rates[rates.length - 1].toFixed(1)}/min`}</Text>
      </View>
    </View>
  );
}

export default function App() {
  const [activePage, setActivePage] = useState(PAGE_KEYS.POSTINGS);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [postingsFilters, setPostingsFilters] = useState(() => ({ ...DEFAULT_POSTINGS_FILTERS }));
  // Filters and the search term are restored from device storage on mount. The
  // first fetch waits for this so it isn't issued with defaults and immediately
  // repeated with the restored values.
  const [filtersHydrated, setFiltersHydrated] = useState(false);
  const [postingFilterOptions, setPostingFilterOptions] = useState({
    ats: DEFAULT_ATS_FILTER_OPTIONS,
    industries: [],
    regions: [],
    countries: [],
    states: [],
    counties: [],
    cities: []
  });
  const [postingFilterOptionsLoading, setPostingFilterOptionsLoading] = useState(false);
  const [postingsFilterPanelOpen, setPostingsFilterPanelOpen] = useState(false);
  // Listing descriptions are large and are not needed to scan titles/locations. Keep the
  // initial request lightweight; users can still opt into them with the existing toggle.
  const [showPostingDescriptions, setShowPostingDescriptions] = useState(false);
  const showPostingDescriptionsRef = useRef(showPostingDescriptions);
  const [postingReviewQueue, setPostingReviewQueue] = useState("new");
  const postingReviewQueueRef = useRef("new");
  const [postings, setPostings] = useState([]);
  const [postingsHasMore, setPostingsHasMore] = useState(false);
  const [postingsLoadingMore, setPostingsLoadingMore] = useState(false);
  const [selectedPosting, setSelectedPosting] = useState(null);
  const [postingDetailsLoading, setPostingDetailsLoading] = useState(false);
  const [reviewingPostingIds, setReviewingPostingIds] = useState({});
  const [applications, setApplications] = useState([]);
  const [applicationsLoading, setApplicationsLoading] = useState(false);
  const [applicationsNotice, setApplicationsNotice] = useState("");
  const [applicationStats, setApplicationStats] = useState(null);
  const [applicationStatsLoading, setApplicationStatsLoading] = useState(false);
  // Failures the server recorded that cost the user something -- an application submitted
  // but not logged, most of all. Polled alongside the applications list so a loss surfaces
  // in the app rather than only in whatever the agent happened to say at the time.
  const [systemErrors, setSystemErrors] = useState([]);
  const [savingApplicationIds, setSavingApplicationIds] = useState({});
  const [ignoringPostingIds, setIgnoringPostingIds] = useState({});
  const [blockingCompanyNames, setBlockingCompanyNames] = useState({});
  const [blockedCompanies, setBlockedCompanies] = useState([]);
  const [blockedCompaniesLoading, setBlockedCompaniesLoading] = useState(false);
  const [unblockingCompanyNames, setUnblockingCompanyNames] = useState({});
  const [updatingApplicationIds, setUpdatingApplicationIds] = useState({});
  const [deletingApplicationIds, setDeletingApplicationIds] = useState({});
  const [openApplicationStatusForId, setOpenApplicationStatusForId] = useState(null);
  const [openApplicationFitForId, setOpenApplicationFitForId] = useState(null);
  const [updatingApplicationFitIds, setUpdatingApplicationFitIds] = useState({});
  const [initializing, setInitializing] = useState(true);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState(null);
  const [syncPerformanceHistory, setSyncPerformanceHistory] = useState([]);
  const [personalInformation, setPersonalInformation] = useState(createEmptyPersonalInformation);
  const [applicantDocuments, setApplicantDocuments] = useState([]);
  const [documentUploading, setDocumentUploading] = useState("");
  const [documentNotice, setDocumentNotice] = useState("");
  const [applicationAnswers, setApplicationAnswers] = useState([]);
  const [applicationAnswersLoading, setApplicationAnswersLoading] = useState(false);
  const [applicationAnswersLoaded, setApplicationAnswersLoaded] = useState(false);
  const [applicationAnswersError, setApplicationAnswersError] = useState("");
  const [answersSaving, setAnswersSaving] = useState(false);
  const [answersNotice, setAnswersNotice] = useState("");
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsNotice, setSettingsNotice] = useState("");
  const [syncSettings, setSyncSettings] = useState({
    autoSyncEnabled: true,
    wifiOnly: false,
    syncIntervalSeconds: String(DEFAULT_SYNC_INTERVAL_SECONDS)
  });
  const [syncServiceSettings, setSyncServiceSettings] = useState(createDefaultSyncServiceSettings);
  const [syncServiceSettingsLoading, setSyncServiceSettingsLoading] = useState(false);
  const [syncServiceSettingsSaving, setSyncServiceSettingsSaving] = useState(false);
  const [syncSettingsNotice, setSyncSettingsNotice] = useState("");
  const [codeStatus, setCodeStatus] = useState(null);
  const [restartingServer, setRestartingServer] = useState(false);
  const [restartNotice, setRestartNotice] = useState("");
  const [restartConfirmArmed, setRestartConfirmArmed] = useState(false);
  const [exportSettingsRunning, setExportSettingsRunning] = useState(false);
  const [migrationSourceDbPath, setMigrationSourceDbPath] = useState("");
  const [migrationSelection, setMigrationSelection] = useState({
    personal_information: true,
    mcp_settings: !IS_ANDROID,
    blocked_companies: true,
    applications: true
  });
  const [migrationRunning, setMigrationRunning] = useState(false);
  const [migrationNotice, setMigrationNotice] = useState("");
  const [migrationModalOpen, setMigrationModalOpen] = useState(false);
  const [mcpSettings, setMcpSettings] = useState(createDefaultMcpSettings);
  const [mcpSettingsLoading, setMcpSettingsLoading] = useState(false);
  const [mcpSettingsSaving, setMcpSettingsSaving] = useState(false);
  const [mcpSettingsNotice, setMcpSettingsNotice] = useState("");
  const searchRef = useRef("");
  const postingsFiltersRef = useRef(postingsFilters);
  const autoSyncInFlightRef = useRef(false);
  const statusPollInFlightRef = useRef(false);
  const postingsRefreshInFlightRef = useRef(false);
  const lastPostingRefreshAtRef = useRef(0);
  const wasSyncRunningRef = useRef(false);
  const lastObservedNewPostingsRef = useRef(null);
  const syncPerformanceStartedAtRef = useRef("");
  const lastSyncPerformanceSampleAtRef = useRef(0);
  const postingsRequestSequenceRef = useRef(0);
  const postingsRequestAbortControllerRef = useRef(null);
  const postingsFilterRefreshInitializedRef = useRef(false);
  const applicationsRequestSequenceRef = useRef(0);
  const applicationStatsRequestSequenceRef = useRef(0);
  const frontendLogQueueRef = useRef([]);
  const frontendLogFlushInFlightRef = useRef(false);
  const lastFrontendLogFlushAtRef = useRef(0);
  const androidBackendBootstrappedRef = useRef(false);

  const effectiveActivePage =
    IS_ANDROID &&
    (activePage === PAGE_KEYS.SETTINGS_APPLICANTEE || activePage === PAGE_KEYS.SETTINGS_MCP)
      ? PAGE_KEYS.POSTINGS
      : activePage;
  const pageTitle = PAGE_TITLES[effectiveActivePage] || PAGE_TITLES[PAGE_KEYS.POSTINGS];
  const flushFrontendLogs = useCallback(async () => {
    if (frontendLogFlushInFlightRef.current) return;
    if (frontendLogQueueRef.current.length === 0) return;

    frontendLogFlushInFlightRef.current = true;
    try {
      while (frontendLogQueueRef.current.length > 0) {
        const nextEntry = frontendLogQueueRef.current[0];
        const response = await postFrontendLog(nextEntry);
        if (!response?.ok) {
          break;
        }
        frontendLogQueueRef.current.shift();
      }
    } finally {
      frontendLogFlushInFlightRef.current = false;
    }
  }, []);

  const queueFrontendLog = useCallback(
    (level, eventName, message, context = {}) => {
      const entry = {
        level: sanitizeDisplayText(level, "info").toLowerCase(),
        event: sanitizeDisplayText(eventName, "frontend_event"),
        message: sanitizeDisplayText(message, ""),
        context
      };

      frontendLogQueueRef.current.push(entry);
      if (frontendLogQueueRef.current.length > 60) {
        frontendLogQueueRef.current.shift();
      }

      const now = Date.now();
      const shouldFlushImmediately =
        entry.level === "error" ||
        entry.level === "fatal" ||
        frontendLogQueueRef.current.length <= 1 ||
        now - lastFrontendLogFlushAtRef.current >= 1500;

      if (shouldFlushImmediately) {
        lastFrontendLogFlushAtRef.current = now;
        void flushFrontendLogs();
      }
    },
    [flushFrontendLogs]
  );

  useEffect(() => {
    if (!IS_ANDROID) return undefined;
    if (androidBackendBootstrappedRef.current) return undefined;
    androidBackendBootstrappedRef.current = true;

    const nodejs = getAndroidNodeRuntime();
    if (!nodejs) {
      setError("Android backend runtime is unavailable. Install a development build and relaunch.");
      return undefined;
    }

    const backgroundService = getAndroidBackgroundService();
    let disposed = false;
    let nodeListener;

    try {
      nodejs.start("main.js", { redirectOutputToLogcat: true });
      nodeListener = nodejs.channel.addListener("message", (msg) => {
        if (disposed) return;
        if (!msg || typeof msg !== "object") return;
        const eventType = String(msg.type || "");
        if (!eventType) return;
        queueFrontendLog("info", "android_node_message", `Android node event: ${eventType}`, {
          type: eventType
        });
      });
    } catch (errorValue) {
      const message = String(errorValue?.message || errorValue);
      setError(message);
      queueFrontendLog("error", "android_node_start_failed", message, {});
    }

    if (backgroundService && !backgroundService.isRunning()) {
      (async () => {
        const permissionGranted = await ensureAndroidNotificationPermission();
        if (!permissionGranted) {
          queueFrontendLog(
            "error",
            "android_backend_notification_permission_missing",
            "Notification permission denied; backend foreground service could not start.",
            {}
          );
          return;
        }
        await backgroundService.start(runAndroidBackendForegroundTask, ANDROID_BACKEND_NOTIFICATION_OPTIONS);
      })().catch((errorValue) => {
        if (disposed) return;
        const message = String(errorValue?.message || errorValue);
        setError(message);
        queueFrontendLog("error", "android_backend_foreground_start_failed", message, {});
      });
    }

    return () => {
      disposed = true;
      if (nodeListener && typeof nodeListener.remove === "function") {
        nodeListener.remove();
      }
    };
  }, [queueFrontendLog]);

  const remoteFilterOptions = useMemo(
    () => [
      { value: "all", label: "All Locations" },
      { value: "remote", label: "Remote Only" },
      { value: "hybrid", label: "Hybrid Only" },
      { value: "non_remote", label: "On-Site / Unknown" }
    ],
    []
  );
  const countryRegionByValue = useMemo(
    () =>
      new Map(
        (postingFilterOptions.countries || []).map((country) => [
          String(country?.value || ""),
          String(country?.region || "")
        ])
      ),
    [postingFilterOptions.countries]
  );
  const visibleCountryOptions = useMemo(() => {
    const selectedRegions = postingsFilters.regions || [];
    if (selectedRegions.length === 0) return postingFilterOptions.countries || [];
    return (postingFilterOptions.countries || []).filter(
      (country) => selectedRegions.includes(String(country?.region || ""))
    );
  }, [postingFilterOptions.countries, postingsFilters.regions]);
  const visibleCountyOptions = useMemo(() => {
    const selectedStates = postingsFilters.states || [];
    if (selectedStates.length === 0) return postingFilterOptions.counties || [];
    return (postingFilterOptions.counties || []).filter((county) => selectedStates.includes(county?.state));
  }, [postingFilterOptions.counties, postingsFilters.states]);
  // Cities are scoped to the selected states for the same reason counties are: there are
  // thousands, and an unscoped list is not a control anyone can use. Values are "City|ST",
  // so they carry their own state and stay unambiguous once selected.
  const visibleCityOptions = useMemo(() => {
    const selectedStates = postingsFilters.states || [];
    if (selectedStates.length === 0) return [];
    return (postingFilterOptions.cities || []).filter((city) => selectedStates.includes(city?.state));
  }, [postingFilterOptions.cities, postingsFilters.states]);
  const visibleMcpCountryOptions = useMemo(() => {
    const selectedRegions = mcpSettings.preferred_regions || [];
    if (selectedRegions.length === 0) return postingFilterOptions.countries || [];
    return (postingFilterOptions.countries || []).filter(
      (country) => selectedRegions.includes(String(country?.region || ""))
    );
  }, [mcpSettings.preferred_regions, postingFilterOptions.countries]);
  const visibleMcpCountyOptions = useMemo(() => {
    const selectedStates = mcpSettings.preferred_states || [];
    if (selectedStates.length === 0) return postingFilterOptions.counties || [];
    return (postingFilterOptions.counties || []).filter((county) => selectedStates.includes(county?.state));
  }, [mcpSettings.preferred_states, postingFilterOptions.counties]);
  const blockedCompanyNames = useMemo(
    () =>
      new Set(
        (blockedCompanies || [])
          .map((item) => normalizeCompanyName(item?.company_name || item?.normalized_company_name))
          .filter(Boolean)
      ),
    [blockedCompanies]
  );
  const blockingCompanyNamesSet = useMemo(
    () =>
      new Set(
        Object.entries(blockingCompanyNames || {})
          .filter(([, loading]) => Boolean(loading))
          .map(([companyName]) => companyName)
      ),
    [blockingCompanyNames]
  );
  const syncAtsOptions = useMemo(() => {
    const labelByValue = new Map((postingFilterOptions.ats || []).map((option) => [String(option?.value || ""), String(option?.label || "")]));
    return DEFAULT_ATS_FILTER_OPTIONS.map((option) => ({
      value: option.value,
      label: labelByValue.get(option.value) || option.label
    }));
  }, [postingFilterOptions.ats]);

  const statusText = useMemo(() => {
    if (!status) return "No sync status yet.";
    const syncTime = status.last_sync_at
      ? formatDateTimeSafe(status.last_sync_at, "Unknown sync time")
      : "No sync has run yet.";
    const summary = status.last_sync_summary || {};
    const excludedByDate = Number(
      status.excluded_during_sync_by_posting_date ?? summary.excluded_during_sync_by_posting_date ?? 0
    );
    const freshnessHours = Number(
      status.active_posting_freshness_hours ??
        status.posting_freshness_hours ??
        syncServiceSettings.active_posting_freshness_hours ??
        syncServiceSettings.posting_freshness_hours ??
        DEFAULT_POSTING_FRESHNESS_HOURS
    );
    const syncEnabledCompanies = Number(status.sync_enabled_company_count ?? summary.sync_enabled_company_count ?? 0);
    const excludedAtsCount = Number(status.excluded_ats_count ?? summary.excluded_ats_count ?? 0);
    const failedCompanies = Number(status.failed_companies ?? summary.failed_companies ?? 0);
    // Pass position resets to 0 on every restart, so on its own it cannot say whether any
    // company is being starved. Coverage is read from stored per-company sync times and
    // survives restarts, which is the question worth answering after an interruption.
    const coverage = status?.sync_coverage;
    const coverageHint = coverage
      ? ` | Coverage: ${Number(coverage.synced_within_window || 0).toLocaleString()}/${Number(coverage.enabled_companies || 0).toLocaleString()} companies synced in the last ${Math.round(Number(coverage.window_seconds || 86400) / 3600)}h` +
        (Number(coverage.never_synced || 0) > 0 ? `, ${Number(coverage.never_synced).toLocaleString()} not yet reached` : "")
      : "";
    const base = `Last completed sync: ${syncTime} | Listed in the ${freshnessHours}h review window: ${Number(status.posting_count || 0).toLocaleString()} | Sync-enabled companies: ${syncEnabledCompanies.toLocaleString()} | Failed companies: ${failedCompanies} | Excluded by date: ${excludedByDate} | Excluded ATS: ${excludedAtsCount}`;
    if (status.running && status.progress) {
      const collectedCount = Number(status.progress.total_collected || 0);
      const syncingCompanyName = sanitizeDisplayText(status.progress.company_name, "");
      const progressPercent = Number(status.progress.percent || 0);
      const targetsPerMinute = Number(status.progress.targets_per_minute || 0);
      const etaSeconds = status.progress.eta_seconds;
      const newPostings = Number(status.new_postings || 0);
      const refreshedPostings = Number(status.refreshed_postings || 0);
      const lastWriteAge = status.last_write_age_seconds;
      return `${base} | Syncing ${Number(status.progress.current || 0).toLocaleString()}/${Number(status.progress.total || 0).toLocaleString()} (${progressPercent.toFixed(1)}%) | New: ${newPostings.toLocaleString()} | Refreshed: ${refreshedPostings.toLocaleString()} | Collected: ${collectedCount.toLocaleString()} | Rate: ${targetsPerMinute.toFixed(1)} targets/min | ETA: ${formatDurationCompact(etaSeconds)} | Last write: ${formatDurationCompact(lastWriteAge)} ago | Last completed target: ${syncingCompanyName}${coverageHint}`;
    }
    return `${base}${coverageHint}`;
  }, [status, syncServiceSettings.active_posting_freshness_hours, syncServiceSettings.posting_freshness_hours]);

  const syncProgressFraction = useMemo(() => {
    if (!status?.running || !status?.progress) return 0;
    const current = Number(status.progress.current || 0);
    const total = Number(status.progress.total || 0);
    if (!(total > 0)) return 0;
    return Math.max(0, Math.min(1, current / total));
  }, [status]);

  useEffect(() => {
    if (!status?.running || !status?.progress) return;
    const startedAt = String(status.started_at || "");
    const now = Date.now();
    const isNewPass = startedAt !== syncPerformanceStartedAtRef.current;
    if (!isNewPass && now - lastSyncPerformanceSampleAtRef.current < SYNC_PERFORMANCE_SAMPLE_INTERVAL_MS) return;

    const sample = {
      at: now,
      started_at: startedAt,
      rate: Number(status.progress.targets_per_minute || 0),
      eta_seconds: Number(status.progress.eta_seconds || 0),
      current: Number(status.progress.current || 0),
      write_age_seconds: Number(status.last_write_age_seconds || 0),
      rss_mb: Number(status.process_memory?.rss_mb ?? status.memory?.rss_mb ?? 0)
    };
    syncPerformanceStartedAtRef.current = startedAt;
    lastSyncPerformanceSampleAtRef.current = now;
    setSyncPerformanceHistory((previous) => {
      const base = isNewPass ? [] : previous;
      return [...base, sample].slice(-MAX_SYNC_PERFORMANCE_SAMPLES);
    });
  }, [status]);

  const scraperDashboard = useMemo(() => {
    const progress = status?.progress || {};
    const queue = status?.scraper_request_queue || {};
    const memory = status?.process_memory || status?.memory || {};
    const coverage = status?.sync_coverage || {};
    const activeTargets = Array.isArray(status?.active_targets) ? status.active_targets : [];
    const queueHotspots = Array.isArray(queue.top_keys) ? queue.top_keys : [];
    const rate = Number(progress.targets_per_minute || 0);
    const progressAge = Number(status?.last_progress_age_seconds || 0);
    const writeAge = Number(status?.last_write_age_seconds || 0);
    const targetTimeoutSeconds = Math.max(1, Number(status?.target_timeout_seconds || 600));
    const oldestTargetAge = activeTargets.reduce(
      (oldest, target) => Math.max(oldest, Number(target?.age_seconds || 0)),
      0
    );
    // A single recent timeout is not a signal on its own: individual ATS platforms (Workday,
    // Ashby) hit their own bounded deadline occasionally as a matter of course, so "one
    // happened in the last 5 minutes" is true almost continuously during otherwise-healthy
    // operation. A burst -- several within that window -- is what actually distinguishes a
    // real problem from that background noise.
    const recentTargetTimeoutEpochsMs = Array.isArray(status?.recent_target_timeout_epochs_ms)
      ? status.recent_target_timeout_epochs_ms
      : [];
    const recentTargetTimeoutCount = recentTargetTimeoutEpochsMs.filter(
      (epochMs) => Date.now() - Number(epochMs || 0) <= 300000
    ).length;
    const hasStalledQueue = queueHotspots.some((item) => {
      if (Number(item?.queued || 0) <= 0 || Number(item?.active || 0) <= 0) return false;
      const lastResponseAt = Date.parse(String(item?.last_response_at || ""));
      return !Number.isFinite(lastResponseAt) || Date.now() - lastResponseAt >= 120000;
    });
    const elapsedSeconds = status?.started_at
      ? Math.max(0, Math.floor((Date.now() - Date.parse(status.started_at)) / 1000))
      : 0;
    const issueCount =
      Number(queue.timeouts || 0) +
      Number(queue.aborted || 0) +
      Number(queue.failures || 0);

    let health = { label: status?.running ? "Healthy" : "Idle", tone: status?.running ? "good" : "neutral" };
    if (
      status?.running &&
      (progressAge >= 300 ||
        Number(status?.flush_failures || 0) > 0 ||
        oldestTargetAge >= targetTimeoutSeconds + 60)
    ) {
      health = { label: "Critical", tone: "critical" };
    } else if (
      status?.running &&
      (progressAge >= 120 ||
        hasStalledQueue ||
        recentTargetTimeoutCount >= 3 ||
        (elapsedSeconds >= 300 && rate > 0 && rate < 40))
    ) {
      health = { label: "Degraded", tone: "warning" };
    } else if (status?.last_error && !status?.running) {
      health = { label: "Needs attention", tone: "critical" };
    }

    const coverageEnabled = Number(coverage.enabled_companies || 0);
    const coverageSynced = Number(coverage.synced_within_window || 0);
    const coveragePercent = coverageEnabled > 0 ? (coverageSynced / coverageEnabled) * 100 : 0;
    const firstRate = Number(syncPerformanceHistory[0]?.rate || 0);
    const rateDelta = syncPerformanceHistory.length > 1 ? rate - firstRate : 0;

    // Leading indicators, not failures in progress -- see /sync/status on the server for
    // the thresholds. Surfaced here so a slow slide (WAL not draining, the wide-scan queue
    // backing up, host memory pressure) is visible before it turns into a client timeout.
    const walSizeMb = Number(status?.wal_size_mb || 0);
    const hostMemory = status?.host_memory || null;
    const healthWarnings = Array.isArray(status?.health_warnings) ? status.health_warnings : [];
    if (healthWarnings.length > 0 && (health.tone === "good" || health.tone === "neutral")) {
      health = { label: "Needs attention", tone: "warning" };
    }

    return {
      progress,
      queue,
      memory,
      activeTargets,
      rate,
      progressAge,
      writeAge,
      elapsedSeconds,
      issueCount,
      health,
      coverageEnabled,
      coverageSynced,
      coveragePercent,
      rateDelta,
      queueHotspots,
      walSizeMb,
      hostMemory,
      healthWarnings
    };
  }, [status, syncPerformanceHistory]);

  const failedCompaniesByAtsList = useMemo(() => {
    const summary = status?.last_sync_summary || {};
    const map = summary.failed_companies_by_ats || {};
    return Object.entries(map)
      .map(([atsName, count]) => ({ atsName, count: Number(count) || 0 }))
      .filter((item) => item.count > 0)
      .sort((a, b) => b.count - a.count);
  }, [status]);

  useEffect(() => {
    if (postingsFilters.ats === "all") return;
    const selectedOption = (postingFilterOptions.ats || []).find(
      (option) => String(option?.value || "") === postingsFilters.ats
    );
    if (selectedOption && selectedOption.enabled === false) {
      setPostingsFilters((prev) => ({
        ...prev,
        ats: "all"
      }));
    }
  }, [postingsFilters.ats, postingFilterOptions.ats]);

  const navigateToPage = useCallback((page) => {
    const requestedPage = String(page || "");
    const nextPage =
      IS_ANDROID &&
      (requestedPage === PAGE_KEYS.SETTINGS_APPLICANTEE || requestedPage === PAGE_KEYS.SETTINGS_MCP)
        ? PAGE_KEYS.SETTINGS_SYNC
        : page;
    setActivePage(nextPage);
    setDrawerOpen(false);
  }, []);

  const loadPostings = useCallback(async (q, options = {}) => {
    const silent = Boolean(options.silent);
    const append = Boolean(options.append);
    const offset = append ? Math.max(0, Number(options.offset || 0)) : 0;
    const reviewQueue = String(options.reviewQueue || postingReviewQueueRef.current || "new");
    const filters = options.filters || postingsFiltersRef.current;
    const requestSequence = postingsRequestSequenceRef.current + 1;
    postingsRequestSequenceRef.current = requestSequence;
    // Sequence checks kept stale responses out of state, but the superseded server scans
    // continued running. Closing the prior request lets the API remove it from the scan
    // queue before it consumes database, memory, and CPU time nobody is waiting for.
    postingsRequestAbortControllerRef.current?.abort();
    const requestAbortController = new AbortController();
    postingsRequestAbortControllerRef.current = requestAbortController;
    if (!silent) {
      setLoading(true);
    }
    setError("");
    try {
      const response = await fetchPostings(q, FRONTEND_POSTINGS_FETCH_LIMIT, offset, {
        ...filters,
        review_queue: reviewQueue,
        include_applied: true,
        include_ignored: reviewQueue === "reviewed",
        include_descriptions: showPostingDescriptionsRef.current,
        signal: requestAbortController.signal
      });
      if (requestSequence !== postingsRequestSequenceRef.current) {
        return;
      }
      const normalizedItems = normalizePostingItems(response?.items);
      setPostings((previous) => append ? [...previous, ...normalizedItems] : normalizedItems);
      setPostingsHasMore(normalizedItems.length >= FRONTEND_POSTINGS_FETCH_LIMIT);
      lastPostingRefreshAtRef.current = Date.now();
    } catch (e) {
      if (e?.name === "AbortError") return;
      if (requestSequence === postingsRequestSequenceRef.current) {
        setError(String(e.message || e));
        queueFrontendLog("error", "load_postings_failed", String(e?.stack || e?.message || e), {
          search: q
        });
      }
    } finally {
      if (postingsRequestAbortControllerRef.current === requestAbortController) {
        postingsRequestAbortControllerRef.current = null;
      }
      if (!silent && requestSequence === postingsRequestSequenceRef.current) {
        setLoading(false);
      }
      if (append) {
        setPostingsLoadingMore(false);
      }
    }
  }, [queueFrontendLog]);

  const loadPostingFilterOptions = useCallback(async () => {
    setPostingFilterOptionsLoading(true);
    try {
      const response = await fetchPostingFilterOptions();
      setPostingFilterOptions({
        ats: mergeAtsFilterOptions(response?.ats),
        industries: Array.isArray(response?.industries) ? response.industries : [],
        regions: Array.isArray(response?.regions) ? response.regions : [],
        countries: Array.isArray(response?.countries) ? response.countries : [],
        states: Array.isArray(response?.states) ? response.states : [],
        counties: Array.isArray(response?.counties) ? response.counties : []
      });
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setPostingFilterOptionsLoading(false);
    }
  }, []);

  const loadApplications = useCallback(async (options = {}) => {
    const silent = Boolean(options.silent);
    const requestSequence = applicationsRequestSequenceRef.current + 1;
    applicationsRequestSequenceRef.current = requestSequence;
    if (!silent) {
      setApplicationsLoading(true);
    }
    try {
      let response;
      try {
        response = await fetchApplications(1000, 0);
      } catch (e) {
        // A one-off collision with the sync's writer (a periodic WAL checkpoint, a busy
        // moment) looks identical to a real outage from here. One short retry tells them
        // apart without making the user leave the page and come back to find it was fine.
        await new Promise((resolve) => setTimeout(resolve, 1500));
        if (requestSequence !== applicationsRequestSequenceRef.current) {
          return;
        }
        response = await fetchApplications(1000, 0);
      }
      if (requestSequence !== applicationsRequestSequenceRef.current) {
        return;
      }
      const items = Array.isArray(response?.items) ? response.items : [];
      setApplications(items.map(normalizeApplicationItem).filter((item) => item.id > 0));
    } catch (e) {
      if (requestSequence === applicationsRequestSequenceRef.current) {
        setError(String(e.message || e));
      }
    } finally {
      if (!silent && requestSequence === applicationsRequestSequenceRef.current) {
        setApplicationsLoading(false);
      }
    }
  }, []);

  const loadApplicationStats = useCallback(async (options = {}) => {
    const silent = Boolean(options.silent);
    const requestSequence = applicationStatsRequestSequenceRef.current + 1;
    applicationStatsRequestSequenceRef.current = requestSequence;
    if (!silent) {
      setApplicationStatsLoading(true);
    }
    try {
      const response = await fetchApplicationStats();
      if (requestSequence !== applicationStatsRequestSequenceRef.current) {
        return;
      }
      setApplicationStats(response);
    } catch (e) {
      if (requestSequence === applicationStatsRequestSequenceRef.current) {
        setError(String(e.message || e));
      }
    } finally {
      if (!silent && requestSequence === applicationStatsRequestSequenceRef.current) {
        setApplicationStatsLoading(false);
      }
    }
  }, []);

  // Scoped to application-submission failures ("api": POST /applications, "mcp": the agent's
  // record_application_result) -- this banner is the Applications page's, not a general error
  // feed. "sync" and "health" sourced rows are operational/infra warnings (WAL, host memory,
  // wide-scan queue depth) surfaced on the Scraper Performance page instead; showing them here
  // too just confused a page about tracking applications with an unrelated system warning.
  const loadSystemErrors = useCallback(async () => {
    try {
      const response = await fetchErrors(false, ["api", "mcp"]);
      setSystemErrors(Array.isArray(response?.items) ? response.items : []);
    } catch {
      // A server too old or too broken to report errors must not itself break the page.
      setSystemErrors([]);
    }
  }, []);

  const handleDismissSystemErrors = useCallback(async () => {
    const ids = systemErrors.map((item) => item.id).filter(Boolean);
    setSystemErrors([]);
    try {
      await acknowledgeErrors(ids);
    } catch {
      // Dismissal is cosmetic; the rows stay in the database either way.
    }
  }, [systemErrors]);

  const handleOpenApplicationsPage = useCallback(() => {
    setActivePage(PAGE_KEYS.APPLICATIONS);
    setDrawerOpen(false);
    loadApplications({ silent: false });
    loadSystemErrors();
  }, [loadApplications]);

  const loadStatus = useCallback(async () => {
    try {
      const response = await fetchSyncStatus();
      setStatus(response);
      setSyncing(Boolean(response?.running));
      return response;
    } catch (e) {
      setError(String(e.message || e));
      queueFrontendLog("error", "load_status_failed", String(e?.stack || e?.message || e), {});
      return null;
    }
  }, [queueFrontendLog]);

  const loadPersonalInformation = useCallback(async (options = {}) => {
    const silent = Boolean(options.silent);
    if (!silent) {
      setSettingsLoading(true);
    }
    try {
      const response = await fetchPersonalInformation();
      setPersonalInformation(toFormPersonalInformation(response?.item));
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      if (!silent) {
        setSettingsLoading(false);
      }
    }

    // Absence of stored documents (or a pre-upload server) is not an error on this page;
    // the upload rows just show "Not uploaded yet".
    try {
      const documentsResponse = await fetchApplicantDocuments();
      setApplicantDocuments(Array.isArray(documentsResponse?.items) ? documentsResponse.items : []);
    } catch {
      setApplicantDocuments([]);
    }

    setApplicationAnswersLoading(true);
    setApplicationAnswersError("");
    try {
      const answersResponse = await fetchApplicationAnswers();
      setApplicationAnswers(Array.isArray(answersResponse?.items) ? answersResponse.items : []);
      setApplicationAnswersLoaded(true);
    } catch (answersError) {
      // Preserve any already-loaded edits and make the request failure visible. Replacing
      // them with [] made a temporary outage look like the catalog had been deleted.
      setApplicationAnswersError(String(answersError?.message || answersError));
    } finally {
      setApplicationAnswersLoading(false);
    }
  }, []);

  // Edits are held locally until Save, so filling in several answers is one round trip
  // rather than one per keystroke.
  const handleChangeApplicationAnswer = useCallback((key, field, value) => {
    setApplicationAnswers((prev) =>
      prev.map((item) => (item.key === key ? { ...item, [field]: value } : item))
    );
  }, []);

  const handleSaveApplicationAnswers = useCallback(async () => {
    setAnswersSaving(true);
    setAnswersNotice("");
    try {
      const response = await saveApplicationAnswers(
        applicationAnswers.map((item) => ({ key: item.key, value: item.value, notes: item.notes }))
      );
      const saved = Array.isArray(response?.saved) ? response.saved : [];
      if (saved.length > 0) setApplicationAnswers(saved);
      const answered = saved.filter((item) => String(item?.value || "").trim()).length;
      setAnswersNotice(`Saved. ${answered} of ${saved.length} answered.`);
    } catch (saveError) {
      setAnswersNotice(String(saveError?.message || saveError));
    } finally {
      setAnswersSaving(false);
    }
  }, [applicationAnswers]);

  // Web only: the browser's file picker is the one that exists on every install serving the
  // web UI, and the base64 body matches what POST /settings/applicant-documents expects.
  // Native shells point the user at the web UI instead of growing a picker dependency.
  const handleUploadApplicantDocument = useCallback((kind) => {
    if (Platform.OS !== "web" || typeof document === "undefined") {
      setDocumentNotice("Uploading is supported from the web UI. Open the app in a browser to upload this document.");
      return;
    }

    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".pdf,.docx,.txt,.md";
    input.onchange = () => {
      const file = input.files && input.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onerror = () => setDocumentNotice("Could not read the selected file.");
      reader.onload = async () => {
        setDocumentUploading(kind);
        setDocumentNotice("");
        try {
          // readAsDataURL yields "data:<mime>;base64,<payload>"; the server wants the payload.
          const contentBase64 = String(reader.result || "").split(",").pop();
          const saved = await uploadApplicantDocument({
            kind,
            file_name: file.name,
            content_base64: contentBase64
          });
          setDocumentNotice(
            `Uploaded ${saved.file_name} (${saved.format}, ${Number(saved.chars || 0).toLocaleString()} characters extracted).`
          );
          const documentsResponse = await fetchApplicantDocuments();
          setApplicantDocuments(Array.isArray(documentsResponse?.items) ? documentsResponse.items : []);
        } catch (e) {
          setDocumentNotice(`Upload failed: ${String(e.message || e)}`);
        } finally {
          setDocumentUploading("");
        }
      };
      reader.readAsDataURL(file);
    };
    input.click();
  }, []);

  const loadMcpSettings = useCallback(async (options = {}) => {
    const silent = Boolean(options.silent);
    if (!silent) {
      setMcpSettingsLoading(true);
    }
    try {
      const response = await fetchMcpSettings();
      setMcpSettings(toFormMcpSettings(response?.item));
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      if (!silent) {
        setMcpSettingsLoading(false);
      }
    }
  }, []);

  const loadSyncServiceSettings = useCallback(async (options = {}) => {
    const silent = Boolean(options.silent);
    if (!silent) {
      setSyncServiceSettingsLoading(true);
    }
    try {
      const response = await fetchSyncServiceSettings();
      setSyncServiceSettings(toFormSyncServiceSettings(response?.item));
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      if (!silent) {
        setSyncServiceSettingsLoading(false);
      }
    }
  }, []);

  const loadBlockedCompanies = useCallback(async (options = {}) => {
    const silent = Boolean(options.silent);
    if (!silent) {
      setBlockedCompaniesLoading(true);
    }
    try {
      const response = await fetchBlockedCompanies();
      setBlockedCompanies(Array.isArray(response?.items) ? response.items : []);
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      if (!silent) {
        setBlockedCompaniesLoading(false);
      }
    }
  }, []);

  const runSync = useCallback(async () => {
    setError("");
    setSyncing(true);
    try {
      await triggerWorkdaySync(false);
      await loadStatus();
    } catch (e) {
      setError(String(e.message || e));
      setSyncing(false);
    }
  }, [loadStatus]);

  const loadCodeStatus = useCallback(async () => {
    try {
      setCodeStatus(await fetchCodeStatus());
    } catch {
      // Older backends have no /system/code-status; treat that as "nothing to report".
      setCodeStatus(null);
    }
  }, []);

  const handleRestartServer = useCallback(async () => {
    const syncRunning = Boolean(status?.running);
    if (syncRunning && !restartConfirmArmed) {
      setRestartConfirmArmed(true);
      setRestartNotice("A sync is in progress. Restarting aborts it — press again to confirm.");
      return;
    }

    setRestartConfirmArmed(false);
    setRestartingServer(true);
    setRestartNotice("Restarting server...");

    try {
      await restartServer();
    } catch (e) {
      // The backend refuses up front if the changed files don't compile, so surface
      // that instead of leaving the user waiting for a server that never went down.
      const raw = String(e?.message || e);
      let detail = raw;
      const jsonStart = raw.indexOf("{");
      if (jsonStart >= 0) {
        try {
          const parsed = JSON.parse(raw.slice(jsonStart));
          detail = parsed?.error || raw;
          if (Array.isArray(parsed?.failures) && parsed.failures.length > 0) {
            detail += ` (${parsed.failures.map((f) => f.file).join(", ")})`;
          }
        } catch {
          // Not JSON after all; the raw message is the best available detail.
        }
      }
      setRestartingServer(false);
      setRestartNotice(`Restart failed: ${detail}`);
      return;
    }

    // The process exits a moment after replying, so poll until it answers again.
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      try {
        const nextCodeStatus = await fetchCodeStatus();
        setCodeStatus(nextCodeStatus);
        setRestartingServer(false);
        setRestartNotice("Server restarted. Running the latest code.");
        await loadStatus();
        return;
      } catch {
        // Still down; keep waiting until the deadline.
      }
    }

    setRestartingServer(false);
    setRestartNotice("Server did not come back within 90s. Check the service logs.");
  }, [status, restartConfirmArmed, loadStatus]);

  const handleSaveApplicanteeInformation = useCallback(async () => {
    setError("");
    setSettingsNotice("");
    setSettingsSaving(true);
    try {
      const payload = { ...personalInformation };
      const response = await savePersonalInformation(payload);
      setPersonalInformation(toFormPersonalInformation(response?.item || payload));
      setSettingsNotice("Applicantee information saved.");
    } catch (e) {
      setError(String(e.message || e));
      setSettingsNotice("Unable to save applicantee information.");
    } finally {
      setSettingsSaving(false);
    }
  }, [personalInformation]);

  const handleChangePersonalInformation = useCallback((fieldKey, value) => {
    setPersonalInformation((prev) => ({
      ...prev,
      [fieldKey]: value
    }));
  }, []);

  const handleSaveSyncSettings = useCallback(async () => {
    setError("");
    setSyncSettingsNotice("");
    const syncIntervalSeconds = normalizeSyncIntervalSeconds(syncSettings.syncIntervalSeconds);
    const atsRequestQueueConcurrency = normalizeAtsRequestQueueConcurrency(
      syncServiceSettings.ats_request_queue_concurrency
    );
    const postingFreshnessHours = normalizePostingFreshnessHours(
      syncServiceSettings.posting_freshness_hours
    );
    const syncEnabledAts = normalizeSyncEnabledAts(syncServiceSettings.sync_enabled_ats);

    setSyncSettings((prev) => ({
      ...prev,
      syncIntervalSeconds: String(syncIntervalSeconds)
    }));
    setSyncServiceSettings((prev) => ({
      ...prev,
      ats_request_queue_concurrency: String(atsRequestQueueConcurrency),
      sync_enabled_ats: syncEnabledAts,
      posting_freshness_hours: String(postingFreshnessHours)
    }));

    const intervalLabel = formatSyncIntervalLabel(syncIntervalSeconds);
    const networkScope =
      Platform.OS === "android"
        ? syncSettings.wifiOnly
          ? "on Wi-Fi only"
          : "on any network"
        : "on any network (Wi-Fi-only applies on Android)";
    const statusLabel = syncSettings.autoSyncEnabled ? `enabled every ${intervalLabel} ${networkScope}` : "disabled";
    const localSavedMessage = `Sync settings saved locally at ${formatTimeSafe(new Date())}. Auto sync is ${statusLabel}.`;

    queueFrontendLog("info", "save_sync_settings_started", "Saving sync settings.", {
      ats_request_queue_concurrency: atsRequestQueueConcurrency,
      posting_freshness_hours: postingFreshnessHours,
      sync_enabled_ats_count: syncEnabledAts.length
    });

    setSyncServiceSettingsSaving(true);
    try {
      const response = await saveSyncServiceSettings({
        ats_request_queue_concurrency: atsRequestQueueConcurrency,
        sync_enabled_ats: syncEnabledAts,
        posting_freshness_hours: postingFreshnessHours
      });
      const saved = toFormSyncServiceSettings(response?.item);
      setSyncServiceSettings(saved);
      queueFrontendLog("info", "save_sync_settings_completed", "Sync settings saved successfully.", {
        ats_request_queue_concurrency: saved.ats_request_queue_concurrency,
        posting_freshness_hours: saved.posting_freshness_hours,
        sync_enabled_ats_count: saved.sync_enabled_ats.length
      });
      setSyncSettingsNotice(
        `${localSavedMessage} ATS request queue concurrency saved as ${saved.ats_request_queue_concurrency}. Posting freshness window saved as ${saved.posting_freshness_hours} hours. Sync-enabled ATS: ${saved.sync_enabled_ats.length}. Queue concurrency takes effect next time you stop and restart the sync service. Posting freshness applies immediately.`
      );
    } catch (e) {
      setError(String(e.message || e));
      queueFrontendLog("error", "save_sync_settings_failed", String(e?.stack || e?.message || e), {
        ats_request_queue_concurrency: atsRequestQueueConcurrency,
        posting_freshness_hours: postingFreshnessHours,
        sync_enabled_ats_count: syncEnabledAts.length
      });
      setSyncSettingsNotice(
        `${localSavedMessage} Unable to save ATS request queue concurrency and posting freshness on the server.`
      );
    } finally {
      setSyncServiceSettingsSaving(false);
    }
  }, [
    queueFrontendLog,
    syncServiceSettings.ats_request_queue_concurrency,
    syncServiceSettings.posting_freshness_hours,
    syncServiceSettings.sync_enabled_ats,
    syncSettings
  ]);

  const handleMigrateFromDatabase = useCallback(async () => {
    const sourceDbPath = String(migrationSourceDbPath || "").trim();
    if (!sourceDbPath) {
      setMigrationNotice("Please enter a source database path.");
      return;
    }
    const selectedCount = Object.values(migrationSelection || {}).filter(Boolean).length;
    if (selectedCount === 0) {
      setMigrationNotice("Select at least one migration option.");
      return;
    }

    setError("");
      setMigrationNotice("");
      setMigrationRunning(true);
      try {
      const response = await migrateDatabaseSettings({
        source_db_path: sourceDbPath,
        personal_information: migrationSelection.personal_information,
        mcp_settings: migrationSelection.mcp_settings,
        blocked_companies: migrationSelection.blocked_companies,
        applications: migrationSelection.applications
      });
      const summary = response?.summary || {};

      const refreshTasks = [
        loadApplications({ silent: true }),
        loadSyncServiceSettings({ silent: true }),
        loadBlockedCompanies({ silent: true })
      ];
      if (!IS_ANDROID) {
        refreshTasks.push(loadPersonalInformation({ silent: true }));
        refreshTasks.push(loadMcpSettings({ silent: true }));
      }
      await Promise.all(refreshTasks);

      const messageParts = ["Migration complete."];
      if (summary?.selected?.personal_information) {
        messageParts.push(`Personal info: ${summary.personal_information_copied ? "copied" : "not found"}`);
      }
      if (summary?.selected?.mcp_settings) {
        messageParts.push(`AI/MCP: ${summary.mcp_settings_copied ? "copied" : "not found"}`);
      }
      if (summary?.selected?.blocked_companies) {
        messageParts.push(`Blocked companies upserted: ${summary.blocked_companies_copied || 0}`);
      }
      if (summary?.selected?.applications) {
        messageParts.push(`Applications inserted: ${summary.applications_inserted || 0}`);
        messageParts.push(`Applications reused: ${summary.applications_reused || 0}`);
        messageParts.push(
          `Applications skipped (missing company): ${summary.applications_skipped_missing_company || 0}`
        );
      }
      setMigrationNotice(messageParts.join(" | "));
    } catch (e) {
      setError(String(e.message || e));
      setMigrationNotice("Migration failed.");
    } finally {
      setMigrationRunning(false);
    }
  }, [
    migrationSelection,
    migrationSourceDbPath,
    loadApplications,
    loadBlockedCompanies,
    loadMcpSettings,
    loadPersonalInformation,
    loadSyncServiceSettings
  ]);

  const handleExportSettings = useCallback(async () => {
    setError("");
    setMigrationNotice("");
    setExportSettingsRunning(true);
    try {
      const response = await fetchSettingsExport({ include_mcp: !IS_ANDROID });
      const fileTimestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const fileName = `openpostings-settings-${fileTimestamp}.json`;
      const exportPayload = {
        exported_at: response?.exported_at || new Date().toISOString(),
        db_path: response?.db_path || "",
        item: response?.item || {}
      };
      const fileContent = JSON.stringify(exportPayload, null, 2);

      if (IS_ANDROID) {
        const fileSystem = getFileSystemModule();
        if (!fileSystem?.StorageAccessFramework) {
          throw new Error("expo-file-system is unavailable for Android export.");
        }
        const permissions = await fileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
        if (!permissions?.granted || !permissions?.directoryUri) {
          setMigrationNotice("Export cancelled before selecting a destination folder.");
          return;
        }
        const targetUri = await fileSystem.StorageAccessFramework.createFileAsync(
          permissions.directoryUri,
          fileName.replace(/\.json$/i, ""),
          "application/json"
        );
        await fileSystem.writeAsStringAsync(targetUri, fileContent, {
          encoding: fileSystem.EncodingType.UTF8
        });
        setMigrationNotice(`Settings exported to ${targetUri}`);
        return;
      }

      if (Platform.OS === "web" && typeof window !== "undefined" && typeof document !== "undefined") {
        const blob = new Blob([fileContent], { type: "application/json;charset=utf-8" });
        const objectUrl = window.URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = objectUrl;
        anchor.download = fileName;
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
        window.URL.revokeObjectURL(objectUrl);
        setMigrationNotice(`Settings export downloaded as ${fileName}`);
        return;
      }

      if (Platform.OS === "windows") {
        setMigrationNotice("Settings export is unavailable on the Windows MSI build.");
        return;
      }

      const fileSystem = getFileSystemModule();
      const fallbackDocumentDirectory = fileSystem?.documentDirectory;
      if (!fallbackDocumentDirectory) {
        throw new Error("No writable document directory is available for export.");
      }
      const fallbackPath = `${fallbackDocumentDirectory}${fileName}`;
      await fileSystem.writeAsStringAsync(fallbackPath, fileContent, {
        encoding: fileSystem.EncodingType.UTF8
      });
      setMigrationNotice(`Settings exported to ${fallbackPath}`);
    } catch (e) {
      setError(String(e.message || e));
      setMigrationNotice("Settings export failed.");
    } finally {
      setExportSettingsRunning(false);
    }
  }, []);

  const handleSaveMcpSettings = useCallback(async () => {
    setError("");
    setMcpSettingsNotice("");
    setMcpSettingsSaving(true);
    try {
      const payload = toApiMcpSettings(mcpSettings);
      const response = await saveMcpSettings(payload);
      const savedSettings = toFormMcpSettings(response?.item || payload);
      setMcpSettings(savedSettings);

      const preview = await fetchMcpCandidates({
        use_settings: true,
        include_applied: false,
        limit: Number.parseInt(savedSettings.max_applications_per_run, 10) || 10
      });
      setMcpSettingsNotice(`MCP settings saved. ${preview?.count || 0} candidate postings currently match.`);
    } catch (e) {
      setError(String(e.message || e));
      setMcpSettingsNotice("Unable to save MCP settings.");
    } finally {
      setMcpSettingsSaving(false);
    }
  }, [mcpSettings]);

  const handleTrackPostingApplication = useCallback(
    async (posting) => {
      const postingKey = String(posting?.job_posting_url || "").trim();
      if (!postingKey) return;

      setSavingApplicationIds((prev) => ({
        ...prev,
        [postingKey]: true
      }));
      setError("");
      try {
        const response = await createApplication({
          company_name: posting.company_name,
          position_name: posting.position_name,
          job_posting_url: posting.job_posting_url,
          application_date: Math.floor(Date.now() / 1000),
          status: "applied",
          applied_by_type: "manual",
          applied_by_label: "Manually applied by user"
        });
        postingsRequestSequenceRef.current += 1;
        setPostings((prev) =>
          prev.filter((item) => String(item?.job_posting_url || "").trim() !== postingKey)
        );
        lastPostingRefreshAtRef.current = Date.now();
        const createdApplication = normalizeApplicationItem(response?.item);
        if (createdApplication.id > 0) {
          applicationsRequestSequenceRef.current += 1;
          setApplications((prev) => {
            const remaining = prev.filter((item) => item.id !== createdApplication.id);
            return [createdApplication, ...remaining];
          });
        }
        setApplicationsNotice(`Saved "${posting.position_name}" to Applications.`);
        await loadApplications({ silent: false });
      } catch (e) {
        setError(String(e.message || e));
      } finally {
        setSavingApplicationIds((prev) => ({
          ...prev,
          [postingKey]: false
        }));
      }
    },
    [loadApplications]
  );

  const handleIgnorePosting = useCallback(async (posting) => {
    const postingKey = String(posting?.job_posting_url || "").trim();
    if (!postingKey) return;

    setIgnoringPostingIds((prev) => ({
      ...prev,
      [postingKey]: true
    }));
    setError("");
    try {
      const response = await ignorePosting({
        job_posting_url: posting.job_posting_url,
        ignored: true,
        ignored_by_label: "Ignored by user"
      });
      postingsRequestSequenceRef.current += 1;
      const nextItem = normalizePostingItem({ ...posting, ...(response?.item || {}), review_state: "ignored", ignored: true });
      setPostings((prev) => postingReviewQueueRef.current === "reviewed"
        ? prev.map((item) => String(item?.job_posting_url || "").trim() === postingKey ? nextItem : item)
        : prev.filter((item) => String(item?.job_posting_url || "").trim() !== postingKey));
      setSelectedPosting((current) => String(current?.job_posting_url || "").trim() === postingKey ? nextItem : current);
      setApplicationsNotice(`Ignored "${posting.position_name}".`);
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setIgnoringPostingIds((prev) => ({
        ...prev,
        [postingKey]: false
      }));
    }
  }, []);

  const handleSetPostingReviewState = useCallback(async (posting, reviewState) => {
    const postingKey = String(posting?.job_posting_url || "").trim();
    if (!postingKey) return null;
    setReviewingPostingIds((previous) => ({ ...previous, [postingKey]: true }));
    setError("");
    try {
      const response = await setPostingReviewState({
        job_posting_url: postingKey,
        review_state: reviewState
      });
      const nextItem = normalizePostingItem({ ...posting, ...(response?.item || {}), review_state: reviewState });
      const queue = postingReviewQueueRef.current;
      const remainsInQueue =
        (queue === "shortlisted" && reviewState === "shortlisted") ||
        (queue === "reviewed" && ["viewed", "ignored"].includes(reviewState));
      postingsRequestSequenceRef.current += 1;
      setPostings((previous) => remainsInQueue
        ? previous.map((item) => String(item?.job_posting_url || "").trim() === postingKey ? nextItem : item)
        : previous.filter((item) => String(item?.job_posting_url || "").trim() !== postingKey));
      setSelectedPosting((current) => String(current?.job_posting_url || "").trim() === postingKey ? nextItem : current);
      setApplicationsNotice(
        reviewState === "shortlisted" ? `Shortlisted "${posting.position_name}".` : `Marked "${posting.position_name}" viewed.`
      );
      return nextItem;
    } catch (e) {
      setError(String(e.message || e));
      return null;
    } finally {
      setReviewingPostingIds((previous) => ({ ...previous, [postingKey]: false }));
    }
  }, []);

  const handleOpenPostingDetails = useCallback(async (posting) => {
    const postingKey = String(posting?.job_posting_url || "").trim();
    if (!postingKey) return;
    setSelectedPosting(posting);
    setPostingDetailsLoading(true);
    if (String(posting?.review_state || "unseen") === "unseen") {
      await handleSetPostingReviewState(posting, "viewed");
    }
    try {
      const response = await fetchPostingDetails(postingKey);
      setSelectedPosting((current) => normalizePostingItem({ ...current, ...(response?.item || {}) }));
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setPostingDetailsLoading(false);
    }
  }, [handleSetPostingReviewState]);

  const handleLoadMorePostings = useCallback(async () => {
    if (postingsLoadingMore || !postingsHasMore) return;
    setPostingsLoadingMore(true);
    await loadPostings(searchRef.current, {
      append: true,
      silent: true,
      offset: postings.length,
      filters: postingsFiltersRef.current,
      reviewQueue: postingReviewQueueRef.current
    });
  }, [loadPostings, postings.length, postingsHasMore, postingsLoadingMore]);

  const handleBlockCompany = useCallback(
    async (posting) => {
      const companyName = String(posting?.company_name || "").trim();
      const normalizedCompanyName = normalizeCompanyName(companyName);
      if (!companyName || !normalizedCompanyName) return;

      setBlockingCompanyNames((prev) => ({
        ...prev,
        [normalizedCompanyName]: true
      }));
      setError("");
      try {
        await blockCompany({ company_name: companyName });
        setPostings((prev) =>
          prev.filter((item) => normalizeCompanyName(item?.company_name) !== normalizedCompanyName)
        );
        await loadBlockedCompanies({ silent: true });
        setApplicationsNotice(`Blocked "${companyName}". Postings from this company are now hidden.`);
      } catch (e) {
        setError(String(e.message || e));
      } finally {
        setBlockingCompanyNames((prev) => ({
          ...prev,
          [normalizedCompanyName]: false
        }));
      }
    },
    [loadBlockedCompanies]
  );

  const handleUnblockCompany = useCallback(
    async (companyName) => {
      const normalizedCompanyName = normalizeCompanyName(companyName);
      if (!normalizedCompanyName) return;

      setUnblockingCompanyNames((prev) => ({
        ...prev,
        [normalizedCompanyName]: true
      }));
      setError("");
      try {
        await unblockCompany({ company_name: companyName });
        await loadBlockedCompanies({ silent: true });
        await loadPostings(searchRef.current, { silent: true, filters: postingsFiltersRef.current });
        setApplicationsNotice(`Unblocked "${companyName}".`);
      } catch (e) {
        setError(String(e.message || e));
      } finally {
        setUnblockingCompanyNames((prev) => ({
          ...prev,
          [normalizedCompanyName]: false
        }));
      }
    },
    [loadBlockedCompanies, loadPostings]
  );

  const handleUpdateApplicationStatus = useCallback(async (applicationId, nextStatus) => {
    setUpdatingApplicationIds((prev) => ({
      ...prev,
      [applicationId]: true
    }));
    setError("");
    try {
      const response = await updateApplicationStatus(applicationId, nextStatus);
      const item = response?.item;
      if (item) {
        setApplications((prev) =>
          prev.map((application) =>
            application.id === applicationId ? normalizeApplicationItem({ ...application, ...item }) : application
          )
        );
      }
      setApplicationsNotice(`Updated application status to "${nextStatus}".`);
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setUpdatingApplicationIds((prev) => ({
        ...prev,
        [applicationId]: false
      }));
      setOpenApplicationStatusForId(null);
    }
  }, []);

  const handleUpdateApplicationFit = useCallback(async (applicationId, nextFitAssessment) => {
    setUpdatingApplicationFitIds((prev) => ({
      ...prev,
      [applicationId]: true
    }));
    setError("");
    try {
      const response = await updateApplicationFit(applicationId, nextFitAssessment);
      const item = response?.item;
      if (item) {
        setApplications((prev) =>
          prev.map((application) =>
            application.id === applicationId ? normalizeApplicationItem({ ...application, ...item }) : application
          )
        );
      }
      setApplicationsNotice(
        nextFitAssessment ? `Marked application as "${nextFitAssessment}".` : "Cleared fit assessment."
      );
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setUpdatingApplicationFitIds((prev) => ({
        ...prev,
        [applicationId]: false
      }));
      setOpenApplicationFitForId(null);
    }
  }, []);

  const handleDeleteApplication = useCallback(async (applicationId) => {
    setDeletingApplicationIds((prev) => ({
      ...prev,
      [applicationId]: true
    }));
    setError("");
    try {
      await deleteApplication(applicationId);
      setApplications((prev) => prev.filter((application) => application.id !== applicationId));
      setApplicationsNotice("Application deleted.");
      setOpenApplicationStatusForId(null);
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setDeletingApplicationIds((prev) => ({
        ...prev,
        [applicationId]: false
      }));
    }
  }, []);

  const setAtsFilter = useCallback((value) => {
    const nextValue = String(value || "all").trim().toLowerCase();
    setPostingsFilters((prev) => ({
      ...prev,
      ats: nextValue || "all"
    }));
  }, []);

  const toggleIndustryFilter = useCallback((value) => {
    setPostingsFilters((prev) => {
      const next = new Set(prev.industries);
      if (next.has(value)) {
        next.delete(value);
      } else {
        next.add(value);
      }
      return {
        ...prev,
        industries: Array.from(next)
      };
    });
  }, []);

  const toggleRegionFilter = useCallback(
    (value) => {
      setPostingsFilters((prev) => {
        const nextRegions = new Set(prev.regions || []);
        if (nextRegions.has(value)) {
          nextRegions.delete(value);
        } else {
          nextRegions.add(value);
        }

        const nextRegionValues = Array.from(nextRegions);
        const nextCountries = (prev.countries || []).filter((countryValue) => {
          if (nextRegionValues.length === 0) return true;
          const countryRegion = countryRegionByValue.get(String(countryValue || ""));
          return countryRegion && nextRegionValues.includes(countryRegion);
        });

        return {
          ...prev,
          regions: nextRegionValues,
          countries: nextCountries
        };
      });
    },
    [countryRegionByValue]
  );

  const toggleCountryFilter = useCallback((value) => {
    setPostingsFilters((prev) => {
      const next = new Set(prev.countries || []);
      if (next.has(value)) {
        next.delete(value);
      } else {
        next.add(value);
      }
      return {
        ...prev,
        countries: Array.from(next)
      };
    });
  }, []);

  const toggleStateFilter = useCallback((value) => {
    setPostingsFilters((prev) => {
      const nextStates = new Set(prev.states);
      if (nextStates.has(value)) {
        nextStates.delete(value);
      } else {
        nextStates.add(value);
      }

      const nextStateValues = Array.from(nextStates);
      const nextCounties = prev.counties.filter((countyValue) => {
        const [stateCode] = String(countyValue || "").split("|");
        return !stateCode || nextStateValues.includes(stateCode);
      });
      // Cities are "City|ST", so the state is the second segment -- counties are "ST|County"
      // and put it first. Dropping a state must drop the cities that came with it, or the
      // filter keeps narrowing on a city no longer offered anywhere in the UI.
      const nextCities = (prev.cities || []).filter((cityValue) => {
        const parts = String(cityValue || "").split("|");
        const stateCode = parts.length > 1 ? parts[1] : "";
        return !stateCode || nextStateValues.includes(stateCode);
      });

      return {
        ...prev,
        states: nextStateValues,
        counties: nextCounties,
        cities: nextCities
      };
    });
  }, []);

  const toggleCountyFilter = useCallback((value) => {
    setPostingsFilters((prev) => {
      const next = new Set(prev.counties);
      if (next.has(value)) {
        next.delete(value);
      } else {
        next.add(value);
      }
      return {
        ...prev,
        counties: Array.from(next)
      };
    });
  }, []);

  const toggleCityFilter = useCallback((value) => {
    setPostingsFilters((prev) => {
      const next = new Set(prev.cities || []);
      if (next.has(value)) {
        next.delete(value);
      } else {
        next.add(value);
      }
      return {
        ...prev,
        cities: Array.from(next)
      };
    });
  }, []);

  const clearAllPostingFilters = useCallback(() => {
    setPostingsFilters({
      ats: "all",
      industries: [],
      regions: [],
      countries: [],
      states: [],
      counties: [],
      cities: [],
      remote: ["all"],
      hide_no_date: false,
      sort_by: "recent"
    });
  }, []);

  const toggleMcpIndustryPreference = useCallback((value) => {
    setMcpSettings((prev) => {
      const next = new Set(prev.preferred_industries || []);
      if (next.has(value)) {
        next.delete(value);
      } else {
        next.add(value);
      }
      return {
        ...prev,
        preferred_industries: Array.from(next)
      };
    });
  }, []);

  const toggleMcpRegionPreference = useCallback(
    (value) => {
      setMcpSettings((prev) => {
        const nextRegions = new Set(prev.preferred_regions || []);
        if (nextRegions.has(value)) {
          nextRegions.delete(value);
        } else {
          nextRegions.add(value);
        }

        const nextRegionValues = Array.from(nextRegions);
        const nextCountries = (prev.preferred_countries || []).filter((countryValue) => {
          if (nextRegionValues.length === 0) return true;
          const countryRegion = countryRegionByValue.get(String(countryValue || ""));
          return countryRegion && nextRegionValues.includes(countryRegion);
        });

        return {
          ...prev,
          preferred_regions: nextRegionValues,
          preferred_countries: nextCountries
        };
      });
    },
    [countryRegionByValue]
  );

  const toggleMcpCountryPreference = useCallback((value) => {
    setMcpSettings((prev) => {
      const next = new Set(prev.preferred_countries || []);
      if (next.has(value)) {
        next.delete(value);
      } else {
        next.add(value);
      }
      return {
        ...prev,
        preferred_countries: Array.from(next)
      };
    });
  }, []);

  const toggleMcpStatePreference = useCallback((value) => {
    setMcpSettings((prev) => {
      const nextStates = new Set(prev.preferred_states || []);
      if (nextStates.has(value)) {
        nextStates.delete(value);
      } else {
        nextStates.add(value);
      }

      const nextStateValues = Array.from(nextStates);
      const nextCounties = (prev.preferred_counties || []).filter((countyValue) => {
        const [stateCode] = String(countyValue || "").split("|");
        return !stateCode || nextStateValues.includes(stateCode);
      });

      return {
        ...prev,
        preferred_states: nextStateValues,
        preferred_counties: nextCounties
      };
    });
  }, []);

  const toggleMcpCountyPreference = useCallback((value) => {
    setMcpSettings((prev) => {
      const next = new Set(prev.preferred_counties || []);
      if (next.has(value)) {
        next.delete(value);
      } else {
        next.add(value);
      }
      return {
        ...prev,
        preferred_counties: Array.from(next)
      };
    });
  }, []);

  useEffect(() => {
    searchRef.current = search;
  }, [search]);

  useEffect(() => {
    postingsFiltersRef.current = postingsFilters;
  }, [postingsFilters]);

  useEffect(() => {
    postingReviewQueueRef.current = postingReviewQueue;
  }, [postingReviewQueue]);

  // Pausing the poll while hidden means a tab can come back arbitrarily stale, so becoming
  // visible triggers one immediate refresh. That is strictly cheaper than the polling it
  // replaces: one fetch per time the tab is looked at, instead of one per minute forever.
  useEffect(() => {
    if (!filtersHydrated) return;

    const refreshIfForeground = () => {
      if (!isAppForeground()) return;
      if (postingsRefreshInFlightRef.current) return;
      loadPostings(searchRef.current, { silent: true, filters: postingsFiltersRef.current });
    };

    if (Platform.OS === "web") {
      if (typeof document === "undefined") return undefined;
      document.addEventListener("visibilitychange", refreshIfForeground);
      return () => document.removeEventListener("visibilitychange", refreshIfForeground);
    }

    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") refreshIfForeground();
    });
    return () => subscription.remove();
  }, [filtersHydrated, loadPostings]);

  // The toggle changes what the server is asked to send, not just what is rendered, so a
  // refetch is needed when it flips: turning descriptions back on has to go get them.
  useEffect(() => {
    const previous = showPostingDescriptionsRef.current;
    showPostingDescriptionsRef.current = showPostingDescriptions;
    if (!filtersHydrated || previous === showPostingDescriptions) return;
    loadPostings(searchRef.current, { silent: true, filters: postingsFiltersRef.current });
  }, [showPostingDescriptions, filtersHydrated, loadPostings]);

  useEffect(() => {
    if (Platform.OS !== "windows") return undefined;

    const flushId = setInterval(() => {
      void flushFrontendLogs();
    }, 2500);

    return () => clearInterval(flushId);
  }, [flushFrontendLogs]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const persisted = await loadPersistedFilters();
      if (cancelled) return;
      if (persisted) {
        setPostingsFilters(persisted.filters);
        setSearch(persisted.search);
        // Keep the refs in step immediately: the bootstrap fetch below reads them
        // directly and would otherwise race the effects that sync them.
        postingsFiltersRef.current = persisted.filters;
        searchRef.current = persisted.search;
      }
      setFiltersHydrated(true);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!filtersHydrated) return undefined;
    const timer = setTimeout(() => {
      savePersistedFilters(postingsFilters, search);
    }, 400);
    return () => clearTimeout(timer);
  }, [filtersHydrated, postingsFilters, search]);

  useEffect(() => {
    if (!filtersHydrated) return;

    const bootstrap = async () => {
      setInitializing(true);
      setError("");
      try {
        const bootstrapTasks = [
          loadPostings("", { filters: postingsFiltersRef.current }),
          loadStatus(),
          loadSyncServiceSettings(),
          loadBlockedCompanies(),
          loadPostingFilterOptions(),
          loadApplications()
        ];
        if (!IS_ANDROID) {
          bootstrapTasks.push(loadPersonalInformation());
          bootstrapTasks.push(loadMcpSettings());
        }
        await Promise.all(bootstrapTasks);
      } catch (e) {
        setError(String(e.message || e));
      } finally {
        setInitializing(false);
      }
    };

    bootstrap();
  }, [
    filtersHydrated,
    loadPostings,
    loadStatus,
    loadPersonalInformation,
    loadSyncServiceSettings,
    loadBlockedCompanies,
    loadMcpSettings,
    loadPostingFilterOptions,
    loadApplications
  ]);

  useEffect(() => {
    if (!filtersHydrated) return undefined;
    // Bootstrap already loads the hydrated filters. Without this guard the independent
    // debounce launches the same expensive posting query 1.8s later, often before the
    // bootstrap request has finished.
    if (!postingsFilterRefreshInitializedRef.current) {
      postingsFilterRefreshInitializedRef.current = true;
      return undefined;
    }
    const timer = setTimeout(() => {
      loadPostings(search, { filters: postingsFilters });
    }, 1800);
    return () => clearTimeout(timer);
  }, [filtersHydrated, search, postingsFilters, postingReviewQueue, loadPostings]);

  useEffect(() => {
    if (!syncSettings.autoSyncEnabled) return undefined;

    const syncIntervalSeconds = normalizeSyncIntervalSeconds(syncSettings.syncIntervalSeconds);
    const syncIntervalMs = syncIntervalSeconds * 1000;

    const id = setInterval(async () => {
      if (autoSyncInFlightRef.current) return;

      if (Platform.OS === "android" && syncSettings.wifiOnly) {
        try {
          const NetInfo = getAndroidNetInfo();
          if (!NetInfo) return;
          const networkState = await NetInfo.fetch();
          const networkType = String(networkState?.type || "").toLowerCase();
          if (networkType !== "wifi") return;
        } catch {
          return;
        }
      }

      autoSyncInFlightRef.current = true;
      try {
        await runSync();
      } finally {
        autoSyncInFlightRef.current = false;
      }
    }, syncIntervalMs);

    return () => clearInterval(id);
  }, [runSync, syncSettings.autoSyncEnabled, syncSettings.syncIntervalSeconds, syncSettings.wifiOnly]);

  useEffect(() => {
    const id = setInterval(async () => {
      if (statusPollInFlightRef.current) return;
      // Nothing is being displayed, so nothing needs fetching. The visibilitychange
      // listener below catches up the moment the tab is looked at again.
      if (!isAppForeground()) return;

      statusPollInFlightRef.current = true;
      try {
        const latest = await loadStatus();
        if (!latest) return;

        const isRunning = Boolean(latest.running);
        const syncJustFinished = wasSyncRunningRef.current && !isRunning;
        wasSyncRunningRef.current = isRunning;
        const newPostings = Number(latest.new_postings || 0);
        const previousNewPostings = lastObservedNewPostingsRef.current;
        const discoveredNewPostings =
          previousNewPostings !== null && newPostings > Number(previousNewPostings || 0);
        lastObservedNewPostingsRef.current = newPostings;

        if (effectiveActivePage !== PAGE_KEYS.POSTINGS) return;
        if (postingsRefreshInFlightRef.current) return;

        const now = Date.now();
        const sinceLastRefreshMs = now - lastPostingRefreshAtRef.current;
        const newPostingRefreshDue = discoveredNewPostings && sinceLastRefreshMs >= 30000;
        const periodicRefreshDue = sinceLastRefreshMs >= (isRunning ? 120000 : 60000);
        if (!newPostingRefreshDue && !periodicRefreshDue && !syncJustFinished) return;

        postingsRefreshInFlightRef.current = true;
        try {
          await loadPostings(searchRef.current, { silent: true, filters: postingsFiltersRef.current });
        } finally {
          postingsRefreshInFlightRef.current = false;
        }
      } finally {
        statusPollInFlightRef.current = false;
      }
    }, 3000);
    return () => clearInterval(id);
  }, [effectiveActivePage, loadPostings, loadStatus]);

  useEffect(() => {
    if (effectiveActivePage !== PAGE_KEYS.APPLICATIONS) return;
    loadApplications({ silent: false });
  }, [effectiveActivePage, loadApplications]);

  useEffect(() => {
    if (effectiveActivePage !== PAGE_KEYS.APPLICATION_METRICS) return;
    loadApplicationStats({ silent: false });
  }, [effectiveActivePage, loadApplicationStats]);

  // Settings may have bootstrapped while the API was restarting. Reload on entry so a
  // transient failure cannot leave the page stuck on empty defaults for the whole session.
  useEffect(() => {
    if (effectiveActivePage !== PAGE_KEYS.SETTINGS_APPLICANTEE) return;
    loadPersonalInformation({ silent: false });
  }, [effectiveActivePage, loadPersonalInformation]);

  useEffect(() => {
    if (effectiveActivePage !== PAGE_KEYS.POSTINGS) return;
    loadStatus();
    loadSyncServiceSettings({ silent: true });
    loadPostingFilterOptions();
  }, [effectiveActivePage, loadStatus, loadSyncServiceSettings, loadPostingFilterOptions]);

  useEffect(() => {
    if (effectiveActivePage !== PAGE_KEYS.SETTINGS_SYNC) return;
    loadCodeStatus();
  }, [effectiveActivePage, loadCodeStatus]);

  useEffect(() => {
    if (effectiveActivePage !== PAGE_KEYS.SCRAPER_PERFORMANCE) return;
    loadStatus();
  }, [effectiveActivePage, loadStatus]);

  const renderPostingsPage = () => (
    <>
      <View style={styles.controls}>
        <TextInput
          style={styles.search}
          value={search}
          onChangeText={setSearch}
          placeholder="Search company or title"
          autoCapitalize="none"
        />
        <Pressable onPress={runSync} style={styles.syncBtn}>
          <Text style={styles.syncBtnText}>{syncing ? "Syncing..." : "Sync Postings"}</Text>
        </Pressable>
      </View>

      <View style={styles.reviewQueueRow}>
        {POSTING_REVIEW_QUEUES.map((queue) => {
          const selected = postingReviewQueue === queue.value;
          return (
            <Pressable
              key={queue.value}
              onPress={() => setPostingReviewQueue(queue.value)}
              style={[styles.reviewQueueTab, selected ? styles.reviewQueueTabActive : null]}
            >
              <Text style={[styles.reviewQueueTabText, selected ? styles.reviewQueueTabTextActive : null]}>{queue.label}</Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.reviewQueueHelp}>
        {postingReviewQueue === "new"
          ? "Unseen roles with a recent confirmed date or recent discovery. Opening one marks it viewed."
          : postingReviewQueue === "shortlisted"
            ? "Roles you set aside for closer consideration."
            : "Viewed and ignored roles; ignored roles remain visibly marked."}
      </Text>

      {/* Sorting is not a filter: it is changed constantly while scanning results, so it
          stays visible rather than living behind the collapsed filter panel. */}
      <View style={styles.postingsSortRow}>
        <Text style={styles.postingsSortLabel}>Sort</Text>
        {POSTING_SORT_OPTIONS.map((option) => {
          const selected = String(postingsFilters.sort_by || "recent") === option.value;
          return (
            <Pressable
              key={option.value}
              onPress={() =>
                setPostingsFilters((prev) => ({
                  ...prev,
                  sort_by: option.value
                }))
              }
              style={[styles.remoteFilterChip, selected ? styles.remoteFilterChipActive : null]}
            >
              <Text style={[styles.remoteFilterChipText, selected ? styles.remoteFilterChipTextActive : null]}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.postingsFiltersHeaderRow}>
        <View style={styles.postingsFiltersLeftGroup}>
          <Pressable onPress={() => setPostingsFilterPanelOpen((prev) => !prev)} style={styles.postingsFiltersToggleBtn}>
            <Text style={styles.postingsFiltersToggleText}>
              {postingsFilterPanelOpen ? "Hide Filters" : "Show Filters"}
            </Text>
          </Pressable>
          {/* The database browser answers what this listing structurally cannot: whether an
              employer is tracked at all, and what exists behind the freshness window. It is
              served by the API rather than by Metro, hence the absolute URL. */}
          <Pressable
            onPress={() => Linking.openURL(`${API_BASE_URL}/db`)}
            style={styles.postingsFiltersToggleBtn}
          >
            <Text style={styles.postingsFiltersToggleText}>Browse DB</Text>
          </Pressable>
          <View style={styles.postingDescriptionToggleRow}>
            <Text style={styles.postingDescriptionToggleLabel}>Load descriptions</Text>
            <Switch value={showPostingDescriptions} onValueChange={setShowPostingDescriptions} />
          </View>
        </View>
        <Pressable onPress={clearAllPostingFilters} style={styles.postingsFiltersClearBtn}>
          <Text style={styles.postingsFiltersClearText}>Clear</Text>
        </Pressable>
      </View>

      {postingsFilterPanelOpen ? (
        <View style={styles.postingsFiltersPanel}>
          <ScrollView
            style={styles.postingsFiltersPanelScroll}
            contentContainerStyle={styles.postingsFiltersPanelContent}
            nestedScrollEnabled
            keyboardShouldPersistTaps="handled"
          >
            {postingFilterOptionsLoading ? (
              <Text style={styles.small}>Loading filter options...</Text>
            ) : (
              <>
                <SingleSelectDropdown
                  label="ATS"
                  options={postingFilterOptions.ats}
                  selectedValue={postingsFilters.ats}
                  onSelectValue={setAtsFilter}
                  anyLabel="All ATS"
                />

                <MultiSelectDropdown
                  label="Industries"
                  options={postingFilterOptions.industries}
                  selectedValues={postingsFilters.industries}
                  onToggleValue={toggleIndustryFilter}
                  onClear={() =>
                    setPostingsFilters((prev) => ({
                      ...prev,
                      industries: []
                    }))
                  }
                  emptyText="No industries available."
                />

                <MultiSelectDropdown
                  label="Regions"
                  options={postingFilterOptions.regions}
                  selectedValues={postingsFilters.regions}
                  onToggleValue={toggleRegionFilter}
                  onClear={() =>
                    setPostingsFilters((prev) => ({
                      ...prev,
                      regions: [],
                      countries: []
                    }))
                  }
                  emptyText="No regions available."
                />

                <MultiSelectDropdown
                  label="Countries"
                  options={visibleCountryOptions}
                  selectedValues={postingsFilters.countries}
                  onToggleValue={toggleCountryFilter}
                  onClear={() =>
                    setPostingsFilters((prev) => ({
                      ...prev,
                      countries: []
                    }))
                  }
                  emptyText="No countries match selected regions."
                />

                <MultiSelectDropdown
                  label="States"
                  options={postingFilterOptions.states}
                  selectedValues={postingsFilters.states}
                  onToggleValue={toggleStateFilter}
                  onClear={() =>
                    setPostingsFilters((prev) => ({
                      ...prev,
                      states: [],
                      counties: []
                    }))
                  }
                  emptyText="No states available."
                />

                <MultiSelectDropdown
                  label="Counties"
                  options={visibleCountyOptions}
                  selectedValues={postingsFilters.counties}
                  onToggleValue={toggleCountyFilter}
                  onClear={() =>
                    setPostingsFilters((prev) => ({
                      ...prev,
                      counties: []
                    }))
                  }
                  emptyText="No counties match selected states."
                />

                <MultiSelectDropdown
                  label="Cities"
                  options={visibleCityOptions}
                  selectedValues={postingsFilters.cities}
                  onToggleValue={toggleCityFilter}
                  onClear={() =>
                    setPostingsFilters((prev) => ({
                      ...prev,
                      cities: []
                    }))
                  }
                  emptyText="Pick a state first — cities are listed per state."
                />
              </>
            )}

            <View style={styles.remoteFilterGroup}>
              <Text style={styles.fieldLabel}>Remote Filter</Text>
              <View style={styles.remoteFilterChipsRow}>
                {remoteFilterOptions.map((option) => {
                  const selected = Array.isArray(postingsFilters.remote)
                    ? postingsFilters.remote.includes(option.value)
                    : postingsFilters.remote === option.value;
                  return (
                    <Pressable
                      key={option.value}
                      onPress={() =>
                        setPostingsFilters((prev) => {
                          const current = Array.isArray(prev.remote)
                            ? prev.remote
                            : [String(prev.remote || "all")];

                          if (option.value === "all") {
                            return {
                              ...prev,
                              remote: ["all"]
                            };
                          }

                          const next = new Set(current.filter((value) => value && value !== "all"));
                          if (next.has(option.value)) {
                            next.delete(option.value);
                          } else {
                            next.add(option.value);
                          }

                          return {
                            ...prev,
                            remote: next.size > 0 ? Array.from(next) : ["all"]
                          };
                        })
                      }
                      style={[styles.remoteFilterChip, selected ? styles.remoteFilterChipActive : null]}
                    >
                      <Text style={[styles.remoteFilterChipText, selected ? styles.remoteFilterChipTextActive : null]}>
                        {option.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <View style={styles.remoteNoDateToggleRow}>
                <Text style={styles.remoteNoDateToggleLabel}>Hide postings with no date</Text>
                <Switch
                  value={Boolean(postingsFilters.hide_no_date)}
                  onValueChange={(value) =>
                    setPostingsFilters((prev) => ({
                      ...prev,
                      hide_no_date: value
                    }))
                  }
                />
              </View>
            </View>
          </ScrollView>
        </View>
      ) : null}

      <Text style={styles.status}>{statusText}</Text>
      {status?.running && status?.progress ? (
        <View style={styles.syncProgressTrack} accessibilityLabel={`Sync ${Math.round(syncProgressFraction * 100)} percent complete`}>
          <View style={[styles.syncProgressFill, { width: `${Math.max(1, syncProgressFraction * 100)}%` }]} />
        </View>
      ) : null}
      {loading && !initializing ? <Text style={styles.small}>Refreshing results...</Text> : null}
      {applicationsNotice ? <Text style={styles.inlineNotice}>{applicationsNotice}</Text> : null}

      {initializing && postings.length === 0 ? (
        <ActivityIndicator size="large" style={styles.loader} />
      ) : (
        <FlatList
          data={postings}
          keyExtractor={(item, index) => String(item?.job_posting_url || item?._row_fallback_key || `posting-${index}`)}
          renderItem={({ item }) => (
            <PostingCard
              item={item}
              onOpenDetails={handleOpenPostingDetails}
              onSetReviewState={handleSetPostingReviewState}
              onTrackApplication={handleTrackPostingApplication}
              onIgnorePosting={handleIgnorePosting}
              onBlockCompany={handleBlockCompany}
              savingApplicationIds={savingApplicationIds}
              ignoringPostingIds={ignoringPostingIds}
              blockedCompanyNames={blockedCompanyNames}
              blockingCompanyNames={blockingCompanyNamesSet}
              reviewingPostingIds={reviewingPostingIds}
              showDescriptions={showPostingDescriptions}
            />
          )}
          ListEmptyComponent={<Text style={styles.empty}>{loading ? "Loading postings..." : `No ${postingReviewQueue} postings found.`}</Text>}
          ListFooterComponent={postingsHasMore ? (
            <Pressable onPress={handleLoadMorePostings} disabled={postingsLoadingMore} style={styles.loadMoreButton}>
              <Text style={styles.loadMoreButtonText}>{postingsLoadingMore ? "Loading..." : "Load More"}</Text>
            </Pressable>
          ) : postings.length > 0 ? <Text style={styles.paginationEnd}>End of this review queue.</Text> : null}
          contentContainerStyle={styles.list}
        />
      )}

      <Modal
        visible={Boolean(selectedPosting)}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedPosting(null)}
      >
        <View style={styles.modalOverlay}>
          <Pressable style={styles.modalBackdrop} onPress={() => setSelectedPosting(null)} />
          <View style={styles.modalCard}>
            <View style={styles.modalHeaderRow}>
              <Text style={styles.modalTitle}>{sanitizeDisplayText(selectedPosting?.position_name, "Posting details")}</Text>
              <Pressable onPress={() => setSelectedPosting(null)} style={styles.modalCloseButton}>
                <Text style={styles.modalCloseButtonText}>Close</Text>
              </Pressable>
            </View>
            {postingDetailsLoading ? <ActivityIndicator style={styles.settingsLoader} /> : (
              <ScrollView style={styles.modalBodyScroll} contentContainerStyle={styles.modalBodyContent}>
                <Text style={styles.company}>{sanitizeDisplayText(selectedPosting?.company_name, "Unknown company")}</Text>
                <Text style={styles.location}>{sanitizeDisplayText(selectedPosting?.location, "Location unavailable")}</Text>
                <Text style={styles.postingFreshness}>{getPostingFreshnessLabel(selectedPosting)}</Text>
                <Text style={styles.reviewDetailNotice}>
                  {String(selectedPosting?.review_state || "unseen") === "unseen"
                    ? "This role is still New; marking it viewed did not complete."
                    : "Opening this detail marks an unseen role viewed."}
                </Text>
                {String(selectedPosting?.job_description || "").trim() ? (
                  <Text style={styles.postingDescription}>{String(selectedPosting.job_description)}</Text>
                ) : <Text style={styles.empty}>No description is stored for this posting.</Text>}
                <Pressable
                  onPress={() => Linking.openURL(String(selectedPosting?.job_posting_url || ""))}
                  style={styles.settingsSaveButton}
                >
                  <Text style={styles.settingsSaveButtonText}>Open Employer Posting</Text>
                </Pressable>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </>
  );

  const renderApplicationsPage = () => (
    <ScrollView contentContainerStyle={styles.settingsContent}>
      <View style={styles.settingsCard}>
        <Text style={styles.settingsTitle}>Applications</Text>
        <Text style={styles.settingsDescription}>
          Track jobs you applied to. Entries added from Postings are marked as manual applications.
        </Text>

        {/* Applications that were submitted but could not be recorded. This is the whole
            point of the error log: the failure used to exist only as a line in an agent
            reply, so submissions went untracked with nothing in the app to say so. Each
            entry carries what it needs to be re-entered by hand. */}
        {systemErrors.length > 0 ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorBannerTitle}>
              {systemErrors.length === 1
                ? "1 problem needs your attention"
                : `${systemErrors.length} problems need your attention`}
            </Text>
            {systemErrors.slice(0, 5).map((item) => {
              const context = item?.context && typeof item.context === "object" ? item.context : {};
              const subject = [context.company_name, context.position_name].filter(Boolean).join(" — ");
              return (
                <View key={item.id} style={styles.errorBannerRow}>
                  <Text style={styles.errorBannerText}>
                    {sanitizeDisplayText(item.message, "Something failed.")}
                  </Text>
                  {subject ? <Text style={styles.errorBannerMeta}>{subject}</Text> : null}
                  {context.job_posting_url ? (
                    <Text style={styles.errorBannerMeta}>{String(context.job_posting_url)}</Text>
                  ) : null}
                </View>
              );
            })}
            {systemErrors.length > 5 ? (
              <Text style={styles.errorBannerMeta}>{`and ${systemErrors.length - 5} more`}</Text>
            ) : null}
            <Pressable onPress={handleDismissSystemErrors} style={styles.errorBannerButton}>
              <Text style={styles.errorBannerButtonText}>Dismiss</Text>
            </Pressable>
          </View>
        ) : null}

        {applicationsNotice ? <Text style={styles.settingsNotice}>{applicationsNotice}</Text> : null}
        {applicationsLoading ? <ActivityIndicator size="small" style={styles.settingsLoader} /> : null}

        {!applicationsLoading && applications.length === 0 ? (
          <Text style={styles.empty}>No applications tracked yet.</Text>
        ) : null}

        {applications.map((application) => {
          const statusMenuOpen = openApplicationStatusForId === application.id;
          const fitMenuOpen = openApplicationFitForId === application.id;
          const isUpdatingStatus = Boolean(updatingApplicationIds[application.id]);
          const isUpdatingFit = Boolean(updatingApplicationFitIds[application.id]);
          const isDeleting = Boolean(deletingApplicationIds[application.id]);
          const appliedDate = formatApplicationDate(application?.application_date);
          const positionName = sanitizeDisplayText(application?.position_name, "Unknown position");
          const companyName = sanitizeDisplayText(application?.company_name, "Unknown company");
          const appliedByLabel = sanitizeDisplayText(application?.applied_by_label, "Manually applied by user");
          const statusLabel = sanitizeDisplayText(application?.status, "applied");
          const fitLabel = sanitizeDisplayText(application?.fit_assessment, "");

          return (
            <View key={application.id} style={styles.applicationCard}>
              <Text style={styles.position}>{positionName}</Text>
              <Text style={styles.company}>{companyName}</Text>
              <Text style={styles.posted}>Applied: {appliedDate}</Text>
              <Text style={styles.applicationAttribution}>{appliedByLabel}</Text>

              <View style={styles.applicationActionsRow}>
                <View style={styles.applicationStatusWrap}>
                  <Pressable
                    onPress={() => setOpenApplicationStatusForId((prev) => (prev === application.id ? null : application.id))}
                    disabled={isUpdatingStatus}
                    style={styles.applicationStatusBtn}
                  >
                    <Text style={styles.applicationStatusBtnText}>
                      {isUpdatingStatus ? "Updating..." : `Status: ${statusLabel}`}
                    </Text>
                  </Pressable>

                  {statusMenuOpen ? (
                    <View style={styles.applicationStatusMenu}>
                      {APPLICATION_STATUS_OPTIONS.map((status) => (
                        <Pressable
                          key={`${application.id}-${status}`}
                          onPress={() => handleUpdateApplicationStatus(application.id, status)}
                          style={[
                            styles.applicationStatusMenuItem,
                            application.status === status ? styles.applicationStatusMenuItemActive : null
                          ]}
                        >
                          <Text
                            style={[
                              styles.applicationStatusMenuItemText,
                              application.status === status ? styles.applicationStatusMenuItemTextActive : null
                            ]}
                          >
                            {status}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  ) : null}
                </View>

                <View style={styles.applicationStatusWrap}>
                  <Pressable
                    onPress={() => setOpenApplicationFitForId((prev) => (prev === application.id ? null : application.id))}
                    disabled={isUpdatingFit}
                    style={styles.applicationStatusBtn}
                  >
                    <Text style={styles.applicationStatusBtnText}>
                      {isUpdatingFit ? "Updating..." : `Fit: ${fitLabel || "not assessed"}`}
                    </Text>
                  </Pressable>

                  {fitMenuOpen ? (
                    <View style={styles.applicationStatusMenu}>
                      {APPLICATION_FIT_OPTIONS.map((fitOption) => (
                        <Pressable
                          key={`${application.id}-${fitOption}`}
                          onPress={() => handleUpdateApplicationFit(application.id, fitOption)}
                          style={[
                            styles.applicationStatusMenuItem,
                            application.fit_assessment === fitOption ? styles.applicationStatusMenuItemActive : null
                          ]}
                        >
                          <Text
                            style={[
                              styles.applicationStatusMenuItemText,
                              application.fit_assessment === fitOption ? styles.applicationStatusMenuItemTextActive : null
                            ]}
                          >
                            {fitOption}
                          </Text>
                        </Pressable>
                      ))}
                      <Pressable
                        key={`${application.id}-clear-fit`}
                        onPress={() => handleUpdateApplicationFit(application.id, "")}
                        style={styles.applicationStatusMenuItem}
                      >
                        <Text style={styles.applicationStatusMenuItemText}>Clear</Text>
                      </Pressable>
                    </View>
                  ) : null}
                </View>

                <Pressable
                  onPress={() => handleDeleteApplication(application.id)}
                  disabled={isDeleting}
                  style={[styles.applicationDeleteBtn, isDeleting ? styles.applicationDeleteBtnDisabled : null]}
                >
                  <Text style={styles.applicationDeleteBtnText}>{isDeleting ? "Deleting..." : "Delete"}</Text>
                </Pressable>
              </View>
            </View>
          );
        })}
      </View>
    </ScrollView>
  );

  const renderApplicationMetricsPage = () => {
    const total = Number(applicationStats?.total || 0);
    const denied = Number(applicationStats?.denied || 0);
    const denialRate = Number(applicationStats?.denial_rate || 0);
    const byStatus = applicationStats?.by_status || {};
    const other = Number(applicationStats?.other || 0);
    const byCompany = Array.isArray(applicationStats?.by_company) ? applicationStats.by_company : [];
    const deniedApplications = Array.isArray(applicationStats?.denied_applications)
      ? applicationStats.denied_applications
      : [];
    const timeToDenial = applicationStats?.time_to_denial || {};
    const timeToDenialSampleSize = Number(timeToDenial?.sample_size || 0);
    const byFit = Array.isArray(applicationStats?.by_fit) ? applicationStats.by_fit : [];
    const jobFitSummary = applicationStats?.job_fit_summary || {};
    const jobFitSampleSize =
      Number(jobFitSummary?.denied_sample_size || 0) + Number(jobFitSummary?.not_denied_sample_size || 0);

    const statusRows = APPLICATION_STATUS_OPTIONS.map((status) => {
      const count = Number(byStatus[status] || 0);
      const percent = total > 0 ? (count / total) * 100 : 0;
      return { status, count, percent };
    });
    if (other > 0) {
      statusRows.push({ status: "other (unrecognized status)", count: other, percent: total > 0 ? (other / total) * 100 : 0 });
    }

    return (
      <ScrollView contentContainerStyle={styles.settingsContent}>
        <View style={styles.settingsCard}>
          <Text style={styles.settingsTitle}>Application Metrics</Text>
          <Text style={styles.settingsDescription}>
            How your applications resolve, so patterns worth investigating (like a high denial
            rate) show up instead of staying buried in a flat list.
          </Text>

          {applicationStatsLoading ? <ActivityIndicator size="small" style={styles.settingsLoader} /> : null}

          {!applicationStatsLoading && total === 0 ? (
            <Text style={styles.empty}>No applications tracked yet.</Text>
          ) : null}

          {total > 0 ? (
            <>
              <View style={styles.performanceMetricGrid}>
                <PerformanceMetric label="Total applications" value={total.toLocaleString()} />
                <PerformanceMetric label="Denied" value={denied.toLocaleString()} hint={`${denialRate.toFixed(1)}% of total`} />
                <PerformanceMetric
                  label="Denial rate"
                  value={`${denialRate.toFixed(1)}%`}
                  tone={denialRate < 20 ? "good" : denialRate < 40 ? "warning" : "critical"}
                />
              </View>

              <View style={styles.performanceSection}>
                <Text style={styles.performanceSectionTitle}>Breakdown by status</Text>
                <View style={styles.performanceHotspotList}>
                  {statusRows.map((row) => (
                    <View key={row.status} style={styles.performanceHotspotRow}>
                      <Text style={styles.performanceHotspotName}>{row.status}</Text>
                      <Text style={styles.performanceHotspotStats}>
                        {`${row.count.toLocaleString()} (${row.percent.toFixed(1)}%)`}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>

              <View style={styles.performanceSection}>
                <View style={styles.performanceSectionTitleRow}>
                  <Text style={styles.performanceSectionTitle}>Time to denial</Text>
                  <Text style={styles.performanceSectionValue}>
                    {timeToDenialSampleSize > 0 ? `${timeToDenialSampleSize} timed` : "0 timed"}
                  </Text>
                </View>
                {timeToDenialSampleSize > 0 ? (
                  <View style={styles.performanceMetricGrid}>
                    <PerformanceMetric label="Average" value={formatDaysCompact(timeToDenial.average_days)} />
                    <PerformanceMetric label="Median" value={formatDaysCompact(timeToDenial.median_days)} />
                  </View>
                ) : (
                  <Text style={styles.performanceEmptyText}>
                    No denial has a timed transition yet. This fills in as applications you mark
                    denied going forward accumulate a real applied-to-denied timestamp --
                    denials that predate this dashboard have no recorded moment of denial to
                    measure from.
                  </Text>
                )}
              </View>

              <View style={styles.performanceSection}>
                <View style={styles.performanceSectionTitleRow}>
                  <Text style={styles.performanceSectionTitle}>Job description match</Text>
                  <Text style={styles.performanceSectionValue}>
                    {jobFitSampleSize > 0 ? `${jobFitSampleSize} scored` : "0 scored"}
                  </Text>
                </View>
                {jobFitSampleSize > 0 ? (
                  <>
                    <View style={styles.performanceMetricGrid}>
                      <PerformanceMetric
                        label="Denied applications"
                        value={
                          jobFitSummary.denied_avg_match_percent !== null
                            ? `${Number(jobFitSummary.denied_avg_match_percent).toFixed(0)}% match`
                            : "no data"
                        }
                        hint={`${jobFitSummary.denied_sample_size || 0} scored`}
                      />
                      <PerformanceMetric
                        label="Other applications"
                        value={
                          jobFitSummary.not_denied_avg_match_percent !== null
                            ? `${Number(jobFitSummary.not_denied_avg_match_percent).toFixed(0)}% match`
                            : "no data"
                        }
                        hint={`${jobFitSummary.not_denied_sample_size || 0} scored`}
                      />
                    </View>
                    <Text style={styles.performanceMetricHint}>
                      Match % is the share of a posting's stated requirements that show up
                      (by keyword) somewhere in your resume. A denied group scoring much
                      lower than the rest is a sign those postings were a stretch on paper,
                      not just an unlucky outcome.
                    </Text>
                  </>
                ) : (
                  <Text style={styles.performanceEmptyText}>
                    No application has both a linked posting with a stored description and an
                    uploaded resume to compare against yet.
                  </Text>
                )}
              </View>

              {byCompany.length > 0 ? (
                <View style={styles.performanceSection}>
                  <Text style={styles.performanceSectionTitle}>Denials by company</Text>
                  <View style={styles.performanceHotspotList}>
                    {byCompany.slice(0, 15).map((row) => (
                      <View key={row.company_name} style={styles.performanceHotspotRow}>
                        <Text style={styles.performanceHotspotName} numberOfLines={1}>
                          {row.company_name}
                        </Text>
                        <Text style={styles.performanceHotspotStats}>
                          {`${row.denied}/${row.total} denied (${Number(row.denial_rate || 0).toFixed(1)}%)`}
                        </Text>
                      </View>
                    ))}
                  </View>
                </View>
              ) : null}

              {byFit.length > 0 ? (
                <View style={styles.performanceSection}>
                  <Text style={styles.performanceSectionTitle}>Denials by fit assessment</Text>
                  <View style={styles.performanceHotspotList}>
                    {byFit.map((row) => (
                      <View key={row.fit_assessment} style={styles.performanceHotspotRow}>
                        <Text style={styles.performanceHotspotName} numberOfLines={1}>
                          {row.fit_assessment}
                        </Text>
                        <Text style={styles.performanceHotspotStats}>
                          {`${row.denied}/${row.total} denied (${Number(row.denial_rate || 0).toFixed(1)}%)`}
                        </Text>
                      </View>
                    ))}
                  </View>
                </View>
              ) : (
                <Text style={styles.performanceEmptyText}>
                  Tag applications as good fit / stretch / overqualified / underqualified from
                  the Applications page to see denial rate broken down by fit here.
                </Text>
              )}

              {deniedApplications.length > 0 ? (
                <View style={styles.performanceSection}>
                  <Text style={styles.performanceSectionTitle}>Denied applications</Text>
                  <View style={styles.performanceHotspotList}>
                    {deniedApplications.map((item) => {
                      const jobFit = item.job_fit || {};
                      const missingKeywords = Array.isArray(jobFit.unmatched_requirements)
                        ? jobFit.unmatched_requirements.slice(0, 2)
                        : [];
                      const hintParts = [`Applied ${formatApplicationDate(item.application_date)}`];
                      if (item.fit_assessment) hintParts.push(sanitizeDisplayText(item.fit_assessment, ""));
                      if (jobFit.match_percent !== null && jobFit.match_percent !== undefined) {
                        hintParts.push(`${Number(jobFit.match_percent).toFixed(0)}% JD match`);
                      }
                      return (
                        <View key={item.id} style={styles.performanceHotspotRow}>
                          <View style={styles.performanceWorkerInfo}>
                            <Text style={styles.performanceHotspotName} numberOfLines={1}>
                              {`${sanitizeDisplayText(item.position_name, "Unknown position")} — ${sanitizeDisplayText(item.company_name, "Unknown company")}`}
                            </Text>
                            <Text style={styles.performanceMetricHint}>{hintParts.join(" · ")}</Text>
                            {missingKeywords.length > 0 ? (
                              <Text style={styles.performanceMetricHint} numberOfLines={1}>
                                {`Unmet: ${missingKeywords.join(" / ")}`}
                              </Text>
                            ) : null}
                          </View>
                          <Text style={styles.performanceHotspotStats}>
                            {item.days_to_denial !== null && item.days_to_denial !== undefined
                              ? formatDaysCompact(item.days_to_denial)
                              : "time unknown"}
                          </Text>
                        </View>
                      );
                    })}
                  </View>
                </View>
              ) : null}
            </>
          ) : null}
        </View>
      </ScrollView>
    );
  };

  const renderApplicanteeSettingsPage = () => (
    <ScrollView contentContainerStyle={styles.settingsContent}>
      <View style={styles.settingsCard}>
        <Text style={styles.settingsTitle}>Settings</Text>
        <Text style={styles.settingsSubsection}>Applicantee information</Text>
        <Text style={styles.settingsDescription}>
          Fill out your personal information so it can be reused for applications.
        </Text>

        {settingsLoading ? (
          <ActivityIndicator size="small" style={styles.settingsLoader} />
        ) : (
          <>
            {PERSONAL_INFORMATION_FIELDS.map((field) => (
              <View key={field.key} style={styles.formGroup}>
                <Text style={styles.fieldLabel}>{field.label}</Text>
                <TextInput
                  style={[styles.textField, field.multiline ? styles.textFieldMultiline : null]}
                  value={personalInformation[field.key]}
                  onChangeText={(value) => handleChangePersonalInformation(field.key, value)}
                  placeholder={field.placeholder}
                  autoCapitalize={field.autoCapitalize || "none"}
                  keyboardType={field.keyboardType || "default"}
                  multiline={Boolean(field.multiline)}
                  numberOfLines={field.multiline ? 3 : 1}
                />
              </View>
            ))}

            <View style={styles.formGroup}>
              <Text style={styles.settingsSubsection}>Documents on server</Text>
              <Text style={styles.settingsDescription}>
                Upload your resume once and the application copilot can read it no matter where the server runs.
                The file paths above stay as a fallback for installs where the server runs on this same machine.
              </Text>

              {[
                { kind: "resume", label: "Resume" },
                { kind: "projects_portfolio", label: "Projects Portfolio" }
              ].map(({ kind, label }) => {
                const stored = applicantDocuments.find((item) => (item?.key || item?.kind) === kind);
                const isUploadingThis = documentUploading === kind;
                return (
                  <View key={kind} style={styles.documentRow}>
                    <View style={styles.documentRowInfo}>
                      <Text style={styles.fieldLabel}>{label}</Text>
                      <Text style={styles.documentRowMeta}>
                        {stored
                          ? `${stored.file_name} — ${stored.format}, ${Number(stored.chars || 0).toLocaleString()} characters, uploaded ${stored.uploaded_at}`
                          : "Not uploaded yet"}
                      </Text>
                    </View>
                    <Pressable
                      onPress={() => handleUploadApplicantDocument(kind)}
                      disabled={Boolean(documentUploading)}
                      style={[styles.documentUploadBtn, documentUploading ? styles.settingsSaveButtonDisabled : null]}
                    >
                      <Text style={styles.settingsSaveButtonText}>
                        {isUploadingThis ? "Uploading..." : stored ? "Replace" : "Upload"}
                      </Text>
                    </Pressable>
                  </View>
                );
              })}

              {documentNotice ? <Text style={styles.settingsNotice}>{documentNotice}</Text> : null}
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.settingsSubsection}>Application questions</Text>
              <Text style={styles.settingsDescription}>
                The questions application forms ask over and over. Anything left blank is treated as unanswered:
                the application copilot will ask you rather than guessing, because a made-up answer gets submitted
                under your name. Use Notes for context you want considered but not pasted into a form.
              </Text>

              {applicationAnswersLoading ? (
                <ActivityIndicator size="small" style={styles.settingsLoader} />
              ) : applicationAnswersError ? (
                <View>
                  <Text style={styles.error}>{applicationAnswersError}</Text>
                  <Pressable onPress={() => loadPersonalInformation({ silent: true })} style={styles.settingsSecondaryButton}>
                    <Text style={styles.settingsSecondaryButtonText}>Retry Loading Questions</Text>
                  </Pressable>
                </View>
              ) : applicationAnswersLoaded && applicationAnswers.length === 0 ? (
                <Text style={styles.documentRowMeta}>
                  No application questions are configured.
                </Text>
              ) : applicationAnswers.length > 0 ? (
                <>
                  <Text style={styles.documentRowMeta}>
                    {`${applicationAnswers.filter((item) => String(item?.value || "").trim()).length} of ${applicationAnswers.length} answered`}
                  </Text>

                  {APPLICATION_ANSWER_CATEGORY_ORDER.filter((category) =>
                    applicationAnswers.some((item) => item.category === category)
                  ).map((category) => (
                    <View key={category}>
                      <Text style={styles.fieldLabel}>
                        {APPLICATION_ANSWER_CATEGORY_LABELS[category] || category}
                      </Text>
                      {applicationAnswers
                        .filter((item) => item.category === category)
                        .map((item) => {
                          const isAnswered = Boolean(String(item?.value || "").trim());
                          return (
                            <View key={item.key} style={styles.formGroup}>
                              <Text style={styles.documentRowMeta}>
                                {isAnswered ? item.label : `${item.label} — unanswered`}
                              </Text>
                              <TextInput
                                style={styles.textField}
                                value={item.value}
                                onChangeText={(value) => handleChangeApplicationAnswer(item.key, "value", value)}
                                placeholder="Leave blank to be asked"
                                autoCapitalize="sentences"
                              />
                              <TextInput
                                style={[styles.textField, styles.textFieldMultiline]}
                                value={item.notes}
                                onChangeText={(value) => handleChangeApplicationAnswer(item.key, "notes", value)}
                                placeholder="Notes (optional) — context, not form text"
                                autoCapitalize="sentences"
                                multiline
                                numberOfLines={2}
                              />
                            </View>
                          );
                        })}
                    </View>
                  ))}

                  {answersNotice ? <Text style={styles.settingsNotice}>{answersNotice}</Text> : null}

                  <Pressable
                    onPress={handleSaveApplicationAnswers}
                    disabled={answersSaving}
                    style={[styles.settingsSaveButton, answersSaving ? styles.settingsSaveButtonDisabled : null]}
                  >
                    <Text style={styles.settingsSaveButtonText}>
                      {answersSaving ? "Saving..." : "Save Application Questions"}
                    </Text>
                  </Pressable>
                </>
              ) : null}
            </View>

            {settingsNotice ? <Text style={styles.settingsNotice}>{settingsNotice}</Text> : null}

            <Pressable
              onPress={handleSaveApplicanteeInformation}
              disabled={settingsSaving}
              style={[styles.settingsSaveButton, settingsSaving ? styles.settingsSaveButtonDisabled : null]}
            >
              <Text style={styles.settingsSaveButtonText}>
                {settingsSaving ? "Saving..." : "Save Applicantee Information"}
              </Text>
            </Pressable>
          </>
        )}
      </View>
    </ScrollView>
  );

  const renderSyncAreaPage = () => (
    <ScrollView contentContainerStyle={styles.settingsContent}>
      <View style={styles.settingsCard}>
        <Text style={styles.settingsTitle}>
          {effectiveActivePage === PAGE_KEYS.SCRAPER_PERFORMANCE ? "Scraper Performance" : "Settings"}
        </Text>
        <Text style={styles.settingsSubsection}>
          {effectiveActivePage === PAGE_KEYS.SCRAPER_PERFORMANCE ? "Live operations" : "Sync Settings"}
        </Text>
        <Text style={styles.settingsDescription}>
          {effectiveActivePage === PAGE_KEYS.SCRAPER_PERFORMANCE
            ? "Monitor scraper throughput, worker activity, request health, memory, writes, and coverage without crowding the postings feed."
            : "Configure automatic posting sync timing. Wi-Fi-only gating applies only on Android."}
        </Text>

        {effectiveActivePage === PAGE_KEYS.SETTINGS_SYNC && codeStatus?.restart_supported && codeStatus.restart_required ? (
          <View style={styles.updateFlag}>
            <Text style={styles.updateFlagText}>
              {`Update pending — ${codeStatus.changed_files.length} file(s) changed since the server started. Apply it under "Server code" below.`}
            </Text>
          </View>
        ) : null}

        <View
          style={[
            styles.performanceDashboard,
            effectiveActivePage !== PAGE_KEYS.SCRAPER_PERFORMANCE ? styles.performanceDashboardHidden : null
          ]}
        >
          <View style={styles.performanceDashboardHeader}>
            <View style={styles.performanceDashboardHeading}>
              <Text style={styles.performanceDashboardTitle}>Live telemetry</Text>
              <Text style={styles.performanceDashboardSubtitle}>
                Live service telemetry. Rate history is sampled every 15 seconds for the current pass.
              </Text>
            </View>
            <View
              style={[
                styles.performanceHealthBadge,
                scraperDashboard.health.tone === "good"
                  ? styles.performanceHealthGood
                  : scraperDashboard.health.tone === "warning"
                    ? styles.performanceHealthWarning
                    : scraperDashboard.health.tone === "critical"
                      ? styles.performanceHealthCritical
                      : styles.performanceHealthNeutral
              ]}
            >
              <Text style={styles.performanceHealthText}>{scraperDashboard.health.label}</Text>
            </View>
          </View>

          {scraperDashboard.healthWarnings.length > 0 ? (
            <View style={styles.performanceWarningBanner}>
              {scraperDashboard.healthWarnings.map((warning) => (
                <Text key={warning.key} style={styles.performanceWarningText}>
                  {warning.message}
                </Text>
              ))}
            </View>
          ) : null}

          <View style={styles.performanceMetricGrid}>
            <PerformanceMetric
              label="Throughput"
              value={`${scraperDashboard.rate.toFixed(1)}/min`}
              hint={
                syncPerformanceHistory.length > 1
                  ? `${scraperDashboard.rateDelta >= 0 ? "+" : ""}${scraperDashboard.rateDelta.toFixed(1)} since pass sample`
                  : "Waiting for trend"
              }
              tone={scraperDashboard.rate >= 80 ? "good" : scraperDashboard.rate >= 40 ? "warning" : "critical"}
            />
            <PerformanceMetric
              label="ETA"
              value={status?.running ? formatDurationCompact(scraperDashboard.progress.eta_seconds) : "Idle"}
              hint={`${Number(scraperDashboard.progress.current || 0).toLocaleString()} of ${Number(scraperDashboard.progress.total || 0).toLocaleString()} targets`}
            />
            <PerformanceMetric
              label="Last progress"
              value={`${formatDurationCompact(scraperDashboard.progressAge)} ago`}
              hint={`Pass age ${formatDurationCompact(scraperDashboard.elapsedSeconds)}`}
              tone={scraperDashboard.progressAge < 60 ? "good" : scraperDashboard.progressAge < 180 ? "warning" : "critical"}
            />
            <PerformanceMetric
              label="Last write"
              value={`${formatDurationCompact(scraperDashboard.writeAge)} ago`}
              hint={`${Number(status?.postings_stored || 0).toLocaleString()} rows written this pass`}
              tone={scraperDashboard.writeAge < 120 ? "good" : scraperDashboard.writeAge < 600 ? "warning" : "critical"}
            />
            <PerformanceMetric
              label="Memory"
              value={`${Number(scraperDashboard.memory.rss_mb || 0).toLocaleString()} MB`}
              hint={`${Number(scraperDashboard.memory.heap_used_mb || 0).toLocaleString()} MB JS heap`}
              tone={
                Number(scraperDashboard.memory.rss_mb || 0) < 1536
                  ? "good"
                  : Number(scraperDashboard.memory.rss_mb || 0) < 3584
                    ? "warning"
                    : "critical"
              }
            />
            <PerformanceMetric
              label="WAL size"
              value={`${scraperDashboard.walSizeMb.toLocaleString()} MB`}
              hint="Reclaimed by the periodic checkpoint"
              tone={scraperDashboard.walSizeMb < 128 ? "good" : scraperDashboard.walSizeMb < 256 ? "warning" : "critical"}
            />
            {scraperDashboard.hostMemory ? (
              <PerformanceMetric
                label="Host swap"
                value={`${Number(scraperDashboard.hostMemory.swap_used_mb || 0).toLocaleString()} MB`}
                hint={`of ${Number(scraperDashboard.hostMemory.swap_total_mb || 0).toLocaleString()} MB total`}
                tone={(() => {
                  // Percentage of swap_total, matching the backend's watch threshold (see
                  // SWAP_USED_WARNING_PERCENT) -- a fixed MB cutoff here would show red at
                  // the same absolute usage regardless of how much swap is actually
                  // configured, so this tile and the "Needs attention" banner would disagree
                  // the moment swap capacity changed.
                  const total = Number(scraperDashboard.hostMemory.swap_total_mb || 0);
                  if (total <= 0) return "good";
                  const percent = (Number(scraperDashboard.hostMemory.swap_used_mb || 0) / total) * 100;
                  return percent < 50 ? "good" : percent < 80 ? "warning" : "critical";
                })()}
              />
            ) : null}
            <PerformanceMetric
              label="Request queue"
              value={`${Number(scraperDashboard.queue.active || 0)} active / ${Number(scraperDashboard.queue.queued || 0)} queued`}
              hint={`${Number(scraperDashboard.queue.cooldown_keys || 0)} ATS cooling down`}
              tone={Number(scraperDashboard.queue.queued || 0) === 0 ? "good" : "warning"}
            />
            <PerformanceMetric
              label="24h coverage"
              value={`${scraperDashboard.coveragePercent.toFixed(1)}%`}
              hint={`${scraperDashboard.coverageSynced.toLocaleString()} of ${scraperDashboard.coverageEnabled.toLocaleString()} companies`}
              tone={scraperDashboard.coveragePercent >= 99 ? "good" : scraperDashboard.coveragePercent >= 90 ? "warning" : "critical"}
            />
            <PerformanceMetric
              label="Transport issues"
              value={scraperDashboard.issueCount.toLocaleString()}
              hint={`${Number(scraperDashboard.queue.timeouts || 0)} timeout, ${Number(scraperDashboard.queue.aborted || 0)} aborted, ${Number(scraperDashboard.queue.failures || 0)} failed`}
              tone={scraperDashboard.issueCount === 0 ? "good" : "warning"}
            />
          </View>

          <View style={styles.performanceSection}>
            <View style={styles.performanceSectionTitleRow}>
              <Text style={styles.performanceSectionTitle}>Pass progress</Text>
              <Text style={styles.performanceSectionValue}>
                {`${Number(scraperDashboard.progress.percent || 0).toFixed(1)}%`}
              </Text>
            </View>
            <View style={styles.performanceProgressTrack}>
              <View
                style={[
                  styles.performanceProgressFill,
                  { width: `${Math.max(0.5, Math.min(100, Number(scraperDashboard.progress.percent || 0)))}%` }
                ]}
              />
            </View>
            <Text style={styles.performanceMetricHint}>
              {`${Number(status?.new_postings || 0).toLocaleString()} new, ${Number(status?.refreshed_postings || 0).toLocaleString()} refreshed, ${Number(scraperDashboard.progress.total_collected || 0).toLocaleString()} collected`}
            </Text>
          </View>

          <View style={styles.performanceSection}>
            <View style={styles.performanceSectionTitleRow}>
              <Text style={styles.performanceSectionTitle}>Throughput trend</Text>
              <Text style={styles.performanceSectionValue}>{`${syncPerformanceHistory.length} samples`}</Text>
            </View>
            <RateSparkline samples={syncPerformanceHistory} />
          </View>

          <View style={styles.performanceSplitRow}>
            <View style={styles.performanceDetailPanel}>
              <Text style={styles.performanceSectionTitle}>
                {`Active workers (${scraperDashboard.activeTargets.length}/${Number(status?.worker_concurrency || 0)})`}
              </Text>
              {scraperDashboard.activeTargets.length > 0 ? (
                scraperDashboard.activeTargets.map((target) => (
                  <View key={`worker-${target.worker}`} style={styles.performanceWorkerRow}>
                    <Text style={styles.performanceWorkerNumber}>{`W${target.worker}`}</Text>
                    <View style={styles.performanceWorkerInfo}>
                      <Text style={styles.performanceWorkerCompany} numberOfLines={1}>
                        {sanitizeDisplayText(target.company_name, "Unknown target")}
                      </Text>
                      <Text style={styles.performanceMetricHint}>
                        {`${sanitizeDisplayText(target.ats_name, "unknown")} · ${formatDurationCompact(target.age_seconds)}`}
                      </Text>
                    </View>
                  </View>
                ))
              ) : (
                <Text style={styles.performanceEmptyText}>{status?.running ? "Workers are starting…" : "No active sync."}</Text>
              )}
            </View>

            <View style={styles.performanceDetailPanel}>
              <Text style={styles.performanceSectionTitle}>Request health</Text>
              <Text style={styles.performanceDetailText}>
                {`${Number(scraperDashboard.queue.responses_completed || 0).toLocaleString()} responses / ${Number(scraperDashboard.queue.requests_started || 0).toLocaleString()} requests`}
              </Text>
              <Text style={styles.performanceDetailText}>
                {`${Number(scraperDashboard.queue.http_errors || 0)} HTTP errors · ${Number(scraperDashboard.queue.failures || 0)} network/body failures`}
              </Text>
              <Text style={styles.performanceDetailText}>
                {`${Number(status?.target_timeouts || 0)} target timeouts · ${Number(status?.stall_recoveries || 0)} watchdog recoveries`}
              </Text>
              <Text style={styles.performanceDetailText}>
                {`${Number(status?.flush_failures || 0)} write failures · service up ${formatDurationCompact(status?.service_uptime_seconds)}`}
              </Text>
            </View>
          </View>

          {scraperDashboard.queueHotspots.length > 0 ? (
            <View style={styles.performanceSection}>
              <Text style={styles.performanceSectionTitle}>ATS queue hot spots</Text>
              <View style={styles.performanceHotspotList}>
                {scraperDashboard.queueHotspots.slice(0, 8).map((item) => (
                  <View key={`queue-${item.key}`} style={styles.performanceHotspotRow}>
                    <Text style={styles.performanceHotspotName}>{sanitizeDisplayText(item.key, "unknown")}</Text>
                    <Text style={styles.performanceHotspotStats}>
                      {`${Number(item.active || 0)} active · ${Number(item.queued || 0)} queued · ${Number(item.timeouts || 0)} timeout · ${Number(item.aborted || 0)} aborted · ${Number(item.rate_limited || 0)} 429`}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          ) : null}

          {status?.last_error ? (
            <View style={styles.performanceAlert}>
              <Text style={styles.performanceAlertTitle}>Latest sync issue</Text>
              <Text style={styles.performanceAlertText}>{sanitizeDisplayText(status.last_error, "Unknown sync error")}</Text>
            </View>
          ) : null}
        </View>

        <View style={effectiveActivePage !== PAGE_KEYS.SETTINGS_SYNC ? styles.performanceDashboardHidden : null}>
        {failedCompaniesByAtsList.length > 0 ? (
          <View style={styles.formGroup}>
            <Text style={styles.fieldLabel}>Failed companies by ATS (last sync)</Text>
            {failedCompaniesByAtsList.map((item) => (
              <Text key={item.atsName} style={styles.settingsInlineHint}>
                {item.atsName}: {item.count}
              </Text>
            ))}
          </View>
        ) : null}

        <View style={styles.formGroup}>
          <ToggleRow
            label="Enable automatic sync"
            value={syncSettings.autoSyncEnabled}
            onValueChange={(value) =>
              setSyncSettings((prev) => ({
                ...prev,
                autoSyncEnabled: value
              }))
            }
          />
          <ToggleRow
            label="Only sync on Wi-Fi (Android only)"
            value={syncSettings.wifiOnly}
            onValueChange={(value) =>
              setSyncSettings((prev) => ({
                ...prev,
                wifiOnly: value
              }))
            }
          />
        </View>

        <View style={styles.formGroup}>
          <Text style={styles.fieldLabel}>Sync interval (seconds)</Text>
          <TextInput
            style={styles.textField}
            value={syncSettings.syncIntervalSeconds}
            onChangeText={(value) =>
              setSyncSettings((prev) => ({
                ...prev,
                syncIntervalSeconds: value.replace(/[^0-9]/g, "")
              }))
            }
            keyboardType="numeric"
            placeholder={String(DEFAULT_SYNC_INTERVAL_SECONDS)}
          />
          <Text style={styles.settingsInlineHint}>
            Default: {DEFAULT_SYNC_INTERVAL_SECONDS} ({formatSyncIntervalLabel(DEFAULT_SYNC_INTERVAL_SECONDS)}). Minimum:{" "}
            {MIN_SYNC_INTERVAL_SECONDS} seconds.
          </Text>
          {Platform.OS !== "android" ? (
            <Text style={styles.settingsInlineHint}>Wi-Fi-only sync is inactive on web and Windows.</Text>
          ) : null}
        </View>

        <View style={styles.formGroup}>
          <Text style={styles.fieldLabel}>ATS request queue concurrency</Text>
          <TextInput
            style={styles.textField}
            value={syncServiceSettings.ats_request_queue_concurrency}
            onChangeText={(value) =>
              setSyncServiceSettings((prev) => ({
                ...prev,
                ats_request_queue_concurrency: value.replace(/[^0-9]/g, "")
              }))
            }
            keyboardType="numeric"
            placeholder={String(DEFAULT_ATS_REQUEST_QUEUE_CONCURRENCY)}
          />
          {syncServiceSettingsLoading ? <ActivityIndicator size="small" style={styles.settingsLoader} /> : null}
          <Text style={styles.settingsInlineHint}>
            Range: {syncServiceSettings.min_ats_request_queue_concurrency} to{" "}
            {syncServiceSettings.max_ats_request_queue_concurrency}. Higher values can increase throughput but may cause
            more 429 responses.
          </Text>
          <Text style={styles.settingsInlineHint}>
            Runtime is currently using {syncServiceSettings.active_ats_request_queue_concurrency}. This will take effect
            next time you stop and restart the sync service.
          </Text>
        </View>

        <View style={styles.formGroup}>
          <Text style={styles.fieldLabel}>Posting freshness window (hours)</Text>
          <TextInput
            style={styles.textField}
            value={syncServiceSettings.posting_freshness_hours}
            onChangeText={(value) =>
              setSyncServiceSettings((prev) => ({
                ...prev,
                posting_freshness_hours: value.replace(/[^0-9]/g, "")
              }))
            }
            keyboardType="numeric"
            placeholder={String(DEFAULT_POSTING_FRESHNESS_HOURS)}
          />
          <Text style={styles.settingsInlineHint}>
            Range: {syncServiceSettings.min_posting_freshness_hours} to {syncServiceSettings.max_posting_freshness_hours} hours.
          </Text>
          <Text style={styles.settingsInlineHint}>
            Runtime is currently using {syncServiceSettings.active_posting_freshness_hours} hours. This applies immediately after saving.
          </Text>
        </View>

        <View style={styles.formGroup}>
          <Text style={styles.fieldLabel}>ATS included in sync</Text>
          <Text style={styles.settingsInlineHint}>
            Only selected ATS are synced. Excluded ATS stay visible in filters but are greyed out.
          </Text>
          <View style={styles.settingsInlineActionsRow}>
            <Pressable
              onPress={() =>
                setSyncServiceSettings((prev) => ({
                  ...prev,
                  sync_enabled_ats: DEFAULT_ATS_FILTER_OPTIONS.map((option) => option.value)
                }))
              }
              style={styles.settingsInlineActionBtn}
            >
              <Text style={styles.settingsInlineActionBtnText}>Enable All</Text>
            </Pressable>
          </View>
          <View style={styles.settingsCheckboxList}>
            {syncAtsOptions.map((option) => {
              const checked = (syncServiceSettings.sync_enabled_ats || []).includes(option.value);
              return (
                <Pressable
                  key={`sync-ats-${option.value}`}
                  onPress={() =>
                    setSyncServiceSettings((prev) => {
                      const current = normalizeSyncEnabledAts(prev.sync_enabled_ats);
                      if (current.includes(option.value)) {
                        if (current.length <= 1) return prev;
                        return {
                          ...prev,
                          sync_enabled_ats: current.filter((item) => item !== option.value)
                        };
                      }
                      return {
                        ...prev,
                        sync_enabled_ats: normalizeSyncEnabledAts([...current, option.value])
                      };
                    })
                  }
                  style={styles.settingsCheckboxRow}
                >
                  <Text style={styles.settingsCheckboxIcon}>{checked ? "☑" : "☐"}</Text>
                  <Text style={styles.settingsCheckboxLabel}>{option.label}</Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.settingsInlineHint}>
            {syncServiceSettings.sync_enabled_ats.length} ATS currently enabled for sync.
          </Text>
        </View>

        <View style={styles.formGroup}>
          <Text style={styles.fieldLabel}>Blocked companies</Text>
          <Text style={styles.settingsInlineHint}>
            Blocked companies are hidden from Postings and excluded from sync collection.
          </Text>
          {blockedCompaniesLoading ? <ActivityIndicator size="small" style={styles.settingsLoader} /> : null}
          {!blockedCompaniesLoading && blockedCompanies.length === 0 ? (
            <Text style={styles.settingsInlineHint}>No blocked companies.</Text>
          ) : null}
          {blockedCompanies.map((company) => {
            const companyName = String(company?.company_name || company?.normalized_company_name || "").trim();
            const normalizedCompanyName = normalizeCompanyName(companyName);
            const isUnblocking = Boolean(unblockingCompanyNames[normalizedCompanyName]);
            return (
              <View key={`blocked-${normalizedCompanyName}`} style={styles.blockedCompanyRow}>
                <Text style={styles.blockedCompanyName}>{companyName || "Unknown company"}</Text>
                <Pressable
                  onPress={() => handleUnblockCompany(companyName)}
                  disabled={isUnblocking}
                  style={[styles.blockedCompanyUnblockBtn, isUnblocking ? styles.blockedCompanyUnblockBtnDisabled : null]}
                >
                  <Text style={styles.blockedCompanyUnblockBtnText}>{isUnblocking ? "Unblocking..." : "Unblock"}</Text>
                </Pressable>
              </View>
            );
          })}
        </View>

        <View style={styles.formGroup}>
          <Text style={styles.fieldLabel}>Migration tools</Text>
          <Text style={styles.settingsInlineHint}>
            Migration is intentionally separated into a modal to avoid accidental taps while saving sync settings.
          </Text>
          <Pressable
            onPress={handleExportSettings}
            disabled={exportSettingsRunning}
            style={[styles.settingsSecondaryButton, exportSettingsRunning ? styles.settingsSaveButtonDisabled : null]}
          >
            <Text style={styles.settingsSecondaryButtonText}>
              {exportSettingsRunning ? "Exporting..." : "Export Current Settings"}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setMigrationModalOpen(true)}
            style={styles.settingsSecondaryButton}
          >
            <Text style={styles.settingsSecondaryButtonText}>Open Migration Tools</Text>
          </Pressable>
        </View>

        {syncSettingsNotice ? <Text style={styles.settingsNotice}>{syncSettingsNotice}</Text> : null}

        <Pressable
          onPress={handleSaveSyncSettings}
          disabled={syncServiceSettingsSaving}
          style={[styles.settingsSaveButton, syncServiceSettingsSaving ? styles.settingsSaveButtonDisabled : null]}
        >
          <Text style={styles.settingsSaveButtonText}>{syncServiceSettingsSaving ? "Saving..." : "Save Sync Settings"}</Text>
        </Pressable>

        {codeStatus?.restart_supported ? (
          <View style={styles.formGroup}>
            <Text style={styles.settingsSubsection}>Server code</Text>
            <Text style={styles.settingsInlineHint}>
              {codeStatus.restart_required
                ? `${codeStatus.changed_files.length} file(s) changed since the server started. Restart to apply them.`
                : "The server is running the latest code on disk."}
            </Text>
            {codeStatus.restart_required && codeStatus.changed_files.length > 0 ? (
              <Text style={styles.settingsInlineHint}>{codeStatus.changed_files.join(", ")}</Text>
            ) : null}
            <Pressable
              onPress={handleRestartServer}
              disabled={restartingServer}
              style={[styles.settingsSaveButton, restartingServer ? styles.settingsSaveButtonDisabled : null]}
            >
              <Text style={styles.settingsSaveButtonText}>
                {restartingServer
                  ? "Restarting..."
                  : restartConfirmArmed
                    ? "Confirm restart (aborts sync)"
                    : codeStatus.restart_required
                      ? "Apply code changes & restart"
                      : "Restart server"}
              </Text>
            </Pressable>
            {restartNotice ? <Text style={styles.settingsInlineHint}>{restartNotice}</Text> : null}
          </View>
        ) : null}
        </View>
      </View>

      <Modal
        animationType="fade"
        transparent
        visible={effectiveActivePage === PAGE_KEYS.SETTINGS_SYNC && migrationModalOpen}
        onRequestClose={() => {
          if (migrationRunning) return;
          setMigrationModalOpen(false);
        }}
      >
        <View style={styles.modalOverlay}>
          <Pressable
            style={styles.modalBackdrop}
            onPress={() => {
              if (migrationRunning) return;
              setMigrationModalOpen(false);
            }}
          />
          <View style={styles.modalCard}>
            <View style={styles.modalHeaderRow}>
              <Text style={styles.modalTitle}>Migrate Settings And Applications</Text>
              <Pressable
                onPress={() => setMigrationModalOpen(false)}
                disabled={migrationRunning}
                style={[styles.modalCloseButton, migrationRunning ? styles.settingsSaveButtonDisabled : null]}
              >
                <Text style={styles.modalCloseButtonText}>Close</Text>
              </Pressable>
            </View>
            <Text style={styles.settingsInlineHint}>
              Imports selected data from another SQLite database file. The Companies table is never modified.
            </Text>

            <ScrollView
              style={styles.modalBodyScroll}
              contentContainerStyle={styles.modalBodyContent}
              keyboardShouldPersistTaps="handled"
            >
              <View style={styles.settingsCheckboxList}>
                {[
                  { key: "personal_information", label: "Personal Information" },
                  { key: "mcp_settings", label: "AI/MCP Settings" },
                  { key: "blocked_companies", label: "Blocked Companies" },
                  {
                    key: "applications",
                    label: "Applications (includes application_attribution and posting_application_state)"
                  }
                ]
                  .filter((option) => !IS_ANDROID || option.key !== "mcp_settings")
                  .map((option) => {
                  const checked = Boolean(migrationSelection[option.key]);
                  return (
                    <Pressable
                      key={`migration-${option.key}`}
                      onPress={() =>
                        setMigrationSelection((prev) => ({
                          ...prev,
                          [option.key]: !checked
                        }))
                      }
                      style={styles.settingsCheckboxRow}
                    >
                      <Text style={styles.settingsCheckboxIcon}>{checked ? "☑" : "☐"}</Text>
                      <Text style={styles.settingsCheckboxLabel}>{option.label}</Text>
                    </Pressable>
                  );
                })}
              </View>

              <TextInput
                style={styles.textField}
                value={migrationSourceDbPath}
                onChangeText={setMigrationSourceDbPath}
                placeholder="C:\\path\\to\\jobs.db"
                autoCapitalize="none"
                autoCorrect={false}
              />

              {migrationNotice ? <Text style={styles.settingsNotice}>{migrationNotice}</Text> : null}

              <Pressable
                onPress={handleMigrateFromDatabase}
                disabled={migrationRunning}
                style={[styles.settingsSaveButton, migrationRunning ? styles.settingsSaveButtonDisabled : null]}
              >
                <Text style={styles.settingsSaveButtonText}>
                  {migrationRunning ? "Migrating..." : "Migrate From Database"}
                </Text>
              </Pressable>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );

  const renderMcpSettingsPage = () => (
    <ScrollView contentContainerStyle={styles.settingsContent}>
      <View style={styles.settingsCard}>
        <Text style={styles.settingsTitle}>Settings</Text>
        <Text style={styles.settingsSubsection}>MCP Settings</Text>
        <Text style={styles.settingsDescription}>
          Configure the application copilot's screening and preparation preferences. It does not store login credentials or submit through a browser by itself.
        </Text>

        {mcpSettingsLoading ? <ActivityIndicator size="small" style={styles.settingsLoader} /> : null}

        <View style={styles.formGroup}>
          <ToggleRow
            label="Enable MCP application copilot"
            value={mcpSettings.enabled}
            onValueChange={(value) =>
              setMcpSettings((prev) => ({
                ...prev,
                enabled: value
              }))
            }
          />
          <ToggleRow
            label="Dry run only (do not submit)"
            value={mcpSettings.dry_run_only}
            onValueChange={(value) =>
              setMcpSettings((prev) => ({
                ...prev,
                dry_run_only: value
              }))
            }
          />
          <ToggleRow
            label="Require final user approval"
            value={mcpSettings.require_final_approval}
            onValueChange={(value) =>
              setMcpSettings((prev) => ({
                ...prev,
                require_final_approval: value
              }))
            }
          />
        </View>

        <View style={styles.formGroup}>
          <Text style={styles.fieldLabel}>Preferred agent label</Text>
          <TextInput
            style={styles.textField}
            value={mcpSettings.preferred_agent_name}
            onChangeText={(value) =>
              setMcpSettings((prev) => ({
                ...prev,
                preferred_agent_name: value
              }))
            }
            placeholder="Codex, Claude, or OpenPostings Agent"
          />
        </View>

        {/* The agent login email and password fields that used to sit here are gone. The
            agent prepares applications and stops at the authentication boundary; it does
            not create accounts or sign in as you, so there is no credential for it to
            hold. */}

        <View style={styles.formGroup}>
          <Text style={styles.fieldLabel}>MFA/login notes</Text>
          <TextInput
            style={[styles.textField, styles.textFieldMultiline]}
            value={mcpSettings.mfa_login_notes}
            onChangeText={(value) =>
              setMcpSettings((prev) => ({
                ...prev,
                mfa_login_notes: value
              }))
            }
            multiline
            numberOfLines={3}
            placeholder="Example: use auth app first, fallback to backup email"
          />
        </View>

        <View style={styles.formGroup}>
          <Text style={styles.fieldLabel}>Max applications per run</Text>
          <TextInput
            style={styles.textField}
            value={mcpSettings.max_applications_per_run}
            onChangeText={(value) =>
              setMcpSettings((prev) => ({
                ...prev,
                max_applications_per_run: value
              }))
            }
            keyboardType="numeric"
            placeholder="10"
          />
        </View>

        <View style={styles.formGroup}>
          <Text style={styles.fieldLabel}>Preferred search text</Text>
          <TextInput
            style={styles.textField}
            value={mcpSettings.preferred_search}
            onChangeText={(value) =>
              setMcpSettings((prev) => ({
                ...prev,
                preferred_search: value
              }))
            }
            placeholder="software engineer"
            autoCapitalize="none"
          />
        </View>

        <View style={styles.formGroup}>
          <Text style={styles.fieldLabel}>Preferred remote filter</Text>
          <View style={styles.remoteFilterChipsRow}>
            {remoteFilterOptions.map((option) => {
              const selected = mcpSettings.preferred_remote === option.value;
              return (
                <Pressable
                  key={`mcp-${option.value}`}
                  onPress={() =>
                    setMcpSettings((prev) => ({
                      ...prev,
                      preferred_remote: option.value
                    }))
                  }
                  style={[styles.remoteFilterChip, selected ? styles.remoteFilterChipActive : null]}
                >
                  <Text style={[styles.remoteFilterChipText, selected ? styles.remoteFilterChipTextActive : null]}>
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.formGroup}>
          <MultiSelectDropdown
            label="Preferred Industries"
            options={postingFilterOptions.industries}
            selectedValues={mcpSettings.preferred_industries}
            onToggleValue={toggleMcpIndustryPreference}
            onClear={() =>
              setMcpSettings((prev) => ({
                ...prev,
                preferred_industries: []
              }))
            }
            emptyText="No industries available."
          />

          <MultiSelectDropdown
            label="Preferred Regions"
            options={postingFilterOptions.regions}
            selectedValues={mcpSettings.preferred_regions}
            onToggleValue={toggleMcpRegionPreference}
            onClear={() =>
              setMcpSettings((prev) => ({
                ...prev,
                preferred_regions: [],
                preferred_countries: []
              }))
            }
            emptyText="No regions available."
          />

          <MultiSelectDropdown
            label="Preferred Countries"
            options={visibleMcpCountryOptions}
            selectedValues={mcpSettings.preferred_countries}
            onToggleValue={toggleMcpCountryPreference}
            onClear={() =>
              setMcpSettings((prev) => ({
                ...prev,
                preferred_countries: []
              }))
            }
            emptyText="No countries match selected regions."
          />

          <MultiSelectDropdown
            label="Preferred States"
            options={postingFilterOptions.states}
            selectedValues={mcpSettings.preferred_states}
            onToggleValue={toggleMcpStatePreference}
            onClear={() =>
              setMcpSettings((prev) => ({
                ...prev,
                preferred_states: [],
                preferred_counties: []
              }))
            }
            emptyText="No states available."
          />

          <MultiSelectDropdown
            label="Preferred Counties"
            options={visibleMcpCountyOptions}
            selectedValues={mcpSettings.preferred_counties}
            onToggleValue={toggleMcpCountyPreference}
            onClear={() =>
              setMcpSettings((prev) => ({
                ...prev,
                preferred_counties: []
              }))
            }
            emptyText="No counties match selected states."
          />
        </View>

        <View style={styles.formGroup}>
          <Text style={styles.fieldLabel}>Agent instructions</Text>
          <TextInput
            style={[styles.textField, styles.textFieldMultiline]}
            value={mcpSettings.instructions_for_agent}
            onChangeText={(value) =>
              setMcpSettings((prev) => ({
                ...prev,
                instructions_for_agent: value
              }))
            }
            multiline
            numberOfLines={4}
            placeholder="Example: prioritize mid-size companies and skip relocation-only roles."
          />
        </View>

        {mcpSettingsNotice ? <Text style={styles.settingsNotice}>{mcpSettingsNotice}</Text> : null}

        <Pressable
          onPress={handleSaveMcpSettings}
          disabled={mcpSettingsSaving}
          style={[styles.settingsSaveButton, mcpSettingsSaving ? styles.settingsSaveButtonDisabled : null]}
        >
          <Text style={styles.settingsSaveButtonText}>{mcpSettingsSaving ? "Saving..." : "Save MCP Settings"}</Text>
        </Pressable>
      </View>
    </ScrollView>
  );

  const renderActivePage = () => {
    if (effectiveActivePage === PAGE_KEYS.APPLICATIONS) return renderApplicationsPage();
    if (effectiveActivePage === PAGE_KEYS.APPLICATION_METRICS) return renderApplicationMetricsPage();
    if (effectiveActivePage === PAGE_KEYS.SCRAPER_PERFORMANCE) return renderSyncAreaPage();
    if (effectiveActivePage === PAGE_KEYS.SETTINGS_APPLICANTEE) return renderApplicanteeSettingsPage();
    if (effectiveActivePage === PAGE_KEYS.SETTINGS_SYNC) return renderSyncAreaPage();
    if (effectiveActivePage === PAGE_KEYS.SETTINGS_MCP) return renderMcpSettingsPage();
    return renderPostingsPage();
  };

  return (
    <SafeAreaView style={styles.container}>
      <View
        style={[styles.header, IS_ANDROID ? { paddingTop: 12 + ANDROID_STATUS_BAR_TOP_OFFSET } : null]}
      >
        <View style={styles.headerTopRow}>
          <Pressable
            onPress={() => setDrawerOpen((prev) => !prev)}
            style={styles.hamburgerButton}
            accessibilityRole="button"
            accessibilityLabel="Open navigation menu"
          >
            <Text style={styles.hamburgerIcon}>{"\u2630"}</Text>
          </Pressable>
          <View style={styles.headerLogoContainer}>
            {effectiveActivePage === PAGE_KEYS.POSTINGS ? (
              <Image source={require("./logo.png")} style={styles.headerLogo} resizeMode="contain" />
            ) : (
              <Text style={styles.title}>OpenPostings</Text>
            )}
          </View>
        </View>
        {!IS_ANDROID ? (
          <View style={styles.headerTextContainer}>
            <Text style={styles.subtitle}>ATS postings ({PLATFORM_DISPLAY_NAME})</Text>
            <Text style={styles.small}>API: {API_BASE_URL}</Text>
          </View>
        ) : null}
        <Text style={styles.pageTitle}>{pageTitle}</Text>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}
      {renderActivePage()}

      {drawerOpen ? (
        <View style={styles.drawerOverlay}>
          <Pressable style={styles.drawerBackdrop} onPress={() => setDrawerOpen(false)} />
          <View style={styles.drawerPanel}>
            <Text style={styles.drawerHeading}>Navigation</Text>
            <DrawerItem
              label="Postings"
              selected={effectiveActivePage === PAGE_KEYS.POSTINGS}
              onPress={() => navigateToPage(PAGE_KEYS.POSTINGS)}
            />
            <DrawerItem
              label="Applications"
              selected={effectiveActivePage === PAGE_KEYS.APPLICATIONS}
              onPress={handleOpenApplicationsPage}
            />
            <DrawerItem
              label="Application Metrics"
              selected={effectiveActivePage === PAGE_KEYS.APPLICATION_METRICS}
              onPress={() => navigateToPage(PAGE_KEYS.APPLICATION_METRICS)}
            />
            <DrawerItem
              label="Scraper Performance"
              selected={effectiveActivePage === PAGE_KEYS.SCRAPER_PERFORMANCE}
              onPress={() => navigateToPage(PAGE_KEYS.SCRAPER_PERFORMANCE)}
            />

            <Text style={styles.drawerHeading}>Settings</Text>
            {!IS_ANDROID ? (
              <DrawerItem
                label="Applicantee Information"
                selected={effectiveActivePage === PAGE_KEYS.SETTINGS_APPLICANTEE}
                onPress={() => navigateToPage(PAGE_KEYS.SETTINGS_APPLICANTEE)}
              />
            ) : null}
            <DrawerItem
              label="Sync Settings"
              selected={effectiveActivePage === PAGE_KEYS.SETTINGS_SYNC}
              onPress={() => navigateToPage(PAGE_KEYS.SETTINGS_SYNC)}
            />
            {!IS_ANDROID ? (
              <DrawerItem
                label="MCP Settings"
                selected={effectiveActivePage === PAGE_KEYS.SETTINGS_MCP}
                onPress={() => navigateToPage(PAGE_KEYS.SETTINGS_MCP)}
              />
            ) : null}
          </View>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f4f6f8"
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 6
  },
  headerTopRow: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between"
  },
  headerTextContainer: {
    alignItems: "flex-start",
    marginTop: 6
  },
  headerLogoContainer: {
    marginLeft: "auto",
    flexShrink: 0,
    alignItems: "flex-end"
  },
  headerLogo: {
    width: 220,
    height: 52,
    marginTop: 2,
    alignSelf: "flex-end"
  },
  hamburgerButton: {
    width: 40,
    height: 40,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#d3dbe4",
    backgroundColor: "#ffffff",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 10,
    marginTop: 2
  },
  hamburgerIcon: {
    fontSize: 20,
    fontWeight: "700",
    color: "#102a43"
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    color: "#14213d"
  },
  subtitle: {
    fontSize: 14,
    color: "#4f5d75",
    marginTop: 4
  },
  pageTitle: {
    marginTop: 10,
    fontSize: 13,
    color: "#334e68",
    fontWeight: "600"
  },
  small: {
    fontSize: 11,
    color: "#7a8798",
    marginTop: 2
  },
  controls: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10
  },
  reviewQueueRow: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 6
  },
  reviewQueueTab: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#c6ceda",
    borderRadius: 10,
    paddingVertical: 9,
    alignItems: "center",
    backgroundColor: "#ffffff"
  },
  reviewQueueTabActive: { borderColor: "#0b6e4f", backgroundColor: "#0b6e4f" },
  reviewQueueTabText: { color: "#334e68", fontSize: 12, fontWeight: "700" },
  reviewQueueTabTextActive: { color: "#ffffff" },
  reviewQueueHelp: { paddingHorizontal: 16, paddingBottom: 8, color: "#52606d", fontSize: 11 },
  postingsFiltersHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 6
  },
  postingsFiltersLeftGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10
  },
  postingDescriptionToggleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8
  },
  postingDescriptionToggleLabel: {
    color: "#334e68",
    fontSize: 12,
    fontWeight: "600"
  },
  postingsFiltersToggleBtn: {
    borderWidth: 1,
    borderColor: "#c6ceda",
    backgroundColor: "#ffffff",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8
  },
  postingsFiltersToggleText: {
    color: "#334e68",
    fontWeight: "600",
    fontSize: 12
  },
  postingsFiltersClearBtn: {
    borderWidth: 1,
    borderColor: "#dbe2ea",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: "#ffffff"
  },
  postingsFiltersClearText: {
    color: "#7a8798",
    fontSize: 12,
    fontWeight: "600"
  },
  postingsFiltersPanel: {
    marginHorizontal: 16,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "#dbe2ea",
    borderRadius: 12,
    backgroundColor: "#ffffff",
    padding: 10
  },
  postingsFiltersPanelScroll: {
    maxHeight: Platform.OS === "web" ? 420 : 360
  },
  postingsFiltersPanelContent: {
    paddingBottom: 4
  },
  dropdownWrap: {
    marginBottom: 10
  },
  dropdownTrigger: {
    borderWidth: 1,
    borderColor: "#c6ceda",
    borderRadius: 10,
    backgroundColor: "#f8fafc",
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center"
  },
  dropdownTriggerLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: "#334e68"
  },
  dropdownTriggerValue: {
    fontSize: 12,
    color: "#52606d",
    fontWeight: "600"
  },
  dropdownPanel: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: "#dbe2ea",
    borderRadius: 10,
    backgroundColor: "#ffffff",
    padding: 8
  },
  dropdownSearch: {
    borderWidth: 1,
    borderColor: "#c6ceda",
    borderRadius: 10,
    backgroundColor: "#ffffff",
    height: 40,
    paddingHorizontal: 10
  },
  dropdownOptionsScroll: {
    maxHeight: 180,
    marginTop: 8
  },
  dropdownOption: {
    borderWidth: 1,
    borderColor: "#edf2f7",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 6,
    backgroundColor: "#f8fafc"
  },
  dropdownOptionSelected: {
    borderColor: "#0b6e4f",
    backgroundColor: "#e8f6ef"
  },
  dropdownOptionDisabled: {
    borderColor: "#e4e7eb",
    backgroundColor: "#f5f7fa"
  },
  dropdownOptionLabel: {
    color: "#334e68",
    fontSize: 12
  },
  dropdownOptionLabelSelected: {
    color: "#0b6e4f",
    fontWeight: "700"
  },
  dropdownOptionLabelDisabled: {
    color: "#9aa5b1"
  },
  dropdownEmpty: {
    color: "#7a8798",
    fontSize: 12,
    paddingVertical: 8,
    paddingHorizontal: 4
  },
  dropdownClearBtn: {
    marginTop: 4,
    borderWidth: 1,
    borderColor: "#dbe2ea",
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: "center",
    backgroundColor: "#ffffff"
  },
  dropdownClearBtnText: {
    color: "#52606d",
    fontSize: 12,
    fontWeight: "600"
  },
  remoteFilterGroup: {
    marginTop: 2
  },
  remoteFilterChipsRow: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap"
  },
  postingsSortRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
    paddingHorizontal: 16,
    paddingBottom: 8
  },
  postingsSortLabel: {
    color: "#334e68",
    fontSize: 12,
    fontWeight: "600",
    marginRight: 2
  },
  remoteNoDateToggleRow: {
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: "#dbe2ea",
    borderRadius: 10,
    backgroundColor: "#f8fafc",
    paddingVertical: 9,
    paddingHorizontal: 12
  },
  remoteNoDateToggleLabel: {
    flex: 1,
    marginRight: 10,
    color: "#334e68",
    fontSize: 12,
    fontWeight: "600"
  },
  remoteFilterChip: {
    borderWidth: 1,
    borderColor: "#c6ceda",
    backgroundColor: "#ffffff",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 8
  },
  remoteFilterChipActive: {
    borderColor: "#102a43",
    backgroundColor: "#102a43"
  },
  remoteFilterChipText: {
    color: "#334e68",
    fontSize: 12,
    fontWeight: "600"
  },
  remoteFilterChipTextActive: {
    color: "#ffffff"
  },
  search: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#c6ceda",
    borderRadius: 10,
    backgroundColor: "#fff",
    paddingHorizontal: 12,
    height: 42
  },
  syncBtn: {
    backgroundColor: "#0b6e4f",
    borderRadius: 10,
    paddingHorizontal: 14,
    justifyContent: "center"
  },
  syncBtnText: {
    color: "#fff",
    fontWeight: "600"
  },
  status: {
    paddingHorizontal: 16,
    fontSize: 12,
    color: "#334e68"
  },
  syncProgressTrack: {
    height: 8,
    marginHorizontal: 16,
    marginTop: 6,
    borderRadius: 4,
    overflow: "hidden",
    backgroundColor: "#dbe2ea"
  },
  syncProgressFill: {
    height: "100%",
    borderRadius: 4,
    backgroundColor: "#0b6e4f"
  },
  error: {
    marginHorizontal: 16,
    marginTop: 2,
    color: "#b00020",
    fontSize: 13
  },
  loader: {
    marginTop: 20
  },
  list: {
    padding: 12,
    gap: 10
  },
  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: "#dbe2ea"
  },
  cardIgnored: { backgroundColor: "#f5f6f7", borderColor: "#aab4be", opacity: 0.82 },
  cardMenuOpen: {
    position: "relative",
    zIndex: 999,
    elevation: 999,
    paddingBottom: 225
  },
  position: {
    fontSize: 16,
    fontWeight: "600",
    color: "#102a43"
  },
  location: {
    marginTop: 4,
    fontSize: 12,
    color: "#486581"
  },
  company: {
    marginTop: 4,
    fontSize: 14,
    color: "#334e68"
  },
  ats: {
    marginTop: 3,
    fontSize: 12,
    color: "#243b53",
    fontWeight: "600"
  },
  posted: {
    marginTop: 2,
    fontSize: 12,
    color: "#486581"
  },
  postingFreshness: { marginTop: 3, fontSize: 12, color: "#7c4a03", fontWeight: "700" },
  postingBadgesRow: { flexDirection: "row", flexWrap: "wrap", gap: 5, marginTop: 6 },
  postingReviewBadge: {
    borderRadius: 999,
    backgroundColor: "#e8f6ef",
    color: "#0b6e4f",
    fontSize: 10,
    fontWeight: "700",
    paddingHorizontal: 7,
    paddingVertical: 3
  },
  postingReviewBadgeIgnored: { backgroundColor: "#e4e7eb", color: "#52606d" },
  postingConfidenceBadge: {
    borderRadius: 999,
    backgroundColor: "#edf2f7",
    color: "#486581",
    fontSize: 10,
    paddingHorizontal: 7,
    paddingVertical: 3
  },
  postingCompensation: {
    marginTop: 2,
    fontSize: 12,
    color: "#0b6e4f",
    fontWeight: "600"
  },
  postingDescription: {
    marginTop: 8,
    fontSize: 12,
    color: "#334e68",
    lineHeight: 18,
    backgroundColor: "#f4f7fb",
    borderWidth: 1,
    borderColor: "#dbe3ec",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8
  },
  postingAppliedNotice: {
    marginTop: 6,
    fontSize: 12,
    color: "#0b6e4f",
    fontWeight: "600"
  },
  url: {
    marginTop: 6,
    fontSize: 11,
    color: "#7b8794"
  },
  postingCardTopRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8
  },
  postingCardMainPressArea: {
    flex: 1,
    minWidth: 0
  },
  postingCardMenuAnchor: {
    position: "relative",
    zIndex: 2
  },
  postingCardMenuTrigger: {
    borderWidth: 1,
    borderColor: "#c6ceda",
    borderRadius: 8,
    minWidth: 34,
    height: 30,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#ffffff"
  },
  postingCardMenuTriggerText: {
    fontSize: 18,
    lineHeight: 20,
    color: "#334e68",
    fontWeight: "700"
  },
  postingCardMenu: {
    position: "absolute",
    top: 34,
    right: 0,
    minWidth: 190,
    borderWidth: 1,
    borderColor: "#dbe2ea",
    borderRadius: 10,
    backgroundColor: "#ffffff",
    padding: 6
  },
  postingCardMenuItem: {
    borderWidth: 1,
    borderColor: "#edf2f7",
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginBottom: 6,
    backgroundColor: "#f8fafc"
  },
  postingCardMenuItemDestructive: {
    borderColor: "#f4d4d4",
    backgroundColor: "#fff4f4"
  },
  postingCardMenuItemDisabled: {
    opacity: 0.6
  },
  postingCardMenuItemText: {
    color: "#334e68",
    fontWeight: "600",
    fontSize: 12
  },
  postingCardMenuItemTextDestructive: {
    color: "#a12d2d"
  },
  postingCardActionSaveDisabled: {
    opacity: 0.65
  },
  inlineNotice: {
    paddingHorizontal: 16,
    marginTop: 4,
    color: "#0b6e4f",
    fontSize: 12
  },
  errorBanner: {
    borderWidth: 1,
    borderColor: "#e0b4b0",
    backgroundColor: "#fdf0ef",
    borderRadius: 10,
    padding: 12,
    marginBottom: 12
  },
  errorBannerTitle: { fontWeight: "700", color: "#8a2b22", marginBottom: 6 },
  errorBannerRow: { marginBottom: 8 },
  errorBannerText: { color: "#8a2b22", fontSize: 13 },
  errorBannerMeta: { color: "#a4564d", fontSize: 12 },
  errorBannerButton: {
    alignSelf: "flex-start",
    marginTop: 4,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#c98b84"
  },
  errorBannerButtonText: { color: "#8a2b22", fontWeight: "600", fontSize: 13 },
  empty: {
    textAlign: "center",
    marginTop: 20,
    color: "#52606d"
  },
  loadMoreButton: {
    alignSelf: "center",
    minWidth: 150,
    marginTop: 10,
    borderRadius: 10,
    backgroundColor: "#102a43",
    paddingHorizontal: 18,
    paddingVertical: 11,
    alignItems: "center"
  },
  loadMoreButtonText: { color: "#ffffff", fontSize: 12, fontWeight: "700" },
  paginationEnd: { textAlign: "center", color: "#7a8798", fontSize: 11, marginVertical: 14 },
  reviewDetailNotice: { marginTop: 8, color: "#52606d", fontSize: 11, fontStyle: "italic" },
  applicationCard: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: "#dbe2ea",
    borderRadius: 10,
    padding: 10,
    backgroundColor: "#fdfefe"
  },
  applicationAttribution: {
    marginTop: 4,
    fontSize: 12,
    color: "#334e68",
    fontStyle: "italic"
  },
  applicationActionsRow: {
    marginTop: 10,
    flexDirection: "row",
    gap: 8
  },
  applicationStatusWrap: {
    flex: 1
  },
  applicationStatusBtn: {
    borderWidth: 1,
    borderColor: "#c6ceda",
    borderRadius: 8,
    backgroundColor: "#ffffff",
    paddingVertical: 8,
    paddingHorizontal: 10
  },
  applicationStatusBtnText: {
    color: "#334e68",
    fontSize: 12,
    fontWeight: "600"
  },
  applicationStatusMenu: {
    marginTop: 6,
    borderWidth: 1,
    borderColor: "#dbe2ea",
    borderRadius: 8,
    backgroundColor: "#ffffff",
    padding: 6
  },
  applicationStatusMenuItem: {
    borderWidth: 1,
    borderColor: "#edf2f7",
    borderRadius: 8,
    paddingVertical: 7,
    paddingHorizontal: 8,
    marginBottom: 6,
    backgroundColor: "#f8fafc"
  },
  applicationStatusMenuItemActive: {
    borderColor: "#102a43",
    backgroundColor: "#102a43"
  },
  applicationStatusMenuItemText: {
    color: "#334e68",
    fontSize: 12
  },
  applicationStatusMenuItemTextActive: {
    color: "#ffffff",
    fontWeight: "700"
  },
  applicationDeleteBtn: {
    borderWidth: 1,
    borderColor: "#d13a3a",
    borderRadius: 8,
    backgroundColor: "#d13a3a",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 10,
    minWidth: 84
  },
  applicationDeleteBtnDisabled: {
    opacity: 0.65
  },
  applicationDeleteBtnText: {
    color: "#ffffff",
    fontWeight: "700",
    fontSize: 12
  },
  settingsContent: {
    paddingHorizontal: 12,
    paddingBottom: 24
  },
  settingsCard: {
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#dbe2ea",
    borderRadius: 12,
    padding: 12
  },
  settingsTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#102a43"
  },
  settingsSubsection: {
    marginTop: 4,
    fontSize: 14,
    fontWeight: "600",
    color: "#334e68"
  },
  settingsDescription: {
    marginTop: 6,
    fontSize: 12,
    color: "#52606d"
  },
  performanceDashboard: {
    marginTop: 14,
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 12,
    backgroundColor: "#f8fafc",
    padding: 12
  },
  performanceDashboardHidden: {
    display: "none"
  },
  performanceDashboardHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12
  },
  performanceDashboardHeading: {
    flex: 1
  },
  performanceDashboardTitle: {
    color: "#102a43",
    fontSize: 16,
    fontWeight: "700"
  },
  performanceDashboardSubtitle: {
    marginTop: 3,
    color: "#52606d",
    fontSize: 11
  },
  performanceHealthBadge: {
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 6
  },
  performanceHealthGood: {
    backgroundColor: "#0b6e4f"
  },
  performanceHealthWarning: {
    backgroundColor: "#b45309"
  },
  performanceHealthCritical: {
    backgroundColor: "#b42318"
  },
  performanceHealthNeutral: {
    backgroundColor: "#52606d"
  },
  performanceHealthText: {
    color: "#ffffff",
    fontSize: 11,
    fontWeight: "700"
  },
  performanceWarningBanner: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: "#f1c27d",
    backgroundColor: "#fffaf0",
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    gap: 4
  },
  performanceWarningText: {
    color: "#8a5a1a",
    fontSize: 11,
    lineHeight: 15
  },
  performanceMetricGrid: {
    marginTop: 12,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  performanceMetric: {
    flexGrow: 1,
    flexBasis: "22%",
    minWidth: 145,
    minHeight: 88,
    borderWidth: 1,
    borderColor: "#dbe2ea",
    borderRadius: 10,
    backgroundColor: "#ffffff",
    paddingVertical: 9,
    paddingHorizontal: 10
  },
  performanceMetricGood: {
    borderColor: "#86c5ad",
    backgroundColor: "#f0fdf7"
  },
  performanceMetricWarning: {
    borderColor: "#f1c27d",
    backgroundColor: "#fffaf0"
  },
  performanceMetricCritical: {
    borderColor: "#f0a7a1",
    backgroundColor: "#fff5f4"
  },
  performanceMetricLabel: {
    color: "#52606d",
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase"
  },
  performanceMetricValue: {
    marginTop: 4,
    color: "#102a43",
    fontSize: 18,
    fontWeight: "700"
  },
  performanceMetricHint: {
    marginTop: 3,
    color: "#627d98",
    fontSize: 10
  },
  performanceSection: {
    marginTop: 12,
    borderTopWidth: 1,
    borderTopColor: "#dbe2ea",
    paddingTop: 10
  },
  performanceSectionTitleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8
  },
  performanceSectionTitle: {
    color: "#334e68",
    fontSize: 12,
    fontWeight: "700"
  },
  performanceSectionValue: {
    color: "#52606d",
    fontSize: 11,
    fontWeight: "600"
  },
  performanceProgressTrack: {
    marginTop: 7,
    height: 9,
    borderRadius: 999,
    overflow: "hidden",
    backgroundColor: "#dbe2ea"
  },
  performanceProgressFill: {
    height: "100%",
    borderRadius: 999,
    backgroundColor: "#0b6e4f"
  },
  performanceSparkline: {
    height: 58,
    marginTop: 8,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 2,
    borderBottomWidth: 1,
    borderBottomColor: "#cbd5e1"
  },
  performanceSparkBar: {
    flex: 1,
    maxWidth: 18,
    minWidth: 3,
    borderTopLeftRadius: 2,
    borderTopRightRadius: 2,
    backgroundColor: "#168a68"
  },
  performanceSparkLegend: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 8
  },
  performanceSplitRow: {
    marginTop: 12,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  performanceDetailPanel: {
    flexGrow: 1,
    flexBasis: "47%",
    minWidth: 240,
    borderWidth: 1,
    borderColor: "#dbe2ea",
    borderRadius: 10,
    backgroundColor: "#ffffff",
    padding: 10
  },
  performanceWorkerRow: {
    marginTop: 7,
    flexDirection: "row",
    alignItems: "center",
    gap: 8
  },
  performanceWorkerNumber: {
    width: 30,
    color: "#0b6e4f",
    fontSize: 11,
    fontWeight: "700"
  },
  performanceWorkerInfo: {
    flex: 1
  },
  performanceWorkerCompany: {
    color: "#334e68",
    fontSize: 11,
    fontWeight: "600"
  },
  performanceDetailText: {
    marginTop: 7,
    color: "#52606d",
    fontSize: 11
  },
  performanceEmptyText: {
    marginTop: 8,
    color: "#7b8794",
    fontSize: 11,
    fontStyle: "italic"
  },
  performanceHotspotList: {
    marginTop: 5
  },
  performanceHotspotRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: "#edf2f7"
  },
  performanceHotspotName: {
    flex: 1,
    color: "#334e68",
    fontSize: 11,
    fontWeight: "700"
  },
  performanceHotspotStats: {
    flex: 2,
    color: "#627d98",
    fontSize: 10,
    textAlign: "right"
  },
  performanceAlert: {
    marginTop: 12,
    borderLeftWidth: 3,
    borderLeftColor: "#b42318",
    borderRadius: 6,
    backgroundColor: "#fff5f4",
    paddingVertical: 8,
    paddingHorizontal: 10
  },
  performanceAlertTitle: {
    color: "#8a1c13",
    fontSize: 11,
    fontWeight: "700"
  },
  performanceAlertText: {
    marginTop: 3,
    color: "#8a1c13",
    fontSize: 10
  },
  settingsLoader: {
    marginTop: 12
  },
  formGroup: {
    marginTop: 12
  },
  fieldLabel: {
    marginBottom: 6,
    fontSize: 12,
    fontWeight: "600",
    color: "#334e68"
  },
  textField: {
    borderWidth: 1,
    borderColor: "#c6ceda",
    borderRadius: 10,
    backgroundColor: "#fff",
    paddingHorizontal: 12,
    height: 42
  },
  textFieldMultiline: {
    minHeight: 72,
    paddingTop: 10,
    paddingBottom: 10,
    textAlignVertical: "top"
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: "#dbe2ea",
    borderRadius: 10,
    backgroundColor: "#f8fafc",
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 8
  },
  toggleLabel: {
    flex: 1,
    marginRight: 10,
    fontSize: 12,
    color: "#334e68",
    fontWeight: "600"
  },
  settingsNotice: {
    marginTop: 12,
    fontSize: 12,
    color: "#0b6e4f"
  },
  settingsInlineHint: {
    marginTop: 6,
    fontSize: 11,
    color: "#52606d"
  },
  updateFlag: {
    marginTop: 12,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 6,
    borderLeftWidth: 3,
    borderLeftColor: "#b45309",
    backgroundColor: "#fef3c7"
  },
  updateFlagText: {
    fontSize: 12,
    color: "#92400e"
  },
  settingsSecondaryButton: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: "#dbe2ea",
    backgroundColor: "#ffffff",
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: "center"
  },
  settingsSecondaryButtonText: {
    color: "#334e68",
    fontWeight: "600"
  },
  modalOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(16, 42, 67, 0.45)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 14
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject
  },
  modalCard: {
    width: "100%",
    maxWidth: 700,
    maxHeight: "86%",
    borderWidth: 1,
    borderColor: "#dbe2ea",
    borderRadius: 12,
    backgroundColor: "#ffffff",
    padding: 12
  },
  modalHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8
  },
  modalTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: "700",
    color: "#102a43"
  },
  modalCloseButton: {
    borderWidth: 1,
    borderColor: "#dbe2ea",
    borderRadius: 8,
    backgroundColor: "#ffffff",
    paddingHorizontal: 10,
    paddingVertical: 7
  },
  modalCloseButtonText: {
    color: "#334e68",
    fontSize: 12,
    fontWeight: "600"
  },
  modalBodyScroll: {
    marginTop: 8
  },
  modalBodyContent: {
    paddingBottom: 10
  },
  settingsInlineActionsRow: {
    marginTop: 8,
    flexDirection: "row",
    gap: 8
  },
  settingsInlineActionBtn: {
    borderWidth: 1,
    borderColor: "#dbe2ea",
    borderRadius: 8,
    backgroundColor: "#ffffff",
    paddingVertical: 7,
    paddingHorizontal: 10
  },
  settingsInlineActionBtnText: {
    color: "#334e68",
    fontSize: 12,
    fontWeight: "600"
  },
  settingsCheckboxList: {
    marginTop: 8
  },
  settingsCheckboxRow: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#dbe2ea",
    borderRadius: 10,
    backgroundColor: "#f8fafc",
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginBottom: 6
  },
  settingsCheckboxIcon: {
    width: 18,
    fontSize: 14,
    color: "#102a43",
    fontWeight: "700"
  },
  settingsCheckboxLabel: {
    flex: 1,
    marginLeft: 6,
    fontSize: 12,
    color: "#334e68",
    fontWeight: "600"
  },
  blockedCompanyRow: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: "#dbe2ea",
    borderRadius: 10,
    backgroundColor: "#f8fafc",
    paddingVertical: 8,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10
  },
  blockedCompanyName: {
    flex: 1,
    color: "#334e68",
    fontSize: 12,
    fontWeight: "600"
  },
  blockedCompanyUnblockBtn: {
    borderWidth: 1,
    borderColor: "#0b6e4f",
    borderRadius: 8,
    backgroundColor: "#0b6e4f",
    paddingVertical: 7,
    paddingHorizontal: 10
  },
  blockedCompanyUnblockBtnDisabled: {
    opacity: 0.65
  },
  blockedCompanyUnblockBtnText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "700"
  },
  settingsSaveButton: {
    marginTop: 10,
    backgroundColor: "#0b6e4f",
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center"
  },
  documentRow: {
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10
  },
  documentRowInfo: {
    flex: 1,
    minWidth: 0
  },
  documentRowMeta: {
    marginTop: 2,
    fontSize: 12,
    color: "#627d98"
  },
  documentUploadBtn: {
    backgroundColor: "#0b6e4f",
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 16,
    alignItems: "center"
  },
  settingsSaveButtonDisabled: {
    opacity: 0.65
  },
  settingsSaveButtonText: {
    color: "#ffffff",
    fontWeight: "600"
  },
  drawerOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 20,
    flexDirection: "row"
  },
  drawerBackdrop: {
    flex: 1,
    backgroundColor: "rgba(16, 42, 67, 0.25)"
  },
  drawerPanel: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: 286,
    backgroundColor: "#ffffff",
    borderRightWidth: 1,
    borderRightColor: "#dbe2ea",
    paddingTop: 58,
    paddingHorizontal: 12
  },
  drawerHeading: {
    marginTop: 12,
    marginBottom: 6,
    paddingHorizontal: 8,
    fontSize: 12,
    color: "#7a8798",
    textTransform: "uppercase",
    fontWeight: "700"
  },
  drawerItem: {
    borderWidth: 1,
    borderColor: "#dbe2ea",
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 10,
    marginBottom: 8
  },
  drawerItemSelected: {
    borderColor: "#102a43",
    backgroundColor: "#102a43"
  },
  drawerItemText: {
    color: "#334e68",
    fontWeight: "600"
  },
  drawerItemTextSelected: {
    color: "#ffffff"
  }
});
