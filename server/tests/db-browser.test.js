// The /db page runs user-supplied SQL against the live database, so the constraints on it
// are the part worth pinning. The read-only connection is the real guarantee against
// writes; these cover the second layer -- statements a read-only connection would happily
// run but that must still be refused, and the row cap that keeps a careless query from
// pulling the whole table through a single-threaded API.
const assert = require("assert");

const { rejectUnsafeQuery, isReadableTableName } = require("../services/db-browser.js");
const { DB_BROWSER_PAGE } = require("../services/db-browser-page.js");

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

function testSchemaHidesProtectedTables() {
  assert.strictEqual(isReadableTableName("Postings"), true);
  assert.strictEqual(isReadableTableName("companies"), true);
  for (const name of ["McpSettings", "PersonalInformation", "applicant_documents", "application_answers", "sqlite_sequence"]) {
    assert.strictEqual(isReadableTableName(name), false, `schema must hide ${name}`);
  }
}

// The whole browser page is emitted from a template literal that contains the page's own
// JavaScript, so an escape that is valid in the outer literal can still be a syntax error
// in the browser -- and because it is one script tag, that does not break one feature, it
// breaks the entire page. Nothing about the file looks wrong when this happens, and no
// server-side check catches it. Parsing what is actually served does.
//
// This is not hypothetical: writing `app\'s` inside a single-quoted string emitted a raw
// apostrophe and took the page down.
function testEmittedPageScriptParses() {
  const scripts = [...DB_BROWSER_PAGE.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map((match) => match[1]);
  assert.ok(scripts.length > 0, "the page must carry its script inline");

  for (const [index, source] of scripts.entries()) {
    assert.doesNotThrow(
      // eslint-disable-next-line no-new-func
      () => new Function(source),
      `inline script #${index} in the served /db page is not parseable`
    );
  }
}

// The pill is the one thing on this page that reports why a posting is hidden, and the two
// reasons mean opposite things to a job seeker: delisted is gone, outside_date_window is
// still open. They must not render the same, and the still-open one must not be styled as
// a warning.
function testHiddenPillDistinguishesReasons() {
  const match = DB_BROWSER_PAGE.match(/function hiddenPill\(r\) \{[\s\S]*?\n {2}\}/);
  assert.ok(match, "hiddenPill must be present in the served page");
  // eslint-disable-next-line no-new-func
  const hiddenPill = new Function(`${match[0]}; return hiddenPill;`)();

  assert.strictEqual(hiddenPill({ hidden: 0, hidden_reason: "" }), "", "a visible posting gets no pill");

  const stale = hiddenPill({ hidden: 1, hidden_reason: "outside_date_window" });
  assert.match(stale, /still listed/i, "a still-listed posting must say so, not just 'hidden'");
  assert.ok(!/class="pill warn"/.test(stale), "a still-applyable posting must not be styled as a warning");

  const delisted = hiddenPill({ hidden: 1, hidden_reason: "delisted" });
  assert.match(delisted, /delisted/i);
  assert.match(delisted, /class="pill warn"/, "a delisted posting is a warning -- it cannot be applied to");

  assert.notStrictEqual(stale, delisted, "the two reasons must not render identically");
}

// The page is one inline script driving markup in the same string, wired entirely by
// getElementById. Moving a control between panels, renaming a field, or deleting one leaves
// the script reaching for an element that no longer exists -- which throws during setup and
// blanks the whole page, with nothing on the server to notice. There is no DOM here to
// render in, so the reachability is checked statically instead.
function testEveryScriptReferenceResolves() {
  const markup = DB_BROWSER_PAGE.split("<script>")[0];
  const script = DB_BROWSER_PAGE.match(/<script>([\s\S]*)<\/script>/)[1];

  const ids = new Set([...markup.matchAll(/id="([a-zA-Z0-9_-]+)"/g)].map((match) => match[1]));
  const referenced = new Set([...script.matchAll(/getElementById\("([a-zA-Z0-9_-]+)"\)/g)].map((match) => match[1]));
  // Tab and panel ids are built by concatenation at runtime, so they never appear as
  // literals in a getElementById call and cannot be checked this way.
  const builtAtRuntime = new Set([
    "tab-companies", "tab-postings", "tab-sql",
    "panel-companies", "panel-postings", "panel-sql"
  ]);

  const missing = [...referenced].filter((id) => !ids.has(id) && !builtAtRuntime.has(id));
  assert.deepStrictEqual(missing, [], `script reaches for elements that do not exist: ${missing.join(", ")}`);

  // The filter maps are the other place an id can go stale without anything complaining.
  const mapped = [...script.matchAll(/"(f-[a-z-]+)":/g)].map((match) => match[1]);
  assert.ok(mapped.length > 0, "the filter map must be present");
  const unmapped = mapped.filter((id) => !ids.has(id));
  assert.deepStrictEqual(unmapped, [], `filter map points at missing elements: ${unmapped.join(", ")}`);
}

// Postings is the tab this page exists for; opening on Companies cost a click every visit.
function testPostingsIsTheDefaultTab() {
  assert.match(DB_BROWSER_PAGE, /id="tab-postings" aria-selected="true"/, "Postings must be the selected tab");
  assert.match(DB_BROWSER_PAGE, /id="panel-companies" hidden/, "Companies must start hidden");
  assert.ok(
    !/id="panel-postings" hidden/.test(DB_BROWSER_PAGE),
    "the Postings panel must start visible"
  );
}

function testUsabilityControlsStayWired() {
  assert.match(DB_BROWSER_PAGE, /var DEFAULT_FILTERS = \{ visibility: "open", sort: "last_seen", dir: "desc", limit: "200" \}/);
  assert.match(DB_BROWSER_PAGE, /id="posting-share"/, "a filtered search should be easy to share");
  assert.match(DB_BROWSER_PAGE, /history\.pushState/, "searches should create usable back-button history");
  assert.match(DB_BROWSER_PAGE, /request !== postingRequest/, "an older response must not replace newer results");
  assert.match(DB_BROWSER_PAGE, /id="posting-export"/, "current results should be exportable");
  assert.match(DB_BROWSER_PAGE, /class="linkbtn company-drill"/, "company results should support drill-down");
  assert.match(DB_BROWSER_PAGE, /replace\(\/"\/g, "&quot;"\)/, "database values used in attributes must escape quotes");
  assert.match(DB_BROWSER_PAGE, /id="schema-out"/, "SQL users should have an in-page schema reference");
  assert.match(DB_BROWSER_PAGE, /get\("\/db\/schema"\)/, "the schema reference must load from the safe API");
  assert.match(DB_BROWSER_PAGE, /data-preset="fresh-remote"/, "the page should offer approachable starting points");
  assert.match(DB_BROWSER_PAGE, /Find the signal in your job data/, "the page should explain its purpose in human terms");
}

function main() {
  testWritesAreRefused();
  testSelectsAreAllowed();
  testSensitiveTablesAreRefused();
  testStatementStackingIsRefused();
  testFileReachingIsRefused();
  testEmptyIsRefused();
  testSchemaHidesProtectedTables();
  testEmittedPageScriptParses();
  testHiddenPillDistinguishesReasons();
  testEveryScriptReferenceResolves();
  testPostingsIsTheDefaultTab();
  testUsabilityControlsStayWired();
  console.log("db-browser tests passed");
}

main();
