/**
 * Upstash Redis cache provider (Part 6, Phase 1 — §1, §3)
 * ─────────────────────────────────────────────────────────────────────────────
 * Implements the SAME CacheProvider interface as MemoryCacheProvider:
 *   get · getStale · set · del · delPrefix · size · flush
 *
 * Design constraints that shaped this file:
 *
 * 1. NO VENDOR SDK. Upstash exposes an HTTP/REST API, so this is plain
 *    `fetch` — zero new dependencies, no native addons, and it works on any
 *    Node runtime. Commands are sent as a JSON array in the POST body rather
 *    than URL-encoded in the path, which sidesteps the escaping problem
 *    entirely (cache keys contain colons, slashes and braces).
 *
 * 2. THIS IS A CACHE, NOT A DATABASE. Nothing durable lives here (§2). If
 *    Redis is wiped the app must still be correct — slower, but correct.
 *
 * 3. SWR IS EMULATED WITH A SHADOW KEY. Redis cannot return a value that has
 *    already expired, but stale-while-revalidate needs exactly that. So every
 *    `set` writes two keys: the live key with the real TTL, and a
 *    `{key}::stale` shadow with a longer TTL. The shadow is what `getStale`
 *    reads after the live key has gone. Both are written in one pipeline so
 *    the pair can never tear.
 *
 * 4. THE PROVIDER THROWS. It does NOT swallow errors. Fallback is the job of
 *    the ResilientCacheProvider wrapper in services/cache.service.js, which
 *    owns the circuit breaker and the decision to degrade. Keeping "talk to
 *    Redis" and "decide what to do when Redis is broken" in different places
 *    is what makes the fallback testable.
 *
 * 5. CREDENTIALS NEVER LEAVE THIS FILE. The URL and token are read from
 *    process.env here and are never logged, serialised into an error, or
 *    included in any response. A test asserts no Redis env var is referenced
 *    anywhere under frontend/.
 *
 * Env:
 *   UPSTASH_REDIS_REST_URL    e.g. https://apn1-xxxx.upstash.io
 *   UPSTASH_REDIS_REST_TOKEN
 */

"use strict";

const STALE_GRACE_MS = 5 * 60 * 1000; // how long a stale copy outlives its TTL
const SCAN_COUNT = 500; // SCAN batch size for prefix scans
const SCAN_MAX_ITERATIONS = 200; // hard stop so a huge keyspace can't hang us
const DEFAULT_TIMEOUT_MS = 2000;

const staleKeyOf = (key) => `${key}::stale`;

/**
 * A single Upstash REST command.
 * @param {string[]} args  e.g. ["SET", "k", "v", "PX", 60000]
 * @returns {Promise<{ok: boolean, result?: *, error?: string}>}
 */
