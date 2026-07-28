const { normalizeLikeText, parseJsonArray } = require("./normalize-strings");
const { normalizeBoolean, parseNonNegativeInteger } = require("./normalize-numbers");
const { parseRegionFilters, parseCountryFilters } = require("../helpers/description-filters")
const MCP_REMOTE_OPTIONS = new Set(["all", "remote", "hybrid", "non_remote"]);

// agent_login_email and agent_login_password used to live here and were handed to the
// agent in plaintext so it could create accounts and sign in as the user. Both are gone:
// an agent should not be authenticating as anyone, and the ATS platforms this applies to
// gate submission behind account creation plus a captcha regardless, so the credentials
// bought almost nothing while keeping a reusable password in a settings row. The runbook
// now hands off at the authentication boundary. mfa_login_notes survives as free text --
// it is a note to the user about how they handle approvals, not a secret.
const MCP_SETTINGS_DEFAULTS = {
  enabled: false,
  preferred_agent_name: "OpenPostings Agent",
  mfa_login_notes: "",
  dry_run_only: true,
  require_final_approval: true,
  max_applications_per_run: 10,
  preferred_search: "",
  preferred_remote: "all",
  preferred_industries: [],
  preferred_regions: [],
  preferred_countries: [],
  preferred_states: [],
  preferred_counties: [],
  instructions_for_agent: ""
};

function normalizeMcpRemotePreference(value) {
  const normalized = normalizeLikeText(value);
  if (MCP_REMOTE_OPTIONS.has(normalized)) return normalized;
  return "all";
}

function normalizeMcpSettingsInput(value = {}) {
  /** @type {any} */
  const source = value && typeof value === "object" ? value : {};

  // Credential fields are dropped rather than passed through, so a stored row, a settings
  // POST or a migration from an older database cannot reintroduce them downstream.
  return {
    enabled: normalizeBoolean(source.enabled, MCP_SETTINGS_DEFAULTS.enabled),
    preferred_agent_name: String(source.preferred_agent_name ?? MCP_SETTINGS_DEFAULTS.preferred_agent_name).trim() ||
      MCP_SETTINGS_DEFAULTS.preferred_agent_name,
    mfa_login_notes: String(source.mfa_login_notes ?? MCP_SETTINGS_DEFAULTS.mfa_login_notes).trim(),
    dry_run_only: normalizeBoolean(source.dry_run_only, MCP_SETTINGS_DEFAULTS.dry_run_only),
    require_final_approval: normalizeBoolean(
      source.require_final_approval,
      MCP_SETTINGS_DEFAULTS.require_final_approval
    ),
    max_applications_per_run:
      parseNonNegativeInteger(source.max_applications_per_run) || MCP_SETTINGS_DEFAULTS.max_applications_per_run,
    preferred_search: String(source.preferred_search ?? MCP_SETTINGS_DEFAULTS.preferred_search).trim(),
    preferred_remote: normalizeMcpRemotePreference(source.preferred_remote),
    preferred_industries: parseJsonArray(source.preferred_industries),
    preferred_regions: parseRegionFilters(parseJsonArray(source.preferred_regions)),
    preferred_countries: parseCountryFilters(parseJsonArray(source.preferred_countries)).map((filter) => filter.value),
    preferred_states: parseJsonArray(source.preferred_states).map((state) => state.toUpperCase()),
    preferred_counties: parseJsonArray(source.preferred_counties),
    instructions_for_agent: String(source.instructions_for_agent ?? MCP_SETTINGS_DEFAULTS.instructions_for_agent).trim()
  };
}

module.exports = { normalizeMcpSettingsInput, MCP_SETTINGS_DEFAULTS };
