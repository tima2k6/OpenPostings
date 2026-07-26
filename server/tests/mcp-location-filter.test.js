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
  ["Washington", true],
  // The splitter breaks on "/", so a multi-location posting flattens into one segment
  // list. Its genuine WA match must survive the other location's state.
  ["Seattle, Washington / Portland, OR", true],
  ["Washington, DC", false],
  ["Washington, DC, USA", false],
  ["Washington, DC, United States", false],
  ["Washington, District of Columbia, United States", false],
  ["Washington DC, USA", false],
  // Washington in Tyne and Wear, and the long multi-location strings it shows up in.
  ["Washington, United Kingdom", false],
  ["Washington, Tyne and Wear, United Kingdom", false],
  ["Chinnor, United Kingdom / Washington, United Kingdom", false],
  ["Portland, OR / Seattle, Washington, United States", true],
  // Towns named Washington in other states: the segment after the name is the real state.
  ["Washington, PA", false],
  ["Washington, IN", false],
  ["Washington, PA, United States", false],
  ["Washington, IN, United States", false],
  ["Washington, MO", false],
  ["Washington, UT", false],
  ["Washington, Pennsylvania", false],
  ["Fort Washington, PA, United States", false],
  ["New Washington, OH, United States", false],
  ["Austin, TX", false]
];

// The same rule, for states whose name is also a town elsewhere.
const OTHER_STATE_CASES = [
  ["Indianapolis, Indiana, United States", "IN", true],
  ["Los Angeles, California", "CA", true],
  ["Indiana, PA, United States", "IN", false],
  ["California, MD, United States", "CA", false],
  ["Nevada, MO, United States", "NV", false],
  ["Wyoming, MI, United States", "WY", false],
  ["Delaware, OH, United States", "DE", false]
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

  for (const [location, code, expected] of OTHER_STATE_CASES) {
    assert.strictEqual(
      mcpMatches(location, [code], []),
      expected,
      `MCP ${code} filter on ${JSON.stringify(location)} should be ${expected}`
    );
    assert.strictEqual(
      helperMatches(location, [code], [], [], []),
      expected,
      `shared-helper ${code} filter on ${JSON.stringify(location)} should be ${expected}`
    );
  }

  console.log("mcp-location-filter tests passed");
}

run();
