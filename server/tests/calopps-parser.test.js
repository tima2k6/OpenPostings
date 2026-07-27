// CalOpps is a board of California public agencies, so the employer is not in the row text at
// all - it is the first segment of the job link's path. The listing is a Drupal view whose header
// row carries the same views-field-label class as the data rows, and paging is a "next" link, so
// both have to be handled or the collector either stores a header as a job or stops after page 1.
const assert = require("assert");
const {
  parseCaloppsPostingsFromHtml,
  extractCaloppsNextPageUrl
} = require("../ats/calopps/service.js");

const PAGE_URL = "https://www.calopps.org/job-search-list";

function buildHeaderRow() {
  return `
<tr>
  <th class="views-field views-field-label" >
    <a href="/job-search-list?order=label&amp;sort=asc" title="sort by Job Title" class="active">Job Title</a>
  </th>
  <th class="views-field views-field-ss-term-name-field-rec-location" ><a href="#">Region</a></th>
  <th class="views-field views-field-ss-term-name-field-rec-job-category" ><a href="#">Category</a></th>
  <th class="views-field views-field-ss-term-name-field-rec-job-type" ><a href="#">Job Type</a></th>
  <th class="views-field views-field-ss-simple-date-field-rec-close-date" ><a href="#">Close Date</a></th>
</tr>`;
}

function buildRow({ href, title, region, category, jobType, closeDate }) {
  return `
<tr>
  <td class="views-field views-field-label" >
    <a href="${href}">${title}</a>
  </td>
  <td class="views-field views-field-ss-term-name-field-rec-location" >${region}</td>
  <td class="views-field views-field-ss-term-name-field-rec-job-category" >${category}</td>
  <td class="views-field views-field-ss-term-name-field-rec-job-type" >${jobType}</td>
  <td class="views-field views-field-ss-simple-date-field-rec-close-date" >${closeDate}</td>
</tr>`;
}

function run() {
  const html = `
<table class="views-table">
  <thead>${buildHeaderRow()}</thead>
  <tbody>
    ${buildRow({
      href: "/chowchilla/job-20762626",
      title: "Code Enforcement Officer (Part-time)",
      region: "Central Valley",
      category: "Code Enforcement",
      jobType: "Part-Time",
      closeDate: "Until Filled"
    })}
    ${buildRow({
      href: "/san-luis-obispo-county/job-20758311",
      title: "Deputy Probation Officer I/II &amp; Senior",
      region: "Central Coast",
      category: "Probation",
      jobType: "Full-Time",
      closeDate: "8/14/2026"
    })}
    ${buildRow({
      href: "/chowchilla/job-20762626",
      title: "Code Enforcement Officer (duplicate link)",
      region: "Central Valley",
      category: "Code Enforcement",
      jobType: "Part-Time",
      closeDate: "Until Filled"
    })}
  </tbody>
</table>
<div class="item-list">
  <ul class="pagination">
    <li><a title="Go to page 2" href="/job-search-list?page=1">2</a></li>
    <li class="next"><a title="Go to next page" href="/job-search-list?page=1">next &rsaquo;</a></li>
    <li class="pager-last"><a title="Go to last page" href="/job-search-list?page=23">last &raquo;</a></li>
  </ul>
</div>`;

  const postings = parseCaloppsPostingsFromHtml(html, PAGE_URL);

  // The header row matches the row filter's class but has no <td> cells, and the third row
  // repeats a link already seen; both must be dropped.
  assert.equal(postings.length, 2, "header row and repeated link should not become postings");

  const [enforcement, probation] = postings;

  assert.equal(enforcement.position_name, "Code Enforcement Officer (Part-time)");
  assert.equal(enforcement.job_posting_url, "https://www.calopps.org/chowchilla/job-20762626");
  assert.equal(enforcement.id, "20762626", "posting id comes from the job-<digits> path segment");
  assert.equal(enforcement.location, "Central Valley");
  assert.equal(enforcement.category, "Code Enforcement");
  assert.equal(enforcement.work_type, "Part-Time");
  assert.equal(enforcement.close_date, "Until Filled");

  // The agency is only recoverable from the first path segment of the link.
  assert.equal(enforcement.company_name, "Chowchilla");
  assert.equal(
    probation.company_name,
    "San Luis Obispo County",
    "hyphenated agency slugs become spaced title case"
  );

  // Entities in the title cell have to be decoded, not left as raw &amp;.
  assert.equal(probation.position_name, "Deputy Probation Officer I/II & Senior");
  assert.equal(probation.close_date, "8/14/2026");

  // The board publishes no posted date, so the collector stamps collection time. That value still
  // has to be a real timestamp the shared freshness filter can read, or every row is dropped.
  const stampedEpoch = Date.parse(enforcement.posting_date);
  assert.ok(Number.isFinite(stampedEpoch), "posting_date should be a parseable timestamp");
  assert.ok(
    Math.abs(Date.now() - stampedEpoch) < 60 * 1000,
    "posting_date should be stamped at collection time"
  );

  // Paging: the "next" link must win over the numbered and "last" links next to it.
  assert.equal(
    extractCaloppsNextPageUrl(html, PAGE_URL),
    "https://www.calopps.org/job-search-list?page=1"
  );
  assert.equal(
    extractCaloppsNextPageUrl('<ul class="pagination"><li class="pager-last"><a href="/x">last</a></li></ul>', PAGE_URL),
    null,
    "the final page has no next link and must end pagination"
  );

  assert.deepEqual(parseCaloppsPostingsFromHtml("", PAGE_URL), []);

  console.log("calopps-parser tests passed");
}

run();
