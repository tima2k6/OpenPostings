const assert = require("assert");
const { rowMatchesLocationFilters } = require("../helpers/description-filters");

function run() {
  assert.equal(
    rowMatchesLocationFilters("Seattle, Washington, United States", ["WA"], [], [], []),
    true,
    "WA filter should match Washington state locations"
  );

  assert.equal(
    rowMatchesLocationFilters("Washington, DC, United States", ["WA"], [], [], []),
    false,
    "WA filter should not match Washington, DC"
  );

  assert.equal(
    rowMatchesLocationFilters("Washington, District of Columbia, United States", ["WA"], [], [], []),
    false,
    "WA filter should not match District of Columbia locations"
  );

  assert.equal(
    rowMatchesLocationFilters("Seattle, WA, United States", ["WA"], [], [], []),
    true,
    "WA filter should match explicit WA abbreviation"
  );

  console.log("location-state-filter tests passed");
}

run();
