// Guards the shape of filters restored from device storage. Stored values can come
// from an older build or be hand-edited, so anything unexpected must collapse back
// to a safe default rather than reaching the query layer.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// src/filter-normalize.js is an ES module consumed by Metro. Load it here without
// a bundler by rewriting its export keywords, which is enough for this file since
// it has no imports of its own.
function loadFilterNormalize() {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "..", "src", "filter-normalize.js"),
    "utf8"
  );
  const cjsSource = source.replace(/^export (const|function) /gm, "$1 ");
  const sandboxModule = { exports: {} };
  vm.runInNewContext(
    `${cjsSource}\nmodule.exports = { DEFAULT_POSTINGS_FILTERS, normalizePersistedFilters, normalizePersistedSearch };`,
    { module: sandboxModule }
  );
  return sandboxModule.exports;
}

function run() {
  const { DEFAULT_POSTINGS_FILTERS, normalizePersistedFilters, normalizePersistedSearch } =
    loadFilterNormalize();

  assert.deepEqual(
    normalizePersistedFilters(null),
    DEFAULT_POSTINGS_FILTERS,
    "missing stored value should fall back to defaults"
  );

  assert.deepEqual(
    normalizePersistedFilters("not-an-object"),
    DEFAULT_POSTINGS_FILTERS,
    "non-object stored value should fall back to defaults"
  );

  assert.deepEqual(
    normalizePersistedFilters({ states: ["WA", "OR"], hide_no_date: true, ats: "workday" }),
    {
      ...DEFAULT_POSTINGS_FILTERS,
      states: ["WA", "OR"],
      hide_no_date: true,
      ats: "workday"
    },
    "valid stored filters should round-trip"
  );

  assert.deepEqual(
    normalizePersistedFilters({ states: "WA" }).states,
    [],
    "a non-array where an array is expected should become empty"
  );

  assert.deepEqual(
    normalizePersistedFilters({ states: ["WA", "WA", " ", "OR"] }).states,
    ["WA", "OR"],
    "duplicate and blank entries should be dropped"
  );

  assert.deepEqual(
    normalizePersistedFilters({ remote: ["bogus"] }).remote,
    ["all"],
    "unknown remote values should collapse to all"
  );

  assert.deepEqual(
    normalizePersistedFilters({ remote: ["remote", "hybrid"] }).remote,
    ["remote", "hybrid"],
    "known remote values should be kept"
  );

  assert.equal(
    normalizePersistedFilters({ ats: "   " }).ats,
    "all",
    "a blank ats value should fall back to all"
  );

  assert.equal(
    normalizePersistedFilters({ hide_no_date: "yes" }).hide_no_date,
    false,
    "hide_no_date should only be true for a real boolean true"
  );

  assert.equal(
    normalizePersistedFilters({ unexpected_key: 1 }).unexpected_key,
    undefined,
    "unknown keys should not be carried through"
  );

  assert.equal(normalizePersistedSearch(undefined), "", "missing search should become an empty string");
  assert.equal(normalizePersistedSearch("nurse"), "nurse", "search text should round-trip");

  // sort_by reaches the API as a query param, so an unknown stored value must collapse to
  // the default rather than being forwarded.
  assert.equal(
    normalizePersistedFilters({ sort_by: "first_seen_desc" }).sort_by,
    "first_seen_desc",
    "a supported sort should round-trip"
  );
  assert.equal(
    normalizePersistedFilters({ sort_by: "company_asc" }).sort_by,
    "company_asc",
    "company_asc should round-trip"
  );
  for (const bogus of ["pay_desc", "", null, 7, {}]) {
    assert.equal(
      normalizePersistedFilters({ sort_by: bogus }).sort_by,
      "recent",
      `unsupported sort ${JSON.stringify(bogus)} should fall back to the default`
    );
  }
  assert.equal(
    normalizePersistedFilters({}).sort_by,
    "recent",
    "missing sort should default to recent"
  );

  assert.equal(
    normalizePersistedFilters({ resume: "resume_secondary" }).resume,
    "resume_secondary",
    "a slug-shaped resume key should round-trip"
  );
  for (const bogus of ["not a slug", "UPPER", "-leading-dash", "", null, 7, {}]) {
    assert.equal(
      normalizePersistedFilters({ resume: bogus }).resume,
      "resume",
      `non-slug resume ${JSON.stringify(bogus)} should fall back to the default`
    );
  }

  console.log("filter-normalize tests passed");
}

run();
