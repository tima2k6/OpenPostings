// The cover-letter brief. The point of this module is that a letter gets written from the
// posting's own words and the resume's real content, so the cases that matter are: does it
// find the sections boards actually use, does it cite resume lines rather than paraphrase
// the posting, and -- most important -- does it name the requirements the resume does not
// support, so the letter does not quietly claim them.
const assert = require("assert");

const {
  buildCoverLetterBrief,
  buildCoverLetterDraft,
  extractSections,
  findOverlapTerms,
  findResumeEvidence,
  findUnmatchedRequirements,
  findUnmatchedRequirementsStrict
} = require("../services/cover-letter.js");

const DESCRIPTION = `About the role

We are hiring a General Manager to own our compliance software business.

What you'll do

- Own the P&L. Carry revenue, margin and growth targets for the software business.
- Run the business day to day, setting priorities across sales, marketing and operations.
- Build systems that scale, from customer onboarding through renewal and escalation handling.
- Hire top talent and hold the team accountable against a high performance bar.

What you'll need

- Experience running a business unit or P&L with a track record of hitting targets you owned.
- Demonstrated operational rigor: clear metrics, clear ownership, processes that survive growth.
- Comfort operating in a regulated or compliance-heavy domain.
- Kubernetes and distributed systems experience at production scale.

Why join us?

- Own a full P&L at an inflection point.

Equal opportunity

We are an equal opportunity employer.`;

const RESUME = `Tim Annan
Hotel General Manager and Hospitality Technology Leader
Owned full P&L for a 220-room property with $18M annual revenue, improving margin through labor cost control and vendor contract renegotiation.
Led a multi-department team of 85 across front office, housekeeping, food and beverage and engineering.
Built standard operating procedures, KPI dashboards and weekly business reviews to hold department heads accountable.
Managed capital projects and third-party vendor partnerships across the property portfolio.`;

function testSectionExtraction() {
  const sections = extractSections(DESCRIPTION);

  // Content, not counts: "About the role" opens the same section and contributes its
  // intro sentence, which is legitimate context, so an exact count is brittle. What must
  // hold is that no bullet is lost.
  const responsibilities = sections.responsibilities.join(" | ");
  for (const expected of [/Own the P&L/, /Run the business day to day/, /Build systems that scale/, /Hire top talent/]) {
    assert.match(responsibilities, expected, `responsibility bullet missing: ${expected}`);
  }

  const requirements = sections.requirements.join(" | ");
  for (const expected of [/running a business unit/, /operational rigor/, /compliance-heavy domain/, /Kubernetes/]) {
    assert.match(requirements, expected, `requirement bullet missing: ${expected}`);
  }

  // Sections after the ones we care about must not bleed in: a "Why join us" perk or the
  // EEO statement is not a requirement, and reading it as one would put it in the letter.
  const allText = [...sections.responsibilities, ...sections.requirements].join(" ");
  assert.ok(!/inflection point/i.test(allText), "perks must not be read as requirements");
  assert.ok(!/equal opportunity/i.test(allText), "EEO boilerplate must not be read as requirements");
}

function testOverlapAndEvidence() {
  const overlap = findOverlapTerms(DESCRIPTION, RESUME);
  const terms = overlap.map((entry) => entry.term);
  for (const expected of ["business", "margin", "revenue", "accountable"]) {
    assert.ok(terms.includes(expected), `${expected} appears in both and should be overlap`);
  }
  // Overlap means present in both. A term only the posting uses is not evidence of
  // anything, and neither is one only the resume uses -- "vendor" is all over this resume
  // but the posting never mentions vendors, so leading with it would be talking past the
  // employer.
  assert.ok(!terms.includes("kubernetes"), "a posting-only term is not overlap");
  assert.ok(!terms.includes("vendor"), "a resume-only term is not overlap");

  const evidence = findResumeEvidence(RESUME, overlap);
  assert.ok(evidence.length > 0, "there must be resume lines to cite");
  assert.ok(
    evidence.every((item) => RESUME.includes(item.line)),
    "evidence must be real resume lines, not generated prose"
  );
  assert.ok(evidence.every((item) => item.matched_terms.length > 0));
}

