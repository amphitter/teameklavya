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

/* ══ §13 Privacy classification ═══════════════════════════════════════════
 *
 * Part 6 drew the line at public | private. That is enough to decide whether
 * stale-while-revalidate is safe, but not enough to answer the question that
 * actually matters during an incident: WHOSE data is in this key, and what is
 * the blast radius if it leaks?
 *
 * A leaked TRENDING list is embarrassing. A leaked FEED is a privacy breach —
 * it contains what one specific person sees. A leaked admin export is both.
 * Collapsing all three into "private" loses exactly the distinction an
 * on-call engineer needs, so every cached value now carries one of five
 * classes, and the class is declared in one table.
 *
 *   PUBLIC               any caller may see it; SWR allowed
 *   PRIVATE_USER         scoped to one user id, which is IN the key
 *   PRIVATE_ORGANIZATION scoped to one org/community, for its members
 *   PRIVATE_EVENT        scoped to one event's non-public data
 *   PRIVATE_ADMIN        platform-operator data; must never reach a user
 *
 * The four private classes are all forbidden from SWR and must all carry
 * their scope in the key, so a value can never be served to the wrong
 * principal by accident of key construction.
 */
const CACHE_PRIVACY = Object.freeze({
  PUBLIC: "PUBLIC",
  PRIVATE_USER: "PRIVATE_USER",
  PRIVATE_ORGANIZATION: "PRIVATE_ORGANIZATION",
  PRIVATE_EVENT: "PRIVATE_EVENT",
  PRIVATE_ADMIN: "PRIVATE_ADMIN",
});

const PUBLIC_ = CACHE_PRIVACY.PUBLIC;
const PRIV_USER = CACHE_PRIVACY.PRIVATE_USER;
const PRIV_ORG = CACHE_PRIVACY.PRIVATE_ORGANIZATION;
const PRIV_EVENT = CACHE_PRIVACY.PRIVATE_EVENT;
const PRIV_ADMIN = CACHE_PRIVACY.PRIVATE_ADMIN;

/**
 * THE SINGLE SOURCE OF TRUTH for privacy.
 *
 * Every domain the `keys` builder can emit MUST appear here. Part 6 kept this
 * list separate from CACHE_REGISTRY's `privacy` flag, which meant the two
 * could drift — and a domain that drifted out of the private list would
 * silently become eligible for SWR. `PRIVATE_DOMAINS` is now DERIVED from
 * this table and the registry's `privacy` is checked against it, so drift
 * becomes an impossible state rather than a silent one.
 *
 * PRIVATE_EVENT and PRIVATE_ADMIN are currently UNUSED: no cache entry holds
 * event-private or operator-only data today. They are declared so that the
 * day one is added it has an obvious home — an unclassifiable new domain is a
 * decision, not an accident.
 */
const DOMAIN_PRIVACY = Object.freeze({
  // ── PUBLIC: shareable by any caller, SWR allowed ──
  event: PUBLIC_,
  "event-counts": PUBLIC_,
  explore: PUBLIC_,
  trending: PUBLIC_,
  organization: PUBLIC_,
  community: PUBLIC_,
  "post-counts": PUBLIC_,
  leaderboard: PUBLIC_,
  search: PUBLIC_,
  "event-slug": PUBLIC_,
  "org-slug": PUBLIC_,
  "community-slug": PUBLIC_,
  "stats:event": PUBLIC_,
  "counts:interest": PUBLIC_,
  "counts:org": PUBLIC_,
  "counts:community": PUBLIC_,
  static: PUBLIC_,

  // ── PRIVATE_USER: the user id is part of the key ──
  followlist: PRIV_USER,
  feed: PRIV_USER,
  profile: PRIV_USER,
  msg: PRIV_USER,
  notif: PRIV_USER,

  // ── PRIVATE_ORGANIZATION: member lists, scoped to one community ──
  "community-members": PRIV_ORG,

  /* ── Legacy, defensive ──
   * No builder emits the `user` domain any more — PROFILE replaced it. It is
   * kept because `isPrivateKey` guards keys that ALREADY EXIST in a live
   * Redis from older builds: a key written by the previous version is still
   * readable, and if this domain dropped out of the private list such a key
   * would silently become eligible for stale-while-revalidate. Privacy rules
   * have to cover the data that is out there, not just the data this build
   * writes. */
  user: PRIV_USER,

  // ── PRIVATE_EVENT / PRIVATE_ADMIN: no entries today ──
});

/** Every domain that is not PUBLIC. Derived — never hand-maintained. */
const PRIVATE_DOMAINS = Object.freeze(
  Object.entries(DOMAIN_PRIVACY)
    .filter(([, cls]) => cls !== PUBLIC_)
    .map(([d]) => d)
);

/**
 * Classify a domain, or a fully-built key.
 * Returns undefined for an unknown domain — callers MUST treat that as a bug,
 * not as "probably public".
 */
function classifyDomain(domain) {
  return DOMAIN_PRIVACY[String(domain)];
}

