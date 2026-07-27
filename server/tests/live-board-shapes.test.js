// Everything the other board tests assert is built from hand-written payloads, which is
// exactly how the collectors in this directory came to be wrong: a parser can agree with an
// invented fixture forever while disagreeing with the board it is aimed at. The fixtures
// under fixtures/ are captured verbatim from the live boards on 2026-07-27 -- trimmed to a
// couple of entries and with long description bodies cut, but otherwise the bytes those
// hosts served -- so this file is the one place where the parsers are checked against what
// the employers actually publish rather than against what we assumed they publish.
//
// Each case below records a specific thing the real response disagreed with:
//
//   amazon    `id` is a UUID now, not the "jobs/2847362" path the URL builder assumed, so
//             the fallback order had to change. The response also confirms job_path,
//             posted_date and company_name are the field names the parser reads.
//   microsoft the board moved hosts entirely; this pins the new URL shape and the fact that
//             its canonical `url` is published as http:// on an https-only site.
//   expedia   its JobPosting carries no `url` at all, so the sweep must fall back to the
//             page it fetched -- and the sitemap publishes http:// locs.
//   boeing    datePosted is "2026-7-27": a real date with unpadded month and day, which is
//             not ISO 8601 and would be easy to write a parser that rejects.
//   walmart   the sitemap is included to pin the job URL shape the old config missed.
//   disney    a real detail page with no JSON-LD, which is why that employer is not
//             configured; if Disney ever turns structured data on, this test starts failing
//             and says so.
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const {
  getCareerSiteConfig,
  parseSitemapEntries,
  parseCareerSiteJobPostingFromHtml,
  isCareerSiteJobUrl,
  looksLikeSitemapXml
} = require("../ats/careersite/service.js");
const {
  parseAmazonPostingsFromPayload,
  buildAmazonJobPostingUrl
} = require("../ats/amazon/service.js");

const FIXTURES = path.join(__dirname, "fixtures");

function readFixture(name) {
  return fs.readFileSync(path.join(FIXTURES, name), "utf8");
}

function testAmazonParsesItsRealSearchResponse() {
  const payload = JSON.parse(readFixture("amazon-search.json"));
  const postings = parseAmazonPostingsFromPayload(payload);

  assert.ok(postings.length > 0, "the real search response must yield postings");

  const first = postings[0];
  assert.ok(
    first.job_posting_url.startsWith("https://www.amazon.jobs/en/jobs/"),
    `a stored Amazon URL must stay on the board: ${first.job_posting_url}`
  );
  assert.ok(first.position_name && first.position_name !== "Untitled Position");
  // amazon.jobs carries every Amazon operating company and names the real entity per row,
  // which is why company_name is read rather than defaulted to "Amazon".
  assert.ok(first.company_name && first.company_name !== "Amazon");
  assert.ok(/^[A-Z][a-z]+ \d{1,2}, \d{4}$/.test(first.posting_date), `posted_date shape: ${first.posting_date}`);
  assert.ok(first.location, "rows carry a normalized location");

  // The correction this response forced. `id` is a UUID; putting it after /en/ builds a page
  // that 404s, while /en/jobs/<id_icims> resolves. A row missing job_path must therefore
  // fall through to id_icims, and must never be stored under a URL built from the UUID.
  const realRow = payload.jobs[0];
  assert.ok(
    /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(realRow.id),
    "this fixture is only meaningful while the board still returns a UUID id"
  );
  assert.equal(
    buildAmazonJobPostingUrl({ id: realRow.id, id_icims: realRow.id_icims }),
    `https://www.amazon.jobs/en/jobs/${realRow.id_icims}`,
    "with no job_path the numeric id_icims is the id that resolves, not the UUID"
  );
  assert.equal(
    buildAmazonJobPostingUrl({ id: realRow.id }),
    "",
    "a UUID alone names no reachable page, so the row is dropped rather than stored broken"
  );
  assert.equal(
    buildAmazonJobPostingUrl({ id: "jobs/2847362" }),
    "https://www.amazon.jobs/en/jobs/2847362",
    "the older path-shaped id is still honoured"
  );
}

