/**
 * Infrastructure diagnostics (Part 5, Phase 7 — spec §59, §60, §61)
 * ─────────────────────────────────────────────────────────────────────────
 * One admin-only read that answers "how close is this deployment to its
 * limits?" without anyone having to open four provider dashboards.
 *
 * DESIGN NOTES
 *
 * • Provider health is INFERRED FROM RECENT TRAFFIC, not from a synthetic
 *   ping. A ping adds latency to an admin click, can fail for reasons that
 *   have nothing to do with the provider (sandbox egress, DNS blip), and
 *   tells you less than "our last 200 uploads succeeded". The metrics
 *   service already records per-provider ok/error counters, so health is
 *   derived from those plus a configuration check.
 *
 * • §61 — this module is the ONLY place provider quotas and budgets appear,
 *   and it is reachable exclusively through an admin-gated route. Nothing
 *   here is exposed to a normal user, and nothing here is embedded in an
 *   error response. A provider outage surfaces to users as a clean message,
 *   never as "Cloudinary quota exceeded".
 *
 * • Collection stats are cached briefly. `db.stats()` is a real database
 *   round trip and an admin holding down refresh should not be able to
 *   turn a diagnostic into a load generator.
 */
"use strict";

const mongoose = require("mongoose");
const metrics = require("./metrics.service");
const { cache } = require("./cache.service");
// Also needed as a module: `.provider` is a live getter, and the Redis panel
// has to read the circuit breaker off the provider itself.
const cacheService = require("./cache.service");
const realtime = require("./realtime.service");
const storage = require("./storage.provider");

/* Part 6, Phase 7 (§16): the Redis and Supabase panels.
 * Both are required lazily inside their collectors so that a misconfigured
 * (or absent) provider can never break the admin page — the whole point of
 * this file is to REPORT on degradation, so it must be the last thing in the
 * app that degrades. */
const supabaseIndex = require("../providers/supabase");
const outboxService = require("./outbox.service");

/* ── Budgets (the free-tier reference points) ─────────────────────────────
 * Overridable so a paid deployment can raise the ceiling without a code
 * change. These are the numbers the severity levels are calculated against. */
const MB = 1024 * 1024;
const BUDGETS = {
  /** MongoDB Atlas free tier. */
  mongoBytes: numOrDefault(process.env.INFRA_BUDGET_MONGO_MB, 512) * MB,
  /** Cache entries — Phase 1 default CACHE_MAX_ENTRIES. */
  cacheEntries: numOrDefault(process.env.INFRA_BUDGET_CACHE_ENTRIES, 500),
  /** Upstash free tier, monthly command allowance. */
  cacheCommands: numOrDefault(process.env.INFRA_BUDGET_CACHE_COMMANDS, 500_000),
  /** Soft ceiling for concurrent sockets on one instance. */
  sockets: numOrDefault(process.env.INFRA_BUDGET_SOCKETS, 2_000),
  /** Target for the p95 API latency. */
  apiP95Ms: numOrDefault(process.env.INFRA_TARGET_API_P95_MS, 800),
  /** Node's default-ish heap ceiling; V8 will GC long before this. */
  heapBytes: numOrDefault(process.env.INFRA_BUDGET_HEAP_MB, 512) * MB,
};

/** §59 thresholds: 80 / 90 / 95 → WARNING / HIGH / CRITICAL. */
const THRESHOLDS = { WARNING: 80, HIGH: 90, CRITICAL: 95 };
const LEVELS = ["OK", "WARNING", "HIGH", "CRITICAL"];
const LEVEL_RANK = { OK: 0, WARNING: 1, HIGH: 2, CRITICAL: 3 };

