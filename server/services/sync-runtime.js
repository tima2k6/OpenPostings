const { normalizeSyncEnabledAts, normalizeAtsFilterValue, inferPostingLocationFromJobUrl, ATS_FILTER_OPTIONS, ATS_FILTER_OPTION_ITEMS } = require("../helpers/normalize-ats");
const { getSyncPromise, setSyncPromise, getDb, setDb, getPostingLocationByJobUrl, setPostingLocationByJobUrl, getSyncEnabledAts, getSyncDownloadJobDescriptions, getAtsRequestQueueConcurrency } = require("./runtime-context.js");
const { nowEpochSeconds, getPostingFreshnessWindowSeconds, shouldStorePostingByDate } = require("../helpers/normalize-numbers")
const { normalizeCompensationType, serializeEducationLevels, normalizeCompensationCurrencyCode, normalizeCompensationPayPeriod } = require("../helpers/description-filters")

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
const { collectPostingsForExpediaDynamic, EXPEDIA_ESTIMATED_COMPANY_COUNT } = require("../ats/expedia/service.js");
const { collectPostingsForMicrosoftDynamic, MICROSOFT_ESTIMATED_COMPANY_COUNT } = require("../ats/microsoft/service.js");

const syncStatus = {
  running: false,
  started_at: null,
  last_sync_at: null,
  last_sync_summary: null,
  last_error: null,
  progress: null,
  stall_recoveries: 0,
  last_stall_recovery_at: null
};

// runAtsSync hands back the in-flight promise so passes cannot overlap. If a pass
// never settles — a wedged await that the per-request fetch timeout does not cover —
// that cached promise is returned forever and syncing is dead until the process is
// restarted. These track forward progress so a wedged pass can be abandoned.
const SYNC_STALL_TIMEOUT_MS = Number(process.env.SYNC_STALL_TIMEOUT_MS || 15 * 60 * 1000);
const SYNC_WATCHDOG_INTERVAL_MS = Number(process.env.SYNC_WATCHDOG_INTERVAL_MS || 60 * 1000);
// Bumped when a pass is abandoned. Workers compare against the value they started
// with and exit, so an abandoned pass stops consuming targets and memory instead of
// racing the replacement pass.
let syncGeneration = 0;
let lastSyncProgressAtMs = 0;

const SYNC_WORKER_CONCURRENCY_RAW = Number(process.env.SYNC_WORKER_CONCURRENCY || 4);
const SYNC_WORKER_CONCURRENCY =
  Number.isFinite(SYNC_WORKER_CONCURRENCY_RAW) && SYNC_WORKER_CONCURRENCY_RAW > 0
    ? Math.floor(SYNC_WORKER_CONCURRENCY_RAW)
    : 4;

