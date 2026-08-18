// posting-match.js runs cover-letter.js's requirement diff (already proven out for
// applications, see applications.js's computeJobFitByApplicationId) over the whole Postings
// table instead of only submitted applications, caches it, and keeps it fresh incrementally.
// The cases that matter: the cached match_percent agrees with the formula
// computeJobFitByApplicationId already uses, incremental scoring only touches new postings,
// a resume re-upload forces a full rescore, and sort_by=match_desc/min_match_percent in
// listPostingsWithFilters actually order and filter by it -- including across a chunk
// boundary in the wide-scan walk, where an off-by-one in the seek predicate would silently
// drop or duplicate a posting.
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { openDatabase } = require("../db/open-database.js");
const { setDb, getDb, setPostingLocationByJobUrl } = require("../services/runtime-context.js");
const { createCanonicalPostingsTable } = require("../services/sync-runtime.js");
const { listPostingsWithFilters } = require("../services/postings.js");
const { ensureApplicantDocumentsTable, saveApplicantDocument } = require("../services/applicant-documents.js");
const { ensureMatchTables, computeMatchForPosting, rescoreMatches, getMatchScoringStatus } = require("../services/posting-match.js");

// Based on the fixture cover-letter.test.js uses (same resume, same HIGH/LOW descriptions),
// with one extra line: computeMatchForPosting scores against
// findUnmatchedRequirementsStrict (see cover-letter.js), which requires two discriminative
// (non-filler) terms to agree per requirement bullet, not cover-letter.test.js's one-shared-
// stem rule -- a terse 5-line resume does not give every genuinely-matched bullet two words
// of overlap on its own. This line adds real, plausible hospitality-GM vocabulary
// ("growth metrics", "regulatory compliance") that a resume this senior would actually
// contain, restoring the intended 3-of-4-matched, Kubernetes-is-the-one-gap shape.
const RESUME = `Tim Annan
Hotel General Manager and Hospitality Technology Leader
Owned full P&L for a 220-room property with $18M annual revenue, improving margin through labor cost control and vendor contract renegotiation.
Led a multi-department team of 85 across front office, housekeeping, food and beverage and engineering.
Built standard operating procedures, KPI dashboards and weekly business reviews to hold department heads accountable.
Managed capital projects and third-party vendor partnerships across the property portfolio.
Tracked growth metrics against clear ownership targets each quarter, and passed every regulatory compliance audit for the property.`;

const HIGH_MATCH_DESCRIPTION = `About the role

We are hiring a General Manager to own our compliance software business.

What you'll need

- Experience running a business unit or P&L with a track record of hitting targets you owned.
- Demonstrated operational rigor: clear metrics, clear ownership, processes that survive growth.
- Comfort operating in a regulated or compliance-heavy domain.
- Kubernetes and distributed systems experience at production scale.`;

// Every requirement here is unrelated to the resume, so match_percent should land at 0.
// Deliberately avoids any word sharing a 6-character prefix with the resume's vocabulary
// (findUnmatchedRequirements stems by truncation, see cover-letter.js) -- "engines" was
// tried first and matched "engineering" on the resume via that same generous stemming.
const LOW_MATCH_DESCRIPTION = `About the role

We are hiring a Principal Distributed Systems Engineer.

What you'll need

- Kubernetes and distributed systems experience at production scale.
- Deep expertise in Rust, gRPC and consensus protocols.
- Prior work on distributed query planners and consensus protocols.
- Experience leading a SRE on-call rotation for a global fleet.`;

async function seedPosting(db, { url, position, description, lastSeenOffsetSeconds = 0 }) {
  const now = Math.floor(Date.now() / 1000);
  await db.run(
    `INSERT INTO Postings
       (company_name, position_name, job_posting_url, job_description,
        first_seen_epoch, last_seen_epoch, hidden)
     VALUES (?, ?, ?, ?, ?, ?, 0)`,
    ["Acme", position, url, description || null, now - 60, now - lastSeenOffsetSeconds]
  );
}

