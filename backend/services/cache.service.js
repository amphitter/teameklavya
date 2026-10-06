/**
 * EventHub Cache Service (Part 5, Phase 1 — spec §8–15, §58, §66)
 * ─────────────────────────────────────────────────────────────
 * ONE cache facade for the whole app. Business logic never talks to a
 * cache provider directly — it calls cache.getOrSet() with a key from
 * the centralized builder. Today: in-memory LRU. Tomorrow: Redis —
 * by implementing the CacheProvider interface ONLY (§66), with zero
 * changes to call sites.
 *
 * Guarantees enforced here (§10, §14):
 *   • PRIVATE key prefixes can NEVER be served stale-while-revalidate.
 *   • Private/user-scoped keys always embed the user identity —
 *     enforced by convention in the key builder (followList(userId)).
 *   • Concurrent identical loads share ONE in-flight promise (§15).
 *
 * Every cached domain documents owner + TTL + invalidation trigger in
 * the TTL registry below (§13).
 */

const metrics = require("./metrics.service");

/* ── CacheProvider interface (§66 — implement for Redis later) ──
 * A provider must expose:
 *   get(key)            -> { value, expiresAt } | null   (fresh only)
 *   getStale(key)       -> { value } | null              (even if expired, if retained)
 *   set(key, value, ttlMs)
 *   del(key)
 *   delPrefix(prefix)   -> number of keys removed
 *   size()              -> number of live entries
 *   flush()
 */

/* ── In-memory provider (LRU + TTL + stale retention for SWR) ── */
class MemoryCacheProvider {
  constructor({ maxEntries = 500, maxStaleEntries = 500 } = {}) {
    this.maxEntries = maxEntries;
    this.maxStaleEntries = maxStaleEntries;
    this.store = new Map(); // key -> { value, expiresAt } (Map = insertion-order LRU)
    this.stale = new Map(); // key -> { value } (expired-but-recent, for SWR)
  }

