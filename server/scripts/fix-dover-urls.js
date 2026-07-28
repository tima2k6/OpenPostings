// Rewrites stored Dover posting URLs from the unreachable /jobs/<slug>/<jobId> shape to
// the /apply/<slug>/<jobId>/ shape Dover actually serves. See buildDoverJobPostingUrl in
// server/ats/dover/service.js: the old shape returns HTTP 200 with Dover's SPA shell and
// then renders "404 - Page Not Found" client-side, so every Dover posting in the database
// looks fine to the server and is unopenable for the applicant.
//
// job_posting_url is UNIQUE and is the key posting_application_state joins on, so applied
// and ignored state is carried across to the new URL. A row whose new URL already exists
// (both shapes stored at some point) is dropped in favour of the existing one.
//
//   node server/scripts/fix-dover-urls.js [--dry-run]
const path = require("path");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");

const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, "..", "..", "jobs.db");
const DRY_RUN = process.argv.includes("--dry-run");

// https://app.dover.com/jobs/<slug>/<uuid> -> https://app.dover.com/apply/<slug>/<uuid>/
const OLD_SHAPE = /^https:\/\/app\.dover\.com\/jobs\/([^/]+)\/([0-9a-f-]{36})\/?$/i;

function toApplyUrl(url) {
  const match = String(url || "").match(OLD_SHAPE);
  if (!match) return null;
  return `https://app.dover.com/apply/${match[1]}/${match[2]}/`;
}

async function main() {
  const db = await open({ filename: DB_PATH, driver: sqlite3.Database });
  await db.exec("PRAGMA busy_timeout = 30000;");

  const rows = await db.all(
    `SELECT id, job_posting_url FROM Postings
     WHERE job_posting_url LIKE 'https://app.dover.com/jobs/%';`
  );

  const summary = { candidates: rows.length, rewritten: 0, collided: 0, skipped: 0 };
  const existing = new Set(
    (await db.all(`SELECT job_posting_url FROM Postings WHERE job_posting_url LIKE 'https://app.dover.com/apply/%';`))
      .map((row) => String(row.job_posting_url))
  );

  if (DRY_RUN) {
    for (const row of rows.slice(0, 5)) {
      console.log(`  ${row.job_posting_url}\n-> ${toApplyUrl(row.job_posting_url)}`);
    }
    console.log(`[fix-dover-urls] dry run: ${rows.length} rows would be rewritten`);
    await db.close();
    return;
  }

  await db.exec("BEGIN TRANSACTION;");
  try {
    for (const row of rows) {
      const nextUrl = toApplyUrl(row.job_posting_url);
      if (!nextUrl) {
        summary.skipped += 1;
        continue;
      }
      if (existing.has(nextUrl)) {
        // The correct URL is already stored as its own row; this one is a duplicate.
        await db.run(`DELETE FROM Postings WHERE id = ?;`, [row.id]);
        summary.collided += 1;
        continue;
      }
      // Carry applied/ignored state, which is keyed by URL.
      await db.run(
        `UPDATE OR IGNORE posting_application_state SET job_posting_url = ? WHERE job_posting_url = ?;`,
        [nextUrl, row.job_posting_url]
      );
      await db.run(`UPDATE Postings SET job_posting_url = ? WHERE id = ?;`, [nextUrl, row.id]);
      existing.add(nextUrl);
      summary.rewritten += 1;
    }
    await db.exec("COMMIT;");
  } catch (error) {
    await db.exec("ROLLBACK;");
    throw error;
  }

  console.log("[fix-dover-urls]", JSON.stringify(summary));
  await db.close();
}

main().catch((error) => {
  console.error("[fix-dover-urls] failed:", error);
  process.exit(1);
});