async function withDb(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openpostings-match-index-"));
  setDb(await openDatabase({ filename: path.join(dir, "test.db") }));
  setPostingLocationByJobUrl(new Map());
  try {
    await createCanonicalPostingsTable();
    const db = getDb();
    await db.exec(`
      CREATE TABLE IF NOT EXISTS blocked_companies (
        normalized_company_name TEXT NOT NULL PRIMARY KEY,
        company_name TEXT NOT NULL, blocked_at_epoch INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS posting_application_state (
        job_posting_url TEXT NOT NULL PRIMARY KEY, applied INTEGER NOT NULL DEFAULT 0,
        applied_by_type TEXT NOT NULL DEFAULT '', applied_by_label TEXT NOT NULL DEFAULT '',
        applied_at_epoch INTEGER, last_application_id INTEGER,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        ignored INTEGER NOT NULL DEFAULT 0, ignored_at_epoch INTEGER,
        ignored_by_label TEXT NOT NULL DEFAULT '');
      CREATE TABLE IF NOT EXISTS companies (
        id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, company_name TEXT NOT NULL,
        url_string TEXT NOT NULL, ATS_name TEXT NOT NULL);
    `);
    await ensureApplicantDocumentsTable();
    await ensureMatchTables();
    await run(db);
  } finally {
    setDb(null);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function testComputeMatchForPostingMatchesTheApplicationFormula() {
  // computeJobFitByApplicationId (applications.js) computes
  // (requirements_total - unmatched) / total * 100 from the same brief -- this is that
  // formula, pinned down directly so the two never drift apart.
  const match = computeMatchForPosting({
    description: HIGH_MATCH_DESCRIPTION,
    resume_text: RESUME,
    posting: { position_name: "General Manager, Compliance Software" }
  });
  assert.strictEqual(match.requirements_total, 4);
  assert.strictEqual(match.requirements_matched, 3);
  assert.strictEqual(match.match_percent, 75);
  assert.ok(
    match.unmatched_requirements.some((requirement) => /Kubernetes/.test(requirement)),
    "the Kubernetes requirement has no support in a hospitality resume and must be flagged"
  );

  const noMatch = computeMatchForPosting({ description: LOW_MATCH_DESCRIPTION, resume_text: RESUME, posting: {} });
  assert.strictEqual(noMatch.match_percent, 0);
}

async function testRescoreMatchesIsIncremental() {
  await withDb(async (db) => {
    await saveApplicantDocument({ kind: "resume", file_name: "resume.txt", content: Buffer.from(RESUME, "utf8") });
    await seedPosting(db, { url: "https://x/a", position: "GM", description: HIGH_MATCH_DESCRIPTION });

    const first = await rescoreMatches({});
    assert.strictEqual(first.scored, 1);
    assert.strictEqual(first.complete, true);

    let rows = await db.all(`SELECT posting_id, match_percent FROM posting_match_scores;`);
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(Number(rows[0].match_percent), 75);

    // A second run with nothing new to score must not re-touch the row it already has.
    const second = await rescoreMatches({});
    assert.strictEqual(second.scored, 0, "no new postings above last_scored_id -- nothing to do");

    // A posting added after the first run is picked up without rescoring the first.
    await seedPosting(db, { url: "https://x/b", position: "Distributed Systems Engineer", description: LOW_MATCH_DESCRIPTION });
    const third = await rescoreMatches({});
    assert.strictEqual(third.scored, 1);
    rows = await db.all(`SELECT posting_id, match_percent FROM posting_match_scores ORDER BY posting_id;`);
    assert.strictEqual(rows.length, 2);
    assert.strictEqual(Number(rows[1].match_percent), 0);
  });
}

async function testResumeReuploadForcesARescore() {
  await withDb(async (db) => {
    await saveApplicantDocument({ kind: "resume", file_name: "resume.txt", content: Buffer.from(RESUME, "utf8") });
    await seedPosting(db, { url: "https://x/a", position: "GM", description: HIGH_MATCH_DESCRIPTION });
    await rescoreMatches({});

    let row = await db.get(`SELECT match_percent FROM posting_match_scores WHERE posting_id = 1;`);
    assert.strictEqual(Number(row.match_percent), 75);

    // A resume from an unrelated field (no word sharing a 6-char stem with any requirement
    // in HIGH_MATCH_DESCRIPTION) drops the match to 0 for the same posting -- if the state
    // row's resume_uploaded_at did not change, rescoreMatches would see last_scored_id
    // already past this posting and never revisit it, leaving the stale 75 in place.
    await new Promise((resolve) => setTimeout(resolve, 1100)); // uploaded_at has second resolution
    await saveApplicantDocument({
      kind: "resume",
      file_name: "resume2.txt",
      content: Buffer.from(
        "Marine biologist studying coral reef ecosystems, publishing peer reviewed research on ocean acidification and species migration patterns.",
        "utf8"
      )
    });
    const summary = await rescoreMatches({});
    assert.strictEqual(summary.rebuilt, true);
    assert.strictEqual(summary.scored, 1);

    row = await db.get(`SELECT match_percent FROM posting_match_scores WHERE posting_id = 1;`);
    assert.strictEqual(Number(row.match_percent), 0, "same posting, new resume, must be rescored against it");
  });
}

async function testListPostingsSortsByMatchAndFiltersByMinimum() {
  await withDb(async (db) => {
    await saveApplicantDocument({ kind: "resume", file_name: "resume.txt", content: Buffer.from(RESUME, "utf8") });
    await seedPosting(db, { url: "https://x/high", position: "GM High Match", description: HIGH_MATCH_DESCRIPTION, lastSeenOffsetSeconds: 30 });
    await seedPosting(db, { url: "https://x/low", position: "Eng Low Match", description: LOW_MATCH_DESCRIPTION, lastSeenOffsetSeconds: 20 });
    await seedPosting(db, { url: "https://x/unscored", position: "No Description Posting", description: null, lastSeenOffsetSeconds: 10 });
    await rescoreMatches({});

    const sorted = await listPostingsWithFilters({ sort_by: "match_desc", include_match: true });
    assert.deepStrictEqual(
      sorted.items.map((item) => item.job_posting_url),
      ["https://x/high", "https://x/low", "https://x/unscored"],
      "highest match first, unscored postings sort last"
    );
    assert.strictEqual(sorted.items[0].match_percent, 75);
    assert.strictEqual(sorted.items[0].match_available, true);
    assert.strictEqual(sorted.items[2].match_available, false);
    assert.strictEqual(sorted.items[2].match_percent, null);

    const filtered = await listPostingsWithFilters({ min_match_percent: 50 });
    assert.deepStrictEqual(
      filtered.items.map((item) => item.job_posting_url),
      ["https://x/high"],
      "min_match_percent must exclude the low-match and unscored postings"
    );

    // The default listing (no match params) must not expose match fields at all -- an
    // unrelated caller's response shape must not change.
    const plain = await listPostingsWithFilters({});
    assert.strictEqual(
      Object.prototype.hasOwnProperty.call(plain.items[0], "match_percent"),
      false,
      "match fields must be opt-in, not shipped to every caller by default"
    );
  });
}

// Forces the wide-scan chunked walk to page in chunkSize=1 steps by exercising it through
// limit/offset with three postings and no other filters set besides sort_by=match_desc --
// this pins down that the match_desc seek predicate correctly resumes across a chunk
// boundary rather than skipping or repeating a row.
async function testMatchDescPaginatesAcrossChunks() {
  await withDb(async (db) => {
    await saveApplicantDocument({ kind: "resume", file_name: "resume.txt", content: Buffer.from(RESUME, "utf8") });
    for (let index = 0; index < 5; index += 1) {
      await seedPosting(db, {
        url: `https://x/p${index}`,
        position: `Role ${index}`,
        description: index % 2 === 0 ? HIGH_MATCH_DESCRIPTION : LOW_MATCH_DESCRIPTION,
        lastSeenOffsetSeconds: index
      });
    }
    await rescoreMatches({});

    const page1 = await listPostingsWithFilters({ sort_by: "match_desc", limit: 2, offset: 0 });
    const page2 = await listPostingsWithFilters({ sort_by: "match_desc", limit: 2, offset: 2 });
    const page3 = await listPostingsWithFilters({ sort_by: "match_desc", limit: 2, offset: 4 });
    const all = [...page1.items, ...page2.items, ...page3.items].map((item) => item.job_posting_url);
    assert.strictEqual(new Set(all).size, 5, "no posting skipped or repeated across pages");
    assert.strictEqual(all.length, 5);
  });
}

// The riskiest part of the two-phase rewrite: pagination that straddles the boundary
// between the scored phase (driven by posting_match_scores' own index) and the unscored
// phase (postings with no row there at all, driven by the ordinary last_seen_epoch index).
// 3 scored + 3 unscored, paginated at limit=2, puts offset=2's page exactly on the seam --
// its first item is the last scored posting, its second is the first unscored one.
async function testMatchDescPaginatesAcrossTheScoredUnscoredBoundary() {
  await withDb(async (db) => {
    await saveApplicantDocument({ kind: "resume", file_name: "resume.txt", content: Buffer.from(RESUME, "utf8") });
    for (let index = 0; index < 3; index += 1) {
      await seedPosting(db, {
        url: `https://x/scored${index}`,
        position: `Scored Role ${index}`,
        description: HIGH_MATCH_DESCRIPTION,
        lastSeenOffsetSeconds: index
      });
    }
    for (let index = 0; index < 3; index += 1) {
      await seedPosting(db, {
        url: `https://x/unscored${index}`,
        position: `Unscored Role ${index}`,
        description: null,
        lastSeenOffsetSeconds: 10 + index
      });
    }
    await rescoreMatches({});

    const page1 = await listPostingsWithFilters({ sort_by: "match_desc", limit: 2, offset: 0 });
    const page2 = await listPostingsWithFilters({ sort_by: "match_desc", limit: 2, offset: 2 });
    const page3 = await listPostingsWithFilters({ sort_by: "match_desc", limit: 2, offset: 4 });

    assert.ok(
      page1.items.every((item) => item.job_posting_url.startsWith("https://x/scored")),
      "the first page must be entirely scored postings"
    );
    assert.deepStrictEqual(
      page2.items.map((item) => item.job_posting_url.startsWith("https://x/scored")),
      [true, false],
      "the page straddling the boundary must end the scored phase and begin the unscored one, not skip or duplicate a row"
    );
    assert.ok(
      page3.items.every((item) => item.job_posting_url.startsWith("https://x/unscored")),
      "the last page must be entirely unscored postings"
    );

    const all = [...page1.items, ...page2.items, ...page3.items].map((item) => item.job_posting_url);
    assert.strictEqual(new Set(all).size, 6, "no posting skipped or repeated across the boundary");
    assert.strictEqual(all.length, 6);
  });
}

// A second, unrelated resume -- built to answer LOW_MATCH_DESCRIPTION's requirements
// (Kubernetes, Rust/gRPC, distributed query planners, SRE on-call) that RESUME above never
// speaks to at all.
const SECONDARY_RESUME = `Tim Annan
Distributed Systems Engineer
Ran Kubernetes at production scale for a global fleet, owning distributed query planners and consensus protocols.
Deep expertise in Rust and gRPC service implementation.
Led the SRE on-call rotation, driving incident response for production systems.`;

// Proves posting_match_scores' PK is genuinely (posting_id, resume_key): scoring a second
// resume must not touch the first resume's rows, both must be independently queryable, and
// sort_by=match_desc/min_match_percent must be able to rank by either one on request.
async function testTwoResumesAreScoredAndRankedIndependently() {
  await withDb(async (db) => {
    await saveApplicantDocument({ kind: "resume", file_name: "resume.txt", content: Buffer.from(RESUME, "utf8") });
    await seedPosting(db, { url: "https://x/high", position: "GM High Match", description: HIGH_MATCH_DESCRIPTION, lastSeenOffsetSeconds: 20 });
    await seedPosting(db, { url: "https://x/low", position: "Eng Low Match", description: LOW_MATCH_DESCRIPTION, lastSeenOffsetSeconds: 10 });
    await rescoreMatches({ resume_key: "resume" });

    await saveApplicantDocument({
      kind: "resume_secondary",
      file_name: "resume-secondary.txt",
      content: Buffer.from(SECONDARY_RESUME, "utf8")
    });
    await rescoreMatches({ resume_key: "resume_secondary" });

    const rows = await db.all(`SELECT posting_id, resume_key, match_percent FROM posting_match_scores ORDER BY posting_id, resume_key;`);
    assert.strictEqual(rows.length, 4, "each posting must carry one row per resume, not one shared row");

    const primaryHigh = rows.find((row) => row.posting_id === 1 && row.resume_key === "resume");
    const secondaryHigh = rows.find((row) => row.posting_id === 1 && row.resume_key === "resume_secondary");
    const primaryLow = rows.find((row) => row.posting_id === 2 && row.resume_key === "resume");
    const secondaryLow = rows.find((row) => row.posting_id === 2 && row.resume_key === "resume_secondary");

    assert.strictEqual(Number(primaryHigh.match_percent), 75, "scoring the second resume must not disturb the first resume's existing scores");
    assert.strictEqual(Number(primaryLow.match_percent), 0);
    assert.ok(
      Number(secondaryLow.match_percent) > Number(primaryLow.match_percent),
      "the distributed-systems resume must score the low-for-the-primary-resume posting higher than the primary resume did"
    );
    assert.ok(
      Number(secondaryHigh.match_percent) < Number(primaryHigh.match_percent),
      "the distributed-systems resume must not score the hospitality-fit posting as well as the primary resume did"
    );

    // Ranking by the secondary resume must reorder results relative to the default.
    const rankedBySecondary = await listPostingsWithFilters({ sort_by: "match_desc", resume_key: "resume_secondary" });
    assert.strictEqual(rankedBySecondary.items[0].job_posting_url, "https://x/low", "resume_secondary ranks the distributed-systems posting first");

    const rankedByDefault = await listPostingsWithFilters({ sort_by: "match_desc" });
    assert.strictEqual(rankedByDefault.items[0].job_posting_url, "https://x/high", "the default resume key must still rank as before");

    // include_match must expose every resume's score on the row, not just whichever one
    // drove the ordering.
    const withAllScores = await listPostingsWithFilters({ include_match: true });
    const highItem = withAllScores.items.find((item) => item.job_posting_url === "https://x/high");
    assert.strictEqual(highItem.match_resume, "resume", "the flat match_* fields must say which resume they came from");
    assert.strictEqual(Math.round(highItem.match_scores.resume.match_percent), 75);
    assert.ok(
      Math.round(highItem.match_scores.resume_secondary.match_percent) < 75,
      "match_scores must carry the other resume's score alongside the one driving match_percent"
    );
  });
}

// The forward walk's WHERE clause only ever selects postings that already have a
// description, so a posting still missing one at scan time is invisible to it -- its id
// never advances last_scored_id, but a *later* posting's id can, leaving a gap below the
// checkpoint. The description backfill (posting-page-fetcher.js) runs on its own,
// independent, slower clock and can fill one in well after the forward walk has already
// passed its id -- see the Bug 2 writeup in posting-match.js. The gap sweep exists to catch
// exactly this.
async function testGapSweepCatchesADescriptionThatArrivesAfterTheCheckpointPassesIt() {
  await withDb(async (db) => {
    await saveApplicantDocument({ kind: "resume", file_name: "resume.txt", content: Buffer.from(RESUME, "utf8") });
    // No description yet -- invisible to the forward walk's WHERE clause.
    await seedPosting(db, { url: "https://x/late", position: "Late Description Role", description: null, lastSeenOffsetSeconds: 20 });
    // Has a description already, and a higher id, so scoring it moves last_scored_id past
    // the still-description-less posting above.
    await seedPosting(db, { url: "https://x/early", position: "Early Scored Role", description: HIGH_MATCH_DESCRIPTION, lastSeenOffsetSeconds: 10 });

    const first = await rescoreMatches({});
    assert.strictEqual(first.scored, 1, "only the posting that already has a description is scored");
    let rows = await db.all(`SELECT posting_id FROM posting_match_scores;`);
    assert.strictEqual(rows.length, 1);

    // The description backfill fills it in on its own schedule, after the forward walk has
    // already moved on.
    await db.run(`UPDATE Postings SET job_description = ? WHERE job_posting_url = ?;`, [LOW_MATCH_DESCRIPTION, "https://x/late"]);

    const second = await rescoreMatches({});
    assert.strictEqual(second.scored, 0, "nothing new for the forward walk -- the gap sits below last_scored_id");
    assert.ok(second.gap_scored >= 1, "the gap sweep must find and score the posting whose description arrived late");

    rows = await db.all(`SELECT posting_id, match_percent FROM posting_match_scores ORDER BY posting_id;`);
    assert.strictEqual(rows.length, 2, "both postings must be scored now, not just the one the forward walk originally saw");
  });
}

// A rebuild (fresh resume upload) re-scans everything from id 0, so there is nothing for the
// gap sweep to do yet -- it must not error or double-count on a rebuild pass.
async function testGapSweepIsANoOpDuringARebuild() {
  await withDb(async (db) => {
    await saveApplicantDocument({ kind: "resume", file_name: "resume.txt", content: Buffer.from(RESUME, "utf8") });
    await seedPosting(db, { url: "https://x/a", position: "GM", description: HIGH_MATCH_DESCRIPTION });
    const summary = await rescoreMatches({ rebuild: true });
    assert.strictEqual(summary.rebuilt, true);
    assert.strictEqual(summary.gap_scored, 0);
  });
}

// match_status must distinguish four states a caller cannot currently tell apart from a bare
// match_available boolean: genuinely scored, scored-but-nothing-to-score-against (no
// requirements section detected), not-yet-scored-but-scorable (pending, e.g. mid-backfill),
// and no-description-at-all. And a resume key that has never been scored must still appear
// in match_scores as pending, not be silently omitted -- omission is what made
// resume_secondary look entirely absent instead of catching up.
async function testMatchStatusDistinguishesScoredPendingAndNoRequirements() {
  await withDb(async (db) => {
    await saveApplicantDocument({ kind: "resume", file_name: "resume.txt", content: Buffer.from(RESUME, "utf8") });
    await seedPosting(db, { url: "https://x/scored", position: "Scored Role", description: HIGH_MATCH_DESCRIPTION, lastSeenOffsetSeconds: 30 });
    // Plain prose with no recognisable section header at all -- extractSections finds no
    // requirements, so a row is still written but with nothing scorable in it.
    await seedPosting(db, {
      url: "https://x/norequirements",
      position: "No Requirements Section Role",
      description: "This role involves a variety of duties across the organization, working with many stakeholders day to day.",
      lastSeenOffsetSeconds: 20
    });
    await seedPosting(db, { url: "https://x/nodescription", position: "No Description Role", description: null, lastSeenOffsetSeconds: 10 });
    await rescoreMatches({});

    // A second resume is uploaded but never scored -- it must still show up as pending.
    await saveApplicantDocument({ kind: "resume_secondary", file_name: "r2.txt", content: Buffer.from(SECONDARY_RESUME, "utf8") });

    const listed = await listPostingsWithFilters({ include_match: true });
    const byUrl = (url) => listed.items.find((item) => item.job_posting_url === url);

    const scored = byUrl("https://x/scored");
    assert.strictEqual(scored.match_scores.resume.match_status, "scored");
    assert.strictEqual(scored.match_scores.resume.match_available, true);
    assert.strictEqual(scored.match_scores.resume_secondary.match_status, "pending");
    assert.strictEqual(scored.match_scores.resume_secondary.match_available, false);
    assert.strictEqual(scored.match_scores.resume_secondary.match_percent, null);

    const noRequirements = byUrl("https://x/norequirements");
    assert.strictEqual(noRequirements.match_scores.resume.match_status, "no_requirements_detected");
    assert.strictEqual(
      noRequirements.match_scores.resume.match_available,
      false,
      "a scored row with no detectable requirements must not read as available"
    );
    assert.strictEqual(noRequirements.match_scores.resume.match_percent, null);

    const noDescription = byUrl("https://x/nodescription");
    assert.strictEqual(noDescription.match_scores.resume.match_status, "no_description");
    assert.strictEqual(noDescription.match_scores.resume.match_available, false);
  });
}

// Regression test for a real production incident: getMatchScoringStatus originally computed
// an exact pending_count via COUNT(*) FROM Postings WHERE job_description IS NOT NULL AND
// TRIM(job_description) <> '' -- a predicate with no supporting index, so it was a full scan
// of the single biggest table in the database. Measured directly against the live 8.5GB
// database, that took over two minutes and was the actual cause of "the MCP server is slow"
// (get_applicant_context calls this on every invocation). Pins down the fast replacement
// shape (max_posting_id + last_scored_id -> corpus_coverage_percent/caught_up, both O(1)
// lookups) so a future change doesn't reintroduce a full-table scan on this interactive path.
async function testMatchScoringStatusReportsProgressWithoutScanningPostings() {
  await withDb(async (db) => {
    await saveApplicantDocument({ kind: "resume", file_name: "resume.txt", content: Buffer.from(RESUME, "utf8") });
    await seedPosting(db, { url: "https://x/a", position: "GM", description: HIGH_MATCH_DESCRIPTION });
    await seedPosting(db, { url: "https://x/b", position: "Eng", description: LOW_MATCH_DESCRIPTION });
    await rescoreMatches({});

    const status = await getMatchScoringStatus();
    assert.strictEqual(status.max_posting_id, 2, "MAX(id), not a scan over job_description");
    assert.strictEqual(status.per_resume.length, 1);
    const resumeStatus = status.per_resume[0];
    assert.strictEqual(resumeStatus.resume_key, "resume");
    assert.strictEqual(resumeStatus.scored_count, 2);
    assert.strictEqual(resumeStatus.last_scored_id, 2);
    assert.strictEqual(resumeStatus.caught_up, true);
    assert.strictEqual(resumeStatus.corpus_coverage_percent, 100);
    // The expensive, since-removed fields must not quietly come back.
    assert.strictEqual(Object.prototype.hasOwnProperty.call(status, "total_postings_with_description"), false);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(resumeStatus, "pending_count"), false);
  });
}

async function main() {
  testComputeMatchForPostingMatchesTheApplicationFormula();
  await testRescoreMatchesIsIncremental();
  await testResumeReuploadForcesARescore();
  await testListPostingsSortsByMatchAndFiltersByMinimum();
  await testMatchDescPaginatesAcrossChunks();
  await testMatchDescPaginatesAcrossTheScoredUnscoredBoundary();
  await testTwoResumesAreScoredAndRankedIndependently();
  await testGapSweepCatchesADescriptionThatArrivesAfterTheCheckpointPassesIt();
  await testGapSweepIsANoOpDuringARebuild();
  await testMatchStatusDistinguishesScoredPendingAndNoRequirements();
  await testMatchScoringStatusReportsProgressWithoutScanningPostings();
  console.log("posting-match-index tests passed");
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = { main };
