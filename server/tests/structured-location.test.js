// Structured location parsing and the query filters built on it. Every case here is a
// real miss from a live session: "kent" as a substring matched Kentucky and Kent,
// England; "bellevue" matched a Philadelphia hotel and a South African suburb; "remote"
// matched Remote Egypt; and a comma-run multi-location header lost every city after the
// first.
process.env.DB_PATH = process.env.DB_PATH || ""; // set below, before db-browser loads

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "openpostings-structloc-"));
process.env.DB_PATH = path.join(fixtureDir, "test.db");

const { openDatabase } = require("../db/open-database.js");
const { setDb, setPostingLocationByJobUrl } = require("../services/runtime-context.js");
const { createCanonicalPostingsTable, upsertPostingsBatch } = require("../services/sync-runtime.js");
const { runQuery } = require("../services/db-query.js");
const {
  parsePostingLocation,
  parseLocationAnyTerm,
  locationEntryMatches,
  parseCityFilters,
  rowMatchesCityFilters
} = require("../helpers/parse-location.js");

const NOW = Math.floor(Date.now() / 1000);

function testParsing() {
  const cases = [
    ["Kent, WA", [{ city: "Kent", state_region: "WA", country: "US" }]],
    ["Shepherdsville, Kentucky", [{ city: "Shepherdsville", state_region: "KY", country: "US" }]],
    ["Florence Kentucky", [{ city: "Florence", state_region: "KY", country: "US" }]],
    ["Sittingbourne, Kent, Kent Science Park", [{ city: "Sittingbourne", state_region: null, country: null }]],
    ["Bellevue, South Africa", [{ city: "Bellevue", state_region: null, country: "ZA" }]],
    ["Perth, WA, Australia", [{ city: "Perth", state_region: null, country: "AU" }]],
    ["US-WA-Redmond", [{ city: "Redmond", state_region: "WA", country: "US" }]],
    ["Winston-Salem, NC", [{ city: "Winston-Salem", state_region: "NC", country: "US" }]]
  ];
  for (const [input, expected] of cases) {
    const parsed = parsePostingLocation(input);
    assert.strictEqual(parsed.locations.length, expected.length, `entry count for ${JSON.stringify(input)}`);
    expected.forEach((want, index) => {
      const got = parsed.locations[index];
      assert.strictEqual(got.city, want.city, `city of ${JSON.stringify(input)}`);
      assert.strictEqual(got.state_region, want.state_region, `state of ${JSON.stringify(input)}`);
      assert.strictEqual(got.country, want.country, `country of ${JSON.stringify(input)}`);
    });
  }

  // The DoorDash header shape: comma-run pairs must all survive, ";" groups included.
  const doordash = parsePostingLocation("Denver, CO, Seattle, WA; Phoenix, AZ");
  assert.deepStrictEqual(
    doordash.locations.map((entry) => `${entry.city}/${entry.state_region}`),
    ["Denver/CO", "Seattle/WA", "Phoenix/AZ"]
  );

  // Remote is a mode, not a city.
  assert.strictEqual(parsePostingLocation("Mumbai Remote").is_remote, 1);
  assert.strictEqual(parsePostingLocation("Mumbai Remote").locations[0].city, "Mumbai");
  assert.strictEqual(parsePostingLocation("Remote Egypt").locations[0].country, "EG");
  assert.strictEqual(parsePostingLocation("Remote Egypt").locations[0].city, null);
  assert.strictEqual(parsePostingLocation("Seattle, WA").is_remote, 0);

  // Pathological input parses bounded instead of exploding.
  const huge = Array.from({ length: 900 }, (_, i) => `Township ${i}, South Africa`).join("; ");
  const parsedHuge = parsePostingLocation(huge);
  assert.ok(parsedHuge.locations.length <= 40, "pathological strings must be capped");
}

function testTermMatching() {
  const kentWa = parsePostingLocation("Kent, WA").locations;
  const kentEngland = parsePostingLocation("Sittingbourne, Kent, Kent Science Park").locations;
  const kentucky = parsePostingLocation("Shepherdsville, Kentucky").locations;
  const term = [parseLocationAnyTerm("Kent, WA")];
  assert.ok(kentWa.some((entry) => locationEntryMatches(entry, term, [], [])));
  assert.ok(!kentEngland.some((entry) => locationEntryMatches(entry, term, [], [])));
  assert.ok(!kentucky.some((entry) => locationEntryMatches(entry, term, [], [])));

  // Unqualified city + separate states filter must agree on the same entry.
  const bare = [parseLocationAnyTerm("kent")];
  assert.ok(kentWa.some((entry) => locationEntryMatches(entry, bare, ["WA"], [])));
  assert.ok(!kentEngland.some((entry) => locationEntryMatches(entry, bare, ["WA"], [])));
}

