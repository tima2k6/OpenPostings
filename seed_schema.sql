-- OpenPostings seed schema (tables only)
-- This is just so someone can quickly understand the database schema. 
PRAGMA foreign_keys = ON;

-- McpSettings
CREATE TABLE IF NOT EXISTS McpSettings (
      id INTEGER NOT NULL PRIMARY KEY CHECK (id = 1),
      enabled INTEGER NOT NULL DEFAULT 0,
      preferred_agent_name TEXT NOT NULL DEFAULT 'OpenPostings Agent',
      agent_login_email TEXT NOT NULL DEFAULT '',
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
    , agent_login_password TEXT NOT NULL DEFAULT '');

-- PersonalInformation
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
	education_level TEXT NOT NULL
, years_of_experience INTEGER);

-- Postings
CREATE TABLE IF NOT EXISTS Postings (
      id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      company_name TEXT NOT NULL,
      position_name TEXT NOT NULL,
      job_posting_url TEXT NOT NULL UNIQUE,
      posting_date TEXT,
      job_description TEXT,
      compensation_type TEXT,
      education_levels TEXT,
      pay_min REAL,
      pay_max REAL,
      pay_currency TEXT,
      pay_period TEXT,
      pay_raw TEXT,
      first_seen_epoch INTEGER,
      last_seen_epoch INTEGER,
      hidden INTEGER NOT NULL DEFAULT 0,
      hidden_at_epoch INTEGER
    );

-- Hidden postings are kept as tombstones for HIDDEN_POSTING_RETENTION_SECONDS, then
-- deleted by deleteExpiredHiddenPostings; this index serves that sweep.
CREATE INDEX IF NOT EXISTS idx_postings_hidden_hidden_at_epoch
  ON Postings(hidden, hidden_at_epoch);

-- Serves the default listing sort (last_seen_epoch DESC) so the page can be streamed
-- from the index instead of sorting the whole visible set in a temp b-tree.
CREATE INDEX IF NOT EXISTS idx_postings_hidden_last_seen_epoch
  ON Postings(hidden, last_seen_epoch);

-- SyncServiceSettings
CREATE TABLE IF NOT EXISTS SyncServiceSettings (
  id INTEGER NOT NULL PRIMARY KEY CHECK (id = 1),
  ats_request_queue_concurrency INTEGER NOT NULL DEFAULT 1,
  sync_enabled_ats TEXT NOT NULL DEFAULT '[]',
  posting_freshness_hours INTEGER NOT NULL DEFAULT 24,
  download_job_descriptions INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- blocked_companies
CREATE TABLE IF NOT EXISTS blocked_companies (
  normalized_company_name TEXT NOT NULL PRIMARY KEY,
  company_name TEXT NOT NULL,
  blocked_at_epoch INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_blocked_companies_company_name
  ON blocked_companies(company_name);

-- saved_job_searches
CREATE TABLE IF NOT EXISTS saved_job_searches (
  id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  search_text TEXT NOT NULL DEFAULT '',
  filters_json TEXT NOT NULL DEFAULT '{}',
  created_at_epoch INTEGER NOT NULL,
  updated_at_epoch INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_saved_job_searches_name
  ON saved_job_searches(LOWER(name));

-- application_attribution
CREATE TABLE IF NOT EXISTS application_attribution (
      application_id INTEGER NOT NULL PRIMARY KEY,
      applied_by_type TEXT NOT NULL,
      applied_by_label TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

-- applications
CREATE TABLE IF NOT EXISTS applications (
	id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
	company_id INTEGER NOT NULL,
	position_name TEXT NOT NULL,
	application_date INTEGER NOT NULL,
	status TEXT
, job_posting_url TEXT NOT NULL DEFAULT '', fit_assessment TEXT NOT NULL DEFAULT '');

-- application_status_history
CREATE TABLE IF NOT EXISTS application_status_history (
      id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      application_id INTEGER NOT NULL,
      previous_status TEXT,
      new_status TEXT NOT NULL,
      changed_at_epoch INTEGER NOT NULL
    );

-- companies
CREATE TABLE IF NOT EXISTS companies (
	id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
	company_name TEXT NOT NULL,
	url_string TEXT NOT NULL,
	ATS_name TEXT NOT NULL
);

-- Hilton moved its careers site off Taleo and onto Oracle Recruiting Cloud, so the
-- hilton.taleo.net career sections still in companies return nothing. The Oracle
-- collector reads this tenant with no extra code.
INSERT INTO companies (company_name, url_string, ATS_name)
SELECT 'Hilton', 'https://efet.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/jobs', 'oraclecloud'
WHERE NOT EXISTS (
  SELECT 1 FROM companies
  WHERE url_string = 'https://efet.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/jobs'
);

-- job_industry_categories
CREATE TABLE IF NOT EXISTS job_industry_categories (
      id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      industry_key TEXT NOT NULL UNIQUE,
      industry_label TEXT NOT NULL,
      priority INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

-- job_position_industry
CREATE TABLE IF NOT EXISTS job_position_industry (
      id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      job_title TEXT NOT NULL,
      normalized_job_title TEXT NOT NULL UNIQUE,
      industry_key TEXT NOT NULL,
      industry_label TEXT NOT NULL,
      matched_rules TEXT NOT NULL,
      confidence_score REAL NOT NULL,
      rule_version TEXT NOT NULL DEFAULT 'rule_bootstrap_v4',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (industry_key) REFERENCES job_industry_categories(industry_key)
    );

-- lost_and_found
CREATE TABLE IF NOT EXISTS lost_and_found(rootpgno INTEGER, pgno INTEGER, nfield INTEGER, id INTEGER, c0, c1, c2, c3, c4, c5);

-- posting_application_state
CREATE TABLE IF NOT EXISTS posting_application_state (
      job_posting_url TEXT NOT NULL PRIMARY KEY,
      applied INTEGER NOT NULL DEFAULT 0,
      applied_by_type TEXT NOT NULL,
      applied_by_label TEXT NOT NULL,
      applied_at_epoch INTEGER,
      last_application_id INTEGER,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    , ignored INTEGER NOT NULL DEFAULT 0, ignored_at_epoch INTEGER, ignored_by_label TEXT NOT NULL DEFAULT '');

-- state_location_index
CREATE TABLE IF NOT EXISTS state_location_index (
      id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      location_type TEXT NOT NULL CHECK (location_type IN ('city', 'county')),
      state_usps TEXT NOT NULL,
      state_geoid TEXT,
      location_geoid TEXT NOT NULL,
      ansicode TEXT,
      location_name TEXT NOT NULL,
      search_location_name TEXT NOT NULL,
      normalized_location_name TEXT NOT NULL,
      normalized_search_location_name TEXT NOT NULL,
      lsad_code TEXT,
      funcstat TEXT,
      aland INTEGER,
      awater INTEGER,
      aland_sqmi REAL,
      awater_sqmi REAL,
      intptlat REAL,
      intptlong REAL,
      source_file TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(location_type, location_geoid)
    );
