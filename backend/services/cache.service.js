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

/* ══ Key architecture (Part 6, Phase 1 — §3) ══════════════════════════════
 *
 *   eh:v1:cache:event:665f1a2b3c4d5e6f7a8b9c0d
 *   └┬┘ └┬┘ └──┬──┘ └────────────┬────────────┘
 *    │   │     │                 └── domain + id
 *    │   │     └──────────────────── key class (cache · rl · idem · lock · temp)
 *    │   └────────────────────────── schema version
 *    └────────────────────────────── app namespace
 *
 * Three properties this buys us:
 *
 * 1. NAMESPACE — an Upstash instance may be shared with other apps. Every
 *    key we own is unmistakably ours, and a prefix scan can never touch a
 *    neighbour's data.
 * 2. VERSION — bumping v1 → v2 invalidates the ENTIRE cache with one env
 *    change. That is what makes a future key-shape migration safe: old
 *    entries become unreachable the instant the new build boots, and they
 *    expire on their own. No migration script, no downtime.
 * 3. ONE BUILDER — controllers never construct keys by hand, so a key's
 *    shape, class and privacy are decided in exactly one place.
 */

const NAMESPACE = String(process.env.CACHE_KEY_NAMESPACE || "eh").trim();
const VERSION = String(process.env.CACHE_KEY_VERSION || "v1").trim();

/** Build a fully-qualified key. The ONLY way a key enters this system. */
const build = (domain, id) => `${NAMESPACE}:${VERSION}:cache:${domain}:${id}`;

/**
 * Domains whose values are scoped to one identity and must therefore never
 * be served stale-while-revalidate, and must never be reachable without
 * that identity in the key.
 */
const PRIVATE_DOMAINS = ["followlist", "notif", "user", "msg", "feed", "profile", "community-members"];

/**
 * Is this key private? Handles BOTH fully-built keys and bare domain keys
 * (e.g. "user:private:x"), because the registry guard has to work even when
 * a caller passes an unqualified key.
 */
function isPrivateKey(key) {
  const k = String(key);
  return PRIVATE_DOMAINS.some((d) => k === d || k.startsWith(`${d}:`) || k.includes(`:${d}:`));
}

/** Backwards-compatible export — colon-suffixed, as before Part 6. */
const PRIVATE_PREFIXES = PRIVATE_DOMAINS.map((d) => `${d}:`);

const keys = {
  // ── public event data ──
  event: (id) => build("event", id),
  eventCounts: (id) => build("event-counts", id),
  explore: (bucket) => build("explore", bucket), // e.g. explore:upcoming, explore:popular
  trending: (topic) => build("trending", topic || "all"),
  // ── public org/community ──
  organization: (id) => build("organization", id),
  community: (id) => build("community", id),
  communityMembers: (communityId, cursor = "head") => build("community-members", `${communityId}:${cursor}`),
  // ── public post aggregates ──
  postCounts: (id) => build("post-counts", id),
  // ── public quiz/live leaderboard (legacy Part 2G poll target) ──
  quizLeaderboard: (id) => build("leaderboard", id),
  leaderboard: (activityId) => build("leaderboard", activityId),
  // ── search — keyed by a hash of the normalised query, not the raw text ──
  search: (hash) => build("search", hash),
  // ── slug lookups — every slug form lives here so no caller builds one ──
  eventSlug: (slug) => build("event-slug", slug),
  orgSlug: (slug) => build("org-slug", slug),
  communitySlug: (slug) => build("community-slug", slug),
  // ── counters that repositories previously built by hand ──
  eventStats: (id) => build("stats:event", id),
  interestCount: (id) => build("counts:interest", id),
  orgCounts: (id) => build("counts:org", id),
  communityCounts: (id) => build("counts:community", id),
  // ── private, per-user (identity is IN the key — never shareable) ──
  followList: (userId) => build("followlist", userId),
  feed: (userId, cursor = "head") => build("feed", `${userId}:${cursor}`),
  profile: (userId) => build("profile", userId),
  unreadMessages: (userId) => build("msg", `unread:${userId}`),
  unreadNotifications: (userId) => build("notif", `unread:${userId}`),
  // ── long-lived static config ──
  static: (name) => build("static", name),
};

