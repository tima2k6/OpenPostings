// A request that hangs used to never settle: the caller sat on the promise, its catch
// never ran, and the page rendered with no data and no error -- indistinguishable from
// "there are no postings". These guard the timeout that makes a stall observable, and the
// wording that tells the two reachable failure modes apart.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// src/api.js is an ES module consumed by Metro and it imports from react-native, so it is
// loaded here with that import replaced by a stub and its export keywords rewritten.
function loadApiModule({ fetchImpl, onTimerScheduled }) {
  const source = fs.readFileSync(path.join(__dirname, "..", "..", "src", "api.js"), "utf8");
  const cjsSource = source
    .replace(/^import \{ Platform \} from "react-native";$/m, "")
    .replace(/^export (const|function|async function) /gm, "$1 ")
    // A bare re-export statement has no declaration to unwrap; drop it.
    .replace(/^export \{[^}]*\};$/gm, "");

  const clearedTimers = [];
  const sandboxModule = { exports: {} };
  const context = {
    Platform: { OS: "web" },
    process: { env: { EXPO_PUBLIC_API_BASE_URL: "http://api.test:8787" } },
    fetch: fetchImpl,
    AbortController,
    // The real delay is 30s. The test records it, then fires immediately so the abort
    // path is exercised without the suite sleeping.
    setTimeout: (fn, ms) => {
      onTimerScheduled(ms);
      return setTimeout(fn, 0);
    },
    clearTimeout: (id) => {
      clearedTimers.push(id);
      return clearTimeout(id);
    },
    module: sandboxModule,
    console
  };

  vm.runInNewContext(
    `${cjsSource}\nmodule.exports = { request, REQUEST_TIMEOUT_MS, describeRequestError };`,
    context
  );
  return { ...sandboxModule.exports, clearedTimers };
}

async function testHangingRequestTimesOut() {
  const scheduled = [];
  // Never resolves on its own; only the abort signal can end it.
  const fetchImpl = (_url, options) =>
    new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => {
        const error = new Error("Aborted");
        error.name = "AbortError";
        reject(error);
      });
    });

  const api = loadApiModule({ fetchImpl, onTimerScheduled: (ms) => scheduled.push(ms) });

  await assert.rejects(
    () => api.request("/postings"),
    (error) => {
      assert.match(error.message, /timed out/i, "a hang must surface as a timeout, not silence");
      assert.match(error.message, /http:\/\/api\.test:8787\/postings/, "the message must name the address");
      return true;
    }
  );

  assert.equal(scheduled[0], api.REQUEST_TIMEOUT_MS, "the abort must be armed with the configured window");
  assert.ok(api.clearedTimers.length > 0, "the timer must be cleared so it cannot abort a later request");
}

async function testUnreachableApiIsNamed() {
  const fetchImpl = () => Promise.reject(new TypeError("Failed to fetch"));
  const api = loadApiModule({ fetchImpl, onTimerScheduled: () => {} });

  await assert.rejects(
    () => api.request("/postings"),
    (error) => {
      assert.match(error.message, /could not reach the api/i);
      assert.match(error.message, /http:\/\/api\.test:8787/, "the message must name the address being called");
      // The browser refuses to distinguish refused-connection from blocked-CORS, so the
      // message must not claim to know which one happened.
      assert.doesNotMatch(error.message, /cors/i, "must not assert a cause it cannot observe");
      return true;
    }
  );
}

async function testHttpErrorPassesThrough() {
  const fetchImpl = () =>
    Promise.resolve({ ok: false, status: 500, text: () => Promise.resolve("boom") });
  const api = loadApiModule({ fetchImpl, onTimerScheduled: () => {} });

  await assert.rejects(
    () => api.request("/postings"),
    (error) => {
      assert.match(error.message, /HTTP 500/, "a real HTTP status must survive classification");
      return true;
    }
  );
}

async function testSuccessClearsTheTimer() {
  const api = loadApiModule({
    fetchImpl: () => Promise.resolve({ ok: true, json: () => Promise.resolve({ items: [1, 2] }) }),
    onTimerScheduled: () => {}
  });

  const result = await api.request("/postings");
  assert.deepEqual(result, { items: [1, 2] });
  assert.ok(api.clearedTimers.length > 0, "a successful request must not leave its abort timer pending");
}

async function main() {
  await testHangingRequestTimesOut();
  await testUnreachableApiIsNamed();
  await testHttpErrorPassesThrough();
  await testSuccessClearsTheTimer();
  console.log("api-request-errors tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
