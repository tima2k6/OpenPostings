const { normalizeMcpSettingsInput, MCP_SETTINGS_DEFAULTS } = require("../helpers/normalize-mcp-settings");
const { parseJsonArray } = require("../helpers/normalize-strings");
const { parseNonNegativeInteger } = require("../helpers/normalize-numbers");
const { getDb, getReadDb, setDb } = require("./runtime-context.js");

// The SELECT below has to name preferred_regions and preferred_countries explicitly. It did
// not, so upsertMcpSettings wrote both columns and every read handed back [] -- the settings
// page showed the saved regions and countries while the candidate query behaved as though
// none were set.
//
// On the reader connection, not the writer -- see personal-info.js's getPersonalInformation
// for why: this is read on nearly every request path (MCP tools and the settings screen
// both need it), so it must not queue behind a sync write transaction.
async function getMcpSettings() {
  const db = getReadDb();
  const row = await db.get(
    `
      SELECT
        id,
        enabled,
        preferred_agent_name,
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
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET
        enabled = excluded.enabled,
        preferred_agent_name = excluded.preferred_agent_name,
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
      "Shortlist, screen, prepare -- then hand back. Filter postings down, read each survivor's stored description against the resume, assemble everything the application needs, and stop at the point where the application asks for an account, a sign-in or a captcha. The user completes those steps themselves.",
    steps: [
      "Read applicantee information and MCP settings from this payload.",
      "List the stored documents with get_resume (no argument), then read the variant that fits the roles being targeted; it is the ground truth the profile fields summarize.",
      "Shortlist with find_posting_candidates (saved preferences) or query_postings (include/exclude terms, pay floor, recency). Use find_similar_postings to surface roles whose responsibilities match the resume even when the title would never have been guessed.",
      "Screen each shortlisted posting with get_posting_details and weigh its description against the resume before opening anything in a browser. Check location_conflict: when true, the description restricts hiring to fewer places than the header lists, and hiring_locations holds the ones that count.",
      "Call ignore_posting for postings that are not a fit, so no later run resurfaces them.",
      "For each posting worth applying to, draft the cover letter with draft_cover_letter (pass document=<key> to write from the matching resume variant).",
      "Call get_application_answers before touching a form. Anything it lists as unanswered -- work authorization, salary expectation, notice period and the rest -- must be asked of the user, never inferred from the resume or the posting and never left as a plausible placeholder. Record what they tell you with set_application_answer so the next application does not ask again.",
      "Open job_posting_url and fill in what can be filled from the applicant's own details and their stored answers.",
      "Stop at the authentication boundary. If the application requires creating an account, signing in, solving a captcha, or entering payment or government-identification details, do not attempt it: report what is prepared, name the posting and what the form is asking for, and let the user finish. requires_account on a posting flags this in advance where it was detected at scrape time.",
      "If dry_run_only is true, stop before final submit and return a dry-run result.",
      "When the user confirms an application was submitted, call record_application_result with commit=true and fit_assessment set to the judgment already formed while screening (good fit, stretch, overqualified or underqualified) -- do not leave it blank for the user to redo later. Consult list_applications when unsure whether a posting was already handled."
    ],
    guardrails: {
      dry_run_only: Boolean(settings?.dry_run_only),
      require_final_approval: Boolean(settings?.require_final_approval),
      // The agent prepares applications; it does not authenticate as the user. Most target
      // ATS platforms gate submission behind account creation plus a captcha anyway
      // (Greenhouse and Workday both want a candidate account, iCIMS instances sit behind
      // hCaptcha), so an agent holding credentials bought very little and stored a
      // reusable password in a plaintext settings row to do it.
      never_authenticate_as_user: true,
      // A fabricated screening answer is submitted under the applicant's name and cannot
      // be retracted, so a missing one is always a question for the user.
      never_invent_application_answers: true,
      hand_off_at: [
        "account creation",
        "sign-in",
        "captcha",
        "multi-factor approval",
        "payment or government identification details"
      ]
    },
    applicant_display_name: applicantFullName || "Applicant",
    applicant_email: String(personalInformation?.email || "").trim(),
    mfa_login_notes: String(settings?.mfa_login_notes || "").trim(),
    custom_instructions: String(settings?.instructions_for_agent || "").trim(),
    candidate_count: Array.isArray(candidates) ? candidates.length : 0
  };
}

// buildCoverLetterDraft now lives in cover-letter.js, alongside the brief that gives it
// something specific to say. Re-exported here so existing callers keep working.
const { buildCoverLetterDraft, buildCoverLetterBrief } = require("./cover-letter.js");

module.exports = { getMcpSettings, upsertMcpSettings, buildMcpRunbook, buildCoverLetterDraft, buildCoverLetterBrief };