/* ── Cache registry (Part 6, Phase 1 — §3) ───────────────────────────────
 * Every cached domain MUST declare:
 *   owner          which domain is accountable for this entry
 *   ttl            how long the entry lives
 *   invalidatedBy  the events that must clear it
 *   privacy        "public" (shareable, SWR allowed) | "private" (identity-
 *                  scoped, SWR forbidden, never cross-user)
 *
 * `TTL` below is DERIVED from this registry rather than maintained beside
 * it, so the two can never drift — but it stays a plain name→milliseconds
 * map, because the repositories pass TTL.X straight into getOrSet() as a
 * number.
 */
const CACHE_REGISTRY = {
  PUBLIC_EVENT: {
    owner: "event",
    ttl: 3 * 60 * 1000,
    invalidatedBy: ["event:update", "event:publish", "event:delete"],
    privacy: "public",
  },
  EVENT_COUNTS: {
    owner: "registration",
    ttl: 45 * 1000,
    invalidatedBy: ["registration:write", "eventInterest:write"],
    privacy: "public",
  },
  EXPLORE: {
    owner: "discovery",
    ttl: 60 * 1000,
    invalidatedBy: ["event:create", "event:update"],
    privacy: "public",
  },
  TRENDING: {
    owner: "feed",
    ttl: 2 * 60 * 1000,
    invalidatedBy: ["post:create"],
    privacy: "public",
  },
  ORG_PROFILE: {
    owner: "organization",
    ttl: 10 * 60 * 1000,
    invalidatedBy: ["org:update", "orgFollow:change"],
    privacy: "public",
  },
  COMMUNITY_META: {
    owner: "community",
    ttl: 10 * 60 * 1000,
    invalidatedBy: ["community:update", "community:delete"],
    privacy: "public",
  },
  COMMUNITY_MEMBERS: {
    owner: "community",
    ttl: 60 * 1000,
    invalidatedBy: ["communityMember:join", "communityMember:leave", "communityMember:role"],
    privacy: "private",
  },
  POST_COUNTS: {
    owner: "post",
    ttl: 60 * 1000,
    invalidatedBy: ["reaction:write", "comment:write"],
    privacy: "public",
  },
  QUIZ_LEADERBOARD: {
    owner: "quiz",
    ttl: 5 * 1000,
    invalidatedBy: ["liveAnswer:write"],
    privacy: "public",
  },
  FEED: {
    owner: "feed",
    ttl: 60 * 1000,
    invalidatedBy: ["post:create", "post:delete", "follow:change"],
    privacy: "private",
  },
  PROFILE: {
    owner: "user",
    ttl: 2 * 60 * 1000,
    invalidatedBy: ["user:update"],
    privacy: "private",
  },
  SEARCH: {
    owner: "search",
    ttl: 30 * 1000,
    invalidatedBy: ["event:create", "post:create", "community:create"],
    privacy: "public",
  },
  FOLLOW_LIST: {
    owner: "feed",
    ttl: 45 * 1000,
    invalidatedBy: ["follow:change"],
    privacy: "private",
  },
  STATIC_CONFIG: {
    owner: "platform",
    ttl: 24 * 60 * 60 * 1000,
    invalidatedBy: ["deploy"],
    privacy: "public",
  },
};

/** Plain name→ms view, derived so it can never disagree with the registry. */
const TTL = Object.freeze(
  Object.fromEntries(Object.entries(CACHE_REGISTRY).map(([name, entry]) => [name, entry.ttl]))
);

/** The namespace/version prefix every key we own starts with. */
const KEY_PREFIX = `${NAMESPACE}:${VERSION}:`;

/* ── The service ── */
const maxEntries = Math.max(50, Number(process.env.CACHE_MAX_ENTRIES) || 500);
const inflight = new Map(); // key -> Promise (request dedup, §15)
const disabled = process.env.CACHE_DISABLED === "1"; // escape hatch for debugging

/* ══ Provider selection (Part 6, Phase 1 — §1) ═════════════════════════════
 *
 *   CACHE_PROVIDER=memory   → in-process LRU (default, always works)
 *   CACHE_PROVIDER=upstash  → Upstash Redis, with memory as the fallback
 *
 * Two rules govern this block:
 *
 * 1. REDIS IS OPTIONAL. A missing URL, a missing token, a refused
 *    connection or a timed-out command must NEVER stop the app from
 *    booting or serving. Redis is an accelerator; correctness does not
 *    depend on it (§15).
 * 2. FALLBACK IS OBSERVABLE, NOT SILENT. Every degradation increments a
 *    counter that the admin dashboard surfaces, so "we've been running
 *    without Redis for three days" is visible rather than discovered later.
 */
