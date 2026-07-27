const { normalizeMcpSettingsInput, MCP_SETTINGS_DEFAULTS } = require("../helpers/normalize-mcp-settings");
const { parseJsonArray } = require("../helpers/normalize-strings");
const { parseNonNegativeInteger } = require("../helpers/normalize-numbers");
const { getDb, setDb } = require("./runtime-context.js");

// The SELECT below has to name preferred_regions and preferred_countries explicitly. It did
// not, so upsertMcpSettings wrote both columns and every read handed back [] -- the settings
// page showed the saved regions and countries while the candidate query behaved as though
// none were set.
async function getMcpSettings() {
  const db = getDb();
  const row = await db.get(
    `
      SELECT
        id,
        enabled,
        preferred_agent_name,
        agent_login_email,
        agent_login_password,
        mfa_login_email,
        mfa_login_notes,
        dry_run_only,
        require_final_approval,
        max_applications_per_run,
        preferred_search,
        preferred_remote,
        preferred_industries,
        preferred_regions,
        preferred_countries,
        preferred_states,
        preferred_counties,
        instructions_for_agent
      FROM McpSettings
      WHERE id = 1
      LIMIT 1;
    `
  );

  const settings = normalizeMcpSettingsInput({
    ...MCP_SETTINGS_DEFAULTS,
    enabled: Boolean(Number(row?.enabled || 0)),
    preferred_agent_name: row?.preferred_agent_name,
    agent_login_email: row?.agent_login_email,
    agent_login_password: row?.agent_login_password,
    mfa_login_email: row?.mfa_login_email,
    mfa_login_notes: row?.mfa_login_notes,
    dry_run_only: Boolean(Number(row?.dry_run_only ?? 1)),
    require_final_approval: Boolean(Number(row?.require_final_approval ?? 1)),
    max_applications_per_run: row?.max_applications_per_run,
    preferred_search: row?.preferred_search,
    preferred_remote: row?.preferred_remote,
    preferred_industries: parseJsonArray(row?.preferred_industries),
    preferred_regions: parseJsonArray(row?.preferred_regions),
    preferred_countries: parseJsonArray(row?.preferred_countries),
    preferred_states: parseJsonArray(row?.preferred_states),
    preferred_counties: parseJsonArray(row?.preferred_counties),
    instructions_for_agent: row?.instructions_for_agent
  });

  return settings;
}

async function upsertMcpSettings(input) {
  const normalized = normalizeMcpSettingsInput(input);
  const db = getDb();
  await db.run(
    `
      INSERT INTO McpSettings (
        id,
        enabled,
        preferred_agent_name,
        agent_login_email,
        agent_login_password,
        mfa_login_email,
        mfa_login_notes,
        dry_run_only,
        require_final_approval,
        max_applications_per_run,
        preferred_search,
        preferred_remote,
        preferred_industries,
        preferred_regions,
        preferred_countries,
        preferred_states,
        preferred_counties,
        instructions_for_agent,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET
        enabled = excluded.enabled,
        preferred_agent_name = excluded.preferred_agent_name,
        agent_login_email = excluded.agent_login_email,
        agent_login_password = excluded.agent_login_password,
        mfa_login_email = excluded.mfa_login_email,
        mfa_login_notes = excluded.mfa_login_notes,
        dry_run_only = excluded.dry_run_only,
        require_final_approval = excluded.require_final_approval,
        max_applications_per_run = excluded.max_applications_per_run,
        preferred_search = excluded.preferred_search,
        preferred_remote = excluded.preferred_remote,
        preferred_industries = excluded.preferred_industries,
        preferred_regions = excluded.preferred_regions,
        preferred_countries = excluded.preferred_countries,
        preferred_states = excluded.preferred_states,
        preferred_counties = excluded.preferred_counties,
        instructions_for_agent = excluded.instructions_for_agent,
        updated_at = datetime('now');
    `,
    [
      1,
      normalized.enabled ? 1 : 0,
      normalized.preferred_agent_name,
      normalized.agent_login_email,
      normalized.agent_login_password,
      normalized.mfa_login_email,
      normalized.mfa_login_notes,
      normalized.dry_run_only ? 1 : 0,
      normalized.require_final_approval ? 1 : 0,
      normalized.max_applications_per_run,
      normalized.preferred_search,
      normalized.preferred_remote,
      JSON.stringify(normalized.preferred_industries || []),
      JSON.stringify(normalized.preferred_regions || []),
      JSON.stringify(normalized.preferred_countries || []),
      JSON.stringify(normalized.preferred_states || []),
      JSON.stringify(normalized.preferred_counties || []),
      normalized.instructions_for_agent
    ]
  );

  return getMcpSettings();
}




