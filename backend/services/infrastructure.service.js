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
const realtime = require("./realtime.service");
const storage = require("./storage.provider");

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

function collectCache(snap) {
  // Prefer the live cache service; the metrics snapshot is process-lifetime.
  let size = null;
  let maxEntries = BUDGETS.cacheEntries;
  let inflight = null;
  let disabled = false;
  try {
    const s = cache.stats();
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
    cache: collectCache(snap),
    api: collectApi(snap),
    rateLimits: collectRateLimits(snap),
    sockets: collectSockets(snap),
    providers: collectProviders(snap),
    uploads: collectUploads(snap),
    process: collectProcess(),
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
    case "process":
      return `Heap usage at ${section.percent}% of budget`;
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
