/**
 * Distributed lock service (Part 6, Phase 4 — brief §6)
 * ─────────────────────────────────────────────────────────────────────────────
 * Mutual exclusion for the handful of operations that genuinely need it:
 * certificate generation, export generation, duplicate-job prevention, event
 * finalization, leaderboard finalization and media cleanup.
 *
 * Deliberately NOT used anywhere else. A lock is a coordination cost, and
 * most operations are better served by a unique index (which is atomic, free
 * and cannot deadlock) than by a lock. Reach for a lock only when the unit of
 * work spans more than one write and cannot be expressed as a constraint.
 *
 * ── The five properties the brief asks for ──
 *
 * 1. UNIQUE OWNER TOKEN. Every acquisition mints a random token stored as the
 *    lock's value. Release only deletes the key if the value still matches.
 *    Without this, a slow holder whose lock already expired could come back
 *    and delete the lock that a DIFFERENT holder now owns.
 *
 * 2. TTL. Every lock is written with PX. A crashed holder therefore cannot
 *    wedge the system — the lock expires on its own. There is no code path
 *    that creates a lock without a TTL.
 *
 * 3. SAFE RELEASE. Release is a compare-and-delete Lua script, not a bare
 *    DEL. Compare-and-delete is atomic in Redis; doing it as GET-then-DEL
 *    from the app would reintroduce the exact race in (1).
 *
 * 4. TIMEOUT. `withLock` waits a bounded time for the lock and then gives up
 *    rather than queueing forever against a stuck holder.
 *
 * 5. FAILURE HANDLING. If Redis is unreachable the lock cannot be taken.
 *    The caller chooses what that means: `onUnavailable: "proceed"` runs the
 *    work anyway (right default for exports and cleanup, where a duplicate
 *    is wasteful but not corrupt), `"abort"` refuses (right for certificate
 *    issuance, where a duplicate is a real problem). Either way it is an
 *    explicit choice at the call site, never an assumption buried here.
 */

"use strict";

const { randomUUID } = require("crypto");

/** Release only if we still own it — atomic compare-and-delete. */
const RELEASE_LUA = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

