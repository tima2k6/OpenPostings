// Sync progress that survives a restart.
//
// A pass over 61,612 companies takes hours. The target list had no ORDER BY, so every pass
// walked it in rowid order from the top -- meaning a restart re-crawled exactly what it had
// just finished, and never reached the tail. Companies late in the table, and therefore
// whole ATS platforms, could go permanently unsynced while everything looked healthy: the
// sync was busy, postings were being stored, no errors anywhere.
//
// Ordering by last_synced_epoch makes a pass resumable without any pass bookkeeping: an
// interrupted run continues with whatever nobody has looked at longest. These cases cover
// the properties that has to hold to be worth anything -- never-synced first, no starvation,
// and full coverage across repeated interruptions.
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { openDatabase } = require("../db/open-database.js");
const { setDb, getDb, setSyncEnabledAts } = require("../services/runtime-context.js");
const { getCompaniesForSync, markCompanySynced, flushCompanySyncMarks } = require("../services/sync-runtime.js");

const NOW = 1_800_000_000;

async function setup(companyCount) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openpostings-resume-"));
  setDb(await openDatabase({ filename: path.join(dir, "test.db") }));
  const db = getDb();
  await db.exec(`
    CREATE TABLE companies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_name TEXT NOT NULL,
      url_string TEXT NOT NULL,
      ATS_name TEXT NOT NULL,
      last_synced_epoch INTEGER
    );
    CREATE TABLE blocked_companies (
      normalized_company_name TEXT PRIMARY KEY,
      company_name TEXT NOT NULL,
      blocked_at_epoch INTEGER NOT NULL
    );
  `);
  // Set explicitly so the fixture does not depend on which platforms happen to be enabled
  // by default; getCompaniesForSync filters to the enabled set.
  setSyncEnabledAts(new Set(["greenhouse", "lever"]));
  for (let index = 1; index <= companyCount; index += 1) {
    await db.run(`INSERT INTO companies (company_name, url_string, ATS_name) VALUES (?, ?, ?);`, [
      `company-${String(index).padStart(3, "0")}`,
      `https://example.com/${index}`,
      // The tail of the table is a different platform, which is what used to go unvisited.
      // A real platform sitting at the tail of the table -- the position that used to go
      // permanently unvisited when passes always restarted from the top.
      index > companyCount * 0.8 ? "lever" : "greenhouse"
    ]);
  }
}

async function testNeverSyncedComeFirst() {
  const db = getDb();
  // Half already synced recently, half never.
  await db.run(`UPDATE companies SET last_synced_epoch = ? WHERE id <= 50;`, [NOW]);

  const targets = await getCompaniesForSync();
  assert.strictEqual(targets.length, 100);
  assert.ok(
    targets.slice(0, 50).every((company) => company.id > 50),
    "companies that have never been synced must be reached before anything is revisited"
  );
}

// The regression itself: an interrupted pass must not restart from the top.
async function testAnInterruptedPassResumesRatherThanRestarting() {
  await getDb().run(`UPDATE companies SET last_synced_epoch = NULL;`);

  // "Pass one" gets through 30 companies and the process dies.
  const firstPass = await getCompaniesForSync();
  const firstThirty = firstPass.slice(0, 30);
  for (const company of firstThirty) markCompanySynced(company.id, NOW);
  await flushCompanySyncMarks();

  // Restart: the next pass must begin where the last one stopped.
  const secondPass = await getCompaniesForSync();
  const alreadyDone = new Set(firstThirty.map((company) => company.id));
  assert.ok(
    secondPass.slice(0, 70).every((company) => !alreadyDone.has(company.id)),
    "a restart must continue with unvisited companies, not re-crawl the ones just finished"
  );
  // And the finished ones are still reached eventually -- at the back of the queue.
  assert.ok(
    secondPass.slice(70).every((company) => alreadyDone.has(company.id)),
    "already-synced companies move to the back rather than being dropped"
  );
}

// The consequence that actually mattered to the user: no platform goes permanently unseen.
async function testRepeatedInterruptionsStillCoverEveryAts() {
  await getDb().run(`UPDATE companies SET last_synced_epoch = NULL;`);

  const seen = new Set();
  // Ten passes that each manage only 15 companies before being cut short -- the shape of a
  // server being restarted repeatedly.
  for (let pass = 0; pass < 10; pass += 1) {
    const targets = await getCompaniesForSync();
    for (const company of targets.slice(0, 15)) {
      seen.add(company.id);
      markCompanySynced(company.id, NOW + pass);
    }
    await flushCompanySyncMarks();
  }

  assert.strictEqual(seen.size, 100, "every company is reached across repeated interruptions");

  const rareAts = await getDb().all(`SELECT id FROM companies WHERE ATS_name = 'lever';`);
  assert.ok(rareAts.length > 0);
  assert.ok(
    rareAts.every((row) => seen.has(row.id)),
    "the platform at the tail of the table must be visited, not starved by restarts"
  );
}

// A company that always fails must not hold the head of the queue forever.
async function testFailingCompanyDoesNotStarveTheRest() {
  await getDb().run(`UPDATE companies SET last_synced_epoch = NULL;`);
  const [first] = await getCompaniesForSync();

  // Marked despite "failing", which is what the sync does in its finally block.
  markCompanySynced(first.id, NOW);
  await flushCompanySyncMarks();

  const next = await getCompaniesForSync();
  assert.notStrictEqual(next[0].id, first.id, "a failing company yields its place on the next lap");
}

async function main() {
  await setup(100);
  await testNeverSyncedComeFirst();
  await testAnInterruptedPassResumesRatherThanRestarting();
  await testRepeatedInterruptionsStillCoverEveryAts();
  await testFailingCompanyDoesNotStarveTheRest();
  console.log("sync-resume tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
