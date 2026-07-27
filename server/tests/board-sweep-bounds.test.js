// Each employer board is swept from a single target, so the thing that keeps a sync
// affordable is not the parser but where the sweep stops. Amazon pages newest-first and
// must stop at the first page with nothing in the freshness window; the shared career-site
// engine must reach exactly one detail page per fresh sitemap entry and never fetch a stale
// or non-job URL. Expedia stands in for every employer on that engine, since they differ
// only by config -- except for the one thing config can change about the sweep's shape,
// which is where it looks for the sitemap, so Microsoft covers that. All of it runs against
// a stubbed fetch, since the real boards are not reachable from a test run.
const assert = require("assert");
const { collectPostingsForAmazonDynamic } = require("../ats/amazon/service.js");
const { collectPostingsForCareerSiteDynamic } = require("../ats/careersite/service.js");

function jsonResponse(body) {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
}

function textResponse(body) {
  return { ok: true, status: 200, text: async () => body, json: async () => JSON.parse(body) };
}

async function withStubbedFetch(handler, run) {
  const requested = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, init) => {
    requested.push(String(url));
    return handler(String(url), init);
  };
  try {
    return { result: await run(), requested };
  } finally {
    global.fetch = originalFetch;
  }
}

async function testAmazonStopsAtTheFirstStalePage() {
  const todayLabel = new Date().toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC"
  });

  const { result, requested } = await withStubbedFetch(
    (url) => {
      const offset = Number(new URL(url).searchParams.get("offset"));
      if (offset === 0) {
        return jsonResponse({
          hits: 30000,
          jobs: [
            {
              job_path: "/en/jobs/1/fresh",
              title: "Fresh Role",
              company_name: "Amazon Web Services, Inc.",
              posted_date: todayLabel,
              city: "Seattle",
              state: "Washington",
              country_code: "US"
            }
          ]
        });
      }
      return jsonResponse({
        hits: 30000,
        jobs: [{ job_path: "/en/jobs/2/old", title: "Old Role", posted_date: "January 3, 2024" }]
      });
    },
    () => collectPostingsForAmazonDynamic()
  );

  assert.equal(result.length, 1, "only the posting inside the freshness window should be stored");
  assert.equal(result[0].job_posting_url, "https://www.amazon.jobs/en/jobs/1/fresh");
  assert.equal(
    requested.length,
    2,
    "the sweep should stop on the first page with nothing fresh rather than page the whole board"
  );
  assert.ok(
    requested.every((url) => new URL(url).searchParams.get("sort") === "recent"),
    "every page must be requested newest-first, which is what makes the early stop sound"
  );
}

// Microsoft's board allows crawling in robots.txt but advertises no sitemap there, and has
// nothing at /sitemap.xml either -- the conventional guess answers 404. Its sitemap_paths
// entry is what bridges that, and getting it wrong is silent: the sweep would ask for a
// path that does not exist and report the resulting zero as a quiet day. So what is pinned
// is that the configured path is the one actually requested, and that the guess it replaces
// is never asked for.
async function testMicrosoftReadsItsConfiguredSitemapPath() {
  const today = new Date().toISOString().slice(0, 10);
  const jobUrl =
    "https://apply.careers.microsoft.com/careers/job/1970393556913009-support-escalation-manager?domain=microsoft.com";

  const { result, requested } = await withStubbedFetch(
    (url) => {
      const { pathname } = new URL(url);
      if (pathname === "/robots.txt") {
        // The real file: it allows the board and names no sitemap at all.
        return textResponse("User-agent: *\nDisallow: /\nAllow: /careers\nAllow: /api/apply\n");
      }
      if (pathname === "/careers/sitemap.xml") {
        return textResponse(
          `<?xml version="1.0" encoding="UTF-8"?>
           <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
             <url><loc>${jobUrl}</loc><lastmod>${today}T13:04:12Z</lastmod></url>
           </urlset>`
        );
      }
      return textResponse(
        `<!doctype html><html><head><script type="application/ld+json">${JSON.stringify({
          "@type": "JobPosting",
          title: "Support Escalation Manager",
          datePosted: `${today}T13:04:12`,
          url: jobUrl.replace("https://", "http://"),
          hiringOrganization: { "@type": "Organization", name: "Microsoft" },
          jobLocation: { "@type": "Place", address: { "@type": "PostalAddress", addressLocality: "Canberra" } }
        })}</script></head><body></body></html>`
      );
    },
    () => collectPostingsForCareerSiteDynamic("microsoft")
  );

  assert.ok(
    requested.includes("https://apply.careers.microsoft.com/careers/sitemap.xml"),
    "the configured sitemap path is the one the sweep must ask for"
  );
  assert.ok(
    !requested.includes("https://apply.careers.microsoft.com/sitemap.xml"),
    "sitemap_paths replaces the /sitemap.xml guess rather than being tried after it"
  );
  assert.equal(result.length, 1, "the fresh job named by the configured sitemap should be stored");
  assert.equal(
    result[0].job_posting_url,
    jobUrl,
    "the board only answers on https, so an http canonical must be stored as https"
  );
}

