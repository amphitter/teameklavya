/**
 * Resilience Utilities (Part 5, Phase 1 — spec §29–31)
 * ─────────────────────────────────────────────────────
 * withTimeout        — no operation may hang forever (§29)
 * retryWithBackoff   — selective retries: transient errors ONLY, with
 *                      exponential backoff + jitter; never validation /
 *                      auth / duplicate / rate-limit errors (§30)
 * createCircuitBreaker — optional providers (email, storage, analytics)
 *                      fail fast instead of piling up hung requests;
 *                      their failure must never crash EventHub (§31, §68)
 */

const { OperationTimeoutError, ProviderUnavailableError } = require("./app-error");
const metrics = require("../services/metrics.service");

/**
 * Run a promise (or zero-arg function returning one) with a hard deadline.
 * The underlying operation keeps running but the CALLER is released with
 * OperationTimeoutError (retryable) — abort/cancellation is used where the
 * underlying API supports it.
 */
function withTimeout(promiseOrFn, ms, label = "operation") {
  const promise = typeof promiseOrFn === "function" ? promiseOrFn() : promiseOrFn;
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new OperationTimeoutError(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => clearTimeout(timer));
}

/**
 * Selective retry with exponential backoff + full jitter (§30).
 *
 * @param {() => Promise} fn
 * @param {object} opts
 * @param {number} opts.retries      attempts AFTER the first try (default 2)
 * @param {number} opts.baseMs       first backoff scale (default 150)
 * @param {number} opts.maxMs        backoff ceiling (default 2000)
 * @param {(err: Error) => boolean} opts.retryOn  defaults to err.retryable === true
 */
async function retryWithBackoff(fn, { retries = 2, baseMs = 150, maxMs = 2000, retryOn } = {}) {
  const shouldRetry = retryOn || ((err) => err && err.retryable === true);
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt === retries || !shouldRetry(err)) throw err;
      const backoff = Math.min(maxMs, baseMs * 2 ** attempt);
      const jitter = Math.floor(Math.random() * backoff); // full jitter — no thundering herd
      await new Promise((r) => setTimeout(r, jitter));
    }
  }
  throw lastError;
}

/* ── Circuit breaker (§31) ──
 * States: CLOSED (normal) → OPEN (fast-fail after `failureThreshold`
 * consecutive errors) → HALF_OPEN (one probe after `cooldownMs`).
 * Success closes, failure re-opens. Every transition is metriced. */
function createCircuitBreaker(name, fn, { failureThreshold = 3, cooldownMs = 30_000, timeoutMs = 15_000 } = {}) {
  const state = { status: "closed", failures: 0, openedAt: 0, halfOpenInFlight: false };

  async function guardedInvoke(...args) {
    const now = Date.now();

    if (state.status === "open") {
      if (now - state.openedAt >= cooldownMs) {
        state.status = "half-open";
        state.halfOpenInFlight = false; // allow one probe
      } else {
        metrics.recordProvider(name, false);
        throw new ProviderUnavailableError(`${name} is temporarily unavailable — try again shortly`);
      }
    }

    if (state.status === "half-open") {
      if (state.halfOpenInFlight) {
        metrics.recordProvider(name, false);
        throw new ProviderUnavailableError(`${name} is temporarily unavailable — try again shortly`);
      }
      state.halfOpenInFlight = true;
    }

    try {
      const result = await withTimeout(() => fn(...args), timeoutMs, `${name} call`);
      metrics.recordProvider(name, true);
      state.status = "closed";
      state.failures = 0;
      state.halfOpenInFlight = false;
      return result;
    } catch (err) {
      state.failures += 1;
      state.halfOpenInFlight = false;
      if (state.status === "half-open" || state.failures >= failureThreshold) {
        state.status = "open";
        state.openedAt = now;
        console.warn(`[breaker] ${name} OPEN after ${state.failures} failure(s): ${err?.message || err}`);
      }
      metrics.recordProvider(name, false);
      throw err;
    }
  }

  return {
    invoke: guardedInvoke,
    getState: () => ({ ...state }),
    reset: () => {
      state.status = "closed";
      state.failures = 0;
      state.halfOpenInFlight = false;
    },
  };
}

module.exports = { withTimeout, retryWithBackoff, createCircuitBreaker };
