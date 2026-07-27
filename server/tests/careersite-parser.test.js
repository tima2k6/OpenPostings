// The career-site engine reads employers who run their own platform through the two things
// a site cannot drop and stay in Google for Jobs: its sitemap and the schema.org JobPosting
// block on each detail page. What is worth pinning is (a) the sweep stays bounded -- only
// job URLs, only entries the sitemap dates inside the window, capped either way -- and
// (b) the JSON-LD shapes a page is allowed to use: a bare object, an array, or a @graph
// wrapper. Every employer added to CAREER_SITE_CONFIGS rides on this same engine, so the
// config table is checked for self-consistency rather than each employer being retested.
const assert = require("assert");
const {
  CAREER_SITE_CONFIGS,
  CAREER_SITE_KEYS,
  getCareerSiteConfig,
  parseSitemapUrlsFromRobotsTxt,
  parseSitemapEntries,
  selectCareerSiteJobCandidates,
  parseCareerSiteJobPostingFromHtml,
  isCareerSiteJobUrl
} = require("../ats/careersite/service.js");

const EXPEDIA = getCareerSiteConfig("expedia");

function buildJsonLdPage(jobPosting, { wrapper = "object" } = {}) {
  let payload = jobPosting;
  if (wrapper === "array") payload = [{ "@type": "WebSite", name: "Careers" }, jobPosting];
  if (wrapper === "graph") payload = { "@context": "https://schema.org", "@graph": [jobPosting] };
  return `
<!doctype html>
<html><head>
<script type="application/ld+json">${JSON.stringify(payload)}</script>
</head><body></body></html>`;
}

function testConfigTableIsSelfConsistent() {
  assert.ok(CAREER_SITE_KEYS.length > 0, "the engine is pointless with no employers configured");

  for (const siteKey of CAREER_SITE_KEYS) {
    const config = CAREER_SITE_CONFIGS[siteKey];
    assert.equal(siteKey, siteKey.toLowerCase(), `${siteKey} must be a canonical lowercase ATS value`);
    assert.ok(config.label, `${siteKey} needs a label`);
    assert.ok(config.default_company_name, `${siteKey} needs a fallback company name for rows whose JSON-LD omits one`);
    assert.ok(config.job_path_pattern instanceof RegExp, `${siteKey} needs a job path pattern`);
    assert.ok(
      Number.isInteger(config.estimated_company_count) && config.estimated_company_count > 0,
      `${siteKey} needs a positive company estimate`
    );

    // An origin with a path would make every URL join and host comparison wrong.
    const origin = new URL(config.origin);
    assert.equal(origin.pathname, "/", `${siteKey} origin should be a bare host`);
    assert.equal(origin.protocol, "https:", `${siteKey} should be swept over https`);

    // A pattern that matches the site root would send the sweep at listing pages.
    assert.equal(
      isCareerSiteJobUrl(config, config.origin),
      false,
      `${siteKey} must not treat its own root as a posting`
    );
    assert.equal(
      isCareerSiteJobUrl(config, "https://careers.example.com/job/a/b/R-1/"),
      false,
      `${siteKey} must not sweep another host's job URL`
    );
  }
}

function testRepresentativeJobUrlsPerEmployer() {
  // One real-shaped URL per employer, so a config typo shows up as a failing test rather
  // than a sweep that silently fetches nothing.
  const cases = [
    ["expedia", "https://careers.expediagroup.com/job/sr-finance-analyst/chicago-IL/R-100047/", true],
    ["expedia", "https://careers.expediagroup.com/jobs/", false],
    ["expedia", "https://careers.expediagroup.com/jobs/search", false],
    ["apple", "https://jobs.apple.com/en-us/details/200612345/senior-software-engineer", true],
    ["apple", "https://jobs.apple.com/en-us/search", false],
    ["meta", "https://www.metacareers.com/jobs/1234567890123456/", true],
    ["meta", "https://www.metacareers.com/jobs/", false],
    ["walmart", "https://careers.walmart.com/us/jobs/WD1234567-software-engineer", true],
    ["walmart", "https://careers.walmart.com/us/jobs", false],
    ["disney", "https://jobs.disneycareers.com/job/orlando/ride-mechanic/391/12345678", true],
    ["disney", "https://jobs.disneycareers.com/search-jobs", false],
    ["boeing", "https://jobs.boeing.com/job/seattle/structures-engineer/185/98765432", true],
    ["boeing", "https://jobs.boeing.com/", false]
  ];

  for (const [siteKey, url, expected] of cases) {
    assert.equal(
      isCareerSiteJobUrl(getCareerSiteConfig(siteKey), url),
      expected,
      `${siteKey} should ${expected ? "accept" : "reject"} ${url}`
    );
  }
}