function numOrDefault(raw, fallback) {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Map a used/budget ratio onto the §59 severity scale.
 * @returns {{ level, percent }} percent is null when there is no budget/reading.
 */
function severity(used, budget) {
  if (!Number.isFinite(used) || !Number.isFinite(budget) || budget <= 0) {
    return { level: null, percent: null };
  }
  const percent = Math.min(100, Math.round((used / budget) * 100));
  let level = "OK";
  if (percent >= THRESHOLDS.CRITICAL) level = "CRITICAL";
  else if (percent >= THRESHOLDS.HIGH) level = "HIGH";
  else if (percent >= THRESHOLDS.WARNING) level = "WARNING";
  return { level, percent };
}

function worstLevel(levels) {
  return levels.reduce((worst, l) => (LEVEL_RANK[l] > LEVEL_RANK[worst] ? l : worst), "OK");
}

/* ── Cached collection stats ───────────────────────────────────────────── */

const STATS_TTL_MS = 30_000;
let statsCache = { at: 0, value: null };

async function dbStats() {
  const now = Date.now();
  if (statsCache.value && now - statsCache.at < STATS_TTL_MS) return statsCache.value;

  const value = { available: false };
  try {
    if (mongoose.connection && mongoose.connection.readyState === 1 && mongoose.connection.db) {
      const [stats, collections] = await Promise.all([
        mongoose.connection.db.stats(),
        mongoose.connection.db.listCollections().toArray(),
      ]);
      const counts = {};
      for (const { name } of collections) {
        if (name.startsWith("system.")) continue;
        try {
          counts[name] = await mongoose.connection.db.collection(name).countDocuments();
        } catch {
          counts[name] = null; // a transient read must not fail the dashboard
        }
      }
      value.available = true;
      value.dataSize = stats.dataSize || 0;
      value.storageSize = stats.storageSize || 0;
      value.indexSize = stats.indexSize || 0;
      value.objects = stats.objects || 0;
      value.collections = Object.keys(counts).length;
      value.indexes = stats.indexes || 0;
      value.counts = counts;
    }
  } catch (error) {
    value.error = "Database stats unavailable";
    value.detail = error.message;
  }

  statsCache = { at: now, value };
  return value;
}

/** Test seam + a way for an admin to force a fresh read. */
function invalidateStatsCache() {
  statsCache = { at: 0, value: null };
}

/* ── Section collectors ────────────────────────────────────────────────── */

function collectDatabase(db) {
  if (!db.available) {
    return { level: null, percent: null, available: false, message: db.error || "Database not connected" };
  }
  const { level, percent } = severity(db.dataSize, BUDGETS.mongoBytes);
  // Biggest collections first — that is where a growth problem shows up.
  const top = Object.entries(db.counts || {})
    .filter(([, v]) => typeof v === "number")
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, count]) => ({ name, count }));

  return {
    level,
    percent,
    available: true,
    dataSize: db.dataSize,
    storageSize: db.storageSize,
    indexSize: db.indexSize,
    objects: db.objects,
    collections: db.collections,
    indexes: db.indexes,
    budgetBytes: BUDGETS.mongoBytes,
    topCollections: top,
  };
}

async function collectCache(snap) {
  // Prefer the live cache service; the metrics snapshot is process-lifetime.
  let size = null;
  let maxEntries = BUDGETS.cacheEntries;
  let inflight = null;
  let disabled = false;
  try {
    const s = await cache.stats();
    size = s.size;
    maxEntries = s.maxEntries || maxEntries;
    inflight = s.inflight;
    disabled = Boolean(s.disabled);
  } catch {
    /* cache service unavailable — fall back to metrics-only numbers */
  }

  const { level, percent } = severity(size, maxEntries);
  const commands = (snap.cache.hits || 0) + (snap.cache.misses || 0) + (snap.cache.sets || 0);
  const commandSeverity = severity(commands, BUDGETS.cacheCommands);

  return {
    level: disabled ? null : level,
    percent: disabled ? null : percent,
    disabled,
    size,
    maxEntries,
    inflight,
    hits: snap.cache.hits,
    misses: snap.cache.misses,
    sets: snap.cache.sets,
    hitRate: snap.cache.hitRate,
    evictions: snap.cache.evictions,
    staleServed: snap.cache.staleServed,
    dedupServed: snap.cache.dedupServed,
    commands,
    commandsPercent: commandSeverity.percent,
  };
}

