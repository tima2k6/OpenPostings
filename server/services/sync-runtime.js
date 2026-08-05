const { normalizeSyncEnabledAts, normalizeAtsFilterValue, inferPostingLocationFromJobUrl, ATS_FILTER_OPTIONS, ATS_FILTER_OPTION_ITEMS } = require("../helpers/normalize-ats");
const { getSyncPromise, setSyncPromise, getDb, getReadDb, setDb, getPostingLocationByJobUrl, setPostingLocationByJobUrl, getSyncEnabledAts, getSyncDownloadJobDescriptions, getAtsRequestQueueConcurrency, runInWriteTransaction } = require("./runtime-context.js");
const { nowEpochSeconds, getPostingFreshnessWindowSeconds, shouldStorePostingByDate } = require("../helpers/normalize-numbers")
const { normalizeCompensationType, serializeEducationLevels, normalizeCompensationCurrencyCode, normalizeCompensationPayPeriod } = require("../helpers/description-filters")
const { parsePostingLocation, serializeLocationsJson } = require("../helpers/parse-location.js")
const { recordError } = require("./error-log.js")
const { raceWithAbortSignal, runWithRequestSignal } = require("./queue.js");

const { collectPostingsForWorkdayCompany } = require("../ats/workday/service.js");
const { collectPostingsForAshbyCompany } = require("../ats/ashby/service.js");
const { collectPostingsForGreenhouseCompany } = require("../ats/greenhouse/service.js");
const { collectPostingsForLeverCompany } = require("../ats/lever/service.js");
const { collectPostingsForJobviteCompany } = require("../ats/jobvite/service.js");
const { collectPostingsForApplicantProCompany } = require("../ats/applicantpro/service.js");
const { collectPostingsForApplyToJobCompany } = require("../ats/applytojob/service.js");
const { collectPostingsForTheApplicantManagerCompany } = require("../ats/theapplicantmanager/service.js");
const { collectPostingsForBreezyCompany } = require("../ats/breezy/service.js");
const { collectPostingsForIcimsCompany } = require("../ats/icims/service.js");
const { collectPostingsForZohoCompany } = require("../ats/zoho/service.js");
const { collectPostingsForApplicantAiCompany } = require("../ats/applicantai/service.js");
const { collectPostingsForGemCompany } = require("../ats/gem/service.js");
const { collectPostingsForJobApsCompany } = require("../ats/jobaps/service.js");
const { collectPostingsForJoinCompany } = require("../ats/join/service.js");
const { collectPostingsForTalentreefCompany } = require("../ats/talentreef/service.js");
const { collectPostingsForCareerplugCompany } = require("../ats/careerplug/service.js");
const { collectPostingsForBambooHrCompany } = require("../ats/bamboohr/service.js");
const { collectPostingsForAdpMyjobsCompany } = require("../ats/adp_myjobs/service.js");
const { collectPostingsForPaycorCompany } = require("../ats/paycor/service.js");
const { collectPostingsForPaycomonlineCompany } = require("../ats/paycomonline/service.js");
const { collectPostingsForPrismhrCompany } = require("../ats/prismhr/service.js");
const { collectPostingsForSilkroadCompany } = require("../ats/silkroad/service.js");
const { collectPostingsForAdpWorkforcenowCompany } = require("../ats/adp_workforcenow/service.js");
const { collectPostingsForPaylocityCompany } = require("../ats/paylocity/service.js");
const { collectPostingsForDayforceCompany } = require("../ats/dayforce/service.js");
const { collectPostingsForEightfoldCompany } = require("../ats/eightfold/service.js");
const { collectPostingsForOracleCompany } = require("../ats/oracle/service.js");
const { collectPostingsForBrassringCompany } = require("../ats/brassring/service.js");
const { collectPostingsForApplitrackCompany } = require("../ats/applitrack/service.js");
const { collectPostingsForHibobCompany } = require("../ats/hibob/service.js");
const { collectPostingsForisolvedCompany } = require("../ats/isolved/service.js");
const { collectPostingsForAvatureCompany } = require("../ats/avature/service.js");
const { collectPostingsForComeetCompany } = require("../ats/comeet/service.js");
const { collectPostingsForFactorialhrCompany } = require("../ats/factorialhr/service.js");
const { collectPostingsForHireologyCompany } = require("../ats/hireology/service.js");
const { collectPostingsForHiringplatformCompany } = require("../ats/hiringplatform/service.js");
const { collectPostingsForHomerunCompany } = require("../ats/homerun/service.js");
const { collectPostingsForJibeapplyCompany } = require("../ats/jibeapply/service.js");
const { collectPostingsForJobs2webCompany } = require("../ats/jobs2web/service.js");
const { collectPostingsForOccupopCompany } = require("../ats/occupop/service.js");
const { collectPostingsForPeopleadminCompany } = require("../ats/peopleadmin/service.js");
const { collectPostingsForPersonioCompany } = require("../ats/personio/service.js");
const { collectPostingsForRecruiterflowCompany } = require("../ats/recruiterflow/service.js");
const { collectPostingsForSoftgardenCompany } = require("../ats/softgarden/service.js");
const { collectPostingsForTrakstarCompany } = require("../ats/trakstar/service.js");
const { collectPostingsForYcombinatorCompany } = require("../ats/ycombinator/service.js");
const { collectPostingsForYelloCompany } = require("../ats/yello/service.js");
const { collectPostingsForCrelateCompany } = require("../ats/crelate/service.js");
const { collectPostingsForManatalCompany } = require("../ats/manatal/service.js");
const { collectPostingsForCareerspageCompany } = require("../ats/careerspage/service.js");
const { collectPostingsForPageupCompany } = require("../ats/pageup/service.js");
const { collectPostingsForHirebridgeCompany } = require("../ats/hirebridge/service.js");
const { collectPostingsForTeamtailorCompany } = require("../ats/teamtailor/service.js");
const { collectPostingsForFreshteamCompany } = require("../ats/freshteam/service.js");
const { collectPostingsForAgilehrCompany } = require("../ats/agilehr/service.js");
const { collectPostingsForSagehrCompany } = require("../ats/sagehr/service.js");
const { collectPostingsForLoxoCompany } = require("../ats/loxo/service.js");
const { collectPostingsForPeopleforceCompany } = require("../ats/peopleforce/service.js");
const { collectPostingsForSimplicantCompany } = require("../ats/simplicant/service.js");
const { collectPostingsForPinpointHqCompany } = require("../ats/pinpointhq/service.js");
const { collectPostingsForRecruitCrmCompany } = require("../ats/recruitcrm/service.js");
const { collectPostingsForRipplingCompany } = require("../ats/rippling/service.js");
const { collectPostingsForCareerpuckCompany } = require("../ats/careerpuck/service.js");
const { collectPostingsForFountainCompany } = require("../ats/fountain/service.js");
const { collectPostingsForGetroCompany } = require("../ats/getro/service.js");
const { collectPostingsForHrmDirectCompany } = require("../ats/hrmdirect/service.js");
const { collectPostingsForTalentlyftCompany } = require("../ats/talentlyft/service.js");
const { collectPostingsForTalexioCompany } = require("../ats/talexio/service.js");
const { collectPostingsForSapHrCloudCompany } = require("../ats/saphrcloud/service.js");
const { collectPostingsForRecruiteeCompany } = require("../ats/recruitee/service.js");
const { collectPostingsForUltiProCompany } = require("../ats/ultipro/service.js");
const { collectPostingsForUkgCompany } = require("../ats/ukg/service.js");
const { collectPostingsForTaleoCompany } = require("../ats/taleonet/service.js");


const { collectPostingsForGovernmentJobsDynamic, GOVERNMENTJOBS_ESTIMATED_COMPANY_COUNT } = require("../ats/governmentjobs/service.js");
const { collectPostingsForSmartRecruitersDynamic, SMARTRECRUITERS_ESTIMATED_COMPANY_COUNT, SMARTRECRUITERS_INSERT_EVERY_N_TARGETS } = require("../ats/smartrecruiters/service.js");
const { collectPostingsForPoliceappDynamic, POLICEAPP_ESTIMATED_COMPANY_COUNT } = require("../ats/policeapp/service.js");
const { collectPostingsForUsajobsDynamic, USAJOBS_ESTIMATED_COMPANY_COUNT } = require("../ats/usajobs/service.js");
const { collectPostingsForK12jobspotDynamic, K12JOBSPOT_ESTIMATED_COMPANY_COUNT } = require("../ats/k12jobspot/service.js");
const { collectPostingsForSnaphuntDynamic, SNAPHUNT_ESTIMATED_COMPANY_COUNT } = require("../ats/snaphunt/service.js");
const { collectPostingsForDoverCompany } = require("../ats/dover/service.js");
const { collectPostingsForOorwinCompany } = require("../ats/oorwin/service.js");
const { collectPostingsForSchoolspringDynamic, SCHOOLSPRING_ESTIMATED_COMPANY_COUNT } = require("../ats/schoolspring/service.js");
const { collectPostingsForEdjoinDynamic, EDJOIN_ESTIMATED_COMPANY_COUNT } = require("../ats/edjoin/service.js");
const { collectPostingsForWebcruiterDynamic, WEBCRUITER_ESTIMATED_COMPANY_COUNT } = require("../ats/webcruiter/service.js");
const { collectPostingsForAcademicJobsOnlineDynamic, ACADEMICJOBSONLINE_ESTIMATED_COMPANY_COUNT } = require("../ats/academicjobsonline/service.js");
const { collectPostingsForCalcareersDynamic, CALCAREERS_ESTIMATED_COMPANY_COUNT } = require("../ats/calcareers/service.js");
const { collectPostingsForCaloppsDynamic, CALOPPS_ESTIMATED_COMPANY_COUNT } = require("../ats/calopps/service.js");
const { collectPostingsForStatejobsnyDynamic, STATEJOBSNY_ESTIMATED_COMPANY_COUNT } = require("../ats/statejobsny/service.js");
const { collectPostingsForHcareersDynamic, HCAREERS_ESTIMATED_COMPANY_COUNT } = require("../ats/hcareers/service.js");
const { collectPostingsForAmazonDynamic, AMAZON_ESTIMATED_COMPANY_COUNT } = require("../ats/amazon/service.js");
const {
  CAREER_SITE_CONFIGS,
  CAREER_SITE_KEYS,
  collectPostingsForCareerSiteDynamic,
  getCareerSiteEstimatedCompanyCount
} = require("../ats/careersite/service.js");

const syncStatus = {
  running: false,
  started_at: null,
  last_sync_at: null,
  last_sync_summary: null,
  last_error: null,
  progress: null,
  stall_recoveries: 0,
  last_stall_recovery_at: null,
  // A pass that crawls happily but cannot write is indistinguishable from a healthy one
  // in every other field here -- company progress advances, no error is thrown to the top
  // level, and the summary that would have carried the failure counts is only published
  // when the pass ends, hours later. These make "collecting but storing nothing" visible
  // while it is still happening.
  postings_stored: 0,
  new_postings: 0,
  refreshed_postings: 0,
  last_progress_at: null,
  last_write_at: null,
  flush_failures: 0,
  last_flush_error: null,
  last_flush_error_at: null,
  active_targets: [],
  target_timeouts: 0,
  last_target_timeout_at: null,
  // A rolling window, not just the single most recent timestamp: individual ATS platforms
  // (Workday, Ashby) hit their own bounded deadline occasionally as a matter of course, so
  // "one timeout happened recently" is true almost continuously during otherwise-healthy
  // operation. What actually distinguishes a real problem is a burst -- several in a short
  // window -- which needs more than one timestamp to detect.
  recent_target_timeout_epochs_ms: []
};

// How far back recent_target_timeout_epochs_ms is allowed to look. Generous relative to the
// 5-minute window the dashboard actually checks, so that window is never shortchanged by
// this pruning running slightly late.
const RECENT_TARGET_TIMEOUT_WINDOW_MS = 10 * 60 * 1000;

