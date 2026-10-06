/**
 * Distributed idempotency key store (Part 6, Phase 3 — brief §5)
 * ─────────────────────────────────────────────────────────────────────────────
 * One operation: "claim this key, atomically, or tell me someone else has it."
 *
 *   Server A: POST /registration  Idempotency-Key: abc123  → claim succeeds
 *   Server B: POST /registration  Idempotency-Key: abc123  → claim FAILS → 409
 *
 * The whole point is that Server B's answer does not depend on Server A being
 * the same process. Today it does, because the keys live in a process-local
 * Map — which is fine on one instance and silently wrong on two.
 *
 * Redis implements this with a single command:
 *
 *   SET <key> <value> NX PX <ttl>
 *
 * `NX` makes the write conditional on the key not existing, and Redis executes
 * it atomically. Two instances racing for the same key cannot both win: one
 * gets OK, the other gets nil. There is no read-then-write window, so there is
 * no version of this bug where both servers admit the request.
 *
 * FAILURE POLICY — MEMORY FALLBACK, NOT FAIL-OPEN.
 * This differs from rate limiting (Phase 2) on purpose. A rate limiter that
 * cannot see its store can safely allow everything: the worst case is
 * temporarily weaker abuse protection. An idempotency store that cannot see
 * its store cannot safely allow everything — the worst case is a duplicate
 * registration, a double payment or two tickets for one seat. So on a Redis
 * outage we fall back to the per-instance memory store: dedup is weaker
 * (per-instance instead of cluster-wide) but it is not absent, and business-
 * critical writes keep working.
 *
 * Do NOT store the response body here. Keys only. Caching responses would
 * mean putting user payloads in Redis, widening the blast radius of a
 * compromised cache and adding a privacy surface for no functional gain —
 * the 409 already tells the client the submission landed.
 */

"use strict";

const MAX_KEYS = 10_000;

/* ── Memory store — today's behaviour, unchanged ────────────────────── */
class MemoryIdempotencyStore {
  constructor() {
    this.seen = new Map(); // key -> expiresAt (epoch ms)
  }

  /**
   * @returns {Promise<{acquired: boolean, expiresAt: number, degraded?: boolean}>}
   */
  async claim(key, ttlMs, now = Date.now()) {
    this.prune(now);
    const existing = this.seen.get(key);
    if (existing && existing > now) {
      return { acquired: false, expiresAt: existing };
    }
    this.seen.set(key, now + ttlMs);
    if (this.seen.size > MAX_KEYS) this.seen.clear(); // safety valve
    return { acquired: true, expiresAt: now + ttlMs };
  }

  async release(key) {
    this.seen.delete(key);
  }

  prune(now) {
    if (this.seen.size < MAX_KEYS / 2) return; // cheap skip while small
    for (const [key, expiresAt] of this.seen) {
      if (expiresAt <= now) this.seen.delete(key);
    }
  }

  stats() {
    return { backend: "memory", trackedKeys: this.seen.size };
  }
}

/* ── Redis store ────────────────────────────────────────────────────── */
class RedisIdempotencyStore {
  /**
   * @param {object} runner async (args) => { ok, result, error }
   * @param {object} [fallback] used when Redis is unreachable
   */
  constructor(runner, { keyPrefix, fallback } = {}) {
    this.runner = runner;
    this.keyPrefix = keyPrefix || "eh:v1:idem:";
    this.fallback = fallback || new MemoryIdempotencyStore();
    this.stats_ = { claims: 0, acquired: 0, rejected: 0, errors: 0, fallbacks: 0, lastError: null };
  }

  keyFor(key) {
    return `${this.keyPrefix}${key}`;
  }

  async claim(key, ttlMs, now = Date.now()) {
    this.stats_.claims += 1;
    try {
      const res = await this.runner(["SET", this.keyFor(key), String(now), "NX", "PX", Math.max(1, Math.round(ttlMs))]);
      if (!res.ok) throw new Error(res.error);

      // "OK" = we claimed it. nil = someone else already had it.
      const acquired = res.result === "OK" || res.result === true;
      if (acquired) this.stats_.acquired += 1;
      else this.stats_.rejected += 1;
      return { acquired, expiresAt: now + ttlMs };
    } catch (err) {
      // Degrade to per-instance dedup rather than allowing duplicates.
      this.stats_.errors += 1;
      this.stats_.fallbacks += 1;
      this.stats_.lastError = String(err?.message || err).slice(0, 200);
      const out = await this.fallback.claim(key, ttlMs, now);
      return { ...out, degraded: true };
    }
  }

  async release(key) {
    try {
      await this.runner(["DEL", this.keyFor(key)]);
    } catch (err) {
      this.stats_.errors += 1;
    }
    await this.fallback.release(key);
  }

  stats() {
    return { backend: "redis", ...this.stats_ };
  }
}

/* ── Selection ──────────────────────────────────────────────────────── */
const { createRedisRunner } = require("./sliding-window.store");

let resolved = null;
function idempotencyStore() {
  if (resolved) return resolved;
  const requested = String(process.env.IDEMPOTENCY_PROVIDER || process.env.CACHE_PROVIDER || "memory").toLowerCase();
  if (requested === "upstash") {
    const runner = createRedisRunner();
    if (runner) {
      resolved = new RedisIdempotencyStore(runner, {
        keyPrefix: `${process.env.CACHE_KEY_NAMESPACE || "eh"}:${process.env.CACHE_KEY_VERSION || "v1"}:idem:`,
      });
      return resolved;
    }
    // No credentials — degrade quietly rather than refusing to boot.
    console.warn("[idempotency] upstash requested but not configured — using the in-memory store.");
  }
  resolved = new MemoryIdempotencyStore();
  return resolved;
}

function resetStore() {
  resolved = null;
}

module.exports = {
  MemoryIdempotencyStore,
  RedisIdempotencyStore,
  idempotencyStore,
  resetStore,
};