const { createUpstashProvider } = require("../providers/redis/upstash.provider");

const memoryProvider = new MemoryCacheProvider({ maxEntries });

const CACHE_PROVIDER = String(process.env.CACHE_PROVIDER || "memory").toLowerCase();
const upstashProvider = CACHE_PROVIDER === "upstash" ? createUpstashProvider() : null;

/**
 * Wraps a primary provider with a fallback, behind a circuit breaker.
 *
 * WHY A BREAKER AND NOT JUST try/catch: every Redis command is a network
 * round-trip. If Redis is down and we caught-and-fell-back per operation,
 * every cache read would pay the full connect/timeout cost before degrading —
 * a latency cliff across the whole app. The breaker fails fast once Redis is
 * known-bad and probes periodically to notice when it recovers.
 */
class ResilientCacheProvider {
  constructor(primary, fallback) {
    this.primary = primary;
    this.fallback = fallback;
    // Circuit state — deliberately hand-rolled and dependency-free so it is
    // trivially inspectable from the admin dashboard.
    this.state = "closed"; // closed (healthy) → open (failing) → half-open (probing)
    this.failures = 0;
    this.failureThreshold = Math.max(1, Number(process.env.CACHE_FAILURE_THRESHOLD) || 3);
    this.cooldownMs = Math.max(1000, Number(process.env.CACHE_COOLDOWN_MS) || 30_000);
    this.openedAt = 0;
    this.stats = {
      primaryCalls: 0,
      primaryErrors: 0,
      fallbackUsed: 0, // surfaced to the dashboard as the "fallback count"
      circuitOpened: 0,
      lastError: null,
      lastErrorAt: 0,
    };
  }

  get name() {
    return this.state === "open" ? `${this.primary.name}+fallback` : this.primary.name;
  }

  /** True when the breaker has tripped and the cooldown has not elapsed. */
  get isOpen() {
    if (this.state === "open" && Date.now() - this.openedAt >= this.cooldownMs) {
      this.state = "half-open"; // time to probe
    }
    return this.state === "open";
  }

  recordSuccess() {
    if (this.state !== "closed") {
      this.state = "closed";
      this.failures = 0;
    }
  }

  recordFailure(err) {
    this.failures += 1;
    this.stats.primaryErrors += 1;
    // Store only the message — never the URL, headers or credentials.
    this.stats.lastError = String(err?.message || err).slice(0, 200);
    this.stats.lastErrorAt = Date.now();
    if (this.failures >= this.failureThreshold && this.state !== "open") {
      this.state = "open";
      this.openedAt = Date.now();
      this.stats.circuitOpened += 1;
      console.warn(`[cache] Redis circuit OPEN — falling back to memory: ${this.stats.lastError}`);
    } else if (this.state === "half-open") {
      this.state = "open";
      this.openedAt = Date.now();
    }
  }

  /**
   * Run `op` on the primary; on breaker-open or error, use the fallback.
   * The fallback is memory, which cannot realistically fail — so this always
   * resolves. Cache failures must never become user-facing errors.
   */
  async run(op, args) {
    const fb = this.fallback;
    if (this.isOpen) {
      this.stats.fallbackUsed += 1;
      return fb[op](...args);
    }
    this.stats.primaryCalls += 1;
    try {
      const out = await this.primary[op](...args);
      this.recordSuccess();
      return out;
    } catch (err) {
      this.recordFailure(err);
      this.stats.fallbackUsed += 1;
      return fb[op](...args);
    }
  }

  async get(key) {
    return this.run("get", [key]);
  }
  async getStale(key) {
    return this.run("getStale", [key]);
  }
  async set(key, value, ttlMs) {
    return this.run("set", [key, value, ttlMs]);
  }
  async del(key) {
    return this.run("del", [key]);
  }
  async delPrefix(prefix) {
    return this.run("delPrefix", [prefix]);
  }
  async size() {
    return this.run("size", []);
  }
  async flush() {
    return this.run("flush", []);
  }
  async ping() {
    if (typeof this.primary.ping === "function") return this.primary.ping();
    return true;
  }
}

