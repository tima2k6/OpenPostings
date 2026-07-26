// Hcareers is a board rather than a per-company ATS, so a single card carries the
// employer name, and the only posting date is a relative age string. Both have to
// survive parsing for the posting to be attributed and aged correctly.
const assert = require("assert");
const { parseHcareersPostingsFromHtml } = require("../ats/hcareers/service.js");
const { parsePostingDateToEpochSeconds } = require("../helpers/normalize-numbers.js");

function buildCard({ href, title, employer, location, managedBy, compensation, age }) {
  return `
<div class="card job-card mb-3 shadow-sm border-0 pt-4 pt-md-0">
  <div class="row g-0">
    <div class="col-12 col-md">
      <div class="job-name fw-bold h5 mb-1">
        <a class="text-dark text-decoration-none stretched-link" href="${href}">${title}</a>
      </div>
      <div class="employer-info text-muted small">
        ${employer}<br>
        ${location}
      </div>
      ${managedBy ? `<div class="managed-by text-muted small fst-italic mt-1">A property of: <strong>${managedBy}</strong></div>` : ""}
    </div>
    <div class="col-12 col-md-auto">
      ${compensation ? `<div class="compensation-value fw-semibold text-success mb-1">${compensation}</div>` : ""}
      <small class="text-muted mt-1">
        ${age}
      </small>
    </div>
  </div>
</div>`;
}

function run() {
  const html = [
    buildCard({
      href: "/jobs/4349955-general-manager",
      title: "General Manager",
      employer: "Courtyard by Marriott Dallas Downtown &amp; Reunion District",
      location: "Dallas, TX",
      managedBy: "Aimbridge Hospitality",
      compensation: "$75,000 to $90,000 per year plus bonus",
      age: "5 minutes ago"
    }),
    buildCard({
      href: "/jobs/4318638-housekeeping-supervisor",
      title: "Housekeeping Supervisor",
      employer: "Hampton Inn &amp; Suites Franklin Berry Farms",
      location: "Franklin, TN",
      managedBy: "",
      compensation: "$28.00 per hour",
      age: "about 16 hours ago"
    }),
    buildCard({
      href: "/jobs/4200001-night-auditor",
      title: "Night Auditor",
      employer: "The Grand Hotel",
      location: "Chicago, IL",
      managedBy: "",
      compensation: "",
      age: "less than a minute ago"
    }),
    buildCard({
      href: "/jobs/4100002-line-cook",
      title: "Line Cook",
      employer: "Seaside Resort",
      location: "Miami, FL",
      managedBy: "",
      compensation: "",
      age: "2 days ago"
    })
  ].join("\n");

  const postings = parseHcareersPostingsFromHtml(html);
  assert.equal(postings.length, 4, "every job card should yield a posting");

  const [manager, housekeeping, auditor, cook] = postings;

  // The employer on the card wins over the management company, so postings are
  // attributed to the property a candidate would actually work at.
  assert.equal(manager.company_name, "Courtyard by Marriott Dallas Downtown & Reunion District");
  assert.equal(manager.position_name, "General Manager");
  assert.equal(manager.job_posting_url, "https://www.hcareers.com/jobs/4349955-general-manager");
  assert.equal(manager.location, "Dallas, TX");
  assert.equal(manager.pay_raw, "$75,000 to $90,000 per year plus bonus");
  assert.equal(manager.compensation_type, "salary");

  assert.equal(housekeeping.company_name, "Hampton Inn & Suites Franklin Berry Farms");
  assert.equal(housekeeping.compensation_type, "hourly");
  assert.equal(auditor.pay_raw, null);
  assert.equal(auditor.compensation_type, null);

  // Relative ages must land in a form the shared freshness parser can read, or the
  // posting is silently dropped as undateable.
  const referenceEpoch = 1_700_000_000;
  const ages = [manager, housekeeping, auditor, cook].map((posting) =>
    parsePostingDateToEpochSeconds(posting.posting_date, referenceEpoch)
  );
  for (const parsed of ages) {
    assert.ok(Number.isFinite(parsed) && parsed > 0, "every card age should parse to an epoch");
  }
  assert.equal(ages[0], referenceEpoch - 5 * 60);
  assert.equal(ages[1], referenceEpoch - 16 * 60 * 60);
  assert.equal(ages[2], referenceEpoch);
  assert.equal(ages[3], referenceEpoch - 2 * 24 * 60 * 60);

  console.log("hcareers-parser tests passed");
}

run();
