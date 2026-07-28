// Cover letter support: a brief assembled from the posting's description and the chosen
// resume, plus a scaffold to write into.
//
// The draft this used to produce was a mad-lib -- years of experience, education level and
// a list of profile links, poured into fixed sentences. It never read the job description,
// which was not really its fault: descriptions were not stored until recently. The result
// was the same letter for every posting apart from two nouns.
//
// A server cannot write a good cover letter; that needs a language model, and the caller
// is one. So the division of labour here is deliberate: this module extracts what the
// posting actually asks for, finds where the resume genuinely speaks to it, and names the
// requirements it does not -- then hands all of it over. The scaffold is a fallback for
// callers that just want something to send, not the intended output.
//
// unmatched_requirements matters as much as the matches. A letter written only from the
// overlap will happily imply the applicant meets everything; knowing which requirements
// have no support in the resume is what keeps the letter honest and lets the applicant
// decide whether to address a gap or leave it alone.
const { parseNonNegativeInteger } = require("../helpers/normalize-numbers");

// Deliberately not semantic-search's tokenizer. That one's stopword list is tuned to make
// BM25 ranking work across a whole corpus, so it strips "team", "experience", "manage",
// "operations" and the like as too common to discriminate. Those are precisely the words a
// requirement is made of: with them removed, "You have led and motivated a team before"
// reduces to almost nothing and reads as unmatched against a resume that describes leading
// a team of 85. Only true function words come out here.
const FUNCTION_WORDS = new Set([
  "the", "and", "for", "with", "you", "your", "our", "are", "will", "that", "this", "have",
  "has", "had", "from", "not", "but", "all", "can", "who", "was", "were", "been", "their",
  "them", "they", "its", "into", "out", "about", "over", "under", "more", "most", "other",
  "such", "than", "then", "there", "these", "those", "some", "any", "each", "how", "what",
  "when", "where", "which", "while", "would", "should", "could", "may", "might", "must",
  "per", "via", "etc", "also", "one", "two", "three", "able", "both", "very", "well",
  "here", "just", "own", "get", "got", "way", "use", "using", "used", "including", "include"
]);

