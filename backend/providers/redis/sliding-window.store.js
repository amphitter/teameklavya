/**
 * Shared sliding-window counter (Part 6, Phase 2 — brief §4)
 * ─────────────────────────────────────────────────────────────────────────────
 * EventHub has TWO independent rate limiters that must now share counters
 * across instances:
 *
 *   1. `express-rate-limit` — the 21 HTTP domains (config/rate-limits.js)
 *   2. `SlidingWindow`       — action guards + socket guards
 *      (utils/frequency-limiter.js)
 *
 * Both need exactly the same primitive: "has this key exceeded N hits in the
 * last W milliseconds?" So they share ONE implementation here, and each
 * limiter becomes a thin adapter over it. One algorithm, one place to fix it.
 *
 * Two backends:
 *   MemorySlidingWindow — today's behaviour, unchanged, per-process
 *   RedisSlidingWindow  — a Lua script evaluated IN Redis
 *
 * WHY LUA AND NOT READ-MODIFY-WRITE: a sliding window is a read followed by a
 * conditional write. Doing that from the app is a race — two instances can
 * both read "9 of 10" and both allow, letting 11 requests through. The script
 * runs atomically inside Redis, so the count is correct no matter how many
 * instances are hitting it at once. It also costs exactly ONE round-trip.
 *
 * FAIL-OPEN IS DELIBERATE. If Redis is unreachable, every operation is
 * allowed and the failure is counted. A rate-limiter outage that blocks all
 * traffic is a self-inflicted outage far worse than a temporary absence of
 * rate limiting — and the unique indexes, action guards and auth checks are
 * still in force underneath.
 */

"use strict";

const MAX_TRACKED_KEYS = 20_000;

/* ── The Lua script ─────────────────────────────────────────────────────
 * KEYS[1] the bucket key
 * ARGV[1] now (epoch ms)      ARGV[2] window (ms)
 * ARGV[3] limit               ARGV[4] a unique member id for this hit
 *
 * Returns { totalHits, resetEpochMs, allowed }
 */
const SLIDING_WINDOW_LUA = `
local key    = KEYS[1]
local now    = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit  = tonumber(ARGV[3])
local member = ARGV[4]

redis.call('ZREMRANGEBYSCORE', key, 0, now - window)
local used = redis.call('ZCARD', key)
local allowed = 0
if used < limit then allowed = 1 end

-- ALWAYS record the hit, even when refused. express-rate-limit decides
-- refusal with "totalHits > limit" and its positiveHits validation rejects
-- a count below 1, so a refused request must still increment. Returning the
-- pre-refusal count here would let limit+1 requests through.
redis.call('ZADD', key, now, member)
redis.call('PEXPIRE', key, window)

local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
local reset = now + window
if oldest[2] then reset = tonumber(oldest[2]) + window end
return { used + 1, reset, allowed }
`;

/* ── Memory backend — behaviour identical to the Part 5 SlidingWindow ── */
class MemorySlidingWindow {
  constructor() {
    this.hits = new Map(); // key -> number[] of hit timestamps
  }

  /**
   * @returns {Promise<{allowed, totalHits, resetTime}>}
   */
  async check(key, limit, windowMs, now = Date.now()) {
    const cutoff = now - windowMs;
    let stamps = this.hits.get(key);
    if (!stamps) {
      stamps = [];
      this.hits.set(key, stamps);
    }
    while (stamps.length && stamps[0] <= cutoff) stamps.shift();

    // Same contract as the Lua script: the hit is ALWAYS recorded, and
    // `allowed` reports whether it was within the limit. See the note above
    // SLIDING_WINDOW_LUA for why refusing must still count.
    const allowed = stamps.length < limit;
    const resetTime = new Date(stamps.length ? Math.max(now + 1, stamps[0] + windowMs) : now + windowMs);
    stamps.push(now);
    this.maybePrune(now, windowMs);
    return { allowed, totalHits: stamps.length, resetTime };
  }

  maybePrune(now, windowMs) {
    if (this.hits.size < MAX_TRACKED_KEYS / 4) return;
    const cutoff = now - windowMs;
    for (const [key, stamps] of this.hits) {
      while (stamps.length && stamps[0] <= cutoff) stamps.shift();
      if (!stamps.length) this.hits.delete(key);
    }
    if (this.hits.size > MAX_TRACKED_KEYS) this.hits.clear();
  }

  async reset(key) {
    this.hits.delete(key);
  }

  async resetAll() {
    this.hits.clear();
  }

  stats() {
    return { backend: "memory", trackedKeys: this.hits.size };
  }
}

/* ── Redis backend ──────────────────────────────────────────────────── */
class RedisSlidingWindow {
  /**
   * @param {object} runner  async (args: string[]) => { ok, result, error }
   */
  constructor(runner, { keyPrefix } = {}) {
    this.runner = runner;
    this.keyPrefix = keyPrefix || "eh:v1:rl:";
    this.stats_ = { calls: 0, errors: 0, fallbacks: 0, lastError: null };
  }

