// The sync request deadline has to cover response bodies, queue waits and cooldowns—not
// just the time until headers arrive. Otherwise a server can return 200 and then stop
// sending bytes, permanently consuming every sync worker while the watchdog leaks the
// abandoned awaits into each replacement pass.
const assert = require("assert");

const { setAtsRequestQueueConcurrency } = require("../services/runtime-context.js");
const {
  fetchWithAtsRateLimit,
  getAtsRequestQueueStats,
  runWithRequestSignal
} = require("../services/queue.js");

const originalFetch = global.fetch;

function responseWithUrl(body, url, init = {}) {
  const response = new Response(body, init);
  Object.defineProperty(response, "url", { configurable: true, value: url });
  Object.defineProperty(response, "redirected", { configurable: true, value: true });
  return response;
}

// Every test above simulates a caller cancelling a pass or a target -- that forwarded abort
// is what actually unblocks the hanging body. In production nothing external cancels a single
// stuck request within FETCH_TIMEOUT_MS; the request-level deadline has to fire on its own.
// Loading queue.js fresh with a short FETCH_TIMEOUT_MS is the only way to exercise that timer
// without waiting out the real 12s default.
function loadQueueModuleWithFetchTimeout(fetchTimeoutMs) {
  const modulePath = require.resolve("../services/queue.js");
  const previousEnv = process.env.FETCH_TIMEOUT_MS;
  process.env.FETCH_TIMEOUT_MS = String(fetchTimeoutMs);
  delete require.cache[modulePath];
  const freshQueue = require("../services/queue.js");
  delete require.cache[modulePath];
  if (previousEnv === undefined) delete process.env.FETCH_TIMEOUT_MS;
  else process.env.FETCH_TIMEOUT_MS = previousEnv;
  return freshQueue;
}

// A safety net for the assertion below, not part of the mechanism under test: if the
// self-firing deadline regresses back to a plain unbounded await, this fails fast with a
// clear message instead of hanging the test process forever.
function withTestDeadline(promise, ms, message) {
  let timer;
  const guard = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, guard]).finally(() => clearTimeout(timer));
}

async function testBodyIsBufferedInsideTheRequestBoundary() {
  global.fetch = async () =>
    responseWithUrl(JSON.stringify({ ok: true }), "https://final.example/jobs", {
      status: 200,
      headers: { "content-type": "application/json", "x-test": "buffered" }
    });

  const response = await fetchWithAtsRateLimit("test-buffer", 0, "https://start.example/jobs");
  assert.strictEqual(response.url, "https://final.example/jobs", "redirect metadata must survive buffering");
  assert.strictEqual(response.redirected, true);
  assert.strictEqual(response.headers.get("x-test"), "buffered");
  assert.deepStrictEqual(await response.json(), { ok: true });
}

function hangingResponse(signal) {
  return responseWithUrl(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("partial"));
        const abort = () => controller.error(signal.reason || new Error("aborted"));
        if (signal.aborted) abort();
        else signal.addEventListener("abort", abort, { once: true });
      }
    }),
    "https://hang.example/jobs",
    { status: 200 }
  );
}

async function testAbortCancelsAHangingBodyAndReleasesItsSlot() {
  setAtsRequestQueueConcurrency(1);
  let calls = 0;
  global.fetch = async (_url, init) => {
    calls += 1;
    if (calls === 1) return hangingResponse(init.signal);
    return responseWithUrl("recovered", "https://hang.example/recovered", { status: 200 });
  };

  const controller = new AbortController();
  const hanging = runWithRequestSignal(controller.signal, () =>
    fetchWithAtsRateLimit("test-hanging-body", 0, "https://hang.example/jobs")
  );
  setTimeout(() => controller.abort(new Error("pass abandoned by test")), 20);

  await assert.rejects(hanging, /pass abandoned by test/);
  const recovered = await fetchWithAtsRateLimit(
    "test-hanging-body",
    0,
    "https://hang.example/recovered"
  );
  assert.strictEqual(await recovered.text(), "recovered", "an aborted body must release the ATS slot");
  const telemetry = getAtsRequestQueueStats();
  const hangingKey = telemetry.top_keys.find((item) => item.key === "test-hanging-body");
  assert.ok(hangingKey, "problematic ATS keys should be visible in queue telemetry");
  assert.strictEqual(hangingKey.aborted, 1, "abandoned pass requests should be counted");
  assert.strictEqual(hangingKey.active, 0, "settled requests must not remain active");
  assert.strictEqual(hangingKey.queued, 0, "settled requests must not remain queued");
}

