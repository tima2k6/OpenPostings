// api.snaphunt.com stopped resolving, so this collector has no live source to run against and its
// failure is a DNS error rather than a parse error. Two things are worth pinning: that the failure
// is reported as a retired source instead of a bare "fetch failed", and that the payload parser
// still behaves, so the collector can be re-pointed if a public feed reappears.
const assert = require("assert");
const {
  parseSnaphuntPostingsFromPayload,
  describeSnaphuntFetchFailure
} = require("../ats/snaphunt/service.js");

function buildPayload(list, meta = {}) {
  return { body: { list, meta } };
}

function run() {
  const postings = parseSnaphuntPostingsFromPayload(
    buildPayload([
      {
        jobReferenceId: "ABC123",
        jobTitle: "Senior Backend Engineer",
        company: { companyName: "Northwind Labs", subdomain: "northwind" },
        updatedAt: "2026-07-27T09:15:00.000Z",
        jobLocationType: "onsite",
        location: [{ city: "Singapore", country: "Singapore" }],
        minSalary: 8000,
        maxSalary: 12000,
        currency: "SGD",
        showSalary: true,
        jobDescription: "<p>Build &amp; run services.</p>"
      },
      {
        jobReferenceId: "DEF456",
        jobTitle: "Product Designer",
        company: { subdomain: "acme-co" },
        updatedAt: "2026-07-26T09:15:00.000Z",
        jobLocationType: "remote",
        remoteLocation: { region: "Southeast Asia" },
        minSalary: 0,
        maxSalary: 0,
        showSalary: true
      },
      {
        jobReferenceId: "GHI789",
        jobTitle: "Hybrid Analyst",
        company: { companyName: "Cobalt Group", subdomain: "cobalt" },
        jobLocationType: "hybrid",
        location: [{ name: "Kuala Lumpur" }],
        minSalary: 5000,
        maxSalary: 5000,
        currency: "MYR",
        showSalary: false
      },
      // Duplicate of the first row, and a row with no subdomain to build a URL from: both dropped.
      { jobReferenceId: "ABC123", jobTitle: "Duplicate", company: { subdomain: "northwind" } },
      { jobReferenceId: "NOSUB", jobTitle: "Unroutable", company: {} }
    ])
  );

  assert.equal(postings.length, 3, "duplicate and URL-less rows should be dropped");

  const [engineer, designer, analyst] = postings;

  assert.equal(engineer.job_posting_url, "https://northwind.snaphunt.com/job/ABC123");
  assert.equal(engineer.company_name, "Northwind Labs");
  assert.equal(engineer.location, "Singapore, Singapore");
  assert.equal(engineer.posting_date, "2026-07-27T09:15:00.000Z");
  assert.equal(engineer.pay_min, 8000);
  assert.equal(engineer.pay_max, 12000);
  assert.equal(engineer.pay_raw, "SGD 8000 - 12000");
  assert.equal(engineer.job_description, "Build & run services.", "HTML and entities are stripped");

  // No companyName: fall back to the subdomain rather than losing the employer.
  assert.equal(designer.company_name, "acme-co");
  assert.equal(designer.location, "Remote - Southeast Asia");
  // Zero salaries are not a real range, so no pay is claimed.
  assert.equal(designer.pay_min, null);
  assert.equal(designer.pay_raw, null);

  assert.equal(analyst.location, "Hybrid - Kuala Lumpur");
  assert.equal(analyst.pay_min, 5000);
  assert.equal(analyst.pay_raw, null, "showSalary false must suppress the displayed pay");
  assert.equal(analyst.posting_date, null);

  assert.deepEqual(parseSnaphuntPostingsFromPayload({}), []);
  assert.deepEqual(parseSnaphuntPostingsFromPayload(buildPayload([])), []);

  // A dead host must be described as such; anything else is passed through untouched so real
  // HTTP failures keep their original message.
  const dnsError = Object.assign(new Error("fetch failed"), { cause: { code: "ENOTFOUND" } });
  const described = describeSnaphuntFetchFailure(dnsError);
  assert.match(described.message, /api\.snaphunt\.com does not resolve \(ENOTFOUND\)/);
  assert.match(described.message, /retired/);

  const httpError = new Error("Snaphunt request failed (500): boom");
  assert.equal(describeSnaphuntFetchFailure(httpError), httpError);

  console.log("snaphunt-parser tests passed");
}

run();
