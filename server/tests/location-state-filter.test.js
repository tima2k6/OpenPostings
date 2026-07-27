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

  // AcademicJobsOnline spells the state out and puts the ZIP in the same segment. The
  // "City, ST ZIP" shape was already understood; the spelled-out one was not, so every
  // academic posting fell out of state filtering.
  for (const [location, code] of [
    ["Cambridge, Massachusetts 02139, United States of America", "MA"],
    ["Worcester, Massachusetts 01655, United States of America", "MA"],
    ["Durham, North Carolina 27708, United States of America", "NC"],
    ["Stanford, California 94305, United States of America", "CA"],
    ["Seattle, Washington 98101-1234", "WA"]
  ]) {
    assert.equal(
      rowMatchesLocationFilters(location, [code], [], [], []),
      true,
      `${code} filter should match a spelled-out state carrying a ZIP: ${location}`
    );
  }

  assert.equal(
    rowMatchesLocationFilters("Cambridge, Massachusetts 02139, United States of America", ["CA"], [], [], []),
    false,
    "a spelled-out state with a ZIP should still only match its own state"
  );

  // Trailing digits alone do not make a segment a state: a non-US postal code sits in the
  // same position, and the state name has to be the whole segment either way.
  assert.equal(
    rowMatchesLocationFilters("Sherbrooke, Quebec J1K 2R1, Canada", ["ME"], [], [], []),
    false,
    "a Canadian postal code should not be read as a US state segment"
  );

  assert.equal(
    rowMatchesLocationFilters("Washington, Indiana 47501, United States", ["WA"], [], [], []),
    false,
    "WA filter should not match the town of Washington just because a ZIP follows the state"
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

  // Hyphenated ATS slugs leave the state with no separate token, so the bare-code check
  // cannot see it. A leading "US" or a trailing US zip is what marks the slug American.
  for (const [location, code] of [
    ["US-WA-Redmond", "WA"],
    ["US-WA-Gig Harbor", "WA"],
    ["US-Texas-Fort Worth", "TX"],
    ["TX-Katy-77494", "TX"],
    ["IN-Mishawaka-46544", "IN"],
    ["CA-Lake Forest-92630", "CA"],
    ["OH-Dayton-45402 Hybrid - US", "OH"]
  ]) {
    assert.equal(
      rowMatchesLocationFilters(location, [code], [], [], []),
      true,
      `${code} filter should match the slug ${location}`
    );
  }

  for (const [location, code] of [
    ["US-GA-Atlanta", "WA"],
    ["US-WA-Redmond", "OR"],
    ["IN-HR-Gurgaon", "IN"],
    ["IN-TG-Hyderabad", "IN"],
    ["CA-ON-Toronto", "CA"],
    ["GB-ENG-London", "GB"],
    ["FR-31-Toulouse", "FR"]
  ]) {
    assert.equal(
      rowMatchesLocationFilters(location, [code], [], [], []),
      false,
      `${code} filter should not match ${location}`
    );
  }

  // Workday stores no location column; the value is inferred from the job URL and has no
  // space before the dash. Requiring one made every Workday posting unreachable by state.
  for (const [location, code] of [
    ["Washington- Seattle Campus", "WA"],
    ["Washington - Seattle Campus", "WA"],
    ["USA- California- West Hollywood", "CA"],
    ["USA- New York- New York", "NY"]
  ]) {
    assert.equal(
      rowMatchesLocationFilters(location, [code], [], [], []),
      true,
      `${code} filter should match the Workday-inferred location ${location}`
    );
  }

  for (const [location, code] of [
    ["Switzerland- Geneva", "WA"],
    ["USA- California- West Hollywood", "WA"],
    ["Washington- Seattle Campus", "CA"]
  ]) {
    assert.equal(
      rowMatchesLocationFilters(location, [code], [], [], []),
      false,
      `${code} filter should not match ${location}`
    );
  }

  // Splitting on a bare dash would break these; whitespace after the dash is what makes
  // the rule safe. Hyphenated place names and ATS slugs must survive intact.
  assert.equal(
    rowMatchesLocationFilters("Winston-Salem, NC, United States", ["NC"], [], [], []),
    true,
    "hyphenated city names must not be split apart"
  );
  assert.equal(
    rowMatchesLocationFilters("US-WA-Redmond", ["WA"], [], [], []),
    true,
    "hyphenated ATS slugs must still be read whole"
  );

  // Every string below is a real `location` value from the postings table. A WA search
  // returned all of them, because the District guard only sat on the route that reads the
  // spelled-out state name -- these arrive by the other two routes, the US-prefixed slug
  // and the bare code, both of which returned before the guard was consulted.
  for (const location of [
    "US-Washington, DC",
    "US-Washington, D.C.",
    "DC - Washington",
    "Washington, Washington, DC",
    "District of Columbia- Washington",
    // The ATS put a junk state beside a District city. Checked against the postings
    // themselves: every one is a Washington DC role, several of them federal contractors.
    "DC, WA",
    "Washington, DC, WA",
    "DC Capital Hill, WA"
  ]) {
    assert.equal(
      rowMatchesLocationFilters(location, ["WA"], [], [], []),
      false,
      `a WA search must not return the District: ${location}`
    );
  }

  // The reverse case, and the reason the District cannot simply be excluded on sight: a
  // posting may genuinely list a WA site alongside a DC one, and it belongs in a WA search.
  for (const location of [
    "Hybrid - US, Hybrid - San Francisco, CA, Hybrid - Seattle, WA, Hybrid - New York, NY, Hybrid - Washington DC",
    "Washington D.C, Los Angeles, CA; Seattle, WA"
  ]) {
    assert.equal(
      rowMatchesLocationFilters(location, ["WA"], [], [], []),
      true,
      `a real WA site is still a WA match when a DC site is listed beside it: ${location}`
    );
  }

  // Foreign subdivisions that abbreviate the same way as a US state. These are not the
  // country-code collisions the older guard handled (IN/India, LA/Laos): "WA" is not a
  // country code at all, so nothing was comparing Western Australia against Washington.
  for (const [location, stateCode] of [
    ["Perth, WA, Australia", "WA"],
    ["WA, WA, Australia", "WA"],
    ["Chennai, TN, India", "TN"],
    ["Lagos, LA, Nigeria", "LA"],
    ["Amsterdam, NH, Netherlands", "NH"],
    ["Al Ain, Abu Dhabi, United Arab Emirates", "AL"]
  ]) {
    assert.equal(
      rowMatchesLocationFilters(location, [stateCode], [], [], []),
      false,
      `${stateCode} names a foreign subdivision here, not the US state: ${location}`
    );
  }

  // The trailing segment is what settles the country, and only when it is not itself a US
  // state name. Reading any country-shaped word anywhere in the string instead reclassified
  // all of these American towns as foreign.
  for (const [location, stateCode] of [
    ["Lebanon, NH", "NH"],
    ["Holland, MI", "MI"],
    ["Jamaica, NY", "NY"],
    ["New Britain, CT", "CT"],
    ["Albuquerque, New Mexico", "NM"],
    ["Lebanon, IN", "IN"]
  ]) {
    assert.equal(
      rowMatchesLocationFilters(location, [stateCode], [], [], []),
      true,
      `an American town whose name is also a country's must still match ${stateCode}: ${location}`
    );
  }

  // Foreign subdivisions reuse US state abbreviations, and the bare-code test read them as
  // states: a WA filter kept every Perth posting. The country named alongside the code is
  // what settles it, spelled out or abbreviated.
  for (const [location, code] of [
    ["Perth, WA, Australia", "WA"],
    ["Perth, WA, AU", "WA"],
    ["WA, Australia", "WA"],
    ["Australia - WA - Perth", "WA"],
    ["Milan, MI, Italy", "MI"],
    ["Bengaluru, KA, India", "CA"],
    ["Gurgaon, HR, IN", "IN"]
  ]) {
    assert.equal(
      rowMatchesLocationFilters(location, [code], [], [], []),
      false,
      `${code} filter should not match the foreign subdivision in ${location}`
    );
  }

  // The country guard is scoped to one location group, so a genuine US match survives a
  // foreign location listed beside it -- and an explicit US country never blocks anything.
  for (const [location, code] of [
    ["Seattle, WA / Perth, WA, Australia", "WA"],
    ["Seattle, WA, United States", "WA"],
    ["Seattle, WA, USA", "WA"],
    ["Redmond, WA 98052, United States", "WA"],
    ["Indianapolis, IN", "IN"],
    ["Detroit, MI", "MI"]
  ]) {
    assert.equal(
      rowMatchesLocationFilters(location, [code], [], [], []),
      true,
      `${code} filter should still match ${location}`
    );
  }

  console.log("location-state-filter tests passed");
}

run();