async function command(args, cfg, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(cfg.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(args),
      signal: controller.signal,
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || (body && body.error)) {
      // NEVER include the URL or token in the message — only the status and
      // Upstash's own error string, which never contains credentials.
      return { ok: false, error: body?.error || `HTTP ${res.status}` };
    }
    return { ok: true, result: body?.result };
  } catch (err) {
    const msg = err?.name === "AbortError" ? `timeout after ${timeoutMs}ms` : err?.message || String(err);
    return { ok: false, error: msg };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Several commands in ONE round-trip. Upstash bills by command but the
 * dominant cost over the public internet is latency, so batching matters.
 */
async function pipeline(commands, cfg, timeoutMs) {
  if (!commands.length) return { ok: true, result: [] };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${cfg.url}/pipeline`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(commands),
      signal: controller.signal,
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || (body && body.error)) {
      return { ok: false, error: body?.error || `HTTP ${res.status}` };
    }
    // A pipeline returns one entry per command; each may individually fail.
    return { ok: true, result: Array.isArray(body) ? body : [] };
  } catch (err) {
    const msg = err?.name === "AbortError" ? `timeout after ${timeoutMs}ms` : err?.message || String(err);
    return { ok: false, error: msg };
  } finally {
    clearTimeout(timer);
  }
}

const decode = (raw) => {
  if (raw === null || raw === undefined) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !("v" in parsed)) return null;
    return { value: parsed.v, expiresAt: parsed.e };
  } catch {
    return null; // corrupt or foreign value — treat as a miss, never throw
  }
};

const encode = (value, ttlMs) => JSON.stringify({ v: value, e: Date.now() + ttlMs });

/**
 * Scan + delete every key under a prefix.
 * Uses SCAN (incremental, server-safe) rather than KEYS (which blocks Redis
 * for the whole keyspace). Bounded by SCAN_MAX_ITERATIONS so a pathological
 * keyspace degrades instead of hanging the request.
 */
async function scanAndDelete(prefix, cfg, timeoutMs) {
  let cursor = "0";
  let removed = 0; // LOGICAL entries — shadow keys are not counted, so this
                   // number means the same thing for every provider.
  for (let i = 0; i < SCAN_MAX_ITERATIONS; i++) {
    const scan = await command(["SCAN", cursor, "MATCH", `${prefix}*`, "COUNT", SCAN_COUNT], cfg, timeoutMs);
    if (!scan.ok) return { ok: false, error: scan.error, removed };
    const [next, batch] = scan.result || [];
    if (Array.isArray(batch) && batch.length) {
      // DEL in chunks — one huge DEL would blow the request size limit.
      for (let j = 0; j < batch.length; j += 200) {
        const chunk = batch.slice(j, j + 200);
        const del = await command(["DEL", ...chunk], cfg, timeoutMs);
        if (!del.ok) return { ok: false, error: del.error, removed };
        // Count only the live keys: every logical entry also has a
        // `::stale` shadow, which is an implementation detail of this
        // provider and must not inflate the reported count.
        removed += chunk.filter((k) => !String(k).endsWith("::stale")).length;
      }
    }
    cursor = String(next ?? "0");
    if (cursor === "0") break;
  }
  return { ok: true, removed };
}

/**
 * Create the provider. Returns null when not configured, so the caller can
 * fall back to memory without inspecting credentials itself.
 */
function createUpstashProvider({ url, token, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  // Only fall back to env when the caller passed NOTHING. An explicitly
  // empty string means "not configured" — otherwise a caller trying to
  // construct an unconfigured provider would silently pick up ambient env.
  const rawUrl = url === undefined ? process.env.UPSTASH_REDIS_REST_URL : url;
  const rawToken = token === undefined ? process.env.UPSTASH_REDIS_REST_TOKEN : token;
  const cfg = {
    url: String(rawUrl || "").replace(/\/+$/, ""),
    token: String(rawToken || ""),
  };

  if (!cfg.url || !cfg.token) return null;

  return {
    name: "upstash",

    isConfigured() {
      return Boolean(cfg.url && cfg.token);
    },

    /** Single round-trip liveness probe — used by the circuit breaker. */
    async ping() {
      const res = await command(["PING"], cfg, timeoutMs);
      if (!res.ok) throw new Error(`redis ping failed: ${res.error}`);
      return true;
    },

    async get(key) {
      const res = await command(["GET", key], cfg, timeoutMs);
      if (!res.ok) throw new Error(`redis GET failed: ${res.error}`);
      return decode(res.result);
    },

    /** The shadow copy, still readable after the live key has expired. */
    async getStale(key) {
      const res = await command(["GET", staleKeyOf(key)], cfg, timeoutMs);
      if (!res.ok) throw new Error(`redis GET(stale) failed: ${res.error}`);
      const entry = decode(res.result);
      return entry ? { value: entry.value } : null;
    },

    async set(key, value, ttlMs) {
      const live = encode(value, ttlMs);
      const shadowTtl = Math.max(ttlMs, 1) + STALE_GRACE_MS;
      // One pipeline so the live key and its shadow can never disagree.
      const res = await pipeline(
        [
          ["SET", key, live, "PX", Math.max(1, Math.round(ttlMs))],
          ["SET", staleKeyOf(key), live, "PX", Math.round(shadowTtl)],
        ],
        cfg,
        timeoutMs
      );
      if (!res.ok) throw new Error(`redis SET failed: ${res.error}`);
    },

    async del(key) {
      const res = await command(["DEL", key, staleKeyOf(key)], cfg, timeoutMs);
      if (!res.ok) throw new Error(`redis DEL failed: ${res.error}`);
    },

    async delPrefix(prefix) {
      const res = await scanAndDelete(prefix, cfg, timeoutMs);
      // A partial delete still removed something — report it rather than
      // throwing, so invalidation is best-effort instead of request-fatal.
      if (!res.ok) return res.removed || 0;
      return res.removed;
    },

    /**
     * Redis has no cheap "how many keys match my namespace" on a shared
     * instance, and DBSIZE would count other tenants' keys. We return null
     * to mean "unknown" — callers must handle null rather than render 0,
     * because 0 would be a lie.
     */
    async size() {
      return null;
    },

    /**
     * Only ever clears OUR namespace. A real FLUSHDB on a shared Upstash
     * instance would destroy unrelated data, so it is deliberately not used.
     */
    async flush() {
      const res = await scanAndDelete("", cfg, timeoutMs);
      if (!res.ok) throw new Error(`redis flush failed: ${res.error}`);
    },
  };
}

module.exports = {
  createUpstashProvider,
  STALE_GRACE_MS,
  SCAN_MAX_ITERATIONS,
  staleKeyOf,
  // exported for tests: lets a fake Upstash be driven without network access
  _command: command,
  _pipeline: pipeline,
};
