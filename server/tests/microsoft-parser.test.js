// The Microsoft board is a single-page app whose rows arrive wrapped in an
// operationResult envelope, and every field that matters -- the id, the location, the
// posted date -- lives one level down in `properties`. The two things worth pinning are
// that the envelope is unwrapped correctly and that a row with no id is dropped rather
// than stored under a URL guessed from its title.
const assert = require("assert");
const {
  parseMicrosoftPostingsFromPayload,
  buildMicrosoftJobPostingUrl
} = require("../ats/microsoft/service.js");
const { parsePostingDateToEpochSeconds } = require("../helpers/normalize-numbers.js");

function run() {
  const payload = {
    operationResult: {
      result: {
        totalJobs: 2,
        jobs: [
          {
            jobId: "1858732",
            title: "Senior Software Engineer",
            postingDate: "2026-07-27T00:00:00+00:00",
            properties: {
              primaryLocation: "Redmond, Washington, United States",
              locations: ["Redmond, Washington, United States", "Atlanta, Georgia, United States"],
              profession: "Engineering",
              discipline: "Software Engineering",
              employmentType: "Full-Time",
              workSiteFlexibility: "Up to 50% work from home",
              description: "Build the next generation of Azure networking."
            }
          },
          {
            jobId: "1858999",
            title: "Support Engineer II",
            postingDate: "2026-07-26T00:00:00+00:00",
            properties: {
              // No primaryLocation: the list is the only statement of where the role sits.
              locations: ["Dublin, Dublin, Ireland"]
            }
          }
        ]
      }
    }
  };

  const postings = parseMicrosoftPostingsFromPayload(payload);
  assert.equal(postings.length, 2, "both rows should survive the envelope");

  const [engineer, support] = postings;

  assert.equal(
    engineer.job_posting_url,
    "https://jobs.careers.microsoft.com/global/en/job/1858732/Senior-Software-Engineer",
    "the stored URL should match the board's own share link"
  );
  assert.equal(engineer.company_name, "Microsoft");
  assert.equal(engineer.position_name, "Senior Software Engineer");
  assert.equal(engineer.location, "Redmond, Washington, United States");
  assert.equal(engineer.posting_date, "2026-07-27T00:00:00+00:00");
  assert.ok(
    engineer.job_description.includes("Build the next generation of Azure networking.") &&
      engineer.job_description.includes("Work site flexibility: Up to 50% work from home"),
    "the remote-work statement should ride along with the description, since it is the only one the board gives"
  );

  assert.equal(
    support.location,
    "Dublin, Dublin, Ireland",
    "the locations list should be read when no primary location is named"
  );
  assert.equal(support.job_description, null, "a row with no description should store none");

  // The envelope has moved before; a bare jobs array must still parse.
  assert.equal(
    parseMicrosoftPostingsFromPayload({ jobs: [{ jobId: "42", title: "Analyst" }] }).length,
    1,
    "an unwrapped payload should still yield its rows"
  );

  // A row with no id has no detail page, so there is nothing to store or apply to.
  assert.equal(buildMicrosoftJobPostingUrl("", "Ghost Role"), "");
  assert.deepEqual(
    parseMicrosoftPostingsFromPayload({ jobs: [{ title: "Ghost Role" }] }),
    [],
    "a row without a job id should be dropped rather than stored under a made-up URL"
  );
  assert.equal(
    buildMicrosoftJobPostingUrl("42", "  "),
    "https://jobs.careers.microsoft.com/global/en/job/42",
    "an untitled row should still resolve through the id-only form"
  );
  assert.equal(
    buildMicrosoftJobPostingUrl("42", "Principal PM: Copilot (AI/ML)"),
    "https://jobs.careers.microsoft.com/global/en/job/42/Principal-PM-Copilot-AI-ML",
    "punctuation in a title should collapse into single separators, not leak into the URL"
  );

  assert.deepEqual(parseMicrosoftPostingsFromPayload(null), []);
  assert.deepEqual(parseMicrosoftPostingsFromPayload({}), []);
  assert.equal(
    parseMicrosoftPostingsFromPayload({ jobs: [{ jobId: "7", title: "A" }, { jobId: "7", title: "A" }] }).length,
    1,
    "a repeated job id is the same posting and should only be kept once"
  );

  // The stored date has to age correctly or the retention pass mishandles the row.
  const referenceEpoch = Math.floor(Date.UTC(2026, 6, 27, 12, 0, 0) / 1000);
  assert.equal(
    parsePostingDateToEpochSeconds("2026-07-27T00:00:00+00:00", referenceEpoch),
    Math.floor(Date.UTC(2026, 6, 27, 0, 0, 0) / 1000),
    "the board's ISO posting date must remain a shape the shared date parser understands"
  );

  console.log("microsoft-parser tests passed");
}

run();