function collectApi(snap) {
  const { level, percent } = severity(snap.api.p95, BUDGETS.apiP95Ms);
  const total = (snap.statuses.ok || 0) + (snap.statuses.clientError || 0) + (snap.statuses.serverError || 0);
  const errorRate = total ? +(((snap.statuses.clientError + snap.statuses.serverError) / total) * 100).toFixed(2) : 0;
  return {
    level,
    percent,
    targetP95Ms: BUDGETS.apiP95Ms,
    samples: snap.api.samples,
    p50: snap.api.p50,
    p95: snap.api.p95,
    p99: snap.api.p99,
    statuses: snap.statuses,
    errorRate,
  };
}

function collectSockets(snap) {
  let registry = null;
  let rooms = [];
  try {
    registry = realtime.connectionRegistry.stats();
    rooms = realtime.roomStats();
  } catch {
    /* realtime not initialised (e.g. in a bare unit test) */
  }
  const connected = registry ? registry.sockets : snap.sockets.connected;
  const { level, percent } = severity(connected, BUDGETS.sockets);
  return {
    level,
    percent,
    connected,
    peak: snap.sockets.peak,
    errors: snap.sockets.errors,
    users: registry ? registry.users : null,
    ips: registry ? registry.ips : null,
    capPerUser: registry ? registry.capPerUser : null,
    capPerIp: registry ? registry.capPerIp : null,
    rooms: rooms.length,
    roomOccupancy: rooms
      .slice()
      .sort((a, b) => b.participants - a.participants)
      .slice(0, 10)
      .map((r) => ({ eventId: r.eventId, participants: r.participants, cap: r.cap })),
  };
}

/**
 * Provider health from CONFIGURATION + RECENT TRAFFIC, never a synthetic ping.
 * See the design note at the top of this file.
 */
function collectProviders(snap) {
  const providerCounters = snap.providers || {};

  function health(name, configured) {
    const ok = providerCounters[`${name}:ok`] || 0;
    const errored = providerCounters[`${name}:error`] || 0;
    const attempts = ok + errored;
    // No traffic yet is not the same as unhealthy — report it as unknown.
    const failureRate = attempts ? +((errored / attempts) * 100).toFixed(2) : null;
    let level = null;
    if (!configured) level = "OK"; // simply not in use
    else if (failureRate !== null) level = worstLevel([severity(failureRate, 100).level]);
    return { configured, attempts, ok, errors: errored, failureRate, level };
  }

  /* Storage: which provider is actually live.
   * NB — `storage.provider` is the ALREADY-RESOLVED active provider, so
   * calling isConfigured() on it is meaningless: the local disk fallback
   * reports itself configured because it always works. `provider.name` is
   * the real answer: "cloudinary" or "local". */
  let storageProvider = "local";
  try {
    storageProvider = storage.provider?.name === "cloudinary" ? "cloudinary" : "local";
  } catch {
    /* provider probe failed — report the fallback */
  }
  const storageConfigured = storageProvider === "cloudinary";

  const smtpConfigured = Boolean(process.env.SMTP_HOST && process.env.SMTP_USER);

  return {
    storage: { provider: storageProvider, configured: storageConfigured },
    email: health("email", smtpConfigured),
    cloudinary: health("cloudinary", storageConfigured),
    smtpConfigured,
  };
}

function collectUploads(snap) {
  const { level } = severity(snap.uploads.failureRate, 100);
  return { level, ...snap.uploads };
}

function collectProcess() {
  const mem = process.memoryUsage();
  const { level, percent } = severity(mem.heapUsed, BUDGETS.heapBytes);
  return {
    level,
    percent,
    heapUsed: mem.heapUsed,
    heapTotal: mem.heapTotal,
    rss: mem.rss,
    external: mem.external,
    budgetBytes: BUDGETS.heapBytes,
    uptimeSec: Math.round(process.uptime()),
    nodeVersion: process.version,
    pid: process.pid,
  };
}