const provider =
  upstashProvider && !disabled
    ? new ResilientCacheProvider(upstashProvider, memoryProvider)
    : Object.assign(memoryProvider, { name: "memory" });

/**
 * Resolve a caller-supplied prefix to a fully-qualified one.
 * Accepts EITHER a bare domain ("event", "event:") or an already-built
 * prefix, so callers never have to know the namespace or version.
 */
function resolvePrefix(prefix) {
  const p = String(prefix || "");
  if (!p) return KEY_PREFIX;
  if (p.startsWith(KEY_PREFIX)) return p;
  return `${KEY_PREFIX}cache:${p.endsWith(":") ? p : p + ":"}`;
}

function assertSwrAllowed(key) {
  if (isPrivateKey(key)) {
    throw new Error(`cache: stale-while-revalidate is forbidden for private key "${key}" (§14)`);
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

  const fresh = await provider.get(key);
  if (fresh) {
    metrics.recordCacheHit(key);
    return fresh.value;
  }

  // Stale-while-revalidate: hand out the last value instantly, refresh quietly (§14)
  if (swr) {
    const stale = await provider.getStale(key);
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
      await provider.set(key, value, ttl);
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
    .then(async (value) => {
      await provider.set(key, value, ttl);
      metrics.recordCacheSet();
    })
    .catch((err) => {
      console.warn(`[cache] SWR revalidation failed for ${key}: ${err?.message || err}`);
    });
}

/**
 * Read a FRESH value WITHOUT invoking a loader (§15).
 *
 * Why this exists: `getOrSet` always stores whatever the loader returns —
 * including `null`. For lookups where "missing" is a meaningful, temporary
 * state (an event that doesn't exist yet, a private event needing an
 * authorization check), caching that null would poison the key until TTL.
 * `peek` lets a caller try the cache first and only fall through to the
 * database when there is genuinely nothing usable there.
 *
 * @returns {*} the cached value, or `undefined` on miss / expiry / disabled
 */
/**
 * NOTE (Part 6, Phase 1): these facade methods are now `async`. Redis makes
 * every cache operation a network round-trip, so a synchronous cache facade
 * is no longer possible. Callers must `await`. The memory provider is still
 * synchronous internally — awaiting a non-Promise is a no-op — so behaviour
 * is unchanged when CACHE_PROVIDER=memory.
 */
async function peek(key) {
  if (disabled) return undefined;
  const entry = await provider.get(key);
  if (!entry) return undefined;
  metrics.recordCacheHit(key);
  return entry.value;
}

/** Invalidate one key (call on the domain's write path, §13). */
async function invalidate(key) {
  await provider.del(key);
  metrics.recordCacheInvalidation(String(key).split(":")[0] + ":");
}

/**
 * Invalidate a whole domain — e.g. "event", "event:", "community-members".
 * Accepts a bare domain or a fully-built prefix, so no caller ever has to
 * know the namespace or version.
 */
async function invalidatePrefix(prefix) {
  const removed = await provider.delPrefix(resolvePrefix(prefix));
  if (removed) metrics.recordCacheInvalidation(prefix);
  return removed;
}

async function stats() {
  const size = await provider.size();
  const base = {
    size,
    inflight: inflight.size,
    maxEntries,
    disabled,
    provider: provider.name || "memory",
    // null means "unknown" — the Redis provider cannot count keys cheaply on
    // a shared instance, and reporting 0 would be a lie.
    sizeIsExact: size !== null,
  };
  if (provider instanceof ResilientCacheProvider) {
    base.redis = { ...provider.stats, state: provider.state };
  }
  return base;
}

async function flush() {
  await provider.flush();
  inflight.clear();
}

module.exports = {
  cache: { getOrSet, peek, invalidate, invalidatePrefix, stats, flush },
  keys,
  TTL,
  CACHE_REGISTRY,
  PRIVATE_PREFIXES,
  PRIVATE_DOMAINS,
  isPrivateKey,
  resolvePrefix,
  KEY_PREFIX,
  KEY_NAMESPACE: NAMESPACE,
  KEY_VERSION: VERSION,
  MemoryCacheProvider,
  ResilientCacheProvider,
  get provider() {
    return provider;
  },
};