async function testExpediaFetchesOnlyFreshJobPages() {
  const nowIso = new Date().toISOString();
  const today = nowIso.slice(0, 10);

  const { result, requested } = await withStubbedFetch(
    (url) => {
      if (url.endsWith("/robots.txt")) {
        return textResponse("User-agent: *\nSitemap: https://careers.expediagroup.com/sitemap-index.xml\n");
      }
      if (url.includes("sitemap-index.xml")) {
        return textResponse(
          `<sitemapindex>
            <sitemap><loc>https://careers.expediagroup.com/sitemap-jobs.xml</loc><lastmod>${today}</lastmod></sitemap>
            <sitemap><loc>https://careers.expediagroup.com/sitemap-marketing.xml</loc></sitemap>
          </sitemapindex>`
        );
      }
      if (url.includes("sitemap-jobs.xml")) {
        return textResponse(
          `<urlset>
            <url><loc>https://careers.expediagroup.com/job/analyst/chicago-IL/R-1/</loc><lastmod>${nowIso}</lastmod></url>
            <url><loc>https://careers.expediagroup.com/job/stale/seattle-WA/R-2/</loc><lastmod>2024-01-01T00:00:00Z</lastmod></url>
            <url><loc>https://careers.expediagroup.com/jobs/</loc><lastmod>${nowIso}</lastmod></url>
          </urlset>`
        );
      }
      if (url.includes("/job/analyst/")) {
        const jobPosting = {
          "@type": "JobPosting",
          title: "Analyst",
          datePosted: nowIso,
          hiringOrganization: { name: "Expedia Group" },
          jobLocation: { address: { addressLocality: "Chicago", addressRegion: "IL", addressCountry: "US" } },
          description: "<p>Do analysis.</p>",
          baseSalary: {
            "@type": "MonetaryAmount",
            currency: "USD",
            value: { minValue: 90000, maxValue: 120000, unitText: "YEAR" }
          }
        };
        return textResponse(
          `<html><head><script type="application/ld+json">${JSON.stringify(jobPosting)}</script></head></html>`
        );
      }
      throw new Error(`unexpected fetch: ${url}`);
    },
    () => collectPostingsForCareerSiteDynamic("expedia")
  );

  assert.equal(result.length, 1, "only the fresh posting should be stored");
  assert.equal(result[0].job_posting_url, "https://careers.expediagroup.com/job/analyst/chicago-IL/R-1/");
  assert.equal(result[0].company_name, "Expedia Group");
  assert.equal(result[0].pay_min, 90000);

  assert.deepEqual(
    requested,
    [
      "https://careers.expediagroup.com/robots.txt",
      "https://careers.expediagroup.com/sitemap-index.xml",
      "https://careers.expediagroup.com/sitemap-jobs.xml",
      "https://careers.expediagroup.com/job/analyst/chicago-IL/R-1/"
    ],
    "the sweep should follow robots -> job sitemap -> the one fresh detail page, skipping the marketing sitemap, the stale job and the search page"
  );
}

// robots.txt is a convenience, not a dependency: a board that blocks or drops it must still
// be swept through the conventional sitemap location.
async function testExpediaFallsBackWhenRobotsIsUnavailable() {
  const { requested } = await withStubbedFetch(
    (url) => {
      if (url.endsWith("/robots.txt")) {
        return { ok: false, status: 403, text: async () => "Forbidden" };
      }
      if (url.endsWith("/sitemap.xml")) return textResponse("<urlset></urlset>");
      throw new Error(`unexpected fetch: ${url}`);
    },
    () => collectPostingsForCareerSiteDynamic("expedia")
  );

  assert.deepEqual(requested, [
    "https://careers.expediagroup.com/robots.txt",
    "https://careers.expediagroup.com/sitemap.xml"
  ]);
}

