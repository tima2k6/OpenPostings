// amazon.jobs is one board for every Amazon operating company, so the row -- not the
// target -- decides which employer a posting is attributed to. The two fields that decide
// whether a posting is usable at all are the detail path (the primary key of the row) and
// the posted date, and both have moved between payload revisions, so the parser reads them
// through fallbacks that need to stay honest.
const assert = require("assert");
const {
  parseAmazonPostingsFromPayload,
  buildAmazonJobPostingUrl
} = require("../ats/amazon/service.js");
const { parsePostingDateToEpochSeconds, nowEpochSeconds } = require("../helpers/normalize-numbers.js");

function run() {
  const payload = {
    error: null,
    hits: 2,
    jobs: [
      {
        id: "jobs/2847362",
        id_icims: "2847362",
        job_path: "/en/jobs/2847362/software-development-engineer",
        title: "Software Development Engineer",
        company_name: "Amazon Web Services, Inc.",
        posted_date: "July 26, 2026",
        updated_time: "2 days ago",
        normalized_location: "Seattle, Washington, USA",
        city: "Seattle",
        state: "Washington",
        country_code: "US",
        description_short: "Build distributed systems at scale.",
        basic_qualifications: "3+ years of professional software development experience.",
        preferred_qualifications: "Experience with Rust."
      },
      {
        // A row that predates job_path still identifies itself through id/id_icims.
        id: "jobs/1900001",
        id_icims: "1900001",
        title: "Fulfillment Associate",
        company_name: "Amazon.com Services LLC",
        updated_time: "3 hours ago",
        city: "Columbus",
        state: "Ohio",
        country_code: "US"
      }
    ]
  };

  const postings = parseAmazonPostingsFromPayload(payload);
  assert.equal(postings.length, 2, "both rows should survive parsing");

  const [engineering, fulfillment] = postings;

  assert.equal(
    engineering.job_posting_url,
    "https://www.amazon.jobs/en/jobs/2847362/software-development-engineer",
    "job_path should resolve against the board origin"
  );
  assert.equal(
    engineering.company_name,
    "Amazon Web Services, Inc.",
    "the row's own entity must win over the board name"
  );
  assert.equal(engineering.position_name, "Software Development Engineer");
  assert.equal(engineering.location, "Seattle, Washington, USA");
  assert.equal(
    engineering.posting_date,
    "July 26, 2026",
    "the absolute posted date must win over the relative updated_time"
  );
  assert.ok(
    engineering.job_description.includes("Build distributed systems at scale.") &&
      engineering.job_description.includes("3+ years") &&
      engineering.job_description.includes("Experience with Rust."),
    "the description should carry the qualifications the board splits into their own fields"
  );

  assert.equal(
    fulfillment.job_posting_url,
    "https://www.amazon.jobs/en/jobs/1900001",
    "a row without job_path should still resolve through its id"
  );
  assert.equal(
    fulfillment.location,
    "Columbus, Ohio, US",
    "the city/state/country parts should compose a location when the board omits the normalized one"
  );
  assert.equal(
    fulfillment.posting_date,
    "3 hours ago",
    "updated_time is the fallback when no posted date exists"
  );

  // The stored date has to age correctly, otherwise the 24h retention pass either keeps
  // stale rows or drops fresh ones.
  const referenceEpoch = Math.floor(Date.UTC(2026, 6, 27, 12, 0, 0) / 1000);
  assert.equal(
    parsePostingDateToEpochSeconds("July 26, 2026", referenceEpoch),
    Math.floor(Date.UTC(2026, 6, 26, 0, 0, 0) / 1000),
    "an absolute posted date should parse to that day"
  );
  const relativeEpoch = parsePostingDateToEpochSeconds("3 hours ago", nowEpochSeconds());
  assert.ok(
    Number.isFinite(relativeEpoch) && relativeEpoch > 0,
    "the relative fallback must remain a shape the shared date parser understands"
  );

  // A row that names no detail page cannot be applied to and must not be stored under a
  // URL guessed from something else.
  assert.equal(buildAmazonJobPostingUrl({ title: "Ghost Role" }), "");
  assert.deepEqual(
    parseAmazonPostingsFromPayload({ jobs: [{ title: "Ghost Role" }] }),
    [],
    "a row with no identifier should be dropped rather than stored under a made-up URL"
  );

  assert.deepEqual(parseAmazonPostingsFromPayload(null), []);
  assert.deepEqual(parseAmazonPostingsFromPayload({}), []);
  assert.deepEqual(
    parseAmazonPostingsFromPayload({ jobs: [{ job_path: "/en/jobs/1/a" }, { job_path: "/en/jobs/1/a" }] }).length,
    1,
    "a repeated detail path is the same posting and should only be kept once"
  );

  console.log("amazon-parser tests passed");
}

run();
