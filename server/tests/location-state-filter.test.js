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

  assert.equal(
    rowMatchesLocationFilters("Portland, OR", ["OR"], [], [], []),
    true,
    "OR filter should match standard City, ST format"
  );

  assert.equal(
    rowMatchesLocationFilters("Portland, OR 97201", ["OR"], [], [], []),
    true,
    "OR filter should match City, ST ZIP format"
  );

  assert.equal(
    rowMatchesLocationFilters("Chicago, IL or Remote", ["OR"], [], [], []),
    false,
    "OR filter should not match the word 'or' inside a longer phrase"
  );

  assert.equal(
    rowMatchesLocationFilters("Remote - based in USA", ["IN"], [], [], []),
    false,
    "IN filter should not match the word 'in' inside a longer phrase"
  );

  assert.equal(
    rowMatchesLocationFilters("Indianapolis, IN", ["IN"], [], [], []),
    true,
    "IN filter should still match a genuine Indiana City, ST location"
  );

  assert.equal(
    rowMatchesLocationFilters("Charleston, West Virginia, United States", ["VA"], [], [], []),
    false,
    "VA filter should not match West Virginia locations"
  );

  assert.equal(
    rowMatchesLocationFilters("Charleston, West Virginia, United States", ["WV"], [], [], []),
    true,
    "WV filter should match West Virginia locations"
  );

  assert.equal(
    rowMatchesLocationFilters("Richmond, Virginia, United States", ["VA"], [], [], []),
    true,
    "VA filter should still match plain Virginia locations"
  );

  console.log("location-state-filter tests passed");
}

run();
