// Repairs Applitrack employers that were stored under a placeholder company name.
//
//   node server/scripts/repair-applitrack-company-names.js            # dry run, prints a plan
//   node server/scripts/repair-applitrack-company-names.js --apply    # writes
//
// Applitrack hosts every employer on one domain and tells them apart by the first path
// segment (www.applitrack.com/**aacs**/onlineapp/). parseApplitrackCompanySource used to
// expose only siteRoot, which is URL-shaped, so extractSeededCompanyIdentifier had no field
// it recognised and the suggested company name came out as the whole URL; whatever consumed
// that reduced it to the hostname's first label. The result, measured 2026-08-19: 1,323
// distinct Applitrack employers all stored as the company "www", plus 43,404 postings
// carrying that name -- one meaningless bucket at the top of every company facet and
// dropdown, and no way to filter to an actual employer.
//
// The parser now returns companySlug, so newly seeded companies are named correctly. This
// backfills what was already stored. Each row is repaired from its OWN url, not from a join
// on the broken name, so a posting and its company are derived independently and a partial
// run cannot cross-associate them.
//
// Only rows whose current name is a known placeholder are touched, and only when their URL
// actually yields a slug -- anything else is counted and left alone. Re-running is safe:
// repaired rows no longer carry a placeholder name, so they no longer match.
const path = require("path");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const { extractApplitrackCompanySlug } = require("../ats/applitrack/service.js");

const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, "..", "..", "jobs.db");

// Hostname labels and path words that are never an employer. "www" is the one that actually
// happened; the rest are the same failure mode waiting on a differently-shaped URL.
const PLACEHOLDER_NAMES = new Set(["www", "com", "jobs", "job", "careers", "career", "apply", "onlineapp", ""]);

const BATCH_SIZE = 500;

function isPlaceholderName(name) {
  return PLACEHOLDER_NAMES.has(String(name || "").trim().toLowerCase());
}

async function main(argv = process.argv.slice(2)) {
  const apply = argv.includes("--apply");
  const db = await open({ filename: DB_PATH, driver: sqlite3.Database });
  try {
    await db.exec("PRAGMA busy_timeout = 60000;");

    const companies = await db.all(
      `SELECT id, company_name, url_string FROM companies WHERE ATS_name = 'applitrack';`
    );
    const companyPlan = [];
    let companiesSkipped = 0;
    for (const row of companies) {
      if (!isPlaceholderName(row.company_name)) continue;
      const slug = extractApplitrackCompanySlug(row.url_string);
      if (!slug) {
        companiesSkipped += 1;
        continue;
      }
      companyPlan.push({ id: row.id, from: row.company_name, to: slug });
    }

    // Postings carry the company name denormalised, and are repaired from their own
    // job_posting_url for the reason in the header -- never from the company row they would
    // otherwise have to be matched to by the very name that is wrong.
    const postings = await db.all(
      `SELECT id, company_name, job_posting_url
       FROM Postings
       WHERE company_name IN (${[...PLACEHOLDER_NAMES].filter(Boolean).map(() => "?").join(", ")})
         AND job_posting_url LIKE '%applitrack.com/%';`,
      [...PLACEHOLDER_NAMES].filter(Boolean)
    );
    const postingPlan = [];
    let postingsSkipped = 0;
    for (const row of postings) {
      const slug = extractApplitrackCompanySlug(row.job_posting_url);
      if (!slug) {
        postingsSkipped += 1;
        continue;
      }
      postingPlan.push({ id: row.id, to: slug });
    }

    const distinctNames = new Set(companyPlan.map((entry) => entry.to));
    console.log(`[repair-applitrack] companies to rename: ${companyPlan.length} into ${distinctNames.size} distinct employers`);
    console.log(`[repair-applitrack] postings to rename:  ${postingPlan.length}`);
    if (companiesSkipped || postingsSkipped) {
      console.log(`[repair-applitrack] skipped (no slug in url): ${companiesSkipped} companies, ${postingsSkipped} postings`);
    }
    for (const entry of companyPlan.slice(0, 5)) {
      console.log(`[repair-applitrack]   e.g. company ${entry.id}: "${entry.from}" -> "${entry.to}"`);
    }

    if (!apply) {
      console.log("[repair-applitrack] dry run; pass --apply to write");
      return { applied: false, companies: companyPlan.length, postings: postingPlan.length };
    }

    // Batched transactions rather than one: this competes with the sync's own flushes for the
    // write lock, and a single transaction over 43k rows would hold it for the whole run.
    let companiesUpdated = 0;
    for (let index = 0; index < companyPlan.length; index += BATCH_SIZE) {
      const batch = companyPlan.slice(index, index + BATCH_SIZE);
      await db.exec("BEGIN IMMEDIATE");
      try {
        for (const entry of batch) {
          await db.run(`UPDATE companies SET company_name = ? WHERE id = ?;`, [entry.to, entry.id]);
          companiesUpdated += 1;
        }
        await db.exec("COMMIT");
      } catch (error) {
        await db.exec("ROLLBACK");
        throw error;
      }
    }

    let postingsUpdated = 0;
    for (let index = 0; index < postingPlan.length; index += BATCH_SIZE) {
      const batch = postingPlan.slice(index, index + BATCH_SIZE);
      await db.exec("BEGIN IMMEDIATE");
      try {
        for (const entry of batch) {
          await db.run(`UPDATE Postings SET company_name = ? WHERE id = ?;`, [entry.to, entry.id]);
          postingsUpdated += 1;
        }
        await db.exec("COMMIT");
      } catch (error) {
        await db.exec("ROLLBACK");
        throw error;
      }
    }

    console.log(`[repair-applitrack] updated ${companiesUpdated} companies and ${postingsUpdated} postings`);
    return { applied: true, companies: companiesUpdated, postings: postingsUpdated };
  } finally {
    await db.close();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error("[repair-applitrack] failed:", error?.message || error);
    process.exit(1);
  });
}

module.exports = { main, isPlaceholderName, PLACEHOLDER_NAMES };
