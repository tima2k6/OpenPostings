// The MCP server carries its own copy of the location-filter logic (see the note in
// mcp-apply-server.js). That copy was untested, and its WA/DC guard had drifted into a
// no-op for the ordinary "Washington, DC" spelling while the shared helper stayed correct.
// This pins the two implementations together on the cases that matter.
const assert = require("assert");
const path = require("path");
const fs = require("fs");
const os = require("os");
const Module = require("module");

const { rowMatchesLocationFilters: helperMatches } = require("../helpers/description-filters.js");

// mcp-apply-server.js connects a stdio transport at import time, so it is loaded here with
// main() stripped and the MCP SDK stubbed rather than required directly.
function loadMcpFilters() {
  const serverDir = path.join(__dirname, "..");
  const source = fs.readFileSync(path.join(serverDir, "mcp-apply-server.js"), "utf8");
  const patched = source
    .replace(/const \{ McpServer \} = require\([^)]*\);/, "const McpServer = class {};")
    .replace(/const \{ StdioServerTransport \} = require\([^)]*\);/, "const StdioServerTransport = class {};")
    // The copy lives outside server/, so its relative requires need absolute targets.
    .replace(/require\("\.\/([^"]+)"\)/g, (_match, rel) => `require(${JSON.stringify(path.join(serverDir, rel))})`)
    .replace(/main\(\)\.catch\(\(error\) => \{[\s\S]*?\}\);\s*$/, "")
    .concat("\nmodule.exports = { rowMatchesLocationFilters };\n");

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openpostings-mcp-filter-"));
  const file = path.join(dir, "mcp-under-test.js");
  fs.writeFileSync(file, patched);
  try {
    const loaded = new Module(file, null);
    loaded.filename = file;
    // Resolve bare requires against the real server directory, not the temp one.
    loaded.paths = Module._nodeModulePaths(path.join(__dirname, ".."));
    loaded._compile(patched, file);
    return loaded.exports;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const CASES = [
  ["Seattle, Washington, United States", true],
  ["Seattle, WA", true],
  ["Vancouver, WA, USA", true],
  ["Bellevue, Washington, United States", true],
  ["Washington, DC", false],
  ["Washington, DC, USA", false],
  ["Washington, DC, United States", false],
  ["Washington, District of Columbia, United States", false],
  ["Washington DC, USA", false],
  ["Fort Washington, PA, United States", false],
  ["New Washington, OH, United States", false],
  ["Austin, TX", false]
];

function run() {
  const { rowMatchesLocationFilters: mcpMatches } = loadMcpFilters();

  for (const [location, expected] of CASES) {
    assert.strictEqual(
      mcpMatches(location, ["WA"], []),
      expected,
      `MCP WA filter on ${JSON.stringify(location)} should be ${expected}`
    );
    assert.strictEqual(
      helperMatches(location, ["WA"], [], [], []),
      expected,
      `shared-helper WA filter on ${JSON.stringify(location)} should be ${expected}`
    );
  }

  console.log("mcp-location-filter tests passed");
}

run();
