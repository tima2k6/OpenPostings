// The MCP server used to carry its own copy of the location-filter logic, and this file
// existed to stop that copy drifting from the shared helper. The copy is gone: the agent now
// calls listPostingsWithFilters like the HTTP API does, so what needs pinning is the mapping
// -- every filter the app offers has to reach the shared engine, and a saved preference has
// to apply only where the caller left the filter empty. A dropped filter here is silent: the
// query still succeeds, it just quietly ignores the criterion the agent asked for.
//
// The location matching itself is covered by location-state-filter.test.js against the
// shared helper, which is now the only implementation.
const assert = require("assert");
const path = require("path");
const Module = require("module");

const SERVER_DIR = path.join(__dirname, "..");
const POSTINGS_SERVICE = path.join(SERVER_DIR, "services", "postings.js");
const MCP_SERVICE = path.join(SERVER_DIR, "services", "mcp.js");
const MCP_SERVER = path.join(SERVER_DIR, "mcp-apply-server.js");

// Loads the MCP server with listPostingsWithFilters and getMcpSettings replaced, so the
// argument mapping can be read off without a database.
function loadWithStubs({ settings, capture }) {
  const realLoad = Module._load;
  for (const target of [POSTINGS_SERVICE, MCP_SERVICE, MCP_SERVER]) {
    delete require.cache[require.resolve(target)];
  }

  Module._load = function stubbedLoad(request, parent, isMain) {
    const resolved = (() => {
      try {
        return Module._resolveFilename(request, parent, isMain);
      } catch {
        return "";
      }
    })();

    if (resolved === POSTINGS_SERVICE) {
      return {
        ...realLoad.call(this, request, parent, isMain),
        listPostingsWithFilters: async (options) => {
          capture.options = options;
          return { items: [], count: 0, limit: options.limit, offset: options.offset, filters: {} };
        }
      };
    }
    if (resolved === MCP_SERVICE) {
      return {
        ...realLoad.call(this, request, parent, isMain),
        getMcpSettings: async () => settings
      };
    }
    return realLoad.call(this, request, parent, isMain);
  };

  try {
    return require(MCP_SERVER);
  } finally {
    Module._load = realLoad;
  }
}

const SETTINGS = Object.freeze({
  enabled: true,
  preferred_agent_name: "OpenPostings Agent",
  dry_run_only: true,
  require_final_approval: true,
  max_applications_per_run: 7,
  preferred_search: "engineer",
  preferred_remote: "hybrid",
  preferred_industries: ["information_technology_software"],
  preferred_regions: ["AMER"],
  preferred_countries: ["US"],
  preferred_states: ["WA"],
  preferred_counties: ["WA|King"],
  instructions_for_agent: ""
});

async function testSavedPreferencesApply() {
  const capture = {};
  const { findCandidates } = loadWithStubs({ settings: SETTINGS, capture });
  await findCandidates({});

  assert.strictEqual(capture.options.search, "engineer", "preferred_search should apply");
  assert.strictEqual(capture.options.remote, "hybrid", "preferred_remote should apply");
  assert.deepStrictEqual(capture.options.industries, ["information_technology_software"]);
  assert.deepStrictEqual(capture.options.states, ["WA"]);
  assert.deepStrictEqual(capture.options.counties, ["WA|King"]);
  // Regions and countries are the pair that never reached the query before: the settings
  // reader did not select their columns, so they always arrived empty.
  assert.deepStrictEqual(capture.options.countries, ["US"], "preferred_countries should apply");
  assert.deepStrictEqual(capture.options.regions, ["AMER"], "preferred_regions should apply");
  assert.strictEqual(capture.options.limit, 7, "max_applications_per_run should be the default limit");
  assert.strictEqual(capture.options.include_applied, false, "applied postings are excluded by default");
  assert.strictEqual(capture.options.include_ignored, false, "ignored postings are excluded by default");
  assert.strictEqual(capture.options.include_descriptions, false, "descriptions are opt-in");
}

