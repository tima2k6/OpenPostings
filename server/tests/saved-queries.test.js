// Saved queries are set up before an overnight sync and opened again the next day, so the
// property that matters is that nothing quietly loses them. They previously lived in
// localStorage, which is per-device, per-origin, and evicted by Safari on its own schedule.
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

function withStore(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openpostings-saved-"));
  process.env.DB_PATH = path.join(dir, "jobs.db");
  delete require.cache[require.resolve("../services/saved-queries.js")];
  const store = require("../services/saved-queries.js");
  try {
    run(store);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    delete process.env.DB_PATH;
    delete require.cache[require.resolve("../services/saved-queries.js")];
  }
}

function testRoundTrip() {
  withStore((store) => {
    assert.deepStrictEqual(store.listSavedQueries(), [], "an absent store reads as empty, not an error");
    const saved = store.saveQuery({ name: "WA leads", state: { states: "WA", title_any: "manager" } });
    assert.ok(saved.id);
    const listed = store.listSavedQueries();
    assert.strictEqual(listed.length, 1);
    assert.deepStrictEqual(listed[0].state, { states: "WA", title_any: "manager" });
  });
}

// Re-saving after a tweak is nearly always meant to update, not to accumulate a second
// entry under the same name that then has to be cleaned up by hand.
function testSavingSameNameUpdatesInPlace() {
  withStore((store) => {
    const first = store.saveQuery({ name: "WA leads", state: { states: "WA" } });
    const second = store.saveQuery({ name: "WA leads", state: { states: "WA", title_none: "assistant" } });
    assert.strictEqual(first.id, second.id, "the identity is kept so a pinned button does not move");
    const listed = store.listSavedQueries();
    assert.strictEqual(listed.length, 1, "no duplicate under the same name");
    assert.strictEqual(listed[0].state.title_none, "assistant", "the newer filter set wins");
  });
}

function testDelete() {
  withStore((store) => {
    const saved = store.saveQuery({ name: "temp", state: { states: "OR" } });
    assert.strictEqual(store.deleteQuery(saved.id), true);
    assert.deepStrictEqual(store.listSavedQueries(), []);
    assert.strictEqual(store.deleteQuery(saved.id), false, "deleting twice is not an error, just false");
  });
}

function testMalformedStoreDoesNotThrow() {
  withStore((store) => {
    fs.writeFileSync(store.STORE_PATH, "{not json");
    assert.deepStrictEqual(store.listSavedQueries(), [], "an unreadable store must not take the endpoint down");
    // And must still be recoverable by saving over it.
    store.saveQuery({ name: "after corruption", state: { states: "WA" } });
    assert.strictEqual(store.listSavedQueries().length, 1);
  });
}

function testValidation() {
  withStore((store) => {
    assert.throws(() => store.saveQuery({ name: "  ", state: {} }), /needs a name/);
    assert.throws(() => store.saveQuery({ name: "x", state: null }), /needs a filter set/);
  });
}

function main() {
  testRoundTrip();
  testSavingSameNameUpdatesInPlace();
  testDelete();
  testMalformedStoreDoesNotThrow();
  testValidation();
  console.log("saved-queries tests passed");
}

main();