  bucketKey(key) {
    return `${this.keyPrefix}${key}`;
  }

  async check(key, limit, windowMs, now = Date.now()) {
    this.stats_.calls += 1;
    const member = `${now}-${Math.random().toString(36).slice(2, 10)}`;
    try {
      const res = await this.runner([
        "EVAL",
        SLIDING_WINDOW_LUA,
        "1",
        this.bucketKey(key),
        String(now),
        String(windowMs),
        String(limit),
        member,
      ]);
      if (!res.ok) throw new Error(res.error);

      /* §12 "malformed": a 200 carrying a body we did not expect. The Lua
       * script answers with [totalHits, resetMs, allowed]; destructuring
       * anything else silently produced allowed=false, which BLOCKED traffic
       * — the opposite of fail-open, and a whole-site outage caused by
       * garbage from upstream. Validate the shape and treat a surprise as a
       * failure so the catch below degrades correctly. */
      if (!Array.isArray(res.result) || res.result.length < 3) {
        throw new Error(`malformed sliding-window result: ${String(res.result).slice(0, 60)}`);
      }
      const [totalHits, resetMs, allowed] = res.result;
      if (allowed !== 0 && allowed !== 1 && Number.isNaN(Number(allowed))) {
        throw new Error(`malformed sliding-window verdict: ${String(allowed).slice(0, 60)}`);
      }
      return {
        allowed: Number(allowed) === 1,
        totalHits: Number(totalHits) || 0,
        resetTime: new Date(Number(resetMs) || now + windowMs),
      };
    } catch (err) {
      // FAIL OPEN — see the header. Count it so the dashboard shows it.
      this.stats_.errors += 1;
      this.stats_.fallbacks += 1;
      this.stats_.lastError = String(err?.message || err).slice(0, 200);
      return { allowed: true, totalHits: 0, resetTime: new Date(now + windowMs), degraded: true };
    }
  }

  async reset(key) {
    try {
      await this.runner(["DEL", this.bucketKey(key)]);
    } catch (err) {
      this.stats_.errors += 1;
      this.stats_.lastError = String(err?.message || err).slice(0, 200);
    }
  }

  async resetAll() {
    // Intentionally not implemented: wiping every rate-limit bucket across
    // the cluster is an operation nobody should be able to trigger
    // accidentally, and SCAN+DEL on a shared instance risks touching keys
    // that are not ours.
  }

  stats() {
    return { backend: "redis", ...this.stats_ };
  }
}

/* ── Shared registry so both limiters can share ONE memory backend ───── */
let sharedMemory = null;
function memoryBackend() {
  if (!sharedMemory) sharedMemory = new MemorySlidingWindow();
  return sharedMemory;
}

/**
 * Build the runner that talks to Upstash. Returns null when unconfigured.
 * Reuses the cache provider's transport so there is exactly one piece of
 * code in the app that knows how to reach Redis.
 */
function createRedisRunner({ url, token, timeoutMs = 2000 } = {}) {
  const rawUrl = String(url || process.env.UPSTASH_REDIS_REST_URL || "").replace(/\/+$/, "");
  const rawToken = String(token || process.env.UPSTASH_REDIS_REST_TOKEN || "");
  if (!rawUrl || !rawToken) return null;

  return async function runner(args) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(rawUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${rawToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(args),
        signal: controller.signal,
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || (body && body.error)) {
        return { ok: false, error: body?.error || `HTTP ${res.status}` };
      }
      return { ok: true, result: body?.result };
    } catch (err) {
      const msg = err?.name === "AbortError" ? `timeout after ${timeoutMs}ms` : err?.message || String(err);
      return { ok: false, error: msg };
    } finally {
      clearTimeout(timer);
    }
  };
}

/**
 * Choose the backend once, at boot.
 *   RATE_LIMIT_PROVIDER=memory   → process-local (default, unchanged)
 *   RATE_LIMIT_PROVIDER=upstash  → shared across instances
 */
let resolved = null;
function rateLimitBackend() {
  if (resolved) return resolved;
  const requested = String(process.env.RATE_LIMIT_PROVIDER || "memory").toLowerCase();
  if (requested === "upstash") {
    const runner = createRedisRunner();
    if (runner) {
      resolved = new RedisSlidingWindow(runner, {
        keyPrefix: `${process.env.CACHE_KEY_NAMESPACE || "eh"}:${process.env.CACHE_KEY_VERSION || "v1"}:rl:`,
      });
      return resolved;
    }
    console.warn("[rate-limit] RATE_LIMIT_PROVIDER=upstash but no Redis credentials — using memory.");
  }
  resolved = memoryBackend();
  return resolved;
}

/** Test hook: forget the memoised backend so a new env can be applied. */
function resetBackend() {
  resolved = null;
}

module.exports = {
  MemorySlidingWindow,
  RedisSlidingWindow,
  createRedisRunner,
  rateLimitBackend,
  resetBackend,
  memoryBackend,
  SLIDING_WINDOW_LUA,
};