function buildMcpRunbook(settings, personalInformation, candidates) {
  const preferredAgent = String(settings?.preferred_agent_name || "OpenPostings Agent").trim();
  const applicantFullName = [
    String(personalInformation?.first_name || "").trim(),
    String(personalInformation?.middle_name || "").trim(),
    String(personalInformation?.last_name || "").trim()
  ]
    .filter(Boolean)
    .join(" ");

  return {
    preferred_agent_name: preferredAgent,
    summary:
      "Use your existing browser/web automation tools to open each job URL, complete the application form, and submit only when allowed by settings and credentials.",
    steps: [
      "Read applicantee information and MCP settings from this payload.",
      "For each candidate posting, open job_posting_url and validate role relevance before applying.",
      "Fill application fields using applicantee information. Keep applicant email separate from agent login email.",
      "If an account or MFA is required, use agent_login_email + agent_login_password for account creation and sign-in flows.",
      "Use the same agent_login_email for MFA/approval flows when required.",
      "Draft a job-specific cover letter aligned to the posting requirements and applicant background.",
      "If dry_run_only is true, stop before final submit and return a dry-run result.",
      "When application is submitted, call record_application_result with commit=true to write outcomes."
    ],
    guardrails: {
      dry_run_only: Boolean(settings?.dry_run_only),
      require_final_approval: Boolean(settings?.require_final_approval)
    },
    applicant_display_name: applicantFullName || "Applicant",
    applicant_email: String(personalInformation?.email || "").trim(),
    agent_login_email: String(settings?.agent_login_email || "").trim(),
    agent_login_password: String(settings?.agent_login_password || ""),
    mfa_login_email: String(settings?.agent_login_email || "").trim(),
    mfa_login_notes: String(settings?.mfa_login_notes || "").trim(),
    custom_instructions: String(settings?.instructions_for_agent || "").trim(),
    candidate_count: Array.isArray(candidates) ? candidates.length : 0
  };
}

function buildCoverLetterDraft(personalInformation, posting, instructions = "") {
  const firstName = String(personalInformation?.first_name || "").trim() || "Applicant";
  const lastName = String(personalInformation?.last_name || "").trim();
  const fullName = `${firstName}${lastName ? ` ${lastName}` : ""}`.trim();
  const yearsOfExperience = parseNonNegativeInteger(personalInformation?.years_of_experience);
  const positionName = String(posting?.position_name || "the role").trim();
  const companyName = String(posting?.company_name || "your company").trim();
  const linkedinUrl = String(personalInformation?.linkedin_url || "").trim();
  const githubUrl = String(personalInformation?.github_url || "").trim();
  const portfolioUrl = String(personalInformation?.portfolio_url || "").trim();
  const educationLevel = String(personalInformation?.education_level || "").trim();
  const extraInstructions = String(instructions || "").trim();

  const profileDetails = [];
  if (yearsOfExperience > 0) profileDetails.push(`${yearsOfExperience}+ years of relevant experience`);
  if (educationLevel) profileDetails.push(`education in ${educationLevel}`);
  if (linkedinUrl) profileDetails.push(`LinkedIn: ${linkedinUrl}`);
  if (githubUrl) profileDetails.push(`GitHub: ${githubUrl}`);
  if (portfolioUrl) profileDetails.push(`Portfolio: ${portfolioUrl}`);

  const profileSentence =
    profileDetails.length > 0
      ? `My background includes ${profileDetails.join(", ")}.`
      : "I bring hands-on experience delivering high-quality work in fast-moving environments.";

  const instructionSentence = extraInstructions
    ? `I am especially aligned with these priorities: ${extraInstructions}.`
    : "";

  return `Dear Hiring Team,

I am excited to apply for the ${positionName} role at ${companyName}. ${profileSentence}

I am motivated by opportunities where I can contribute quickly, collaborate with a strong team, and improve outcomes for customers and the business. ${instructionSentence}

Thank you for your consideration. I would value the chance to discuss how I can support ${companyName}.

Sincerely,
${fullName}`.trim();
}

module.exports = { getMcpSettings, upsertMcpSettings, buildMcpRunbook, buildCoverLetterDraft };
