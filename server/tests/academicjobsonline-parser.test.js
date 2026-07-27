// AcademicJobsOnline groups jobs under an employer block per department, and the blocks
// are only delimited by what follows them. The last block on a listing page is followed
// by the "(N positions listed)" summary and an <hr class="clr"> rather than another
// block, so the fixture ends the way the real page does to keep that terminator covered.
//
// The employer also lives in the block's <h3> rather than in the <li> holding the job, and
// collectPostingsForAcademicJobsOnlineDynamic keeps only rows that are dated and inside the
// freshness window. A heading or date regression therefore empties the collector outright
// rather than degrading it, so those paths are covered below too.
const assert = require("assert");
const { parseAcademicJobsOnlinePostingsFromHtml } = require("../ats/academicjobsonline/service.js");
const { shouldStorePostingByDate } = require("../helpers/normalize-numbers.js");

const BASE_URL = "https://academicjobsonline.org/ajo?joblst---0----0-p--";

function buildJob({ id, slug, title, posted }) {
  return `<li>[<a href="/ajo/jobs/${id}" id="k${id}" aria-labelledby="k${id} j${id}" >${slug}</a>] <span id="j${id}" aria-hidden="true">${title}</span>&nbsp;<span class="purplesml">(posted <span class="zo">${posted}</span>)</span><span ID="jn${id}"></span> <span class="sml">&nbsp; <a href="https://academicjobsonline.org/ajo/jobs/${id}/apply" >Apply</a></span></li>`;
}

function buildBlock({ employerHref, employer, departmentHref, department, jobs }) {
  const heading = department
    ? `<a href="${employerHref}">${employer}</a>, <a href="${departmentHref}">${department}</a> `
    : `<a href="${employerHref}">${employer}</a> `;
  return `<div class="clr"><div class="rht gmap" ></div><h3 class="x1">${heading}</h3><ol class="sp5 ldt">\n${jobs.map(buildJob).join("\n")}\n</ol></div>`;
}

// A listing with the optional pieces the real page carries: the "new posting" icon, and a
// posted date that may be absent entirely.
function buildListing({ id, ref, title, posted }) {
  const postedHtml = posted
    ? `&nbsp;<span class="purplesml">(posted <span class="zo">${posted}</span>)</span>`
    : "";
  return `<li><img src="https://academicjobsonline.org/icons/new.gif" class="middle" title="new posting" alt="new posting">[<a href="/ajo/jobs/${id}" id="k${id}" aria-labelledby="k${id} j${id}" >${ref}</a>] <span id="j${id}" aria-hidden="true">${title}</span>${postedHtml}<span ID="jn${id}"></span> <span class="sml">&nbsp; <a href="https://academicjobsonline.org/ajo/jobs/${id}/apply" >Apply</a></span></li>`;
}

function buildBlockWithHeading(headingHtml, listings) {
  return `<div class="clr"><div class="rht gmap" ></div><h3 class="x1">${headingHtml}</h3><ol class="sp5 ldt">\n${listings.join("\n")}\n</ol></div>`;
}

function testBlockTerminators() {
  const blocks = [
    buildBlock({
      employerHref: "/ajo/PU",
      employer: "Princeton University",
      departmentHref: "/ajo/PU/Math",
      department: "Mathematics",
      jobs: [
        { id: "30001", slug: "ASSTPROF", title: "Assistant Professor of Mathematics", posted: "2026/07/01" },
        { id: "30002", slug: "POSTDOC", title: "Postdoctoral Research Associate", posted: "2026/06/15" }
      ]
    }),
    buildBlock({
      employerHref: "/ajo/Stanford",
      employer: "Stanford University",
      departmentHref: "",
      department: "",
      jobs: [{ id: "30003", slug: "LECTURER", title: "Lecturer in Physics", posted: "2026/05/20" }]
    }),
    // The final block: nothing follows it but the page summary and the closing rule.
    buildBlock({
      employerHref: "/ajo/UMASSMED",
      employer: "University of Massachusetts Chan Medical School",
      departmentHref: "/ajo/UMASSMED/Psych",
      department: "Department of Psychiatry",
      jobs: [{ id: "30004", slug: "PSYCHIATRIST", title: "Attending Psychiatrist, Brockton", posted: "2026/04/02" }]
    })
  ];

  const html = `<main>\n${blocks.join("\n")}\n<p class="sml">(4 positions listed)</p>\n<script>if(window.name && window.name=='nW') window.name='';</script>\n<hr class="clr">\n</main>`;

  const postings = parseAcademicJobsOnlinePostingsFromHtml(html, BASE_URL);

  // The regression this guards: the last block used to need a bare <hr> or </main>
  // immediately after it, so on the real page its jobs were dropped entirely.
  assert.equal(postings.length, 4, "every employer block including the last should yield postings");

  const [firstMath, secondMath, physics, psychiatry] = postings;

  assert.equal(firstMath.company_name, "Princeton University");
  assert.equal(firstMath.position_name, "Assistant Professor of Mathematics");
  assert.equal(firstMath.job_posting_url, "https://academicjobsonline.org/ajo/jobs/30001");
  assert.equal(firstMath.location, "Mathematics");
  assert.equal(firstMath.posting_date, "2026-07-01T00:00:00.000Z");

  assert.equal(secondMath.company_name, "Princeton University");
  assert.equal(secondMath.position_name, "Postdoctoral Research Associate");

  // A block with no department anchor still attributes, just without a location.
  assert.equal(physics.company_name, "Stanford University");
  assert.equal(physics.location, null);

  assert.equal(psychiatry.company_name, "University of Massachusetts Chan Medical School");
  assert.equal(psychiatry.position_name, "Attending Psychiatrist, Brockton");
  assert.equal(psychiatry.job_posting_url, "https://academicjobsonline.org/ajo/jobs/30004");
  assert.equal(psychiatry.location, "Department of Psychiatry");
  assert.equal(psychiatry.posting_date, "2026-04-02T00:00:00.000Z");

  // The summary line must not leak into a block as an extra employer.
  assert.ok(
    postings.every((posting) => !/positions listed/i.test(posting.company_name)),
    "the (N positions listed) summary should not be parsed as an employer"
  );
}

