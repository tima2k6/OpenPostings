// The enrichment scheduler. These loops run unattended for the life of the process, so
// the properties that matter are the ones that decide whether they are still running a
// week later: a slow run must not stack up behind itself, a failing run must not kill the
// loop, and an idle loop must not poll the database every few minutes forever.
//
// The reason this is tested at all: the previous arrangement hung description fetching off
// the end of a sync pass, which on a real database meant it fired twelve times in two days
// and every field that depends on it stayed empty. Scheduling was the bug, so scheduling
// is what gets pinned down.
const assert = require("assert");

const { startEnrichmentLoop, createEnrichmentState } = require("../services/enrichment-runtime.js");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function testWorkIsPerformedAndCounted() {
  const state = createEnrichmentState();
  let calls = 0;
  const stop = startEnrichmentLoop({
    name: "test",
    state,
    intervalMs: 20,
    task: async () => {
      calls += 1;
      return 5; // did work
    }
  });

  await sleep(120);
  stop();
  assert.ok(calls >= 2, `loop must keep running; saw ${calls} calls`);
  assert.strictEqual(state.idle_streak, 0, "a run that did work resets the backoff");
  assert.strictEqual(state.last_error, null);
  assert.ok(state.runs >= 2);
  assert.ok(state.last_run_at, "a completed run records when it happened");
}

async function testSingleFlight() {
  const state = createEnrichmentState();
  let concurrent = 0;
  let maxConcurrent = 0;
  const stop = startEnrichmentLoop({
    name: "test",
    state,
    intervalMs: 5,
    task: async () => {
      concurrent += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      // Deliberately far longer than the interval.
      await sleep(60);
      concurrent -= 1;
      return 1;
    }
  });

  await sleep(200);
  stop();
  assert.strictEqual(maxConcurrent, 1, "a run slower than the interval must not stack up behind itself");
}

async function testIdleBacksOff() {
  const state = createEnrichmentState();
  const stop = startEnrichmentLoop({
    name: "test",
    state,
    intervalMs: 10,
    task: async () => 0 // nothing to do
  });

  await sleep(150);
  stop();
  assert.ok(state.idle_streak > 0, "consecutive idle runs must widen the interval");
  // Without backoff a 10ms interval over 150ms would be ~15 runs; doubling should make it
  // markedly fewer.
  assert.ok(state.runs < 10, `idle loop should back off, but ran ${state.runs} times`);
}

async function testFailureDoesNotKillTheLoop() {
  const state = createEnrichmentState();
  let calls = 0;
  const stop = startEnrichmentLoop({
    name: "test",
    state,
    intervalMs: 15,
    task: async () => {
      calls += 1;
      throw new Error("boom");
    }
  });

  await sleep(150);
  stop();
  assert.ok(calls >= 2, `a throwing task must not stop the loop; saw ${calls} calls`);
  assert.match(String(state.last_error), /boom/, "the failure is recorded rather than swallowed silently");
  assert.strictEqual(state.running, false, "the running flag must be cleared even when the task throws");
}

async function testDisabledLoopSkipsWorkButKeepsTicking() {
  const state = createEnrichmentState();
  let calls = 0;
  let allowed = false;
  const stop = startEnrichmentLoop({
    name: "test",
    state,
    intervalMs: 15,
    enabled: () => allowed,
    task: async () => {
      calls += 1;
      return 1;
    }
  });

  await sleep(60);
  assert.strictEqual(calls, 0, "a disabled loop must not do work");
  // Turning it back on must be picked up without a restart.
  allowed = true;
  await sleep(90);
  stop();
  assert.ok(calls > 0, "re-enabling must take effect on the next tick, with no restart");
}

async function testStopIsHonoured() {
  const state = createEnrichmentState();
  let calls = 0;
  const stop = startEnrichmentLoop({
    name: "test",
    state,
    intervalMs: 10,
    task: async () => {
      calls += 1;
      return 1;
    }
  });

  await sleep(60);
  stop();
  const callsAtStop = calls;
  await sleep(80);
  assert.strictEqual(calls, callsAtStop, "no further runs after stop()");
}

async function main() {
  await testWorkIsPerformedAndCounted();
  await testSingleFlight();
  await testIdleBacksOff();
  await testFailureDoesNotKillTheLoop();
  await testDisabledLoopSkipsWorkButKeepsTicking();
  await testStopIsHonoured();
  console.log("enrichment-runtime tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
