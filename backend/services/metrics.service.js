/**
 * EventHub Metrics Service (Part 5, Phase 1 — spec §57–58)
 * ────────────────────────────────────────────────────────────
 * Tiny in-process metrics: ring buffers for latency, counters for
 * everything else. NO external dependency — a future provider can
 * ship the same counters to Prometheus/Datadog without touching
 * call sites (they only call `metrics.*`).
 *
 * Cost profile: increments + occasional array push per request.
 * Rings are capped; percentiles computed on demand (admin snapshot).
 */

const RING_MAX = 1000; // keep the last 1000 latency samples

const latencyRing = []; // { ms }
const counters = new Map(); // "bucket" -> count
let socketsConnected = 0;
let socketsPeak = 0;

function inc(name, by = 1) {
  counters.set(name, (counters.get(name) || 0) + by);
}

/* ── API layer ── */

/** Record one request latency (ms). */
function recordLatency(ms) {
  latencyRing.push({ ms });
  if (latencyRing.length > RING_MAX) latencyRing.shift();
}

/** Record one response status class (e.g. "status:2xx"). */
function recordStatus(code) {
  if (code >= 500) inc("status:5xx");
  else if (code >= 400) inc("status:4xx");
  else if (code >= 200) inc("status:2xx");
}

/* ── Cache layer (§58) ── */
const recordCacheHit = (key) => inc("cache:hit:" + scopeOf(key));
const recordCacheMiss = (key) => inc("cache:miss:" + scopeOf(key));
const recordCacheEviction = () => inc("cache:eviction");
const recordCacheStale = () => inc("cache:staleServed");
const recordCacheDedup = () => inc("cache:dedupServed");
const recordCacheInvalidation = (prefix) => inc("cache:invalidate:" + prefix);
const recordCacheSet = () => inc("cache:set");

function scopeOf(key) {
  const i = String(key).indexOf(":");
  return i === -1 ? String(key) : String(key).slice(0, i);
}

/* ── Rate limiting ── */
const recordRateLimit = (bucket) => inc("rateLimit:" + bucket);

/* ── Realtime ── */
function recordSocketConnect() {
  socketsConnected += 1;
  if (socketsConnected > socketsPeak) socketsPeak = socketsConnected;
}
function recordSocketDisconnect() {
  socketsConnected = Math.max(0, socketsConnected - 1);
}
const recordSocketError = () => inc("socket:errors");

/* ── Providers (§31, §68) ── */
function recordProvider(name, ok) {
  inc("provider:" + name + (ok ? ":ok" : ":error"));
}
const recordUploadFailure = () => inc("upload:failures");
// Part 5 Phase 4 (§57): paired with failures so the Phase 7 dashboard can
// show an upload FAILURE RATE, not just a raw failure count.
const recordUploadSuccess = () => inc("upload:successes");

/* ── Percentiles ── */
function percentile(sorted, p) {
  if (!sorted.length) return null;
  // Nearest-rank method: p50 of 1..100 = 50, p95 = 95, p99 = 99
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[idx];
}

/**
 * Point-in-time snapshot for the admin infrastructure dashboard
 * (Phase 7) and /api/health. All numbers are process-lifetime.
 */
function snapshot() {
  const sorted = latencyRing.map((s) => s.ms).sort((a, b) => a - b);
  const cacheHits = sumByPrefix("cache:hit:");
  const cacheMisses = sumByPrefix("cache:miss:");
  const cacheSets = counters.get("cache:set") || 0;

  const out = {
    api: {
      samples: sorted.length,
      p50: percentile(sorted, 50),
      p95: percentile(sorted, 95),
      p99: percentile(sorted, 99),
    },
    cache: {
      hits: cacheHits,
      misses: cacheMisses,
      sets: cacheSets,
      hitRate: cacheHits + cacheMisses > 0 ? Math.round((cacheHits / (cacheHits + cacheMisses)) * 100) : null,
      evictions: counters.get("cache:eviction") || 0,
      staleServed: counters.get("cache:staleServed") || 0,
      dedupServed: counters.get("cache:dedupServed") || 0,
    },
    rateLimits: Object.fromEntries(entriesByPrefix("rateLimit:")),
    statuses: {
      ok: counters.get("status:2xx") || 0,
      clientError: counters.get("status:4xx") || 0,
      serverError: counters.get("status:5xx") || 0,
    },
    sockets: { connected: socketsConnected, peak: socketsPeak, errors: counters.get("socket:errors") || 0 },
    providers: Object.fromEntries(entriesByPrefix("provider:")),
    uploads: {
      failures: counters.get("upload:failures") || 0,
      successes: counters.get("upload:successes") || 0,
      // failures per 100 attempts — the number that actually matters
      failureRate: (() => {
        const f = counters.get("upload:failures") || 0;
        const s2 = counters.get("upload:successes") || 0;
        const total = f + s2;
        return total ? +((f / total) * 100).toFixed(2) : 0;
      })(),
    },
    counters: Object.fromEntries(counters), // raw view for debugging
  };
  return out;
}

function sumByPrefix(prefix) {
  let total = 0;
  for (const [k, v] of counters) if (k.startsWith(prefix)) total += v;
  return total;
}
function entriesByPrefix(prefix) {
  const out = [];
  for (const [k, v] of counters) if (k.startsWith(prefix)) out.push([k.slice(prefix.length), v]);
  return out;
}

/** Test/reset hook. */
function reset() {
  latencyRing.length = 0;
  counters.clear();
  socketsConnected = 0;
  socketsPeak = 0;
}

module.exports = {
  recordLatency,
  recordStatus,
  recordCacheHit,
  recordCacheMiss,
  recordCacheEviction,
  recordCacheStale,
  recordCacheDedup,
  recordCacheInvalidation,
  recordCacheSet,
  recordRateLimit,
  recordSocketConnect,
  recordSocketDisconnect,
  recordSocketError,
  recordProvider,
  recordUploadFailure,
  recordUploadSuccess,
  snapshot,
  reset,
};