function testSitemapDiscoveryAndParsing() {
  const robots = [
    "User-agent: *",
    "Disallow: /apply/",
    "Sitemap: https://careers.expediagroup.com/sitemap.xml",
    "sitemap: /sitemap-jobs.xml",
    "Sitemap: https://www.expedia.com/sitemap.xml"
  ].join("\n");
  assert.deepEqual(
    parseSitemapUrlsFromRobotsTxt(robots, EXPEDIA),
    ["https://careers.expediagroup.com/sitemap.xml", "https://careers.expediagroup.com/sitemap-jobs.xml"],
    "relative sitemaps resolve against the board, and off-host ones are not followed"
  );

  const indexXml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>https://careers.expediagroup.com/sitemap-jobs-1.xml</loc><lastmod>2026-07-27T09:00:00+00:00</lastmod></sitemap>
  <sitemap><loc>https://careers.expediagroup.com/sitemap-pages.xml</loc></sitemap>
</sitemapindex>`;
  const parsedIndex = parseSitemapEntries(indexXml);
  assert.equal(parsedIndex.is_index, true, "a sitemapindex must be recognised as one");
  assert.equal(parsedIndex.entries.length, 2);
  assert.equal(parsedIndex.entries[0].lastmod, "2026-07-27T09:00:00+00:00");
  assert.equal(parsedIndex.entries[1].lastmod, null, "an undated child should report no lastmod");

  const urlSetXml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://careers.expediagroup.com/job/a/chicago-IL/R-1/</loc><lastmod>2026-07-27</lastmod></url>
  <url><loc>https://careers.expediagroup.com/about-us/</loc></url>
</urlset>`;
  const parsedUrlSet = parseSitemapEntries(urlSetXml);
  assert.equal(parsedUrlSet.is_index, false);
  assert.equal(parsedUrlSet.entries.length, 2);
}

function testCandidateSelectionStaysBounded() {
  const referenceEpoch = Math.floor(Date.UTC(2026, 6, 27, 12, 0, 0) / 1000);
  const freshIso = new Date((referenceEpoch - 3 * 60 * 60) * 1000).toISOString();
  const olderFreshIso = new Date((referenceEpoch - 9 * 60 * 60) * 1000).toISOString();
  const staleIso = new Date((referenceEpoch - 30 * 24 * 60 * 60) * 1000).toISOString();

  const candidates = selectCareerSiteJobCandidates(
    EXPEDIA,
    [
      { loc: "https://careers.expediagroup.com/job/data-engineer/seattle-WA/R-100048/", lastmod: staleIso },
      { loc: "https://careers.expediagroup.com/job/sr-finance-analyst/chicago-IL/R-100047/", lastmod: olderFreshIso },
      { loc: "https://careers.expediagroup.com/job/product-manager/london/R-100049/", lastmod: freshIso },
      { loc: "https://careers.expediagroup.com/jobs/", lastmod: freshIso },
      { loc: "https://careers.expediagroup.com/job/undated-role/austin-TX/R-100050/", lastmod: null },
      { loc: "https://careers.expediagroup.com/job/product-manager/london/R-100049/", lastmod: freshIso }
    ],
    referenceEpoch
  );
  assert.deepEqual(
    candidates,
    [
      "https://careers.expediagroup.com/job/product-manager/london/R-100049/",
      "https://careers.expediagroup.com/job/sr-finance-analyst/chicago-IL/R-100047/",
      "https://careers.expediagroup.com/job/undated-role/austin-TX/R-100050/"
    ],
    "dated entries come newest-first, the stale one is never fetched, undated ones trail, and duplicates collapse"
  );

  assert.equal(
    selectCareerSiteJobCandidates(
      EXPEDIA,
      [
        { loc: "https://careers.expediagroup.com/job/a/x/R-1/", lastmod: freshIso },
        { loc: "https://careers.expediagroup.com/job/b/x/R-2/", lastmod: freshIso }
      ],
      referenceEpoch,
      1
    ).length,
    1,
    "the per-sync cap must bound how many detail pages a sweep can fetch"
  );
}