const SYNC_POSTING_FLUSH_BATCH_SIZE = Number(process.env.SYNC_POSTING_FLUSH_BATCH_SIZE || 100); 


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
  if (
    atsName === "expedia" ||
    atsName === "expediagroup" ||
    atsName === "expediagroup.com" ||
    atsName === "expediagroupcom" ||
    atsName === "careers.expediagroup.com" ||
    atsName === "careersexpediagroupcom"
  ) {
    return collectPostingsForExpediaDynamic();
  }
  if (
    atsName === "microsoft" ||
    atsName === "microsoft.com" ||
    atsName === "microsoftcom" ||
    atsName === "careers.microsoft.com" ||
    atsName === "careersmicrosoftcom" ||
    atsName === "jobs.careers.microsoft.com" ||
    atsName === "jobscareersmicrosoftcom"
  ) {
    return collectPostingsForMicrosoftDynamic();
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


async function getCompaniesForSync() {
  const db = getDb();
  const rows = await db.all(
    `
      SELECT id, company_name, url_string, ATS_name
      FROM companies
      WHERE NOT EXISTS (
        SELECT 1
        FROM blocked_companies b
        WHERE b.normalized_company_name = LOWER(TRIM(companies.company_name))
      );
    `
  );

  const enabledAts = new Set(normalizeSyncEnabledAts(Array.from(getSyncEnabledAts())));
  return rows
    .filter((row) => enabledAts.has(normalizeAtsFilterValue(row?.ATS_name)))
    .sort((a, b) => {
      const aAts = String(a?.ATS_name || "");
      const bAts = String(b?.ATS_name || "");
      const atsCompare = aAts.localeCompare(bAts);
      if (atsCompare !== 0) return atsCompare;
      return String(a?.company_name || "").localeCompare(String(b?.company_name || ""));
    });
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
  // Amazon, Expedia Group and Microsoft each run their own careers platform rather than
  // renting an ATS, so there is no seeded company row that could reach them. They belong
  // here for the same reason the boards above do: one target sweeps the whole employer.
  {
    company_name: "Amazon Jobs (dynamic)",
    url_string: "https://www.amazon.jobs/en/search.json?sort=recent",
    ATS_name: "amazon"
  },
  {
    company_name: "Expedia Group (dynamic)",
    url_string: "https://careers.expediagroup.com/sitemap.xml",
    ATS_name: "expedia"
  },
  {
    company_name: "Microsoft Careers (dynamic)",
    url_string: "https://gcsservices.careers.microsoft.com/search/api/v1/search?o=Recent",
    ATS_name: "microsoft"
  }
];

async function runAtsSyncInternal() {
  const passGeneration = syncGeneration;
  const syncReferenceEpoch = nowEpochSeconds();
  lastSyncProgressAtMs = Date.now();
  syncStatus.running = true;
  syncStatus.started_at = new Date().toISOString();
  syncStatus.progress = { current: 0, total: 0, company_name: "", total_collected: 0 };
  syncStatus.last_error = null;

  try {
    const companies = await getCompaniesForSync();
    const enabledAts = new Set(normalizeSyncEnabledAts(Array.from(getSyncEnabledAts())));
    const shuffledCompanies = shuffleArrayInPlace([...companies]);
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
    const nextPostingLocationByJobUrl = new Map(postingLocationByJobUrl);

    // Tracks which job_posting_urls have already been queued this run, without holding onto the
    // full posting payload (job descriptions can be large and this set stays alive for the whole
    // multi-hour sync — retaining full objects here previously caused unbounded memory growth).
    const dedupedPostingUrls = new Set();
    const pendingPostingsForUpsert = [];
    let excludedByPostingDate = 0;
    let nextCompanyIndex = 0;
    let completedCompanies = 0;
    const workerCount = Math.min(SYNC_WORKER_CONCURRENCY, Math.max(1, syncTargets.length));
    let flushPromise = Promise.resolve();

    const flushPendingPostings = async (force = false) => {
      if (!Array.isArray(pendingPostingsForUpsert) || pendingPostingsForUpsert.length === 0) return;
      if (!force && pendingPostingsForUpsert.length < SYNC_POSTING_FLUSH_BATCH_SIZE) return;

      const batch = pendingPostingsForUpsert.splice(0, pendingPostingsForUpsert.length);
      if (batch.length === 0) return;
      await upsertPostings(batch, syncReferenceEpoch);
    };

    const queueFlushPendingPostings = (force = false) => {
      flushPromise = flushPromise.then(() => flushPendingPostings(force));
      return flushPromise;
    };

    const runSyncWorker = async () => {
      while (true) {
        // This pass was abandoned as stalled; stop rather than compete with its
        // replacement for targets, memory and DB writes.
        if (syncGeneration !== passGeneration) return;
        const currentIndex = nextCompanyIndex;
        if (currentIndex >= syncTargets.length) return;
        nextCompanyIndex += 1;

        const company = syncTargets[currentIndex];
        try {
          const companyAts = normalizeAtsFilterValue(company?.ATS_name);
          const currentlyEnabledAts = new Set(normalizeSyncEnabledAts(Array.from(getSyncEnabledAts())));
          if (!currentlyEnabledAts.has(companyAts)) {
            continue;
          }

          const postings = await collectPostingsForCompany(company, {
            downloadJobDescriptions: getSyncDownloadJobDescriptions()
          });
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
            syncStatus.progress = {
              current: completedCompanies,
              total: syncTargets.length,
              company_name: `${company.company_name} (${company.ATS_name})`,
              total_collected: dedupedPostingUrls.size
            };
          }
        }
      }
    };

    if (syncTargets.length > 0) {
      await Promise.all(Array.from({ length: workerCount }, () => runSyncWorker()));
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
  } catch (error) {
    if (syncGeneration === passGeneration) {
      syncStatus.last_error = String(error?.message || error);
    }
  } finally {
    // An abandoned pass may settle long after its replacement started; it must not
    // report that pass as finished or wipe its progress.
    if (syncGeneration === passGeneration) {
      syncStatus.running = false;
      syncStatus.progress = null;
    }
  }
}

// Abandons a pass that has stopped making progress, so the next scheduled tick can
// start a fresh one. The wedged pass is not killable — its pending awaits may never
// settle — but bumping the generation makes its workers exit at their next iteration
// and stops it from publishing results.
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
  const db = getDb()
  await db.exec("BEGIN TRANSACTION;");
  try {
    for (const posting of postings) {
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

      await db.run(
        `
          INSERT INTO Postings (
            company_name,
            position_name,
            job_posting_url,
            posting_date,
            location,
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
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?)
          ON CONFLICT(job_posting_url) DO UPDATE SET
            company_name = excluded.company_name,
            position_name = excluded.position_name,
            posting_date = COALESCE(excluded.posting_date, Postings.posting_date),
            location = COALESCE(excluded.location, Postings.location),
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
            hidden_at_epoch = NULL;
        `,
        [
          companyName,
          positionName,
          jobPostingUrl,
          postingDate,
          String(posting?.location || "").trim() || null,
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
    await db.exec("COMMIT;");
  } catch (error) {
    await db.exec("ROLLBACK;");
    throw error;
  }
}

async function upsertPostings(postings, lastSeenEpoch) {
  if (!Array.isArray(postings) || postings.length === 0) return;
  const seenEpoch = Number(lastSeenEpoch || nowEpochSeconds());
  try {
    await upsertPostingsBatch(postings, seenEpoch);
  } catch (error) {
    if (!isRecoverablePostingStorageError(error)) {
      throw error;
    }
    await rebuildPostingsTableStorage();
    await upsertPostingsBatch(postings, seenEpoch);
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
    await db.exec("BEGIN TRANSACTION;");
    try {
      const result = await db.run(
        `DELETE FROM Postings WHERE id IN (${placeholders});`,
        chunk
      );
      await db.exec("COMMIT;");
      totalDeleted += Number(result?.changes || 0);
    } catch (error) {
      await db.exec("ROLLBACK;");
      throw error;
    }
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
  await db.exec("BEGIN TRANSACTION;");
  try {
    const chunkSize = 800;
    for (let offset = 0; offset < idsToHide.length; offset += chunkSize) {
      const chunk = idsToHide.slice(offset, offset + chunkSize);
      if (chunk.length === 0) continue;
      const placeholders = chunk.map(() => "?").join(", ");
      const result = await db.run(
        `
          UPDATE Postings
          SET
            hidden = 1,
            hidden_at_epoch = COALESCE(hidden_at_epoch, ?),
            job_description = NULL
          WHERE hidden = 0
            AND id IN (${placeholders});
        `,
        [Number(referenceEpoch || nowEpochSeconds()), ...chunk]
      );
      totalHidden += Number(result?.changes || 0);
    }

    await db.exec("COMMIT;");
  } catch (error) {
    await db.exec("ROLLBACK;");
    throw error;
  }

  return totalHidden;
}

async function getActiveJobPostingUrls() {
  const db = getDb();
  const rows = await db.all(
    `SELECT job_posting_url FROM Postings WHERE hidden = 0;`
  );
  return new Set(rows.map((row) => String(row?.job_posting_url || "")));
}

function isRecoverablePostingStorageError(error) {
  const message = String(error?.message || error || "");
  if (!message) return false;
  return (
    /SQLITE_CORRUPT/i.test(message) ||
    /database disk image is malformed/i.test(message) ||
    /SQLITE_BUSY/i.test(message) ||
    /database is locked/i.test(message)
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
      hidden_at_epoch INTEGER
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
  `);
}

async function rebuildPostingsTableStorage() {
  const db = getDb()
  await db.exec(`DROP TABLE IF EXISTS Postings;`);
  await createCanonicalPostingsTable();
}


async function getSyncScopeStats() {
  const db = getDb()

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
  if (enabledAts.has("expedia")) {
    syncEnabledCompanyCount += EXPEDIA_ESTIMATED_COMPANY_COUNT;
  }
  if (enabledAts.has("microsoft")) {
    syncEnabledCompanyCount += MICROSOFT_ESTIMATED_COMPANY_COUNT;
  }

  return {
    sync_enabled_company_count: syncEnabledCompanyCount,
    configured_enabled_ats_count: enabledAts.size,
    excluded_ats_count: Math.max(0, ATS_FILTER_OPTION_ITEMS.length - enabledAts.size)
  };
}

module.exports = { runAtsSync, getSyncScopeStats, pruneExpiredPostings, deleteExpiredHiddenPostings, createCanonicalPostingsTable, upsertPostingsBatch, syncStatus, startSyncStallWatchdog, recoverStalledSync };