/**
 * Redis panel (Part 6, Phase 7 — §16)
 * ─────────────────────────────────────────────────────────────────────────
 * Redis is SHARED INFRASTRUCTURE now: the cache, the rate limiter, the
 * idempotency store and the lock service all sit on it. Reporting only the
 * cache (as the Part 5 `cache` panel does) would hide an outage that the
 * other three are already feeling, so this aggregates all four consumers.
 *
 * ── Why no ping ──
 * Consistent with the note at the top of this file: health is inferred from
 * configuration plus RECENT TRAFFIC. A synthetic PING adds latency to an
 * admin click, can fail for reasons unrelated to Redis (sandbox egress, DNS),
 * and — worst — reports OK while every real call is falling back. "Our last
 * N calls fell back to memory" is the number an admin actually needs.
 *
 * ── Availability, precisely ──
 * `available` is false when the circuit is OPEN or the last call errored.
 * `configured` false means Redis simply is not in use, which is not a problem
 * and must not be reported as one.
 */
function collectRedis() {
  const consumers = {};

  /* Each consumer is read defensively: a dashboard that throws because one
   * subsystem is missing would be useless exactly when you need it. */
  const read = (name, fn) => {
    try {
      const v = fn();
      if (v) consumers[name] = v;
    } catch {
      /* subsystem absent or not initialised */
    }
  };

  // Cache — the ResilientCacheProvider carries the circuit breaker.
  try {
    const p = cacheService.provider;
    if (p && typeof p.stats === "object" && p.state !== undefined) {
      consumers.cache = { ...p.stats, state: p.state };
    } else if (p) {
      consumers.cache = { backend: p.name || "memory" };
    }
  } catch { /* not initialised */ }

  // Rate limiting (Phase 2)
  read("rateLimit", () => {
    const m = require("../config/rate-limits");
    const b = m.rateLimitBackend && m.rateLimitBackend();
    return b && typeof b.stats === "function" ? b.stats() : null;
  });

  // Idempotency (Phase 3)
  read("idempotency", () => {
    const m = require("../providers/redis/idempotency.store");
    return m.idempotencyStore ? m.idempotencyStore().stats() : null;
  });

  // Locks (Phase 4)
  read("lock", () => {
    const m = require("../providers/redis/lock.service");
    const svc = m.lockService && m.lockService();
    return svc && svc.backend && typeof svc.backend.stats === "function"
      ? svc.backend.stats()
      : null;
  });

  const configured = String(process.env.CACHE_PROVIDER || "memory").toLowerCase() === "upstash";

  // Aggregate. Every consumer reports errors/fallbacks under the same names,
  // which is deliberate: it makes summing them a one-liner rather than a
  // per-subsystem special case that someone has to remember to update.
  let commands = 0;
  let errors = 0;
  let fallbacks = 0;
  let circuitOpened = 0;
  for (const c of Object.values(consumers)) {
    commands += Number(c.primaryCalls || c.calls || c.claims || c.acquires || 0);
    errors += Number(c.primaryErrors || c.errors || 0);
    fallbacks += Number(c.fallbackUsed || c.fallbacks || 0);
    circuitOpened += Number(c.circuitOpened || 0);
  }

  /* ── Backend reality vs intent ──
   * `configured` is what the ENV says we intend to use. `backends` is what the
   * consumers are ACTUALLY on. They can disagree: CACHE_PROVIDER=upstash with
   * no UPSTASH_REDIS_REST_URL makes every consumer silently boot into memory.
   *
   * That mismatch is worth surfacing loudly. The system keeps working, so
   * nothing errors — but every cache, rate limit, idempotency claim and lock
   * is now per-instance, which quietly breaks every cross-instance guarantee
   * Part 6 exists to provide. It is the sort of thing that only shows up as
   * "why did two instances both issue the same ticket". */
  const backends = [...new Set(
    Object.values(consumers).map((c) => c.backend).filter(Boolean)
  )];
  const misconfigured =
    configured && backends.length > 0 && backends.every((b) => b === "memory");

  const state = consumers.cache?.state || (configured ? "closed" : "n/a");
  const circuitOpen = state === "open";
  const available = configured ? !circuitOpen : null;

  /* Level. An unconfigured Redis is not a problem, so it reports no level at
   * all rather than a green "OK" that looks like a health check passed. */
  let level = null;
  if (configured) {
    const errorRate = commands ? (errors / commands) * 100 : 0;
    const fbRate = commands ? (fallbacks / commands) * 100 : 0;
    if (circuitOpen) level = "CRITICAL";
    else level = worstLevel([
      severity(errorRate, 100).level,
      severity(fbRate, 100).level,
      severity(commands, BUDGETS.cacheCommands).level,
    ]);
    // A silent fall to memory is at least a WARNING even with zero errors —
    // there are no errors precisely because nothing is talking to Redis.
    if (misconfigured) level = worstLevel([level, "WARNING"]);
  }

  const lastError = Object.values(consumers)
    .map((c) => c.lastError)
    .find(Boolean) || null;

  return {
    level,
    configured,
    available,
    degraded: configured ? Boolean(circuitOpen || fallbacks > 0) : false,
    state,
    circuitOpen,
    circuitOpened,
    // Intent vs reality, both reported so an admin can see a mismatch.
    backends,
    misconfigured,
    commands,
    commandsPercent: severity(commands, BUDGETS.cacheCommands).percent,
    commandBudget: BUDGETS.cacheCommands,
    errors,
    fallbacks,
    // Hit ratio comes from the cache specifically — the other three consumers
    // are not caches and have no meaningful hit rate.
    hitRate: cacheHitRate(),
    consumers,
    // Scrubbed: an upstream error can echo a URL or a token (§14, §61).
    lastError: lastError ? String(lastError).slice(0, 160) : null,
  };
}

