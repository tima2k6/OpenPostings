const assert = require("assert");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const { setDb } = require("../services/runtime-context.js");
const { ensurePostingReviewSchema } = require("../services/posting-review.js");
const { createServer } = require("../index.js");

async function request(baseUrl, path, method, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Origin: "http://localhost:8081" },
    body: JSON.stringify(body)
  });
  return { status: response.status, body: await response.json() };
}

async function main() {
  const db = await open({ filename: ":memory:", driver: sqlite3.Database });
  setDb(db);
  await db.exec(`
    CREATE TABLE posting_application_state (
      job_posting_url TEXT PRIMARY KEY,
      applied INTEGER NOT NULL DEFAULT 0,
      applied_by_type TEXT NOT NULL DEFAULT 'manual',
      applied_by_label TEXT NOT NULL DEFAULT '',
      applied_at_epoch INTEGER,
      last_application_id INTEGER,
      ignored INTEGER NOT NULL DEFAULT 0,
      ignored_at_epoch INTEGER,
      ignored_by_label TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  await ensurePostingReviewSchema(db);

  const server = createServer().listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const invalid = await request(baseUrl, "/postings/review-state", "PATCH", {
      job_posting_url: "https://example.com/role",
      review_state: "maybe"
    });
    assert.strictEqual(invalid.status, 400);

    const shortlisted = await request(baseUrl, "/postings/review-state", "PATCH", {
      job_posting_url: "https://example.com/role",
      review_state: "shortlisted"
    });
    assert.strictEqual(shortlisted.status, 200);
    assert.strictEqual(shortlisted.body.item.review_state, "shortlisted");

    const ignored = await request(baseUrl, "/postings/ignore", "POST", {
      job_posting_url: "https://example.com/role",
      ignored: true,
      ignored_by_label: "API compatibility"
    });
    assert.strictEqual(ignored.status, 200);
    assert.strictEqual(ignored.body.item.ignored, true);
    assert.strictEqual(ignored.body.item.review_state, "ignored");

    const forbidden = await fetch(`${baseUrl}/health`, { headers: { Origin: "https://remote.example" } });
    assert.strictEqual(forbidden.status, 403);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await db.close();
  }
  console.log("api-review-state tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
