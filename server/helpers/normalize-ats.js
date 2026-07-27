const { normalizeStringArray, normalizeLikeText } = require("./normalize-strings.js");
const { parseJsonArray } = require("./normalize-strings.js");
const { getPostingLocationByJobUrl } = require("../services/runtime-context.js");
const { inferWorkdayLocationFromJobUrl } = require("../ats/workday/service.js")
const ATS_FILTER_OPTIONS = new Set([
  "workday",
  "ashby",
  "greenhouse",
  "lever",
  "recruitee",
  "ultipro",
  "taleo",
  "jobvite",
  "applicantpro",
  "applytojob",
  "icims",
  "theapplicantmanager",
  "breezy",
  "zoho",
  "applicantai",
  "careerplug",
  "bamboohr",
  "manatal",
  "careerpuck",
  "dayforcehcm",
  "fountain",
  "getro",
  "governmentjobs",
  "smartrecruiters",
  "policeapp",
  "usajobs",
  "k12jobspot",
  "snaphunt",
  "dover",
  "oorwin",
  "schoolspring",
  "calcareers",
  "calopps",
  "statejobsny",
  "edjoin",
  "webcruiter",
  "academicjobsonline",
  "hcareers",
  "amazon",
  "expedia",
  "microsoft",
  "apple",
  "meta",
  "walmart",
  "disney",
  "boeing",
  "hrmdirect",
  "talentlyft",
  "talexio",
  "teamtailor",
  "freshteam",
  "agilehr",
  "sagehr",
  "loxo",
  "peopleforce",
  "simplicant",
  "pinpointhq",
  "recruitcrm",
  "rippling",
  "gem",
  "jobaps",
  "join",
  "talentreef",
  "saphrcloud",
  "adp_myjobs",
  "paycor",
  "paycomonline",
  "prismhr",
  "silkroad",
  "adp_workforcenow",
  "careerspage",
  "oracle",
  "paylocity",
  "eightfold",
  "hirebridge",
  "pageup",
  "brassring"
  ,
  "applitrack",
  "hibob",
  "isolved",
  "avature",
  "comeet",
  "factorialhr"
  ,
  "hireology"
  ,
  "crelate",
  "hiringplatform",
  "homerun",
  "jibeapply",
  "jobs2web"
  ,
  "occupop"
  ,
  "peopleadmin"
  ,
  "personio"
  ,
  "recruiterflow"
  ,
  "softgarden",
  "trakstar",
  "ukg",
  "ycombinator",
  "yello"
]);

const ATS_FILTER_OPTION_ITEMS = Object.freeze([
  { value: "workday", label: "Workday" },
  { value: "ashby", label: "Ashby" },
  { value: "greenhouse", label: "Greenhouse" },
  { value: "lever", label: "Lever" },
  { value: "jobvite", label: "Jobvite" },
  { value: "applicantpro", label: "ApplicantPro" },
  { value: "applytojob", label: "ApplyToJob" },
  { value: "theapplicantmanager", label: "The Applicant Manager" },
  { value: "breezy", label: "BreezyHR" },
  { value: "icims", label: "iCIMS" },
  { value: "zoho", label: "Zoho Recruit" },
  { value: "applicantai", label: "ApplicantAI" },
  { value: "gem", label: "Gem" },
  { value: "jobaps", label: "JobAps" },
  { value: "join", label: "JOIN" },
  { value: "talentreef", label: "TalentReef" },
  { value: "careerplug", label: "CareerPlug" },
  { value: "bamboohr", label: "BambooHR" },
  { value: "adp_myjobs", label: "ADP MyJobs" },
  { value: "paycor", label: "Paycor" },
  { value: "paycomonline", label: "PaycomOnline" },
  { value: "prismhr", label: "PrismHR" },
  { value: "silkroad", label: "SilkRoad" },
  { value: "adp_workforcenow", label: "ADP Workforce Now" },
  { value: "oracle", label: "Oracle" },
  { value: "paylocity", label: "Paylocity" },
  { value: "eightfold", label: "Eightfold" },
  { value: "manatal", label: "Manatal" },
  { value: "careerspage", label: "CareersPage" },
  { value: "dayforcehcm", label: "Dayforce" },
  { value: "pageup", label: "PageUp" },
  { value: "hirebridge", label: "Hirebridge" },
  { value: "brassring", label: "BrassRing" },
  { value: "applitrack", label: "Applitrack" },
  { value: "hibob", label: "HiBob" },
  { value: "isolved", label: "isolved" },
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
  { value: "teamtailor", label: "Teamtailor" },
  { value: "freshteam", label: "Freshteam" },
  { value: "agilehr", label: "AgileHR" },
  { value: "sagehr", label: "SageHR" },
  { value: "loxo", label: "Loxo" },
  { value: "peopleforce", label: "PeopleForce" },
  { value: "simplicant", label: "Simplicant" },
  { value: "pinpointhq", label: "PinpointHQ" },
  { value: "recruitcrm", label: "RecruitCRM" },
  { value: "rippling", label: "Rippling" },
  { value: "careerpuck", label: "CareerPuck" },
  { value: "fountain", label: "Fountain" },
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
  { value: "hcareers", label: "Hcareers" },
  { value: "amazon", label: "Amazon Jobs" },
  { value: "expedia", label: "Expedia Group" },
  { value: "microsoft", label: "Microsoft Careers" },
  { value: "apple", label: "Apple" },
  { value: "meta", label: "Meta" },
  { value: "walmart", label: "Walmart" },
  { value: "disney", label: "Disney" },
  { value: "boeing", label: "Boeing" },
  { value: "hrmdirect", label: "HRMDirect" },
  { value: "talentlyft", label: "Talentlyft" },
  { value: "talexio", label: "Talexio" },
  { value: "saphrcloud", label: "SAP HR Cloud" },
  { value: "recruitee", label: "Recruitee" },
  { value: "ultipro", label: "UltiPro" },
  { value: "taleo", label: "Taleo" }
]);