  get(key) {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      // expired → park for SWR, stop serving fresh
      this.stale.set(key, { value: entry.value });
      if (this.stale.size > this.maxStaleEntries) {
        this.stale.delete(this.stale.keys().next().value);
        metrics.recordCacheEviction();
      }
      this.store.delete(key);
      return null;
    }
    // LRU touch
    this.store.delete(key);
    this.store.set(key, entry);
    return entry;
  }

  getStale(key) {
    return this.stale.get(key) || null;
  }

  set(key, value, ttlMs) {
    if (this.store.size >= this.maxEntries) {
      const oldest = this.store.keys().next().value;
      this.store.delete(oldest);
      metrics.recordCacheEviction();
    }
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
    this.stale.delete(key); // fresh value supersedes any stale copy
  }

  del(key) {
    this.store.delete(key);
    this.stale.delete(key);
  }

  delPrefix(prefix) {
    let removed = 0;
    for (const key of [...this.store.keys()]) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
        removed += 1;
      }
    }
    for (const key of [...this.stale.keys()]) {
      if (key.startsWith(prefix)) {
        this.stale.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  size() {
    return this.store.size;
  }

  flush() {
    this.store.clear();
    this.stale.clear();
  }
}

/* ── Centralized key builder (§11) — THE only key format in the app ──
 * Private prefixes are listed in PRIVATE_PREFIXES: they may never use
 * stale-while-revalidate and must always embed the caller's identity. */
const PRIVATE_PREFIXES = ["followlist:", "notif:", "user:", "msg:"];

const keys = {
  // public event data
  event: (id) => `event:${id}`,
  eventCounts: (id) => `counts:event:${id}`,
  explore: (bucket) => `explore:${bucket}`, // e.g. explore:upcoming, explore:popular
  trending: (topic) => `trending:${topic || "all"}`,
  // public org/community
  organization: (id) => `org:${id}`,
  community: (id) => `community:${id}`,
  // public post aggregates
  postCounts: (id) => `counts:post:${id}`,
  // public quiz leaderboard (legacy Part 2G poll target)
  quizLeaderboard: (id) => `quiz:board:${id}`,
  // private, per-user (identity is IN the key — never shareable)
  followList: (userId) => `followlist:${userId}`,
  // long-lived static config
  static: (name) => `static:${name}`,
};

/* ── TTL registry (§12–13): every cached domain documents owner,
 *    TTL and its invalidation trigger. Add rows here, never ad-hoc. ── */
const TTL = {
  // owner: event domain · invalidated by: event update/publish/delete (Phase 3 wiring)
  PUBLIC_EVENT: 3 * 60 * 1000,
  // owner: registration domain · invalidated by: registration/interest write
  EVENT_COUNTS: 45 * 1000,
  // owner: discovery · invalidated lazily on event create/update
  EXPLORE: 60 * 1000,
  // owner: feed domain · invalidated lazily on post create (tolerates lag)
  TRENDING: 2 * 60 * 1000,
  // owner: org domain · invalidated by: org profile update / follow change
  ORG_PROFILE: 10 * 60 * 1000,
  // owner: community domain · invalidated by: community update
  COMMUNITY_META: 10 * 60 * 1000,
  // owner: post domain · invalidated by: like/comment write (bounded staleness acceptable)
  POST_COUNTS: 60 * 1000,
  // owner: quiz domain · aligned with the 10s frontend poll (audit §6)
  QUIZ_LEADERBOARD: 5 * 1000,
  // owner: feed domain · private per-user; invalidated by follow/unfollow
  FOLLOW_LIST: 45 * 1000,
  // owner: platform · invalidated only by deploy/restart
  STATIC_CONFIG: 24 * 60 * 60 * 1000,
};

/* ── The service ── */
const maxEntries = Math.max(50, Number(process.env.CACHE_MAX_ENTRIES) || 500);
const provider = new MemoryCacheProvider({ maxEntries });
const inflight = new Map(); // key -> Promise (request dedup, §15)
const disabled = process.env.CACHE_DISABLED === "1"; // escape hatch for debugging

function assertSwrAllowed(key) {
  for (const p of PRIVATE_PREFIXES) {
    if (String(key).startsWith(p)) {
      throw new Error(`cache: stale-while-revalidate is forbidden for private key "${key}" (§14)`);
    }
  }
}

/**
 * Get from cache, or run the loader once and cache the result.
 * Concurrent callers for the same key share one loader run (§15).
 *
 * @param {string} key      from the `keys` builder
 * @param {() => Promise} loader  DB/provider read — MUST be side-effect free
 * @param {object} opts
 * @param {number} opts.ttl      required, ms (use TTL registry)
 * @param {boolean} opts.swr     serve stale immediately + refresh in the
 *                               background (public data only — enforced)
 */
async function getOrSet(key, loader, { ttl, swr = false } = {}) {
  if (disabled || typeof ttl !== "number" || ttl <= 0) return loader();
  if (swr) assertSwrAllowed(key);

  const fresh = provider.get(key);
  if (fresh) {
    metrics.recordCacheHit(key);
    return fresh.value;
  }

  // Stale-while-revalidate: hand out the last value instantly, refresh quietly (§14)
  if (swr) {
    const stale = provider.getStale(key);
    if (stale) {
      metrics.recordCacheStale();
      revalidate(key, loader, ttl); // never awaited by the caller
      return stale.value;
    }
  }

  // In-flight dedup (§15)
  const existing = inflight.get(key);
  if (existing) {
    metrics.recordCacheDedup();
    return existing;
  }

  const promise = (async () => {
    try {
      const value = await loader();
      provider.set(key, value, ttl);
      metrics.recordCacheSet();
      return value;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, promise);
  metrics.recordCacheMiss(key);
  return promise;
}

/** Background refresh for SWR — failures are logged, never thrown. */
function revalidate(key, loader, ttl) {
  loader()
    .then((value) => {
      provider.set(key, value, ttl);
      metrics.recordCacheSet();
    })
    .catch((err) => {
      console.warn(`[cache] SWR revalidation failed for ${key}: ${err?.message || err}`);
    });
}

/** Invalidate one key (call on the domain's write path, §13). */
function invalidate(key) {
  provider.del(key);
  metrics.recordCacheInvalidation(String(key).split(":")[0] + ":");
}

/** Invalidate a whole domain prefix, e.g. "event:", "counts:event:". */
function invalidatePrefix(prefix) {
  const removed = provider.delPrefix(prefix);
  if (removed) metrics.recordCacheInvalidation(prefix);
  return removed;
}

function stats() {
  return { size: provider.size(), inflight: inflight.size, maxEntries, disabled };
}
function flush() {
  provider.flush();
  inflight.clear();
}

module.exports = {
  cache: { getOrSet, invalidate, invalidatePrefix, stats, flush },
  keys,
  TTL,
  PRIVATE_PREFIXES,
  MemoryCacheProvider, // exported for tests + future Redis swap reference
};