function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s+#-]/g, " ")
    .split(/\s+/)
    .map((token) => token.replace(/^[-+#]+|[-+#]+$/g, ""))
    .filter((token) => token.length >= 3 && token.length <= 30 && !FUNCTION_WORDS.has(token) && !/^\d+$/.test(token));
}

// Dispositional requirements -- "bias towards action", "willing to get your hands dirty",
// "thrive in ambiguity". No resume states these in matching words, so flagging them as
// gaps is pure noise, and worse, it implies the applicant falls short on temperament. Only
// requirements naming something checkable are worth reporting as unmet.
const SOFT_REQUIREMENT = /bias (towards|toward)|hands dirty|open to feedback|fast[- ]paced|ambiguity|ambiguous|self[- ]starter|team player|passionate|thrive|crave|hustle|scrappy|curious|humble|energy|attitude|work ethic|willing to learn|detail[- ]oriented|communication skills/i;

const MAX_BULLETS_PER_SECTION = 12;
const MAX_BULLET_CHARS = 320;
const MIN_BULLET_CHARS = 20;

// Headers boards actually use, grouped by what the section is for. Matched against a whole
// line, so "Requirements:" and "What you'll need" both land, and a stray "requirements" in
// the middle of a paragraph does not.
const SECTION_PATTERNS = Object.freeze({
  responsibilities: [
    /^what you'?ll (do|be doing|own)\b/i,
    /^(key )?responsibilities\b/i,
    /^(the )?role\b.{0,20}$/i,
    /^about the (role|job|position)\b/i,
    /^in this role\b/i,
    /^day[- ]to[- ]day\b/i,
    /^your (impact|mission)\b/i,
    // Greenhouse's house style, which DoorDash and many others use verbatim. The
    // apostrophe arrives both straight and curly depending on the board's encoding.
    /^you['’]?re excited about (this|the) (opportunity|role|job)\b/i
  ],
  requirements: [
    /^what you'?ll (need|bring)\b/i,
    /^(minimum |basic |preferred )?(requirements|qualifications)\b/i,
    /^what we'?re looking for\b/i,
    /^(who|what) you are\b/i,
    /^(must|nice)[- ]to[- ]have/i,
    /^skills( and experience)?\b/i,
    /^experience\b.{0,20}$/i,
    /^you (have|bring|will have)\b/i,
    /^we['’]?re excited about you\b/i
  ]
});

// A header ends the previous section. Anything that looks like a header for a section we
// do not classify still terminates the one before it, so trailing legal boilerplate does
// not get swept into the requirements list.
const GENERIC_HEADER = /^[A-Z][^.!?]{2,70}:?$/;
const CLOSING_SECTIONS = [
  /^(why join|benefits|perks|compensation|salary|pay|what we offer)\b/i,
  /^(equal opportunity|eeo|diversity|accommodation|privacy|legal|disclaimer)\b/i,
  /^(how to )?apply\b/i,
  /^about (us|the company|reunion|doordash)\b/i
];

function splitLines(text) {
  return String(text || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function isBullet(line) {
  return /^[-*•·‣]\s+/.test(line) || /^\d+[.)]\s+/.test(line);
}

function cleanBullet(line) {
  return line
    .replace(/^[-*•·‣]\s+/, "")
    .replace(/^\d+[.)]\s+/, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_BULLET_CHARS);
}

function classifyHeader(line) {
  if (line.length > 90) return null;
  for (const [section, patterns] of Object.entries(SECTION_PATTERNS)) {
    if (patterns.some((pattern) => pattern.test(line))) return section;
  }
  if (CLOSING_SECTIONS.some((pattern) => pattern.test(line))) return "closing";
  // An unrecognised header still closes whatever section was open.
  if (GENERIC_HEADER.test(line) && !isBullet(line)) return "other";
  return null;
}

// Walks the description once, attributing bullets (and, where a section has none, its
// prose sentences) to whichever section heading is currently open.
function extractSections(descriptionText) {
  const lines = splitLines(descriptionText);
  const sections = { responsibilities: [], requirements: [] };
  const sawBulletIn = { responsibilities: false, requirements: false };
  let current = null;

  for (const line of lines) {
    const header = classifyHeader(line);
    if (header) {
      current = header === "responsibilities" || header === "requirements" ? header : null;
      continue;
    }
    if (!current) continue;
    if (sections[current].length >= MAX_BULLETS_PER_SECTION) continue;

    if (isBullet(line)) {
      const bullet = cleanBullet(line);
      if (bullet.length >= MIN_BULLET_CHARS) sections[current].push(bullet);
      sawBulletIn[current] = true;
      continue;
    }

    // Once a section is running as a bulleted list, a return to prose ends it. Boards
    // rarely put a header between the last bullet and the legal boilerplate that follows,
    // so without this the requirements list absorbs lines like "Applications for this
    // position are accepted on an ongoing basis" and they get reported as requirements.
    if (sawBulletIn[current]) {
      current = null;
      continue;
    }

    // Some boards write these sections as prose from the start. Take whole sentences.
    if (line.length >= MIN_BULLET_CHARS && /[.!?]$/.test(line)) {
      sections[current].push(line.slice(0, MAX_BULLET_CHARS));
    }
  }

  return sections;
}

// Terms the posting leans on that the resume also uses. Frequency in the description is
// the only available signal for what the posting cares about; presence in the resume is
// what makes a term usable as evidence rather than an aspiration.
function findOverlapTerms(descriptionText, resumeText, limit = 25) {
  const resumeTerms = new Set(tokenize(resumeText));
  if (resumeTerms.size === 0) return [];

  const counts = new Map();
  for (const token of tokenize(descriptionText)) {
    if (!resumeTerms.has(token)) continue;
    counts.set(token, (counts.get(token) || 0) + 1);
  }

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([term, count]) => ({ term, mentions_in_posting: count }));
}

// Resume lines that actually contain the overlap terms, so a letter can cite real
// experience instead of paraphrasing the job posting back at the employer.
function findResumeEvidence(resumeText, overlapTerms, limit = 8) {
  const terms = new Set(overlapTerms.map((entry) => entry.term));
  if (terms.size === 0) return [];

  const scored = [];
  for (const line of splitLines(resumeText)) {
    if (line.length < 40 || line.length > 400) continue;
    const hits = new Set(tokenize(line).filter((token) => terms.has(token)));
    if (hits.size === 0) continue;
    scored.push({ line: line.replace(/\s+/g, " ").trim(), matched_terms: Array.from(hits).sort(), score: hits.size });
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ score: _score, ...rest }) => rest);
}

// Crude stemming by truncation. Exact token matching reads "operational rigor ...
// processes" and "built standard operating procedures" as having nothing in common, which
// flags a requirement the applicant plainly meets. Truncating to a common prefix collapses
// operational/operating and management/managers, which is most of the inflection that
// matters here.
//
// It over-matches -- compliance/complicated share a prefix and are unrelated -- and that is
// the intended direction. A false match means a real gap goes unflagged; a false gap means
// the applicant is told they do not qualify for something they do. The second is worse, so
// the bias runs toward silence.
const STEM_LENGTH = 6;

function stem(term) {
  return term.length > STEM_LENGTH ? term.slice(0, STEM_LENGTH) : term;
}

// A requirement is "unmatched" when none of its meaningful words -- stemmed -- appear in
// the resume at all. Deliberately generous: one shared stem is enough to count as matched.
function findUnmatchedRequirements(requirements, resumeText) {
  const resumeStems = new Set(tokenize(resumeText).map(stem));
  if (resumeStems.size === 0) return [];

  return requirements.filter((requirement) => {
    if (SOFT_REQUIREMENT.test(requirement)) return false;
    const terms = tokenize(requirement);
    if (terms.length === 0) return false;
    return !terms.some((term) => resumeStems.has(stem(term)));
  });
}

function buildCoverLetterBrief({ description, resume_text, posting } = {}) {
  const descriptionText = String(description || "").trim();
  const resumeText = String(resume_text || "").trim();

  if (!descriptionText) {
    return {
      available: false,
      reason:
        "No stored description for this posting. Fetch it first (get_posting_details fetches on demand), or write from the resume alone and say so.",
      responsibilities: [],
      requirements: [],
      overlap_terms: [],
      resume_evidence: [],
      unmatched_requirements: []
    };
  }

  const sections = extractSections(descriptionText);
  const overlapTerms = resumeText ? findOverlapTerms(descriptionText, resumeText) : [];

  return {
    available: true,
    position_name: String(posting?.position_name || "").trim(),
    company_name: String(posting?.company_name || "").trim(),
    description_chars: descriptionText.length,
    responsibilities: sections.responsibilities,
    requirements: sections.requirements,
    // Vocabulary the posting emphasises that the resume also uses.
    overlap_terms: overlapTerms,
    // Real lines from the resume, for citing rather than paraphrasing.
    resume_evidence: resumeText ? findResumeEvidence(resumeText, overlapTerms) : [],
    // Requirements with no keyword support in the resume. Do not imply these are met.
    unmatched_requirements: resumeText ? findUnmatchedRequirements(sections.requirements, resumeText) : [],
    unmatched_requirements_note:
      "Keyword-based and approximate. It catches requirements the resume never speaks to, but a requirement the resume covers in different words can still appear here -- treat it as something to check with the applicant, not as a verdict that they do not qualify.",
    guidance:
      "Write the letter from resume_evidence and the posting's own responsibilities and requirements. Cite specific experience rather than restating the posting. Do not claim anything listed in unmatched_requirements without checking it with the applicant first. If the resume does not support a claim, leave it out."
  };
}

// A scaffold, not a finished letter. It exists so a caller with no model behind it still
// gets something coherent, and so the structure of a letter is explicit. Anything in
// double braces is a slot the caller is expected to replace with real content from the
// brief; they are left visible on purpose, because a placeholder that looks like prose
// gets sent by accident.
function buildCoverLetterDraft(personalInformation, posting, instructions = "", brief = null) {
  const firstName = String(personalInformation?.first_name || "").trim() || "Applicant";
  const lastName = String(personalInformation?.last_name || "").trim();
  const fullName = `${firstName}${lastName ? ` ${lastName}` : ""}`.trim();
  const yearsOfExperience = parseNonNegativeInteger(personalInformation?.years_of_experience);
  const positionName = String(posting?.position_name || "the role").trim();
  const companyName = String(posting?.company_name || "your company").trim();
  // Company names are stored as the ATS board slug, so they arrive all-lowercase
  // ("doordash"). Addressing a cover letter to "doordash" looks careless, and title case is
  // the safest general repair -- it will not recover internal capitals like DoorDash, so
  // the slot instructions tell the writer to check it. Names that already carry capitals
  // are left exactly as they are.
  const displayCompanyName =
    companyName === companyName.toLowerCase() && /[a-z]/.test(companyName)
      ? companyName.replace(/\b[a-z]/g, (character) => character.toUpperCase())
      : companyName;
  const linkedinUrl = String(personalInformation?.linkedin_url || "").trim();
  const portfolioUrl = String(personalInformation?.portfolio_url || "").trim();
  const extraInstructions = String(instructions || "").trim();

  const contactLine = [linkedinUrl, portfolioUrl].filter(Boolean).join(" | ");

  // The posting's own first line about the role, quoted rather than spliced into a
  // sentence. Splicing it meant lowercasing its first letter to fit the grammar, which
  // turned "DoorDash is looking for..." into "doorDash is looking for...", and a
  // multi-sentence bullet ran on into whatever followed it. Quoting sidesteps both: it
  // stays reference material inside a slot, which is what the scaffold is for.
  const focus = brief?.available
    ? (brief.responsibilities[0] || brief.requirements[0] || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 180)
    : "";

  const evidenceSlots = (brief?.resume_evidence || []).slice(0, 3);
  const evidenceBlock =
    evidenceSlots.length > 0
      ? evidenceSlots.map((item) => `- {{Expand into a specific result: ${item.line}}}`).join("\n")
      : `- {{Specific result that maps to what this role needs}}\n- {{Second result, with a number attached}}`;

  const experienceLine =
    yearsOfExperience > 0
      ? `{{Open with the framing of your ${yearsOfExperience}+ years that fits this role -- do not use the raw number if a narrower one is more accurate}}`
      : "{{Open with the experience framing that fits this role}}";

  const instructionSentence = extraInstructions ? `\n\n{{Work in these priorities: ${extraInstructions}}}` : "";

  const focusLine = focus
    ? `\n\n{{Connect your background to what the posting leads with: "${focus}"}}`
    : "";

  return `Dear Hiring Team,

I am writing about the ${positionName} role at ${displayCompanyName}. ${experienceLine}${focusLine}

${evidenceBlock}

{{One paragraph on why this company and this role specifically -- name something concrete from the posting, not adjectives.}}${instructionSentence}

Thank you for your consideration. I would welcome the chance to discuss the role.

Sincerely,
${fullName}${contactLine ? `\n${contactLine}` : ""}`.trim();
}

module.exports = {
  buildCoverLetterBrief,
  buildCoverLetterDraft,
  extractSections,
  findOverlapTerms,
  findResumeEvidence,
  findUnmatchedRequirements
};
