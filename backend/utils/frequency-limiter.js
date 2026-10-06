/**
 * Sliding-window frequency counter (Part 5, Phase 2 — spec §23, §27)
 * ────────────────────────────────────────────────────────────
 * In-process per-key sliding window shared by:
 *   • HTTP action guards (middleware/action-guard.js) — follow/like/comment
 *     loops, community-create cooldown, door-scan throughput cap
 *   • Socket guards (services/realtime.service.js) — per-user/IP connect,
 *     event-join and answer caps (§24 REALTIME)
 *
 * NOT a distributed limiter — this monolith runs as a single process by
 * design (no new infrastructure, standing rule). Memory is bounded:
 * expired stamps are pruned opportunistically and a hard cap wipes the
 * table rather than letting it grow unbounded.
 */

const MAX_TRACKED_KEYS = 20_000;

class SlidingWindow {
  /**
   * @param {number} max       max hits per key inside the window
   * @param {number} windowMs  window length in milliseconds
   */
  constructor(max, windowMs) {
    if (!Number.isFinite(max) || max < 1) throw new Error("SlidingWindow: max must be ≥ 1");
    if (!Number.isFinite(windowMs) || windowMs < 1) throw new Error("SlidingWindow: windowMs must be ≥ 1");
    this.max = max;
    this.windowMs = windowMs;
    this.hits = new Map(); // key -> number[] (hit timestamps)
  }

  /**
   * Record a hit for `key` and report whether it is allowed.
   * @returns {{ allowed: boolean, retryAfterMs: number }}
   *          retryAfterMs = ms until the oldest blocking hit leaves the window
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
      return { allowed: false, retryAfterMs };
    }
    stamps.push(now);
    this.maybePrune(now);
    return { allowed: true, retryAfterMs: 0 };
  }

  /** Bounded memory: prune idle keys when the table grows, wipe at the cap. */
  maybePrune(now) {
    if (this.hits.size < MAX_TRACKED_KEYS / 4) return; // cheap skip while small
    const cutoff = now - this.windowMs;
    for (const [key, stamps] of this.hits) {
      while (stamps.length && stamps[0] <= cutoff) stamps.shift();
      if (!stamps.length) this.hits.delete(key);
    }
    if (this.hits.size > MAX_TRACKED_KEYS) this.hits.clear(); // safety valve
  }

  stats() {
    return { trackedKeys: this.hits.size, max: this.max, windowMs: this.windowMs };
  }
}

module.exports = { SlidingWindow };