async function testQueryFilters() {
  setDb(await openDatabase({ filename: process.env.DB_PATH }));
  setPostingLocationByJobUrl(new Map());
  await createCanonicalPostingsTable();

  // Through the real ingest path, so the parsed columns are what production writes.
  const initialWriteCounts = await upsertPostingsBatch(
    [
      { company_name: "doordash", position_name: "Manager, Local Markets Growth", job_posting_url: "https://x/dd", location: "Dallas, TX; Nashville, TN; Denver, CO, Seattle, WA; Phoenix, AZ" },
      { company_name: "ukco", position_name: "Ops Manager", job_posting_url: "https://x/uk", location: "Sittingbourne, Kent, Kent Science Park" },
      { company_name: "kyco", position_name: "Ops Manager", job_posting_url: "https://x/ky", location: "Shepherdsville, Kentucky" },
      { company_name: "kyco2", position_name: "Ops Manager", job_posting_url: "https://x/ky2", location: "Florence Kentucky" },
      { company_name: "zaco", position_name: "Ops Manager", job_posting_url: "https://x/za", location: "Bellevue, South Africa" },
      { company_name: "highgate", position_name: "Director of Rooms/Operations", job_posting_url: "https://x/hotel", location: "Philadelphia, PA (The Bellevue Hotel)" },
      { company_name: "waco", position_name: "Ops Manager", job_posting_url: "https://x/wa", location: "Bellevue, WA" },
      { company_name: "remoteco", position_name: "Ops Manager", job_posting_url: "https://x/rem", location: "Remote - USA" },
      { company_name: "egyptco", position_name: "Ops Manager", job_posting_url: "https://x/eg", location: "Remote Egypt" }
    ],
    NOW
  );
  assert.deepStrictEqual(initialWriteCounts, { inserted: 9, refreshed: 0 });

  // Acceptance: a Washington filter returns nothing from Kentucky, England or South
  // Africa -- and a Puget Sound city list cannot leak through substrings.
  const wa = await runQuery({ states: "WA", location_any: "bellevue,kent,seattle,tacoma" });
  assert.deepStrictEqual(
    wa.rows.map((row) => row.job_posting_url).sort(),
    ["https://x/dd", "https://x/wa"],
    "WA city filter must keep only genuine WA postings"
  );

  // Qualified term alone.
  const kent = await runQuery({ location_any: "kent, wa" });
  assert.deepStrictEqual(kent.rows.map((row) => row.job_posting_url), []);

  // States alone: the hotel in Philadelphia stays out of WA, in PA.
  const pa = await runQuery({ states: "PA" });
  assert.deepStrictEqual(pa.rows.map((row) => row.job_posting_url), ["https://x/hotel"]);

  // remote_only is structural, not a substring.
  const remote = await runQuery({ remote_only: "1" });
  assert.deepStrictEqual(
    remote.rows.map((row) => row.job_posting_url).sort(),
    ["https://x/eg", "https://x/rem"]
  );
  const remoteUs = await runQuery({ remote_only: "1", countries: "US" });
  assert.deepStrictEqual(remoteUs.rows.map((row) => row.job_posting_url), ["https://x/rem"]);

  const followupWriteCounts = await upsertPostingsBatch(
    [
      { company_name: "doordash", position_name: "Manager, Local Markets Growth", job_posting_url: "https://x/dd", location: "Seattle, WA" },
      { company_name: "newco", position_name: "Engineer", job_posting_url: "https://x/new", location: "Tacoma, WA" }
    ],
    NOW + 1
  );
  assert.deepStrictEqual(
    followupWriteCounts,
    { inserted: 1, refreshed: 1 },
    "sync progress must distinguish a genuinely new row from an existing row refresh"
  );
}

// City filters as the dropdowns emit them. "City|ST" exists because a bare city name is
// not a filter anyone can trust -- Kent is in Washington, England and Kentucky, and the
// whole point is that picking one of them excludes the others.
function testCityFilters() {
  const filters = parseCityFilters(["Kent|WA", "Kent|OH", "Kent|WA"]);
  assert.strictEqual(filters.length, 2, "duplicates collapse but different states must not");
  assert.deepStrictEqual(filters.map((f) => f.stateCode).sort(), ["OH", "WA"]);

  const kentWa = parsePostingLocation("Kent, WA").locations;
  const kentOh = parsePostingLocation("Kent, OH").locations;
  const kentTx = parsePostingLocation("Kent, TX").locations;
  const kentUk = parsePostingLocation("Sittingbourne, Kent, Kent Science Park").locations;

  assert.ok(rowMatchesCityFilters(kentWa, filters));
  assert.ok(rowMatchesCityFilters(kentOh, filters));
  assert.ok(!rowMatchesCityFilters(kentTx, filters), "a state not asked for must not match");
  assert.ok(!rowMatchesCityFilters(kentUk, filters), "Kent in England is not Kent, WA");

  // A multi-location posting must satisfy the filter on one entry, not across two.
  const mixed = parsePostingLocation("Kent, England; Seattle, WA").locations;
  assert.ok(
    !rowMatchesCityFilters(mixed, parseCityFilters(["Kent|WA"])),
    "a Kent somewhere and a WA somewhere is not a Kent in WA"
  );

  // The comma form a text box produces is accepted too.
  assert.ok(rowMatchesCityFilters(kentWa, parseCityFilters(["Kent, WA"])));
  // No filters means no constraint.
  assert.ok(rowMatchesCityFilters(kentTx, parseCityFilters([])));
  // A row with no parsed location cannot satisfy a city filter.
  assert.ok(!rowMatchesCityFilters([], parseCityFilters(["Kent|WA"])));
}

async function main() {
  testParsing();
  testCityFilters();
  testTermMatching();
  await testQueryFilters();
  console.log("structured-location tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