function testUnmatchedRequirementsAreNamed() {
  const sections = extractSections(DESCRIPTION);
  const unmatched = findUnmatchedRequirements(sections.requirements, RESUME);
  assert.strictEqual(unmatched.length, 1, "only the genuinely unsupported requirement is flagged");
  assert.match(unmatched[0], /Kubernetes/, "the technical requirement is the unmatched one");

  // The genuinely matched ones must not be flagged -- a false gap talks the applicant out
  // of a role they can do. "operational rigor ... processes" is the case that matters:
  // the resume says "operating procedures" and "KPI dashboards", which is the same
  // capability in different words, and exact token matching called it a gap.
  assert.ok(!unmatched.some((item) => /P&L/.test(item)));
  assert.ok(
    !unmatched.some((item) => /operational rigor/i.test(item)),
    "inflected wording (operational/operating) must not read as a gap"
  );
}

// Greenhouse's house style, plus the trailing boilerplate that sits between the last
// bullet and the next header with nothing to separate them.
const GREENHOUSE_DESCRIPTION = `About the Role

We are looking for a Manager to join the Strategy & Operations team.

We're excited about you because…

- You have 6+ years of experience in a high-performance culture.
- You have led and motivated a team before
- You have a bias towards action and can thrive in a fast-paced, ambiguous environment
- You're willing to get your hands dirty and you're open to feedback
- Bachelor's degree required, MBA a plus
- Deep Kubernetes and distributed systems expertise at production scale

Applications for this position are accepted on an ongoing basis.
Notice to Applicants for Jobs Located in NYC or Remote Jobs.

Compensation

$136,000 - $200,000 USD`;

function testGreenhouseStyleAndBoilerplate() {
  const sections = extractSections(GREENHOUSE_DESCRIPTION);
  const requirements = sections.requirements;
  assert.ok(requirements.length > 0, "Greenhouse's 'We're excited about you' phrasing must be recognised");
  assert.match(requirements.join(" | "), /6\+ years/);

  // A bulleted section ends when prose resumes. Without that, the legal boilerplate that
  // follows the last bullet gets reported to the applicant as a job requirement.
  const joined = requirements.join(" | ");
  assert.ok(!/accepted on an ongoing basis/i.test(joined), "boilerplate must not be read as a requirement");
  assert.ok(!/Notice to Applicants/i.test(joined), "legal notices must not be read as requirements");
  assert.ok(!/\$136,000/.test(joined), "the pay line must not be read as a requirement");
}

function testSoftRequirementsAreNotReportedAsGaps() {
  const sections = extractSections(GREENHOUSE_DESCRIPTION);
  const unmatched = findUnmatchedRequirements(sections.requirements, RESUME);
  const joined = unmatched.join(" | ");

  // Dispositional lines never match a resume in words, so flagging them says nothing
  // except that the applicant is temperamentally unsuited -- which is not a claim any
  // keyword comparison can support.
  assert.ok(!/bias towards action/i.test(joined), "a disposition is not a checkable gap");
  assert.ok(!/hands dirty/i.test(joined), "a disposition is not a checkable gap");

  // People leadership must not read as a gap for a resume that describes leading a team of
  // 85 -- this failed while the search tokenizer's stopword list was stripping "team".
  assert.ok(!/led and motivated a team/i.test(joined), "team leadership is covered by this resume");

  // The genuinely absent technical requirement still surfaces.
  assert.match(joined, /Kubernetes/, "a real, checkable gap must still be reported");
}

function testBriefShape() {
  const brief = buildCoverLetterBrief({
    description: DESCRIPTION,
    resume_text: RESUME,
    posting: { company_name: "Reunion", position_name: "General Manager" }
  });
  assert.strictEqual(brief.available, true);
  assert.strictEqual(brief.company_name, "Reunion");
  assert.ok(brief.requirements.length > 0 && brief.responsibilities.length > 0);
  assert.ok(brief.unmatched_requirements.length > 0);
  assert.match(brief.guidance, /do not claim/i);

  // No description is a stated fact, not an empty brief that reads like "nothing required".
  const missing = buildCoverLetterBrief({ description: "", resume_text: RESUME });
  assert.strictEqual(missing.available, false);
  assert.match(missing.reason, /no stored description/i);
}