function testJsonLdParsing() {
  const jobPosting = {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: "Senior Finance Analyst",
    datePosted: "2026-07-27",
    url: "https://careers.expediagroup.com/job/sr-finance-analyst/chicago-IL/R-100047/",
    description: "<p>Own the forecasting model for <b>Lodging</b>.</p>",
    hiringOrganization: { "@type": "Organization", name: "Expedia Group" },
    jobLocation: {
      "@type": "Place",
      address: { "@type": "PostalAddress", addressLocality: "Chicago", addressRegion: "IL", addressCountry: "US" }
    },
    baseSalary: {
      "@type": "MonetaryAmount",
      currency: "USD",
      value: { "@type": "QuantitativeValue", minValue: 110000, maxValue: 150000, unitText: "YEAR" }
    }
  };

  for (const wrapper of ["object", "array", "graph"]) {
    const posting = parseCareerSiteJobPostingFromHtml(EXPEDIA, buildJsonLdPage(jobPosting, { wrapper }), "https://ignored/");
    assert.ok(posting, `a ${wrapper} JSON-LD block should still yield the posting`);
    assert.equal(posting.position_name, "Senior Finance Analyst");
    assert.equal(posting.company_name, "Expedia Group");
    assert.equal(
      posting.job_posting_url,
      "https://careers.expediagroup.com/job/sr-finance-analyst/chicago-IL/R-100047/",
      "the posting's own canonical URL wins over the page it was fetched from"
    );
    assert.equal(posting.posting_date, "2026-07-27");
    assert.equal(posting.location, "Chicago, IL, US");
    assert.equal(posting.job_description, "Own the forecasting model for Lodging .");
    assert.equal(posting.compensation_type, "salary");
    assert.equal(posting.pay_min, 110000);
    assert.equal(posting.pay_max, 150000);
    assert.equal(posting.pay_currency, "USD");
    assert.equal(posting.pay_period, "year");
    assert.equal(posting.pay_raw, "USD 110000 - 150000 per year");
  }

  // Hourly and remote are the other two shapes these boards publish. A row whose JSON-LD
  // names no employer falls back to the site's own name -- which is why every config
  // carries one.
  const hourlyRemote = parseCareerSiteJobPostingFromHtml(
    getCareerSiteConfig("disney"),
    buildJsonLdPage({
      "@type": "JobPosting",
      title: "Guest Services Host",
      datePosted: "2026-07-27T08:15:00+00:00",
      jobLocationType: "TELECOMMUTE",
      baseSalary: {
        "@type": "MonetaryAmount",
        currency: "USD",
        value: { "@type": "QuantitativeValue", value: 22.5, unitText: "HOUR" }
      }
    }),
    "https://jobs.disneycareers.com/job/orlando/guest-services-host/391/1/"
  );
  assert.equal(
    hourlyRemote.job_posting_url,
    "https://jobs.disneycareers.com/job/orlando/guest-services-host/391/1/",
    "a posting that omits its own url falls back to the page it came from"
  );
  assert.equal(hourlyRemote.company_name, "The Walt Disney Company");
  assert.equal(hourlyRemote.location, "Remote");
  assert.equal(hourlyRemote.compensation_type, "hourly");
  assert.equal(hourlyRemote.pay_min, 22.5);
  assert.equal(hourlyRemote.pay_max, 22.5);
  assert.equal(hourlyRemote.pay_period, "hour");

  assert.equal(
    parseCareerSiteJobPostingFromHtml(EXPEDIA, `<script type="application/ld+json">{ not json }</script>`, "https://x/"),
    null,
    "unparseable JSON-LD should yield no posting rather than throw"
  );
  assert.equal(
    parseCareerSiteJobPostingFromHtml(EXPEDIA, buildJsonLdPage({ "@type": "BreadcrumbList", itemListElement: [] }), "https://x/"),
    null,
    "a page with only non-JobPosting structured data is not a posting"
  );
  const noSalary = parseCareerSiteJobPostingFromHtml(
    EXPEDIA,
    buildJsonLdPage({ "@type": "JobPosting", title: "Analyst", datePosted: "2026-07-27", baseSalary: {} }),
    "https://x/"
  );
  assert.equal(noSalary.compensation_type, "unknown");
  assert.equal(noSalary.pay_min, null);
  assert.equal(noSalary.pay_raw, null);
}

function run() {
  testConfigTableIsSelfConsistent();
  testRepresentativeJobUrlsPerEmployer();
  testSitemapDiscoveryAndParsing();
  testCandidateSelectionStaysBounded();
  testJsonLdParsing();
  console.log("careersite-parser tests passed");
}

run();