const SYNC_DEFAULT_ENABLED_ATS = Object.freeze(ATS_FILTER_OPTION_ITEMS.map((item) => item.value));



function normalizeCompanyNameForBlockList(value) {
  return normalizeLikeText(value);
}

function normalizeSyncEnabledAts(value, fallbackValue = SYNC_DEFAULT_ENABLED_ATS) {
  const requested = parseJsonArray(value);
  const normalized = normalizeAtsFilters(requested);
  if (normalized.length > 0) return normalized;

  // A request that named ATSs but matched none of them is a selection we failed to
  // recognize, not an absent one. Widening it to the full default list would enable
  // every ATS behind the user's back, so keep it as narrow as it was asked for.
  if (requested.length > 0) {
    console.warn(
      `[OpenPostings API] ignoring unrecognized sync_enabled_ats values: ${requested.join(", ")}`
    );
    return [];
  }

  // Nothing was requested at all: an unset settings row stores '[]', and the sync
  // settings UI refuses to clear the last ATS, so an empty list only ever means
  // "not configured" and takes the default.
  const fallback = normalizeAtsFilters(Array.isArray(fallbackValue) ? fallbackValue : SYNC_DEFAULT_ENABLED_ATS);
  if (fallback.length > 0) return fallback;
  return Array.from(SYNC_DEFAULT_ENABLED_ATS);
}

function normalizeAtsFilters(value) {
  const items = normalizeStringArray(Array.isArray(value) ? value : [value])
    .map((item) => normalizeAtsFilterValue(item))
    .filter((item) => ATS_FILTER_OPTIONS.has(item));
  return Array.from(new Set(items));
}


