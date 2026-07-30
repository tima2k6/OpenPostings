// The watchdog for writes that have gone quiet.
//
// It exists because the error log cannot see this case. When the transaction queue wedged,
// nothing threw where anyone was looking: the sync simply stopped storing postings, and a
// sync storing nothing is indistinguishable from a sync with nothing to store. It went
// unnoticed for twenty hours, and the only symptom that ever surfaced was the app emptying a
// day later when every posting aged past the 24-hour freshness window at once.
//
// So these cases are about the three ways a monitor like this fails to be worth having: not
// firing when writes have stopped, firing when nothing is wrong, and firing so often that
// the notice becomes noise.
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { openDatabase } = require("../db/open-database.js");
const { setDb, getDb } = require("../services/runtime-context.js");
const { ensureErrorLogTable, listErrors, acknowledgeErrors } = require("../services/error-log.js");
const { checkWriteLiveness } = require("../services/write-liveness.js");

const HOUR = 3600;
const NOW = 1_800_000_000;
const THRESHOLD = 2 * HOUR;

async function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openpostings-liveness-"));
  setDb(await openDatabase({ filename: path.join(dir, "test.db") }));
  await ensureErrorLogTable();
  await getDb().exec(`
    CREATE TABLE IF NOT EXISTS Postings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_posting_url TEXT NOT NULL,
      last_seen_epoch INTEGER
    );
  `);
}

async function setNewestWrite(epoch) {
  const db = getDb();
  await db.run(`DELETE FROM Postings;`);
  await db.run(`INSERT INTO Postings (job_posting_url, last_seen_epoch) VALUES ('https://x/1', ?);`, [epoch]);
}

function freshState() {
  return { alerts_raised: 0, last_alert_epoch: 0 };
}

async function testFiresWhenWritesHaveStopped() {
  // Exactly the shape of the outage: the newest write is hours old.
  await setNewestWrite(NOW - 20 * HOUR);
  const state = freshState();
  const result = await checkWriteLiveness({ now: NOW, thresholdSeconds: THRESHOLD, state });

  assert.strictEqual(result.stalled, true);
  assert.strictEqual(result.alerted, true);

  const { items } = await listErrors({});
  const alert = items.find((item) => item.operation === "write_liveness");
  assert.ok(alert, "a stalled write path must produce a notice");
  assert.match(alert.message, /has not stored a posting in 20 hours/);
  // The message has to say what it means for the user, not just state a number. It also has
  // to read the *configured* freshness window rather than assume the module default: this
  // install runs 7 days, and an earlier version asserted 24 hours and so claimed the listing
  // was about to empty when it had six days of headroom.
  assert.match(alert.message, /freshness window of \d+ hours/i);
  assert.strictEqual(alert.context.threshold_seconds, THRESHOLD);
  assert.ok(
    Number(alert.context.freshness_window_hours) > 0,
    "the notice records which freshness window it was reasoning about"
  );
}

async function testSilentWhenWritesAreRecent() {
  await acknowledgeErrors([]);
  await setNewestWrite(NOW - 10 * 60);
  const state = freshState();
  const result = await checkWriteLiveness({ now: NOW, thresholdSeconds: THRESHOLD, state });

  assert.strictEqual(result.stalled, false);
  const { items } = await listErrors({});
  assert.strictEqual(items.length, 0, "a healthy sync must not produce notices");
}

// A monitor that cries wolf gets ignored, which is worse than not having one.
async function testDoesNotRepeatWithinAnEpisode() {
  await acknowledgeErrors([]);
  await setNewestWrite(NOW - 20 * HOUR);
  const state = freshState();

  await checkWriteLiveness({ now: NOW, thresholdSeconds: THRESHOLD, realertSeconds: 6 * HOUR, state });
  await checkWriteLiveness({ now: NOW + 15 * 60, thresholdSeconds: THRESHOLD, realertSeconds: 6 * HOUR, state });
  await checkWriteLiveness({ now: NOW + 30 * 60, thresholdSeconds: THRESHOLD, realertSeconds: 6 * HOUR, state });

  const { items } = await listErrors({});
  assert.strictEqual(
    items.filter((item) => item.operation === "write_liveness").length,
    1,
    "an ongoing stall reports once per episode, not once per check"
  );

  // Past the re-alert window it speaks again, because a stall lasting that long is worth
  // repeating.
  await checkWriteLiveness({ now: NOW + 7 * HOUR, thresholdSeconds: THRESHOLD, realertSeconds: 6 * HOUR, state });
  const after = await listErrors({});
  assert.strictEqual(after.items.filter((item) => item.operation === "write_liveness").length, 2);
}

// Recovering has to reset the episode, or the next stall stays silent for hours.
async function testRecoveryResetsTheEpisode() {
  await acknowledgeErrors([]);
  const state = freshState();

  await setNewestWrite(NOW - 20 * HOUR);
  await checkWriteLiveness({ now: NOW, thresholdSeconds: THRESHOLD, realertSeconds: 6 * HOUR, state });

  await setNewestWrite(NOW + 1);
  await checkWriteLiveness({ now: NOW + 60, thresholdSeconds: THRESHOLD, realertSeconds: 6 * HOUR, state });
  assert.strictEqual(state.last_alert_epoch, 0, "recovery clears the episode");

  await setNewestWrite(NOW + 60);
  const second = await checkWriteLiveness({
    now: NOW + 60 + 3 * HOUR,
    thresholdSeconds: THRESHOLD,
    realertSeconds: 6 * HOUR,
    state
  });
  assert.strictEqual(second.alerted, true, "a fresh stall alerts immediately after a recovery");
}

// Right after boot an idle database legitimately has an old newest write. Alerting then
// would only train the user to ignore the notice.
async function testStartupGracePeriod() {
  await acknowledgeErrors([]);
  await setNewestWrite(NOW - 20 * HOUR);
  const state = freshState();
  const result = await checkWriteLiveness({
    now: NOW,
    startedAtEpoch: NOW - 60,
    thresholdSeconds: THRESHOLD,
    state
  });

  assert.strictEqual(result.stalled, false);
  assert.match(String(result.reason), /grace/);
  const { items } = await listErrors({});
  assert.strictEqual(items.length, 0, "no notice inside the startup grace period");
}

// An empty table is a real signal, not a missing one.
async function testNoWritesEverIsReported() {
  await acknowledgeErrors([]);
  await getDb().run(`DELETE FROM Postings;`);
  const state = freshState();
  const result = await checkWriteLiveness({ now: NOW, thresholdSeconds: THRESHOLD, state });

  assert.strictEqual(result.alerted, true);
  const { items } = await listErrors({});
  assert.match(items[0].message, /No postings have ever been stored/i);
  assert.strictEqual(items[0].context.newest_write_epoch, null, "no write to point at");
}

async function main() {
  await setup();
  await testFiresWhenWritesHaveStopped();
  await testSilentWhenWritesAreRecent();
  await testDoesNotRepeatWithinAnEpisode();
  await testRecoveryResetsTheEpisode();
  await testStartupGracePeriod();
  await testNoWritesEverIsReported();
  console.log("write-liveness tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
