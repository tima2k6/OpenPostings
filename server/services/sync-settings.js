const { setPostingFreshnessHours } = require("../helpers/normalize-numbers")
const { normalizeSyncServiceSettingsInput } = require("../helpers/normalize-sync-settings")
const { normalizeBoolean, getPostingFreshnessHours, POSTING_FRESHNESS_HOURS_DEFAULT, MIN_POSTING_FRESHNESS_HOURS, MAX_POSTING_FRESHNESS_HOURS } = require("../helpers/normalize-numbers")
const {
  getDb,
  getReadDb,
  setDb,
  getAtsRequestQueueConcurrency,
  setAtsRequestQueueConcurrency,
  getSyncEnabledAts,
  setSyncEnabledAts,
  getSyncDownloadJobDescriptions,
  setSyncDownloadJobDescriptions
} = require("./runtime-context.js");
const { normalizeAtsRequestQueueConcurrency, ATS_REQUEST_QUEUE_CONCURRENCY_DEFAULT, MIN_ATS_REQUEST_QUEUE_CONCURRENCY, MAX_ATS_REQUEST_QUEUE_CONCURRENCY } = require("./queue.js");
const { normalizeSyncEnabledAts, SYNC_DEFAULT_ENABLED_ATS, normalizeAtsFilterValue } = require("../helpers/normalize-ats.js");
const { SYNC_SERVICE_SETTINGS_DEFAULTS } = require("../helpers/normalize-sync-settings");