function testMicrosoftParsesItsRealDetailPage() {
  const config = getCareerSiteConfig("microsoft");
  const pageUrl =
    "https://apply.careers.microsoft.com/careers/job/1970393556913009-support-escalation-manager-australia-australian-capital-territory-canberra?domain=microsoft.com";

  assert.ok(isCareerSiteJobUrl(config, pageUrl), "the live job URL shape must match the config pattern");

  const posting = parseCareerSiteJobPostingFromHtml(config, readFixture("microsoft-job.html"), pageUrl);
  assert.ok(posting, "Microsoft's detail page carries a JobPosting block");
  assert.equal(posting.position_name, "Support Escalation Manager");
  assert.equal(posting.company_name, "Microsoft");
  assert.equal(posting.posting_date, "2026-07-13T13:04:12");
  assert.ok(posting.location && posting.location.includes("Canberra"), `location: ${posting.location}`);
  assert.ok(
    posting.job_posting_url.startsWith("https://apply.careers.microsoft.com/careers/job/"),
    `the published canonical is http://, but only https answers: ${posting.job_posting_url}`
  );
}

function testMicrosoftSitemapNamesJobUrls() {
  const config = getCareerSiteConfig("microsoft");
  const parsed = parseSitemapEntries(readFixture("microsoft-sitemap.xml"));

  assert.ok(looksLikeSitemapXml(readFixture("microsoft-sitemap.xml")));
  assert.equal(parsed.is_index, false, "the board publishes a flat urlset, not an index");

  const jobEntries = parsed.entries.filter((entry) => isCareerSiteJobUrl(config, entry.loc));
  assert.ok(
    jobEntries.length > 0,
    "the configured pattern must match the URLs this sitemap actually contains"
  );
  assert.ok(
    jobEntries.every((entry) => entry.lastmod),
    "these entries are dated, which is what keeps the sweep inside the freshness window"
  );
}

function testExpediaFallsBackToThePageItFetched() {
  const config = getCareerSiteConfig("expedia");
  const pageUrl =
    "https://careers.expediagroup.com/job/security-engineer-ii-threat-detection/gurgaon-hary-na/R-107165/";

  const posting = parseCareerSiteJobPostingFromHtml(config, readFixture("expedia-job.html"), pageUrl);
  assert.ok(posting, "Expedia's detail page carries a JobPosting block");
  assert.equal(posting.position_name, "Security Engineer II - Threat Detection");
  assert.equal(posting.posting_date, "2026-07-27");
  // This page's JSON-LD has no `url` member at all, so the only URL available is the one the
  // sweep fetched. Storing nothing here would drop an otherwise complete posting.
  assert.equal(posting.job_posting_url, pageUrl);

  // The sitemap index names a jobs child among marketing ones; the sweep prefers the former.
  const index = parseSitemapEntries(readFixture("expedia-sitemap-index.xml"));
  assert.equal(index.is_index, true);
  assert.ok(
    index.entries.some((entry) => /jobs-sitemap\.xml$/.test(entry.loc)),
    "the jobs child must be discoverable from the index"
  );

  // Expedia publishes its sitemap locs as http:// even though the board redirects to https.
  const jobs = parseSitemapEntries(readFixture("expedia-jobs-sitemap.xml"));
  assert.ok(jobs.entries.length > 0);
  assert.ok(
    jobs.entries.every((entry) => isCareerSiteJobUrl(config, entry.loc)),
    "every loc in the jobs sitemap should be recognised as a job URL regardless of scheme"
  );
}

