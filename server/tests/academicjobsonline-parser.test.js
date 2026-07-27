// AcademicJobsOnline groups jobs under an employer block per department, and the blocks
// are only delimited by what follows them. The last block on a listing page is followed
// by the "(N positions listed)" summary and an <hr class="clr"> rather than another
// block, so the fixture ends the way the real page does to keep that terminator covered.
const assert = require("assert");
const { parseAcademicJobsOnlinePostingsFromHtml } = require("../ats/academicjobsonline/service.js");

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

function run() {
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

  console.log("academicjobsonline-parser tests passed");
}

run();