/** Cache hit ratio, sourced from the metrics snapshot (process-lifetime). */
function cacheHitRate() {
  try {
    const snap = metrics.snapshot();
    return snap?.cache?.hitRate ?? null;
  } catch {
    return null;
  }
}

/**
 * Supabase panel (Part 6, Phase 7 — §16)
 * ─────────────────────────────────────────────────────────────────────────
 * Reports latency, query count, errors and slow queries — everything the
 * brief asks for — plus the outbox backlog, because Supabase health and
 * outbox health are the same question viewed from two ends. A growing backlog
 * with a healthy Supabase means the consumer is the problem; a healthy
 * backlog with an erroring Supabase means the store is. Showing only one
 * would send an admin looking in the wrong place.
 *
 * `connectionHealth` is INFERRED, not pinged (see the note at the top of this
 * file): configured + no recent errors + backlog not growing = healthy.
 */
async function collectSupabase() {
  const configured = supabaseIndex.isConfigured();

  let s = null;
  try {
    s = supabaseIndex.supabaseStats();
  } catch { /* not initialised */ }

  let outbox = null;
  try {
    outbox = await outboxService.stats();
  } catch { /* outbox not available (no Mongo) */ }

  if (!configured) {
    return {
      level: null,           // not in use — not a problem, not a green tick
      configured: false,
      connectionHealth: "not-configured",
      queries: 0, errors: 0, timeouts: 0, slowQueries: 0,
      avgMs: 0, rows: 0,
      nPlusOneWarnings: s?.nPlusOneWarnings ?? 0,
      outbox,
      lastError: null,
    };
  }

  const queries = Number(s?.queries || 0);
  const errors = Number(s?.errors || 0);
  const errorRate = queries ? (errors / queries) * 100 : 0;

  let level;
  if (errors > 0 && queries === 0) level = "CRITICAL";
  else level = worstLevel([
    severity(errorRate, 100).level,
    // Slow queries against total queries: 100 slow out of 1M is fine, 100
    // out of 120 is not.
    severity(Number(s?.slowQueries || 0), Math.max(queries, 1) * 0.1 || 1).level,
  ]);

  const backlog = Number(outbox?.pending || 0);
  const dead = Number(outbox?.dead || 0);
  if (dead > 0) level = worstLevel([level, "CRITICAL"]);   // silent data loss
  else if (backlog > 10_000) level = worstLevel([level, "WARNING"]);

  let connectionHealth = "healthy";
  if (errors > 0) connectionHealth = "degraded";
  if (Number(s?.timeouts || 0) > 0) connectionHealth = "degraded";
  if (dead > 0) connectionHealth = "degraded";

  return {
    level,
    configured: true,
    connectionHealth,
    queries,
    errors,
    timeouts: Number(s?.timeouts || 0),
    slowQueries: Number(s?.slowQueries || 0),
    avgMs: Number(s?.avgMs || 0),
    rows: Number(s?.rows || 0),
    maxRows: s?.maxRows ?? null,
    nPlusOneWarnings: Number(s?.nPlusOneWarnings || 0),
    outbox,
    lastError: s?.lastError ? String(s.lastError).slice(0, 160) : null,
  };
}

