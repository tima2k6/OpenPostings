// Several read-only endpoints (personal information, MCP settings, blocked companies,
// applicant documents, the error log, application answers) used to call getDb() -- the
// same connection the sync writes through -- instead of getReadDb(). WAL lets a separate
// reader see committed data without blocking on or waiting for the writer; a read that
// stays on getDb() gets none of that and queues behind whatever write transaction the sync
// is mid-flight on, which is the timeout described in src/api.js's own error message.
//
// This pins the fix down structurally: register a *distinguishable* reader connection and
// assert each function's query actually runs on it, not on the writer. A future regression
// that reintroduces getDb() into one of these read paths shows up here as a reader call
// count that never moved, rather than as an intermittent timeout under load.
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { openDatabase } = require("../db/open-database.js");
const { setDb, setReaderDb, resetReaderDb } = require("../services/runtime-context.js");

function instrument(db) {
  let reads = 0;
  const originalGet = db.get.bind(db);
  const originalAll = db.all.bind(db);
  db.get = async (...args) => {
    reads += 1;
    return originalGet(...args);
  };
  db.all = async (...args) => {
    reads += 1;
    return originalAll(...args);
  };
  return { readCount: () => reads };
}

async function withDbs(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openpostings-reader-routing-"));
  const filename = path.join(dir, "test.db");
  const writer = await openDatabase({ filename });
  const reader = await openDatabase({ filename });
  setDb(writer);
  setReaderDb(reader);
  const writerCounter = instrument(writer);
  const readerCounter = instrument(reader);
  try {
    await run({ writerCounter, readerCounter });
  } finally {
    resetReaderDb();
    setDb(null);
  }
}

// Calls `task`, which is expected to perform exactly one logical read after any of its own
// table-creation/seed side effects have already run, and asserts that read landed on the
// reader connection and not the writer.
async function assertReadsFromReader(label, counters, task) {
  const writerBefore = counters.writerCounter.readCount();
  const readerBefore = counters.readerCounter.readCount();
  await task();
  const writerAfter = counters.writerCounter.readCount();
  const readerAfter = counters.readerCounter.readCount();
  assert.ok(
    readerAfter > readerBefore,
    `${label}: expected a read on the reader connection, but it made no queries`
  );
  assert.strictEqual(
    writerAfter,
    writerBefore,
    `${label}: expected no reads on the writer connection, but it made ${writerAfter - writerBefore}`
  );
}

async function testPersonalInformation() {
  await withDbs(async (counters) => {
    const { ensurePersonalInformationTable, getPersonalInformation } = require("../services/personal-info.js");
    await ensurePersonalInformationTable();
    await assertReadsFromReader("getPersonalInformation", counters, () => getPersonalInformation());
  });
}

async function testMcpSettings() {
  await withDbs(async (counters) => {
    const { getDb } = require("../services/runtime-context.js");
    await getDb().exec(`
      CREATE TABLE IF NOT EXISTS McpSettings (
        id INTEGER NOT NULL PRIMARY KEY CHECK (id = 1),
        enabled INTEGER NOT NULL DEFAULT 0,
        preferred_agent_name TEXT NOT NULL DEFAULT 'OpenPostings Agent',
        mfa_login_email TEXT NOT NULL DEFAULT '',
        mfa_login_notes TEXT NOT NULL DEFAULT '',
        dry_run_only INTEGER NOT NULL DEFAULT 1,
        require_final_approval INTEGER NOT NULL DEFAULT 1,
        max_applications_per_run INTEGER NOT NULL DEFAULT 10,
        preferred_search TEXT NOT NULL DEFAULT '',
        preferred_remote TEXT NOT NULL DEFAULT 'all',
        preferred_industries TEXT NOT NULL DEFAULT '[]',
        preferred_regions TEXT NOT NULL DEFAULT '[]',
        preferred_countries TEXT NOT NULL DEFAULT '[]',
        preferred_states TEXT NOT NULL DEFAULT '[]',
        preferred_counties TEXT NOT NULL DEFAULT '[]',
        instructions_for_agent TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    const { getMcpSettings } = require("../services/mcp.js");
    await assertReadsFromReader("getMcpSettings", counters, () => getMcpSettings());
  });
}

async function testBlockedCompanies() {
  await withDbs(async (counters) => {
    const { ensureBlockedCompaniesTable, listBlockedCompanies } = require("../services/blocked-companies.js");
    await ensureBlockedCompaniesTable();
    await assertReadsFromReader("listBlockedCompanies", counters, () => listBlockedCompanies());
  });
}

async function testApplicantDocuments() {
  await withDbs(async (counters) => {
    const { listApplicantDocuments } = require("../services/applicant-documents.js");
    // Unlike the other ensure* helpers, ensureApplicantDocumentsTable re-inspects the
    // schema (PRAGMA table_info, a sqlite_master lookup for a legacy CHECK constraint) on
    // every call, not just the first -- so the writer legitimately sees reads here too.
    // What matters is that the listing query itself lands on the reader.
    const readerBefore = counters.readerCounter.readCount();
    await listApplicantDocuments();
    assert.ok(
      counters.readerCounter.readCount() > readerBefore,
      "listApplicantDocuments: expected the listing query to run on the reader connection"
    );
  });
}

async function testErrorLog() {
  await withDbs(async (counters) => {
    const { listErrors } = require("../services/error-log.js");
    // ensureErrorLogTable runs internally on the writer every call; give it one warm-up
    // call so it is not attributed to the assertion below.
    await listErrors({});
    await assertReadsFromReader("listErrors", counters, () => listErrors({}));
  });
}

async function testApplicationAnswers() {
  await withDbs(async (counters) => {
    const { listApplicationAnswers } = require("../services/application-answers.js");
    // Same warm-up reasoning as listErrors: the seed/ensure step runs on the writer.
    await listApplicationAnswers();
    await assertReadsFromReader("listApplicationAnswers", counters, () => listApplicationAnswers());
  });
}

async function main() {
  await testPersonalInformation();
  await testMcpSettings();
  await testBlockedCompanies();
  await testApplicantDocuments();
  await testErrorLog();
  await testApplicationAnswers();
  console.log("reader-connection-routing tests passed");
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = { main };
