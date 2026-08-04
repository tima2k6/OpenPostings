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
