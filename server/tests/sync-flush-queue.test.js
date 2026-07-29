const assert = require("assert");

const { createSerialFlushQueue } = require("../services/sync-runtime.js");

// The bug this guards: a rejected flush was assigned back to the chain, so every later
// queued flush was skipped rather than run. The sync kept crawling and stored nothing for
// the rest of the pass -- 18 hours of collected postings dropped on the floor.
async function testQueueKeepsFlushingAfterAFailure() {
  const calls = [];
  const queue = createSerialFlushQueue(async (force) => {
    calls.push(force);
    if (calls.length === 1) throw new Error("database or disk is full");
    return "stored";
  });

  await assert.rejects(() => queue(false), /disk is full/);

  assert.strictEqual(await queue(false), "stored");
  assert.strictEqual(await queue(true), "stored");
  assert.deepStrictEqual(calls, [false, false, true]);
}

// A failure reaches the caller that queued it, so the pass can count it and record it,
// rather than being swallowed by the queue.
async function testFailureIsReportedToItsOwnCaller() {
  let shouldFail = true;
  const queue = createSerialFlushQueue(async () => {
    if (shouldFail) throw new Error("boom");
    return "ok";
  });

  await assert.rejects(() => queue(), /boom/);
  shouldFail = false;
  assert.strictEqual(await queue(), "ok");
}

// Flushes share one pending-postings array, so overlapping runs would splice each other's
// batches out from under them.
async function testFlushesDoNotOverlap() {
  let active = 0;
  let maxActive = 0;
  const queue = createSerialFlushQueue(async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
  });

  await Promise.all([queue(), queue(), queue()]);
  assert.strictEqual(maxActive, 1);
}

// Serialisation has to survive a failure too: a rejected flush must not release the next
// one early and let two run at once.
async function testFlushesDoNotOverlapAfterAFailure() {
  let active = 0;
  let maxActive = 0;
  let runs = 0;
  const queue = createSerialFlushQueue(async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    runs += 1;
    const failing = runs === 1;
    try {
      await new Promise((resolve) => setTimeout(resolve, 5));
      if (failing) throw new Error("boom");
    } finally {
      active -= 1;
    }
  });

  const results = await Promise.allSettled([queue(), queue(), queue()]);
  assert.deepStrictEqual(
    results.map((result) => result.status),
    ["rejected", "fulfilled", "fulfilled"]
  );
  assert.strictEqual(maxActive, 1);
  assert.strictEqual(runs, 3);
}

async function main() {
  await testQueueKeepsFlushingAfterAFailure();
  await testFailureIsReportedToItsOwnCaller();
  await testFlushesDoNotOverlap();
  await testFlushesDoNotOverlapAfterAFailure();
  console.log("sync-flush-queue tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
