// On 2026-08-20 the API stopped responding: one core pegged at 100%, no disk I/O, 206MB RSS,
// and 16 connections stacked in the accept backlog. A stack pulled from the running process
// put it in pushRows, inside parseJobvitePostingsFromHtml, collecting
// jobs.jobvite.com/fieldcore-review -- 91KB of HTML it had been chewing on for 15 minutes.
//
// Two faults, and it took both:
//
// 1. Jobvite changed its markup. The location used to be its own cell, a sibling of the name
//    cell; it is now a <div class="jv-job-list-location"> nested inside the name cell's
//    anchor, next to a <div class="title">. The parser matched only the <td> form, so the
//    current layout yielded no rows at all.
//
// 2. Yielding no rows was not a quiet failure. It dropped the page into the whole-document
//    fallback, where the old row pattern -- six `[\s\S]*?` runs chained across a single
//    <tr>...</tr> -- had to try every way of splitting 91KB between those runs before it
//    could conclude it did not match. Catastrophic backtracking: not slow, effectively
//    non-terminating, and inside one exec() call, so no loop guard could have interrupted it.
//    It ran on the sync's turn of the event loop, so it took the whole API down.
//
// The fixture is the real page, trimmed to 24 rows. These tests cover both faults: that the
// nested layout parses at all (which is what keeps the fallback unreachable), that the older
// sibling-cell layout still parses, and that the parser stays linear on an input large enough
// that the old pattern provably could not finish.
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const { parseJobvitePostingsFromHtml } = require("../ats/jobvite/service.js");

const FIXTURE = fs.readFileSync(path.join(__dirname, "fixtures", "jobvite-nested-location.html"), "utf8");
const CONFIG = { baseOrigin: "https://jobs.jobvite.com", companySlug: "fieldcore-review" };

// The current layout: title and location are both divs inside the name cell's anchor. Taking
// the anchor's whole text would run them together ("Buyer Remote, Mexico"), so this pins that
// the title div wins and the location lands in its own field.
function testNestedLayoutIsParsed() {
  const postings = parseJobvitePostingsFromHtml("fieldcore-review", CONFIG, FIXTURE);
  assert.ok(postings.length >= 20, `expected the nested layout to yield rows, got ${postings.length}`);

  const buyer = postings.find((posting) => posting.position_name === "Buyer");
  assert.ok(buyer, "the title should come from the title div, not the anchor's full text");
  assert.strictEqual(buyer.location, "Remote, Mexico", "the nested location div should populate location");
  assert.ok(
    buyer.job_posting_url.startsWith("https://jobs.jobvite.com/fieldcore-review/job/"),
    `relative hrefs should resolve against the origin, got ${buyer.job_posting_url}`
  );
  for (const posting of postings) {
    assert.ok(
      !/\bRemote,|\bHouston,/.test(posting.position_name),
      `position_name must not carry the location: ${posting.position_name}`
    );
  }
}

// The older layout, which real companies are still served. It has to keep working -- the fix
// for the new one must not be a swap.
function testSiblingCellLayoutStillParses() {
  const html = `
    <h3>Engineering</h3>
    <table class="jv-job-list"><tbody>
      <tr>
        <td class="jv-job-list-name"><a href="/acme/job/abc123">Staff Engineer</a></td>
        <td class="jv-job-list-location">Seattle, WA</td>
      </tr>
    </tbody></table>`;
  const postings = parseJobvitePostingsFromHtml("acme", { baseOrigin: "https://jobs.jobvite.com", companySlug: "acme" }, html);
  assert.strictEqual(postings.length, 1, "the sibling-cell layout must still parse");
  assert.strictEqual(postings[0].position_name, "Staff Engineer");
  assert.strictEqual(postings[0].location, "Seattle, WA");
  assert.strictEqual(postings[0].department, "Engineering", "the h3 above the table is the department");
}

// The bound that matters. Repeating the fixture's rows to ~66KB and appending filler that
// matches no cell pattern reproduces the shape that hung production: measured directly, the
// old pattern had not returned after 20s on this input, while the current parser handles it
// in single-digit milliseconds. A generous ceiling still fails loudly if the chained-lazy
// pattern ever comes back, without being flaky on a loaded machine.
function testStaysLinearOnALargePage() {
  const rows = FIXTURE.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
  assert.ok(rows.length > 0, "fixture should contain rows");
  const html =
    `<h3>All Openings</h3>\n<table class="jv-job-list"><tbody>\n${rows.concat(rows, rows, rows).join("\n")}\n</tbody></table>\n` +
    `<div><p>${"filler text with no cell pattern at all. ".repeat(400)}</p></div>`;
  assert.ok(html.length > 60000, `large-page input should be substantial, got ${html.length}`);

  const startedAt = Date.now();
  const postings = parseJobvitePostingsFromHtml("fieldcore-review", CONFIG, html);
  const elapsed = Date.now() - startedAt;

  assert.ok(postings.length >= 20, "the large page should still yield its rows");
  assert.ok(elapsed < 5000, `parsing must stay linear; took ${elapsed}ms on ${html.length} bytes`);
}

// A page with nothing to find must return nothing, quickly, rather than falling into a scan
// whose cost depends on the size of the document.
function testUnmatchedPageReturnsEmptyFast() {
  const html = `<html><body><p>${"no job markup here at all. ".repeat(2000)}</p></body></html>`;
  const startedAt = Date.now();
  const postings = parseJobvitePostingsFromHtml("acme", CONFIG, html);
  const elapsed = Date.now() - startedAt;
  assert.strictEqual(postings.length, 0, "a page with no rows should yield none");
  assert.ok(elapsed < 5000, `an unmatched page must fail fast; took ${elapsed}ms`);
}

function main() {
  testNestedLayoutIsParsed();
  testSiblingCellLayoutStillParses();
  testStaysLinearOnALargePage();
  testUnmatchedPageReturnsEmptyFast();
  console.log("jobvite-parser tests passed");
}

if (require.main === module) {
  main();
}

module.exports = { main };
