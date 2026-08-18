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
  normalizeAppliedByLabel,
  normalizeApplicationFit,
  APPLICATION_FIT_OPTIONS
} = require("./helpers/normalize-strings.js");
const { MCP_SETTINGS_DEFAULTS } = require("./helpers/normalize-mcp-settings.js");
const { setDb, runInWriteTransaction } = require("./services/runtime-context.js");
const { getMcpSettings, buildMcpRunbook } = require("./services/mcp.js");
const { buildCoverLetterDraft, buildCoverLetterBrief } = require("./services/cover-letter.js");
const { getPersonalInformation } = require("./services/personal-info.js");
const {
  listPostingsWithFilters,
  getPostingsByUrls,
  setPostingIgnoredState,
  enrichPostingsWithApplicationState
} = require("./services/postings.js");
const { listApplications } = require("./services/applications.js");
const { getMatchScoringStatus } = require("./services/posting-match.js");
const { ensureErrorLogTable, recordError } = require("./services/error-log.js");
const {
  ensureApplicationAnswersTable,
  getApplicationAnswerSummary,
  setApplicationAnswer
} = require("./services/application-answers.js");
const {
  extractDocumentText,
  getApplicantDocument,
  listApplicantDocuments,
  checkConfiguredDocumentPaths,
  normalizeDocumentKind
} = require("./services/applicant-documents.js");
const { runQuery, SORTABLE, MAX_ROWS } = require("./services/db-query.js");
const { getPostingFilterOptions } = require("./services/filter-options.js");
const { ensureSyncServiceSettingsTable, loadSyncServiceSettingsIntoRuntime } = require("./services/sync-settings.js");
const { ensurePostingReviewSchema } = require("./services/posting-review.js");

const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, "..", "jobs.db");

const MCP_ATS_FILTER_VALUES = Object.freeze(Array.from(ATS_FILTER_OPTIONS));
const MCP_REGION_FILTER_VALUES = Object.freeze(LOCATION_REGION_OPTIONS.map((option) => option.value));
const MCP_REMOTE_FILTER_VALUES = Object.freeze(["all", "remote", "hybrid", "non_remote"]);
const MCP_SORT_VALUES = Object.freeze(["recent", "company_asc", "match_desc"]);
const MCP_QUERY_SORT_VALUES = Object.freeze(Array.from(SORTABLE.keys()));
const MCP_FIT_ASSESSMENT_VALUES = Object.freeze(Array.from(APPLICATION_FIT_OPTIONS));
const MAX_CANDIDATE_LIMIT = 2000;

let db;

