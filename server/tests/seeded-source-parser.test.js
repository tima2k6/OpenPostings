const assert = require("assert");
const {
  classifySeededCompanySourceUrl,
  listSeededAtsValues,
  DYNAMIC_ATS_OPTIONS,
  SEEDED_ATS_OPTIONS
} = require("..");

function run() {
  const seededAtsValues = listSeededAtsValues();
  assert.ok(Array.isArray(seededAtsValues), "listSeededAtsValues should return an array");
  assert.ok(seededAtsValues.includes("workday"), "workday should be listed as seeded ATS");
  assert.ok(!seededAtsValues.includes("smartrecruiters"), "dynamic ATS should be excluded from seeded ATS list");

  const workday = classifySeededCompanySourceUrl("https://aah.wd5.myworkdayjobs.com/External");
  assert.equal(workday.supported, true, "Workday URL should be supported");
  assert.equal(workday.ats, "workday", "Workday ATS should be detected");
  assert.equal(workday.company_identifier, "External", "Workday identifier should come from company path segment");

  const greenhouse = classifySeededCompanySourceUrl("boards.greenhouse.io/insider");
  assert.equal(greenhouse.supported, true, "Greenhouse URL should be supported even without explicit scheme");
  assert.equal(greenhouse.ats, "greenhouse", "Greenhouse ATS should be detected");
  assert.equal(greenhouse.company_identifier, "insider", "Greenhouse identifier should be board token");

  const dynamic = classifySeededCompanySourceUrl("https://jobs.smartrecruiters.com/sr-jobs/search");
  assert.equal(dynamic.supported, false, "Dynamic ATS URL should not be supported");
  assert.equal(dynamic.reason, "dynamic_ats_not_supported", "Dynamic ATS URL should be explicitly rejected");
  assert.ok(DYNAMIC_ATS_OPTIONS.has("smartrecruiters"), "smartrecruiters should be in dynamic ATS set");

  const invalid = classifySeededCompanySourceUrl("not-a-url");
  assert.equal(invalid.supported, false, "Invalid URL should not be supported");
  assert.equal(invalid.reason, "unrecognized_or_not_seeded", "Unknown URL should be treated as unsupported seeded source");

  // Applitrack puts every employer on one domain and distinguishes them by the first path
  // segment. Returning only siteRoot left the identifier falling through to the URL itself,
  // and 1,323 distinct employers ended up stored as the company "www" (see
  // server/scripts/repair-applitrack-company-names.js). The identifier has to be the tenant.
  const applitrack = classifySeededCompanySourceUrl("https://www.applitrack.com/aacs/onlineapp/default.aspx?all=1");
  assert.equal(applitrack.supported, true, "Applitrack URL should be supported");
  assert.equal(applitrack.ats, "applitrack", "Applitrack ATS should be detected");
  assert.equal(applitrack.company_identifier, "aacs", "Applitrack identifier should be the tenant path segment");
  assert.equal(applitrack.company_identifier_key, "companySlug", "Applitrack identifier should come from companySlug");
  assert.ok(
    !/^https?:/i.test(String(applitrack.suggested_company_name || "")),
    "Applitrack suggested name must never be a URL -- that is what produced the 'www' companies"
  );

  assert.ok(SEEDED_ATS_OPTIONS.has("workday"), "workday should exist in seeded ATS set");
  assert.ok(!SEEDED_ATS_OPTIONS.has("smartrecruiters"), "dynamic ATS should not exist in seeded ATS set");

  console.log("seeded-source-parser tests passed");
}

run();