function normalizeAtsFilterValue(value) {
  const normalized = normalizeLikeText(value);
  if (normalized === "ashbyhq") return "ashby";
  if (normalized === "greenhouseio" || normalized === "greenhouse.io") return "greenhouse";
  if (normalized === "leverco" || normalized === "lever.co") return "lever";
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
  if (normalized === "jobvitecom" || normalized === "jobvite.com") return "jobvite";
  if (normalized === "applicantprocom" || normalized === "applicantpro.com") return "applicantpro";
  if (normalized === "hibob.com" || normalized === "hibobcom" || normalized === "hibob" || normalized === "careers.hibob.com" || normalized === "careershibobcom") {
    return "hibob";
  }
  if (
    normalized === "hiringplatform" ||
    normalized === "hiringplatform.com" ||
    normalized === "hiringplatformcom"
  ) {
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
  if (
    normalized === "isolved" ||
    normalized === "isolvedhire" ||
    normalized === "isolvedhire.com" ||
    normalized === "isolvedhirecom" ||
    // Builds before the client and server ATS lists were reconciled stored this
    // typo as the canonical value, so settings saved by them still arrive here.
    normalized === "isolvisolvedhire"
  ) {
    return "isolved";
  }
  if (
    normalized === "avature" ||
    normalized === "avature.net" ||
    normalized === "avaturenet"
  ) {
    return "avature";
  }
  if (normalized === "comeet" || normalized === "comeet.com" || normalized === "comeetcom" || normalized === "www.comeet.com" || normalized === "wwwcomeetcom") {
    return "comeet";
  }
  if (normalized === "applytojobcom" || normalized === "applytojob.com") return "applytojob";
  if (normalized === "icimscom" || normalized === "icims.com") return "icims";
  if (normalized === "theapplicantmanagercom" || normalized === "theapplicantmanager.com") {
    return "theapplicantmanager";
  }
  if (normalized === "breezyhr" || normalized === "breezy.hr" || normalized === "breezyhrcom") {
    return "breezy";
  }
  if (normalized === "zohorecruit" || normalized === "zohorecruit.com" || normalized === "zohorecruitcom") {
    return "zoho";
  }
  if (normalized === "applicantai.com" || normalized === "applicantaicom") {
    return "applicantai";
  }
  if (normalized === "bamboohr.com" || normalized === "bamboohrcom") {
    return "bamboohr";
  }
  if (normalized === "careerplug.com" || normalized === "careerplugcom") {
    return "careerplug";
  }
  if (
    normalized === "manatal.com" ||
    normalized === "manatalcom" ||
    normalized === "careers-page.com" ||
    normalized === "careerspagecom"
  ) {
    return "manatal";
  }
  if (normalized === "careerpuck.com" || normalized === "careerpuckcom") {
    return "careerpuck";
  }
  if (normalized === "dayforcehcm" || normalized === "dayforce" || normalized === "dayforcehcm.com" || normalized === "dayforcehcmcom") {
    return "dayforcehcm";
  }
  if (normalized === "fountain.com" || normalized === "fountaincom") {
    return "fountain";
  }
  if (normalized === "getro.com" || normalized === "getrocom") {
    return "getro";
  }
  if (normalized === "governmentjobs.com" || normalized === "governmentjobscom" || normalized === "governmentjobs") {
    return "governmentjobs";
  }
  if (
    normalized === "smartrecruiters.com" ||
    normalized === "smartrecruiterscom" ||
    normalized === "jobs.smartrecruiters.com" ||
    normalized === "jobssmartrecruiterscom" ||
    normalized === "smartrecruiters"
  ) {
    return "smartrecruiters";
  }
  if (normalized === "policeapp" || normalized === "policeapp.com" || normalized === "policeappcom" || normalized === "www.policeapp.com" || normalized === "wwwpoliceappcom") {
    return "policeapp";
  }
  if (normalized === "usajobs" || normalized === "usajobs.gov" || normalized === "usajobsgov" || normalized === "www.usajobs.gov" || normalized === "wwwusajobsgov") {
    return "usajobs";
  }
  if (normalized === "k12jobspot" || normalized === "k12jobspot.com" || normalized === "k12jobspotcom" || normalized === "www.k12jobspot.com" || normalized === "wwwk12jobspotcom" || normalized === "api.k12jobspot.com" || normalized === "apik12jobspotcom") {
    return "k12jobspot";
  }
  if (
    normalized === "snaphunt" ||
    normalized === "snaphunt.com" ||
    normalized === "snaphuntcom" ||
    normalized === "api.snaphunt.com" ||
    normalized === "apisnaphuntcom"
  ) {
    return "snaphunt";
  }
  if (
    normalized === "dover" ||
    normalized === "app.dover.com" ||
    normalized === "appdovercom" ||
    normalized === "www.app.dover.com" ||
    normalized === "wwwappdovercom"
  ) {
    return "dover";
  }
  if (
    normalized === "oorwin" ||
    normalized === "oorwin.com" ||
    normalized === "oorwincom" ||
    normalized === "api.oorwin.ai" ||
    normalized === "apioorwinai"
  ) {
    return "oorwin";
  }
  if (
    normalized.endsWith(".oorwin.com") ||
    normalized.endsWith(".oorwin.ai") ||
    normalized.endsWith("oorwincom") ||
    normalized.endsWith("oorwinai")
  ) {
    return "oorwin";
  }
  if (normalized === "schoolspring" || normalized === "schoolspring.com" || normalized === "schoolspringcom" || normalized === "api.schoolspring.com" || normalized === "apischoolspringcom" || normalized === "www.schoolspring.com" || normalized === "wwwschoolspringcom") {
    return "schoolspring";
  }
  if (
    normalized === "calcareers" ||
    normalized === "calcareers.ca.gov" ||
    normalized === "calcareerscagov" ||
    normalized === "www.calcareers.ca.gov" ||
    normalized === "wwwcalcareerscagov"
  ) {
    return "calcareers";
  }
  if (
    normalized === "calopps" ||
    normalized === "calopps.org" ||
    normalized === "caloppsorg" ||
    normalized === "www.calopps.org" ||
    normalized === "wwwcaloppsorg"
  ) {
    return "calopps";
  }
  if (
    normalized === "statejobsny" ||
    normalized === "statejobsny.com" ||
    normalized === "statejobsnycom" ||
    normalized === "www.statejobsny.com" ||
    normalized === "wwwstatejobsnycom"
  ) {
    return "statejobsny";
  }
  if (
    normalized === "edjoin" ||
    normalized === "edjoin.org" ||
    normalized === "edjoinorg" ||
    normalized === "www.edjoin.org" ||
    normalized === "wwwedjoinorg"
  ) {
    return "edjoin";
  }
  if (
    normalized === "webcruiter" ||
    normalized === "webcruiter.com" ||
    normalized === "webcruitercom" ||
    normalized === "candidate.webcruiter.com" ||
    normalized === "candidatewebcruitercom"
  ) {
    return "webcruiter";
  }
  if (
    normalized === "academicjobsonline" ||
    normalized === "academicjobsonline.org" ||
    normalized === "academicjobsonlineorg" ||
    normalized === "www.academicjobsonline.org" ||
    normalized === "wwwacademicjobsonlineorg"
  ) {
    return "academicjobsonline";
  }
  if (
    normalized === "hcareers.com" ||
    normalized === "hcareerscom" ||
    normalized === "www.hcareers.com" ||
    normalized === "wwwhcareerscom"
  ) {
    return "hcareers";
  }
  if (
    normalized === "amazon.jobs" ||
    normalized === "amazonjobs" ||
    normalized === "www.amazon.jobs" ||
    normalized === "wwwamazonjobs" ||
    normalized === "amazon.com" ||
    normalized === "amazoncom"
  ) {
    return "amazon";
  }
  if (
    normalized === "expediagroup" ||
    normalized === "expedia.com" ||
    normalized === "expediacom" ||
    normalized === "expediagroup.com" ||
    normalized === "expediagroupcom" ||
    normalized === "careers.expediagroup.com" ||
    normalized === "careersexpediagroupcom"
  ) {
    return "expedia";
  }
  if (
    normalized === "microsoft.com" ||
    normalized === "microsoftcom" ||
    normalized === "careers.microsoft.com" ||
    normalized === "careersmicrosoftcom" ||
    normalized === "jobs.careers.microsoft.com" ||
    normalized === "jobscareersmicrosoftcom" ||
    normalized === "gcsservices.careers.microsoft.com" ||
    normalized === "gcsservicescareersmicrosoftcom"
  ) {
    return "microsoft";
  }
  if (
    normalized === "apple.com" ||
    normalized === "applecom" ||
    normalized === "jobs.apple.com" ||
    normalized === "jobsapplecom"
  ) {
    return "apple";
  }
  if (
    normalized === "metacareers" ||
    normalized === "metacareers.com" ||
    normalized === "metacareerscom" ||
    normalized === "www.metacareers.com" ||
    normalized === "wwwmetacareerscom"
  ) {
    return "meta";
  }
  if (
    normalized === "walmart.com" ||
    normalized === "walmartcom" ||
    normalized === "careers.walmart.com" ||
    normalized === "careerswalmartcom"
  ) {
    return "walmart";
  }
  if (
    normalized === "disneycareers" ||
    normalized === "disneycareers.com" ||
    normalized === "disneycareerscom" ||
    normalized === "jobs.disneycareers.com" ||
    normalized === "jobsdisneycareerscom"
  ) {
    return "disney";
  }
  if (
    normalized === "boeing.com" ||
    normalized === "boeingcom" ||
    normalized === "jobs.boeing.com" ||
    normalized === "jobsboeingcom"
  ) {
    return "boeing";
  }
  if (normalized === "hrmdirect.com" || normalized === "hrmdirectcom") {
    return "hrmdirect";
  }
  if (normalized === "talentlyft.com" || normalized === "talentlyftcom") {
    return "talentlyft";
  }
  if (normalized === "talexio.com" || normalized === "talexiocom") {
    return "talexio";
  }
  if (normalized === "teamtailor.com" || normalized === "teamtailorcom") {
    return "teamtailor";
  }
  if (normalized === "freshteam.com" || normalized === "freshteamcom") {
    return "freshteam";
  }
  if (normalized === "agilehr.com" || normalized === "agilehrcom" || normalized === "agilehr") {
    return "agilehr";
  }
  if (
    normalized === "sagehr" ||
    normalized === "sage.hr" ||
    normalized === "talent.sage.hr" ||
    normalized === "talentsagehr"
  ) {
    return "sagehr";
  }
  if (normalized === "loxo.co" || normalized === "loxoco" || normalized === "app.loxo.co" || normalized === "apploxoco") {
    return "loxo";
  }
  if (normalized === "peopleforce.io" || normalized === "peopleforceio") {
    return "peopleforce";
  }
  if (normalized === "simplicant.com" || normalized === "simplicantcom") {
    return "simplicant";
  }
  if (normalized === "pinpointhq.com" || normalized === "pinpointhqcom") {
    return "pinpointhq";
  }
  if (normalized === "recruitcrm.io" || normalized === "recruitcrmiocom" || normalized === "recruitcrmio") {
    return "recruitcrm";
  }
  if (normalized === "rippling.com" || normalized === "ripplingcom" || normalized === "ats.rippling.com" || normalized === "atsripplingcom" || normalized === "rippling") {
    return "rippling";
  }
  if (normalized === "jobs.gem.com" || normalized === "gem.com" || normalized === "gemcom") {
    return "gem";
  }
  if (normalized === "jobapscloud.com" || normalized === "jobapscloudcom") {
    return "jobaps";
  }
  if (normalized === "join.com" || normalized === "joincom") {
    return "join";
  }
  if (
    normalized === "jobappnetwork.com" ||
    normalized === "jobappnetworkcom" ||
    normalized === "apply.jobappnetwork.com" ||
    normalized === "applyjobappnetworkcom"
  ) {
    return "talentreef";
  }
  if (
    normalized === "saphrcloud" ||
    normalized === "saphrcloud.com" ||
    normalized === "saphrcloudcom" ||
    normalized === "jobs.hr.cloud.sap" ||
    normalized === "jobshrcloudsap"
  ) {
    return "saphrcloud";
  }
  if (normalized === "adp_myjobs" || normalized === "adpmyjobs") {
    return "adp_myjobs";
  }
  if (
    normalized === "paycor" ||
    normalized === "recruitingbypaycor.com" ||
    normalized === "recruitingbypaycorcom" ||
    normalized === "www.recruitingbypaycor.com" ||
    normalized === "wwwrecruitingbypaycorcom"
  ) {
    return "paycor";
  }
  if (
    normalized === "paycomonline" ||
    normalized === "paycomonline.net" ||
    normalized === "paycomonlinenet" ||
    normalized === "www.paycomonline.net" ||
    normalized === "wwwpaycomonlinenet"
  ) {
    return "paycomonline";
  }
  if (
    normalized === "prismhr" ||
    normalized === "prismhr-hire.com" ||
    normalized === "prismhrhirecom" ||
    normalized === "www.prismhr-hire.com" ||
    normalized === "wwwprismhrhirecom"
  ) {
    return "prismhr";
  }
  if (
    normalized === "silkroad" ||
    normalized === "jobs.silkroad.com" ||
    normalized === "jobssilkroadcom" ||
    normalized === "www.jobs.silkroad.com" ||
    normalized === "wwwjobssilkroadcom"
  ) {
    return "silkroad";
  }
  if (
    normalized === "adp_workforcenow" ||
    normalized === "adpworkforcenow" ||
    normalized === "workforcenow.adp.com" ||
    normalized === "workforcenowadpcom"
  ) {
    return "adp_workforcenow";
  }
  if (normalized === "careerspage" || normalized === "careerspage.io" || normalized === "careerspageio") {
    return "careerspage";
  }
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
    normalized === "pageup" ||
    normalized === "pageuppeople" ||
    normalized === "pageuppeople.com" ||
    normalized === "pageuppeoplecom" ||
    normalized === "careers.pageuppeople.com" ||
    normalized === "careerspageuppeoplecom"
  ) {
    return "pageup";
  }
  if (
    normalized === "oracle" ||
    normalized === "oraclecloud" ||
    normalized === "oraclecloud.com" ||
    normalized === "oraclecloudcom"
  ) {
    return "oracle";
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
    normalized === "brassring" ||
    normalized === "brassring.com" ||
    normalized === "brassringcom" ||
    normalized === "sjobs.brassring.com" ||
    normalized === "sjobsbrassringcom"
  ) {
    return "brassring";
  }
  if (normalized === "applitrack.com" || normalized === "applitrackcom" || normalized === "applitrack") {
    return "applitrack";
  }
  return normalized;
}