function testBoeingParsesItsRealDetailPage() {
  const config = getCareerSiteConfig("boeing");
  const pageUrl = "https://jobs.boeing.com/job/wichita/entry-level-manufacturing-planner/185/98381256240";

  const posting = parseCareerSiteJobPostingFromHtml(config, readFixture("boeing-job.html"), pageUrl);
  assert.ok(posting, "Boeing's detail page carries a JobPosting block");
  assert.equal(posting.position_name, "Entry-level Manufacturing Planner");
  assert.equal(posting.company_name, "Boeing");
  // Not ISO 8601: the month and day are unpadded. A stricter reader would drop every Boeing
  // row on the floor, so this is worth stating outright.
  assert.equal(posting.posting_date, "2026-7-27");
  assert.equal(posting.job_posting_url, pageUrl);
  assert.ok(posting.location && posting.location.includes("Wichita"), `location: ${posting.location}`);
}

function testDroppedEmployersStillFailTheContract() {
  // Walmart's sitemap is fine and its URLs are regular; what the old config had wrong was
  // their shape. Nothing here is configured for Walmart any more, so the check is simply
  // that these are the URLs the board publishes -- the record of why the guess missed.
  const walmart = parseSitemapEntries(readFixture("walmart-sitemap.xml"));
  const walmartJobs = walmart.entries.filter((entry) => /\/jobs\//.test(entry.loc));
  assert.ok(walmartJobs.length > 0, "the fixture should contain Walmart job URLs");
  assert.ok(
    walmartJobs.every((entry) => new URL(entry.loc).pathname.startsWith("/us/en/jobs/")),
    "Walmart publishes /us/en/jobs/<req>, which the original /us/jobs/ pattern never matched"
  );
  assert.ok(
    walmart.entries.every((entry) => !entry.lastmod),
    "Walmart dates none of its entries, so even a correct pattern gives the sweep nothing to sort by"
  );

  // Walmart and Disney both serve real, populated job pages with no structured data on them.
  // That is the half of the contract this engine cannot supply, and the reason both are
  // absent from CAREER_SITE_CONFIGS rather than configured and quietly returning zero.
  for (const [employer, fixture, pageUrl] of [
    ["walmart", "walmart-job-no-jsonld.html", "https://careers.walmart.com/us/en/jobs/R-1075582"],
    ["disney", "disney-job-no-jsonld.html", "https://jobs.disneycareers.com/job/lake-buena-vista/analyst/391/98380876816"]
  ]) {
    const html = readFixture(fixture);
    assert.ok(html.length > 0, `${employer} fixture should not be empty`);
    assert.equal(
      /application\/ld\+json/i.test(html),
      false,
      `${employer} publishes no JSON-LD; if that changes, reconsider adding it back to the config table`
    );
    // Parsed through the engine anyway, a page like this yields nothing rather than a bad row.
    assert.equal(parseCareerSiteJobPostingFromHtml(getCareerSiteConfig("boeing"), html, pageUrl), null);
  }
}

function testSoftFourOhFourIsNotASitemap() {
  // jobs.apple.com answers an unknown path with its SPA shell and a 200. Treating that as a
  // readable sitemap is what would turn "this board moved" into a clean zero.
  assert.equal(looksLikeSitemapXml("<!DOCTYPE html><html><head><title>Apple</title></head></html>"), false);
  assert.equal(looksLikeSitemapXml(""), false);
  assert.equal(looksLikeSitemapXml(readFixture("microsoft-sitemap.xml")), true);
  assert.equal(looksLikeSitemapXml(readFixture("expedia-sitemap-index.xml")), true);
}

function run() {
  testAmazonParsesItsRealSearchResponse();
  testMicrosoftParsesItsRealDetailPage();
  testMicrosoftSitemapNamesJobUrls();
  testExpediaFallsBackToThePageItFetched();
  testBoeingParsesItsRealDetailPage();
  testDroppedEmployersStillFailTheContract();
  testSoftFourOhFourIsNotASitemap();
  console.log("live-board-shapes tests passed");
}

run();