function testHeadingsDatesAndFreshness() {
  const html = `<main>
${buildBlockWithHeading(
  '<a href="/ajo/MIT">Massachusetts Institute of Technology</a>, <a href="/ajo/MIT/MIT%20Kavli%20Institute">MIT Kavli Institute</a> ',
  [
    buildListing({
      id: "32370",
      ref: "PDA",
      title: "MKI X-Ray Detector Lab Postdoctoral Associate",
      posted: "2026/07/27"
    })
  ]
)}
${buildBlockWithHeading(
  '<a href="/ajo/Stanford%20University">Stanford University</a>, <a href="/ajo/Stanford%20University/Environmental%20Social%20Sciences">Environmental Social Sciences</a> ',
  [
    buildListing({
      id: "32368",
      ref: "ASSISTANTPROFESSOR1",
      title: "Assistant Professor in Environmental Social Sciences &amp; Policy",
      posted: "2026/07/24"
    }),
    buildListing({
      id: "32367",
      ref: "ASSISTANTPROFESSOR2",
      title: "Assistant Professor in Global Environmental Policy",
      // Some rows carry a trailing comma before an "updated" date; the date must still parse.
      posted: "2026/06/15,"
    })
  ]
)}
${buildBlockWithHeading("Riverside Institute of Technology, Department of Physics ", [
  buildListing({ id: "32001", ref: "PDRA", title: "Postdoctoral Researcher", posted: "2026/05/11" }),
  // No posted date at all - must parse but stay undateable so the collector can drop it.
  buildListing({ id: "32002", ref: "LECT", title: "Lecturer in Physics", posted: "" })
])}
</main>`;

  const postings = parseAcademicJobsOnlinePostingsFromHtml(html, BASE_URL);
  assert.equal(postings.length, 5);

  const [mit, stanfordA, stanfordB, riverside, undated] = postings;

  // The employer comes from the first heading anchor, not from the listing text.
  assert.equal(mit.company_name, "Massachusetts Institute of Technology");
  assert.equal(mit.location, "MIT Kavli Institute");
  assert.equal(mit.position_name, "MKI X-Ray Detector Lab Postdoctoral Associate");
  assert.equal(mit.job_posting_url, "https://academicjobsonline.org/ajo/jobs/32370");
  assert.equal(mit.posting_date, "2026-07-27T00:00:00.000Z");

  assert.equal(stanfordA.company_name, "Stanford University");
  assert.equal(
    stanfordA.position_name,
    "Assistant Professor in Environmental Social Sciences & Policy",
    "entities in the title must be decoded"
  );
  assert.equal(stanfordB.posting_date, "2026-06-15T00:00:00.000Z", "a trailing comma must not break the date");

  // A heading with no anchors still has to yield an employer rather than collapsing to unknown.
  assert.equal(riverside.company_name, "Riverside Institute of Technology");
  assert.equal(riverside.location, "Department of Physics");

  assert.equal(undated.posting_date, null, "a listing with no posted date must not invent one");

  // The collector keeps only rows that are both dated and inside the freshness window. Pin that
  // against a fixed reference so the assertion does not drift with the clock.
  const referenceEpoch = Math.floor(Date.parse("2026-07-27T12:00:00Z") / 1000);
  const kept = postings.filter(
    (posting) => Boolean(posting.posting_date) && shouldStorePostingByDate(posting.posting_date, referenceEpoch)
  );
  assert.deepEqual(
    kept.map((posting) => posting.job_posting_url),
    ["https://academicjobsonline.org/ajo/jobs/32370"],
    "only the same-day posting should survive the 24h window"
  );

  assert.deepEqual(parseAcademicJobsOnlinePostingsFromHtml("", BASE_URL), []);
}

function run() {
  testBlockTerminators();
  testHeadingsDatesAndFreshness();

  console.log("academicjobsonline-parser tests passed");
}

run();
