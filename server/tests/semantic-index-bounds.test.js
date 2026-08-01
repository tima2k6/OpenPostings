const assert = require("node:assert");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");

const { getDb, setDb } = require("../services/runtime-context.js");
const { rebuildSemanticIndex } = require("../services/semantic-search.js");
const { readPositiveIntegerArg } = require("../scripts/build-semantic-index.js");

async function testBoundedIndexingResumesFromPersistedState() {
  const previousDb = getDb();
  const db = await open({ filename: ":memory:", driver: sqlite3.Database });
  try {
    setDb(db);
    await db.exec(`
      CREATE TABLE Postings (
        id INTEGER PRIMARY KEY,
        position_name TEXT,
        company_name TEXT,
        job_description TEXT
      );
    `);
    for (let id = 1; id <= 5; id += 1) {
      await db.run(
        `INSERT INTO Postings (id, position_name, company_name, job_description)
         VALUES (?, ?, ?, ?);`,
        [id, `Role ${id}`, "Example", `alphaword duties for posting ${id}`]
      );
    }

    const first = await rebuildSemanticIndex({ batch_size: 2, max_batches: 1 });
    assert.deepStrictEqual(
      { indexed: first.indexed, batches: first.batches, last_id: first.last_id, complete: first.complete },
      { indexed: 2, batches: 1, last_id: 2, complete: false }
    );

    const second = await rebuildSemanticIndex({ batch_size: 2, max_batches: 1 });
    assert.deepStrictEqual(
      { indexed: second.indexed, batches: second.batches, last_id: second.last_id, complete: second.complete },
      { indexed: 2, batches: 1, last_id: 4, complete: false }
    );

    const final = await rebuildSemanticIndex({ batch_size: 2, max_batches: 1 });
    assert.deepStrictEqual(
      { indexed: final.indexed, batches: final.batches, last_id: final.last_id, complete: final.complete },
      { indexed: 1, batches: 1, last_id: 5, complete: true }
    );

    const matches = await db.all(
      `SELECT rowid FROM postings_fts WHERE postings_fts MATCH 'alphaword' ORDER BY rowid;`
    );
    assert.deepStrictEqual(matches.map((row) => row.rowid), [1, 2, 3, 4, 5]);
  } finally {
    setDb(previousDb);
    await db.close();
  }
}

function testWorkerArgumentValidation() {
  assert.strictEqual(readPositiveIntegerArg(["--max-batches", "7"], "--max-batches", 3), 7);
  assert.strictEqual(readPositiveIntegerArg([], "--max-batches", 3), 3);
  assert.throws(
    () => readPositiveIntegerArg(["--max-batches", "0"], "--max-batches", 3),
    /positive integer/
  );
}

async function main() {
  await testBoundedIndexingResumesFromPersistedState();
  testWorkerArgumentValidation();
  console.log("semantic index bounds tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