async function testExplicitArgumentsOverridePreferences() {
  const capture = {};
  const { findCandidates } = loadWithStubs({ settings: SETTINGS, capture });
  await findCandidates({
    search: "nurse",
    states: ["OR"],
    industries: ["healthcare_medical"],
    remote: "remote",
    limit: 25
  });

  assert.strictEqual(capture.options.search, "nurse");
  assert.deepStrictEqual(capture.options.states, ["OR"]);
  assert.deepStrictEqual(capture.options.industries, ["healthcare_medical"]);
  assert.strictEqual(capture.options.remote, "remote");
  assert.strictEqual(capture.options.limit, 25);
  // Filters the caller left alone still fall back to the saved preference.
  assert.deepStrictEqual(capture.options.counties, ["WA|King"]);
  assert.deepStrictEqual(capture.options.countries, ["US"]);
}

async function testUseSettingsFalseIgnoresPreferences() {
  const capture = {};
  const { findCandidates } = loadWithStubs({ settings: SETTINGS, capture });
  await findCandidates({ use_settings: false, states: ["TX"] });

  assert.strictEqual(capture.options.search, "", "preferred_search must not leak in");
  assert.strictEqual(capture.options.remote, "all");
  assert.deepStrictEqual(capture.options.states, ["TX"]);
  assert.deepStrictEqual(capture.options.industries, []);
  assert.deepStrictEqual(capture.options.counties, []);
  assert.deepStrictEqual(capture.options.countries, []);
  assert.deepStrictEqual(capture.options.regions, []);
}

// Every filter the app's job list exposes has to be reachable from the agent. This is the
// list that was six entries long before.
async function testFullFilterSurfaceReachesTheQuery() {
  const capture = {};
  const { findCandidates } = loadWithStubs({ settings: SETTINGS, capture });
  await findCandidates({
    use_settings: false,
    search: "analyst",
    ats: "greenhouse",
    industries: ["data_ai_analytics"],
    compensation_types: ["salary"],
    pay_periods: ["year"],
    pay_min: 120000,
    pay_max: 180000,
    education_levels: ["bachelor"],
    states: ["WA"],
    counties: ["WA|King"],
    countries: ["US"],
    regions: ["AMER"],
    remote: "remote",
    sort_by: "company_asc",
    hide_no_date: true,
    include_applied: true,
    include_ignored: true,
    include_descriptions: true,
    limit: 50,
    offset: 100
  });

  assert.deepStrictEqual(capture.options.ats, ["greenhouse"], "a single ats string becomes a list");
  assert.deepStrictEqual(capture.options.compensation_types, ["salary"]);
  assert.deepStrictEqual(capture.options.pay_periods, ["year"]);
  assert.strictEqual(capture.options.pay_min, 120000);
  assert.strictEqual(capture.options.pay_max, 180000);
  assert.deepStrictEqual(capture.options.education_levels, ["bachelor"]);
  assert.deepStrictEqual(capture.options.countries, ["US"]);
  assert.deepStrictEqual(capture.options.regions, ["AMER"]);
  assert.strictEqual(capture.options.sort_by, "company_asc");
  assert.strictEqual(capture.options.hide_no_date, true);
  assert.strictEqual(capture.options.include_applied, true);
  assert.strictEqual(capture.options.include_ignored, true);
  assert.strictEqual(capture.options.include_descriptions, true);
  assert.strictEqual(capture.options.offset, 100);
}

async function testDisabledAgentRefuses() {
  const capture = {};
  const { findCandidates } = loadWithStubs({
    settings: { ...SETTINGS, enabled: false },
    capture
  });

  await assert.rejects(
    () => findCandidates({}),
    /disabled in settings/,
    "a disabled agent must not run a candidate query"
  );
  assert.strictEqual(capture.options, undefined, "the query must not be reached at all");
}

// The settings reader has to name preferred_regions and preferred_countries in its SELECT.
// Reading them off the row object is not enough -- a column that is not selected is simply
// absent, which parses as an empty preference and looks like the user set nothing.
function testSettingsReaderSelectsGeoColumns() {
  const source = require("fs").readFileSync(MCP_SERVICE, "utf8");
  const select = source.slice(source.indexOf("SELECT"), source.indexOf("FROM McpSettings"));
  for (const column of ["preferred_regions", "preferred_countries", "preferred_states", "preferred_counties"]) {
    assert.ok(select.includes(column), `getMcpSettings must select ${column}`);
  }
}

async function run() {
  await testSavedPreferencesApply();
  await testExplicitArgumentsOverridePreferences();
  await testUseSettingsFalseIgnoresPreferences();
  await testFullFilterSurfaceReachesTheQuery();
  await testDisabledAgentRefuses();
  testSettingsReaderSelectsGeoColumns();
  console.log("mcp-candidate-filters tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