// A sweep that could not read anything must fail loudly. Reporting an unreachable site as a
// clean zero makes a blocked host, a moved sitemap or a dead board look exactly like a quiet
// hiring day -- which is what a live run against a blocked network actually produced before
// this behaviour existed.
async function testCareerSiteReportsAnUnreadableSite() {
  await assert.rejects(
    withStubbedFetch(
      () => ({ ok: false, status: 403, text: async () => "Host not in allowlist" }),
      () => collectPostingsForCareerSiteDynamic("expedia")
    ),
    /403/,
    "a site whose sitemaps cannot be fetched should surface the failure, not an empty list"
  );

  const nowIso = new Date().toISOString();
  await assert.rejects(
    withStubbedFetch(
      (url) => {
        if (url.endsWith("/robots.txt")) return textResponse("");
        if (url.endsWith("/sitemap.xml")) {
          return textResponse(
            `<urlset><url><loc>https://careers.expediagroup.com/job/a/x/R-1/</loc><lastmod>${nowIso}</lastmod></url></urlset>`
          );
        }
        return { ok: false, status: 500, text: async () => "boom" };
      },
      () => collectPostingsForCareerSiteDynamic("expedia")
    ),
    /500/,
    "fresh candidates that all fail to load should surface the failure too"
  );

  // The honest zero still has to stay a zero: a readable sitemap with nothing fresh in it
  // is a quiet day, not a fault.
  const { result } = await withStubbedFetch(
    (url) => {
      if (url.endsWith("/robots.txt")) return textResponse("");
      if (url.endsWith("/sitemap.xml")) {
        return textResponse(
          `<urlset><url><loc>https://careers.expediagroup.com/job/a/x/R-1/</loc><lastmod>2024-01-01T00:00:00Z</lastmod></url></urlset>`
        );
      }
      throw new Error(`unexpected fetch: ${url}`);
    },
    () => collectPostingsForCareerSiteDynamic("expedia")
  );
  assert.deepEqual(result, [], "a readable board with nothing fresh is a clean zero");
}

// A sweep must stay on the one host it was configured for. An operator allowlisting an
// employer's careers host should not find the collector reaching a CDN or a partner domain
// named by that site's own sitemap index.
async function testCareerSiteStaysOnItsOwnHost() {
  const nowIso = new Date().toISOString();
  const { requested } = await withStubbedFetch(
    (url) => {
      if (url.endsWith("/robots.txt")) {
        return textResponse("Sitemap: https://careers.expediagroup.com/sitemap-index.xml\n");
      }
      if (url.includes("sitemap-index.xml")) {
        return textResponse(
          `<sitemapindex>
            <sitemap><loc>https://cdn.othervendor.net/sitemap-jobs.xml</loc><lastmod>${nowIso}</lastmod></sitemap>
            <sitemap><loc>https://careers.expediagroup.com/sitemap-jobs.xml</loc><lastmod>${nowIso}</lastmod></sitemap>
          </sitemapindex>`
        );
      }
      if (url.includes("careers.expediagroup.com/sitemap-jobs.xml")) {
        return textResponse("<urlset></urlset>");
      }
      throw new Error(`unexpected fetch: ${url}`);
    },
    () => collectPostingsForCareerSiteDynamic("expedia")
  );

  assert.ok(
    requested.every((url) => new URL(url).host === "careers.expediagroup.com"),
    `every request must stay on the configured host, got ${requested.join(", ")}`
  );
}

async function run() {
  await testAmazonStopsAtTheFirstStalePage();
  await testMicrosoftReadsItsConfiguredSitemapPath();
  await testExpediaFetchesOnlyFreshJobPages();
  await testExpediaFallsBackWhenRobotsIsUnavailable();
  await testCareerSiteReportsAnUnreadableSite();
  await testCareerSiteStaysOnItsOwnHost();
  console.log("board-sweep-bounds tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