function inferAtsFromJobPostingUrl(value) {
  const url = String(value || "").trim().toLowerCase();
  if (!url) return "";
  if (url.includes("myworkdayjobs.com")) return "workday";
  if (url.includes("jobs.ashbyhq.com")) return "ashby";
  if (url.includes("job-boards.greenhouse.io") || url.includes("boards.greenhouse.io")) return "greenhouse";
  if (url.includes("jobs.lever.co")) return "lever";
  if (url.includes(".recruitee.com")) return "recruitee";
  if (url.includes("recruiting.ultipro.com/") && url.includes("/jobboard/")) return "ultipro";
  if (url.includes(".rec.pro.ukg.net/") && url.includes("/jobboard/")) return "ukg";
  if (url.includes(".taleo.net/careersection/")) return "taleo";
  if ((url.includes("jobs.jobvite.com/") || url.includes("careers.jobvite.com/")) && url.includes("/job/")) {
    return "jobvite";
  }
  if (url.includes(".applicantpro.com/jobs")) return "applicantpro";
  if (url.includes(".applytojob.com/apply")) return "applytojob";
  if (url.includes(".applytojob.com/") || url.endsWith(".applytojob.com")) return "applytojob";
  if (url.includes(".icims.com/jobs/")) return "icims";
  if (url.includes("theapplicantmanager.com/jobs")) return "theapplicantmanager";
  if (url.includes(".breezy.hr/p/")) return "breezy";
  if (url.includes(".breezy.hr/") || url.endsWith(".breezy.hr")) return "breezy";
  if (url.includes(".zohorecruit.com/jobs/careers")) return "zoho";
  if (url.includes("applicantai.com/")) return "applicantai";
  if (url.includes(".bamboohr.com/careers")) return "bamboohr";
  if (url.includes("app.careerpuck.com/job-board/")) return "careerpuck";
  if (url.includes("dayforcehcm.com/candidateportal/")) return "dayforcehcm";
  if (url.includes("jobs.dayforcehcm.com/") && url.includes("/candidateportal")) return "dayforcehcm";
  if (url.includes("careers.dayforcehcm.com/")) return "dayforcehcm";
  if (url.includes("web.fountain.com/c/")) return "fountain";
  if (url.includes(".getro.com/jobs")) return "getro";
  if (/\.getro\.com\/companies\/[^/?#]+\/jobs\/[^/?#]+/.test(url)) return "getro";
  if (url.includes("governmentjobs.com/jobs/")) return "governmentjobs";
  if (url.includes("jobs.smartrecruiters.com/")) return "smartrecruiters";
  if (url.includes("policeapp.com/") && /\/\d+\/?$/.test(url)) return "policeapp";
  if (url.includes("usajobs.gov/job/")) return "usajobs";
  if (url.includes("k12jobspot.com/job/detail/")) return "k12jobspot";
  if (url.includes(".snaphunt.com/job/") || url.includes("api.snaphunt.com/v2/jobs")) return "snaphunt";
  if (url.includes("app.dover.com/jobs/")) return "dover";
  if (url.includes(".oorwin.com/careers/index.html#/job/details/")) return "oorwin";
  if (url.includes("schoolspring.com/job.cfm?jid=")) return "schoolspring";
  if (url.includes("edjoin.org/home/jobposting/")) return "edjoin";
  if (url.includes(".webcruiter.no/main/recruit/public/")) return "webcruiter";
  if (url.includes("candidate.webcruiter.com/en-gb/jobs/")) return "webcruiter";
  if (url.includes("academicjobsonline.org/ajo/jobs/")) return "academicjobsonline";
  if (url.includes("calcareers.ca.gov/calhrpublic/jobs/jobposting.aspx?jobcontrolid=")) return "calcareers";
  if (url.includes("calopps.org/") && url.includes("/job-")) return "calopps";
  if (url.includes("statejobsny.com/public/vacancydetailsview.cfm?id=")) return "statejobsny";
  if (url.includes("hcareers.com/jobs/")) return "hcareers";
  if (url.includes("amazon.jobs/") && url.includes("/jobs/")) return "amazon";
  if (url.includes("careers.expediagroup.com/job")) return "expedia";
  if (url.includes("jobs.careers.microsoft.com/") && url.includes("/job/")) return "microsoft";
  if (url.includes("jobs.apple.com/") && url.includes("/details/")) return "apple";
  if (url.includes("metacareers.com/jobs/")) return "meta";
  if (url.includes("careers.walmart.com/") && url.includes("/job")) return "walmart";
  if (url.includes("jobs.disneycareers.com/job/")) return "disney";
  if (url.includes("jobs.boeing.com/job/")) return "boeing";
  if (url.includes(".hrmdirect.com/employment/job-opening.php")) return "hrmdirect";
  if (url.includes(".talentlyft.com/jobs/")) return "talentlyft";
  if (url.includes(".talexio.com/jobs")) return "talexio";
  if (url.includes(".teamtailor.com/jobs/")) return "teamtailor";
  if (url.endsWith(".teamtailor.com/jobs")) return "teamtailor";
  if (url.includes(".freshteam.com/jobs/")) return "freshteam";
  if (url.endsWith(".freshteam.com/jobs")) return "freshteam";
  if (url.includes(".agilehr.com/application/login.aspx")) return "agilehr";
  if (url.includes(".agilehr.com/careerportal/jobs.aspx")) return "agilehr";
  if (url.includes("talent.sage.hr/jobs/")) return "sagehr";
  if (url.includes("www.talent.sage.hr/jobs/")) return "sagehr";
  if (url.includes("app.loxo.co/job/")) return "loxo";
  if (url.includes(".peopleforce.io/careers/")) return "peopleforce";
  if (url.endsWith(".peopleforce.io/careers")) return "peopleforce";
  if (url.includes(".simplicant.com/jobs/")) return "simplicant";
  if (url.includes(".pinpointhq.com/") && url.includes("/postings/")) return "pinpointhq";
  if (url.includes("recruitcrm.io/jobs/")) return "recruitcrm";
  if (url.includes("ats.rippling.com/") && url.includes("/jobs")) return "rippling";
  if (url.includes(".careerplug.com/jobs/")) return "careerplug";
  if (url.endsWith(".careerplug.com/jobs")) return "careerplug";
  if (url.includes("jobs.gem.com/")) return "gem";
  if (url.includes(".jobapscloud.com")) return "jobaps";
  if (url.includes("join.com/companies/")) return "join";
  if (url.includes("apply.jobappnetwork.com/apply/")) return "talentreef";
  if (/apply\.jobappnetwork\.com\/clients\/\d+\/posting\/\d+(?:[/?#]|$)/.test(url)) return "talentreef";
  if (url.includes(".jobs.hr.cloud.sap/job/")) return "saphrcloud";
  if (url.includes(".jobs.hr.cloud.sap/search/")) return "saphrcloud";
  if (url.includes("myjobs.adp.com/") && url.includes("/cx/job-details")) return "adp_myjobs";
  if (url.includes("myjobs.adp.com/")) return "adp_myjobs";
  if (url.includes("recruitingbypaycor.com/career/jobintroduction.action")) return "paycor";
  if (url.includes("recruitingbypaycor.com/career/careerhome.action")) return "paycor";
  if (url.includes("paycomonline.net/v4/ats/web.php/jobs/viewjobdetails?job=")) return "paycomonline";
  if (url.includes("paycomonline.net/v4/ats/web.php/portal/") && url.includes("/career-page")) return "paycomonline";
  if (url.includes(".prismhr-hire.com/job/")) return "prismhr";
  if (url.includes(".prismhr-hire.com")) return "prismhr";
  if (url.includes("jobs.silkroad.com/") && url.includes("/careers/jobs/")) return "silkroad";
  if (url.includes("www.jobs.silkroad.com/") && url.includes("/careers/jobs/")) return "silkroad";
  if (url.includes("jobs.silkroad.com/") && url.includes("/careers")) return "silkroad";
  if (url.includes("workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html")) return "adp_workforcenow";
  if (url.includes("workforcenow.adp.com/jobs/apply/posting.html")) return "adp_workforcenow";
  if (url.includes("careerspage.io/")) {
    const parts = url.split("careerspage.io/")[1]?.split("/").filter(Boolean) || [];
    if (parts.length >= 1) return "careerspage";
  }
  if (
    url.includes(".oraclecloud.com/hcmui/candidateexperience/") &&
    url.includes("/sites/") &&
    (url.includes("/job/") || url.endsWith("/jobs") || url.includes("/jobs?"))
  ) {
    return "oracle";
  }
  if (url.includes("careers.pageuppeople.com/") && url.includes("/job/")) return "pageup";
  if (url.includes("www.careers.pageuppeople.com/") && url.includes("/job/")) return "pageup";
  if (url.includes("recruiting.paylocity.com/recruiting/jobs/details/")) return "paylocity";
  if (
    url.includes(".eightfold.ai/careers/job/") ||
    url.includes(".eightfold.ai/careers/job?") ||
    url.includes("eightfold.ai/careers/job/") ||
    url.includes("eightfold.ai/careers/job?")
  ) {
    return "eightfold";
  }
  if (url.includes(".eightfold.ai/careers") || url.includes("eightfold.ai/careers")) return "eightfold";
  if (url.includes("recruit.hirebridge.com/v3/jobs/jobdetails.aspx")) return "hirebridge";
  if (url.includes("recruit.hirebridge.com/v3/careercenter/v2/details.aspx")) return "hirebridge";
  if (url.includes("sjobs.brassring.com/tgnewui/search/home/homewithpreload")) return "brassring";
  if (url.includes("sjobs.brassring.com/tgnewui/search/home/home")) return "brassring";
  if (url.includes(".applitrack.com/") && (url.includes("/onlineapp/default.aspx") || url.includes("/jobpostings/output.asp") || url.includes("/default.aspx?jobid="))) {
    return "applitrack";
  }
  if (url.includes(".careers.hibob.com/job/")) return "hibob";
  if (url.includes(".hiringplatform.com/") && /\/\d+\/(?:en|fr)(?:\?|$)/.test(url)) return "hiringplatform";
  if (url.includes(".homerun.co/")) return "homerun";
  if (url.includes(".jibeapply.com/")) return "jibeapply";
  if (url.includes(".jobs2web.com/job/")) return "jobs2web";
  if (url.includes("jobs.crelate.com/portal/") && url.includes("/job/")) return "crelate";
  if (url.includes(".occupop-careers.com/job/")) return "occupop";
  if (url.includes(".peopleadmin.com/postings/")) return "peopleadmin";
  if (url.includes(".jobs.personio.com/job/")) return "personio";
  if (/recruiterflow\.com\/[^/]+\/jobs\/\d+/.test(url)) return "recruiterflow";
  if (url.includes(".softgarden.io/job/")) return "softgarden";
  if (url.includes("careers.hireology.com/")) return "hireology";
  if (url.includes(".hire.trakstar.com/jobs/")) return "trakstar";
  if (url.includes(".recruiterbox.com/jobs/")) return "trakstar";
  if (url.includes(".trakstarhire.com/jobs/")) return "trakstar";
  if (url.includes("ycombinator.com/companies/") && url.includes("/jobs")) return "ycombinator";
  if (url.includes(".yello.co/jobs/")) return "yello";
  if (url.includes(".isolvedhire.com/jobs/")) return "isolved";
  if (url.includes("/careers/jobdetail/")) return "avature";
  if (url.includes(".avature.net/careers/searchjobs") || url.includes("avature.net/careers/searchjobs")) return "avature";
  if (url.includes("www.comeet.com/jobs/") || url.includes("comeet.com/jobs/")) return "comeet";
  if (url.includes(".factorialhr.com/") || url.endsWith(".factorialhr.com")) return "factorialhr";
  if (url.includes(".careers-page.com/jobs/")) return "manatal";
  if (url.includes(".careers-page.com/job/")) return "manatal";
  if (url.includes("www.careers-page.com/") && (url.includes("/job/") || url.includes("/jobs/"))) {
    return "manatal";
  }
  return "";
}


function inferPostingLocationFromJobUrl(jobPostingUrl) {
  const url = String(jobPostingUrl || "").trim();
  if (!url) return null;
  const postingLocationByJobUrl = getPostingLocationByJobUrl();

  try {
    const parsed = new URL(url);
    if (parsed.hostname.endsWith("myworkdayjobs.com")) {
      return inferWorkdayLocationFromJobUrl(url);
    }
    if (parsed.hostname === "jobs.ashbyhq.com") {
      return postingLocationByJobUrl.get(url) || null;
    }
    if (parsed.hostname === "job-boards.greenhouse.io" || parsed.hostname === "boards.greenhouse.io") {
      return postingLocationByJobUrl.get(url) || null;
    }
    if (parsed.hostname === "jobs.lever.co") {
      return postingLocationByJobUrl.get(url) || null;
    }
    if (parsed.hostname.endsWith(".recruitee.com")) {
      return postingLocationByJobUrl.get(url) || null;
    }
    if (parsed.hostname === "recruiting.ultipro.com") {
      return postingLocationByJobUrl.get(url) || null;
    }
    if (parsed.hostname.endsWith(".taleo.net")) {
      return postingLocationByJobUrl.get(url) || null;
    }
    if (parsed.hostname === "jobs.jobvite.com" || parsed.hostname === "careers.jobvite.com") {
      return postingLocationByJobUrl.get(url) || null;
    }
    if (parsed.hostname.endsWith(".applicantpro.com")) {
      return postingLocationByJobUrl.get(url) || null;
    }
    if (parsed.hostname.endsWith(".applytojob.com")) {
      return postingLocationByJobUrl.get(url) || null;
    }
    if (parsed.hostname.endsWith(".icims.com")) {
      return postingLocationByJobUrl.get(url) || null;
    }
    if (parsed.hostname.endsWith("theapplicantmanager.com")) {
      return postingLocationByJobUrl.get(url) || null;
    }
    if (parsed.hostname.endsWith(".breezy.hr")) {
      return postingLocationByJobUrl.get(url) || null;
    }
    if (parsed.hostname.endsWith(".zohorecruit.com")) {
      return postingLocationByJobUrl.get(url) || null;
    }
    if (parsed.hostname.endsWith(".bamboohr.com")) {
      return postingLocationByJobUrl.get(url) || null;
    }
    if (parsed.hostname === "applicantai.com" || parsed.hostname === "www.applicantai.com") {
      return postingLocationByJobUrl.get(url) || null;
    }
    if (parsed.hostname.endsWith(".careerplug.com")) {
      return postingLocationByJobUrl.get(url) || null;
    }
    if (parsed.hostname === "www.careers-page.com" || parsed.hostname.endsWith(".careers-page.com")) {
      return postingLocationByJobUrl.get(url) || null;
    }
    if (parsed.hostname === "app.careerpuck.com" || parsed.hostname === "www.app.careerpuck.com") {
      return postingLocationByJobUrl.get(url) || null;
    }
    if (parsed.hostname === "careers.dayforcehcm.com" || parsed.hostname.endsWith(".dayforcehcm.com")) {
      return postingLocationByJobUrl.get(url) || null;
    }
    if (parsed.hostname === "web.fountain.com" || parsed.hostname === "www.web.fountain.com") {
      return postingLocationByJobUrl.get(url) || null;
    }
    if (parsed.hostname.endsWith(".getro.com")) {
      return postingLocationByJobUrl.get(url) || null;
    }
    if (parsed.hostname === "www.governmentjobs.com" || parsed.hostname === "governmentjobs.com") {
      return postingLocationByJobUrl.get(url) || null;
    }
    if (parsed.hostname === "jobs.smartrecruiters.com" || parsed.hostname === "www.jobs.smartrecruiters.com") {
      return postingLocationByJobUrl.get(url) || null;
    }
    if (parsed.hostname === "www.policeapp.com" || parsed.hostname === "policeapp.com") {
      return postingLocationByJobUrl.get(url) || null;
    }
    if (parsed.hostname === "www.usajobs.gov" || parsed.hostname === "usajobs.gov") {
      return postingLocationByJobUrl.get(url) || null;
    }
    if (parsed.hostname === "www.k12jobspot.com" || parsed.hostname === "k12jobspot.com") {
      return postingLocationByJobUrl.get(url) || null;
    }
    if (parsed.hostname === "www.schoolspring.com" || parsed.hostname === "schoolspring.com") {
      return postingLocationByJobUrl.get(url) || null;
    }
    if (parsed.hostname === "calcareers.ca.gov" || parsed.hostname === "www.calcareers.ca.gov") {
      return postingLocationByJobUrl.get(url) || null;
    }
    if (parsed.hostname === "calopps.org" || parsed.hostname === "www.calopps.org") {
      return postingLocationByJobUrl.get(url) || null;
    }
    if (parsed.hostname === "statejobsny.com" || parsed.hostname === "www.statejobsny.com") {
      return postingLocationByJobUrl.get(url) || null;
    }
    if (parsed.hostname === "candidate.webcruiter.com" || parsed.hostname.endsWith(".webcruiter.no")) {
      return postingLocationByJobUrl.get(url) || null;
    }
    if (parsed.hostname.endsWith(".hrmdirect.com")) {
      return postingLocationByJobUrl.get(url) || null;
    }
    if (parsed.hostname.endsWith(".talentlyft.com")) {
      return postingLocationByJobUrl.get(url) || null;
    }
    if (parsed.hostname.endsWith(".talexio.com")) {
      return postingLocationByJobUrl.get(url) || null;
    }
    if (parsed.hostname.endsWith(".teamtailor.com")) {
      return postingLocationByJobUrl.get(url) || null;
    }
    if (parsed.hostname.endsWith(".freshteam.com")) {
      return postingLocationByJobUrl.get(url) || null;
    }
    if (parsed.hostname.endsWith(".agilehr.com")) {
      return postingLocationByJobUrl.get(url) || null;
    }
    if (parsed.hostname === "talent.sage.hr" || parsed.hostname === "www.talent.sage.hr") {
      return postingLocationByJobUrl.get(url) || null;
    }
    if (parsed.hostname === "app.loxo.co" || parsed.hostname === "www.app.loxo.co") {
      return postingLocationByJobUrl.get(url) || null;
    }
    if (parsed.hostname === "jobs.gem.com" || parsed.hostname === "www.jobs.gem.com") {
      return postingLocationByJobUrl.get(url) || null;
    }
    if (parsed.hostname.endsWith(".jobapscloud.com")) {
      return postingLocationByJobUrl.get(url) || null;
    }
    if (parsed.hostname === "join.com" || parsed.hostname === "www.join.com") {
      return postingLocationByJobUrl.get(url) || null;
    }
    if (parsed.hostname === "apply.jobappnetwork.com" || parsed.hostname === "www.apply.jobappnetwork.com") {
      return postingLocationByJobUrl.get(url) || null;
    }
    if (parsed.hostname.endsWith(".jobs.hr.cloud.sap")) {
      return postingLocationByJobUrl.get(url) || null;
    }
    if (parsed.hostname === "myjobs.adp.com" || parsed.hostname === "www.myjobs.adp.com") {
      return postingLocationByJobUrl.get(url) || null;
    }
    if (parsed.hostname === "recruitingbypaycor.com" || parsed.hostname === "www.recruitingbypaycor.com") {
      return postingLocationByJobUrl.get(url) || null;
    }
    if (parsed.hostname === "paycomonline.net" || parsed.hostname === "www.paycomonline.net") {
      return postingLocationByJobUrl.get(url) || null;
    }
    if (parsed.hostname.endsWith(".prismhr-hire.com")) {
      return postingLocationByJobUrl.get(url) || null;
    }
    if (parsed.hostname === "jobs.silkroad.com" || parsed.hostname === "www.jobs.silkroad.com") {
      return postingLocationByJobUrl.get(url) || null;
    }
    if (parsed.hostname === "workforcenow.adp.com" || parsed.hostname === "www.workforcenow.adp.com") {
      return postingLocationByJobUrl.get(url) || null;
    }
    if (parsed.hostname === "careerspage.io" || parsed.hostname === "www.careerspage.io") {
      return postingLocationByJobUrl.get(url) || null;
    }
    if (parsed.hostname === "recruiting.paylocity.com" || parsed.hostname === "www.recruiting.paylocity.com") {
      return postingLocationByJobUrl.get(url) || null;
    }
    if (
      parsed.hostname === "eightfold.ai" ||
      parsed.hostname === "www.eightfold.ai" ||
      parsed.hostname.endsWith(".eightfold.ai")
    ) {
      return postingLocationByJobUrl.get(url) || null;
    }
    if (parsed.hostname === "careers.pageuppeople.com" || parsed.hostname === "www.careers.pageuppeople.com") {
      return postingLocationByJobUrl.get(url) || null;
    }
    if (parsed.hostname.endsWith(".oraclecloud.com") && parsed.pathname.toLowerCase().includes("/hcmui/candidateexperience/")) {
      return postingLocationByJobUrl.get(url) || null;
    }
    if (parsed.hostname === "recruit.hirebridge.com" || parsed.hostname === "www.recruit.hirebridge.com") {
      return postingLocationByJobUrl.get(url) || null;
    }
    if (parsed.hostname === "sjobs.brassring.com" || parsed.hostname === "www.sjobs.brassring.com") {
      return postingLocationByJobUrl.get(url) || null;
    }
    if (parsed.hostname.endsWith(".applitrack.com")) {
      return postingLocationByJobUrl.get(url) || null;
    }
    return null;
  } catch {
    return null;
  }
}


module.exports = { ATS_FILTER_OPTION_ITEMS, SYNC_DEFAULT_ENABLED_ATS, ATS_FILTER_OPTIONS, normalizeCompanyNameForBlockList, normalizeSyncEnabledAts, normalizeAtsFilters, normalizeAtsFilterValue, inferAtsFromJobPostingUrl, inferPostingLocationFromJobUrl };
