const { AsyncLocalStorage } = require("node:async_hooks");
const { parsePositiveInteger } = require("../helpers/normalize-numbers.js");
const { ATS_REQUEST_QUEUE_CONCURRENCY_DEFAULT, getAtsRequestQueueConcurrency } = require("../services/runtime-context.js");

const ATS_RATE_LIMIT_MAX_RETRIES_RAW = Number(process.env.ATS_RATE_LIMIT_MAX_RETRIES || 0);
const FETCH_TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS || 12000);
const ATS_RATE_LIMIT_MAX_RETRIES =
  Number.isFinite(ATS_RATE_LIMIT_MAX_RETRIES_RAW) && ATS_RATE_LIMIT_MAX_RETRIES_RAW > 0
    ? Math.floor(ATS_RATE_LIMIT_MAX_RETRIES_RAW)
    : 0;
const ATS_RATE_LIMIT_MAX_COOLDOWN_MS_RAW = Number(process.env.ATS_RATE_LIMIT_MAX_COOLDOWN_MS || 0);
const ATS_RATE_LIMIT_MAX_COOLDOWN_MS =
  Number.isFinite(ATS_RATE_LIMIT_MAX_COOLDOWN_MS_RAW) && ATS_RATE_LIMIT_MAX_COOLDOWN_MS_RAW > 0
    ? Math.floor(ATS_RATE_LIMIT_MAX_COOLDOWN_MS_RAW)
    : 0;
const MIN_ATS_REQUEST_QUEUE_CONCURRENCY = 1;
const MAX_ATS_REQUEST_QUEUE_CONCURRENCY = 20;
const atsRateLimitStateByKey = new Map();
const atsFixedIntervalStateByKey = new Map();
const requestSignalContext = new AsyncLocalStorage();

function abortError(signal, fallbackMessage = "Request aborted") {
  const reason = signal?.reason;
  if (reason instanceof Error) return reason;
  const error = new Error(String(reason || fallbackMessage));
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError(signal);
}

function getRequestSignal() {
  return requestSignalContext.getStore()?.signal || null;
}

function runWithRequestSignal(signal, task) {
  if (typeof task !== "function") throw new TypeError("runWithRequestSignal requires a task function");
  return requestSignalContext.run({ signal: signal || null }, task);
}