// runAtsSync hands back the in-flight promise so passes cannot overlap. These track
// forward progress and give both individual targets and the watchdog a way to cancel
// every queued wait and in-flight response body before a replacement pass starts.
const SYNC_STALL_TIMEOUT_MS = Number(process.env.SYNC_STALL_TIMEOUT_MS || 15 * 60 * 1000);
const SYNC_WATCHDOG_INTERVAL_MS = Number(process.env.SYNC_WATCHDOG_INTERVAL_MS || 60 * 1000);
const SYNC_TARGET_TIMEOUT_MS = Number(process.env.SYNC_TARGET_TIMEOUT_MS || 10 * 60 * 1000);
// Bumped when a pass is abandoned. Workers compare against the value they started
// with and exit, so an abandoned pass stops consuming targets and memory instead of
// racing the replacement pass.
let syncGeneration = 0;
let lastSyncProgressAtMs = 0;
let activeSyncAbortController = null;
const activeSyncTargetsByWorker = new Map();

const SYNC_WORKER_CONCURRENCY_RAW = Number(process.env.SYNC_WORKER_CONCURRENCY || 4);
const SYNC_WORKER_CONCURRENCY =
  Number.isFinite(SYNC_WORKER_CONCURRENCY_RAW) && SYNC_WORKER_CONCURRENCY_RAW > 0
    ? Math.floor(SYNC_WORKER_CONCURRENCY_RAW)
    : 4;

const SYNC_POSTING_FLUSH_BATCH_SIZE = Number(process.env.SYNC_POSTING_FLUSH_BATCH_SIZE || 100); 

function publishActiveSyncTargets() {
  syncStatus.active_targets = Array.from(activeSyncTargetsByWorker.values()).sort(
    (a, b) => Number(a.worker || 0) - Number(b.worker || 0)
  );
}