function testDraftIsAScaffoldNotAFinishedLetter() {
  const brief = buildCoverLetterBrief({
    description: DESCRIPTION,
    resume_text: RESUME,
    posting: { company_name: "Reunion", position_name: "General Manager" }
  });
  const draft = buildCoverLetterDraft(
    { first_name: "Tim", last_name: "Annan", years_of_experience: 18 },
    { company_name: "Reunion", position_name: "General Manager" },
    "",
    brief
  );

  assert.match(draft, /Reunion/);
  assert.match(draft, /General Manager/);
  // Slots must stay visibly unfilled: a placeholder that reads like prose gets sent.
  assert.ok(draft.includes("{{"), "the scaffold must leave its slots obviously unfilled");
  // The raw years figure must not be asserted -- 18 was the number that caused trouble.
  assert.ok(!/\b18\+ years of relevant experience\b/.test(draft), "must not assert a raw years figure as fact");

  // Without a brief it still produces something rather than throwing.
  const bare = buildCoverLetterDraft({ first_name: "Tim" }, { company_name: "Acme" }, "");
  assert.match(bare, /Acme/);
}

// Modeled on a real posting (Northwest Administrators, "Benefits Eligibility Clerk") that
// scored 100% against a hotel GM resume in production: every "requirement" here is a
// generic trait label plus filler ("Organized. Ability to juggle..."), the exact shape that
// lets one throwaway word ("skills", "excellent") pass the whole bullet under the lenient
// one-shared-stem rule. The resume below adds the kind of generic self-description
// adjectives ("excellent", "analytical", "technically") a real, full-length resume
// incidentally contains -- reproducing the actual failure, not just its shape.
const GENERIC_TRAIT_REQUIREMENTS = [
  "Organized. Ability to juggle and prioritize workloads, have strong analytical skills",
  "Communicator. Excellent interpersonal and communication skills",
  "Detailed. Strong attention to detail with excellent problem solving skills",
  "Technically Savvy. Basic proficiency in Excel and Word"
];
const RESUME_WITH_GENERIC_ADJECTIVES = `${RESUME}
Known for excellent follow-through, strong analytical judgment and a technically confident approach to vendor systems.`;

function testStrictMatchingCatchesGenericBulletsTheLenientRuleMisses() {
  // This is the actual bug: the lenient rule flags nothing here, because each bullet shares
  // at least one throwaway word with the resume's ordinary self-description vocabulary --
  // this is what let a $21/hr benefits-clerk posting score 100% against a hotel GM resume.
  const lenientUnmatched = findUnmatchedRequirements(GENERIC_TRAIT_REQUIREMENTS, RESUME_WITH_GENERIC_ADJECTIVES);
  assert.strictEqual(
    lenientUnmatched.length,
    0,
    "documents the lenient rule's actual behavior -- posting-match.js's ranking path works around this, draft_cover_letter does not need to"
  );

  // findUnmatchedRequirementsStrict strips that same filler vocabulary before matching (see
  // its comment in cover-letter.js) and requires two discriminative terms to agree, so none
  // of these pass on a single incidental adjective. "Communicator..." is excluded from
  // scorable entirely (SOFT_REQUIREMENT already matches "communication skills"), not forced
  // to either side.
  const { scorable, unmatched } = findUnmatchedRequirementsStrict(GENERIC_TRAIT_REQUIREMENTS, RESUME_WITH_GENERIC_ADJECTIVES);
  assert.strictEqual(scorable.length, 3, "the dispositional/soft bullet is excluded, not counted");
  assert.strictEqual(unmatched.length, 3, "every remaining generic trait bullet must be flagged, not silently passed");
}

function main() {
  testSectionExtraction();
  testGreenhouseStyleAndBoilerplate();
  testSoftRequirementsAreNotReportedAsGaps();
  testOverlapAndEvidence();
  testUnmatchedRequirementsAreNamed();
  testBriefShape();
  testDraftIsAScaffoldNotAFinishedLetter();
  testStrictMatchingCatchesGenericBulletsTheLenientRuleMisses();
  console.log("cover-letter tests passed");
}

main();