/** Extend a lock we still own, without letting it expire mid-work. */
const EXTEND_LUA = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('PEXPIRE', KEYS[1], ARGV[2])
end
return 0
`;

/* ── Memory backend (default, and the fallback) ─────────────────────── */
class MemoryLockBackend {
  constructor() {
    this.locks = new Map(); // name -> { token, expiresAt }
  }

  async acquire(name, token, ttlMs, now = Date.now()) {
    const existing = this.locks.get(name);
    if (existing && existing.expiresAt > now) return false;
    this.locks.set(name, { token, expiresAt: now + ttlMs });
    return true;
  }

  async release(name, token) {
    const existing = this.locks.get(name);
    if (!existing) return false;
    if (existing.token !== token) return false; // not ours — leave it alone
    this.locks.delete(name);
    return true;
  }

  async extend(name, token, ttlMs, now = Date.now()) {
    const existing = this.locks.get(name);
    if (!existing || existing.token !== token) return false;
    existing.expiresAt = now + ttlMs;
    return true;
  }

  stats() {
    return { backend: "memory", held: this.locks.size };
  }
}

/* ── Redis backend ──────────────────────────────────────────────────── */
class RedisLockBackend {
  constructor(runner, { keyPrefix, fallback } = {}) {
    this.runner = runner;
    this.keyPrefix = keyPrefix || "eh:v1:lock:";
    this.fallback = fallback || new MemoryLockBackend();
    this.stats_ = { acquires: 0, acquired: 0, contended: 0, releases: 0, errors: 0, fallbacks: 0, lastError: null };
    /* Set on every acquire. TRUE means "the last acquire was served by the
     * in-process fallback", i.e. this lock is NOT mutually exclusive across
     * instances. It is per-acquire rather than cumulative because a single
     * transient blip must not condemn every future lock forever. */
    this.degraded = false;
  }

  keyFor(name) {
    return `${this.keyPrefix}${name}`;
  }

  async acquire(name, token, ttlMs) {
    this.stats_.acquires += 1;
    try {
      // NX + PX in one atomic command: claim-and-expire, never claim-only.
      const res = await this.runner([
        "SET",
        this.keyFor(name),
        token,
        "NX",
        "PX",
        Math.max(1, Math.round(ttlMs)),
      ]);
      if (!res.ok) throw new Error(res.error);
      /* SET NX answers "OK" (taken) or nil (contended). Anything else is not an
       * answer — reporting it as "contended" would make the caller believe
       * another instance holds the lock when in fact we could not tell. */
      if (res.result !== "OK" && res.result !== true && res.result !== null && res.result !== undefined) {
        throw new Error(`malformed lock result: ${String(res.result).slice(0, 60)}`);
      }
      const got = res.result === "OK" || res.result === true;
      this.degraded = false;
      if (got) this.stats_.acquired += 1;
      else this.stats_.contended += 1;
      return got;
    } catch (err) {
      this.stats_.errors += 1;
      this.stats_.fallbacks += 1;
      this.stats_.lastError = String(err?.message || err).slice(0, 200);
      /* The fallback is process-local. Serving from it means two instances can
       * both hold "the" lock at once, which is the one thing a lock exists to
       * prevent. We still use it — refusing outright would break every
       * `proceed` call site — but we MARK it, so the caller can tell the
       * difference between "I hold a distributed lock" and "I hold a local
       * one and must assume I do not have mutual exclusion". */
      this.degraded = true;
      return this.fallback.acquire(name, token, ttlMs);
    }
  }

  async release(name, token) {
    this.stats_.releases += 1;
    try {
      const res = await this.runner(["EVAL", RELEASE_LUA, "1", this.keyFor(name), token]);
      if (!res.ok) throw new Error(res.error);
      return Number(res.result) === 1;
    } catch (err) {
      this.stats_.errors += 1;
      return this.fallback.release(name, token);
    }
  }

  async extend(name, token, ttlMs) {
    try {
      const res = await this.runner(["EVAL", EXTEND_LUA, "1", this.keyFor(name), token, String(Math.round(ttlMs))]);
      if (!res.ok) throw new Error(res.error);
      return Number(res.result) === 1;
    } catch (err) {
      this.stats_.errors += 1;
      return this.fallback.extend(name, token, ttlMs);
    }
  }

  stats() {
    return { backend: "redis", ...this.stats_ };
  }
}

/* ── The service ────────────────────────────────────────────────────── */
class DistributedLockService {
  constructor(backend, { logger } = {}) {
    this.backend = backend;
    this.logger = logger || console;
  }

  /**
   * Try once to take `name`.
   * @returns {Promise<{name, token, release, extend}|null>} null if contended
   */
  async acquire(name, { ttlMs = 30_000, owner = null } = {}) {
    const token = owner || randomUUID();
    const got = await this.backend.acquire(name, token, ttlMs);
    if (!got) return null;
    return {
      name,
      token,
      /* FALSE means the backend served this from a process-local fallback:
       * treat mutual exclusion as NOT established. */
      distributed: this.backend.degraded === true ? false : true,
      release: () => this.backend.release(name, token),
      extend: (ms) => this.backend.extend(name, token, ms),
    };
  }

  /**
   * Run `fn` while holding `name`.
   *
   * @param {string} name
   * @param {(lock) => Promise<*>} fn
   * @param {object} [opts]
   * @param {number} [opts.ttlMs]        lock lifetime; must exceed the work
   * @param {number} [opts.waitMs]       how long to wait for a contended lock
   * @param {number} [opts.retryMs]      poll interval while waiting
   * @param {"proceed"|"abort"} [opts.onContended]     lock held by someone else
   * @param {"proceed"|"abort"} [opts.onUnavailable]   lock backend unreachable
   * @returns {Promise<{ran: boolean, result?: *, reason?: string}>}
   *          `ran:false` means the work was SKIPPED, which is always reported
   *          rather than swallowed — a silently skipped export is a bug.
   */
  async withLock(name, fn, opts = {}) {
    const {
      ttlMs = 30_000,
      waitMs = 0,
      retryMs = 100,
      onContended = "abort",
      onUnavailable = "proceed",
    } = opts;

    const deadline = Date.now() + Math.max(0, waitMs);
    let lock = null;

    for (;;) {
      lock = await this.acquire(name, { ttlMs });
      if (lock) break;
      if (Date.now() >= deadline) break;
      await new Promise((r) => setTimeout(r, Math.min(retryMs, Math.max(1, deadline - Date.now()))));
    }

    if (!lock) {
      // Distinguish "someone else has it" from "we could not tell".
      // NOTE: this used to read `stats_.errors > 0`, which is cumulative — one
      // transient blip made EVERY later lock report unavailable, so an `abort`
      // call site would never run again for the life of the process.
      const unavailable = this.backend.degraded === true;
      const mode = unavailable ? onUnavailable : onContended;
      if (mode === "proceed") {
        this.logger.warn(`[lock] "${name}" unavailable — proceeding without it`);
        const result = await fn({ held: false, name, token: null });
        return { ran: true, locked: false, result };
      }
      return { ran: false, locked: false, reason: unavailable ? "unavailable" : "contended" };
    }

    /* We got a lock, but it may be process-local. An `abort` caller asked for
     * "do not run unless you really hold it", and a fallback lock does not
     * satisfy that — two instances would both be running. Release and report.
     * This is the case the previous code missed: because the fallback made
     * acquire() SUCCEED, onUnavailable never got consulted at all. */
    if (lock.distributed === false && onUnavailable === "abort") {
      try {
        await lock.release();
      } catch {
        /* releasing a fallback lock that is already gone is not an error */
      }
      return { ran: false, locked: false, distributed: false, reason: "unavailable" };
    }

    try {
      const result = await fn({
        held: true,
        /* The whole point: `held` is true but `distributed` may be false. A
         * caller that cannot tolerate running without real mutual exclusion
         * must be able to see that. */
        distributed: lock.distributed,
        name,
        token: lock.token,
        extend: lock.extend,
      });
      return { ran: true, locked: true, distributed: lock.distributed, result };
    } finally {
      // Always release, even if fn threw — and only ever our own lock.
      try {
        await lock.release();
      } catch (err) {
        this.logger.warn(`[lock] failed to release "${name}": ${err?.message || err}`);
      }
    }
  }

  stats() {
    return this.backend.stats ? this.backend.stats() : {};
  }
}

/* ── Selection ──────────────────────────────────────────────────────── */
const { createRedisRunner } = require("./sliding-window.store");

let resolved = null;
function lockService() {
  if (resolved) return resolved;
  const requested = String(process.env.LOCK_PROVIDER || process.env.CACHE_PROVIDER || "memory").toLowerCase();
  let backend;
  if (requested === "upstash") {
    const runner = createRedisRunner();
    if (runner) {
      backend = new RedisLockBackend(runner, {
        keyPrefix: `${process.env.CACHE_KEY_NAMESPACE || "eh"}:${process.env.CACHE_KEY_VERSION || "v1"}:lock:`,
      });
    } else {
      console.warn("[lock] upstash requested but not configured — using the in-process lock.");
    }
  }
  resolved = new DistributedLockService(backend || new MemoryLockBackend());
  return resolved;
}

function resetLockService() {
  resolved = null;
}

module.exports = {
  DistributedLockService,
  MemoryLockBackend,
  RedisLockBackend,
  lockService,
  resetLockService,
  RELEASE_LUA,
  EXTEND_LUA,
};
