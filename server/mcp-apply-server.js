// The MCP apply agent, served over stdio.
//
// Matching now runs through the same services the HTTP API uses. This file used to carry its
// own copies of the state, county, remote and industry matchers -- roughly 700 lines -- and
// they drifted: the agent could filter on six criteria while the app it applies on behalf of
// offered fifteen, and the duplicated location code had to be pinned to the shared helper by
// a dedicated test to stop the two disagreeing about "Washington, DC". Nothing here decides
// what matches any more; it only maps tool arguments and saved preferences onto
// listPostingsWithFilters.
const path = require("path");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const z = require("zod");

const { ATS_FILTER_OPTIONS } = require("./helpers/normalize-ats.js");
const {
  COMPENSATION_TYPES,
  COMPENSATION_PAY_PERIODS,
  EDUCATION_LEVELS,
  LOCATION_REGION_OPTIONS
} = require("./helpers/description-filters.js");
const { nowEpochSeconds, parseNonNegativeInteger, normalizeBoolean } = require("./helpers/normalize-numbers.js");
const {
  normalizeLikeText,
  normalizeStringArray,
  normalizeAppliedByType,
  normalizeAppliedByLabel
} = require("./helpers/normalize-strings.js");
const { MCP_SETTINGS_DEFAULTS } = require("./helpers/normalize-mcp-settings.js");
const { setDb } = require("./services/runtime-context.js");
const { getMcpSettings, buildMcpRunbook, buildCoverLetterDraft } = require("./services/mcp.js");
const { getPersonalInformation } = require("./services/personal-info.js");
const {
  listPostingsWithFilters,
  getPostingsByUrls,
  setPostingIgnoredState,
  enrichPostingsWithApplicationState
} = require("./services/postings.js");
const { listApplications } = require("./services/applications.js");
const { extractDocumentText } = require("./services/applicant-documents.js");
const { runQuery, SORTABLE, MAX_ROWS } = require("./services/db-query.js");
const { getPostingFilterOptions } = require("./services/filter-options.js");
const { ensureSyncServiceSettingsTable, loadSyncServiceSettingsIntoRuntime } = require("./services/sync-settings.js");

const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, "..", "jobs.db");

const MCP_ATS_FILTER_VALUES = Object.freeze(Array.from(ATS_FILTER_OPTIONS));
const MCP_REGION_FILTER_VALUES = Object.freeze(LOCATION_REGION_OPTIONS.map((option) => option.value));
const MCP_REMOTE_FILTER_VALUES = Object.freeze(["all", "remote", "hybrid", "non_remote"]);
const MCP_SORT_VALUES = Object.freeze(["recent", "company_asc"]);
const MCP_QUERY_SORT_VALUES = Object.freeze(Array.from(SORTABLE.keys()));
const MAX_CANDIDATE_LIMIT = 2000;

let db;

function ensureMcpAgentEnabled(settings) {
  if (normalizeBoolean(settings?.enabled, false)) return;
  throw new Error("MCP application agent is disabled in settings.");
}

