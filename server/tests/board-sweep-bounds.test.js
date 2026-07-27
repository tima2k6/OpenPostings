// Amazon, Expedia Group and Microsoft are swept from a single target each, so the thing
// that keeps a sync affordable is not the parser but where the sweep stops. Amazon and
// Microsoft page newest-first and must stop at the first page with nothing in the
// freshness window; Expedia must reach exactly one detail page per fresh sitemap entry and
// never fetch a stale or non-job URL. All three are checked here against a stubbed fetch,
// since the real boards are not reachable from a test run.
const assert = require("assert");
const { collectPostingsForAmazonDynamic } = require("../ats/amazon/service.js");
const { collectPostingsForExpediaDynamic } = require("../ats/expedia/service.js");
const { collectPostingsForMicrosoftDynamic } = require("../ats/microsoft/service.js");

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

async function testMicrosoftStopsAtTheFirstStalePage() {
  const nowIso = new Date().toISOString();

  const { result, requested } = await withStubbedFetch(
    (url) => {
      const pageNo = Number(new URL(url).searchParams.get("pg"));
      const job = pageNo === 1
        ? { jobId: "1858732", title: "Fresh Role", postingDate: nowIso, properties: { primaryLocation: "Redmond, Washington, United States" } }
        : { jobId: "1000001", title: "Old Role", postingDate: "2024-01-03T00:00:00+00:00", properties: {} };
      return jsonResponse({ operationResult: { result: { totalJobs: 5000, jobs: [job] } } });
    },
    () => collectPostingsForMicrosoftDynamic()
  );

  assert.equal(result.length, 1, "only the posting inside the freshness window should be stored");
  assert.equal(
    result[0].job_posting_url,
    "https://jobs.careers.microsoft.com/global/en/job/1858732/Fresh-Role"
  );
  assert.equal(
    requested.length,
    2,
    "the sweep should stop on the first page with nothing fresh rather than page the whole board"
  );
  assert.ok(
    requested.every((url) => new URL(url).searchParams.get("o") === "Recent"),
    "every page must be requested newest-first, which is what makes the early stop sound"
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
    () => collectPostingsForExpediaDynamic()
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
    () => collectPostingsForExpediaDynamic()
  );

  assert.deepEqual(requested, [
    "https://careers.expediagroup.com/robots.txt",
    "https://careers.expediagroup.com/sitemap.xml"
  ]);
}

async function run() {
  await testAmazonStopsAtTheFirstStalePage();
  await testMicrosoftStopsAtTheFirstStalePage();
  await testExpediaFetchesOnlyFreshJobPages();
  await testExpediaFallsBackWhenRobotsIsUnavailable();
  console.log("board-sweep-bounds tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
