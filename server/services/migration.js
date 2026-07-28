const { normalizeLikeText, normalizeApplicationStatus, normalizeAppliedByType, normalizeAppliedByLabel, normalizeIgnoredByLabel } = require("../helpers/normalize-strings")
const { normalizeMigrationSelection } = require("../helpers/normalize-migration")
const { upsertPersonalInformation } = require("../services/personal-info")
const { upsertMcpSettings } = require("../services/mcp")
const { normalizeCompanyNameForBlockList } = require("../helpers/normalize-ats")
const { parseNonNegativeInteger, nowEpochSeconds, normalizeBoolean } = require("../helpers/normalize-numbers")
const { getDb, setDb, runInWriteTransaction } = require("../services/runtime-context")

const path = require("path");
const fs = require("fs");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const { openDatabase, getSqliteReadOnlyMode } = require("../db/open-database");

const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, "..", "jobs.db");

async function tableExists(databaseHandle, tableName) {
  const row = await databaseHandle.get(
    `
      SELECT name
      FROM sqlite_master
      WHERE type = 'table'
        AND LOWER(name) = LOWER(?)
      LIMIT 1;
    `,
    [String(tableName || "").trim()]
  );
  return Boolean(row?.name);
}

async function resolveCompanyIdByName(companyName) {
  const normalized = normalizeLikeText(companyName);
  if (!normalized) return null;
  const db = getDb()
  const row = await db.get(
    `
      SELECT id
      FROM companies
      WHERE LOWER(company_name) = ?
      ORDER BY id ASC
      LIMIT 1;
    `,
    [normalized]
  );
  return Number(row?.id || 0) || null;
}