async function collectPostingsForCompany(company, options = {}) {
  const atsName = String(company?.ATS_name || "").trim().toLowerCase();
  if (atsName === "workday") {
    return collectPostingsForWorkdayCompany(company, options);
  }
  if (atsName === "ashbyhq") {
    return collectPostingsForAshbyCompany(company);
  }
  if (atsName === "greenhouseio" || atsName === "greenhouse.io" || atsName === "greenhouse") {
    return collectPostingsForGreenhouseCompany(company);
  }
  if (atsName === "leverco" || atsName === "lever.co" || atsName === "lever") {
    return collectPostingsForLeverCompany(company);
  }
  if (atsName === "jobvite" || atsName === "jobvite.com" || atsName === "jobvitecom") {
    return collectPostingsForJobviteCompany(company);
  }
  if (atsName === "applicantpro" || atsName === "applicantpro.com" || atsName === "applicantprocom") {
    return collectPostingsForApplicantProCompany(company);
  }
  if (atsName === "applytojob" || atsName === "applytojob.com" || atsName === "applytojobcom") {
    return collectPostingsForApplyToJobCompany(company);
  }
  if (
    atsName === "theapplicantmanager" ||
    atsName === "theapplicantmanager.com" ||
    atsName === "theapplicantmanagercom"
  ) {
    return collectPostingsForTheApplicantManagerCompany(company);
  }
  if (atsName === "breezy" || atsName === "breezyhr" || atsName === "breezy.hr" || atsName === "breezyhrcom") {
    return collectPostingsForBreezyCompany(company);
  }
  if (atsName === "icims" || atsName === "icims.com" || atsName === "icimscom") {
    return collectPostingsForIcimsCompany(company);
  }
  if (atsName === "zoho" || atsName === "zohorecruit" || atsName === "zohorecruit.com" || atsName === "zohorecruitcom") {
    return collectPostingsForZohoCompany(company);
  }
  if (atsName === "applicantai" || atsName === "applicantai.com" || atsName === "applicantaicom") {
    return collectPostingsForApplicantAiCompany(company);
  }
  if (atsName === "gem" || atsName === "jobs.gem.com" || atsName === "gem.com" || atsName === "gemcom") {
    return collectPostingsForGemCompany(company);
  }
  if (atsName === "jobaps" || atsName === "jobapscloud.com" || atsName === "jobapscloudcom") {
    return collectPostingsForJobApsCompany(company);
  }
  if (atsName === "join" || atsName === "join.com" || atsName === "joincom") {
    return collectPostingsForJoinCompany(company);
  }
  if (
    atsName === "talentreef" ||
    atsName === "jobappnetwork.com" ||
    atsName === "jobappnetworkcom" ||
    atsName === "apply.jobappnetwork.com" ||
    atsName === "applyjobappnetworkcom"
  ) {
    return collectPostingsForTalentreefCompany(company);
  }
  if (atsName === "careerplug" || atsName === "careerplug.com" || atsName === "careerplugcom") {
    return collectPostingsForCareerplugCompany(company);
  }
  if (atsName === "bamboohr" || atsName === "bamboohr.com" || atsName === "bamboohrcom") {
    return collectPostingsForBambooHrCompany(company);
  }
  if (atsName === "adp_myjobs" || atsName === "adpmyjobs") {
    return collectPostingsForAdpMyjobsCompany(company);
  }
  if (
    atsName === "paycor" ||
    atsName === "recruitingbypaycor.com" ||
    atsName === "recruitingbypaycorcom" ||
    atsName === "www.recruitingbypaycor.com" ||
    atsName === "wwwrecruitingbypaycorcom"
  ) {
    return collectPostingsForPaycorCompany(company);
  }
  if (
    atsName === "paycomonline" ||
    atsName === "paycomonline.net" ||
    atsName === "paycomonlinenet" ||
    atsName === "www.paycomonline.net" ||
    atsName === "wwwpaycomonlinenet"
  ) {
    return collectPostingsForPaycomonlineCompany(company);
  }
  if (
    atsName === "prismhr" ||
    atsName === "prismhr-hire.com" ||
    atsName === "prismhrhirecom" ||
    atsName === "www.prismhr-hire.com" ||
    atsName === "wwwprismhrhirecom"
  ) {
    return collectPostingsForPrismhrCompany(company);
  }
  if (
    atsName === "silkroad" ||
    atsName === "jobs.silkroad.com" ||
    atsName === "jobssilkroadcom" ||
    atsName === "www.jobs.silkroad.com" ||
    atsName === "wwwjobssilkroadcom"
  ) {
    return collectPostingsForSilkroadCompany(company);
  }
  if (
    atsName === "adp_workforcenow" ||
    atsName === "adpworkforcenow" ||
    atsName === "workforcenow.adp.com" ||
    atsName === "workforcenowadpcom"
  ) {
    return collectPostingsForAdpWorkforcenowCompany(company);
  }
  if (
    atsName === "paylocity" ||
    atsName === "paylocity.com" ||
    atsName === "paylocitycom" ||
    atsName === "recruiting.paylocity.com" ||
    atsName === "recruitingpaylocitycom"
  ) {
    return collectPostingsForPaylocityCompany(company);
  }
  if (
    atsName === "dayforcehcm" ||
    atsName === "dayforce" ||
    atsName === "dayforcehcm.com" ||
    atsName === "dayforcehcmcom"
  ) {
    // return collectPostingsForDayforceCompany(company);
      // Dayforce temporarily disabled (403 token issue)
    return [];
  }
  if (atsName === "eightfold" || atsName === "eightfold.ai" || atsName === "eightfoldai") {
    return collectPostingsForEightfoldCompany(company);
  }
  if (
    atsName === "oracle" ||
    atsName === "oraclecloud" ||
    atsName === "oraclecloud.com" ||
    atsName === "oraclecloudcom"
  ) {
    return collectPostingsForOracleCompany(company);
  }
  if (
    atsName === "brassring" ||
    atsName === "brassring.com" ||
    atsName === "brassringcom" ||
    atsName === "sjobs.brassring.com" ||
    atsName === "sjobsbrassringcom"
  ) {
    return collectPostingsForBrassringCompany(company);
  }
  if (atsName === "applitrack" || atsName === "applitrack.com" || atsName === "applitrackcom") {
    return collectPostingsForApplitrackCompany(company);
  }
  if (atsName === "hibob" || atsName === "hibob.com" || atsName === "hibobcom" || atsName === "careers.hibob.com" || atsName === "careershibobcom") {
    return collectPostingsForHibobCompany(company);
  }
  if (
    atsName === "isolved" ||
    atsName === "isolvedhire" ||
    atsName === "isolvedhire.com" ||
    atsName === "isolvedhirecom"
  ) {
    return collectPostingsForisolvedCompany(company);
  }
  if (
    atsName === "avature" ||
    atsName === "avature.net" ||
    atsName === "avaturenet"
  ) {
    return collectPostingsForAvatureCompany(company);
  }
  if (
    atsName === "comeet" ||
    atsName === "comeet.com" ||
    atsName === "comeetcom" ||
    atsName === "www.comeet.com" ||
    atsName === "wwwcomeetcom"
  ) {
    return collectPostingsForComeetCompany(company);
  }
  if (
    atsName === "factorialhr" ||
    atsName === "factorialhr.com" ||
    atsName === "factorialhrcom"
  ) {
    return collectPostingsForFactorialhrCompany(company);
  }
  if (
    atsName === "hireology" ||
    atsName === "hireology.careers" ||
    atsName === "hireologycareers"
  ) {
    return collectPostingsForHireologyCompany(company);
  }
  if (
    atsName === "hiringplatform" ||
    atsName === "hiringplatform.com" ||
    atsName === "hiringplatformcom"
  ) {
    return collectPostingsForHiringplatformCompany(company);
  }
  if (atsName === "homerun" || atsName === "homerun.co" || atsName === "homerunco") {
    return collectPostingsForHomerunCompany(company);
  }
  if (atsName === "jibeapply" || atsName === "jibeapply.com" || atsName === "jibeapplycom") {
    return collectPostingsForJibeapplyCompany(company);
  }
  if (atsName === "jobs2web" || atsName === "jobs2web.com" || atsName === "jobs2webcom") {
    return collectPostingsForJobs2webCompany(company);
  }
  if (
    atsName === "occupop" ||
    atsName === "occupop.com" ||
    atsName === "occupopcom" ||
    atsName === "occupop-careers.com" ||
    atsName === "occupopcareerscom"
  ) {
    return collectPostingsForOccupopCompany(company);
  }
  if (
    atsName === "peopleadmin" ||
    atsName === "peopleadmin.com" ||
    atsName === "peopleadmincom"
  ) {
    return collectPostingsForPeopleadminCompany(company);
  }
  if (
    atsName === "personio" ||
    atsName === "personio.com" ||
    atsName === "personiocom" ||
    atsName === "jobs.personio.com" ||
    atsName === "jobspersoniocom"
  ) {
    return collectPostingsForPersonioCompany(company);
  }
  if (
    atsName === "recruiterflow" ||
    atsName === "recruiterflow.com" ||
    atsName === "recruiterflowcom" ||
    atsName === "www.recruiterflow.com" ||
    atsName === "wwwrecruiterflowcom"
  ) {
    return collectPostingsForRecruiterflowCompany(company);
  }
  if (
    atsName === "softgarden" ||
    atsName === "softgarden.io" ||
    atsName === "softgardenio"
  ) {
    return collectPostingsForSoftgardenCompany(company);
  }
  if (
    atsName === "trakstar" ||
    atsName === "hire.trakstar.com" ||
    atsName === "hiretrakstarcom" ||
    atsName === "recruiterbox.com" ||
    atsName === "recruiterboxcom" ||
    atsName === "trakstarhire.com" ||
    atsName === "trakstarhirecom"
  ) {
    return collectPostingsForTrakstarCompany(company);
  }
  if (
    atsName === "ycombinator" ||
    atsName === "ycombinator.com" ||
    atsName === "ycombinatorcom" ||
    atsName === "www.ycombinator.com" ||
    atsName === "wwwycombinatorcom"
  ) {
    return collectPostingsForYcombinatorCompany(company);
  }
  if (
    atsName === "yello" ||
    atsName === "yello.co" ||
    atsName === "yelloco" ||
    atsName === "www.yello.co" ||
    atsName === "wwwyelloco"
  ) {
    return collectPostingsForYelloCompany(company);
  }
  if (
    atsName === "crelate" ||
    atsName === "crelate.com" ||
    atsName === "crelatecom" ||
    atsName === "jobs.crelate.com" ||
    atsName === "jobscrelatecom"
  ) {
    return collectPostingsForCrelateCompany(company);
  }
  if (
    atsName === "manatal" ||
    atsName === "manatal.com" ||
    atsName === "manatalcom" ||
    atsName === "careers-page.com" ||
    atsName === "careerspagecom"
  ) {
    return collectPostingsForManatalCompany(company);
  }
  if (atsName === "careerspage" || atsName === "careerspage.io" || atsName === "careerspageio") {
    return collectPostingsForCareerspageCompany(company);
  }
  if (
    atsName === "pageup" ||
    atsName === "pageuppeople" ||
    atsName === "pageuppeople.com" ||
    atsName === "pageuppeoplecom" ||
    atsName === "careers.pageuppeople.com" ||
    atsName === "careerspageuppeoplecom"
  ) {
    return collectPostingsForPageupCompany(company);
  }
  if (
    atsName === "hirebridge" ||
    atsName === "hirebridge.com" ||
    atsName === "hirebridgecom" ||
    atsName === "recruit.hirebridge.com" ||
    atsName === "recruithirebridgecom"
  ) {
    return collectPostingsForHirebridgeCompany(company);
  }
  if (atsName === "teamtailor" || atsName === "teamtailor.com" || atsName === "teamtailorcom") {
    return collectPostingsForTeamtailorCompany(company);
  }
  if (atsName === "freshteam" || atsName === "freshteam.com" || atsName === "freshteamcom") {
    return collectPostingsForFreshteamCompany(company);
  }
  if (atsName === "agilehr" || atsName === "agilehr.com" || atsName === "agilehrcom") {
    return collectPostingsForAgilehrCompany(company);
  }
  if (
    atsName === "sagehr" ||
    atsName === "sage.hr" ||
    atsName === "talent.sage.hr" ||
    atsName === "talentsagehr"
  ) {
    return collectPostingsForSagehrCompany(company);
  }
  if (atsName === "loxo" || atsName === "loxo.co" || atsName === "loxoco") {
    return collectPostingsForLoxoCompany(company);
  }
  if (atsName === "peopleforce" || atsName === "peopleforce.io" || atsName === "peopleforceio") {
    return collectPostingsForPeopleforceCompany(company);
  }
  if (atsName === "simplicant" || atsName === "simplicant.com" || atsName === "simplicantcom") {
    return collectPostingsForSimplicantCompany(company);
  }
  if (atsName === "pinpointhq" || atsName === "pinpointhq.com" || atsName === "pinpointhqcom") {
    return collectPostingsForPinpointHqCompany(company);
  }
  if (atsName === "recruitcrm" || atsName === "recruitcrm.io" || atsName === "recruitcrmiocom" || atsName === "recruitcrmio") {
    return collectPostingsForRecruitCrmCompany(company);
  }
  if (atsName === "rippling" || atsName === "rippling.com" || atsName === "ripplingcom" || atsName === "ats.rippling.com" || atsName === "atsripplingcom") {
    return collectPostingsForRipplingCompany(company);
  }
  if (atsName === "careerpuck" || atsName === "careerpuck.com" || atsName === "careerpuckcom") {
    return collectPostingsForCareerpuckCompany(company);
  }
  if (atsName === "fountain" || atsName === "fountain.com" || atsName === "fountaincom") {
    return collectPostingsForFountainCompany(company);
  }
  if (atsName === "getro" || atsName === "getro.com" || atsName === "getrocom") {
    return collectPostingsForGetroCompany(company);
  }
  if (atsName === "governmentjobs" || atsName === "governmentjobs.com" || atsName === "governmentjobscom") {
    return collectPostingsForGovernmentJobsDynamic();
  }
  if (
    atsName === "smartrecruiters" ||
    atsName === "smartrecruiters.com" ||
    atsName === "smartrecruiterscom" ||
    atsName === "jobs.smartrecruiters.com" ||
    atsName === "jobssmartrecruiterscom"
  ) {
    return collectPostingsForSmartRecruitersDynamic();
  }
  if (atsName === "policeapp" || atsName === "policeapp.com" || atsName === "policeappcom" || atsName === "www.policeapp.com" || atsName === "wwwpoliceappcom") {
    return collectPostingsForPoliceappDynamic();
  }
  if (atsName === "usajobs" || atsName === "usajobs.gov" || atsName === "usajobsgov" || atsName === "www.usajobs.gov" || atsName === "wwwusajobsgov") {
    return collectPostingsForUsajobsDynamic();
  }
  if (atsName === "k12jobspot" || atsName === "k12jobspot.com" || atsName === "k12jobspotcom" || atsName === "www.k12jobspot.com" || atsName === "wwwk12jobspotcom" || atsName === "api.k12jobspot.com" || atsName === "apik12jobspotcom") {
    return collectPostingsForK12jobspotDynamic();
  }
  if (
    atsName === "snaphunt" ||
    atsName === "snaphunt.com" ||
    atsName === "snaphuntcom" ||
    atsName === "api.snaphunt.com" ||
    atsName === "apisnaphuntcom"
  ) {
    const companyUrl = String(company?.url_string || "").trim().toLowerCase();
    if (companyUrl.includes("api.snaphunt.com/v2/jobs")) {
      return collectPostingsForSnaphuntDynamic();
    }
    return [];
  }
  if (
    atsName === "dover" ||
    atsName === "app.dover.com" ||
    atsName === "appdovercom" ||
    atsName === "www.app.dover.com" ||
    atsName === "wwwappdovercom"
  ) {
    return collectPostingsForDoverCompany(company);
  }
  if (
    atsName === "oorwin" ||
    atsName === "oorwin.com" ||
    atsName === "oorwincom" ||
    atsName === "api.oorwin.ai" ||
    atsName === "apioorwinai" ||
    atsName.endsWith(".oorwin.com") ||
    atsName.endsWith(".oorwin.ai")
  ) {
    return collectPostingsForOorwinCompany(company);
  }
  if (atsName === "schoolspring" || atsName === "schoolspring.com" || atsName === "schoolspringcom" || atsName === "api.schoolspring.com" || atsName === "apischoolspringcom" || atsName === "www.schoolspring.com" || atsName === "wwwschoolspringcom") {
    return collectPostingsForSchoolspringDynamic();
  }
  if (
    atsName === "edjoin" ||
    atsName === "edjoin.org" ||
    atsName === "edjoinorg" ||
    atsName === "www.edjoin.org" ||
    atsName === "wwwedjoinorg"
  ) {
    return collectPostingsForEdjoinDynamic();
  }
  if (
    atsName === "webcruiter" ||
    atsName === "webcruiter.com" ||
    atsName === "webcruitercom" ||
    atsName === "candidate.webcruiter.com" ||
    atsName === "candidatewebcruitercom"
  ) {
    return collectPostingsForWebcruiterDynamic();
  }
  if (
    atsName === "academicjobsonline" ||
    atsName === "academicjobsonline.org" ||
    atsName === "academicjobsonlineorg" ||
    atsName === "www.academicjobsonline.org" ||
    atsName === "wwwacademicjobsonlineorg"
  ) {
    return collectPostingsForAcademicJobsOnlineDynamic();
  }
  if (
    atsName === "calcareers" ||
    atsName === "calcareers.ca.gov" ||
    atsName === "calcareerscagov" ||
    atsName === "www.calcareers.ca.gov" ||
    atsName === "wwwcalcareerscagov"
  ) {
    return collectPostingsForCalcareersDynamic();
  }
  if (
    atsName === "calopps" ||
    atsName === "calopps.org" ||
    atsName === "caloppsorg" ||
    atsName === "www.calopps.org" ||
    atsName === "wwwcaloppsorg"
  ) {
    return collectPostingsForCaloppsDynamic();
  }
  if (
    atsName === "statejobsny" ||
    atsName === "statejobsny.com" ||
    atsName === "statejobsnycom" ||
    atsName === "www.statejobsny.com" ||
    atsName === "wwwstatejobsnycom"
  ) {
    return collectPostingsForStatejobsnyDynamic();
  }
  if (
    atsName === "hcareers" ||
    atsName === "hcareers.com" ||
    atsName === "hcareerscom" ||
    atsName === "www.hcareers.com" ||
    atsName === "wwwhcareerscom"
  ) {
    return collectPostingsForHcareersDynamic();
  }
  if (
    atsName === "amazon" ||
    atsName === "amazon.jobs" ||
    atsName === "amazonjobs" ||
    atsName === "www.amazon.jobs" ||
    atsName === "wwwamazonjobs"
  ) {
    return collectPostingsForAmazonDynamic();
  }
  // Every employer read through the shared sitemap/JSON-LD engine dispatches by its own
  // key, so adding one there needs no branch here. Host spellings ("careers.walmart.com")
  // are folded onto the key first, the way the hand-written branches above accept theirs.
  const careerSiteKey = normalizeAtsFilterValue(atsName);
  if (CAREER_SITE_KEYS.includes(careerSiteKey)) {
    return collectPostingsForCareerSiteDynamic(careerSiteKey);
  }
  if (atsName === "hrmdirect" || atsName === "hrmdirect.com" || atsName === "hrmdirectcom") {
    return collectPostingsForHrmDirectCompany(company);
  }
  if (atsName === "talentlyft" || atsName === "talentlyft.com" || atsName === "talentlyftcom") {
    return collectPostingsForTalentlyftCompany(company);
  }
  if (atsName === "talexio" || atsName === "talexio.com" || atsName === "talexiocom") {
    return collectPostingsForTalexioCompany(company);
  }
  if (
    atsName === "saphrcloud" ||
    atsName === "saphrcloud.com" ||
    atsName === "saphrcloudcom" ||
    atsName === "jobs.hr.cloud.sap" ||
    atsName === "jobshrcloudsap"
  ) {
    return collectPostingsForSapHrCloudCompany(company);
  }
  if (atsName === "recruiteecom" || atsName === "recruitee.com" || atsName === "recruitee") {
    return collectPostingsForRecruiteeCompany(company);
  }
  if (atsName === "ultipro") {
    return collectPostingsForUltiProCompany(company);
  }
  if (
    atsName === "ukg" ||
    atsName === "ukg.net" ||
    atsName === "ukgnet" ||
    atsName === "rec.pro.ukg.net" ||
    atsName === "recproukgnet"
  ) {
    return collectPostingsForUkgCompany(company);
  }
  if (atsName === "taleo" || atsName === "taleo.net" || atsName === "taleonet") {
    return collectPostingsForTaleoCompany(company);
  }
  return [];
}


// Least-recently-synced first, which is what makes a pass resumable.
//
// This had no ORDER BY, so every pass walked the same 61,612 companies in rowid order. A
// pass takes hours; any restart sent it back to the front of that list to re-crawl what it
// had just done, and anything past the point it reached was never visited at all. Whole
// ATS platforms sitting late in the table could go permanently unsynced without anything
// looking wrong.
//
// Ordering by last_synced_epoch removes the need for pass bookkeeping entirely: a restart
// naturally continues with the companies nobody has looked at longest, and every company is
// reached eventually no matter how often the process is interrupted. Never-synced companies
// (NULL) sort first, so a newly seeded platform is picked up before anything is revisited.
// Marks are buffered rather than written per company. A pass covers 61,612 of them, and one
// UPDATE each would put 61,612 write transactions in front of the posting flushes they are
// competing with. Losing a buffered mark on a crash is harmless -- the company is simply
// re-crawled on the next lap, which is idempotent.
const COMPANY_SYNC_MARK_BATCH = Number(process.env.SYNC_MARK_BATCH_SIZE || 250);
let pendingCompanySyncMarks = [];

