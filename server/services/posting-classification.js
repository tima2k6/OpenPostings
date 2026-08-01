const {
  nowEpochSeconds,
  parsePostingDateToEpochSeconds,
  getPostingFreshnessWindowSeconds
} = require("../helpers/normalize-numbers.js");

const FRESHNESS_LABELS = Object.freeze({
  confirmed_recent: "Recently posted",
  newly_discovered: "Newly discovered (posting date unconfirmed)",
  unknown_date: "Posting date unknown",
  stale_live: "Older posting, still listed",
  delisted: "No longer listed"
});

function parseTrustworthyPostingDate(row, nowEpoch = nowEpochSeconds()) {
  const raw = String(row?.posting_date || "").trim();
  if (!raw) return { epoch: null, confidence: "missing" };

  const lower = raw.toLowerCase();
  if (lower.includes("source date unavailable") || lower.includes("synced to database")) {
    return { epoch: null, confidence: "missing" };
  }

  const parsed = parsePostingDateToEpochSeconds(raw, nowEpoch);
  if (!parsed) return { epoch: null, confidence: "uncertain" };

  // A source date far in the future is normally a closing date or malformed board data,
  // not evidence that a role was posted recently.
  if (parsed > nowEpoch + 24 * 60 * 60) {
    return { epoch: null, confidence: "uncertain" };
  }

  return { epoch: parsed, confidence: "confirmed" };
}

function classifyPosting(row, options = {}) {
  const nowEpoch = Number(options.now_epoch || nowEpochSeconds());
  const windowSeconds = Math.max(
    1,
    Number(options.freshness_window_seconds || getPostingFreshnessWindowSeconds())
  );
  const cutoff = nowEpoch - windowSeconds;
  const hiddenReason = String(row?.hidden_reason || "").trim().toLowerCase();
  const status = String(row?.status || "unverified").trim().toLowerCase();
  const isDelisted = hiddenReason === "delisted" || status === "dead";
  const postingDate = parseTrustworthyPostingDate(row, nowEpoch);
  const firstSeenEpoch = Number(row?.first_seen_epoch || 0);

  let freshnessKey;
  if (isDelisted) {
    freshnessKey = "delisted";
  } else if (postingDate.epoch && postingDate.epoch >= cutoff) {
    freshnessKey = "confirmed_recent";
  } else if (postingDate.epoch) {
    freshnessKey = "stale_live";
  } else if (firstSeenEpoch >= cutoff && firstSeenEpoch <= nowEpoch + 60) {
    freshnessKey = "newly_discovered";
  } else {
    freshnessKey = "unknown_date";
  }

  const descriptionAvailable = row?.description_available !== undefined
    ? Boolean(Number(row.description_available))
    : Boolean(String(row?.job_description || "").trim());
  const locationAvailable = Boolean(String(row?.location || "").trim());
  const locationConflict = Boolean(Number(row?.location_conflict || 0));
  const compensationAvailable =
    Number(row?.pay_min || 0) > 0 ||
    Number(row?.pay_max || 0) > 0 ||
    Boolean(String(row?.pay_raw || "").trim());

  return {
    freshness: {
      key: freshnessKey,
      label: FRESHNESS_LABELS[freshnessKey],
      window_hours: Math.round((windowSeconds / 3600) * 10) / 10
    },
    confidence: {
      posting_date: postingDate.confidence,
      description: descriptionAvailable ? "available" : "missing",
      location: locationConflict ? "conflict" : locationAvailable ? "available" : "missing",
      compensation: compensationAvailable ? "available" : "missing",
      liveness: isDelisted ? "delisted" : status === "active" ? "confirmed_live" : "listed_unverified"
    }
  };
}

function enrichPostingClassification(row, options = {}) {
  return { ...row, ...classifyPosting(row, options) };
}

module.exports = {
  FRESHNESS_LABELS,
  parseTrustworthyPostingDate,
  classifyPosting,
  enrichPostingClassification
};