// Collectors consume the Response after this helper returns. Buffering here keeps the
// AbortController and queue slot alive through response.text()/json(), rather than timing
// out only the headers and allowing a stalled body to strand a sync worker forever.
async function bufferResponse(response) {
  // Parser unit tests use deliberately tiny Response-like doubles. Production fetch
  // responses always have arrayBuffer(), so leaving doubles unchanged preserves that
  // useful seam without weakening the real request path.
  if (!response || typeof response.arrayBuffer !== "function" || typeof Response !== "function") {
    return response;
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  const status = Number(response.status || 0);
  const bodyForbidden = status === 101 || status === 103 || status === 204 || status === 205 || status === 304;
  const buffered = new Response(bodyForbidden ? null : bytes, {
    status,
    statusText: response.statusText,
    headers: response.headers
  });

  // The Response constructor does not accept fetch metadata. Several collectors use the
  // final redirect URL, so preserve it along with the other observable fetch properties.
  for (const property of ["url", "redirected", "type"]) {
    try {
      Object.defineProperty(buffered, property, {
        configurable: true,
        enumerable: true,
        value: response[property]
      });
    } catch {}
  }
  return buffered;
}

async function fetchWithAtsRateLimit(rateLimitKey, fallbackWaitMs, url, init = {}) {
  let rateLimitRetryCount = 0;
  while (true) {
    if (ATS_RATE_LIMIT_MAX_RETRIES > 0 && rateLimitRetryCount >= ATS_RATE_LIMIT_MAX_RETRIES) {
      throw new Error(
        `ATS rate-limit retry cap reached for '${String(rateLimitKey || "unknown")}' after ${ATS_RATE_LIMIT_MAX_RETRIES} retries`
      );
    }

    const requestSignal = init.signal || getRequestSignal();
    await acquireAtsRequestSlot(rateLimitKey, requestSignal);
    const controller = new AbortController();
    const abortFromRequest = () => controller.abort(requestSignal?.reason || abortError(requestSignal));
    if (requestSignal?.aborted) abortFromRequest();
    else requestSignal?.addEventListener("abort", abortFromRequest, { once: true });

    let timeout = null;
    try {
      await waitForAtsCooldown(rateLimitKey, {
        max_cooldown_ms: ATS_RATE_LIMIT_MAX_COOLDOWN_MS,
        signal: requestSignal
      });
      throwIfAborted(requestSignal);

      timeout = setTimeout(() => {
        const error = new Error(
          `ATS request timed out after ${FETCH_TIMEOUT_MS}ms for '${String(rateLimitKey || "unknown")}'`
        );
        error.name = "TimeoutError";
        controller.abort(error);
      }, FETCH_TIMEOUT_MS);
      if (typeof timeout.unref === "function") timeout.unref();

      const res = await fetch(url, {
        ...init,
        signal: controller.signal
      });

      if (res.status === 429) {
        rateLimitRetryCount += 1;
        markAtsRateLimited(rateLimitKey, resolveAtsRateLimitWaitMs(res, fallbackWaitMs));
        try {
          await res.body?.cancel();
        } catch {}
        continue;
      }

      return await bufferResponse(res);
    } finally {
      if (timeout) clearTimeout(timeout);
      requestSignal?.removeEventListener("abort", abortFromRequest);
      releaseAtsRequestSlot(rateLimitKey);
    }
  }
}

async function waitForAtsFixedInterval(rateLimitKey, minimumIntervalMs) {
  const minInterval = Math.max(0, Number(minimumIntervalMs || 0));
  if (minInterval <= 0) return;

  const key = String(rateLimitKey || "default");
  let state = atsFixedIntervalStateByKey.get(key);
  if (!state) {
    state = {
      chain: Promise.resolve(),
      nextAllowedEpochMs: 0
    };
    atsFixedIntervalStateByKey.set(key, state);
  }

  const previous = state.chain;
  /** @type {(() => void) | null} */
  let release = null;
  state.chain = new Promise((resolve) => {
    release = () => resolve();
  });

  await previous;
  try {
    const waitMs = Math.max(0, Number(state.nextAllowedEpochMs || 0) - Date.now());
    if (waitMs > 0) {
      await sleep(waitMs);
    }
    state.nextAllowedEpochMs = Date.now() + minInterval;
  } finally {
    if (release) {
      release();
    }
  }
}

function normalizeAtsRequestQueueConcurrency(value, fallbackValue = ATS_REQUEST_QUEUE_CONCURRENCY_DEFAULT) {
  const fallback = parsePositiveInteger(fallbackValue) || ATS_REQUEST_QUEUE_CONCURRENCY_DEFAULT;
  const parsed = parsePositiveInteger(value) || fallback;
  return Math.max(MIN_ATS_REQUEST_QUEUE_CONCURRENCY, Math.min(MAX_ATS_REQUEST_QUEUE_CONCURRENCY, parsed));
}

function sleep(ms, explicitSignal = null) {
  const signal = explicitSignal || getRequestSignal();
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(abortError(signal));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function toAtsRateLimitKey(value) {
  const key = String(value || "").trim().toLowerCase();
  return key || "default";
}

function getAtsRateLimitState(rateLimitKey) {
  const normalizedKey = toAtsRateLimitKey(rateLimitKey);
  let state = atsRateLimitStateByKey.get(normalizedKey);
  if (!state) {
    state = {
      active: 0,
      queue: [],
      blockedUntilEpochMs: 0
    };
    atsRateLimitStateByKey.set(normalizedKey, state);
  }
  return state;
}

function parseRetryAfterMilliseconds(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;

  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.max(0, Math.ceil(seconds * 1000));
  }

  const parsedEpochMs = Date.parse(raw);
  if (!Number.isFinite(parsedEpochMs)) return null;
  return Math.max(0, parsedEpochMs - Date.now());
}

function resolveAtsRateLimitWaitMs(res, fallbackWaitMs) {
  const minimumWaitMs = Math.max(0, Number(fallbackWaitMs || 0));
  const retryAfterMs = parseRetryAfterMilliseconds(res?.headers?.get("retry-after"));
  if (!Number.isFinite(retryAfterMs)) return minimumWaitMs;
  return Math.max(minimumWaitMs, retryAfterMs);
}

async function acquireAtsRequestSlot(rateLimitKey, signal = null) {
  throwIfAborted(signal);
  const state = getAtsRateLimitState(rateLimitKey);
  if (state.active < getAtsRequestQueueConcurrency()) {
    state.active += 1;
    return;
  }
  await new Promise((resolve, reject) => {
    const entry = {
      resolve: () => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }
    };
    const onAbort = () => {
      const index = state.queue.indexOf(entry);
      if (index >= 0) state.queue.splice(index, 1);
      signal?.removeEventListener("abort", onAbort);
      reject(abortError(signal));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    state.queue.push(entry);
  });
}

function releaseAtsRequestSlot(rateLimitKey) {
  const state = getAtsRateLimitState(rateLimitKey);
  const next = state.queue.shift();
  if (typeof next?.resolve === "function") {
    next.resolve();
    return;
  }
  state.active = Math.max(0, state.active - 1);
}

function markAtsRateLimited(rateLimitKey, waitMs) {
  const state = getAtsRateLimitState(rateLimitKey);
  const ms = Math.max(0, Number(waitMs || 0));
  state.blockedUntilEpochMs = Math.max(state.blockedUntilEpochMs, Date.now() + ms);
}

async function waitForAtsCooldown(rateLimitKey, options = {}) {
  const maxCooldownMs = Math.max(0, Number(options?.max_cooldown_ms || 0));
  const signal = options?.signal || getRequestSignal();
  const startedAtMs = Date.now();
  const state = getAtsRateLimitState(rateLimitKey);
  while (true) {
    throwIfAborted(signal);
    const waitMs = Number(state.blockedUntilEpochMs || 0) - Date.now();
    if (waitMs <= 0) return;
    if (maxCooldownMs > 0) {
      const elapsedMs = Date.now() - startedAtMs;
      const remainingMs = maxCooldownMs - elapsedMs;
      if (remainingMs <= 0) {
        throw new Error(
          `ATS cooldown exceeded ${maxCooldownMs}ms for '${String(rateLimitKey || "unknown")}'`
        );
      }
      await sleep(Math.min(waitMs, remainingMs), signal);
      continue;
    }
    await sleep(waitMs, signal);
  }
}

module.exports = {
  sleep,
  fetchWithAtsRateLimit,
  runWithRequestSignal,
  waitForAtsFixedInterval,
  normalizeAtsRequestQueueConcurrency,
  ATS_REQUEST_QUEUE_CONCURRENCY_DEFAULT,
  MIN_ATS_REQUEST_QUEUE_CONCURRENCY,
  MAX_ATS_REQUEST_QUEUE_CONCURRENCY
};