async function migrateSettingsAndApplicationsFromDatabase(rawSourceDbPath, selectionInput = {}) {
  const sourceDbPath = String(rawSourceDbPath || "").trim();
  if (!sourceDbPath) {
    throw new Error("source_db_path is required");
  }
  const selection = normalizeMigrationSelection(selectionInput);
  if (!selection.personal_information && !selection.mcp_settings && !selection.blocked_companies && !selection.applications) {
    throw new Error("At least one migration option must be selected");
  }

  const resolvedSourcePath = path.resolve(sourceDbPath);
  const resolvedTargetPath = path.resolve(DB_PATH);
  if (!fs.existsSync(resolvedSourcePath)) {
    throw new Error(`Source database not found at path: ${resolvedSourcePath}`);
  }
  if (resolvedSourcePath === resolvedTargetPath) {
    throw new Error("Source database path is the same as the active database");
  }

  const summary = {
    source_db_path: resolvedSourcePath,
    target_db_path: resolvedTargetPath,
    selected: selection,
    personal_information_copied: false,
    mcp_settings_copied: false,
    blocked_companies_copied: 0,
    applications_inserted: 0,
    applications_reused: 0,
    applications_skipped_missing_company: 0,
    application_attribution_upserts: 0,
    posting_application_state_upserts: 0
  };

  let sourceDb;
  try {
    sourceDb = await openDatabase({
      filename: resolvedSourcePath,
      mode: getSqliteReadOnlyMode()
    });

    if (selection.personal_information && (await tableExists(sourceDb, "PersonalInformation"))) {
      const sourcePersonalInformation = await sourceDb.get(
        `
          SELECT *
          FROM PersonalInformation
          ORDER BY rowid DESC
          LIMIT 1;
        `
      );
      if (sourcePersonalInformation) {
        await upsertPersonalInformation(sourcePersonalInformation);
        summary.personal_information_copied = true;
      }
    }

    if (selection.mcp_settings && (await tableExists(sourceDb, "McpSettings"))) {
      const sourceMcpSettings = await sourceDb.get(
        `
          SELECT *
          FROM McpSettings
          WHERE id = 1
          LIMIT 1;
        `
      );
      if (sourceMcpSettings) {
        await upsertMcpSettings(sourceMcpSettings);
        summary.mcp_settings_copied = true;
      }
    }

    if (selection.blocked_companies && (await tableExists(sourceDb, "blocked_companies"))) {
      const sourceBlockedCompanies = await sourceDb.all(
        `
          SELECT normalized_company_name, company_name, blocked_at_epoch
          FROM blocked_companies;
        `
      );
      for (const item of sourceBlockedCompanies) {
        const companyName = String(item?.company_name || "").trim();
        const normalizedCompanyName =
          String(item?.normalized_company_name || "").trim() || normalizeCompanyNameForBlockList(companyName);
        if (!companyName || !normalizedCompanyName) continue;
        const db = getDb()

        await db.run(
          `
            INSERT INTO blocked_companies (
              normalized_company_name,
              company_name,
              blocked_at_epoch
            ) VALUES (?, ?, ?)
            ON CONFLICT(normalized_company_name) DO UPDATE SET
              company_name = excluded.company_name,
              blocked_at_epoch = excluded.blocked_at_epoch;
          `,
          [normalizedCompanyName, companyName, parseNonNegativeInteger(item?.blocked_at_epoch) || nowEpochSeconds()]
        );
        summary.blocked_companies_copied += 1;
      }
    }

    const hasApplications = selection.applications && (await tableExists(sourceDb, "applications"));
    if (hasApplications) {
      const hasSourceCompanies = await tableExists(sourceDb, "companies");
      const hasSourceAttribution = await tableExists(sourceDb, "application_attribution");
      const sourceApplications = await sourceDb.all(
        `
          SELECT
            a.id AS source_application_id,
            a.company_id AS source_company_id,
            ${
              hasSourceCompanies
                ? "COALESCE(c.company_name, '')"
                : "''"
            } AS source_company_name,
            a.position_name,
            a.application_date,
            a.status,
            ${
              hasSourceAttribution
                ? "attr.applied_by_type"
                : "NULL"
            } AS applied_by_type,
            ${
              hasSourceAttribution
                ? "attr.applied_by_label"
                : "NULL"
            } AS applied_by_label
          FROM applications a
          ${
            hasSourceCompanies
              ? "LEFT JOIN companies c ON c.id = a.company_id"
              : ""
          }
          ${
            hasSourceAttribution
              ? "LEFT JOIN application_attribution attr ON attr.application_id = a.id"
              : ""
          }
          ORDER BY a.application_date ASC, a.id ASC;
        `
      );

      const sourceToTargetApplicationId = new Map();

      await runInWriteTransaction(async (db) => {
        for (const item of sourceApplications) {
          const sourceCompanyName = String(item?.source_company_name || "").trim();
          const targetCompanyId = await resolveCompanyIdByName(sourceCompanyName);
          if (!targetCompanyId) {
            summary.applications_skipped_missing_company += 1;
            continue;
          }

          const positionName = String(item?.position_name || "").trim() || "Untitled Position";
          const applicationDate = parseNonNegativeInteger(item?.application_date) || nowEpochSeconds();
          const status = normalizeApplicationStatus(item?.status);

          const existing = await db.get(
            `
              SELECT id
              FROM applications
              WHERE company_id = ?
                AND LOWER(position_name) = LOWER(?)
                AND application_date = ?
                AND LOWER(COALESCE(status, '')) = LOWER(?)
              LIMIT 1;
            `,
            [targetCompanyId, positionName, applicationDate, status]
          );

          let targetApplicationId = Number(existing?.id || 0);
          if (!targetApplicationId) {
            const inserted = await db.run(
              `
                INSERT INTO applications (
                  company_id,
                  position_name,
                  application_date,
                  status
                ) VALUES (?, ?, ?, ?);
              `,
              [targetCompanyId, positionName, applicationDate, status]
            );
            targetApplicationId = Number(inserted?.lastID || 0);
            summary.applications_inserted += 1;
          } else {
            summary.applications_reused += 1;
          }

          if (targetApplicationId) {
            sourceToTargetApplicationId.set(Number(item?.source_application_id || 0), targetApplicationId);
            const appliedByType = normalizeAppliedByType(item?.applied_by_type);
            const appliedByLabel = normalizeAppliedByLabel(item?.applied_by_label, appliedByType);
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
              [targetApplicationId, appliedByType, appliedByLabel]
            );
            summary.application_attribution_upserts += 1;
          }
        }

        if (await tableExists(sourceDb, "posting_application_state")) {
          const sourcePostingStateRows = await sourceDb.all(
            `
              SELECT
                job_posting_url,
                applied,
                applied_by_type,
                applied_by_label,
                applied_at_epoch,
                last_application_id,
                ignored,
                ignored_at_epoch,
                ignored_by_label
              FROM posting_application_state;
            `
          );
          for (const row of sourcePostingStateRows) {
            const jobPostingUrl = String(row?.job_posting_url || "").trim();
            if (!jobPostingUrl) continue;

            const appliedByType = normalizeAppliedByType(row?.applied_by_type);
            const appliedByLabel = normalizeAppliedByLabel(row?.applied_by_label, appliedByType);
            const ignoredByLabel = normalizeIgnoredByLabel(row?.ignored_by_label);
            const sourceLastApplicationId = parseNonNegativeInteger(row?.last_application_id);
            const mappedLastApplicationId = sourceToTargetApplicationId.get(sourceLastApplicationId) || null;

            await db.run(
              `
                INSERT INTO posting_application_state (
                  job_posting_url,
                  applied,
                  applied_by_type,
                  applied_by_label,
                  applied_at_epoch,
                  last_application_id,
                  ignored,
                  ignored_at_epoch,
                  ignored_by_label,
                  updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
                ON CONFLICT(job_posting_url) DO UPDATE SET
                  applied = excluded.applied,
                  applied_by_type = excluded.applied_by_type,
                  applied_by_label = excluded.applied_by_label,
                  applied_at_epoch = excluded.applied_at_epoch,
                  last_application_id = excluded.last_application_id,
                  ignored = excluded.ignored,
                  ignored_at_epoch = excluded.ignored_at_epoch,
                  ignored_by_label = excluded.ignored_by_label,
                  updated_at = datetime('now');
              `,
              [
                jobPostingUrl,
                normalizeBoolean(row?.applied, false) ? 1 : 0,
                appliedByType,
                appliedByLabel,
                parseNonNegativeInteger(row?.applied_at_epoch) || null,
                mappedLastApplicationId,
                normalizeBoolean(row?.ignored, false) ? 1 : 0,
                parseNonNegativeInteger(row?.ignored_at_epoch) || null,
                ignoredByLabel
              ]
            );
            summary.posting_application_state_upserts += 1;
          }
        }

      });
    }
  } finally {
    if (sourceDb) {
      await sourceDb.close();
    }
  }

  return summary;
}

module.exports = { migrateSettingsAndApplicationsFromDatabase };