function ensureMcpAgentEnabled(settings) {
  if (normalizeBoolean(settings?.enabled, false)) return;
  throw new Error("MCP application copilot is disabled in settings.");
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

    CREATE TABLE IF NOT EXISTS application_status_history (
      id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      application_id INTEGER NOT NULL,
      previous_status TEXT,
      new_status TEXT NOT NULL,
      changed_at_epoch INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS McpSettings (
      id INTEGER NOT NULL PRIMARY KEY CHECK (id = 1),
      enabled INTEGER NOT NULL DEFAULT 0,
      preferred_agent_name TEXT NOT NULL DEFAULT 'OpenPostings Agent',
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
      review_state TEXT NOT NULL DEFAULT 'unseen',
      review_state_changed_at_epoch INTEGER,
      viewed_at_epoch INTEGER,
      shortlisted_at_epoch INTEGER,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    INSERT INTO McpSettings (
      id,
      enabled,
      preferred_agent_name,
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
    ) VALUES (1, 0, 'OpenPostings Agent', '', '', 1, 1, 10, '', 'all', '[]', '[]', '[]', '[]', '[]', '')
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
  await ensurePostingReviewSchema(db);
  // These columns used to hold the agent's login email and password in plaintext, handed
  // to the agent so it could create accounts and sign in as the user. That capability is
  // gone. SQLite before 3.35 cannot DROP COLUMN and the column may be NOT NULL, so the
  // values are overwritten with empty strings here and simply never read again -- which
  // also scrubs the secret from any database that already stored one.

  // An application records something that happened in the real world, so it must be
  // storable whether or not the employer is in the crawl table. It was not: company_id was
  // NOT NULL and had to point at a `companies` row matched by exact lowercase name, and
  // Amazon's postings carry legal entity names ("Amazon.com Services LLC", "Amazon Data
  // Services, Inc.") that have no such row -- nor does plain "Amazon". Submissions really
  // made were thrown away at the last step because of an internal join.
  //
  // company_name is denormalised onto the row so the employer survives regardless, and
  // company_id becomes optional. SQLite cannot drop a NOT NULL constraint, so the table is
  // rebuilt when the old one is still in place. Ids are preserved: application_attribution
  // and posting_application_state.last_application_id both reference them.
  const applicationColumns = await db.all(`PRAGMA table_info('applications');`);
  const applicationColumnNames = new Set(applicationColumns.map((column) => String(column?.name || "")));
  if (!applicationColumnNames.has("company_name")) {
    await db.exec(`ALTER TABLE applications ADD COLUMN company_name TEXT NOT NULL DEFAULT '';`);
  }
  // Mirrors server/index.js: recorded so the denial dashboard can pull a posting's
  // job_description back up, and so the agent's own submissions get the same history/JD-match
  // tracking as ones logged through the app.
  if (!applicationColumnNames.has("job_posting_url")) {
    await db.exec(`ALTER TABLE applications ADD COLUMN job_posting_url TEXT NOT NULL DEFAULT '';`);
  }
  if (!applicationColumnNames.has("fit_assessment")) {
    await db.exec(`ALTER TABLE applications ADD COLUMN fit_assessment TEXT NOT NULL DEFAULT '';`);
  }
  const companyIdIsRequired = applicationColumns.some(
    (column) => String(column?.name) === "company_id" && Number(column?.notnull) === 1
  );
  if (companyIdIsRequired) {
    await db.exec("BEGIN TRANSACTION;");
    try {
      await db.exec(`
        CREATE TABLE applications_migrated (
          id INTEGER NOT NULL PRIMARY KEY,
          company_id INTEGER,
          company_name TEXT NOT NULL DEFAULT '',
          position_name TEXT NOT NULL,
          application_date INTEGER NOT NULL,
          status TEXT,
          job_posting_url TEXT NOT NULL DEFAULT '',
          fit_assessment TEXT NOT NULL DEFAULT ''
        );
        INSERT INTO applications_migrated (id, company_id, company_name, position_name, application_date, status, job_posting_url, fit_assessment)
        SELECT a.id, a.company_id,
               CASE WHEN TRIM(COALESCE(a.company_name, '')) <> '' THEN a.company_name
                    ELSE COALESCE(c.company_name, '') END,
               a.position_name, a.application_date, a.status,
               COALESCE(a.job_posting_url, ''), COALESCE(a.fit_assessment, '')
        FROM applications a
        LEFT JOIN companies c ON c.id = a.company_id;
        DROP TABLE applications;
        ALTER TABLE applications_migrated RENAME TO applications;
      `);
      await db.exec("COMMIT;");
    } catch (error) {
      await db.exec("ROLLBACK;");
      throw error;
    }
  }

  // Same backfill as server/index.js, repeated here because this process can open the
  // database independently of (and potentially before) the API server.
  await db.run(`
    INSERT INTO application_status_history (application_id, previous_status, new_status, changed_at_epoch)
    SELECT a.id, NULL, COALESCE(a.status, 'applied'), a.application_date
    FROM applications a
    WHERE NOT EXISTS (
      SELECT 1 FROM application_status_history h WHERE h.application_id = a.id
    );
  `);
  await db.run(`
    UPDATE applications
    SET job_posting_url = (
      SELECT p.job_posting_url
      FROM posting_application_state p
      WHERE p.last_application_id = applications.id
      LIMIT 1
    )
    WHERE TRIM(COALESCE(job_posting_url, '')) = ''
      AND EXISTS (
        SELECT 1 FROM posting_application_state p WHERE p.last_application_id = applications.id
      );
  `);

  if (mcpSettingsColumnNames.has("agent_login_password")) {
    await db.run(`UPDATE McpSettings SET agent_login_password = '' WHERE agent_login_password <> '';`);
  }
  if (mcpSettingsColumnNames.has("agent_login_email")) {
    await db.run(`UPDATE McpSettings SET agent_login_email = '' WHERE agent_login_email <> '';`);
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

  // The query tools read the structured location and liveness columns, so a database the
  // API server has not upgraded yet must still gain them here or every query errors.
  // Mirrors ensurePostingsTable in server/index.js.
  const postingsColumns = await db.all(`PRAGMA table_info('Postings');`);
  if (postingsColumns.length > 0) {
    const postingsColumnNames = new Set(postingsColumns.map((column) => String(column?.name || "")));
    const postingsMigrations = [
      ["city", "ALTER TABLE Postings ADD COLUMN city TEXT;"],
      ["state_region", "ALTER TABLE Postings ADD COLUMN state_region TEXT;"],
      ["country", "ALTER TABLE Postings ADD COLUMN country TEXT;"],
      ["is_remote", "ALTER TABLE Postings ADD COLUMN is_remote INTEGER NOT NULL DEFAULT 0;"],
      ["locations_json", "ALTER TABLE Postings ADD COLUMN locations_json TEXT;"],
      ["hiring_locations_json", "ALTER TABLE Postings ADD COLUMN hiring_locations_json TEXT;"],
      ["location_conflict", "ALTER TABLE Postings ADD COLUMN location_conflict INTEGER NOT NULL DEFAULT 0;"],
      ["description_fetched_at", "ALTER TABLE Postings ADD COLUMN description_fetched_at INTEGER;"],
      ["status", "ALTER TABLE Postings ADD COLUMN status TEXT NOT NULL DEFAULT 'unverified';"],
      ["dead_since_epoch", "ALTER TABLE Postings ADD COLUMN dead_since_epoch INTEGER;"],
      ["requires_account", "ALTER TABLE Postings ADD COLUMN requires_account INTEGER;"],
      ["hidden_reason", "ALTER TABLE Postings ADD COLUMN hidden_reason TEXT NOT NULL DEFAULT '';"]
    ];
    for (const [columnName, ddl] of postingsMigrations) {
      if (!postingsColumnNames.has(columnName)) await db.exec(ddl);
    }
  }
}

async function openDatabase() {
  db = await open({
    filename: DB_PATH,
    driver: sqlite3.Database
  });
  // The API server writes to this same file, hardest in the minutes after its own restart
  // when a fresh sync pass is committing constantly -- which is exactly when an MCP client
  // tends to (re)connect. SQLite's default is to fail a locked write immediately, so the
  // DDL below died with SQLITE_BUSY at startup and the client reported the whole server as
  // failed. Waiting is the right behavior; 15s comfortably outlasts a sync commit.
  await db.exec("PRAGMA busy_timeout = 15000;");
  // The shared services read their handle from the runtime context rather than taking one.
  setDb(db);
  await ensureTables();
  // Freshness and enabled-ATS live in the sync settings, and listPostingsWithFilters applies
  // the freshness window from process state. Without this the agent would silently use the
  // default window instead of the one configured for this instance.
  await ensureSyncServiceSettingsTable();
  await loadSyncServiceSettingsIntoRuntime();
  // Seeds the standard screening questions so get_application_answers can report what is
  // still unanswered even on a database the API server has not started against yet.
  await ensureApplicationAnswersTable();
  await ensureErrorLogTable();
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
    description_any: joinTerms(args?.description_any),
    description_none: joinTerms(args?.description_none),
    location_any: joinTerms(args?.location_any),
    location_none: joinTerms(args?.location_none),
    remote_only: normalizeBoolean(args?.remote_only, false) ? "1" : "",
    ats: joinTerms(args?.ats),
    states: joinTerms(args?.states),
    countries: joinTerms(args?.countries),
    regions: joinTerms(args?.regions),
    pay_min: args?.pay_min,
    pay_max: args?.pay_max,
    include_unknown_pay: normalizeBoolean(args?.include_unknown_pay, true) ? "1" : "0",
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
    resume_key: normalizeDocumentKind(options.resume),
    ats: normalizeAtsArgument(options.ats),
    industries: resolveListFilter(options.industries, settings.preferred_industries, useSettings),
    compensation_types: normalizeStringArray(options.compensation_types),
    pay_periods: normalizeStringArray(options.pay_periods),
    pay_min: options.pay_min,
    pay_max: options.pay_max,
    include_unknown_pay: normalizeBoolean(options.include_unknown_pay, true),
    education_levels: normalizeStringArray(options.education_levels),
    states: resolveListFilter(options.states, settings.preferred_states, useSettings),
    counties: resolveListFilter(options.counties, settings.preferred_counties, useSettings),
    countries: resolveListFilter(options.countries, settings.preferred_countries, useSettings),
    regions: resolveListFilter(options.regions, settings.preferred_regions, useSettings),
    remote,
    hide_no_date: normalizeBoolean(options.hide_no_date, false),
    include_applied: normalizeBoolean(options.include_applied, false),
    include_ignored: normalizeBoolean(options.include_ignored, false),
    include_dead: normalizeBoolean(options.include_dead, false),
    include_stale_dated: normalizeBoolean(options.include_stale_dated, false),
    cities: normalizeStringArray(options.cities),
    // Descriptions are the bulk of the payload, and an agent that only needs to rank titles
    // and open URLs does not want them in its context. Opt in per call.
    include_descriptions: normalizeBoolean(options.include_descriptions, false),
    // Resume-match fields cost nothing extra once sort_by=match_desc or min_match_percent
    // has already forced the join (see needsMatchJoin in listPostingsWithFilters), so they
    // are included whenever either of those is set, same as the app's own list view.
    include_match: normalizeBoolean(options.include_match, options.sort_by === "match_desc" || options.min_match_percent !== undefined),
    min_match_percent: options.min_match_percent
  });

  return {
    filters: result.filters,
    settings_applied: useSettings,
    count: result.count,
    pay_unknown_count: result.pay_unknown_count,
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
  const fitAssessment = normalizeApplicationFit(input?.fit_assessment);

  if (jobPostingUrl) {
    const existing = await getExistingAppliedApplicationByPostingUrl(jobPostingUrl);
    if (existing) return existing;
  }

  const companyFromPosting = await resolveCompanyIdFromPostingUrl(jobPostingUrl);
  const company = companyFromPosting || (companyName ? await resolveCompanyIdForApplication(companyName) : null);

  // Deliberately not fatal. Refusing to record a submission because the employer is absent
  // from the crawl table loses the one fact worth keeping -- and it lost every Amazon
  // application, whose postings carry legal entity names no companies row matches.
  const postingRow = jobPostingUrl
    ? await db.get(`SELECT company_name FROM Postings WHERE job_posting_url = ? LIMIT 1;`, [jobPostingUrl])
    : null;
  const resolvedCompanyName =
    String(company?.company_name || "").trim() ||
    String(postingRow?.company_name || "").trim() ||
    companyName ||
    "";
  if (!resolvedCompanyName) {
    throw new Error("record_application_result needs a company_name, or a job_posting_url that resolves to one.");
  }

  const application = await runInWriteTransaction(async (handle) => {
    const result = await handle.run(
      `
        INSERT INTO applications (
          company_id,
          company_name,
          position_name,
          application_date,
          status,
          job_posting_url,
          fit_assessment
        ) VALUES (?, ?, ?, ?, ?, ?, ?);
      `,
      [company?.id ?? null, resolvedCompanyName, positionName, applicationDate, status, jobPostingUrl, fitAssessment]
    );

    await handle.run(
      `
        INSERT INTO application_status_history (
          application_id,
          previous_status,
          new_status,
          changed_at_epoch
        ) VALUES (?, NULL, ?, ?);
      `,
      [result.lastID, status, applicationDate]
    );

    await handle.run(
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
      await handle.run(
        `
          INSERT INTO posting_application_state (
            job_posting_url,
            applied,
            applied_by_type,
            applied_by_label,
            applied_at_epoch,
            last_application_id,
            review_state,
            review_state_changed_at_epoch,
            viewed_at_epoch,
            ignored,
            ignored_at_epoch,
            ignored_by_label,
            updated_at
          ) VALUES (?, 1, 'agent', ?, ?, ?, 'viewed', ?, ?, 0, NULL, '', datetime('now'))
          ON CONFLICT(job_posting_url) DO UPDATE SET
            applied = 1,
            applied_by_type = 'agent',
            applied_by_label = excluded.applied_by_label,
            applied_at_epoch = excluded.applied_at_epoch,
            last_application_id = excluded.last_application_id,
            review_state = CASE WHEN posting_application_state.review_state = 'shortlisted'
              THEN 'shortlisted' ELSE 'viewed' END,
            review_state_changed_at_epoch = CASE WHEN posting_application_state.review_state = 'shortlisted'
              THEN posting_application_state.review_state_changed_at_epoch ELSE excluded.review_state_changed_at_epoch END,
            viewed_at_epoch = COALESCE(posting_application_state.viewed_at_epoch, excluded.viewed_at_epoch),
            ignored = 0,
            ignored_at_epoch = NULL,
            ignored_by_label = '',
            updated_at = datetime('now');
        `,
        [jobPostingUrl, appliedByLabel, applicationDate, result.lastID, applicationDate, applicationDate]
      );
    }

    return {
      id: result.lastID,
      // Null when the employer is not in the crawl table, which is now a normal outcome
      // rather than a failure. resolvedCompanyName is the name that was actually stored.
      company_id: company?.id ?? null,
      company_name: resolvedCompanyName,
      position_name: positionName,
      job_posting_url: jobPostingUrl,
      application_date: applicationDate,
      status,
      fit_assessment: fitAssessment,
      applied_by_type: "agent",
      applied_by_label: appliedByLabel
    };
  });

  return application;
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
      description:
        "Read applicantee information, MCP settings and the run playbook. Also lists the stored documents and the state of any file paths configured for them, so an unreadable document is known up front rather than surfacing as an error part-way through drafting an application. match_scoring reports the background match-index job's progress per resume key -- check it before trusting find_posting_candidates' match_scores/match_percent, since a freshly uploaded resume is scored incrementally against the whole corpus and can take a while to catch up (caught_up: false, pending_count > 0) rather than being wrong or broken. Contains no credentials: the agent prepares applications and hands off at the authentication boundary."
    },
    async () => {
      const personalInformation = await getPersonalInformation();
      const mcpSettings = await getMcpSettings();
      ensureMcpAgentEnabled(mcpSettings);
      const documents = await listApplicantDocuments();
      const configuredPaths = await checkConfiguredDocumentPaths();
      const answers = await getApplicationAnswerSummary();
      const matchScoring = await getMatchScoringStatus();
      return asToolResult({
        personal_information: personalInformation,
        mcp_settings: mcpSettings,
        documents,
        document_keys: documents.map((document) => document.key),
        // Which form questions are already answered and which still need asking. Read in
        // full with get_application_answers before filling anything in.
        application_answers: {
          answered_count: answers.answered_count,
          unanswered_count: answers.unanswered_count,
          unanswered: answers.unanswered,
          contract: answers.contract
        },
        // Only the entries that are actually a problem: a path that cannot be read and
        // whose document has not been uploaded either.
        unreadable_documents: configuredPaths.filter((entry) => !entry.readable && !entry.uploaded),
        // last_run_at/scored_count/pending_count per resume key -- see the tool description.
        match_scoring: matchScoring,
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
        "Find postings to prepare, using the same filter engine as the app's job list. Any filter left empty falls back to the saved MCP preference for it; pass use_settings=false to ignore saved preferences entirely. Applied, ignored and dead postings are excluded by default (include_dead=true to see verified-gone ones). Postings hidden only because their posting date is older than the freshness window are excluded too but remain applyable -- include_stale_dated=true brings them back. Rows carry canonical freshness, confidence and review state alongside compatibility fields such as hidden_reason and ignored. Pay ranges keep postings with no published pay figure -- pay_unknown_count reports how many -- unless include_unknown_pay=false. Rows carry location_conflict, which flags a posting whose description restricts hiring to fewer places than its header lists. Job descriptions are omitted unless include_descriptions=true. Use cities for city-level targeting: values are City|ST (get_filter_options lists them per state, busiest first) and they match parsed locations, so Kent|WA cannot return Kent in England or anything in Kentucky. Call get_filter_options for the valid values of the list filters. sort_by=match_desc ranks by match_percent against a resume; resume picks which uploaded resume drives that ranking and min_match_percent (default 'resume' -- pass e.g. resume='resume_secondary' to rank/filter by a different one). A background job scores every posting with a stored description against every uploaded resume, incrementally -- a freshly uploaded resume is scored against the whole corpus over time, not instantly, so check get_applicant_context's match_scoring field (per-resume scored_count/pending_count/caught_up) before assuming a resume with few or no scores yet is a bad fit rather than simply not caught up. Every row's match_scores carries every uploaded resume's {match_status, match_available, match_percent, match_overlap_terms, match_unmatched_requirements} keyed by resume key, so a call can compare fit against both at once; the top-level match_percent/match_overlap_terms/match_unmatched_requirements fields mirror the resume that was picked. match_status is one of: 'scored' (match_percent is trustworthy), 'no_requirements_detected' (scored, but the description had no parseable requirements section -- match_percent is null, not zero), 'pending' (not yet reached by the background job -- match_percent is null, not a low score), or 'no_description' (nothing to score against). match_available is true only for 'scored'. min_match_percent filters to postings scored at or above a threshold against that same picked resume, and unscored/no-requirements postings never pass it. match_percent measures literal shared vocabulary in the requirements section against the resume, not semantic role fit -- a real fit phrased in different words can still score modestly; find_similar_postings (BM25 over the whole description) is the better tool for cross-vocabulary discovery, this is better for flagging hard, named requirement gaps.",
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
        include_unknown_pay: z.boolean().optional(),
        education_levels: z.array(z.enum(EDUCATION_LEVELS)).optional(),
        states: z.array(z.string()).optional(),
        counties: z.array(z.string()).optional(),
        countries: z.array(z.string()).optional(),
        regions: z.array(z.enum(MCP_REGION_FILTER_VALUES)).optional(),
        remote: z.enum(MCP_REMOTE_FILTER_VALUES).optional(),
        sort_by: z.enum(MCP_SORT_VALUES).optional(),
        resume: z.string().optional(),
        min_match_percent: z.number().min(0).max(100).optional(),
        hide_no_date: z.boolean().optional(),
        include_applied: z.boolean().optional(),
        include_ignored: z.boolean().optional(),
        include_dead: z.boolean().optional(),
        include_stale_dated: z.boolean().optional(),
        cities: z.array(z.string()).optional(),
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
        "Precision query over the raw Postings table, for questions find_posting_candidates cannot phrase: each *_any group ORs its terms, groups AND together, and *_none excludes -- so '(manager OR director) AND NOT (assistant OR shift), in WA, over 140k, still listed within 3 days' is one call. Title and company terms are substring matches. location_any terms name cities and match the posting's parsed locations, optionally qualified as 'City, ST' or 'City, ST, US' -- 'Kent, WA' cannot match Kent, England or Kentucky. Use remote_only=true for remote roles rather than a location term. Unlike find_posting_candidates this ignores saved preferences and the app's freshness window, and can see hidden postings via visibility -- and visibility distinguishes why a posting is hidden: 'stale_dated' is still listed by the employer but older than the freshness window (so still applyable), 'delisted' means the ATS stopped listing it, and 'open' returns both visible and stale-dated. Most rows carry no pay figure, so pay_min/pay_max keep unknown-pay rows by default (pay_unknown_count reports how many); pass include_unknown_pay=false or has_pay=true to demand a confirmed figure. Rows carry applied/ignored flags but no descriptions; screen the shortlist with get_posting_details. When approximate=true the counts are a floor, not a total.",
      inputSchema: {
        title_any: z.array(z.string()).optional(),
        title_all: z.array(z.string()).optional(),
        title_none: z.array(z.string()).optional(),
        company_any: z.array(z.string()).optional(),
        company_none: z.array(z.string()).optional(),
        description_any: z.array(z.string()).optional(),
        description_none: z.array(z.string()).optional(),
        location_any: z.array(z.string()).optional(),
        location_none: z.array(z.string()).optional(),
        remote_only: z.boolean().optional(),
        ats: z.array(z.enum(MCP_ATS_FILTER_VALUES)).optional(),
        states: z.array(z.string()).optional(),
        countries: z.array(z.string()).optional(),
        regions: z.array(z.enum(MCP_REGION_FILTER_VALUES)).optional(),
        pay_min: z.number().positive().optional(),
        pay_max: z.number().positive().optional(),
        include_unknown_pay: z.boolean().optional(),
        has_pay: z.boolean().optional(),
        seen_days: z.number().positive().optional(),
        found_days: z.number().positive().optional(),
        visibility: z.enum(["visible", "hidden", "all", "open", "stale_dated", "delisted"]).optional(),
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
        pay_unknown_count: result.pay_unknown_count,
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
        "Everything stored about the named postings: canonical freshness and data confidence, review state, full job description, pay fields, parsed locations, hiring-location restrictions (location_conflict flags a header/body disagreement), liveness status, requires_account, education levels, ATS, sync timestamps, and applied/ignored compatibility state. When a posting has no stored description it is fetched from the posting page on the spot and persisted (pass fetch_missing=false to skip the network). This is the screening step between shortlisting and handing work to an external browser-capable agent. URLs not in the database are returned in missing.",
      inputSchema: {
        job_posting_urls: z.array(z.string()).min(1).max(20),
        fetch_missing: z.boolean().optional()
      }
    },
    async (args) => {
      const mcpSettings = await getMcpSettings();
      ensureMcpAgentEnabled(mcpSettings);
      const requested = normalizeStringArray(args?.job_posting_urls);
      let items = await getPostingsByUrls(requested);

      // Screening needs the description, and most board listings never carried one. A
      // shortlist call is exactly the moment the page is worth one fetch each; results
      // are persisted so the cost is paid once.
      if (normalizeBoolean(args?.fetch_missing, true)) {
        const { refreshPostingFromPage } = require("./services/posting-page-fetcher.js");
        const pending = items.filter(
          (item) => !String(item?.job_description || "").trim() && item?.status !== "dead"
        );
        if (pending.length > 0) {
          const rows = await Promise.all(
            pending.map((item) =>
              db.get(
                `SELECT id, job_posting_url, locations_json, pay_min, pay_max
                 FROM Postings WHERE id = ?;`,
                [item.id]
              )
            )
          );
          await Promise.all(
            rows.filter(Boolean).map((row) => refreshPostingFromPage(row).catch(() => null))
          );
          items = await getPostingsByUrls(requested);
        }
      }
      const foundUrls = new Set(items.map((item) => String(item?.job_posting_url || "").trim()));

      return asToolResult({
        count: items.length,
        items,
        missing: requested.filter((url) => !foundUrls.has(url))
      });
    }
  );

  mcpServer.registerTool(
    "get_application_answers",
    {
      description:
        "The applicant's stored answers to the questions application forms ask -- work authorization, sponsorship, salary expectation, notice period, relocation, and the rest. Read this before filling any form. Questions come back split into `answers` (stored, safe to use as written) and `unanswered` (empty). An unanswered question must be put to the user and its answer recorded with set_application_answer; it must never be inferred from the resume, guessed from the posting, carried over from a similar application, or left as a plausible-looking placeholder. A wrong answer here is submitted under the applicant's name and cannot be retracted."
    },
    async () => {
      const mcpSettings = await getMcpSettings();
      ensureMcpAgentEnabled(mcpSettings);
      return asToolResult(await getApplicationAnswerSummary());
    }
  );

  mcpServer.registerTool(
    "set_application_answer",
    {
      description:
        "Record an answer the user has explicitly given, so the next application does not have to ask again. Only for values the user actually stated in conversation or confirmed -- this is a memory of what they said, not a place to persist an inference. If you did not hear it from them, ask instead of writing. Use the key from get_application_answers where one fits; a new slug creates a custom question.",
      inputSchema: {
        key: z.string(),
        value: z.string(),
        notes: z.string().optional(),
        label: z.string().optional(),
        category: z.string().optional()
      }
    },
    async (args) => {
      const mcpSettings = await getMcpSettings();
      ensureMcpAgentEnabled(mcpSettings);
      return asToolResult(
        await setApplicationAnswer({
          key: args?.key,
          value: args?.value,
          notes: args?.notes,
          label: args?.label,
          category: args?.category
        })
      );
    }
  );

  mcpServer.registerTool(
    "find_similar_postings",
    {
      description:
        "Rank postings by how closely their description matches a body of text -- a resume, a paragraph describing the work someone wants, or another posting. This is the tool for cross-industry discovery: keyword filters can only find titles you already guessed, so an operations leader searching operations-leadership titles never sees 'Manager, Local Markets Growth'. Pass text, or job_posting_url/posting_id to find roles like an existing one. Ranking is BM25 over the stored descriptions, so it matches on shared vocabulary weighted by rarity rather than on titles; only postings with a stored description can be returned, and relevance is higher-is-better.",
      inputSchema: {
        text: z.string().optional(),
        job_posting_url: z.string().optional(),
        posting_id: z.number().int().positive().optional(),
        limit: z.number().int().positive().max(200).optional(),
        include_dead: z.boolean().optional(),
        include_hidden: z.boolean().optional()
      }
    },
    async (args) => {
      const mcpSettings = await getMcpSettings();
      ensureMcpAgentEnabled(mcpSettings);
      const { findSimilarPostings } = require("./services/semantic-search.js");
      const result = await findSimilarPostings({
        text: args?.text,
        job_posting_url: args?.job_posting_url,
        posting_id: args?.posting_id,
        limit: args?.limit,
        include_dead: normalizeBoolean(args?.include_dead, false),
        include_hidden: normalizeBoolean(args?.include_hidden, false)
      });
      const rows = await enrichPostingsWithApplicationState(result.items);
      return asToolResult({ ...result, items: rows });
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
        "The text of one of the applicant's stored documents. Read the relevant one once per run and weigh every posting description against it -- it is the ground truth that the profile fields summarize. Documents are an open-ended keyed set, so several tailored resumes can coexist (for example resume_secondary, resume_hospitality, resume_ops) and each application can be drafted from the variant matching the target role. Any key starting with 'resume' is picked up automatically by the background match-scoring scan (see find_posting_candidates' resume argument and match_scores field), no code change needed -- but scoring the whole corpus against a newly uploaded resume takes time, it is not instant, so check get_applicant_context's match_scoring field for that resume's scored/pending counts before treating a thin result as a bad fit. Call with no document key to list the available keys without returning any text. Served from the copy uploaded into the database (POST /settings/applicant-documents), which works no matter where this server runs; the conventional keys 'resume' and 'projects_portfolio' fall back to the file paths in personal information for same-machine installs.",
      inputSchema: {
        document: z.string().optional()
      }
    },
    async (args) => {
      const mcpSettings = await getMcpSettings();
      ensureMcpAgentEnabled(mcpSettings);
      const available = await listApplicantDocuments();

      const requested = String(args?.document || "").trim();
      if (!requested) {
        return asToolResult({
          ok: true,
          documents: available,
          document_keys: available.map((document) => document.key),
          note:
            available.length > 0
              ? "Call again with document=<key> to read one. Text is omitted here on purpose."
              : "No documents uploaded yet. Upload one via POST /settings/applicant-documents."
        });
      }

      const which = normalizeDocumentKind(requested);
      if (!which) {
        return asToolResult({
          ok: false,
          error: `'${requested}' is not a valid document key.`,
          document_keys: available.map((document) => document.key)
        });
      }

      const stored = await getApplicantDocument(which);
      if (stored) {
        return asToolResult({ document: which, source: "database", ok: true, ...stored });
      }

      // Only the two conventional keys have a configured file-path fallback; a custom key
      // exists solely as an upload.
      const personalInformation = await getPersonalInformation();
      const filePath =
        which === "projects_portfolio"
          ? personalInformation?.projects_portfolio_file_path
          : which === "resume"
            ? personalInformation?.resume_file_path
            : "";

      if (!filePath) {
        return asToolResult({
          ok: false,
          document: which,
          error: `No document is stored under the key '${which}'.`,
          document_keys: available.map((document) => document.key)
        });
      }

      const result = await extractDocumentText(filePath);
      if (!result.ok) {
        result.error += " To make the document permanently available to this server, upload it once via POST /settings/applicant-documents.";
      }
      return asToolResult({ document: which, source: "file", ...result });
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
      description:
        "Assemble the material for a cover letter and a scaffold to write it into. Returns `brief`: the posting's own responsibilities and requirements, the vocabulary it emphasises that the resume also uses, specific resume lines worth citing (resume_evidence), and -- importantly -- requirements the resume does not support (unmatched_requirements), which must not be claimed. `draft` is a scaffold with {{slots}} to replace, not a finished letter: write the letter yourself from the brief, citing real experience rather than restating the posting. Pass document=<key> to work from a specific resume variant (get_resume lists the keys). The posting's description is fetched on demand if it has not been stored.",
      inputSchema: {
        company_name: z.string().optional(),
        position_name: z.string().optional(),
        job_posting_url: z.string().optional(),
        document: z.string().optional(),
        fetch_missing: z.boolean().optional(),
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

      const documentKey = normalizeDocumentKind(args?.document || "resume");
      const sourceDocument = documentKey ? await getApplicantDocument(documentKey) : null;

      // The description is what makes a letter about this job rather than any job. Fetch
      // it on demand when it has not been stored yet -- a letter written without it is
      // the generic template this tool used to produce.
      let description = "";
      if (jobPostingUrl) {
        const [posting] = await getPostingsByUrls([jobPostingUrl]);
        description = String(posting?.job_description || "").trim();
        if (!description && normalizeBoolean(args?.fetch_missing, true)) {
          const row = await db.get(
            `SELECT id, job_posting_url, locations_json, pay_min, pay_max
             FROM Postings WHERE job_posting_url = ? LIMIT 1;`,
            [jobPostingUrl]
          );
          if (row) {
            const { refreshPostingFromPage } = require("./services/posting-page-fetcher.js");
            await refreshPostingFromPage(row).catch(() => null);
            const [refreshed] = await getPostingsByUrls([jobPostingUrl]);
            description = String(refreshed?.job_description || "").trim();
          }
        }
      }

      const brief = buildCoverLetterBrief({
        description,
        resume_text: sourceDocument?.text || "",
        posting: { company_name: companyName, position_name: positionName }
      });

      const draft = buildCoverLetterDraft(
        personalInformation,
        {
          company_name: companyName,
          position_name: positionName,
          job_posting_url: jobPostingUrl
        },
        args?.instructions || mcpSettings.instructions_for_agent,
        brief
      );

      return asToolResult({
        posting: {
          company_name: companyName,
          position_name: positionName,
          job_posting_url: jobPostingUrl
        },
        // The material to write from: what the posting asks for, where the resume
        // genuinely speaks to it, and which requirements it does not.
        brief,
        source_document: sourceDocument
          ? {
              key: sourceDocument.key,
              label: sourceDocument.label,
              file_name: sourceDocument.file_name,
              chars: sourceDocument.chars,
              text: sourceDocument.text
            }
          : null,
        source_document_error: sourceDocument
          ? ""
          : `No document stored under key '${args?.document || "resume"}'. Call get_resume with no argument to list available keys.`,
        draft
      });
    }
  );

  mcpServer.registerTool(
    "record_application_result",
    {
      description:
        `Write a completed agent-driven application result into applications and posting application state tables. Include fit_assessment (${MCP_FIT_ASSESSMENT_VALUES.join(", ")}) every time -- weigh the posting's requirements against the resume the same way draft_cover_letter's brief does (resume_evidence supports it, unmatched_requirements argue against it) and record that judgment now, while the comparison is fresh. Left blank, the application is stored as not yet assessed and someone has to redo the comparison later from memory.`,
      inputSchema: {
        job_posting_url: z.string(),
        company_name: z.string().optional(),
        position_name: z.string().optional(),
        status: z.string().optional(),
        fit_assessment: z.enum(MCP_FIT_ASSESSMENT_VALUES).optional(),
        application_date: z.number().int().nonnegative().optional(),
        agent_name: z.string().optional(),
        commit: z.boolean().optional(),
        approved_by_user: z.boolean().optional()
      }
    },
    async (args) => {
      // Wrapped as a whole, not around the insert alone. Once commit is requested the
      // application has generally already been sent to the employer, so *every* way this
      // handler can fail past that point loses a real fact -- validation that rejects an
      // unresolvable posting is as much a loss as a failed insert, and the first attempt at
      // this only guarded the insert and so recorded nothing for exactly that case.
      try {
        return await recordApplicationResult(args);
      } catch (error) {
        if (normalizeBoolean(args?.commit, false)) {
          await recordError({
            source: "mcp",
            operation: "record_application_result",
            message: `Application may have been submitted but could not be logged: ${String(error?.message || error)}`,
            // Enough to re-enter the application by hand from the notice alone.
            context: {
              company_name: args?.company_name || null,
              position_name: args?.position_name || null,
              job_posting_url: args?.job_posting_url || null,
              status: args?.status || "applied"
            }
          });
        }
        throw error;
      }
    }
  );

  async function recordApplicationResult(args) {
    {
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
      const fitAssessment = normalizeApplicationFit(args?.fit_assessment);
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
            fit_assessment: fitAssessment,
            application_date: applicationDate,
            applied_by_label: appliedByLabel
          }
        });
      }

      if (mcpSettings.require_final_approval && !approvedByUser) {
        throw new Error("Final approval is required. Set approved_by_user=true to commit.");
      }

      // The submission has already happened by the time this runs -- the agent filled the
      // form and the employer accepted it. If the write fails, the fact is only recoverable
      // from whatever the agent happens to say next, which is how a set of Amazon
      // applications went unrecorded with nothing but a sentence in a chat log to show for
      // it. Record the failure durably first, then rethrow so the caller still sees it.
      const application = await createApplicationFromAgent({
        company_name: companyName,
        position_name: positionName,
        job_posting_url: jobPostingUrl,
        status,
        fit_assessment: fitAssessment,
        application_date: applicationDate,
        applied_by_label: appliedByLabel
      });

      return asToolResult({
        committed: true,
        application
      });
    }
  }

  // StdioServerTransport only listens for 'data' and 'error' on stdin, never 'close' or
  // 'end' -- so when the MCP client disconnects (its end of the pipe closes), this process
  // never notices and just keeps running with jobs.db held open. Every reconnect from a
  // client left a fresh orphan behind, and those orphans piled up as independent SQLite
  // connections to the same file, contending with the live server for locks and stalling
  // its queries. Watching stdin ourselves is the only way to actually exit on disconnect.
  process.stdin.on("end", () => process.exit(0));
  process.stdin.on("close", () => process.exit(0));

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
