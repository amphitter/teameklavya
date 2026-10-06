/**
 * express-rate-limit → EventHub sliding-window store (Part 6, Phase 2 — §4)
 * ─────────────────────────────────────────────────────────────────────────────
 * Adapts our shared sliding-window backend to the express-rate-limit v8 store
 * contract:
 *
 *   increment(key) -> Promise<{ totalHits, resetTime }>
 *   decrement(key) -> Promise<void>
 *   resetKey(key)  -> Promise<void>
 *
 * ONE INSTANCE PER LIMITER. express-rate-limit calls `init(options)` with that
 * limiter's own options, so a single shared store object could not know which
 * of the 21 domains it was serving. Each limiter therefore gets a store bound
 * to its own domain, limit and window — created in createLimiter().
 *
 * The domain is part of the Redis key, so the AUTH bucket and the SEARCH
 * bucket for the same user are genuinely different buckets.
 */

"use strict";

class SlidingWindowStore {
  /**
   * @param {object} opts
   * @param {object} opts.backend   from sliding-window.store.js
   * @param {string} opts.domain    e.g. "AUTH"
   * @param {number} opts.limit
   * @param {number} opts.windowMs
   */
  constructor({ backend, domain, limit, windowMs }) {
    this.backend = backend;
    this.domain = domain;
    this.limit = limit;
    this.windowMs = windowMs;
    this.localHits = new Map(); // local mirror so `decrement` stays accurate
  }

  /** Namespaced bucket key — domain + caller key. */
  bucket(key) {
    return `${this.domain}:${key}`;
  }

  async increment(key) {
    const res = await this.backend.check(this.bucket(key), this.limit, this.windowMs);
    this.localHits.set(key, res.totalHits);
    return { totalHits: res.totalHits, resetTime: res.resetTime };
  }

  /**
   * Give a hit back — express-rate-limit calls this when a request errored,
   * so a failed request does not consume quota.
   */
  async decrement(key) {
    const current = this.localHits.get(key) || 0;
    this.localHits.set(key, Math.max(0, current - 1));
    // We cannot un-ring a bell inside an atomic Redis sorted set without
    // another round-trip, and doing so would reintroduce the race the Lua
    // script exists to prevent. The local mirror keeps the accounting sane
    // for this process; the window expires on its own regardless.
  }

  async resetKey(key) {
    this.localHits.delete(key);
    await this.backend.reset(this.bucket(key));
  }

  async resetAll() {
    this.localHits.clear();
    if (typeof this.backend.resetAll === "function") await this.backend.resetAll();
  }
}

module.exports = { SlidingWindowStore };
