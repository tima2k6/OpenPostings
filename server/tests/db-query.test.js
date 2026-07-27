// The query builder turns untrusted query-string input into SQL, so the parts worth
// pinning are the ones where a mistake is either a hole (sort/direction reaching the
// statement unchecked) or a silent wrong answer (a NOT clause that also drops rows with no
// value, or a state pre-filter that discards postings whose location comes from the URL).
const assert = require("assert");

const { buildQuery, SORTABLE, MAX_ROWS } = require("../services/db-query.js");

function testTermsAreOredWithinAGroup() {
  const { sql, params } = buildQuery({ title_any: "manager, director , head of" });
  assert.strictEqual((sql.match(/LIKE \?/g) || []).length, 3, "each term contributes one comparison");
  assert.ok(/LIKE \? ESCAPE '\\' OR/.test(sql), "terms within a group must be OR-ed");
  assert.deepStrictEqual(params, ["%manager%", "%director%", "%head of%"]);
}

function testGroupsAreAndedTogether() {
  const { sql } = buildQuery({ title_any: "manager", title_none: "assistant" });
  assert.ok(/AND/.test(sql), "separate groups must be AND-ed");
  assert.ok(/NOT LIKE/.test(sql), "the exclusion group must negate");
}

// COALESCE matters: without it a NOT LIKE against a NULL column is NULL, not true, so
// every row with no location would be silently excluded by a location exclusion.
function testExclusionsKeepRowsWithNoValue() {
  const { sql } = buildQuery({ location_none: "remote" });
  assert.ok(
    /LOWER\(COALESCE\(location, ''\)\) NOT LIKE/.test(sql),
    "an exclusion must treat a missing value as 'does not contain', not as unknown"
  );
}

function testLikeWildcardsInUserTermsAreEscaped() {
  const { params } = buildQuery({ title_any: "100% remote_role" });
  assert.deepStrictEqual(params, ["%100\\% remote\\_role%"], "% and _ must be literals, not wildcards");
}

// sort and dir are interpolated rather than bound, so they must come from a fixed set.
function testSortIsWhitelisted() {
  const injected = buildQuery({ sort: "last_seen_epoch; DROP TABLE Postings --" });
  assert.ok(!/DROP/i.test(injected.sql), "an unknown sort must not reach the statement");
  assert.ok(/ORDER BY last_seen_epoch DESC/.test(injected.sql), "and must fall back to the default");

  for (const key of SORTABLE.keys()) {
    const { sql } = buildQuery({ sort: key });
    assert.ok(sql.includes(`ORDER BY ${SORTABLE.get(key)}`), `${key} must map to its column`);
  }

  assert.ok(/ DESC,/.test(buildQuery({ dir: "; DELETE FROM Postings" }).sql), "an unknown direction must fall back");
  assert.ok(/ ASC,/.test(buildQuery({ dir: "asc" }).sql));
}

function testLimitIsClamped() {
  assert.ok(buildQuery({ limit: "999999" }).sql.endsWith(`LIMIT ${MAX_ROWS}`), "limit must be capped");
  assert.ok(buildQuery({ limit: "-5" }).sql.endsWith("LIMIT 200"), "a nonsense limit falls back to the default");
  assert.ok(buildQuery({ limit: "25" }).sql.endsWith("LIMIT 25"));
}

// The state pre-filter is only a superset; the real matcher runs in JS afterwards. Rows
// with no stored location must survive it, or every Workday posting disappears.
function testStatePrefilterKeepsRowsWithNoLocation() {
  const { sql, params, stateCodes } = buildQuery({ states: "wa" });
  assert.deepStrictEqual(stateCodes, ["WA"], "codes are upper-cased for the JS matcher");
  assert.ok(
    /location IS NULL\s*\n?\s*OR TRIM\(location\) = ''/.test(sql.replace(/\s+/g, " ")) ||
      /location IS NULL OR TRIM\(location\) = ''/.test(sql.replace(/\s+/g, " ")),
    "rows with no stored location must stay candidates"
  );
  assert.ok(params.includes("%wa%"), "the bare code is one way a state can appear");
  assert.ok(params.includes("%washington%"), "the spelled-out name is the other");
}

function testEmptyInputProducesNoWhereClause() {
  const { sql, params } = buildQuery({});
  assert.ok(!/WHERE/.test(sql), "no filters means no predicate");
  assert.deepStrictEqual(params, []);
}

function testVisibilityAndPayPresence() {
  assert.ok(/hidden = 0/.test(buildQuery({ visibility: "visible" }).sql));
  assert.ok(/hidden = 1/.test(buildQuery({ visibility: "hidden" }).sql));
  assert.ok(!/hidden =/.test(buildQuery({ visibility: "all" }).sql), "'all' must not constrain visibility");
  assert.ok(/COALESCE\(pay_max, pay_min, 0\) > 0/.test(buildQuery({ has_pay: "1" }).sql));
}

function main() {
  testTermsAreOredWithinAGroup();
  testGroupsAreAndedTogether();
  testExclusionsKeepRowsWithNoValue();
  testLikeWildcardsInUserTermsAreEscaped();
  testSortIsWhitelisted();
  testLimitIsClamped();
  testStatePrefilterKeepsRowsWithNoLocation();
  testEmptyInputProducesNoWhereClause();
  testVisibilityAndPayPresence();
  console.log("db-query tests passed");
}

main();