async function testAbortReleasesSlotWhenBodyIgnoresTheSignal() {
  setAtsRequestQueueConcurrency(1);
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    if (calls === 1) {
      return responseWithUrl(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("partial"));
            // Deliberately never close and never observe the request signal. This
            // reproduces the production failure where abort() did not settle a body.
          }
        }),
        "https://uncooperative.example/jobs",
        { status: 200 }
      );
    }
    return responseWithUrl("recovered", "https://uncooperative.example/recovered", { status: 200 });
  };

  const controller = new AbortController();
  const hanging = runWithRequestSignal(controller.signal, () =>
    fetchWithAtsRateLimit("test-uncooperative-body", 0, "https://uncooperative.example/jobs")
  );
  setTimeout(() => controller.abort(new Error("hard deadline reached")), 20);

  await assert.rejects(hanging, /hard deadline reached/);
  const recovered = await fetchWithAtsRateLimit(
    "test-uncooperative-body",
    0,
    "https://uncooperative.example/recovered"
  );
  assert.strictEqual(await recovered.text(), "recovered", "hard abort must release the occupied ATS slot");
  const key = getAtsRequestQueueStats().top_keys.find((item) => item.key === "test-uncooperative-body");
  assert.strictEqual(key?.active, 0);
  assert.strictEqual(key?.queued, 0);
  assert.strictEqual(key?.aborted, 1);
}

async function testFetchTimeoutReleasesSlotWithNoExternalAbort() {
  const shortTimeoutQueue = loadQueueModuleWithFetchTimeout(50);
  setAtsRequestQueueConcurrency(1);
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    if (calls === 1) {
      return responseWithUrl(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("partial"));
            // Deliberately never closes and never observes any signal. No caller ever
            // calls abort() in this test -- only FETCH_TIMEOUT_MS itself can rescue the slot.
          }
        }),
        "https://no-caller-abort.example/jobs",
        { status: 200 }
      );
    }
    return responseWithUrl("recovered", "https://no-caller-abort.example/recovered", { status: 200 });
  };

  // No runWithRequestSignal, no AbortController, no init.signal -- called exactly as it
  // would be if nothing upstream ever cancels it.
  const hanging = shortTimeoutQueue.fetchWithAtsRateLimit(
    "test-no-caller-abort",
    0,
    "https://no-caller-abort.example/jobs"
  );

  await assert.rejects(
    () => withTestDeadline(hanging, 2000, "self-firing deadline never fired within 2s"),
    /timed out after 50ms/,
    "the internal deadline must fire on its own, with no caller ever aborting"
  );

  const recovered = await shortTimeoutQueue.fetchWithAtsRateLimit(
    "test-no-caller-abort",
    0,
    "https://no-caller-abort.example/recovered"
  );
  assert.strictEqual(await recovered.text(), "recovered", "the internal deadline must release the ATS slot");

  const key = shortTimeoutQueue
    .getAtsRequestQueueStats()
    .top_keys.find((item) => item.key === "test-no-caller-abort");
  assert.strictEqual(key?.active, 0, "settled requests must not remain active");
  assert.strictEqual(key?.queued, 0, "settled requests must not remain queued");
  assert.strictEqual(key?.timeouts, 1, "an unabandoned request that overran must count as a timeout, not a generic failure");
}

async function testAbortRemovesAQueuedRequest() {
  setAtsRequestQueueConcurrency(1);
  let releaseFirstFetch;
  global.fetch = (_url, init) => {
    if (!releaseFirstFetch) {
      return new Promise((resolve, reject) => {
        releaseFirstFetch = () => resolve(responseWithUrl("first", "https://queue.example/first", { status: 200 }));
        init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
      });
    }
    return Promise.resolve(responseWithUrl("later", "https://queue.example/later", { status: 200 }));
  };

  const firstController = new AbortController();
  const first = runWithRequestSignal(firstController.signal, () =>
    fetchWithAtsRateLimit("test-queued-abort", 0, "https://queue.example/first")
  );

  // Let the first call acquire the only slot before placing the second behind it.
  await new Promise((resolve) => setImmediate(resolve));
  const queuedController = new AbortController();
  const queued = runWithRequestSignal(queuedController.signal, () =>
    fetchWithAtsRateLimit("test-queued-abort", 0, "https://queue.example/queued")
  );
  queuedController.abort(new Error("queued target abandoned"));
  await assert.rejects(queued, /queued target abandoned/);

  releaseFirstFetch();
  assert.strictEqual(await (await first).text(), "first");
  assert.strictEqual(
    await (await fetchWithAtsRateLimit("test-queued-abort", 0, "https://queue.example/later")).text(),
    "later",
    "removing an aborted waiter must leave the queue usable"
  );
}

async function main() {
  try {
    await testBodyIsBufferedInsideTheRequestBoundary();
    await testAbortCancelsAHangingBodyAndReleasesItsSlot();
    await testAbortReleasesSlotWhenBodyIgnoresTheSignal();
    await testFetchTimeoutReleasesSlotWithNoExternalAbort();
    await testAbortRemovesAQueuedRequest();
    console.log("request-cancellation tests passed");
  } finally {
    global.fetch = originalFetch;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
