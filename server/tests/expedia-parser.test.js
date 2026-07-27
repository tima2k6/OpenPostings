// Expedia Group's careers site has no public search API, so the collector reads it the
// way Google for Jobs does: sitemap for the URL list, schema.org JobPosting for the row.
// The parts worth pinning are the ones that keep the sweep bounded (only job URLs, only
// entries the sitemap dates inside the window) and the JSON-LD shapes the page is allowed
// to use -- a bare object, an array, or a @graph wrapper.
const assert = require("assert");
const {
  parseSitemapUrlsFromRobotsTxt,
  parseSitemapEntries,
  selectExpediaJobCandidates,
  parseExpediaJobPostingFromHtml,
  isExpediaJobUrl
} = require("../ats/expedia/service.js");

function buildJsonLdPage(jobPosting, { wrapper = "object" } = {}) {
  let payload = jobPosting;
  if (wrapper === "array") payload = [{ "@type": "WebSite", name: "Expedia Group Careers" }, jobPosting];
  if (wrapper === "graph") payload = { "@context": "https://schema.org", "@graph": [jobPosting] };
  return `
<!doctype html>
<html><head>
<script type="application/ld+json">${JSON.stringify(payload)}</script>
</head><body></body></html>`;
}

function run() {
  // --- robots.txt discovery -------------------------------------------------
  const robots = [
    "User-agent: *",
    "Disallow: /apply/",
    "Sitemap: https://careers.expediagroup.com/sitemap.xml",
    "sitemap: /sitemap-jobs.xml",
    "Sitemap: https://www.expedia.com/sitemap.xml"
  ].join("\n");
  assert.deepEqual(
    parseSitemapUrlsFromRobotsTxt(robots),
    ["https://careers.expediagroup.com/sitemap.xml", "https://careers.expediagroup.com/sitemap-jobs.xml"],
    "relative sitemaps resolve against the board, and off-host ones are not followed"
  );

  // --- sitemap parsing ------------------------------------------------------
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
  <url><loc>https://careers.expediagroup.com/job/sr-finance-analyst/chicago-IL/R-100047/</loc><lastmod>FRESH</lastmod></url>
  <url><loc>https://careers.expediagroup.com/job/data-engineer/seattle-WA/R-100048/</loc><lastmod>STALE</lastmod></url>
  <url><loc>https://careers.expediagroup.com/jobs/</loc><lastmod>FRESH</lastmod></url>
  <url><loc>https://careers.expediagroup.com/about-us/</loc><lastmod>FRESH</lastmod></url>
</urlset>`;
  const parsedUrlSet = parseSitemapEntries(urlSetXml);
  assert.equal(parsedUrlSet.is_index, false);
  assert.equal(parsedUrlSet.entries.length, 4);

  // --- job URL classification ----------------------------------------------
  assert.equal(isExpediaJobUrl("https://careers.expediagroup.com/job/data-engineer/seattle-WA/R-100048/"), true);
  assert.equal(isExpediaJobUrl("https://careers.expediagroup.com/jobs/"), false, "the search page is not a posting");
  assert.equal(isExpediaJobUrl("https://careers.expediagroup.com/jobs/search"), false);
  assert.equal(isExpediaJobUrl("https://careers.expediagroup.com/about-us/"), false);
  assert.equal(
    isExpediaJobUrl("https://careers.example.com/job/data-engineer/seattle-WA/R-1/"),
    false,
    "another host's job URL must not be swept as Expedia's"
  );

  // --- candidate selection --------------------------------------------------
  const referenceEpoch = Math.floor(Date.UTC(2026, 6, 27, 12, 0, 0) / 1000);
  const freshIso = new Date((referenceEpoch - 3 * 60 * 60) * 1000).toISOString();
  const staleIso = new Date((referenceEpoch - 30 * 24 * 60 * 60) * 1000).toISOString();
  const olderFreshIso = new Date((referenceEpoch - 9 * 60 * 60) * 1000).toISOString();

  const candidates = selectExpediaJobCandidates(
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
    selectExpediaJobCandidates(
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

  // --- JSON-LD parsing ------------------------------------------------------
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
      address: {
        "@type": "PostalAddress",
        addressLocality: "Chicago",
        addressRegion: "IL",
        addressCountry: "US"
      }
    },
    baseSalary: {
      "@type": "MonetaryAmount",
      currency: "USD",
      value: { "@type": "QuantitativeValue", minValue: 110000, maxValue: 150000, unitText: "YEAR" }
    }
  };

  for (const wrapper of ["object", "array", "graph"]) {
    const posting = parseExpediaJobPostingFromHtml(buildJsonLdPage(jobPosting, { wrapper }), "https://ignored/");
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

  // Hourly roles and remote listings are the other two shapes the board publishes.
  const hourlyRemote = parseExpediaJobPostingFromHtml(
    buildJsonLdPage({
      "@type": "JobPosting",
      title: "Travel Advisor",
      datePosted: "2026-07-27T08:15:00+00:00",
      jobLocationType: "TELECOMMUTE",
      baseSalary: {
        "@type": "MonetaryAmount",
        currency: "USD",
        value: { "@type": "QuantitativeValue", value: 22.5, unitText: "HOUR" }
      }
    }),
    "https://careers.expediagroup.com/job/travel-advisor/remote/R-100051/"
  );
  assert.equal(
    hourlyRemote.job_posting_url,
    "https://careers.expediagroup.com/job/travel-advisor/remote/R-100051/",
    "a posting that omits its own url falls back to the page it came from"
  );
  assert.equal(hourlyRemote.company_name, "Expedia Group", "a missing hiring organization defaults to the board owner");
  assert.equal(hourlyRemote.location, "Remote");
  assert.equal(hourlyRemote.compensation_type, "hourly");
  assert.equal(hourlyRemote.pay_min, 22.5);
  assert.equal(hourlyRemote.pay_max, 22.5);
  assert.equal(hourlyRemote.pay_period, "hour");

  // A page whose JSON-LD is broken or describes something else is not a posting, and a
  // partially-typed salary block must not invent numbers.
  assert.equal(
    parseExpediaJobPostingFromHtml(
      `<script type="application/ld+json">{ not json }</script>`,
      "https://careers.expediagroup.com/job/a/x/R-1/"
    ),
    null,
    "unparseable JSON-LD should yield no posting rather than throw"
  );
  assert.equal(
    parseExpediaJobPostingFromHtml(
      buildJsonLdPage({ "@type": "BreadcrumbList", itemListElement: [] }),
      "https://careers.expediagroup.com/job/a/x/R-1/"
    ),
    null,
    "a page with only non-JobPosting structured data is not a posting"
  );
  const noSalary = parseExpediaJobPostingFromHtml(
    buildJsonLdPage({ "@type": "JobPosting", title: "Analyst", datePosted: "2026-07-27", baseSalary: {} }),
    "https://careers.expediagroup.com/job/a/x/R-1/"
  );
  assert.equal(noSalary.compensation_type, "unknown");
  assert.equal(noSalary.pay_min, null);
  assert.equal(noSalary.pay_max, null);
  assert.equal(noSalary.pay_raw, null);

  console.log("expedia-parser tests passed");
}

run();