/**
 * Outbox panel (Part 7, Phase 2 — §5)
 * ─────────────────────────────────────────────────────────────────────────
 * A dead-lettered entry is SILENT DATA LOSS: the change happened in MongoDB
 * and will never reach Supabase. It is therefore not merely counted — its
 * AGE drives severity, because a dead letter that just appeared may still be
 * recovered by a retry sweep, while one that has sat for an hour means the
 * two databases have been diverging for an hour.
 *
 *   dead = 0                    → no level
 *   dead > 0, age < 15 min      → HIGH
 *   dead > 0, age >= 15 min     → CRITICAL
 *
 * The backlog is reported alongside the processing RATE, because a large
 * backlog that is draining is fine and a small one that is stuck is an
 * incident. A raw count cannot express that difference.
 */
async function collectOutbox() {
  let stats = null;
  let dead = null;
  let rate = null;
  try {
    [stats, dead, rate] = await Promise.all([
      outboxService.stats(),
      outboxService.deadLetters({ limit: 50 }),
      outboxService.processingRate(),
    ]);
  } catch {
    // No Mongo / outbox unavailable — report it rather than hiding the panel.
    return { level: null, unavailable: true, backlog: null };
  }

  const deadCount = Number(dead?.count || 0);
  const oldestDeadMs = Number(dead?.oldestMs || 0);
  const STALE_DEAD_MS = 15 * 60 * 1000;

  let level = null;
  if (deadCount > 0) level = oldestDeadMs >= STALE_DEAD_MS ? "CRITICAL" : "HIGH";
  else if (Number(stats?.pending || 0) > 10_000) level = "WARNING";

  return {
    level,
    unavailable: false,
    backlog: Number(stats?.pending || 0),
    processing: Number(stats?.processing || 0),
    done: Number(stats?.done || 0),
    retrying: Number(stats?.failed || 0),
    deadLettered: deadCount,
    oldestPendingMs: Number(stats?.oldestPendingMs || 0),
    oldestDeadLetterMs: oldestDeadMs,
    ratePerMinute: rate?.donePerMinute ?? null,
    // Bounded sample for the UI. Contains no credentials and no payloads —
    // only the entity reference and a stable error code (§5, §14).
    recentDead: (dead?.items || []).slice(0, 20).map((i) => ({
      entityType: i.entityType,
      entityId: i.entityId,
      operation: i.operation,
      attempts: i.attempts,
      lastErrorCode: i.lastErrorCode,
      ageMs: i.ageMs,
    })),
  };
}

