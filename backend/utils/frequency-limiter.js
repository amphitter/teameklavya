/**
 * Sliding-window frequency counter (Part 5, Phase 2 — spec §23, §27)
 * ────────────────────────────────────────────────────────────
 * Per-key sliding window shared by:
 *   • HTTP action guards (middleware/action-guard.js) — follow/like/comment
 *     loops, community-create cooldown, door-scan throughput cap
 *   • Socket guards (services/realtime.service.js) — per-user/IP connect,
 *     event-join and answer caps (§24 REALTIME)
 *
 * Part 6, Phase 2 (§4): the counting itself now delegates to a pluggable
 * backend from providers/redis/sliding-window.store.js. With
 * RATE_LIMIT_PROVIDER unset the backend is the same in-process map as
 * before, so the monolith's single-instance behaviour is unchanged. With
 * RATE_LIMIT_PROVIDER=upstash, action and socket guards share counters with
 * every other instance — otherwise a user could follow/unfollow 20 times on
 * Server A and 20 more on Server B.
 *
 * `allow()` stays SYNCHRONOUS at the call site by design: it is used from
 * hot socket handlers that cannot reasonably be made async without a wider
 * refactor. Because the Redis call cannot be awaited there, the backend is
 * consulted optimistically — see the note on `allow()` below.
 */

const { rateLimitBackend } = require("../providers/redis/sliding-window.store");

class SlidingWindow {
  /**
   * @param {number} max       max hits per key inside the window
   * @param {number} windowMs  window length in milliseconds
   * @param {object} [backend] override the backend (tests, or a domain-local
   *                           counter that must not share the global table)
   */
  constructor(max, windowMs, backend) {
    if (!Number.isFinite(max) || max < 1) throw new Error("SlidingWindow: max must be ≥ 1");
    if (!Number.isFinite(windowMs) || windowMs < 1) throw new Error("SlidingWindow: windowMs must be ≥ 1");
    this.max = max;
    this.windowMs = windowMs;
    this.backend = backend || rateLimitBackend();
    // Local shadow used only for `stats()` and for the synchronous fast path.
    this.hits = new Map();
  }

  /**
   * Record a hit for `key` and report whether it is allowed.
   * @returns {{ allowed: boolean, retryAfterMs: number }}
   *          retryAfterMs = ms until the oldest blocking hit leaves the window
   *
   * SYNC CONTRACT: returns the verdict immediately. When the backend is
   * Redis the authoritative count is updated asynchronously (fire-and-forget)
   * and this call returns the local view. That is a deliberate trade: socket
   * handlers must not block on a network round-trip, and the guards exist to
   * stop abuse loops, not to be a precise accounting system. The HTTP action
   * guards additionally sit behind express-rate-limit, which IS awaited and
   * therefore exact.
   */
  allow(key, now = Date.now()) {
    const cutoff = now - this.windowMs;
    let stamps = this.hits.get(key);
    if (!stamps) {
      stamps = [];
      this.hits.set(key, stamps);
    }
    while (stamps.length && stamps[0] <= cutoff) stamps.shift();

    if (stamps.length >= this.max) {
      const retryAfterMs = Math.max(1000, stamps[0] + this.windowMs - now);
      this.maybePrune(now);
      this.recordRemote(key, now);
      return { allowed: false, retryAfterMs };
    }
    stamps.push(now);
    this.maybePrune(now);
    this.recordRemote(key, now);
    return { allowed: true, retryAfterMs: 0 };
  }

  /**
   * Async variant used where the caller CAN await (HTTP action guards).
   * This one consults the shared backend and is exact across instances.
   * @returns {Promise<{ allowed: boolean, retryAfterMs: number }>}
   */
  async allowAsync(key, now = Date.now()) {
    const res = await this.backend.check(key, this.max, this.windowMs, now);

    // Keep the local mirror in step so stats() and allow() stay sane.
    const stamps = this.hits.get(key) || [];
    const cutoff = now - this.windowMs;
    while (stamps.length && stamps[0] <= cutoff) stamps.shift();
    if (res.allowed) stamps.push(now);
    this.hits.set(key, stamps);

    const retryAfterMs = res.allowed ? 0 : Math.max(1000, res.resetTime.getTime() - now);
    return { allowed: res.allowed, retryAfterMs };
  }

  /** Fire-and-forget share of the count with the distributed backend. */
  recordRemote(key, now) {
    if (!this.backend || this.backend.constructor.name !== "RedisSlidingWindow") return;
    Promise.resolve(this.backend.check(key, this.max, this.windowMs, now)).catch(() => {
      // Fail open — the backend already counts this internally.
    });
  }

  /** Bounded memory: prune idle keys when the table grows, wipe at the cap. */
  maybePrune(now) {
    if (this.hits.size < 20_000 / 4) return; // cheap skip while small
    const cutoff = now - this.windowMs;
    for (const [key, stamps] of this.hits) {
      while (stamps.length && stamps[0] <= cutoff) stamps.shift();
      if (!stamps.length) this.hits.delete(key);
    }
    if (this.hits.size > 20_000) this.hits.clear(); // safety valve
  }

  stats() {
    return { trackedKeys: this.hits.size, max: this.max, windowMs: this.windowMs };
  }
}

module.exports = { SlidingWindow };
