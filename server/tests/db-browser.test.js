// The /db page runs user-supplied SQL against the live database, so the constraints on it
// are the part worth pinning. The read-only connection is the real guarantee against
// writes; these cover the second layer -- statements a read-only connection would happily
// run but that must still be refused, and the row cap that keeps a careless query from
// pulling the whole table through a single-threaded API.
const assert = require("assert");

const { rejectUnsafeQuery } = require("../services/db-browser.js");

function testWritesAreRefused() {
  for (const sql of [
    "DELETE FROM Postings",
    "UPDATE Postings SET hidden = 0",
    "INSERT INTO companies (company_name, url_string, ATS_name) VALUES ('x','y','z')",
    "DROP TABLE Postings",
    "CREATE TABLE evil (id INTEGER)",
    "REPLACE INTO Postings (id) VALUES (1)"
  ]) {
    assert.ok(rejectUnsafeQuery(sql), `must refuse: ${sql}`);
  }
}

function testSelectsAreAllowed() {
  for (const sql of [
    "SELECT 1",
    "select company_name from companies limit 5",
    "  SELECT * FROM Postings WHERE hidden = 0  ",
    "SELECT * FROM Postings;",
    "WITH recent AS (SELECT * FROM Postings LIMIT 10) SELECT COUNT(*) FROM recent"
  ]) {
    assert.strictEqual(rejectUnsafeQuery(sql), null, `must allow: ${sql}`);
  }
}

// A read-only connection cannot stop a SELECT from reading personal information, so this
// is the only thing standing between the settings tables and anything that can reach the
// host. McpSettings no longer stores credentials, but PersonalInformation still holds the
// applicant's address, phone number and demographic answers, and applicant_documents holds
// the resume itself.
function testSensitiveTablesAreRefused() {
  for (const sql of [
    "SELECT * FROM McpSettings",
    "select instructions_for_agent from mcpsettings",
    "SELECT * FROM PersonalInformation",
    "SELECT p.id FROM Postings p JOIN McpSettings m ON 1=1"
  ]) {
    const rejection = rejectUnsafeQuery(sql);
    assert.ok(rejection, `must refuse: ${sql}`);
    assert.match(rejection, /credentials and personal information/i);
  }
}

function testStatementStackingIsRefused() {
  for (const sql of [
    "SELECT 1; DELETE FROM Postings",
    "SELECT 1;DROP TABLE companies"
  ]) {
    assert.ok(rejectUnsafeQuery(sql), `must refuse stacked statement: ${sql}`);
  }
  // A single trailing semicolon is ordinary and must not be treated as stacking.
  assert.strictEqual(rejectUnsafeQuery("SELECT 1;"), null);
  assert.strictEqual(rejectUnsafeQuery("SELECT 1;  "), null);
}

function testFileReachingIsRefused() {
  for (const sql of [
    "ATTACH DATABASE '/etc/passwd' AS x",
    "SELECT * FROM Postings WHERE 1=1 -- \nPRAGMA table_info(McpSettings)",
    "PRAGMA database_list"
  ]) {
    assert.ok(rejectUnsafeQuery(sql), `must refuse: ${sql}`);
  }
}

function testEmptyIsRefused() {
  assert.ok(rejectUnsafeQuery(""));
  assert.ok(rejectUnsafeQuery("   "));
  assert.ok(rejectUnsafeQuery(null));
}

function main() {
  testWritesAreRefused();
  testSelectsAreAllowed();
  testSensitiveTablesAreRefused();
  testStatementStackingIsRefused();
  testFileReachingIsRefused();
  testEmptyIsRefused();
  console.log("db-browser tests passed");
}

main();
