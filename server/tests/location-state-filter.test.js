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

  assert.equal(
    rowMatchesLocationFilters("Fort Washington, PA, United States", ["WA"], [], [], []),
    false,
    "WA filter should not match Fort Washington, PA"
  );

  assert.equal(
    rowMatchesLocationFilters("Fort Washington, MD, United States", ["WA"], [], [], []),
    false,
    "WA filter should not match Fort Washington, MD"
  );

  assert.equal(
    rowMatchesLocationFilters("New Washington, OH, United States", ["WA"], [], [], []),
    false,
    "WA filter should not match New Washington, OH"
  );

  assert.equal(
    rowMatchesLocationFilters("Fort Washington, PA, United States", ["PA"], [], [], []),
    true,
    "PA filter should still match Fort Washington, PA"
  );

  // A bare state name is normally the state, but most state names are also towns in some
  // other state. US locations are city-first, so the segment after the name settles it.
  for (const location of [
    "Washington, PA",
    "Washington, IN",
    "Washington, PA, United States",
    "Washington, IN, United States",
    "Washington, MO",
    "Washington, UT",
    "Washington, Pennsylvania"
  ]) {
    assert.equal(
      rowMatchesLocationFilters(location, ["WA"], [], [], []),
      false,
      `WA filter should not match the town of ${location}`
    );
  }

  for (const [location, code] of [
    ["Indiana, PA, United States", "IN"],
    ["California, MD, United States", "CA"],
    ["Nevada, MO, United States", "NV"],
    ["Wyoming, MI, United States", "WY"],
    ["Delaware, OH, United States", "DE"]
  ]) {
    assert.equal(
      rowMatchesLocationFilters(location, [code], [], [], []),
      false,
      `${code} filter should not match the town of ${location}`
    );
  }

  assert.equal(
    rowMatchesLocationFilters("Washington, PA, United States", ["PA"], [], [], []),
    true,
    "PA filter should still match the town of Washington, PA"
  );

  for (const location of [
    "Washington, United Kingdom",
    "Washington, Tyne and Wear, United Kingdom",
    "Chinnor, United Kingdom / Washington, United Kingdom"
  ]) {
    assert.equal(
      rowMatchesLocationFilters(location, ["WA"], [], [], []),
      false,
      `WA filter should not match the English town of ${location}`
    );
  }

  assert.equal(
    rowMatchesLocationFilters("Portland, OR / Seattle, Washington, United States", ["WA"], [], [], []),
    true,
    "WA filter should match the WA half of a multi-location posting listed after another state"
  );

  // The segment splitter also breaks on "/", so a multi-location posting flattens into a
  // single list. Its genuine WA match must survive the other location's state code.
  assert.equal(
    rowMatchesLocationFilters("Seattle, Washington / Portland, OR", ["WA"], [], [], []),
    true,
    "WA filter should still match a multi-location posting that also lists Portland, OR"
  );

  console.log("location-state-filter tests passed");
}

run();