function markCompanySynced(companyId, epoch) {
  pendingCompanySyncMarks.push({ id: Number(companyId), epoch: Number(epoch) || nowEpochSeconds() });
  if (pendingCompanySyncMarks.length >= COMPANY_SYNC_MARK_BATCH) {
    // Fire and forget: progress bookkeeping must never hold up or fail a sync pass.
    flushCompanySyncMarks().catch(() => {});
  }
}

async function flushCompanySyncMarks() {
  if (pendingCompanySyncMarks.length === 0) return 0;
  const batch = pendingCompanySyncMarks.splice(0, pendingCompanySyncMarks.length);
  const epoch = batch[batch.length - 1].epoch;
  const ids = [...new Set(batch.map((entry) => entry.id).filter(Boolean))];
  if (ids.length === 0) return 0;

  try {
    const placeholders = ids.map(() => "?").join(", ");
    await runInWriteTransaction(async (handle) => {
      await handle.run(
        `UPDATE companies SET last_synced_epoch = ? WHERE id IN (${placeholders});`,
        [epoch, ...ids]
      );
    });
    return ids.length;
  } catch (error) {
    // A lost mark costs a re-crawl, not data. Not worth failing the pass or filling the
    // error banner.
    return 0;
  }
}

// Coverage, as opposed to pass position. syncStatus.progress lives in memory and resets to
// 0 on every restart, so it answers "how far into this run are we" and cannot answer the
// question that actually matters after an interruption: is anything being starved. This
// reads last_synced_epoch, so it survives restarts by construction.
//
// Scoped to the platforms currently enabled for sync. Counting the disabled ones would
// report them as permanently unsynced, which is true and completely uninteresting.
// The time a posting was last actually written, which is not what last_seen_epoch records.
// That column is stamped with syncReferenceEpoch -- captured once when a pass starts -- so
// every row a pass writes carries the pass's start time. Reading MAX(last_seen_epoch) as
// "when did we last write" therefore reports the age of the current pass, and made the
// liveness watchdog fire a false stall on every pass longer than its threshold.
async function recordSyncWriteHeartbeat(epoch = nowEpochSeconds()) {
  try {
    const db = getDb();
    if (!db) return;
    await db.run(
      `INSERT INTO sync_write_heartbeat (id, wrote_at_epoch) VALUES (1, ?)
       ON CONFLICT(id) DO UPDATE SET wrote_at_epoch = excluded.wrote_at_epoch;`,
      [epoch]
    );
  } catch {
    // Heartbeat bookkeeping must never fail a sync write.
  }
}

async function getLastSyncWriteEpoch() {
  try {
    const db = getReadDb();
    if (!db) return 0;
    const row = await db.get(`SELECT wrote_at_epoch FROM sync_write_heartbeat WHERE id = 1;`);
    return Number(row?.wrote_at_epoch || 0);
  } catch {
    return 0;
  }
}

