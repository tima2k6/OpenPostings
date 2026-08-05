const { normalizeLikeText, normalizeApplicationStatus, normalizeAppliedByType, normalizeAppliedByLabel, APPLICATION_STATUS_OPTIONS } = require("../helpers/normalize-strings");
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


// The employer as the posting itself names it, used when no companies row matches.
async function lookupPostingCompanyName(jobPostingUrl) {
  const normalizedUrl = String(jobPostingUrl || "").trim();
  if (!normalizedUrl) return "";
  const row = await getDb().get(
    `SELECT company_name FROM Postings WHERE job_posting_url = ? LIMIT 1;`,
    [normalizedUrl]
  );
  return String(row?.company_name || "").trim();
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
    // Null, not 0. An application to an employer outside the crawl table has no company
    // id, and 0 reads as a real one.
    company_id: row?.company_id === null || row?.company_id === undefined ? null : Number(row.company_id),
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
        COALESCE(NULLIF(TRIM(c.company_name), ''), a.company_name) AS company_name,
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
          COALESCE(NULLIF(TRIM(c.company_name), ''), a.company_name) AS company_name,
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
          COALESCE(NULLIF(TRIM(c.company_name), ''), a.company_name) AS company_name,
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

  // No longer fatal. This used to throw, which meant an application genuinely submitted was
  // discarded because the employer had no row in the crawl table -- Amazon postings carry
  // legal entity names ("Amazon.com Services LLC") that match nothing, so every Amazon
  // application was lost at this line. Best available name, in order of trustworthiness:
  // the matched company, then the posting's own company_name, then what the caller said.
  const postingCompanyName = jobPostingUrl ? await lookupPostingCompanyName(jobPostingUrl) : "";
  const resolvedCompanyName =
    String(company?.company_name || "").trim() ||
    postingCompanyName ||
    companyName ||
    "";
  if (!resolvedCompanyName) {
    throw new Error("An application needs a company_name (or a job_posting_url that resolves to one).");
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
          company_name,
          position_name,
          application_date,
          status
        ) VALUES (?, ?, ?, ?, ?);
      `,
      // company_id is best-effort now; company_name is what actually has to survive, since
      // an application to an employer outside the crawl table is still an application.
      [company?.id ?? null, resolvedCompanyName, positionName, applicationDate, status]
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

  const changed = await runInWriteTransaction(async (handle) => {
    const existing = await handle.get(`SELECT status FROM applications WHERE id = ?;`, [applicationId]);
    if (!existing) return false;

    const result = await handle.run(
      `
        UPDATE applications
        SET status = ?
        WHERE id = ?;
      `,
      [status, applicationId]
    );
    if (Number(result?.changes || 0) === 0) return false;

    const previousStatus = normalizeApplicationStatus(existing.status);
    if (previousStatus !== status) {
      await handle.run(
        `
          INSERT INTO application_status_history (
            application_id,
            previous_status,
            new_status,
            changed_at_epoch
          ) VALUES (?, ?, ?, ?);
        `,
        [applicationId, previousStatus, status, nowEpochSeconds()]
      );
    }

    return true;
  });

  if (!changed) return null;
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

// applications.status has no CHECK constraint and is normalized only on write, so rows
// written before normalizeApplicationStatus existed (or by a path that bypassed it) can
// carry values outside APPLICATION_STATUS_OPTIONS forever -- "rejected" and "submitted"
// both show up in production data. Folding those into normalizeApplicationStatus's generic
// "unrecognized input" default would silently count a real denial ("rejected") as "applied",
// which is exactly backwards for a denial dashboard. These are the two legacy values known
// to exist; anything else unrecognized is surfaced as "other" rather than guessed at.
const LEGACY_STATUS_ALIASES = {
  rejected: "denied",
  submitted: "applied"
};

function resolveStatusBucket(rawStatus) {
  const raw = String(rawStatus || "").trim();
  if (!raw || APPLICATION_STATUS_OPTIONS.has(raw)) {
    return normalizeApplicationStatus(raw);
  }
  return LEGACY_STATUS_ALIASES[raw] || null; // null means "other" -- genuinely unrecognized.
}

function average(values) {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

async function getApplicationDenialStats() {
  const db = getDb();
  const rows = await db.all(
    `
      SELECT
        a.id,
        COALESCE(NULLIF(TRIM(c.company_name), ''), a.company_name) AS company_name,
        a.position_name,
        a.application_date,
        a.status
      FROM applications a
      LEFT JOIN companies c
        ON c.id = a.company_id;
    `
  );

  // Only a transition with a real previous_status marks an observed denial moment --
  // the seed row every application gets (previous_status NULL) is a backfilled stand-in
  // for applications that predate this table, not evidence of when a denial happened.
  const deniedAtRows = await db.all(
    `
      SELECT application_id, MIN(changed_at_epoch) AS denied_at_epoch
      FROM application_status_history
      WHERE previous_status IS NOT NULL
        AND LOWER(TRIM(new_status)) = 'denied'
      GROUP BY application_id;
    `
  );
  const deniedAtByApplicationId = new Map(
    deniedAtRows.map((row) => [Number(row.application_id), Number(row.denied_at_epoch)])
  );

  const byStatus = {};
  for (const option of APPLICATION_STATUS_OPTIONS) {
    byStatus[option] = 0;
  }

  const companyTotals = new Map();
  const deniedApplications = [];
  const daysToDenialSamples = [];

  let total = 0;
  let other = 0;

  for (const row of rows) {
    total += 1;
    const bucket = resolveStatusBucket(row?.status);
    if (bucket) {
      byStatus[bucket] += 1;
    } else {
      other += 1;
    }

    const companyName = String(row?.company_name || "").trim() || "Unknown company";
    const companyEntry = companyTotals.get(companyName) || { company_name: companyName, total: 0, denied: 0 };
    companyEntry.total += 1;
    if (bucket === "denied") companyEntry.denied += 1;
    companyTotals.set(companyName, companyEntry);

    if (bucket === "denied") {
      const applicationId = Number(row?.id || 0);
      const applicationDate = Number(row?.application_date || 0);
      const deniedAtEpoch = deniedAtByApplicationId.get(applicationId) ?? null;
      const daysToDenial =
        deniedAtEpoch && applicationDate && deniedAtEpoch >= applicationDate
          ? (deniedAtEpoch - applicationDate) / 86400
          : null;
      if (daysToDenial !== null) daysToDenialSamples.push(daysToDenial);

      deniedApplications.push({
        id: applicationId,
        company_name: companyName,
        position_name: String(row?.position_name || "").trim() || "Unknown position",
        application_date: applicationDate,
        denied_at_epoch: deniedAtEpoch,
        days_to_denial: daysToDenial
      });
    }
  }

  const denied = byStatus.denied || 0;
  const denialRate = total > 0 ? (denied / total) * 100 : 0;

  const byCompany = Array.from(companyTotals.values())
    .filter((entry) => entry.denied > 0)
    .map((entry) => ({ ...entry, denial_rate: entry.total > 0 ? (entry.denied / entry.total) * 100 : 0 }))
    .sort((a, b) => b.denied - a.denied || b.total - a.total || a.company_name.localeCompare(b.company_name));

  deniedApplications.sort((a, b) => b.application_date - a.application_date);

  return {
    total,
    denied,
    denial_rate: denialRate,
    by_status: byStatus,
    other,
    by_company: byCompany,
    denied_applications: deniedApplications,
    time_to_denial: {
      average_days: average(daysToDenialSamples),
      median_days: median(daysToDenialSamples),
      sample_size: daysToDenialSamples.length
    }
  };
}

module.exports = { resolveCompanyIdForApplication, resolveCompanyIdFromPostingUrl, getExistingAppliedApplicationByPostingUrl, listApplications, createApplication, updateApplicationStatus, deleteApplicationById, getApplicationDenialStats };