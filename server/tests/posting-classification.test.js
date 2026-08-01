const assert = require("assert");
const { classifyPosting } = require("../services/posting-classification.js");

const NOW = 2_000_000_000;
const DAY = 86400;
const OPTIONS = { now_epoch: NOW, freshness_window_seconds: DAY };

assert.strictEqual(
  classifyPosting({ posting_date: new Date((NOW - 3600) * 1000).toISOString(), first_seen_epoch: NOW - 10 }, OPTIONS).freshness.key,
  "confirmed_recent"
);
assert.strictEqual(
  classifyPosting({ posting_date: new Date((NOW - DAY) * 1000).toISOString() }, OPTIONS).freshness.key,
  "confirmed_recent",
  "the freshness cutoff is inclusive"
);
assert.strictEqual(
  classifyPosting({ posting_date: new Date((NOW - DAY - 1) * 1000).toISOString(), status: "active" }, OPTIONS).freshness.key,
  "stale_live"
);
assert.strictEqual(
  classifyPosting({ posting_date: "", first_seen_epoch: NOW - 10 }, OPTIONS).freshness.key,
  "newly_discovered"
);
assert.strictEqual(
  classifyPosting({ posting_date: "", first_seen_epoch: NOW - DAY }, OPTIONS).freshness.key,
  "newly_discovered",
  "the discovery cutoff is inclusive"
);
assert.strictEqual(
  classifyPosting({ posting_date: "", first_seen_epoch: NOW - 2 * DAY }, OPTIONS).freshness.key,
  "unknown_date"
);
assert.strictEqual(
  classifyPosting({ posting_date: "2033-04-01", first_seen_epoch: NOW - 10, status: "active" }, OPTIONS).freshness.key,
  "stale_live"
);
assert.strictEqual(
  classifyPosting({ posting_date: new Date((NOW - 3600) * 1000).toISOString(), hidden_reason: "delisted", status: "dead" }, OPTIONS).freshness.key,
  "delisted"
);

const confidence = classifyPosting({
  posting_date: "Source date unavailable (synced to database)",
  job_description: "Description",
  location: "Seattle, WA",
  location_conflict: 1,
  pay_min: 100000,
  status: "active"
}, OPTIONS).confidence;
assert.deepStrictEqual(confidence, {
  posting_date: "missing",
  description: "available",
  location: "conflict",
  compensation: "available",
  liveness: "confirmed_live"
});

console.log("posting-classification tests passed");