function collectRateLimits(snap) {
  const buckets = Object.entries(snap.rateLimits || {})
    .map(([bucket, count]) => ({ bucket, count }))
    .sort((a, b) => b.count - a.count);
  return { buckets, total: buckets.reduce((n, b) => n + b.count, 0) };
}

/* ── The read ──────────────────────────────────────────────────────────── */

/**
 * Full diagnostics snapshot. Admin-only by contract — the route that calls
 * this is gated; this function does not re-check authorization.
 */
async function collect({ fresh = false } = {}) {
  if (fresh) invalidateStatsCache();

  const snap = metrics.snapshot();
  const db = await dbStats();

  const sections = {
    database: collectDatabase(db),
    cache: await collectCache(snap),
    api: collectApi(snap),
    rateLimits: collectRateLimits(snap),
    sockets: collectSockets(snap),
    providers: collectProviders(snap),
    uploads: collectUploads(snap),
    process: collectProcess(),
    // Part 6, Phase 7 (§16): the two new panels.
    redis: collectRedis(),
    supabase: await collectSupabase(),
    // Part 7, Phase 2 (§5): outbox backlog, rate and dead letters.
    outbox: await collectOutbox(),
  };

  const levels = Object.values(sections)
    .map((s) => s && s.level)
    .filter(Boolean);
  const status = worstLevel(levels.length ? levels : ["OK"]);

  /* Anything at WARNING or above becomes an alert, so the page can lead with
   * "here is what needs attention" instead of making the admin scan. */
  const alerts = [];
  for (const [name, section] of Object.entries(sections)) {
    if (section && section.level && section.level !== "OK") {
      alerts.push({
        section: name,
        level: section.level,
        percent: section.percent,
        message: alertMessage(name, section),
      });
    }
  }
  alerts.sort((a, b) => LEVEL_RANK[b.level] - LEVEL_RANK[a.level]);

  return {
    generatedAt: new Date().toISOString(),
    status,
    thresholds: THRESHOLDS,
    budgets: {
      mongoBytes: BUDGETS.mongoBytes,
      cacheEntries: BUDGETS.cacheEntries,
      cacheCommands: BUDGETS.cacheCommands,
      sockets: BUDGETS.sockets,
      apiP95Ms: BUDGETS.apiP95Ms,
      heapBytes: BUDGETS.heapBytes,
    },
    alerts,
    sections,
  };
}

function alertMessage(name, section) {
  switch (name) {
    case "database":
      return `Database storage at ${section.percent}% of budget`;
    case "cache":
      return `Cache occupancy at ${section.percent}% of ${section.maxEntries} entries`;
    case "api":
      return `API p95 latency ${section.p95}ms against a ${section.targetP95Ms}ms target`;
    case "sockets":
      return `${section.connected} concurrent sockets (${section.percent}% of ceiling)`;
    case "uploads":
      return `Upload failure rate ${section.failureRate}%`;
    case "redis":
      if (section.circuitOpen) return "Redis circuit is OPEN — all reads are falling back to memory";
      return `Redis degraded: ${section.errors} errors, ${section.fallbacks} fallbacks across ${section.commands} commands`;
    case "supabase":
      if (section.outbox?.dead) return `${section.outbox.dead} outbox entries are dead-lettered — data is not reaching Supabase`;
      if (section.connectionHealth !== "healthy") return `Supabase degraded: ${section.errors} errors across ${section.queries} queries`;
      return `Supabase slow queries: ${section.slowQueries}`;
    case "process":
      return `Heap usage at ${section.percent}% of budget`;
    case "outbox":
      if (section.deadLettered > 0) {
        return `${section.deadLettered} outbox entries are dead-lettered (oldest ${Math.round(section.oldestDeadLetterMs / 60000)}m) — changes are not reaching Supabase`;
      }
      return `Outbox backlog is ${section.backlog} entries`;
    default:
      return `${name} needs attention (${section.percent}%)`;
  }
}

module.exports = {
  collect,
  severity,
  worstLevel,
  invalidateStatsCache,
  THRESHOLDS,
  BUDGETS,
};
