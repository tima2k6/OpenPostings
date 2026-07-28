const { normalizeLikeText, normalizeApplicationStatus, normalizeAppliedByType, normalizeAppliedByLabel } = require("../helpers/normalize-strings");
const { parseNonNegativeInteger, nowEpochSeconds } = require("../helpers/normalize-numbers");
const { markPostingAppliedState } = require("./postings.js");
const { getDb, setDb, runInWriteTransaction } = require("../services/runtime-context")

async function resolveCompanyIdForApplication(companyName) {
  const normalized = normalizeLikeText(companyName);
  if (!normalized) return null;
  const db = getDb()
  return db.get(
    `
      SELECT id, company_name
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
  const db = getDb()

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
      SELECT id, company_name
      FROM companies
      WHERE LOWER(company_name) = ?
      ORDER BY id ASC
      LIMIT 1;
    `,
    [normalizedCompanyName]
  );
}

async function getExistingAppliedApplicationByPostingUrl(jobPostingUrl) {
  const normalizedUrl = String(jobPostingUrl || "").trim();
  if (!normalizedUrl) return null;
  const db = getDb()

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

  return getApplicationById(lastApplicationId);
}

function mapApplicationRow(row) {
  if (!row) return null;
  const status = normalizeApplicationStatus(row?.status);
  const appliedByType = normalizeAppliedByType(row?.applied_by_type);
  return {
    id: Number(row?.id || 0),
    company_id: Number(row?.company_id || 0),
    company_name: String(row?.company_name || "").trim(),
    position_name: String(row?.position_name || "").trim(),
    application_date: Number(row?.application_date || 0),
    status,
    applied_by_type: appliedByType,
    applied_by_label: normalizeAppliedByLabel(row?.applied_by_label, appliedByType)
  };
}

async function getApplicationById(applicationId) {
  const db = getDb()
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
      WHERE a.id = ?;
    `,
    [applicationId]
  );

  return mapApplicationRow(row);
}

async function listApplications(options = {}) {
  const limit = Math.max(1, Math.min(2000, Number(options?.limit || 500)));
  const offset = Math.max(0, Number(options?.offset || 0));
  const status = normalizeLikeText(options?.status);
  const db = getDb()

  let rows = [];
  if (status && status !== "all") {
    rows = await db.all(
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
        WHERE LOWER(COALESCE(a.status, '')) = ?
        ORDER BY a.application_date DESC, a.id DESC
        LIMIT ? OFFSET ?;
      `,
      [status, limit, offset]
    );
  } else {
    rows = await db.all(
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
        ORDER BY a.application_date DESC, a.id DESC
        LIMIT ? OFFSET ?;
      `,
      [limit, offset]
    );
  }

  const items = rows.map(mapApplicationRow).filter(Boolean);
  return {
    items,
    count: items.length,
    limit,
    offset
  };
}

async function createApplication(input) {
  const companyName = String(input?.company_name || "").trim();
  const positionName = String(input?.position_name || "").trim();
  const jobPostingUrl = String(input?.job_posting_url || "").trim();
  if (!companyName && !jobPostingUrl) {
    throw new Error("company_name or job_posting_url is required");
  }
  if (!positionName) {
    throw new Error("position_name is required");
  }

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

  const status = normalizeApplicationStatus(input?.status);
  const applicationDate = parseNonNegativeInteger(input?.application_date) || nowEpochSeconds();
  const appliedByType = normalizeAppliedByType(input?.applied_by_type);
  const appliedByLabel = normalizeAppliedByLabel(input?.applied_by_label, appliedByType);
  const db = getDb()

  const insertedId = await runInWriteTransaction(async (handle) => {
    const result = await handle.run(
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
      [result.lastID, appliedByType, appliedByLabel]
    );

    if (jobPostingUrl) {
      await markPostingAppliedState({
        job_posting_url: jobPostingUrl,
        applied: true,
        applied_by_type: appliedByType,
        applied_by_label: appliedByLabel,
        applied_at_epoch: applicationDate,
        last_application_id: result.lastID
      });
    }

    return result.lastID;
  });

  // Read back outside the transaction: getApplicationById joins several tables and has no
  // business extending the write lock.
  return getApplicationById(insertedId);
}

async function updateApplicationStatus(applicationId, statusValue) {
  const status = normalizeApplicationStatus(statusValue);
  const db = getDb()
  const result = await db.run(
    `
      UPDATE applications
      SET status = ?
      WHERE id = ?;
    `,
    [status, applicationId]
  );

  if (Number(result?.changes || 0) === 0) {
    return null;
  }

  return getApplicationById(applicationId);
}

async function deleteApplicationById(applicationId) {
  return runInWriteTransaction(async (db) => {
    const trackedPostingRows = await db.all(
      `
        SELECT job_posting_url
        FROM posting_application_state
        WHERE last_application_id = ?;
      `,
      [applicationId]
    );
    const trackedPostingUrls = trackedPostingRows
      .map((row) => String(row?.job_posting_url || "").trim())
      .filter(Boolean);

    await db.run(`DELETE FROM application_attribution WHERE application_id = ?;`, [applicationId]);
    const result = await db.run(`DELETE FROM applications WHERE id = ?;`, [applicationId]);

    for (const jobPostingUrl of trackedPostingUrls) {
      const posting = await db.get(
        `
          SELECT company_name, position_name
          FROM Postings
          WHERE job_posting_url = ?
          LIMIT 1;
        `,
        [jobPostingUrl]
      );

      const companyName = normalizeLikeText(posting?.company_name);
      const positionName = normalizeLikeText(posting?.position_name);

      let replacement = null;
      if (companyName && positionName) {
        replacement = await db.get(
          `
            SELECT
              a.id,
              a.application_date,
              attr.applied_by_type,
              attr.applied_by_label
            FROM applications a
            INNER JOIN companies c
              ON c.id = a.company_id
            LEFT JOIN application_attribution attr
              ON attr.application_id = a.id
            WHERE LOWER(c.company_name) = ?
              AND LOWER(a.position_name) = ?
            ORDER BY a.application_date DESC, a.id DESC
            LIMIT 1;
          `,
          [companyName, positionName]
        );
      }

      if (replacement?.id) {
        const appliedByType = normalizeAppliedByType(replacement?.applied_by_type);
        const appliedByLabel = normalizeAppliedByLabel(replacement?.applied_by_label, appliedByType);
        await db.run(
          `
            UPDATE posting_application_state
            SET
              applied = 1,
              applied_by_type = ?,
              applied_by_label = ?,
              applied_at_epoch = ?,
              last_application_id = ?,
              updated_at = datetime('now')
            WHERE job_posting_url = ?;
          `,
          [
            appliedByType,
            appliedByLabel,
            parseNonNegativeInteger(replacement?.application_date) || nowEpochSeconds(),
            Number(replacement?.id),
            jobPostingUrl
          ]
        );
      } else {
        await db.run(
          `
            UPDATE posting_application_state
            SET
              applied = 0,
              applied_by_type = 'manual',
              applied_by_label = '',
              applied_at_epoch = NULL,
              last_application_id = NULL,
              updated_at = datetime('now')
            WHERE job_posting_url = ?;
          `,
          [jobPostingUrl]
        );
      }
    }

    return Number(result?.changes || 0) > 0;
  });
}

module.exports = { resolveCompanyIdForApplication, resolveCompanyIdFromPostingUrl, getExistingAppliedApplicationByPostingUrl, listApplications, createApplication, updateApplicationStatus, deleteApplicationById };