async function ensureSyncServiceSettingsTable() {
  const db = getDb();
  await db.exec(`
    CREATE TABLE IF NOT EXISTS SyncServiceSettings (
      id INTEGER NOT NULL PRIMARY KEY CHECK (id = 1),
      ats_request_queue_concurrency INTEGER NOT NULL DEFAULT 1,
      sync_enabled_ats TEXT NOT NULL DEFAULT '[]',
      posting_freshness_hours INTEGER NOT NULL DEFAULT 24,
      download_job_descriptions INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const syncSettingsColumns = await db.all(`PRAGMA table_info(SyncServiceSettings);`);
  const syncSettingsColumnNames = new Set(
    (Array.isArray(syncSettingsColumns) ? syncSettingsColumns : []).map((column) => String(column?.name || ""))
  );
  if (!syncSettingsColumnNames.has("sync_enabled_ats")) {
    await db.exec(`
      ALTER TABLE SyncServiceSettings
      ADD COLUMN sync_enabled_ats TEXT NOT NULL DEFAULT '[]';
    `);
  }
  if (!syncSettingsColumnNames.has("posting_freshness_hours")) {
    await db.exec(`
      ALTER TABLE SyncServiceSettings
      ADD COLUMN posting_freshness_hours INTEGER NOT NULL DEFAULT 24;
    `);
  }
  if (!syncSettingsColumnNames.has("download_job_descriptions")) {
    await db.exec(`
      ALTER TABLE SyncServiceSettings
      ADD COLUMN download_job_descriptions INTEGER NOT NULL DEFAULT 1;
    `);
  }

  await db.run(
    `
      INSERT INTO SyncServiceSettings (
        id,
        ats_request_queue_concurrency,
        sync_enabled_ats,
        posting_freshness_hours,
        download_job_descriptions,
        updated_at
      ) VALUES (1, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(id) DO NOTHING;
    `,
    [
      SYNC_SERVICE_SETTINGS_DEFAULTS.ats_request_queue_concurrency,
      JSON.stringify(SYNC_SERVICE_SETTINGS_DEFAULTS.sync_enabled_ats),
      SYNC_SERVICE_SETTINGS_DEFAULTS.posting_freshness_hours,
      SYNC_SERVICE_SETTINGS_DEFAULTS.download_job_descriptions ? 1 : 0
    ]
  );
}


async function getStoredSyncServiceSettings() {
  const db = getReadDb();
  const row = await db.get(
    `
      SELECT
        ats_request_queue_concurrency,
        sync_enabled_ats,
        posting_freshness_hours,
        download_job_descriptions
      FROM SyncServiceSettings
      WHERE id = 1
      LIMIT 1;
    `
  );

  return normalizeSyncServiceSettingsInput(
    {
      ...SYNC_SERVICE_SETTINGS_DEFAULTS,
      ats_request_queue_concurrency: row?.ats_request_queue_concurrency,
      sync_enabled_ats: row?.sync_enabled_ats,
      posting_freshness_hours: row?.posting_freshness_hours,
      download_job_descriptions: row?.download_job_descriptions
    },
    SYNC_SERVICE_SETTINGS_DEFAULTS
  );
}

async function loadSyncServiceSettingsIntoRuntime() {
  const stored = await getStoredSyncServiceSettings();
  setAtsRequestQueueConcurrency(normalizeAtsRequestQueueConcurrency(stored?.ats_request_queue_concurrency));
  setSyncEnabledAts(new Set(normalizeSyncEnabledAts(stored?.sync_enabled_ats)));
  setPostingFreshnessHours(stored?.posting_freshness_hours);
  setSyncDownloadJobDescriptions(normalizeBoolean(stored?.download_job_descriptions, true));
  return stored;
}

async function getSyncServiceSettings() {
  const stored = await getStoredSyncServiceSettings();
  return {
    ...stored,
    active_posting_freshness_hours: getPostingFreshnessHours(),
    active_download_job_descriptions: getSyncDownloadJobDescriptions(),
    min_posting_freshness_hours: MIN_POSTING_FRESHNESS_HOURS,
    max_posting_freshness_hours: MAX_POSTING_FRESHNESS_HOURS,
    active_ats_request_queue_concurrency: getAtsRequestQueueConcurrency(),
    min_ats_request_queue_concurrency: MIN_ATS_REQUEST_QUEUE_CONCURRENCY,
    max_ats_request_queue_concurrency: MAX_ATS_REQUEST_QUEUE_CONCURRENCY,
    applies_after_service_restart: true
  };
}

async function upsertSyncServiceSettings(input = {}) {
  const existing = await getStoredSyncServiceSettings();
  const normalized = normalizeSyncServiceSettingsInput(input, existing);
  const db = getDb();
  await db.run(
    `
      INSERT INTO SyncServiceSettings (
        id,
        ats_request_queue_concurrency,
        sync_enabled_ats,
        posting_freshness_hours,
        download_job_descriptions,
        updated_at
      ) VALUES (1, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET
        ats_request_queue_concurrency = excluded.ats_request_queue_concurrency,
        sync_enabled_ats = excluded.sync_enabled_ats,
        posting_freshness_hours = excluded.posting_freshness_hours,
        download_job_descriptions = excluded.download_job_descriptions,
        updated_at = datetime('now');
    `,
    [
      normalized.ats_request_queue_concurrency,
      JSON.stringify(normalized.sync_enabled_ats),
      normalized.posting_freshness_hours,
      normalized.download_job_descriptions ? 1 : 0
    ]
  );

  setSyncEnabledAts(new Set(normalized.sync_enabled_ats));
  setPostingFreshnessHours(normalized.posting_freshness_hours);
  setSyncDownloadJobDescriptions(normalizeBoolean(normalized.download_job_descriptions, true));
  return getSyncServiceSettings();
}


async function getCompaniesForSync() {
  const db = getDb();
  const rows = await db.all(
    `
      SELECT id, company_name, url_string, ATS_name
      FROM companies
      WHERE NOT EXISTS (
        SELECT 1
        FROM blocked_companies b
        WHERE b.normalized_company_name = LOWER(TRIM(companies.company_name))
      );
    `
  );

  const enabledAts = new Set(normalizeSyncEnabledAts(Array.from(getSyncEnabledAts())));
  return rows
    .filter((row) => enabledAts.has(normalizeAtsFilterValue(row?.ATS_name)))
    .sort((a, b) => {
      const aAts = String(a?.ATS_name || "");
      const bAts = String(b?.ATS_name || "");
      const atsCompare = aAts.localeCompare(bAts);
      if (atsCompare !== 0) return atsCompare;
      return String(a?.company_name || "").localeCompare(String(b?.company_name || ""));
    });
}


module.exports = { ensureSyncServiceSettingsTable, loadSyncServiceSettingsIntoRuntime, getSyncServiceSettings, upsertSyncServiceSettings };