function classifyKey(key) {
  const k = String(key);
  // Longest match first: "counts:org" must not be shadowed by a shorter
  // domain that happens to be a substring of it.
  const domains = Object.keys(DOMAIN_PRIVACY).sort((a, b) => b.length - a.length);
  for (const d of domains) {
    if (k === d || k.startsWith(`${d}:`) || k.includes(`:${d}:`)) return DOMAIN_PRIVACY[d];
  }
  return undefined;
}

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
/**
 * The authoritative declaration of every cached value: who owns it, how long
 * it lives, what invalidates it, and which key domain it maps to.
 *
 * `privacy` is DERIVED from DOMAIN_PRIVACY via `domain` — it is never written
 * by hand here. Part 6 kept a hand-written `privacy` string next to a separate
 * PRIVATE_DOMAINS list; the two could disagree, and the loser was whichever
 * one the SWR guard happened to read. Now there is one table.
 *
 * Part 6 declared 14 entries while the `keys` builder could emit 23 domains.
 * The nine un-declared ones (slugs, counters, unread counters) had no stated
 * owner, TTL or invalidation — which means nobody had decided. They are
 * declared now with conservative TTLs.
 */
const CACHE_REGISTRY = {
  PUBLIC_EVENT: { domain: "event", owner: "event", ttl: 3 * 60 * 1000,
    invalidatedBy: ["event:update", "event:publish", "event:delete"] },
  EVENT_COUNTS: { domain: "event-counts", owner: "registration", ttl: 45 * 1000,
    invalidatedBy: ["registration:write", "eventInterest:write"] },
  EXPLORE: { domain: "explore", owner: "discovery", ttl: 60 * 1000,
    invalidatedBy: ["event:create", "event:update"] },
  TRENDING: { domain: "trending", owner: "feed", ttl: 2 * 60 * 1000,
    invalidatedBy: ["post:create"] },
  ORG_PROFILE: { domain: "organization", owner: "organization", ttl: 10 * 60 * 1000,
    invalidatedBy: ["org:update", "orgFollow:change"] },
  COMMUNITY_META: { domain: "community", owner: "community", ttl: 10 * 60 * 1000,
    invalidatedBy: ["community:update", "community:delete"] },
  COMMUNITY_MEMBERS: { domain: "community-members", owner: "community", ttl: 60 * 1000,
    invalidatedBy: ["communityMember:join", "communityMember:leave", "communityMember:role"] },
  POST_COUNTS: { domain: "post-counts", owner: "post", ttl: 60 * 1000,
    invalidatedBy: ["reaction:write", "comment:write"] },
  QUIZ_LEADERBOARD: { domain: "leaderboard", owner: "quiz", ttl: 5 * 1000,
    invalidatedBy: ["liveAnswer:write"] },
  FEED: { domain: "feed", owner: "feed", ttl: 60 * 1000,
    invalidatedBy: ["post:create", "post:delete", "follow:change"] },
  PROFILE: { domain: "profile", owner: "user", ttl: 2 * 60 * 1000,
    invalidatedBy: ["user:update"] },
  SEARCH: { domain: "search", owner: "search", ttl: 30 * 1000,
    invalidatedBy: ["event:create", "post:create", "community:create"] },
  FOLLOW_LIST: { domain: "followlist", owner: "feed", ttl: 45 * 1000,
    invalidatedBy: ["follow:change"] },
  STATIC_CONFIG: { domain: "static", owner: "platform", ttl: 24 * 60 * 60 * 1000,
    invalidatedBy: ["deploy"] },

  /* ── Declared in Part 7 §13: previously un-declared domains ── */
  EVENT_SLUG: { domain: "event-slug", owner: "event", ttl: 10 * 60 * 1000,
    invalidatedBy: ["event:update", "event:delete"] },
  ORG_SLUG: { domain: "org-slug", owner: "organization", ttl: 10 * 60 * 1000,
    invalidatedBy: ["org:update", "org:delete"] },
  COMMUNITY_SLUG: { domain: "community-slug", owner: "community", ttl: 10 * 60 * 1000,
    invalidatedBy: ["community:update", "community:delete"] },
  EVENT_STATS: { domain: "stats:event", owner: "event", ttl: 60 * 1000,
    invalidatedBy: ["event:update", "registration:write"] },
  INTEREST_COUNT: { domain: "counts:interest", owner: "registration", ttl: 45 * 1000,
    invalidatedBy: ["eventInterest:write"] },
  ORG_COUNTS: { domain: "counts:org", owner: "organization", ttl: 60 * 1000,
    invalidatedBy: ["orgFollow:change", "org:update"] },
  COMMUNITY_COUNTS: { domain: "counts:community", owner: "community", ttl: 60 * 1000,
    invalidatedBy: ["communityMember:join", "communityMember:leave"] },
  /** Unread counts are per-user and short-lived: a wrong unread badge is
   *  visible immediately, so the TTL is deliberately tight. */
  UNREAD_MESSAGES: { domain: "msg", owner: "messaging", ttl: 15 * 1000,
    invalidatedBy: ["message:read", "message:send"] },
  UNREAD_NOTIFICATIONS: { domain: "notif", owner: "notification", ttl: 15 * 1000,
    invalidatedBy: ["notification:read", "notification:create"] },
};

/* Derive `privacy` from the single source of truth. A registry entry naming a
 * domain that DOMAIN_PRIVACY does not know is a programming error, and it is
 * caught here at require-time rather than surfacing as a privacy bug. */
for (const [name, entry] of Object.entries(CACHE_REGISTRY)) {
  const cls = DOMAIN_PRIVACY[entry.domain];
  if (!cls) {
    throw new Error(
      `cache: registry entry "${name}" names unknown domain "${entry.domain}" — ` +
        `every cached domain must be classified in DOMAIN_PRIVACY (§13)`
    );
  }
  entry.privacy = cls;
}
Object.freeze(CACHE_REGISTRY);


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
  CACHE_PRIVACY,
  DOMAIN_PRIVACY,
  classifyKey,
  classifyDomain,
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
