// Description extraction, prose pay parsing, hiring-restriction detection and soft-404
// classification. All pure functions here -- no network -- so the cases are the shapes
// that actually cost a real search: an iframe-wrapped ATS page whose outer body is only
// navigation, compensation stated only in prose, and a header location list the body
// contradicts.
const assert = require("assert");

const {
  extractPayFromText,
  extractHiringLocations,
  headerConflictsWithHiringLocations,
  extractContentIframeUrl,
  extractDescriptionTextFromHtml,
  extractJsonLdJobPosting,
  detectSoftNotFound,
  detectRequiresAccount
} = require("../services/posting-page-fetcher.js");
const { parsePostingLocation } = require("../helpers/parse-location.js");

function testPayFromProse() {
  const range = extractPayFromText("The expected salary range for this role is $136,000 - $200,000 per year.");
  assert.deepStrictEqual(
    { min: range.pay_min, max: range.pay_max, period: range.pay_period },
    { min: 136000, max: 200000, period: "year" }
  );

  const to = extractPayFromText("Compensation: $105,000 to $110,000 annually.");
  assert.strictEqual(to.pay_min, 105000);
  assert.strictEqual(to.pay_max, 110000);

  const hourly = extractPayFromText("Pay rate: $28.50 per hour.");
  assert.strictEqual(hourly.pay_min, 28.5);
  assert.strictEqual(hourly.pay_period, "hour");

  const kShorthand = extractPayFromText("Base salary between $95k and $120k.");
  assert.strictEqual(kShorthand.pay_min, 95000);
  assert.strictEqual(kShorthand.pay_max, 120000);

  // Numbers that are not compensation must not be read as pay. A years-of-experience
  // range is the classic false positive.
  assert.strictEqual(extractPayFromText("We require 7 to 10 years of transit operations experience."), null);
  assert.strictEqual(extractPayFromText("Shift runs 8 - 10 daily."), null);
  assert.strictEqual(extractPayFromText(""), null);
}

function testHiringRestrictions() {
  const doordash = extractHiringLocations(
    "This role is hybrid. We are hiring out of Atlanta, Charlotte, Nashville, Austin, or Houston."
  );
  const cities = doordash.map((entry) => entry.city).filter(Boolean);
  for (const city of ["Atlanta", "Charlotte", "Nashville", "Austin", "Houston"]) {
    assert.ok(cities.includes(city), `${city} must be extracted as a hiring location`);
  }

  assert.ok(extractHiringLocations("This role is based in Seattle, WA.").some((entry) => entry.city === "Seattle"));
  assert.ok(
    extractHiringLocations("Candidates must be located in Denver, CO.").some((entry) => entry.city === "Denver")
  );
  assert.deepStrictEqual(extractHiringLocations("A normal job description with no restriction."), []);
}

function testHeaderConflict() {
  const header = parsePostingLocation(
    "Dallas, TX; Austin, TX; Houston, TX; Atlanta, GA; Charlotte, NC; Nashville, TN; Denver, CO, Seattle, WA; Phoenix, AZ"
  ).locations;
  const hiring = extractHiringLocations(
    "We are hiring out of Atlanta, Charlotte, Nashville, Austin, or Houston."
  );
  assert.strictEqual(
    headerConflictsWithHiringLocations(header, hiring),
    true,
    "a header listing cities the body excludes is a conflict"
  );

  // A state-level permission covers its cities: "hiring out of Arizona" must not conflict
  // with a header that says Phoenix, AZ.
  const azHeader = parsePostingLocation("Phoenix, AZ; Denver, CO; Seattle, WA").locations;
  const azHiring = extractHiringLocations("We are hiring out of Arizona, Denver, and Seattle.");
  assert.strictEqual(
    headerConflictsWithHiringLocations(azHeader, azHiring),
    false,
    "a state named in the body covers that state's cities in the header"
  );

  // No restriction stated: the header stands, so no conflict.
  assert.strictEqual(headerConflictsWithHiringLocations(header, []), false);
}

function testIframeAndContentExtraction() {
  const wrapper = `<html><body><nav>Careers Home Search</nav>
    <iframe id="icims_content_iframe" src="/jobs/123/job?in_iframe=1"></iframe>
    <footer>Privacy</footer></body></html>`;
  assert.strictEqual(
    extractContentIframeUrl(wrapper, "https://careers.example.icims.com/jobs/search"),
    "https://careers.example.icims.com/jobs/123/job?in_iframe=1"
  );

  // Cross-origin iframes are embeds (video, maps), never the job content.
  const crossOrigin = `<iframe src="https://www.youtube.com/embed/abc"></iframe>`;
  assert.strictEqual(extractContentIframeUrl(crossOrigin, "https://careers.example.icims.com/x"), null);

  // The outer document of an iframe-wrapped page is only chrome -- extracting from it is
  // what produced null descriptions for every iCIMS and Paycor posting.
  const inner = `<html><body><div class="iCIMS_JobContent"><h2>Operations Manager</h2>
    <p>${"You will own the P&L and lead a team of thirty. ".repeat(8)}</p></div></body></html>`;
  const text = extractDescriptionTextFromHtml(inner);
  assert.ok(text.includes("Operations Manager"));
  assert.ok(text.length > 200);

  const jsonLd = extractJsonLdJobPosting(
    `<script type="application/ld+json">{"@type":"JobPosting","title":"GM","description":"<p>Own the P&L.</p>"}</script>`
  );
  assert.strictEqual(jsonLd.title, "GM");
}

function testLivenessAndAccountDetection() {
  assert.ok(detectSoftNotFound("This job posting is no longer available."));
  assert.ok(detectSoftNotFound("Sorry, this position has been filled."));
  assert.ok(detectSoftNotFound("The page you're looking for could not be found."));
  assert.ok(!detectSoftNotFound("Operations Manager - we are hiring for this open role."));

  assert.ok(detectRequiresAccount("", "Please sign in to apply for this position."));
  assert.ok(detectRequiresAccount('<div class="h-captcha"></div>', ""));
  assert.ok(detectRequiresAccount("", "Create an account to apply."));
  assert.ok(!detectRequiresAccount("", "Send your resume to jobs@example.com."));
}

function main() {
  testPayFromProse();
  testHiringRestrictions();
  testHeaderConflict();
  testIframeAndContentExtraction();
  testLivenessAndAccountDetection();
  console.log("posting-page-fetcher tests passed");
}

main();
