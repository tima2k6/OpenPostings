// Facets drive drill-down, so the property that matters is monotonicity: clicking a facet
// value must narrow the set, never widen it. These cover the tokenising that produces the
// title facet, since that is where a bad split would surface as nonsense chips.
const assert = require("assert");

const { titleWords } = require("../services/db-facets.js");

function testTitleTokenising() {
  assert.deepStrictEqual(titleWords("Senior Operations Manager"), ["senior", "operations", "manager"]);
  // Punctuation splits, and slash/hyphen compounds become separate words so "F&B" style
  // titles still contribute their parts.
  assert.deepStrictEqual(titleWords("Manager, Food/Beverage - Resort"), ["manager", "food", "beverage", "resort"]);
  // Stopwords and bare numbers would top every list without saying anything.
  assert.deepStrictEqual(titleWords("Director of the New Job I"), ["director"]);
  assert.deepStrictEqual(titleWords("Manager 3 (2 openings)"), ["manager", "openings"]);
  assert.deepStrictEqual(titleWords(""), []);
  assert.deepStrictEqual(titleWords(null), []);
}

function testShortTokensAreDropped() {
  // Two-letter fragments are noise in a title facet; they carry no signal on their own.
  assert.ok(!titleWords("VP of HR").includes("vp"));
  assert.ok(!titleWords("VP of HR").includes("hr"));
}

function main() {
  testTitleTokenising();
  testShortTokensAreDropped();
  console.log("db-facets tests passed");
}

main();
