const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");

const { compactDatabase, formatBytes, main } = require("../scripts/compact-database.js");

async function testCompactionEnablesIncrementalVacuumAndPreservesData() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openpostings-compact-"));
  const filename = path.join(dir, "test.db");
  const db = await open({ filename, driver: sqlite3.Database });
  try {
    await db.exec(`CREATE TABLE values_to_keep (value TEXT NOT NULL);`);
    await db.run(`INSERT INTO values_to_keep (value) VALUES ('kept');`);
  } finally {
    await db.close();
  }

  try {
    const summary = await compactDatabase({ filename });
    assert.strictEqual(summary.path, filename);
    assert.ok(summary.after_bytes > 0);

    const reopened = await open({ filename, driver: sqlite3.Database });
    try {
      const mode = await reopened.get(`PRAGMA auto_vacuum;`);
      const row = await reopened.get(`SELECT value FROM values_to_keep;`);
      assert.strictEqual(Number(mode.auto_vacuum), 2);
      assert.strictEqual(row.value, "kept");
    } finally {
      await reopened.close();
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function testConfirmationIsRequired() {
  await assert.rejects(() => main([]), /without --yes/);
}

async function run() {
  assert.strictEqual(formatBytes(1024), "1.00 KiB");
  await testCompactionEnablesIncrementalVacuumAndPreservesData();
  await testConfirmationIsRequired();
  console.log("database compaction tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
