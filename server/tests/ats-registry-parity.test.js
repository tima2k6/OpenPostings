// The client keeps its own copy of the ATS list in App.js. When a value there drifts
// from the server registry it does not fail loudly: normalizeSyncEnabledAts drops the
// unknown value, and (before this test existed) the empty result fell back to the full
// default list, so picking one ATS in sync settings silently enabled all of them.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const {
  ATS_FILTER_OPTIONS,
  ATS_FILTER_OPTION_ITEMS,
  SYNC_DEFAULT_ENABLED_ATS,
  normalizeAtsFilterValue,
  normalizeSyncEnabledAts
} = require("../helpers/normalize-ats.js");

// App.js is a React Native module we cannot require from node, so lift the two ATS
// literals out of the source and evaluate just those.
function loadClientAtsRegistry() {
  const source = fs.readFileSync(path.join(__dirname, "..", "..", "App.js"), "utf8");
  const optionsMatch = source.match(/const DEFAULT_ATS_FILTER_OPTIONS = \[[\s\S]*?\n\];/);
  const labelsMatch = source.match(/const ATS_LABEL_BY_VALUE = \{[\s\S]*?\n\};/);
  assert.ok(optionsMatch, "DEFAULT_ATS_FILTER_OPTIONS should be findable in App.js");
  assert.ok(labelsMatch, "ATS_LABEL_BY_VALUE should be findable in App.js");

  const sandboxModule = { exports: {} };
  vm.runInNewContext(
    `${optionsMatch[0]}\n${labelsMatch[0]}\nmodule.exports = { DEFAULT_ATS_FILTER_OPTIONS, ATS_LABEL_BY_VALUE };`,
    { module: sandboxModule }
  );
  return sandboxModule.exports;
}

function run() {
  const { DEFAULT_ATS_FILTER_OPTIONS, ATS_LABEL_BY_VALUE } = loadClientAtsRegistry();

  const unknownToServer = DEFAULT_ATS_FILTER_OPTIONS.map((option) => option.value).filter(
    (value) => !ATS_FILTER_OPTIONS.has(value)
  );
  assert.deepEqual(
    unknownToServer,
    [],
    "every ATS the client offers must be a value the server registry accepts"
  );

  const notCanonical = DEFAULT_ATS_FILTER_OPTIONS.map((option) => option.value).filter(
    (value) => normalizeAtsFilterValue(value) !== value
  );
  assert.deepEqual(
    notCanonical,
    [],
    "client ATS values must already be canonical so they survive normalization unchanged"
  );

  const unlabelled = DEFAULT_ATS_FILTER_OPTIONS.map((option) => option.value).filter(
    (value) => !ATS_LABEL_BY_VALUE[value]
  );
  assert.deepEqual(unlabelled, [], "every offered ATS needs a label in ATS_LABEL_BY_VALUE");

  // Each selectable ATS must be able to stand alone. Any value that cannot round-trips
  // into the full default list instead, which is the failure this test exists to catch.
  for (const option of DEFAULT_ATS_FILTER_OPTIONS) {
    assert.deepEqual(
      normalizeSyncEnabledAts([option.value]),
      [option.value],
      `selecting only ${option.value} should enable exactly that ATS`
    );
  }

  assert.deepEqual(
    normalizeSyncEnabledAts(["isolvisolvedhire"]),
    ["isolved"],
    "the legacy isolved typo stored by older clients should map onto the canonical value"
  );

  assert.ok(
    ATS_FILTER_OPTIONS.has("dayforcehcm") &&
      ATS_FILTER_OPTION_ITEMS.some((item) => item.value === "dayforcehcm"),
    "dayforce has a wired collector, so it belongs in both server registries"
  );

  // The MCP server runs as its own process and once kept a third copy of the registry,
  // which fell four ATSs behind and made them unusable as search_jobs filters. It must
  // keep sourcing them from the shared helper rather than redeclaring its own.
  const mcpSource = fs.readFileSync(path.join(__dirname, "..", "mcp-apply-server.js"), "utf8");
  for (const name of ["ATS_FILTER_OPTIONS", "normalizeAtsFilters", "inferAtsFromJobPostingUrl"]) {
    assert.ok(
      !new RegExp(`^(?:const|let|function)\\s+${name}\\b`, "m").test(mcpSource),
      `mcp-apply-server.js should import ${name} from helpers/normalize-ats.js, not redeclare it`
    );
  }
  assert.ok(
    /require\("\.\/helpers\/normalize-ats\.js"\)/.test(mcpSource),
    "mcp-apply-server.js should require the shared ATS registry"
  );

  // Unrecognized selections must not widen into everything.
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (message) => warnings.push(message);
  try {
    assert.deepEqual(
      normalizeSyncEnabledAts(["not-a-real-ats"]),
      [],
      "a selection that matches no known ATS should enable none of them, not all of them"
    );
    assert.deepEqual(
      normalizeSyncEnabledAts(["workday", "not-a-real-ats"]),
      ["workday"],
      "unknown values should be dropped without disturbing the recognized ones"
    );
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(warnings.length, 1, "an unrecognized-only selection should be reported once");

  // An absent selection still means "not configured yet" and takes the default.
  assert.deepEqual(
    normalizeSyncEnabledAts([]),
    Array.from(SYNC_DEFAULT_ENABLED_ATS),
    "an empty selection should fall back to the default list"
  );
  assert.deepEqual(
    normalizeSyncEnabledAts(null),
    Array.from(SYNC_DEFAULT_ENABLED_ATS),
    "a missing selection should fall back to the default list"
  );
  assert.deepEqual(
    normalizeSyncEnabledAts("[]"),
    Array.from(SYNC_DEFAULT_ENABLED_ATS),
    "the stored empty-array column default should fall back to the default list"
  );
  assert.deepEqual(
    normalizeSyncEnabledAts([], ["workday"]),
    ["workday"],
    "an empty selection should prefer the caller's fallback over the default list"
  );

  console.log("ats-registry-parity tests passed");
}

run();
