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
  detectRequiresAccount,
  stripApplicationBoilerplate
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

// The content extractor runs its match to the end of the file, so what gets stored is the
// role followed by the application form and the legal footer. Measured on a real Ethos
// Strategy & Operations posting, ten of the top twenty-five similarity query terms came
// from the EEO survey -- "veteran", "select", "disability", "disorder", "status".
const ROLE_BODY = [
  "Director, Strategy and Operations",
  "You will own the operating cadence for our consumer business, partner with the CEO on",
  "growth strategy, and build the analytics that drive pricing and channel decisions.",
  "- Own the P&L for the consumer segment and report outcomes to the leadership team.",
  "- Build the forecasting model and run the weekly business review end to end.",
  "- Partner with product and marketing to launch new distribution channels."
].join("\n");

function testStripsGreenhouseSelfIdentificationSurvey() {
  const text = [
    ROLE_BODY,
    "Voluntary Self-Identification",
    "Gender * Select...",
    "Are you Hispanic or Latinx? * Select...",
    "Protected Veteran Status * Select...",
    "Disability Status * Select...",
    "PUBLIC BURDEN STATEMENT: According to the Paperwork Reduction Act of 1995 no persons",
    "are required to respond to a collection of information unless such collection displays",
    "a valid OMB control number."
  ].join("\n");

  const stripped = stripApplicationBoilerplate(text);
  assert.ok(stripped.includes("operating cadence"), "the role body must survive");
  assert.ok(stripped.includes("weekly business review"), "responsibilities must survive");
  for (const gone of ["Select...", "Veteran", "Disability", "OMB", "Paperwork Reduction"]) {
    assert.ok(!stripped.includes(gone), `form text '${gone}' must be stripped`);
  }
}

// Workday and other JSON-LD boards return the whole description as one unbroken line, so
// line-level filtering alone left every one of them untouched.
function testStripsEeoStatementFromSingleLineDescription() {
  const eeo =
    "Expedia Group is an equal opportunity employer and does not discriminate on the basis of " +
    "race, color, religion, sex, national origin, ancestry, age, disability, veteran status, " +
    "marital status, sexual orientation, gender identity, or any other characteristic protected by law.";
  const oneLine = `${ROLE_BODY.replace(/\n/g, " ")} ${eeo} This employer participates in E-Verify.`;

  const stripped = stripApplicationBoilerplate(oneLine);
  assert.ok(stripped.includes("operating cadence"), "role text must survive in a single-line description");
  assert.ok(!/equal opportunity employer/i.test(stripped), "the EEO statement must go even with no newlines");
  assert.ok(!/E-Verify/i.test(stripped), "the E-Verify notice must go too");
}

// The guard that matters most: a pattern misfiring must not be able to gut a posting.
function testKeepsOriginalWhenStrippingWouldGutIt() {
  const mostlyBoilerplate = [
    "Apply for this job",
    "Gender * Select...",
    "Race * Select...",
    "Protected Veteran Status * Select...",
    "Short role blurb that is not enough on its own to stand as a description of the work."
  ].join("\n");
  assert.strictEqual(
    stripApplicationBoilerplate(mostlyBoilerplate),
    mostlyBoilerplate,
    "when stripping would remove most of the text, the original is the safer answer"
  );
}

// An employer that leads with its EEO commitment, or a posting that says "apply now" up
// front, must not lose its body to the tail cut.
function testEarlyMarkerDoesNotTruncateTheBody() {
  const text = ["Apply now to join our team!", ROLE_BODY, ROLE_BODY].join("\n");
  const stripped = stripApplicationBoilerplate(text);
  assert.ok(stripped.includes("distribution channels"), "an early marker must not cut the description");
  assert.ok(stripped.length > text.length * 0.8, "almost nothing should be removed here");
}

// Two protected classes in a sentence about the actual work is not a legal notice.
function testDoesNotStripRoleTextMentioningProtectedClasses() {
  const text = [
    ROLE_BODY,
    "- Lead our age and disability inclusion programs across the consumer organisation.",
    "- Report programme outcomes to the executive team each quarter."
  ].join("\n");
  const stripped = stripApplicationBoilerplate(text);
  assert.ok(stripped.includes("inclusion programs"), "real responsibilities that name protected classes must survive");
}

// Regression: a board that stores the description with its markup intact produced a single
// 4,073-character "sentence" containing both the benefits section and a legal notice.
// Dropping it on the notice cost a real Bob Evans posting half its content.
function testDoesNotDropALongMixedContentBlock() {
  const legal =
    "We are an equal opportunity employer and consider applicants without regard to race, " +
    "color, religion, sex, national origin, age, disability or veteran status.";
  const filler =
    "We pride ourselves on serving high quality farm fresh food and on training our managers " +
    "to run their restaurants like owners, with full responsibility for the P&L. ";
  const blob = `Excellent benefits including a 401(k) with employer match. ${filler.repeat(6)}${legal}`;
  assert.ok(blob.length > 600, "the fixture must exceed the droppable-segment cap to be meaningful");

  const stripped = stripApplicationBoilerplate(`${ROLE_BODY}\n${blob}`);
  assert.ok(stripped.includes("farm fresh food"), "a long mixed block must survive even with a notice inside it");
  assert.ok(stripped.includes("401(k)"), "its benefits text must survive too");
}

function main() {
  testPayFromProse();
  testHiringRestrictions();
  testHeaderConflict();
  testIframeAndContentExtraction();
  testLivenessAndAccountDetection();
  testStripsGreenhouseSelfIdentificationSurvey();
  testStripsEeoStatementFromSingleLineDescription();
  testKeepsOriginalWhenStrippingWouldGutIt();
  testEarlyMarkerDoesNotTruncateTheBody();
  testDoesNotStripRoleTextMentioningProtectedClasses();
  testDoesNotDropALongMixedContentBlock();
  console.log("posting-page-fetcher tests passed");
}

main();