async function getSyncCoverageStats(withinSeconds = 24 * 60 * 60) {
  const db = getReadDb();
  if (!db) return null;

  const enabled = normalizeSyncEnabledAts(Array.from(getSyncEnabledAts()));
  if (enabled.length === 0) {
    return { enabled_companies: 0, never_synced: 0, synced_within_window: 0, stale: 0, oldest_sync_age_seconds: null, window_seconds: withinSeconds };
  }

  const now = nowEpochSeconds();
  const cutoff = now - withinSeconds;
  const placeholders = enabled.map(() => "?").join(", ");
  const row = await db.get(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN last_synced_epoch IS NULL THEN 1 ELSE 0 END) AS never_synced,
       SUM(CASE WHEN last_synced_epoch >= ? THEN 1 ELSE 0 END) AS recent,
       MIN(last_synced_epoch) AS oldest
     FROM companies
     WHERE LOWER(TRIM(ATS_name)) IN (${placeholders})
       AND NOT EXISTS (
         SELECT 1 FROM blocked_companies b
         WHERE b.normalized_company_name = LOWER(TRIM(companies.company_name))
       );`,
    [cutoff, ...enabled]
  );

  const total = Number(row?.total || 0);
  const neverSynced = Number(row?.never_synced || 0);
  const recent = Number(row?.recent || 0);
  const oldest = Number(row?.oldest || 0);
  return {
    enabled_companies: total,
    never_synced: neverSynced,
    synced_within_window: recent,
    // Seen at some point, but not inside the window -- the ones drifting toward starvation.
    stale: Math.max(0, total - recent - neverSynced),
    oldest_sync_age_seconds: oldest > 0 ? now - oldest : null,
    window_seconds: withinSeconds
  };
}

async function getCompaniesForSync() {
  const db = getDb();
  const rows = await db.all(
    `
      SELECT id, company_name, url_string, ATS_name, last_synced_epoch
      FROM companies
      WHERE NOT EXISTS (
        SELECT 1
        FROM blocked_companies b
        WHERE b.normalized_company_name = LOWER(TRIM(companies.company_name))
      )
      ORDER BY COALESCE(last_synced_epoch, 0) ASC, id ASC;
    `
  );

  const enabledAts = new Set(normalizeSyncEnabledAts(Array.from(getSyncEnabledAts())));
  // Staleness first, and only then the old ATS/name grouping as a deterministic tiebreak.
  //
  // This used to sort by ATS name and discard the query's order entirely, which is what made
  // the "missing platforms" problem structural rather than incidental: the pass worked
  // through platforms alphabetically, so an interrupted run always re-did the ones near the
  // start of the alphabet and the ones near the end were never reached at all.
  //
  // Grouping by ATS is not load-bearing. Rate limiting is enforced per platform inside the
  // request queue, so interleaving platforms is if anything gentler -- concurrent workers
  // spread across several hosts instead of hammering one.
  return rows
    .filter((row) => enabledAts.has(normalizeAtsFilterValue(row?.ATS_name)))
    .sort((a, b) => {
      const aSynced = Number(a?.last_synced_epoch || 0);
      const bSynced = Number(b?.last_synced_epoch || 0);
      if (aSynced !== bSynced) return aSynced - bSynced;
      const atsCompare = String(a?.ATS_name || "").localeCompare(String(b?.ATS_name || ""));
      if (atsCompare !== 0) return atsCompare;
      return String(a?.company_name || "").localeCompare(String(b?.company_name || ""));
    });
}


// Round-robin across ATS platforms, preserving staleness order within each.
//
// The target list was shuffled before this, which spread load across platforms but threw
// away the ordering getCompaniesForSync had just applied. Since no pass has ever run to
// completion -- 67,784 targets at several hours, against restarts -- a shuffled list means
// each pass samples a random subset, so coverage creeps up by luck. That is why ~4,000
// companies stayed permanently unreached no matter how many passes ran: nothing guaranteed
// they were ever near the front.
//
// Interleaving gets both properties. Consecutive targets belong to different platforms, so
// eight workers do not pile onto one board's rate limit, while the stalest company of every
// platform is still reached first and an interrupted pass has made real progress rather
// than random progress.
function interleaveTargetsByAts(companies) {
  const byAts = new Map();
  for (const company of companies) {
    const key = normalizeAtsFilterValue(company?.ATS_name) || "unknown";
    if (!byAts.has(key)) byAts.set(key, []);
    // Order within a platform is the staleness order already applied upstream.
    byAts.get(key).push(company);
  }

  const queues = Array.from(byAts.values());
  const interleaved = [];
  let index = 0;
  let placed = true;
  while (placed) {
    placed = false;
    for (const queue of queues) {
      if (index < queue.length) {
        interleaved.push(queue[index]);
        placed = true;
      }
    }
    index += 1;
  }
  return interleaved;
}

function shuffleArrayInPlace(values) {
  const items = Array.isArray(values) ? values : [];
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}


// Board-wide collectors sweep an entire job board in one target rather than one employer, and most
// of them only keep postings from the last 24 hours. Appended after the ~68k company targets they
// were reached at the tail of a multi-hour run, by which point a day of postings had already aged
// out of their window — Hcareers never stored a single row that way. They are queued first now, so
// every sync collects them within its first minute. ATS_name doubles as the enabled-ATS key.
const BOARD_WIDE_SYNC_TARGETS = [
  {
    company_name: "GovernmentJobs (dynamic)",
    url_string: "https://www.governmentjobs.com/jobs",
    ATS_name: "governmentjobs"
  },
  {
    company_name: "PoliceApp (dynamic)",
    url_string:
      "https://www.policeapp.com/jobs/urlrewrite_jobpostings/jobResultsAjax.ashx?j=0&r=50&s=0&p=0",
    ATS_name: "policeapp"
  },
  {
    company_name: "USAJobs (dynamic)",
    url_string: "https://www.usajobs.gov/Search/ExecuteSearch",
    ATS_name: "usajobs"
  },
  {
    company_name: "K12JobSpot (dynamic)",
    url_string: "https://api.k12jobspot.com/api/Jobs/Search",
    ATS_name: "k12jobspot"
  },
  // Snaphunt is deliberately absent: api.snaphunt.com stopped resolving (authoritative NXDOMAIN)
  // and snaphunt.com is now a marketing site whose own "job listing" link 404s, so the target only
  // ever produced a DNS error. The ATS stays in the registry so postings already stored under it
  // remain filterable; re-add a target here if a public feed reappears.
  {
    company_name: "SchoolSpring (dynamic)",
    url_string:
      "https://api.schoolspring.com/api/Jobs/GetPagedJobsWithSearch?domainName=&keyword=&location=&category=&gradelevel=&jobtype=&organization=&swLat=&swLon=&neLat=&neLon=&page=1&size=25&sortDateAscending=false",
    ATS_name: "schoolspring"
  },
  {
    company_name: "CalCareers (dynamic)",
    url_string: "https://calcareers.ca.gov/CalHRPublic/Search/JobSearchResults.aspx",
    ATS_name: "calcareers"
  },
  {
    company_name: "CalOpps (dynamic)",
    url_string: "https://www.calopps.org/job-search-list",
    ATS_name: "calopps"
  },
  {
    company_name: "StateJobsNY (dynamic)",
    url_string: "https://www.statejobsny.com/public/vacancyTable.cfm",
    ATS_name: "statejobsny"
  },
  {
    company_name: "Hcareers (dynamic)",
    url_string: "https://www.hcareers.com/jobs/recent",
    ATS_name: "hcareers"
  },
  {
    company_name: "EdJoin (dynamic)",
    url_string:
      "https://www.edjoin.org/Home/LoadJobs?rows=25&page=1&sort=postingDate&sortVal=2&order=desc&keywords=&location=&searchType=all&regions=&jobTypes=&days=0&empType=&catID=0&onlineApps=false&recruitmentCenterID=0&stateID=0&regionID=0&districtID=0&searchID=0",
    ATS_name: "edjoin"
  },
  {
    company_name: "Webcruiter (dynamic)",
    url_string: "https://candidate.webcruiter.com/en-gb/home/alladverts/webcruiter-id#search",
    ATS_name: "webcruiter"
  },
  {
    company_name: "AcademicJobsOnline (dynamic)",
    url_string: "https://academicjobsonline.org/ajo?joblst---0----0-p--",
    ATS_name: "academicjobsonline"
  },
  // Amazon runs its own careers platform rather than renting an ATS, so there is no seeded
  // company row that could reach it. It belongs here for the same reason the boards above
  // do: one target sweeps the whole employer.
  {
    company_name: "Amazon Jobs (dynamic)",
    url_string: "https://www.amazon.jobs/en/search.json?sort=recent",
    ATS_name: "amazon"
  },
  // Employers read through the shared sitemap/JSON-LD engine. Listing them from the config
  // keeps this table and the collector from drifting apart as employers are added.
  ...CAREER_SITE_KEYS.map((siteKey) => {
    const config = CAREER_SITE_CONFIGS[siteKey];
    // Name the sitemap the sweep will actually read, so this row stays a usable pointer for
    // an operator checking a board by hand rather than a path that 404s.
    const sitemapPath = Array.isArray(config.sitemap_paths) && config.sitemap_paths.length > 0
      ? config.sitemap_paths[0]
      : "/sitemap.xml";
    return {
      company_name: `${config.label} (dynamic)`,
      url_string: new URL(sitemapPath, `${config.origin}/`).toString(),
      ATS_name: siteKey
    };
  })
];

// Runs flushes one at a time, and — the point of it — advances the queue with a settled
// promise rather than the caller's. The previous version assigned the caller's promise
// back to the chain, which poisoned it permanently: once a single flush rejected, every
// later `.then(onFulfilled)` was skipped instead of run, so the flush function was never
// called again for the rest of the pass. The crawl itself was unaffected, so one transient
// write failure turned into 18 hours of collecting hundreds of thousands of postings into
// memory and storing none of them, while the stall watchdog watched company progress tick
// happily upwards. Same shape as runInWriteTransaction: the rejection goes to the caller,
// a neutral promise goes to the chain.
function createSerialFlushQueue(flush) {
  let chain = Promise.resolve();
  return (force = false) => {
    const run = chain.then(
      () => flush(force),
      () => flush(force)
    );
    chain = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  };
}

async function runAtsSyncInternal() {
  const passGeneration = syncGeneration;
  const passAbortController = new AbortController();
  activeSyncAbortController = passAbortController;
  const syncReferenceEpoch = nowEpochSeconds();
  lastSyncProgressAtMs = Date.now();
  syncStatus.running = true;
  syncStatus.started_at = new Date().toISOString();
  syncStatus.progress = { current: 0, total: 0, company_name: "", total_collected: 0 };
  syncStatus.last_error = null;
  syncStatus.postings_stored = 0;
  syncStatus.new_postings = 0;
  syncStatus.refreshed_postings = 0;
  syncStatus.last_progress_at = syncStatus.started_at;
  syncStatus.last_write_at = null;
  syncStatus.flush_failures = 0;
  syncStatus.last_flush_error = null;
  syncStatus.last_flush_error_at = null;
  syncStatus.active_targets = [];
  syncStatus.target_timeouts = 0;
  syncStatus.last_target_timeout_at = null;
  syncStatus.recent_target_timeout_epochs_ms = [];
  syncStatus.worker_concurrency = SYNC_WORKER_CONCURRENCY;
  syncStatus.target_timeout_seconds = Math.round(SYNC_TARGET_TIMEOUT_MS / 1000);
  activeSyncTargetsByWorker.clear();

  try {
    const companies = await getCompaniesForSync();
    const enabledAts = new Set(normalizeSyncEnabledAts(Array.from(getSyncEnabledAts())));
    const shuffledCompanies = interleaveTargetsByAts(companies);
    const syncTargets = [];
    for (const boardTarget of BOARD_WIDE_SYNC_TARGETS) {
      if (!enabledAts.has(boardTarget.ATS_name)) continue;
      syncTargets.push({ id: null, ...boardTarget });
    }

    let smartRecruitersInserted = false;
    let companyInsertionsSinceSmartRecruiters = 0;
    for (const company of shuffledCompanies) {
      syncTargets.push(company);
      companyInsertionsSinceSmartRecruiters += 1;

      if (
        enabledAts.has("smartrecruiters") &&
        companyInsertionsSinceSmartRecruiters >= SMARTRECRUITERS_INSERT_EVERY_N_TARGETS
      ) {
        syncTargets.push({
          id: null,
          company_name: "SmartRecruiters (dynamic)",
          url_string: "https://jobs.smartrecruiters.com/sr-jobs/search",
          ATS_name: "smartrecruiters"
        });
        smartRecruitersInserted = true;
        companyInsertionsSinceSmartRecruiters = 0;
      }
    }

    if (enabledAts.has("smartrecruiters") && companyInsertionsSinceSmartRecruiters > 0) {
      syncTargets.push({
        id: null,
        company_name: "SmartRecruiters (dynamic)",
        url_string: "https://jobs.smartrecruiters.com/sr-jobs/search",
        ATS_name: "smartrecruiters"
      });
      smartRecruitersInserted = true;
    }

    if (enabledAts.has("smartrecruiters") && !smartRecruitersInserted) {
      syncTargets.push({
        id: null,
        company_name: "SmartRecruiters (dynamic)",
        url_string: "https://jobs.smartrecruiters.com/sr-jobs/search",
        ATS_name: "smartrecruiters"
      });
    }

    syncStatus.progress.total = syncTargets.length;
    const errors = [];
    let totalPruned = 0;
    let postingDatePruned = 0;
    let hiddenDeleted = 0;
    try {
      totalPruned = await pruneExpiredPostings(syncReferenceEpoch);
    } catch (error) {
      errors.push({
        company_name: "__system__",
        ats_name: "__system__",
        message: `pruneExpiredPostings failed: ${String(error?.message || error)}`
      });
    }
    try {
      postingDatePruned = await prunePostingsOutsideDateWindow(syncReferenceEpoch);
    } catch (error) {
      errors.push({
        company_name: "__system__",
        ats_name: "__system__",
        message: `prunePostingsOutsideDateWindow failed: ${String(error?.message || error)}`
      });
    }
    const postingLocationByJobUrl = getPostingLocationByJobUrl();
    // Mutated in place rather than cloned. This used to be `new Map(postingLocationByJobUrl)`,
    // which duplicated one entry per stored posting -- 886,773 URL/location string pairs --
    // at the start of every pass, so the process carried two full copies for the pass's
    // entire multi-hour duration. That is most of the 2.2 GB resident this was observed at,
    // on a host with 8 GB, and the memory pressure is the likeliest cause of the API errors
    // and the MCP disconnect that surfaced alongside it.
    //
    // The clone bought nothing: the map is a cache of a column already in the database, and
    // both copies were replaced by the same object at the end of the pass anyway.
    const nextPostingLocationByJobUrl = postingLocationByJobUrl;

    // Tracks which job_posting_urls have already been queued this run, without holding onto the
    // full posting payload (job descriptions can be large and this set stays alive for the whole
    // multi-hour sync — retaining full objects here previously caused unbounded memory growth).
    const dedupedPostingUrls = new Set();
    const pendingPostingsForUpsert = [];
    let excludedByPostingDate = 0;
    let nextCompanyIndex = 0;
    let completedCompanies = 0;
    const workerCount = Math.min(SYNC_WORKER_CONCURRENCY, Math.max(1, syncTargets.length));

    const flushPendingPostings = async (force = false) => {
      if (!Array.isArray(pendingPostingsForUpsert) || pendingPostingsForUpsert.length === 0) return;
      if (!force && pendingPostingsForUpsert.length < SYNC_POSTING_FLUSH_BATCH_SIZE) return;

      const batch = pendingPostingsForUpsert.splice(0, pendingPostingsForUpsert.length);
      if (batch.length === 0) return;
      try {
        const writeCounts = await upsertPostings(batch, syncReferenceEpoch);
        // Real wall-clock time of a real write, unlike syncReferenceEpoch.
        const wroteAt = new Date();
        await recordSyncWriteHeartbeat(Math.floor(wroteAt.getTime() / 1000));
        if (syncGeneration === passGeneration) {
          syncStatus.postings_stored += batch.length;
          syncStatus.new_postings += Number(writeCounts?.inserted || 0);
          syncStatus.refreshed_postings += Number(writeCounts?.refreshed || 0);
          syncStatus.last_write_at = wroteAt.toISOString();
          syncStatus.flush_failures = 0;
        }
      } catch (error) {
        // The batch was spliced off before the write, so a failure loses it -- the postings
        // in it are not retried and are only picked up by a later pass. Worth a durable
        // record, but only on the transition into failure: a pass whose every write fails
        // would otherwise write thousands of identical rows into the banner.
        if (syncGeneration === passGeneration) {
          const firstFailure = syncStatus.flush_failures === 0;
          syncStatus.flush_failures += 1;
          syncStatus.last_flush_error = String(error?.message || error);
          syncStatus.last_flush_error_at = new Date().toISOString();
          if (firstFailure) {
            await recordError({
              source: "sync",
              operation: "flushPendingPostings",
              message: `Sync could not store collected postings: ${String(error?.message || error)}`,
              context: { dropped_postings: batch.length, started_at: syncStatus.started_at }
            });
          }
        }
        throw error;
      }
    };

    const queueFlushPendingPostings = createSerialFlushQueue(flushPendingPostings);

    const runSyncWorker = async (workerIndex) => {
      while (true) {
        // This pass was abandoned as stalled; stop rather than compete with its
        // replacement for targets, memory and DB writes.
        if (syncGeneration !== passGeneration) return;
        const currentIndex = nextCompanyIndex;
        if (currentIndex >= syncTargets.length) return;
        nextCompanyIndex += 1;

        const company = syncTargets[currentIndex];
        const workerNumber = workerIndex + 1;
        activeSyncTargetsByWorker.set(workerNumber, {
          worker: workerNumber,
          company_name: String(company?.company_name || ""),
          ats_name: String(company?.ATS_name || ""),
          started_at: new Date().toISOString()
        });
        publishActiveSyncTargets();
        const targetAbortController = new AbortController();
        const abortTargetFromPass = () => {
          targetAbortController.abort(
            passAbortController.signal.reason || new Error("Sync pass was abandoned")
          );
        };
        if (passAbortController.signal.aborted) abortTargetFromPass();
        else passAbortController.signal.addEventListener("abort", abortTargetFromPass, { once: true });
        const targetTimeout = setTimeout(() => {
          if (targetAbortController.signal.aborted) return;
          syncStatus.target_timeouts = Number(syncStatus.target_timeouts || 0) + 1;
          syncStatus.last_target_timeout_at = new Date().toISOString();
          const nowMs = Date.now();
          const cutoffMs = nowMs - RECENT_TARGET_TIMEOUT_WINDOW_MS;
          syncStatus.recent_target_timeout_epochs_ms = [
            ...(syncStatus.recent_target_timeout_epochs_ms || []).filter((epochMs) => epochMs >= cutoffMs),
            nowMs
          ];
          const error = new Error(
            `Sync target timed out after ${Math.round(SYNC_TARGET_TIMEOUT_MS / 1000)}s: ` +
              `${company.company_name} (${company.ATS_name || "unknown"})`
          );
          error.name = "TimeoutError";
          targetAbortController.abort(error);
        }, SYNC_TARGET_TIMEOUT_MS);
        if (typeof targetTimeout.unref === "function") targetTimeout.unref();
        try {
          const companyAts = normalizeAtsFilterValue(company?.ATS_name);
          const currentlyEnabledAts = new Set(normalizeSyncEnabledAts(Array.from(getSyncEnabledAts())));
          if (!currentlyEnabledAts.has(companyAts)) {
            continue;
          }

          const collectionPromise = runWithRequestSignal(targetAbortController.signal, () =>
            collectPostingsForCompany(company, {
              downloadJobDescriptions: getSyncDownloadJobDescriptions()
            })
          );
          const postings = await raceWithAbortSignal(collectionPromise, targetAbortController.signal);
          for (const posting of postings) {
            if (!shouldStorePostingByDate(posting?.posting_date, syncReferenceEpoch)) {
              excludedByPostingDate += 1;
              continue;
            }
            if (dedupedPostingUrls.has(posting.job_posting_url)) continue;
            dedupedPostingUrls.add(posting.job_posting_url);

            const directLocation = String(posting?.location || "").trim();
            const inferredLocation = String(inferPostingLocationFromJobUrl(posting?.job_posting_url) || "").trim();
            const existingLocation = String(postingLocationByJobUrl.get(posting?.job_posting_url) || "").trim();
            const location = directLocation || inferredLocation || existingLocation;
            // Resolve before queueing so the persisted row carries the same value the
            // in-memory map gets, rather than only whatever the source happened to send.
            posting.location = location || null;
            pendingPostingsForUpsert.push(posting);

            if (location) {
              nextPostingLocationByJobUrl.set(posting.job_posting_url, location);
              postingLocationByJobUrl.set(posting.job_posting_url, location);
            }
          }
        } catch (error) {
          errors.push({
            company_name: company.company_name,
            ats_name: company.ATS_name || "",
            message: String(error?.message || error)
          });
        } finally {
          clearTimeout(targetTimeout);
          passAbortController.signal.removeEventListener("abort", abortTargetFromPass);
          activeSyncTargetsByWorker.delete(workerNumber);
          publishActiveSyncTargets();
          // Marked on completion whether or not it succeeded. A company that always fails
          // must not stay at the head of the queue forever, starving everything behind it --
          // it gets its turn again on the next lap like everything else.
          if (company?.id) {
            markCompanySynced(company.id, syncReferenceEpoch);
          }
          if (pendingPostingsForUpsert.length >= SYNC_POSTING_FLUSH_BATCH_SIZE) {
            try {
              await queueFlushPendingPostings(false);
            } catch (error) {
              errors.push({
                company_name: "__system__",
                ats_name: "__system__",
                message: `queueFlushPendingPostings failed: ${String(error?.message || error)}`
              });
            }
          }
          completedCompanies += 1;
          // A worker abandoned mid-company still reaches here, so don't resurrect
          // progress the watchdog has already cleared.
          if (syncGeneration === passGeneration) {
            lastSyncProgressAtMs = Date.now();
            syncStatus.last_progress_at = new Date(lastSyncProgressAtMs).toISOString();
            // Attribution, not estimation. A first attempt at accounting for a 4.8 GB
            // process from posting counts explained under half a gigabyte, so the real
            // shape of the growth has to be measured. external/arrayBuffers separates
            // "JS objects we are retaining" from "HTTP response buffers we are not
            // releasing", which are different bugs with different fixes.
            const memory = process.memoryUsage();
            syncStatus.memory = {
              rss_mb: Math.round(memory.rss / 1048576),
              heap_used_mb: Math.round(memory.heapUsed / 1048576),
              heap_total_mb: Math.round(memory.heapTotal / 1048576),
              external_mb: Math.round(memory.external / 1048576),
              array_buffers_mb: Math.round((memory.arrayBuffers || 0) / 1048576),
              pending_postings: pendingPostingsForUpsert.length,
              deduped_urls: dedupedPostingUrls.size,
              location_map: nextPostingLocationByJobUrl.size
            };
            const elapsedSeconds = Math.max(1, (lastSyncProgressAtMs - Date.parse(syncStatus.started_at)) / 1000);
            const targetsPerMinute = completedCompanies / (elapsedSeconds / 60);
            const remainingTargets = Math.max(0, syncTargets.length - completedCompanies);
            const etaSeconds = targetsPerMinute > 0 ? Math.round((remainingTargets / targetsPerMinute) * 60) : null;
            syncStatus.progress = {
              current: completedCompanies,
              total: syncTargets.length,
              company_name: `${company.company_name} (${company.ATS_name})`,
              ats_name: String(company.ATS_name || ""),
              total_collected: dedupedPostingUrls.size,
              percent: syncTargets.length > 0 ? Math.round((completedCompanies / syncTargets.length) * 1000) / 10 : 0,
              targets_per_minute: Math.round(targetsPerMinute * 10) / 10,
              eta_seconds: etaSeconds
            };
          }
        }
      }
    };

    if (syncTargets.length > 0) {
      await Promise.all(Array.from({ length: workerCount }, (_value, workerIndex) => runSyncWorker(workerIndex)));
    }

    try {
      await queueFlushPendingPostings(true);
    } catch (error) {
      errors.push({
        company_name: "__system__",
        ats_name: "__system__",
        message: `final queueFlushPendingPostings failed: ${String(error?.message || error)}`
      });
    }

    try {
      totalPruned += await pruneExpiredPostings(syncReferenceEpoch);
    } catch (error) {
      errors.push({
        company_name: "__system__",
        ats_name: "__system__",
        message: `post-sync pruneExpiredPostings failed: ${String(error?.message || error)}`
      });
    }
    try {
      postingDatePruned += await prunePostingsOutsideDateWindow(syncReferenceEpoch);
    } catch (error) {
      errors.push({
        company_name: "__system__",
        ats_name: "__system__",
        message: `post-sync prunePostingsOutsideDateWindow failed: ${String(error?.message || error)}`
      });
    }
    // Only after the pass, not before: the delete is the one irreversible step here, and
    // running it once per pass on rows hidden a month ago is not worth doing twice.
    try {
      hiddenDeleted = await deleteExpiredHiddenPostings(syncReferenceEpoch);
    } catch (error) {
      errors.push({
        company_name: "__system__",
        ats_name: "__system__",
        message: `deleteExpiredHiddenPostings failed: ${String(error?.message || error)}`
      });
    }
    // A pass rewrites a large fraction of the table, so the stats the planner relies on to
    // pick idx_postings_hidden_last_seen_epoch for the listing sort go stale. Refreshing
    // here keeps the sort on the index instead of silently regressing to a temp b-tree.
    try {
      await getDb().exec(`PRAGMA optimize;`);
    } catch (error) {
      errors.push({
        company_name: "__system__",
        ats_name: "__system__",
        message: `PRAGMA optimize failed: ${String(error?.message || error)}`
      });
    }
    try {
      const activeJobPostingUrls = await getActiveJobPostingUrls();
      for (const jobPostingUrl of nextPostingLocationByJobUrl.keys()) {
        if (!activeJobPostingUrls.has(jobPostingUrl)) {
          nextPostingLocationByJobUrl.delete(jobPostingUrl);
        }
      }
    } catch (error) {
      errors.push({
        company_name: "__system__",
        ats_name: "__system__",
        message: `pruning postingLocationByJobUrl cache failed: ${String(error?.message || error)}`
      });
    }
    setPostingLocationByJobUrl(nextPostingLocationByJobUrl);
    let syncScopeStats = {
      sync_enabled_company_count: 0,
      configured_enabled_ats_count: 0,
      excluded_ats_count: 0
    };
    try {
      syncScopeStats = await getSyncScopeStats();
    } catch (error) {
      errors.push({
        company_name: "__system__",
        ats_name: "__system__",
        message: `getSyncScopeStats failed: ${String(error?.message || error)}`
      });
    }

    const failedCompaniesByAts = {};
    for (const error of errors) {
      const atsName = String(error?.ats_name || "unknown");
      failedCompaniesByAts[atsName] = (failedCompaniesByAts[atsName] || 0) + 1;
    }

    // An abandoned pass must not publish its partial results as the latest sync.
    if (syncGeneration !== passGeneration) return;

    syncStatus.last_sync_at = new Date().toISOString();
    syncStatus.last_sync_summary = {
      total_companies: syncTargets.length,
      ...syncScopeStats,
      total_postings_stored: dedupedPostingUrls.size,
      new_postings: syncStatus.new_postings,
      refreshed_postings: syncStatus.refreshed_postings,
      worker_concurrency: workerCount,
      ats_request_queue_concurrency: getAtsRequestQueueConcurrency(),
      failed_companies: errors.length,
      failed_companies_by_ats: failedCompaniesByAts,
      expired_pruned: totalPruned,
      posting_date_pruned: postingDatePruned,
      hidden_postings_deleted: hiddenDeleted,
      excluded_during_sync_by_posting_date: excludedByPostingDate,
      errors: errors.slice(0, 30)
    };

    // The tail of the progress buffer, so the final partial batch is recorded rather than
    // re-crawled next time.
    await flushCompanySyncMarks();

    // Description fetching used to be kicked off from here, on the end of a completed
    // pass. That was the wrong clock: a pass over tens of thousands of companies runs for
    // hours, so on a real database the hook effectively never fired and every field that
    // depends on fetching a posting's own page stayed empty. It now runs on its own
    // interval -- see services/enrichment-runtime.js.
  } catch (error) {
    if (syncGeneration === passGeneration) {
      syncStatus.last_error = String(error?.message || error);
    }
  } finally {
    if (activeSyncAbortController === passAbortController) {
      activeSyncAbortController = null;
    }
    // An abandoned pass may settle long after its replacement started; it must not
    // report that pass as finished or wipe its progress.
    if (syncGeneration === passGeneration) {
      syncStatus.running = false;
      syncStatus.progress = null;
    }
  }
}

// Abandons a pass that has stopped making progress, aborting its queue waits and in-flight
// response bodies before the next scheduled tick starts a replacement.
function recoverStalledSync() {
  if (!syncStatus.running) return false;
  const stalledForMs = Date.now() - lastSyncProgressAtMs;
  if (!(lastSyncProgressAtMs > 0) || stalledForMs < SYNC_STALL_TIMEOUT_MS) return false;

  const progressLabel = syncStatus.progress
    ? `${syncStatus.progress.current}/${syncStatus.progress.total}`
    : "no progress recorded";
  console.error(
    `[OpenPostings API] sync made no progress for ${Math.round(stalledForMs / 1000)}s (${progressLabel}); abandoning it`
  );

  syncGeneration += 1;
  const stalledController = activeSyncAbortController;
  activeSyncAbortController = null;
  if (stalledController && !stalledController.signal.aborted) {
    stalledController.abort(
      new Error(`Sync pass abandoned after ${Math.round(stalledForMs / 1000)}s without progress (${progressLabel})`)
    );
  }
  activeSyncTargetsByWorker.clear();
  publishActiveSyncTargets();
  syncStatus.stall_recoveries = Number(syncStatus.stall_recoveries || 0) + 1;
  syncStatus.last_stall_recovery_at = new Date().toISOString();
  syncStatus.last_error = `Sync abandoned after ${Math.round(stalledForMs / 1000)}s without progress (${progressLabel}).`;
  syncStatus.running = false;
  syncStatus.progress = null;
  // Clearing the cached promise is what actually allows a new pass to start.
  setSyncPromise(null);
  return true;
}

function startSyncStallWatchdog() {
  const timer = setInterval(() => {
    try {
      recoverStalledSync();
    } catch (error) {
      console.error("[OpenPostings API] sync watchdog failed:", error);
    }
  }, SYNC_WATCHDOG_INTERVAL_MS);
  if (typeof timer.unref === "function") timer.unref();
  return timer;
}

function runAtsSync() {
  if (getSyncPromise()) return getSyncPromise();
  const syncPromise = runAtsSyncInternal().finally(() => {
    setSyncPromise(null);
  });
  return setSyncPromise(syncPromise); 
}


async function upsertPostingsBatch(postings, seenEpoch) {
  // Serialized against every other writer on the shared connection -- background
  // enrichment now runs concurrently with the sync, and overlapping BEGINs fail.
  return runInWriteTransaction(async (db) => {
    const validPostingByUrl = new Map();
    for (const posting of postings) {
      const jobPostingUrl = String(posting?.job_posting_url || "").trim();
      if (jobPostingUrl) validPostingByUrl.set(jobPostingUrl, posting);
    }
    const validPostings = Array.from(validPostingByUrl.values());
    if (validPostings.length === 0) return { inserted: 0, refreshed: 0 };

    // The sync used to report every successful UPSERT as a newly stored posting. Check the
    // batch inside the same write transaction so the UI can distinguish genuine discoveries
    // from existing rows that were merely refreshed.
    const placeholders = validPostings.map(() => "?").join(", ");
    const existingRows = await db.all(
      `SELECT job_posting_url FROM Postings WHERE job_posting_url IN (${placeholders});`,
      validPostings.map((posting) => String(posting.job_posting_url).trim())
    );
    const existingUrls = new Set(existingRows.map((row) => String(row?.job_posting_url || "")));

    for (const posting of validPostings) {
      const companyName = String(posting.company_name || "").trim();
      const positionName = String(posting.position_name || "").trim() || "Untitled Position";
      const jobPostingUrl = String(posting.job_posting_url || "").trim();
      if (!jobPostingUrl) continue;
      const postingDateRaw = String(posting.posting_date ?? "").trim();
      const postingDate = postingDateRaw || null;
      const jobDescriptionRaw = String(posting.job_description ?? "").trim();
      const jobDescription = jobDescriptionRaw || null;
      const normalizedCompensationType = normalizeCompensationType(posting?.compensation_type, "unknown");
      const compensationType = normalizedCompensationType === "unknown" ? null : normalizedCompensationType;
      const educationLevels = serializeEducationLevels(posting?.education_levels);
      const payMinRaw = Number(posting?.pay_min);
      const payMaxRaw = Number(posting?.pay_max);
      const payMin = Number.isFinite(payMinRaw) && payMinRaw > 0 ? payMinRaw : null;
      const payMax = Number.isFinite(payMaxRaw) && payMaxRaw > 0 ? payMaxRaw : null;
      const payCurrency = normalizeCompensationCurrencyCode(posting?.pay_currency);
      const payPeriod = normalizeCompensationPayPeriod(posting?.pay_period);
      const payRaw = String(posting?.pay_raw || "").trim() || null;
      const locationValue = String(posting?.location || "").trim() || null;
      // Workday and similar boards store no location; the display path infers one from the
      // URL, so the structured parse works from the same fallback to stay consistent.
      const parsedLocation = parsePostingLocation(
        locationValue || inferPostingLocationFromJobUrl(jobPostingUrl) || ""
      );
      const locationsJson = serializeLocationsJson(parsedLocation.locations);

      await db.run(
        `
          INSERT INTO Postings (
            company_name,
            position_name,
            job_posting_url,
            posting_date,
            location,
            city,
            state_region,
            country,
            is_remote,
            locations_json,
            job_description,
            compensation_type,
            education_levels,
            pay_min,
            pay_max,
            pay_currency,
            pay_period,
            pay_raw,
            first_seen_epoch,
            hidden,
            hidden_at_epoch,
            last_seen_epoch
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?)
          ON CONFLICT(job_posting_url) DO UPDATE SET
            company_name = excluded.company_name,
            position_name = excluded.position_name,
            posting_date = COALESCE(excluded.posting_date, Postings.posting_date),
            location = COALESCE(excluded.location, Postings.location),
            -- The parsed fields follow the same rule as the raw string they were parsed
            -- from: a sync pass that brought no location must not blank out what an
            -- earlier pass parsed. When the stored location is itself empty, the incoming
            -- parse (possibly URL-inferred) is still better than nothing.
            city = CASE WHEN excluded.location IS NOT NULL OR Postings.location IS NULL THEN excluded.city ELSE Postings.city END,
            state_region = CASE WHEN excluded.location IS NOT NULL OR Postings.location IS NULL THEN excluded.state_region ELSE Postings.state_region END,
            country = CASE WHEN excluded.location IS NOT NULL OR Postings.location IS NULL THEN excluded.country ELSE Postings.country END,
            is_remote = CASE WHEN excluded.location IS NOT NULL OR Postings.location IS NULL THEN excluded.is_remote ELSE Postings.is_remote END,
            locations_json = CASE WHEN excluded.location IS NOT NULL OR Postings.location IS NULL THEN excluded.locations_json ELSE Postings.locations_json END,
            job_description = COALESCE(excluded.job_description, Postings.job_description),
            compensation_type = COALESCE(excluded.compensation_type, Postings.compensation_type),
            education_levels = COALESCE(excluded.education_levels, Postings.education_levels),
            pay_min = CASE WHEN excluded.job_description IS NULL THEN Postings.pay_min ELSE excluded.pay_min END,
            pay_max = CASE WHEN excluded.job_description IS NULL THEN Postings.pay_max ELSE excluded.pay_max END,
            pay_currency = CASE WHEN excluded.job_description IS NULL THEN Postings.pay_currency ELSE excluded.pay_currency END,
            pay_period = CASE WHEN excluded.job_description IS NULL THEN Postings.pay_period ELSE excluded.pay_period END,
            pay_raw = CASE WHEN excluded.job_description IS NULL THEN Postings.pay_raw ELSE excluded.pay_raw END,
            first_seen_epoch = COALESCE(Postings.first_seen_epoch, Postings.last_seen_epoch, excluded.first_seen_epoch),
            last_seen_epoch = excluded.last_seen_epoch,
            -- Seeing a posting again means the ATS still lists it, so it is open and must
            -- come back into view. This branch previously carried a "WHERE hidden = 0"
            -- guard, which silently discarded the whole update for any hidden row: once
            -- pruned, a posting could never be revived even while it was still live.
            hidden = 0,
            hidden_at_epoch = NULL,
            hidden_reason = '';
        `,
        [
          companyName,
          positionName,
          jobPostingUrl,
          postingDate,
          locationValue,
          parsedLocation.city,
          parsedLocation.state_region,
          parsedLocation.country,
          parsedLocation.is_remote,
          locationsJson,
          jobDescription,
          compensationType,
          educationLevels,
          payMin,
          payMax,
          payCurrency,
          payPeriod,
          payRaw,
          seenEpoch,
          seenEpoch
        ]
      );
    }
    const refreshed = validPostings.reduce(
      (count, posting) => count + (existingUrls.has(String(posting.job_posting_url).trim()) ? 1 : 0),
      0
    );
    return { inserted: validPostings.length - refreshed, refreshed };
  });
}

function isBusyPostingStorageError(error) {
  return /SQLITE_BUSY/i.test(String(error?.message || error || ""));
}

// The connection's own busy_timeout (30s, see initDb) already retries internally before
// this ever sees SQLITE_BUSY, so a collision that reaches here means something held the
// write lock for the full 30s -- historically the periodic WAL TRUNCATE checkpoint on a
// multi-GB database (see the comment on WAL_CHECKPOINT_PASSIVE_INTERVAL_MS in index.js).
// That checkpoint now runs far less often and does far less work per run, so a collision
// that does happen should clear within moments. One short-delay retry catches that case
// instead of unconditionally dropping the batch; a second failure still falls through to
// the existing "log it, drop it, let the next pass re-crawl these" handling below.
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function upsertPostings(postings, lastSeenEpoch) {
  if (!Array.isArray(postings) || postings.length === 0) return { inserted: 0, refreshed: 0 };
  const seenEpoch = Number(lastSeenEpoch || nowEpochSeconds());
  try {
    return await upsertPostingsBatch(postings, seenEpoch);
  } catch (error) {
    if (isBusyPostingStorageError(error)) {
      await sleep(500);
      try {
        return await upsertPostingsBatch(postings, seenEpoch);
      } catch (retryError) {
        error = retryError;
      }
    }
    if (!isRecoverablePostingStorageError(error)) {
      throw error;
    }
    await rebuildPostingsTableStorage();
    return upsertPostingsBatch(postings, seenEpoch);
  }
}

// Hidden rows are kept as tombstones rather than deleted immediately: job_posting_url is
// UNIQUE, so the row is what lets a delisted posting be recognised (and its original
// first_seen_epoch preserved) if the ATS lists it again inside the retention window.
const HIDDEN_POSTING_RETENTION_SECONDS = 30 * 24 * 60 * 60;

// Descriptions are dropped at the moment of hiding. They are the bulk of the database
// (on a 658k-row instance, 435MB of 931MB lived in 96k descriptions) and nothing reads
// them once a posting is hidden, so keeping them for the whole retention window is pure
// disk cost. The row itself stays until deleteExpiredHiddenPostings takes it.
// Staleness is measured from last_seen_epoch, not first_seen_epoch: the freshness window
// asks "has the ATS stopped listing this?", not "how long ago did we discover it?". Keying
// it off first_seen_epoch gave every posting a hard lifetime from discovery and hid roles
// that were still open, which the upsert's re-sight branch below could then never recover.
// The column is read bare rather than through COALESCE so the predicate keeps a covering
// range scan on idx_postings_hidden_last_seen_epoch; wrapping it narrows nothing and makes
// this walk every visible row. The upsert always stamps last_seen_epoch, so it is never
// NULL in practice -- a NULL would simply never be pruned, and the read path hides it too.
async function pruneExpiredPostings(referenceEpoch = nowEpochSeconds()) {
  const resolvedReferenceEpoch = Number(referenceEpoch || nowEpochSeconds());
  const cutoffEpoch = resolvedReferenceEpoch - getPostingFreshnessWindowSeconds();
  const db = getDb()
  const result = await db.run(
    `
      UPDATE Postings
      SET
        hidden = 1,
        hidden_at_epoch = COALESCE(hidden_at_epoch, ?),
        -- The ATS has stopped listing this. Distinct from a posting that is still listed
        -- but older than the date window; only this kind is genuinely gone.
        hidden_reason = 'delisted',
        job_description = NULL
      WHERE hidden = 0
        AND last_seen_epoch < ?;
    `,
    [resolvedReferenceEpoch, cutoffEpoch]
  );
  return Number(result?.changes || 0);
}

// Rows are collected and deleted in chunks so a backlog (the first run after this ships
// clears every posting hidden more than the retention window ago) cannot hold one huge
// write transaction open for the length of the delete.
async function deleteExpiredHiddenPostings(referenceEpoch = nowEpochSeconds()) {
  const resolvedReferenceEpoch = Number(referenceEpoch || nowEpochSeconds());
  const cutoffEpoch = resolvedReferenceEpoch - HIDDEN_POSTING_RETENTION_SECONDS;
  const db = getDb();

  const rows = await db.all(
    `
      SELECT id
      FROM Postings
      WHERE hidden = 1
        AND hidden_at_epoch IS NOT NULL
        AND hidden_at_epoch < ?;
    `,
    [cutoffEpoch]
  );
  if (!Array.isArray(rows) || rows.length === 0) return 0;

  const idsToDelete = rows
    .map((row) => Number(row?.id || 0))
    .filter((postingId) => Number.isFinite(postingId) && postingId > 0);
  if (idsToDelete.length === 0) return 0;

  let totalDeleted = 0;
  const chunkSize = 800;
  for (let offset = 0; offset < idsToDelete.length; offset += chunkSize) {
    const chunk = idsToDelete.slice(offset, offset + chunkSize);
    if (chunk.length === 0) continue;
    const placeholders = chunk.map(() => "?").join(", ");
    totalDeleted += await runInWriteTransaction(async (handle) => {
      const result = await handle.run(
        `DELETE FROM Postings WHERE id IN (${placeholders});`,
        chunk
      );
      return Number(result?.changes || 0);
    });
  }

  return totalDeleted;
}

async function prunePostingsOutsideDateWindow(referenceEpoch = nowEpochSeconds()) {
  const db = getDb()

  const rows = await db.all(
    `
      SELECT id, posting_date
      FROM Postings
      WHERE hidden = 0
        AND posting_date IS NOT NULL
        AND TRIM(posting_date) <> '';
    `
  );
  if (!Array.isArray(rows) || rows.length === 0) return 0;

  const idsToHide = [];
  for (const row of rows) {
    const postingId = Number(row?.id || 0);
    if (!Number.isFinite(postingId) || postingId <= 0) continue;
    if (shouldStorePostingByDate(row?.posting_date, referenceEpoch)) continue;
    idsToHide.push(postingId);
  }

  if (idsToHide.length === 0) return 0;

  let totalHidden = 0;
  await runInWriteTransaction(async (handle) => {
    const chunkSize = 800;
    for (let offset = 0; offset < idsToHide.length; offset += chunkSize) {
      const chunk = idsToHide.slice(offset, offset + chunkSize);
      if (chunk.length === 0) continue;
      const placeholders = chunk.map(() => "?").join(", ");
      const result = await handle.run(
        `
          UPDATE Postings
          SET
            hidden = 1,
            hidden_at_epoch = COALESCE(hidden_at_epoch, ?),
            -- Still listed by the employer, just older than the freshness window. These
            -- remain applyable, which is why they are worth telling apart from delisted
            -- ones rather than both being a bare hidden = 1.
            hidden_reason = 'outside_date_window',
            job_description = NULL
          WHERE hidden = 0
            AND id IN (${placeholders});
        `,
        [Number(referenceEpoch || nowEpochSeconds()), ...chunk]
      );
      totalHidden += Number(result?.changes || 0);
    }
  });

  return totalHidden;
}

async function getActiveJobPostingUrls() {
  const db = getDb();
  const rows = await db.all(
    `SELECT job_posting_url FROM Postings WHERE hidden = 0;`
  );
  return new Set(rows.map((row) => String(row?.job_posting_url || "")));
}

// Only genuine corruption justifies rebuilding the table, because the "recovery" is DROP
// TABLE Postings -- every stored posting is destroyed and only re-accumulates as syncs
// re-crawl the boards. SQLITE_BUSY and "database is locked" used to be in this list, and
// they are the opposite of corruption: another healthy connection (the MCP server, a
// backfill script, a second API instance) holding the write lock for a moment. Treating
// contention as corruption meant any concurrent writer could wipe the table -- and did,
// deleting 832k rows on 2026-07-27. Contention is handled by the busy_timeout set at
// open; if it still surfaces, failing the batch and retrying next pass loses nothing.
function isRecoverablePostingStorageError(error) {
  const message = String(error?.message || error || "");
  if (!message) return false;
  return (
    /SQLITE_CORRUPT/i.test(message) ||
    /database disk image is malformed/i.test(message)
  );
}


async function createCanonicalPostingsTable() {
  const db = getDb();
  await db.exec(`
    CREATE TABLE Postings (
      id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      company_name TEXT NOT NULL,
      position_name TEXT NOT NULL,
      job_posting_url TEXT NOT NULL UNIQUE,
      posting_date TEXT,
      location TEXT,
      job_description TEXT,
      compensation_type TEXT,
      education_levels TEXT,
      pay_min REAL,
      pay_max REAL,
      pay_currency TEXT,
      pay_period TEXT,
      pay_raw TEXT,
      first_seen_epoch INTEGER,
      last_seen_epoch INTEGER,
      hidden INTEGER NOT NULL DEFAULT 0,
      hidden_at_epoch INTEGER,
      city TEXT,
      state_region TEXT,
      country TEXT,
      is_remote INTEGER NOT NULL DEFAULT 0,
      locations_json TEXT,
      hiring_locations_json TEXT,
      location_conflict INTEGER NOT NULL DEFAULT 0,
      description_fetched_at INTEGER,
      status TEXT NOT NULL DEFAULT 'unverified',
      dead_since_epoch INTEGER,
      requires_account INTEGER,
      hidden_reason TEXT NOT NULL DEFAULT ''
    );

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

    CREATE INDEX IF NOT EXISTS idx_postings_state_region
      ON Postings(state_region);
  `);
  await ensurePostingLocationStateIndex();
}

// A posting can list several states while Postings.state_region stores only its primary
// location. Keeping the small many-to-many projection indexed lets state-filtered listing
// requests start from roughly 9k matching rows instead of scanning close to a million.
// This is derived data: it can always be rebuilt from Postings and never owns user data.
async function ensurePostingLocationStateIndex() {
  const db = getDb();
  await db.exec(`
    CREATE TABLE IF NOT EXISTS posting_location_states (
      posting_id INTEGER NOT NULL,
      state_region TEXT NOT NULL,
      PRIMARY KEY (posting_id, state_region)
    ) WITHOUT ROWID;

    CREATE INDEX IF NOT EXISTS idx_posting_location_states_state
      ON posting_location_states(state_region, posting_id);

    CREATE TRIGGER IF NOT EXISTS trg_posting_location_states_insert
    AFTER INSERT ON Postings
    BEGIN
      INSERT OR IGNORE INTO posting_location_states (posting_id, state_region)
      SELECT NEW.id, UPPER(TRIM(NEW.state_region))
      WHERE NEW.state_region IS NOT NULL AND TRIM(NEW.state_region) <> '';

      INSERT OR IGNORE INTO posting_location_states (posting_id, state_region)
      SELECT DISTINCT NEW.id, UPPER(TRIM(json_extract(value, '$.state_region')))
      FROM json_each(CASE WHEN json_valid(NEW.locations_json) THEN NEW.locations_json ELSE '[]' END)
      WHERE json_extract(value, '$.state_region') IS NOT NULL
        AND TRIM(json_extract(value, '$.state_region')) <> ''
        AND UPPER(TRIM(json_extract(value, '$.state_region'))) <> COALESCE(UPPER(TRIM(NEW.state_region)), '');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_posting_location_states_update
    AFTER UPDATE OF state_region, locations_json ON Postings
    WHEN NEW.state_region IS NOT OLD.state_region OR NEW.locations_json IS NOT OLD.locations_json
    BEGIN
      DELETE FROM posting_location_states WHERE posting_id = NEW.id;

      INSERT OR IGNORE INTO posting_location_states (posting_id, state_region)
      SELECT NEW.id, UPPER(TRIM(NEW.state_region))
      WHERE NEW.state_region IS NOT NULL AND TRIM(NEW.state_region) <> '';

      INSERT OR IGNORE INTO posting_location_states (posting_id, state_region)
      SELECT DISTINCT NEW.id, UPPER(TRIM(json_extract(value, '$.state_region')))
      FROM json_each(CASE WHEN json_valid(NEW.locations_json) THEN NEW.locations_json ELSE '[]' END)
      WHERE json_extract(value, '$.state_region') IS NOT NULL
        AND TRIM(json_extract(value, '$.state_region')) <> ''
        AND UPPER(TRIM(json_extract(value, '$.state_region'))) <> COALESCE(UPPER(TRIM(NEW.state_region)), '');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_posting_location_states_delete
    AFTER DELETE ON Postings
    BEGIN
      DELETE FROM posting_location_states WHERE posting_id = OLD.id;
    END;

    INSERT OR IGNORE INTO posting_location_states (posting_id, state_region)
    SELECT id, UPPER(TRIM(state_region))
    FROM Postings
    WHERE state_region IS NOT NULL AND TRIM(state_region) <> '';

    INSERT OR IGNORE INTO posting_location_states (posting_id, state_region)
    SELECT p.id, UPPER(TRIM(json_extract(j.value, '$.state_region')))
    FROM Postings p
    JOIN json_each(CASE WHEN json_valid(p.locations_json) THEN p.locations_json ELSE '[]' END) j
    WHERE json_extract(j.value, '$.state_region') IS NOT NULL
      AND TRIM(json_extract(j.value, '$.state_region')) <> '';
  `);
}

async function rebuildPostingsTableStorage() {
  const db = getDb()
  // Destroys every stored posting. Only reachable for confirmed on-disk corruption, and
  // even then it deserves a loud trace in the log.
  let rowCount = "unknown";
  try {
    const row = await db.get(`SELECT COUNT(*) AS c FROM Postings;`);
    rowCount = String(row?.c);
  } catch {}
  console.error(
    `[OpenPostings API] REBUILDING Postings table storage after corruption; dropping ${rowCount} rows`
  );
  await db.exec(`DROP TABLE IF EXISTS Postings;`);
  await db.exec(`DELETE FROM posting_location_states;`).catch(() => undefined);
  await createCanonicalPostingsTable();
}


async function getSyncScopeStats() {
  const db = getReadDb()

  const rows = await db.all(
    `
      SELECT ATS_name
      FROM companies
      WHERE NOT EXISTS (
        SELECT 1
        FROM blocked_companies b
        WHERE b.normalized_company_name = LOWER(TRIM(companies.company_name))
      );
    `
  );

  const enabledAts = new Set(normalizeSyncEnabledAts(Array.from(getSyncEnabledAts())));
  let syncEnabledCompanyCount = 0;
  for (const row of rows) {
    const normalizedAts = normalizeAtsFilterValue(row?.ATS_name);
    if (!ATS_FILTER_OPTIONS.has(normalizedAts)) continue;
    if (enabledAts.has(normalizedAts)) {
      syncEnabledCompanyCount += 1;
    }
  }
  if (enabledAts.has("governmentjobs")) {
    syncEnabledCompanyCount += GOVERNMENTJOBS_ESTIMATED_COMPANY_COUNT;
  }
  if (enabledAts.has("smartrecruiters")) {
    syncEnabledCompanyCount += SMARTRECRUITERS_ESTIMATED_COMPANY_COUNT;
  }
  if (enabledAts.has("policeapp")) {
    syncEnabledCompanyCount += POLICEAPP_ESTIMATED_COMPANY_COUNT;
  }
  if (enabledAts.has("usajobs")) {
    syncEnabledCompanyCount += USAJOBS_ESTIMATED_COMPANY_COUNT;
  }
  if (enabledAts.has("k12jobspot")) {
    syncEnabledCompanyCount += K12JOBSPOT_ESTIMATED_COMPANY_COUNT;
  }
  if (enabledAts.has("snaphunt")) {
    syncEnabledCompanyCount += SNAPHUNT_ESTIMATED_COMPANY_COUNT;
  }
  if (enabledAts.has("schoolspring")) {
    syncEnabledCompanyCount += SCHOOLSPRING_ESTIMATED_COMPANY_COUNT;
  }
  if (enabledAts.has("calcareers")) {
    syncEnabledCompanyCount += CALCAREERS_ESTIMATED_COMPANY_COUNT;
  }
  if (enabledAts.has("calopps")) {
    syncEnabledCompanyCount += CALOPPS_ESTIMATED_COMPANY_COUNT;
  }
  if (enabledAts.has("statejobsny")) {
    syncEnabledCompanyCount += STATEJOBSNY_ESTIMATED_COMPANY_COUNT;
  }
  if (enabledAts.has("edjoin")) {
    syncEnabledCompanyCount += EDJOIN_ESTIMATED_COMPANY_COUNT;
  }
  if (enabledAts.has("hcareers")) {
    syncEnabledCompanyCount += HCAREERS_ESTIMATED_COMPANY_COUNT;
  }
  if (enabledAts.has("webcruiter")) {
    syncEnabledCompanyCount += WEBCRUITER_ESTIMATED_COMPANY_COUNT;
  }
  if (enabledAts.has("academicjobsonline")) {
    syncEnabledCompanyCount += ACADEMICJOBSONLINE_ESTIMATED_COMPANY_COUNT;
  }
  if (enabledAts.has("amazon")) {
    syncEnabledCompanyCount += AMAZON_ESTIMATED_COMPANY_COUNT;
  }
  for (const siteKey of CAREER_SITE_KEYS) {
    if (enabledAts.has(siteKey)) {
      syncEnabledCompanyCount += getCareerSiteEstimatedCompanyCount(siteKey);
    }
  }

  return {
    sync_enabled_company_count: syncEnabledCompanyCount,
    configured_enabled_ats_count: enabledAts.size,
    excluded_ats_count: Math.max(0, ATS_FILTER_OPTION_ITEMS.length - enabledAts.size)
  };
}

module.exports = {
  getSyncCoverageStats,
  interleaveTargetsByAts,
  getLastSyncWriteEpoch,
  recordSyncWriteHeartbeat,
  // Exported for tests: pass resumability is the property worth pinning, and it is only
  // observable through the ordering plus the progress marks.
  getCompaniesForSync,
  markCompanySynced,
  flushCompanySyncMarks, runAtsSync, getSyncScopeStats, pruneExpiredPostings, deleteExpiredHiddenPostings, createCanonicalPostingsTable, ensurePostingLocationStateIndex, upsertPostingsBatch, syncStatus, startSyncStallWatchdog, recoverStalledSync, createSerialFlushQueue };
