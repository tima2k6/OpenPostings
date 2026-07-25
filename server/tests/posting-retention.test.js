const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { openDatabase } = require("../db/open-database.js");
const { setDb, getDb } = require("../services/runtime-context.js");
const {
  createCanonicalPostingsTable,
  pruneExpiredPostings,
  deleteExpiredHiddenPostings
} = require("../services/sync-runtime.js");

const DAY_SECONDS = 24 * 60 * 60;
const NOW = 1800000000;

async function seedPosting(db, { url, firstSeen, hidden = 0, hiddenAt = null, description = "body" }) {
  await db.run(
    `
      INSERT INTO Postings (
        company_name, position_name, job_posting_url, job_description,
        first_seen_epoch, last_seen_epoch, hidden, hidden_at_epoch
      )
      VALUES ('Acme', 'Engineer', ?, ?, ?, ?, ?, ?);
    `,
    [url, description, firstSeen, firstSeen, hidden, hiddenAt]
  );
}

async function withDb(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openpostings-retention-"));
  const filename = path.join(dir, "test.db");
  setDb(await openDatabase({ filename }));
  try {
    await createCanonicalPostingsTable();
    await run(getDb());
  } finally {
    setDb(null);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function testPruneHidesAndClearsDescriptions() {
  await withDb(async (db) => {
    await seedPosting(db, { url: "https://x/fresh", firstSeen: NOW - 60 });
    await seedPosting(db, { url: "https://x/stale", firstSeen: NOW - 3 * DAY_SECONDS });

    const hiddenCount = await pruneExpiredPostings(NOW);
    assert.strictEqual(hiddenCount, 1, "only the stale posting should be hidden");

    const stale = await db.get(`SELECT hidden, hidden_at_epoch, job_description FROM Postings WHERE job_posting_url = 'https://x/stale';`);
    assert.strictEqual(Number(stale.hidden), 1);
    assert.strictEqual(Number(stale.hidden_at_epoch), NOW, "hidden_at_epoch drives retention and must be stamped");
    assert.strictEqual(stale.job_description, null, "description must be cleared at hide time");

    const fresh = await db.get(`SELECT hidden, job_description FROM Postings WHERE job_posting_url = 'https://x/fresh';`);
    assert.strictEqual(Number(fresh.hidden), 0);
    assert.strictEqual(fresh.job_description, "body", "visible postings keep their description");
  });
}

async function testPruneKeepsOriginalHiddenAtEpoch() {
  await withDb(async (db) => {
    const originalHiddenAt = NOW - 10 * DAY_SECONDS;
    await seedPosting(db, {
      url: "https://x/already-hidden",
      firstSeen: NOW - 20 * DAY_SECONDS,
      hidden: 1,
      hiddenAt: originalHiddenAt
    });

    await pruneExpiredPostings(NOW);

    const row = await db.get(`SELECT hidden_at_epoch FROM Postings WHERE job_posting_url = 'https://x/already-hidden';`);
    assert.strictEqual(
      Number(row.hidden_at_epoch),
      originalHiddenAt,
      "re-running the prune must not push the retention clock forward"
    );
  });
}

async function testDeleteRespectsRetentionWindow() {
  await withDb(async (db) => {
    await seedPosting(db, { url: "https://x/visible", firstSeen: NOW - 60 });
    await seedPosting(db, { url: "https://x/hidden-recent", firstSeen: NOW - 5 * DAY_SECONDS, hidden: 1, hiddenAt: NOW - 5 * DAY_SECONDS });
    await seedPosting(db, { url: "https://x/hidden-old", firstSeen: NOW - 60 * DAY_SECONDS, hidden: 1, hiddenAt: NOW - 31 * DAY_SECONDS });
    await seedPosting(db, { url: "https://x/hidden-no-stamp", firstSeen: NOW - 60 * DAY_SECONDS, hidden: 1, hiddenAt: null });

    const deleted = await deleteExpiredHiddenPostings(NOW);
    assert.strictEqual(deleted, 1, "only the posting hidden beyond the retention window should go");

    const remaining = await db.all(`SELECT job_posting_url FROM Postings ORDER BY job_posting_url;`);
    assert.deepStrictEqual(
      remaining.map((row) => row.job_posting_url),
      ["https://x/hidden-no-stamp", "https://x/hidden-recent", "https://x/visible"],
      "visible, recently hidden, and unstamped rows must all survive"
    );
  });
}

async function testDeleteChunksBeyondOneBatch() {
  await withDb(async (db) => {
    const total = 1900;
    for (let index = 0; index < total; index += 1) {
      await seedPosting(db, {
        url: `https://x/bulk/${index}`,
        firstSeen: NOW - 60 * DAY_SECONDS,
        hidden: 1,
        hiddenAt: NOW - 40 * DAY_SECONDS
      });
    }
    await seedPosting(db, { url: "https://x/keep", firstSeen: NOW - 60 });

    const deleted = await deleteExpiredHiddenPostings(NOW);
    assert.strictEqual(deleted, total, "every expired row must be deleted across chunk boundaries");

    const row = await db.get(`SELECT COUNT(*) AS count FROM Postings;`);
    assert.strictEqual(Number(row.count), 1, "only the visible posting should remain");
  });
}

async function testDeleteIsNoOpWhenNothingExpired() {
  await withDb(async (db) => {
    await seedPosting(db, { url: "https://x/only", firstSeen: NOW - 60 });
    const deleted = await deleteExpiredHiddenPostings(NOW);
    assert.strictEqual(deleted, 0);
    const row = await db.get(`SELECT COUNT(*) AS count FROM Postings;`);
    assert.strictEqual(Number(row.count), 1);
  });
}

async function main() {
  await testPruneHidesAndClearsDescriptions();
  await testPruneKeepsOriginalHiddenAtEpoch();
  await testDeleteRespectsRetentionWindow();
  await testDeleteChunksBeyondOneBatch();
  await testDeleteIsNoOpWhenNothingExpired();
  console.log("posting-retention tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
