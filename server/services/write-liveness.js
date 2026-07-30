// Notices when the sync stops storing postings.
//
// The error log records failures that happen. This exists for the other case: a write path
// that has gone quiet. Those look identical from outside -- a sync storing nothing and a
// sync with nothing to store both produce no rows and no errors -- and that is how a wedged
// transaction queue went unnoticed for twenty hours. Postings stopped being written at
// 15:57, nothing complained, and the only visible symptom arrived a day later when every
// posting aged out of the app's 24-hour freshness window at once.
//
// last_seen_epoch is the signal, because the sync stamps it on every posting it touches,
// not only on new ones. A healthy pass advances it continuously, so if the newest value in
// the table is hours old while the sync is meant to be running, writes are not landing --
// whatever the cause. That generality is the point: this would have caught the transaction
// wedge without knowing anything about transactions.
const { getDb } = require("./runtime-context.js");
const { nowEpochSeconds } = require("../helpers/normalize-numbers.js");
const { recordError } = require("./error-log.js");

// A full pass takes hours, but writes land throughout it, so two hours of complete silence
// is already well outside normal.
const STALL_THRESHOLD_SECONDS = Number(process.env.WRITE_STALL_THRESHOLD_SECONDS || 2 * 60 * 60);
const CHECK_INTERVAL_MS = Number(process.env.WRITE_STALL_CHECK_INTERVAL_MS || 15 * 60 * 1000);
// One notice per episode rather than one per check, so a stall that lasts a day does not
// bury everything else in the log.
const REALERT_SECONDS = Number(process.env.WRITE_STALL_REALERT_SECONDS || 6 * 60 * 60);

const livenessStatus = {
  last_checked_at: null,
  newest_write_epoch: 0,
  stalled: false,
  seconds_since_write: 0,
  alerts_raised: 0
};

function getWriteLivenessStatus() {
  return livenessStatus;
}

// Split from the loop so it can be tested without waiting on a timer. `startedAtEpoch` is
// the grace period anchor: immediately after boot the newest write is legitimately old on a
// database that has been sitting idle, and alerting then would only teach the user to
// ignore the notice.
async function checkWriteLiveness({
  now = nowEpochSeconds(),
  startedAtEpoch = 0,
  thresholdSeconds = STALL_THRESHOLD_SECONDS,
  realertSeconds = REALERT_SECONDS,
  state = livenessStatus
} = {}) {
  const db = getDb();
  if (!db) return { checked: false, reason: "no database" };

  let newest = 0;
  try {
    const row = await db.get(`SELECT MAX(last_seen_epoch) AS newest FROM Postings;`);
    newest = Number(row?.newest || 0);
  } catch (error) {
    // A table that cannot be read is a different problem, and one the caller of this will
    // already be seeing.
    return { checked: false, reason: String(error?.message || error) };
  }

  const age = newest > 0 ? now - newest : Number.POSITIVE_INFINITY;
  state.last_checked_at = new Date(now * 1000).toISOString();
  state.newest_write_epoch = newest;
  state.seconds_since_write = Number.isFinite(age) ? age : -1;

  // Grace period: nothing is wrong with an idle database that was just opened.
  if (startedAtEpoch && now - startedAtEpoch < thresholdSeconds) {
    state.stalled = false;
    return { checked: true, stalled: false, reason: "within startup grace period" };
  }

  if (age <= thresholdSeconds) {
    // Recovered, so the next stall alerts immediately rather than waiting out the
    // re-alert window from a previous episode.
    state.stalled = false;
    state.last_alert_epoch = 0;
    return { checked: true, stalled: false, seconds_since_write: age };
  }

  state.stalled = true;
  const lastAlert = Number(state.last_alert_epoch || 0);
  if (lastAlert && now - lastAlert < realertSeconds) {
    return { checked: true, stalled: true, alerted: false, reason: "already reported this episode" };
  }

  state.last_alert_epoch = now;
  state.alerts_raised += 1;
  const hours = Number.isFinite(age) ? Math.round((age / 3600) * 10) / 10 : null;
  await recordError({
    source: "sync",
    operation: "write_liveness",
    message:
      hours === null
        ? "No postings have ever been stored. The sync is not writing."
        : `The sync has not stored a posting in ${hours} hours. New listings are not being saved, and the app's listing will empty once existing postings age past the freshness window.`,
    context: {
      seconds_since_write: Number.isFinite(age) ? age : null,
      newest_write_epoch: newest || null,
      threshold_seconds: thresholdSeconds
    }
  });
  return { checked: true, stalled: true, alerted: true, seconds_since_write: age };
}

function startWriteLivenessWatchdog() {
  const startedAtEpoch = nowEpochSeconds();
  let stopped = false;

  const tick = async () => {
    if (stopped) return;
    try {
      await checkWriteLiveness({ startedAtEpoch });
    } catch (error) {
      // A monitor that throws must not take down the process it is monitoring.
      console.error("[OpenPostings API] write liveness check failed:", error);
    }
    if (stopped) return;
    const timer = setTimeout(tick, CHECK_INTERVAL_MS);
    if (typeof timer.unref === "function") timer.unref();
  };

  const first = setTimeout(tick, Math.min(CHECK_INTERVAL_MS, 60 * 1000));
  if (typeof first.unref === "function") first.unref();

  return () => {
    stopped = true;
  };
}

module.exports = {
  startWriteLivenessWatchdog,
  checkWriteLiveness,
  getWriteLivenessStatus,
  STALL_THRESHOLD_SECONDS
};