async function ensureTables() {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS PersonalInformation (
      first_name TEXT NOT NULL,
      middle_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone_number TEXT NOT NULL,
      address TEXT NOT NULL,
      linkedin_url TEXT NOT NULL,
      github_url TEXT NOT NULL,
      portfolio_url TEXT NOT NULL,
      resume_file_path TEXT NOT NULL,
      projects_portfolio_file_path TEXT NOT NULL,
      certifications_folder_path TEXT NOT NULL,
      ethnicity TEXT NOT NULL,
      gender TEXT NOT NULL,
      age INTEGER NOT NULL,
      veteran_status TEXT NOT NULL,
      disability_status TEXT NOT NULL,
      education_level TEXT NOT NULL,
      years_of_experience INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS applications (
      id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL,
      position_name TEXT NOT NULL,
      application_date INTEGER NOT NULL,
      status TEXT
    );

    CREATE TABLE IF NOT EXISTS McpSettings (
      id INTEGER NOT NULL PRIMARY KEY CHECK (id = 1),
      enabled INTEGER NOT NULL DEFAULT 0,
      preferred_agent_name TEXT NOT NULL DEFAULT 'OpenPostings Agent',
      agent_login_email TEXT NOT NULL DEFAULT '',
      agent_login_password TEXT NOT NULL DEFAULT '',
      mfa_login_email TEXT NOT NULL DEFAULT '',
      mfa_login_notes TEXT NOT NULL DEFAULT '',
      dry_run_only INTEGER NOT NULL DEFAULT 1,
      require_final_approval INTEGER NOT NULL DEFAULT 1,
      max_applications_per_run INTEGER NOT NULL DEFAULT 10,
      preferred_search TEXT NOT NULL DEFAULT '',
      preferred_remote TEXT NOT NULL DEFAULT 'all',
      preferred_industries TEXT NOT NULL DEFAULT '[]',
      preferred_regions TEXT NOT NULL DEFAULT '[]',
      preferred_countries TEXT NOT NULL DEFAULT '[]',
      preferred_states TEXT NOT NULL DEFAULT '[]',
      preferred_counties TEXT NOT NULL DEFAULT '[]',
      instructions_for_agent TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS application_attribution (
      application_id INTEGER NOT NULL PRIMARY KEY,
      applied_by_type TEXT NOT NULL,
      applied_by_label TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS posting_application_state (
      job_posting_url TEXT NOT NULL PRIMARY KEY,
      applied INTEGER NOT NULL DEFAULT 0,
      applied_by_type TEXT NOT NULL,
      applied_by_label TEXT NOT NULL,
      applied_at_epoch INTEGER,
      last_application_id INTEGER,
      ignored INTEGER NOT NULL DEFAULT 0,
      ignored_at_epoch INTEGER,
      ignored_by_label TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    INSERT INTO McpSettings (
      id,
      enabled,
      preferred_agent_name,
      agent_login_email,
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
    ) VALUES (1, 0, 'OpenPostings Agent', '', '', '', 1, 1, 10, '', 'all', '[]', '[]', '[]', '[]', '[]', '')
    ON CONFLICT(id) DO NOTHING;
  `);

  const postingStateColumns = await db.all(`PRAGMA table_info('posting_application_state');`);
  const postingStateColumnNames = new Set(postingStateColumns.map((column) => String(column?.name || "")));
  const mcpSettingsColumns = await db.all(`PRAGMA table_info('McpSettings');`);
  const mcpSettingsColumnNames = new Set(mcpSettingsColumns.map((column) => String(column?.name || "")));

  if (!postingStateColumnNames.has("ignored")) {
    await db.exec(`
      ALTER TABLE posting_application_state
      ADD COLUMN ignored INTEGER NOT NULL DEFAULT 0;
    `);
  }
  if (!postingStateColumnNames.has("ignored_at_epoch")) {
    await db.exec(`
      ALTER TABLE posting_application_state
      ADD COLUMN ignored_at_epoch INTEGER;
    `);
  }
  if (!postingStateColumnNames.has("ignored_by_label")) {
    await db.exec(`
      ALTER TABLE posting_application_state
      ADD COLUMN ignored_by_label TEXT NOT NULL DEFAULT '';
    `);
  }
  if (!mcpSettingsColumnNames.has("agent_login_password")) {
    await db.exec(`
      ALTER TABLE McpSettings
      ADD COLUMN agent_login_password TEXT NOT NULL DEFAULT '';
    `);
  }
  // Mirrors the migrations in the API server. Without them a database whose McpSettings table
  // predates these columns makes every settings read fail here, because the shared reader
  // names both columns in its SELECT.
  if (!mcpSettingsColumnNames.has("preferred_regions")) {
    await db.exec(`
      ALTER TABLE McpSettings
      ADD COLUMN preferred_regions TEXT NOT NULL DEFAULT '[]';
    `);
  }
  if (!mcpSettingsColumnNames.has("preferred_countries")) {
    await db.exec(`
      ALTER TABLE McpSettings
      ADD COLUMN preferred_countries TEXT NOT NULL DEFAULT '[]';
    `);
  }
}

async function openDatabase() {
  db = await open({
    filename: DB_PATH,
    driver: sqlite3.Database
  });
  // The shared services read their handle from the runtime context rather than taking one.
  setDb(db);
  await ensureTables();
  // Freshness and enabled-ATS live in the sync settings, and listPostingsWithFilters applies
  // the freshness window from process state. Without this the agent would silently use the
  // default window instead of the one configured for this instance.
  await ensureSyncServiceSettingsTable();
  await loadSyncServiceSettingsIntoRuntime();
}

// An explicitly passed filter replaces the saved preference; an empty one falls back to it,
// unless the caller opted out of preferences entirely.
function resolveListFilter(explicitValues, preferredValues, useSettings) {
  const explicit = normalizeStringArray(explicitValues);
  if (explicit.length > 0) return explicit;
  return useSettings ? normalizeStringArray(preferredValues) : [];
}

function normalizeAtsArgument(value) {
  if (Array.isArray(value)) return normalizeStringArray(value);
  const single = String(value || "").trim();
  return single ? [single] : [];
}

// runQuery's contract is comma-separated term strings, shared with the /db/query route.
// Arrays are the honest MCP shape, so they are joined here -- which also means a term
// cannot itself contain a comma.
function buildQueryPostingsInput(args) {
  const joinTerms = (values) => normalizeStringArray(values).join(",");
  return {
    title_any: joinTerms(args?.title_any),
    title_all: joinTerms(args?.title_all),
    title_none: joinTerms(args?.title_none),
    company_any: joinTerms(args?.company_any),
    company_none: joinTerms(args?.company_none),
    location_any: joinTerms(args?.location_any),
    location_none: joinTerms(args?.location_none),
    ats: joinTerms(args?.ats),
    states: joinTerms(args?.states),
    countries: joinTerms(args?.countries),
    regions: joinTerms(args?.regions),
    pay_min: args?.pay_min,
    pay_max: args?.pay_max,
    has_pay: normalizeBoolean(args?.has_pay, false) ? "1" : "",
    seen_days: args?.seen_days,
    found_days: args?.found_days,
    visibility: args?.visibility || "all",
    sort: args?.sort,
    dir: args?.dir,
    limit: args?.limit
  };
}

// The label is what the app shows next to an ignored row, so it should say who decided
// and why, not just that an agent was here.
function buildIgnoredByLabel(agentName, reason) {
  const trimmedReason = String(reason || "").trim();
  return trimmedReason ? `${agentName}: ${trimmedReason}` : `${agentName} marked not a fit`;
}

async function findCandidates(options = {}) {
  const settings = await getMcpSettings();
  ensureMcpAgentEnabled(settings);

  const useSettings = normalizeBoolean(options.use_settings, true);
  const search = String(options.search || "").trim() || (useSettings ? settings.preferred_search : "");
  const remote = options.remote
    ? String(options.remote)
    : useSettings
      ? settings.preferred_remote
      : "all";
  const limit = Math.max(
    1,
    Math.min(
      MAX_CANDIDATE_LIMIT,
      parseNonNegativeInteger(options.limit) ||
        parseNonNegativeInteger(settings.max_applications_per_run) ||
        MCP_SETTINGS_DEFAULTS.max_applications_per_run
    )
  );

  const result = await listPostingsWithFilters({
    search,
    limit,
    offset: parseNonNegativeInteger(options.offset),
    sort_by: options.sort_by,
    ats: normalizeAtsArgument(options.ats),
    industries: resolveListFilter(options.industries, settings.preferred_industries, useSettings),
    compensation_types: normalizeStringArray(options.compensation_types),
    pay_periods: normalizeStringArray(options.pay_periods),
    pay_min: options.pay_min,
    pay_max: options.pay_max,
    education_levels: normalizeStringArray(options.education_levels),
    states: resolveListFilter(options.states, settings.preferred_states, useSettings),
    counties: resolveListFilter(options.counties, settings.preferred_counties, useSettings),
    countries: resolveListFilter(options.countries, settings.preferred_countries, useSettings),
    regions: resolveListFilter(options.regions, settings.preferred_regions, useSettings),
    remote,
    hide_no_date: normalizeBoolean(options.hide_no_date, false),
    include_applied: normalizeBoolean(options.include_applied, false),
    include_ignored: normalizeBoolean(options.include_ignored, false),
    // Descriptions are the bulk of the payload, and an agent that only needs to rank titles
    // and open URLs does not want them in its context. Opt in per call.
    include_descriptions: normalizeBoolean(options.include_descriptions, false)
  });

  return {
    filters: result.filters,
    settings_applied: useSettings,
    count: result.count,
    limit: result.limit,
    offset: result.offset,
    // The page is cut to `limit` before applied and ignored postings are dropped, so a full
    // page can come back short. Ask for the next page rather than reading a short one as
    // "nothing else matches".
    items: result.items
  };
}

async function resolveCompanyIdForApplication(companyName) {
  const normalized = normalizeLikeText(companyName);
  if (!normalized) return null;

  return db.get(
    `
      SELECT id
      FROM companies
      WHERE LOWER(company_name) = ?
      ORDER BY id ASC
      LIMIT 1;
    `,
    [normalized]
  );
}

async function resolveCompanyIdFromPostingUrl(jobPostingUrl) {
  const normalizedUrl = String(jobPostingUrl || "").trim();
  if (!normalizedUrl) return null;

  const posting = await db.get(
    `
      SELECT company_name
      FROM Postings
      WHERE job_posting_url = ?
      LIMIT 1;
    `,
    [normalizedUrl]
  );

  const normalizedCompanyName = normalizeLikeText(posting?.company_name);
  if (!normalizedCompanyName) return null;

  return db.get(
    `
      SELECT id
      FROM companies
      WHERE LOWER(company_name) = ?
      ORDER BY id ASC
      LIMIT 1;
    `,
    [normalizedCompanyName]
  );
}

async function getApplicationById(applicationId) {
  const row = await db.get(
    `
      SELECT
        a.id,
        a.company_id,
        c.company_name,
        a.position_name,
        a.application_date,
        a.status,
        attr.applied_by_type,
        attr.applied_by_label
      FROM applications a
      LEFT JOIN companies c
        ON c.id = a.company_id
      LEFT JOIN application_attribution attr
        ON attr.application_id = a.id
      WHERE a.id = ?
      LIMIT 1;
    `,
    [applicationId]
  );
  if (!row) return null;

  return {
    id: Number(row?.id || 0),
    company_id: Number(row?.company_id || 0),
    company_name: String(row?.company_name || "").trim(),
    position_name: String(row?.position_name || "").trim(),
    job_posting_url: "",
    application_date: Number(row?.application_date || 0),
    status: String(row?.status || "applied").trim().toLowerCase() || "applied",
    applied_by_type: normalizeAppliedByType(row?.applied_by_type),
    applied_by_label: normalizeAppliedByLabel(row?.applied_by_label, row?.applied_by_type)
  };
}

async function getExistingAppliedApplicationByPostingUrl(jobPostingUrl) {
  const normalizedUrl = String(jobPostingUrl || "").trim();
  if (!normalizedUrl) return null;

  const state = await db.get(
    `
      SELECT last_application_id
      FROM posting_application_state
      WHERE job_posting_url = ?
        AND COALESCE(applied, 0) = 1
      LIMIT 1;
    `,
    [normalizedUrl]
  );
  const lastApplicationId = parseNonNegativeInteger(state?.last_application_id);
  if (!lastApplicationId) return null;

  const existing = await getApplicationById(lastApplicationId);
  if (!existing) return null;
  return {
    ...existing,
    job_posting_url: normalizedUrl
  };
}

function asToolResult(payload) {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload
  };
}

async function createApplicationFromAgent(input) {
  const companyName = String(input?.company_name || "").trim();
  const positionName = String(input?.position_name || "").trim();
  const jobPostingUrl = String(input?.job_posting_url || "").trim();
  const appliedByLabel = String(input?.applied_by_label || "").trim() || "AI agent applied on behalf of user";
  const applicationDate = parseNonNegativeInteger(input?.application_date) || nowEpochSeconds();
  const status = String(input?.status || "applied").trim().toLowerCase() || "applied";

  if (jobPostingUrl) {
    const existing = await getExistingAppliedApplicationByPostingUrl(jobPostingUrl);
    if (existing) return existing;
  }

  const companyFromPosting = await resolveCompanyIdFromPostingUrl(jobPostingUrl);
  const company = companyFromPosting || (companyName ? await resolveCompanyIdForApplication(companyName) : null);
  if (!company?.id) {
    throw new Error(
      jobPostingUrl
        ? `Unable to resolve company_id for job_posting_url='${jobPostingUrl}'`
        : `Unable to resolve company_id for company_name='${companyName}'`
    );
  }

  await db.exec("BEGIN TRANSACTION;");
  try {
    const result = await db.run(
      `
        INSERT INTO applications (
          company_id,
          position_name,
          application_date,
          status
        ) VALUES (?, ?, ?, ?);
      `,
      [company.id, positionName, applicationDate, status]
    );

    await db.run(
      `
        INSERT INTO application_attribution (
          application_id,
          applied_by_type,
          applied_by_label,
          updated_at
        ) VALUES (?, ?, ?, datetime('now'))
        ON CONFLICT(application_id) DO UPDATE SET
          applied_by_type = excluded.applied_by_type,
          applied_by_label = excluded.applied_by_label,
          updated_at = datetime('now');
      `,
      [result.lastID, "agent", appliedByLabel]
    );

    if (jobPostingUrl) {
      await db.run(
        `
          INSERT INTO posting_application_state (
            job_posting_url,
            applied,
            applied_by_type,
            applied_by_label,
            applied_at_epoch,
            last_application_id,
            updated_at
          ) VALUES (?, 1, 'agent', ?, ?, ?, datetime('now'))
          ON CONFLICT(job_posting_url) DO UPDATE SET
            applied = 1,
            applied_by_type = 'agent',
            applied_by_label = excluded.applied_by_label,
            applied_at_epoch = excluded.applied_at_epoch,
            last_application_id = excluded.last_application_id,
            updated_at = datetime('now');
        `,
        [jobPostingUrl, appliedByLabel, applicationDate, result.lastID]
      );
    }

    await db.exec("COMMIT;");
    return {
      id: result.lastID,
      company_id: company.id,
      company_name: companyName,
      position_name: positionName,
      job_posting_url: jobPostingUrl,
      application_date: applicationDate,
      status,
      applied_by_type: "agent",
      applied_by_label: appliedByLabel
    };
  } catch (error) {
    await db.exec("ROLLBACK;");
    throw error;
  }
}

async function main() {
  await openDatabase();

  const mcpServer = new McpServer({
    name: "openpostings-apply-agent",
    version: "1.1.0"
  });

  mcpServer.registerTool(
    "get_applicant_context",
    {
      description: "Read applicantee information and MCP settings used by the apply agent."
    },
    async () => {
      const personalInformation = await getPersonalInformation();
      const mcpSettings = await getMcpSettings();
      ensureMcpAgentEnabled(mcpSettings);
      return asToolResult({
        personal_information: personalInformation,
        mcp_settings: mcpSettings,
        runbook: buildMcpRunbook(mcpSettings, personalInformation, [])
      });
    }
  );

  mcpServer.registerTool(
    "get_filter_options",
    {
      description:
        "List every value the find_posting_candidates filters accept: industry keys, ATS names, US states, counties, countries, regions, education levels, compensation types, pay periods and sort options. Call this before filtering -- an industry key or county value that does not appear here matches nothing rather than erroring. Counties are only returned when states is supplied, because the unscoped list runs to thousands of entries.",
      inputSchema: {
        states: z.array(z.string()).optional()
      }
    },
    async (args) => {
      const mcpSettings = await getMcpSettings();
      ensureMcpAgentEnabled(mcpSettings);
      const states = normalizeStringArray(args?.states);
      const options = await getPostingFilterOptions({ states });

      // No RAW: filtering here any more: getPostingFilterOptions only returns ISO countries,
      // so the app and the agent see the same list.
      return asToolResult({
        ...options,
        counties: states.length > 0 ? options.counties : [],
        counties_note:
          states.length > 0
            ? `Counties scoped to ${states.join(", ")}. Pass the value field ("ST|County Name"), not the label.`
            : "Counties omitted. Call again with states to get the counties for those states.",
        remote_options: MCP_REMOTE_FILTER_VALUES.map((value) => ({ value })),
        current_preferences: {
          search: mcpSettings.preferred_search,
          remote: mcpSettings.preferred_remote,
          industries: mcpSettings.preferred_industries,
          states: mcpSettings.preferred_states,
          counties: mcpSettings.preferred_counties,
          countries: mcpSettings.preferred_countries,
          regions: mcpSettings.preferred_regions
        }
      });
    }
  );

  mcpServer.registerTool(
    "find_posting_candidates",
    {
      description:
        "Find postings to apply to, using the same filter engine as the app's job list. Any filter left empty falls back to the saved MCP preference for it; pass use_settings=false to ignore saved preferences entirely. Applied and ignored postings are excluded by default. Job descriptions are omitted unless include_descriptions=true. Call get_filter_options for the valid values of the list filters.",
      inputSchema: {
        search: z.string().optional(),
        ats: z
          .union([z.enum(MCP_ATS_FILTER_VALUES), z.array(z.enum(MCP_ATS_FILTER_VALUES))])
          .optional(),
        industries: z.array(z.string()).optional(),
        compensation_types: z.array(z.enum(COMPENSATION_TYPES)).optional(),
        pay_periods: z.array(z.enum(COMPENSATION_PAY_PERIODS)).optional(),
        pay_min: z.number().positive().optional(),
        pay_max: z.number().positive().optional(),
        education_levels: z.array(z.enum(EDUCATION_LEVELS)).optional(),
        states: z.array(z.string()).optional(),
        counties: z.array(z.string()).optional(),
        countries: z.array(z.string()).optional(),
        regions: z.array(z.enum(MCP_REGION_FILTER_VALUES)).optional(),
        remote: z.enum(MCP_REMOTE_FILTER_VALUES).optional(),
        sort_by: z.enum(MCP_SORT_VALUES).optional(),
        hide_no_date: z.boolean().optional(),
        include_applied: z.boolean().optional(),
        include_ignored: z.boolean().optional(),
        include_descriptions: z.boolean().optional(),
        use_settings: z.boolean().optional(),
        limit: z.number().int().positive().max(MAX_CANDIDATE_LIMIT).optional(),
        offset: z.number().int().nonnegative().optional()
      }
    },
    async (args) => {
      const result = await findCandidates(args || {});
      return asToolResult(result);
    }
  );

  mcpServer.registerTool(
    "query_postings",
    {
      description:
        "Precision query over the raw Postings table, for questions find_posting_candidates cannot phrase: each *_any group ORs its terms, groups AND together, and *_none excludes -- so '(manager OR director) AND NOT (assistant OR shift), in WA, over 140k, still listed within 3 days' is one call. Terms are substring matches. Unlike find_posting_candidates this ignores saved preferences and the app's freshness window, and can see hidden postings via visibility. Rows carry applied/ignored flags but no descriptions; screen the shortlist with get_posting_details. When approximate=true the counts are a floor, not a total.",
      inputSchema: {
        title_any: z.array(z.string()).optional(),
        title_all: z.array(z.string()).optional(),
        title_none: z.array(z.string()).optional(),
        company_any: z.array(z.string()).optional(),
        company_none: z.array(z.string()).optional(),
        location_any: z.array(z.string()).optional(),
        location_none: z.array(z.string()).optional(),
        ats: z.array(z.enum(MCP_ATS_FILTER_VALUES)).optional(),
        states: z.array(z.string()).optional(),
        countries: z.array(z.string()).optional(),
        regions: z.array(z.enum(MCP_REGION_FILTER_VALUES)).optional(),
        pay_min: z.number().positive().optional(),
        pay_max: z.number().positive().optional(),
        has_pay: z.boolean().optional(),
        seen_days: z.number().positive().optional(),
        found_days: z.number().positive().optional(),
        visibility: z.enum(["visible", "hidden", "all"]).optional(),
        sort: z.enum(MCP_QUERY_SORT_VALUES).optional(),
        dir: z.enum(["asc", "desc"]).optional(),
        limit: z.number().int().positive().max(MAX_ROWS).optional()
      }
    },
    async (args) => {
      const mcpSettings = await getMcpSettings();
      ensureMcpAgentEnabled(mcpSettings);
      const result = await runQuery(buildQueryPostingsInput(args));
      const rows = await enrichPostingsWithApplicationState(result.rows);
      return asToolResult({
        total: result.total,
        visible: result.visible,
        shown: result.shown,
        limit: result.limit,
        approximate: result.approximate,
        sql: result.sql,
        rows
      });
    }
  );

  mcpServer.registerTool(
    "get_posting_details",
    {
      description:
        "Everything stored about the named postings: full job description, pay fields, education levels, ATS, hidden flag, sync timestamps, and applied/ignored state. This is the screening step between shortlisting and opening a browser -- read the description against the applicant's background and decide fit before spending a browser session. URLs not in the database are returned in missing.",
      inputSchema: {
        job_posting_urls: z.array(z.string()).min(1).max(20)
      }
    },
    async (args) => {
      const mcpSettings = await getMcpSettings();
      ensureMcpAgentEnabled(mcpSettings);
      const requested = normalizeStringArray(args?.job_posting_urls);
      const items = await getPostingsByUrls(requested);
      const foundUrls = new Set(items.map((item) => String(item?.job_posting_url || "").trim()));

      return asToolResult({
        count: items.length,
        items,
        missing: requested.filter((url) => !foundUrls.has(url))
      });
    }
  );

  mcpServer.registerTool(
    "ignore_posting",
    {
      description:
        "Mark postings as not a fit so neither find_posting_candidates nor a future run surfaces them again -- the durable form of 'screened and rejected'. Pass ignored=false to un-ignore. This writes tracking state only; it never touches the posting or any application record.",
      inputSchema: {
        job_posting_urls: z.array(z.string()).min(1).max(50),
        ignored: z.boolean().optional(),
        reason: z.string().optional()
      }
    },
    async (args) => {
      const mcpSettings = await getMcpSettings();
      ensureMcpAgentEnabled(mcpSettings);
      const ignored = normalizeBoolean(args?.ignored, true);
      const agentName =
        String(mcpSettings.preferred_agent_name || MCP_SETTINGS_DEFAULTS.preferred_agent_name).trim() ||
        MCP_SETTINGS_DEFAULTS.preferred_agent_name;
      const ignoredByLabel = buildIgnoredByLabel(agentName, args?.reason);

      const results = [];
      for (const jobPostingUrl of normalizeStringArray(args?.job_posting_urls)) {
        results.push(
          await setPostingIgnoredState({
            job_posting_url: jobPostingUrl,
            ignored,
            ignored_by_label: ignoredByLabel
          })
        );
      }

      return asToolResult({ count: results.length, ignored, items: results });
    }
  );

  mcpServer.registerTool(
    "get_resume",
    {
      description:
        "The applicant's actual resume text, extracted from the file configured in personal information (PDF, docx, txt or md). Read this once per run and weigh every posting description against it -- it is the ground truth that the profile fields summarize. document='projects_portfolio' reads the portfolio document instead. If extraction fails, the error explains why and returns file_path so a client with its own file tools can read it directly.",
      inputSchema: {
        document: z.enum(["resume", "projects_portfolio"]).optional()
      }
    },
    async (args) => {
      const mcpSettings = await getMcpSettings();
      ensureMcpAgentEnabled(mcpSettings);
      const personalInformation = await getPersonalInformation();
      const which = args?.document === "projects_portfolio" ? "projects_portfolio" : "resume";
      const filePath =
        which === "projects_portfolio"
          ? personalInformation?.projects_portfolio_file_path
          : personalInformation?.resume_file_path;

      const result = await extractDocumentText(filePath);
      return asToolResult({ document: which, ...result });
    }
  );

  mcpServer.registerTool(
    "list_applications",
    {
      description:
        "Application history with attribution -- who applied (user or agent) and when. Use it to avoid double-applying to a company, to report what a run accomplished, and to respect the per-run budget across sessions.",
      inputSchema: {
        status: z.string().optional(),
        limit: z.number().int().positive().max(2000).optional(),
        offset: z.number().int().nonnegative().optional()
      }
    },
    async (args) => {
      const mcpSettings = await getMcpSettings();
      ensureMcpAgentEnabled(mcpSettings);
      const result = await listApplications({
        status: args?.status,
        limit: args?.limit,
        offset: args?.offset
      });
      return asToolResult(result);
    }
  );

  mcpServer.registerTool(
    "draft_cover_letter",
    {
      description: "Generate a cover letter draft for a posting using applicantee information.",
      inputSchema: {
        company_name: z.string().optional(),
        position_name: z.string().optional(),
        job_posting_url: z.string().optional(),
        instructions: z.string().optional()
      }
    },
    async (args) => {
      const mcpSettings = await getMcpSettings();
      ensureMcpAgentEnabled(mcpSettings);
      const personalInformation = await getPersonalInformation();
      let companyName = String(args?.company_name || "").trim();
      let positionName = String(args?.position_name || "").trim();
      const jobPostingUrl = String(args?.job_posting_url || "").trim();

      if (jobPostingUrl && (!companyName || !positionName)) {
        const posting = await db.get(
          `
            SELECT company_name, position_name
            FROM Postings
            WHERE job_posting_url = ?
            LIMIT 1;
          `,
          [jobPostingUrl]
        );
        companyName = companyName || String(posting?.company_name || "").trim();
        positionName = positionName || String(posting?.position_name || "").trim();
      }

      const draft = buildCoverLetterDraft(
        personalInformation,
        {
          company_name: companyName,
          position_name: positionName,
          job_posting_url: jobPostingUrl
        },
        args?.instructions || mcpSettings.instructions_for_agent
      );

      return asToolResult({
        posting: {
          company_name: companyName,
          position_name: positionName,
          job_posting_url: jobPostingUrl
        },
        draft
      });
    }
  );

  mcpServer.registerTool(
    "record_application_result",
    {
      description:
        "Write a completed agent-driven application result into applications and posting application state tables.",
      inputSchema: {
        job_posting_url: z.string(),
        company_name: z.string().optional(),
        position_name: z.string().optional(),
        status: z.string().optional(),
        application_date: z.number().int().nonnegative().optional(),
        agent_name: z.string().optional(),
        commit: z.boolean().optional(),
        approved_by_user: z.boolean().optional()
      }
    },
    async (args) => {
      const mcpSettings = await getMcpSettings();
      ensureMcpAgentEnabled(mcpSettings);
      const commit = normalizeBoolean(args?.commit, false);
      const approvedByUser = normalizeBoolean(args?.approved_by_user, false);
      const jobPostingUrl = String(args?.job_posting_url || "").trim();
      const agentName =
        String(args?.agent_name || mcpSettings.preferred_agent_name || MCP_SETTINGS_DEFAULTS.preferred_agent_name)
          .trim() || MCP_SETTINGS_DEFAULTS.preferred_agent_name;

      if (!jobPostingUrl) {
        throw new Error("job_posting_url is required.");
      }

      const posting = await db.get(
        `
          SELECT company_name, position_name
          FROM Postings
          WHERE job_posting_url = ?
          LIMIT 1;
        `,
        [jobPostingUrl]
      );

      const companyName = String(args?.company_name || posting?.company_name || "").trim();
      const positionName = String(args?.position_name || posting?.position_name || "").trim();
      const status = String(args?.status || "applied").trim().toLowerCase() || "applied";
      const applicationDate = parseNonNegativeInteger(args?.application_date) || nowEpochSeconds();
      const appliedByLabel = `${agentName} applied on behalf of user`;

      if (!companyName || !positionName) {
        throw new Error("company_name and position_name are required (or must be resolvable from job_posting_url).");
      }

      if (!commit || mcpSettings.dry_run_only) {
        return asToolResult({
          committed: false,
          dry_run: true,
          reason: mcpSettings.dry_run_only ? "MCP settings are currently dry_run_only=true." : "commit=false",
          payload: {
            company_name: companyName,
            position_name: positionName,
            job_posting_url: jobPostingUrl,
            status,
            application_date: applicationDate,
            applied_by_label: appliedByLabel
          }
        });
      }

      if (mcpSettings.require_final_approval && !approvedByUser) {
        throw new Error("Final approval is required. Set approved_by_user=true to commit.");
      }

      const application = await createApplicationFromAgent({
        company_name: companyName,
        position_name: positionName,
        job_posting_url: jobPostingUrl,
        status,
        application_date: applicationDate,
        applied_by_label: appliedByLabel
      });

      return asToolResult({
        committed: true,
        application
      });
    }
  );

  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
}

module.exports = {
  findCandidates,
  resolveListFilter,
  normalizeAtsArgument,
  buildQueryPostingsInput,
  buildIgnoredByLabel,
  openDatabase
};

if (require.main === module) {
  main().catch((error) => {
    console.error("[openpostings-apply-agent] MCP server failed:", error);
    process.exit(1);
  });
}
