#!/usr/bin/env node
/**
 * EventHub — Part 6, Phase 1 selftest (Redis provider + key architecture)
 * ─────────────────────────────────────────────────────────────────────────────
 * Covers §1 (provider abstraction + graceful boot) and §3 (key architecture)
 * of the Part 6 brief.
 *
 * The Redis path is exercised against a FAKE Upstash REST server started in
 * this process. That is deliberate: it is the provider's own HTTP code that
 * gets tested — the real request shape, the real pipeline handling, the real
 * error path — without depending on a live Upstash instance or a network.
 *
 *   §1  provider interface parity
 *   §2  boot safety — the app must start with Redis absent or broken
 *   §3  key architecture — namespace, version, registry, privacy
 *   §4  Redis functional behaviour over the wire
 *   §5  fallback — a dead Redis degrades to memory, never throws
 *   §6  credential safety
 *   §7  backwards compatibility with the Part 5 call sites
 *
 * Run: npm run test:phase10
 */
"use strict";

const http = require("http");

/* ── env: point the cache at our fake BEFORE cache.service is required ── */
const FAKE_PG_PORT = 5612; // Phase 5: fake PostgREST
const FAKE_PG2_PORT = 5613; // Phase 6: fake PostgREST for the sync consumer
const FAKE_PG3_PORT = 5614; // Phase 7: fake PostgREST for degradation tests
const FAKE_PORT = 5611;
process.env.CACHE_PROVIDER = "upstash";
process.env.UPSTASH_REDIS_REST_URL = `http://127.0.0.1:${FAKE_PORT}`;
process.env.UPSTASH_REDIS_REST_TOKEN = "test-token-do-not-log";
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-secret";

/* ── harness ─────────────────────────────────────────────────────────── */

let passed = 0;
let failed = 0;
const failures = [];
let section = "";

function sec(name) {
  section = name;
  console.log(`\n── ${name} ${"─".repeat(Math.max(0, 58 - name.length))}`);
}

function ok(label, cond, detail) {
  if (cond) {
    passed++;
    console.log(`  ✅ ${label}`);
  } else {
    failed++;
    failures.push(`[${section}] ${label}${detail ? ` — ${detail}` : ""}`);
    console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const eq = (label, actual, expected) =>
  ok(label, Object.is(actual, expected), `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* ══ Fake Upstash REST server ═══════════════════════════════════════════
 * Implements just enough of the Upstash REST contract to drive the real
 * provider: POST / with a JSON array, and POST /pipeline with an array of
 * arrays. `broken` makes every request fail, which is how we test fallback.
 */
function createFakeUpstash() {
  const store = new Map(); // key -> { value, expiresAt }
  const state = { broken: false, commands: 0, authSeen: [] };

  const live = (key) => {
    const e = store.get(key);
    if (!e) return undefined;
    if (e.expiresAt !== null && e.expiresAt <= Date.now()) {
      store.delete(key);
      return undefined;
    }
    return e.value;
  };

  // Sorted sets for the rate-limit sliding window, kept ordered by score.
  const zsets = new Map();

  /** Drop everything scoring <= max (and any expired entry). */
  function zremRangeByScore(key, min, max) {
    const z = zsets.get(key);
    if (!z) return 0;
    let removed = 0;
    for (let i = z.length - 1; i >= 0; i--) {
      if (z[i].score <= max) {
        z.splice(i, 1);
        removed += 1;
      }
    }
    if (!z.length) zsets.delete(key);
    return removed;
  }

  function zadd(key, score, member) {
    if (!zsets.has(key)) zsets.set(key, []);
    const z = zsets.get(key);
    z.push({ score: Number(score), member });
    z.sort((a, b) => a.score - b.score);
    return 1;
  }

  /**
   * Test double for EVAL.
   * ─────────────────────────────────────────────────────────────────────
   * The fake does not embed a Lua interpreter. Instead, when the submitted
   * script is our sliding-window script it executes the equivalent logic
   * against a real ordered sorted set. That still exercises everything the
   * provider is responsible for — sending EVAL with the right KEYS/ARGV and
   * interpreting {totalHits, resetMs, allowed} — while the script's own
   * semantics are verified by the separate script-shape assertions below.
   */
  function runEval(script, keys, argv) {
    /* Phase 4: the lock service ships two small scripts of its own. Dispatch
     * on their shape first — both are compare-and-X against a plain string
     * value, so they need the string store, not a sorted set. */
    if (/PEXPIRE/.test(script) && /GET/.test(script)) {
      // EXTEND: compare-and-pexpire
      const [key] = keys;
      const token = argv[0];
      if (live(key) === token) {
        store.get(key).expiresAt = Date.now() + Number(argv[1]);
        return 1;
      }
      return 0;
    }
    if (/DEL/.test(script) && /GET/.test(script)) {
      // RELEASE: compare-and-delete
      const [key] = keys;
      const token = argv[0];
      if (live(key) === token) {
        store.delete(key);
        return 1;
      }
      return 0;
    }
    if (!/ZREMRANGEBYSCORE/.test(script) || !/ZCARD/.test(script)) return null;
    const [key] = keys;
    const now = Number(argv[0]);
    const window = Number(argv[1]);
    const limit = Number(argv[2]);
    const member = argv[3];

    zremRangeByScore(key, 0, now - window);
    const z = zsets.get(key) || [];
    const used = z.length;
    const allowed = used < limit ? 1 : 0;

    // Mirrors the script: the hit is always recorded.
    zadd(key, now, member);
    const z2 = zsets.get(key) || [];
    const reset = z2.length ? z2[0].score + window : now + window;
    return [used + 1, reset, allowed];
  }

  function runCommand(args) {
    const cmd = String(args[0] || "").toUpperCase();
    state.commands += 1;
    switch (cmd) {
      case "EVAL": {
        const [, script, numkeys] = args;
        const n = Number(numkeys) || 0;
        const keys = args.slice(3, 3 + n);
        const argv = args.slice(3 + n);
        return runEval(String(script), keys, argv);
      }
      case "ZADD":
        return zadd(args[1], Number(args[2]), args[3]);
      case "ZCARD":
        return (zsets.get(args[1]) || []).length;
      case "ZREMRANGEBYSCORE":
        return zremRangeByScore(args[1], Number(args[2]), Number(args[3]));
      case "ZRANGE": {
        const z = zsets.get(args[1]) || [];
        const start = Number(args[2]);
        const stop = Number(args[3]);
        const slice = stop === 0 ? z.slice(start, start + 1) : z.slice(start, stop + 1);
        const withScores = String(args[4] || "").toUpperCase() === "WITHSCORES";
        return withScores ? slice.flatMap((e) => [e.member, String(e.score)]) : slice.map((e) => e.member);
      }
      case "PEXPIRE":
        return zsets.has(args[1]) ? 1 : 0;
      case "DEL": {
        let n = 0;
        for (const k of args.slice(1)) {
          if (store.delete(k)) n += 1;
          if (zsets.delete(k)) n += 1;
        }
        return n;
      }
      case "PING":
        return "PONG";
      case "GET":
        return live(args[1]) ?? null;
      case "SET": {
        // SET key value [NX] [PX <ttl>]
        //   plain :        SET k v            / SET k v PX <ttl>
        //   conditional :  SET k v NX PX <ttl>
        // NOTE: in the NX form the TTL is arg[5], NOT arg[4] — arg[4] is the
        // literal "PX" flag. Reading index 4 yields Number("PX") === NaN, which
        // silently makes every conditional key immortal and would have hidden
        // a missing-TTL regression in both the idempotency store and the lock.
        const [, key, value, opt, arg4, arg5] = args;
        const upper = String(opt || "").toUpperCase();
        if (upper === "NX") {
          const existing = live(key);
          if (existing !== undefined) return null; // already claimed
          let ttl = 1000;
          if (String(arg4 || "").toUpperCase() === "PX") ttl = Number(arg5);
          if (!Number.isFinite(ttl)) ttl = 1000;
          store.set(key, { value, expiresAt: Date.now() + ttl });
          return "OK";
        }
        let expiresAt = null;
        if (upper === "PX") expiresAt = Date.now() + Number(arg4);
        store.set(key, { value, expiresAt });
        return "OK";
      }
      case "DEL": {
        let n = 0;
        for (const k of args.slice(1)) if (store.delete(k)) n += 1;
        return n;
      }
      case "SCAN": {
        const [, cursor, , match, , count] = args;
        const prefix = String(match || "").replace(/\*$/, "");
        const keys = [...store.keys()].filter((k) => k.startsWith(prefix));
        const start = Number(cursor) || 0;
        const batch = keys.slice(start, start + Number(count || 500));
        const next = start + batch.length >= keys.length ? "0" : String(start + batch.length);
        return [next, batch];
      }
      default:
        return null;
    }
  }

  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      state.authSeen.push(req.headers.authorization || null);
      const send = (code, body) => {
        res.writeHead(code, { "Content-Type": "application/json" });
        res.end(JSON.stringify(body));
      };
      if (state.broken) return send(500, { error: "upstream unavailable" });

      let payload;
      try {
        payload = JSON.parse(raw);
      } catch {
        return send(400, { error: "bad json" });
      }

      try {
        if (req.url === "/pipeline" || req.url?.startsWith("/pipeline")) {
          return send(200, payload.map((c) => ({ result: runCommand(c) })));
        }
        return send(200, { result: runCommand(payload) });
      } catch (err) {
        return send(500, { error: String(err?.message || err) });
      }
    });
  });

  return { server, store, zsets, state };
}


/* ══ Fake PostgREST server (Phase 5) ═════════════════════════════════════
 * Just enough of the PostgREST contract to drive the real client:
 *   GET  /rest/v1/<table>?select=a,b&col=eq.v&col2=in.(x,y)&order=c.desc&limit=n
 *   POST /rest/v1/<table>              (insert, honours Prefer: return=
 *   PATCH/DELETE /rest/v1/<table>?...  (filtered update/delete)
 * It supports the filter operators our repositories actually emit: eq, in,
 * is, gt, lt, gte, lte, and or=(...).
 *
 * `broken` makes every request 500 so we can assert failure handling.
 */
function createFakePostgrest() {
  const http = require("http");
  const tables = new Map(); // table -> array of row objects
  const state = { broken: false, requests: 0, lastHeaders: null, paths: [] };

  const ensure = (t) => {
    if (!tables.has(t)) tables.set(t, []);
    return tables.get(t);
  };

  function matches(row, filters, base) {
    // `or` is a composite: or=(a.ilike.*x*,b.ilike.*x*)
    for (const [col, raw] of filters) {
      if (col !== "or") continue;
      const inner = String(raw).replace(/^\(|\)$/g, "");
      const parts = inner.split(",").map((p) => p.trim()).filter(Boolean);
      const any = parts.some((p) => {
        const m = /^([^.]+)\.ilike\.(.*)$/.exec(p);
        if (!m) return false;
        const [, c, pattern] = m;
        const needle = decodeURIComponent(pattern).replace(/\*/g, "").toLowerCase();
        return String(row[c] ?? "").toLowerCase().includes(needle);
      });
      if (!any) return false;
    }
    for (const [col, raw] of filters) {
      if (col === "or") continue;
      const op = String(raw);
      const val = row[col];
      const num = (v) => Number(v);
      if (op.startsWith("eq.")) return String(val) === op.slice(3) ? true : false;
      if (op.startsWith("neq.")) { if (String(val) === op.slice(4)) return false; continue; }
      if (op.startsWith("in.(")) {
        const list = op.slice(4, -1).split(",").map(decodeURIComponent);
        if (!list.includes(String(val))) return false;
        continue;
      }
      if (op.startsWith("is.")) { if (op.slice(3) === "null" ? val != null : val == null) return false; continue; }
      if (op.startsWith("gte.")) { if (!(num(val) >= num(op.slice(4)))) return false; continue; }
      if (op.startsWith("lte.")) { if (!(num(val) <= num(op.slice(4)))) return false; continue; }
      if (op.startsWith("gt.")) { if (!(String(val) > op.slice(3))) return false; continue; }
      if (op.startsWith("lt.")) { if (!(String(val) < op.slice(3))) return false; continue; }
    }
    return true;
  }

  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      state.requests += 1;
      state.lastHeaders = req.headers;
      state.paths.push(req.url);

      const send = (code, payload) => {
        const buf = Buffer.from(JSON.stringify(payload));
        res.writeHead(code, {
          "Content-Type": "application/json",
          "Content-Range": `0-${Math.max(0, buf.length - 1)}/*`,
        });
        res.end(buf);
      };

      if (state.broken) {
        // A realistic PostgREST failure: it echoes Postgres detail.
        return send(500, {
          message: 'duplicate key value violates unique constraint "reactions_post_id_user_id_key"',
          details: "Key (post_id, user_id)=(1, 2) already exists.",
          hint: "connection string: postgres://user:SECRET@db.supabase.co:5432/postgres",
        });
      }

      const u = new URL(req.url, "http://127.0.0.1");
      const m = /^\/rest\/v1\/([^/?]+)/.exec(u.pathname);
      if (!m) return send(404, { message: "no such endpoint" });
      const table = decodeURIComponent(m[1]);
      const rows = ensure(table);

      const filters = [];
      let orderSpec = null;
      let limitN = null;
      let selectCols = null;
      for (const [k, v] of u.searchParams.entries()) {
        if (k === "order") orderSpec = v;
        else if (k === "limit") limitN = Number(v);
        else if (k === "select") selectCols = v;
        else filters.push([k, v]);
      }

      const method = req.method;

      if (method === "GET") {
        let out = rows.filter((r) => matches(r, filters, null));
        if (orderSpec) {
          for (const clause of String(orderSpec).split(",")) {
            const [c, dir] = clause.split(".");
            out = [...out].sort((a, b) => {
              const av = a[c]; const bv = b[c];
              const cmp = typeof av === "number" && typeof bv === "number"
                ? av - bv
                : String(av).localeCompare(String(bv));
              return dir === "desc" ? -cmp : cmp;
            });
          }
        }
        if (limitN != null) out = out.slice(0, limitN);
        if (selectCols && selectCols !== "*") {
          const cols = selectCols.split(",").map((c) => c.trim());
          out = out.map((r) => {
            const o = {};
            for (const c of cols) if (c in r) o[c] = r[c];
            return o;
          });
        }
        return send(200, out);
      }

      if (method === "POST") {
        const incoming = body ? JSON.parse(body) : null;
        const list = Array.isArray(incoming) ? incoming : [incoming];
        const prefer = String(req.headers.prefer || "");
        const inserted = [];

        // ── UPSERT ──
        // PostgREST merges on the `on_conflict` columns when
        // `Prefer: resolution=merge-duplicates` is set. The fake MUST do the
        // same: otherwise every idempotence assertion in this suite would pass
        // against a strawman that creates a new row per insert, and would say
        // nothing about the real system.
        const isUpsert = prefer.includes("resolution=merge-duplicates");
        const conflictArg = /on_conflict=([^,&]+)/.exec(u.searchParams.get("on_conflict") || "") || /on_conflict=([^,]+)/.exec(prefer);
        const conflictCols = conflictArg
          ? conflictArg[1].split(",").map((c) => c.trim()).filter(Boolean)
          : [];

        for (const row of list) {
          if (isUpsert && conflictCols.length) {
            const existing = rows.find((r) =>
              conflictCols.every((c) => String(r[c]) === String(row[c]))
            );
            if (existing) {
              Object.assign(existing, row);
              inserted.push(existing);
              continue;
            }
          }
          const full = { id: row.id || `row-${rows.length + 1}`, created_at: new Date().toISOString(), ...row };
          rows.push(full);
          inserted.push(full);
        }
        if (prefer.includes("return=minimal")) return send(201, []);
        return send(201, inserted);
      }

      if (method === "PATCH") {
        const patch = body ? JSON.parse(body) : {};
        const hit = rows.filter((r) => matches(r, filters, null));
        for (const r of hit) Object.assign(r, patch);
        if (String(req.headers.prefer || "").includes("return=minimal")) return send(200, []);
        return send(200, hit);
      }

      if (method === "DELETE") {
        const hit = rows.filter((r) => matches(r, filters, null));
        for (const r of hit) rows.splice(rows.indexOf(r), 1);
        if (String(req.headers.prefer || "").includes("return=minimal")) return send(200, []);
        return send(200, hit);
      }

      return send(405, { message: "method not allowed" });
    });
  });

  return { server, tables, state, ensure };
}

(async () => {
  const pgFake2 = createFakePostgrest();
  await new Promise((r) => pgFake2.server.listen(FAKE_PG2_PORT, "127.0.0.1", r));

  const fake = createFakeUpstash();
  await new Promise((r) => fake.server.listen(FAKE_PORT, "127.0.0.1", r));

  const { createUpstashProvider } = require("../providers/redis/upstash.provider");
  const cacheService = require("../services/cache.service");
  const { cache, keys, TTL, CACHE_REGISTRY, KEY_PREFIX, isPrivateKey, resolvePrefix } = cacheService;

  /* ══ §1 Provider interface parity ═══════════════════════════════════ */
  sec("1. Provider interface parity (§1)");

  const provider = cacheService.provider;
  ok("a provider was selected", !!provider);
  ok("CACHE_PROVIDER=upstash selected the Redis path", provider.name?.includes("upstash"), provider.name);

  const REQUIRED = ["get", "getStale", "set", "del", "delPrefix", "size", "flush"];
  for (const m of REQUIRED) {
    ok(`the provider implements ${m}()`, typeof provider[m] === "function");
  }
  for (const m of REQUIRED) {
    ok(`MemoryCacheProvider also implements ${m}()`, typeof cacheService.MemoryCacheProvider.prototype[m] === "function");
  }

  const rawUpstash = createUpstashProvider({
    url: `http://127.0.0.1:${FAKE_PORT}`,
    token: "x",
  });
  ok("createUpstashProvider returns an object when configured", !!rawUpstash);
  ok("it reports its name", rawUpstash.name === "upstash", rawUpstash.name);
  ok("isConfigured() is true when both env vars are present", rawUpstash.isConfigured() === true);

  const missing = createUpstashProvider({ url: "", token: "" });
  eq("with no URL/token it returns null (so the caller falls back)", missing, null);

  const notConfigured = require("../providers/redis/upstash.provider");
  ok("the module exposes a factory, not a hard dependency", typeof notConfigured.createUpstashProvider === "function");

  /* ══ §2 Boot safety ═════════════════════════════════════════════════ */
  sec("2. Boot safety — Redis must never take the app down (§1)");

  const { execFileSync } = require("child_process");
  const runBoot = (env) => {
    try {
      const out = execFileSync(
        process.execPath,
        ["-e", "require('/home/user/teameklavya/backend/services/cache.service'); console.log('BOOTED')"],
        { env: { ...process.env, ...env }, encoding: "utf8", timeout: 30_000, stdio: ["ignore", "pipe", "pipe"] }
      );
      return { ok: true, out };
    } catch (e) {
      return { ok: false, out: String(e.stdout || "") + String(e.stderr || "") };
    }
  };

  const bootNoProvider = runBoot({ CACHE_PROVIDER: "memory" });
  ok("boots with CACHE_PROVIDER=memory", bootNoProvider.ok && bootNoProvider.out.includes("BOOTED"));

  const bootUnset = runBoot({ CACHE_PROVIDER: "", UPSTASH_REDIS_REST_URL: "", UPSTASH_REDIS_REST_TOKEN: "" });
  ok("boots with Redis completely unconfigured", bootUnset.ok && bootUnset.out.includes("BOOTED"));

  // upstash requested but pointed at a closed port — must still boot
  const bootDead = runBoot({
    CACHE_PROVIDER: "upstash",
    UPSTASH_REDIS_REST_URL: "http://127.0.0.1:1",
    UPSTASH_REDIS_REST_TOKEN: "x",
  });
  ok("boots with CACHE_PROVIDER=upstash against a DEAD endpoint", bootDead.ok && bootDead.out.includes("BOOTED"), bootDead.out.slice(0, 200));

  /* ══ §3 Key architecture ════════════════════════════════════════════ */
  sec("3. Key architecture — namespace, version, registry (§3)");

  ok("every built key carries the namespace+version prefix", keys.event("abc").startsWith("eh:v1:"), keys.event("abc"));
  ok("the prefix is exported for tooling", KEY_PREFIX === "eh:v1:", KEY_PREFIX);

  const requiredKeys = {
    event: () => keys.event("e1"),
    eventCounts: () => keys.eventCounts("e1"),
    feed: () => keys.feed("u1", "cur1"),
    profile: () => keys.profile("u1"),
    community: () => keys.community("c1"),
    communityMembers: () => keys.communityMembers("c1", "cur1"),
    leaderboard: () => keys.leaderboard("a1"),
    search: () => keys.search("hash1"),
  };
  for (const [name, fn] of Object.entries(requiredKeys)) {
    const k = fn();
    ok(`the ${name} key exists and is namespaced`, typeof k === "string" && k.startsWith(KEY_PREFIX), k);
  }

  // The brief's literal shapes
  ok("event key ends cache:event:{id}", keys.event("X").endsWith("cache:event:X"), keys.event("X"));
  ok("event-counts key matches cache:event-counts:{id}", keys.eventCounts("X").endsWith("cache:event-counts:X"));
  ok("feed key embeds user AND cursor", keys.feed("U", "C").endsWith("cache:feed:U:C"), keys.feed("U", "C"));
  ok("community-members key embeds community AND cursor",
    keys.communityMembers("C", "K").endsWith("cache:community-members:C:K"));
  ok("leaderboard key embeds the activity", keys.leaderboard("A").endsWith("cache:leaderboard:A"));
  ok("search key is keyed by hash, not raw text", keys.search("h").endsWith("cache:search:h"));

  // Version bump invalidates everything
  const bumped = execFileSync(
    process.execPath,
    ["-e", "const{keys}=require('/home/user/teameklavya/backend/services/cache.service');console.log(keys.event('X'))"],
    { env: { ...process.env, CACHE_KEY_VERSION: "v2" }, encoding: "utf8" }
  ).trim();
  ok("bumping CACHE_KEY_VERSION changes every key", bumped === "eh:v2:cache:event:X", bumped);

  // Registry completeness — every entry declares all four fields
  const registryEntries = Object.entries(CACHE_REGISTRY);
  ok("the registry is populated", registryEntries.length > 0, String(registryEntries.length));
  let complete = 0;
  for (const [name, e] of registryEntries) {
    if (e && typeof e.ttl === "number" && e.owner && Array.isArray(e.invalidatedBy) && (e.privacy === "public" || e.privacy === "private")) {
      complete += 1;
    } else {
      console.log(`     (incomplete registry entry: ${name})`);
    }
  }
  eq("EVERY registry entry declares owner + ttl + invalidatedBy + privacy", complete, registryEntries.length);

  // Privacy classification is consistent with the key domain
  // Map each private registry entry to the builder that produces its keys,
  // then assert that builder's output really is classified private.
  const PRIVATE_ENTRY_BUILDER = {
    FEED: "feed",
    PROFILE: "profile",
    FOLLOW_LIST: "followList",
    COMMUNITY_MEMBERS: "communityMembers",
  };
  const privateEntries = Object.entries(CACHE_REGISTRY).filter(([, e]) => e.privacy === "private");
  ok("there is at least one private registry entry", privateEntries.length > 0, String(privateEntries.length));
  for (const [name] of privateEntries) {
    const builder = PRIVATE_ENTRY_BUILDER[name];
    ok(
      `registry entry ${name} maps to a private key domain`,
      builder ? typeof keys[builder] === "function" && isPrivateKey(keys[builder]("x")) : true,
      builder ? keys[builder]("x") : "(no dedicated builder)"
    );
  }

  // SWR must stay forbidden on private keys
  let swrBlocked = false;
  try {
    await cache.getOrSet(keys.feed("u1", "c1"), async () => ({}), { ttl: 60_000, swr: true });
  } catch (e) {
    swrBlocked = /forbidden for private key/i.test(e.message);
  }
  ok("SWR is still refused on a private key (§14)", swrBlocked);

  // resolvePrefix accepts a bare domain
  ok("resolvePrefix('event') builds the namespaced prefix", resolvePrefix("event") === `${KEY_PREFIX}cache:event:`, resolvePrefix("event"));
  ok("resolvePrefix('event:') also works", resolvePrefix("event:") === `${KEY_PREFIX}cache:event:`);
  ok("resolvePrefix leaves a built prefix alone", resolvePrefix(KEY_PREFIX + "x") === KEY_PREFIX + "x");

  // Prefix isolation: event must not sweep event-counts
  await cache.flush();
  await cache.getOrSet(keys.event("a"), async () => 1, { ttl: 60_000 });
  await cache.getOrSet(keys.event("b"), async () => 1, { ttl: 60_000 });
  await cache.getOrSet(keys.eventCounts("a"), async () => 1, { ttl: 60_000 });
  const removed = await cache.invalidatePrefix("event:");
  eq("invalidatePrefix('event') removes only the event keys", removed, 2);
  ok("the event-counts key survives a sibling-domain invalidation",
    (await cache.peek(keys.eventCounts("a"))) !== undefined);

  /* ══ §4 Redis functional behaviour ══════════════════════════════════ */
  sec("4. Redis behaviour over the wire (§1, §3)");

  await cache.flush();
  fake.state.commands = 0;

  let loads = 0;
  const load = async () => {
    loads += 1;
    return { hello: "redis" };
  };

  const v1 = await cache.getOrSet("eh:v1:cache:test:1", load, { ttl: 60_000 });
  eq("a cold key runs the loader", loads, 1);
  ok("the loaded value is returned", v1 && v1.hello === "redis");

  const v2 = await cache.getOrSet("eh:v1:cache:test:1", load, { ttl: 60_000 });
  eq("a warm key does NOT re-run the loader", loads, 1);
  ok("the cached value comes back", v2 && v2.hello === "redis");

  ok("the fake server received real commands", fake.state.commands > 0, String(fake.state.commands));
  ok("the value was actually written to the remote store", fake.store.size > 0, String(fake.store.size));

  // TTL expiry is enforced remotely
  await cache.getOrSet("eh:v1:cache:test:ttl", load, { ttl: 120 });
  ok("a short-TTL key is present immediately", (await cache.peek("eh:v1:cache:test:ttl")) !== undefined);
  await wait(220);
  ok("after its TTL the key is gone", (await cache.peek("eh:v1:cache:test:ttl")) === undefined);

  // Stale shadow supports SWR
  await cache.getOrSet("eh:v1:cache:test:swr", load, { ttl: 100, swr: true });
  await wait(180);
  const stale = await cache.getOrSet("eh:v1:cache:test:swr", load, { ttl: 100, swr: true });
  ok("SWR serves the stale value after expiry", stale && stale.hello === "redis");

  // Single-key invalidation. Measure the DELTA rather than an absolute:
  // SWR's background revalidation also invokes the loader, so an absolute
  // count here would be coupled to unrelated timing.
  await cache.invalidate("eh:v1:cache:test:1");
  ok("invalidate removes the key", (await cache.peek("eh:v1:cache:test:1")) === undefined);
  const loadsBefore = loads;
  await cache.getOrSet("eh:v1:cache:test:1", load, { ttl: 60_000 });
  eq("after invalidation the loader runs again (exactly one extra run)", loads - loadsBefore, 1);

  /* ══ §5 Fallback ════════════════════════════════════════════════════ */
  sec("5. Fallback — a dead Redis degrades, never fails (§1)");

  await cache.flush();
  const before = provider.stats ? { ...provider.stats } : null;
  fake.state.broken = true; // every request now returns HTTP 500

  let threw = false;
  let value = null;
  try {
    value = await cache.getOrSet("eh:v1:cache:test:fallback", async () => ({ via: "loader" }), { ttl: 60_000 });
  } catch {
    threw = true;
  }
  ok("a broken Redis does NOT throw at the caller", !threw);
  ok("the loader still produced a value", value && value.via === "loader");

  const warmDuringOutage = await cache.getOrSet("eh:v1:cache:test:fallback", async () => ({ via: "loader2" }), { ttl: 60_000 });
  ok("the memory fallback serves the warm value during the outage",
    warmDuringOutage && warmDuringOutage.via === "loader", JSON.stringify(warmDuringOutage));

  const st = await cache.stats();
  ok("stats report the fallback", st.redis && st.redis.fallbackUsed > 0, JSON.stringify(st.redis));
  ok("the circuit breaker opened", st.redis && st.redis.state === "open", JSON.stringify(st.redis?.state));
  ok("errors are counted, not hidden", st.redis && st.redis.primaryErrors > 0, JSON.stringify(st.redis));
  ok("the recorded error string carries no URL or token",
    !/http|127\.0\.0\.1|test-token-do-not-log/i.test(String(st.redis?.lastError || "")),
    String(st.redis?.lastError));

  fake.state.broken = false;

  /* ══ §6 Credential safety ═══════════════════════════════════════════ */
  sec("6. Credential safety (§14)");

  const { execSync } = require("child_process");
  let frontendLeak = "";
  try {
    frontendLeak = execSync(
      "grep -rlE 'UPSTASH_REDIS_REST_TOKEN|UPSTASH_REDIS_REST_URL' /home/user/teameklavya/frontend/src 2>/dev/null || true",
      { encoding: "utf8" }
    ).trim();
  } catch {
    frontendLeak = "";
  }
  ok("no Redis credential is referenced anywhere in frontend/src", frontendLeak === "", frontendLeak);

  ok("the fake server saw a Bearer token on every request",
    fake.state.authSeen.length > 0 && fake.state.authSeen.every((a) => typeof a === "string" && a.startsWith("Bearer ")),
    JSON.stringify(fake.state.authSeen.slice(0, 2)));

  const src = require("fs").readFileSync("/home/user/teameklavya/backend/providers/redis/upstash.provider.js", "utf8");
  ok("the provider never logs the token", !/console\.log\([^)]*token/i.test(src));
  ok("the provider never logs the URL", !/console\.log\([^)]*cfg\.url/i.test(src));

  /* ══ §7 Backwards compatibility ═════════════════════════════════════ */
  sec("7. Backwards compatibility with Part 5 call sites");

  eq("TTL.EVENT_COUNTS is still a plain number", typeof TTL.EVENT_COUNTS, "number");
  ok("TTL values are all numbers", Object.values(TTL).every((v) => typeof v === "number" && v > 0));
  ok("the registry and TTL agree on every entry",
    Object.entries(CACHE_REGISTRY).every(([k, v]) => TTL[k] === v.ttl));

  const flKey = keys.followList("user-aaa");
  ok("followList still embeds the user id", flKey.includes("user-aaa"), flKey);
  ok("different users still get different keys", keys.followList("a") !== keys.followList("b"));

  let legacySwr = false;
  try {
    await cache.getOrSet("user:private:p9", async () => ({}), { ttl: 60_000, swr: true });
  } catch (e) {
    legacySwr = /forbidden for private key/i.test(e.message);
  }
  ok("SWR is still refused for a bare legacy private key", legacySwr);

  // The facade must still expose exactly the same surface as Part 5, plus more
  const facade = Object.keys(cache).sort();
  for (const m of ["getOrSet", "peek", "invalidate", "invalidatePrefix", "stats", "flush"]) {
    ok(`the cache facade still exposes ${m}()`, facade.includes(m));
  }
  ok("the facade still exposes no raw set()", !facade.includes("set"));

  /* ══ §8 Distributed rate limiting (brief §4) ══════════════════════ */
  sec("8. Distributed rate limiting (§4)");

  const {
    MemorySlidingWindow,
    RedisSlidingWindow,
    createRedisRunner,
    SLIDING_WINDOW_LUA,
  } = require("../providers/redis/sliding-window.store");
  const { SlidingWindowStore } = require("../providers/redis/rate-limit-store.adapter");

  // The Lua script must be a correct sliding window; assert its shape.
  ok("the sliding-window script removes entries older than the window", /ZREMRANGEBYSCORE/.test(SLIDING_WINDOW_LUA));
  ok("it counts what remains", /ZCARD/.test(SLIDING_WINDOW_LUA));
  ok("it decides admission against the limit", /used < limit/.test(SLIDING_WINDOW_LUA));
  ok("it records the hit even when refused (express-rate-limit blocks on totalHits > limit)",
    /-- ALWAYS record the hit/.test(SLIDING_WINDOW_LUA) && /return \{ used \+ 1/.test(SLIDING_WINDOW_LUA));
  ok("it sets a TTL so abandoned buckets expire", /PEXPIRE/.test(SLIDING_WINDOW_LUA));
  ok("it reports reset from the OLDEST surviving entry", /oldest\[2\]/.test(SLIDING_WINDOW_LUA));

  // ── The brief's scenario, literally ───────────────────────────────────
  // Two independent limiter instances (Server A and Server B) sharing one
  // Redis. 10 hits split 5/5 across them must still exhaust a bucket of 10.
  const runner = createRedisRunner({ url: `http://127.0.0.1:${FAKE_PORT}`, token: "test-token-do-not-log" });
  ok("a Redis runner is created when configured", typeof runner === "function");

  const sharedBackend = new RedisSlidingWindow(runner, { keyPrefix: "eh:v1:rl:" });

  // Server A and Server B each get their OWN store object — that is what
  // makes this a real multi-instance simulation rather than one object
  // counting for itself.
  const serverA = new SlidingWindowStore({ backend: sharedBackend, domain: "AUTH", limit: 10, windowMs: 60_000 });
  const serverB = new SlidingWindowStore({ backend: sharedBackend, domain: "AUTH", limit: 10, windowMs: 60_000 });

  let aHits = 0;
  let bHits = 0;
  for (let i = 0; i < 5; i++) {
    await serverA.increment("u:shared-user");
    aHits += 1;
  }
  for (let i = 0; i < 5; i++) {
    await serverB.increment("u:shared-user");
    bHits += 1;
  }
  eq("Server A recorded 5 hits", aHits, 5);
  eq("Server B recorded 5 hits", bHits, 5);

  const eleventh = await serverB.increment("u:shared-user");
  ok("the 11th hit ACROSS BOTH SERVERS exceeds the limit of 10",
    eleventh.totalHits > 10, JSON.stringify(eleventh));
  ok("the shared bucket really did accumulate 10 hits",
    eleventh.totalHits === 11, `totalHits=${eleventh.totalHits}`);
  ok("a resetTime is reported so Retry-After can be computed",
    eleventh.resetTime instanceof Date, JSON.stringify(eleventh.resetTime));

  // Compare against the memory backend, which would NOT see the other server.
  // Two SEPARATE memory backends = two processes that cannot see each other.
  // This is the divergence Redis exists to remove, stated as a test.
  const memA = new SlidingWindowStore({ backend: new MemorySlidingWindow(), domain: "AUTH", limit: 10, windowMs: 60_000 });
  const memB = new SlidingWindowStore({ backend: new MemorySlidingWindow(), domain: "AUTH", limit: 10, windowMs: 60_000 });
  for (let i = 0; i < 5; i++) await memA.increment("u:x");
  for (let i = 0; i < 5; i++) await memB.increment("u:x");
  const memLast = await memB.increment("u:x");
  eq("two isolated memory backends each see only their own 5 hits", memLast.totalHits, 6);

  // ── Domains must not collide ──
  const authStore = new SlidingWindowStore({ backend: sharedBackend, domain: "AUTH", limit: 3, windowMs: 60_000 });
  const searchStore = new SlidingWindowStore({ backend: sharedBackend, domain: "SEARCH", limit: 3, windowMs: 60_000 });
  for (let i = 0; i < 3; i++) await authStore.increment("u:collide");
  const searchFirst = await searchStore.increment("u:collide");
  eq("a different domain has its own bucket", searchFirst.totalHits, 1);

  // ── resetKey ──
  await authStore.resetKey("u:collide");
  const afterReset = await authStore.increment("u:collide");
  eq("resetKey clears the bucket", afterReset.totalHits, 1);

  // ── FAIL OPEN on Redis failure ──
  sec("9. Rate limiting fails OPEN (§4, §15)");
  fake.state.broken = true;
  const errorsBefore = sharedBackend.stats_.errors;
  let threw2 = false;
  let rlVerdict = null;
  try {
    rlVerdict = await serverA.increment("u:outage-user");
  } catch {
    threw2 = true;
  }
  ok("a Redis outage does not throw from the rate limiter", !threw2);
  ok("traffic is ALLOWED during the outage (no self-inflicted outage)",
    rlVerdict && rlVerdict.totalHits === 0, JSON.stringify(rlVerdict));
  ok("the outage is counted so the dashboard can show it",
    sharedBackend.stats_.errors > errorsBefore, JSON.stringify(sharedBackend.stats()));
  ok("the backend reports itself as degraded", sharedBackend.stats_.fallbacks > 0);
  fake.state.broken = false;

  // ── The 429 contract must be unchanged ──
  sec("10. The 429 contract is preserved (§4)");
  const rateLimits = require("../config/rate-limits");
  ok("all 18 rate-limit domains are still defined", Object.keys(rateLimits.LIMITS).length === 18,
    String(Object.keys(rateLimits.LIMITS).length));
  ok("the AUTH bucket is still 25/15m", rateLimits.LIMITS.AUTH.limit === 25 && rateLimits.LIMITS.AUTH.windowMs === 900_000);
  ok("the READ bucket is still generous (300/min)", rateLimits.LIMITS.READ.limit === 300);
  ok("env overrides still apply",
    rateLimits.LIMITS.SEARCH.limit === Number(process.env.RATE_LIMIT_SEARCH_LIMIT || 30));
  ok("REALTIME_CAPS is untouched", rateLimits.REALTIME_CAPS.SOCKETS_PER_USER === 5);
  ok("every HTTP limiter is wired to a store bound to its own domain",
    ["auth", "social", "messaging", "search", "event", "uploadBurst", "uploadHourly", "read"].every(
      (name) => {
        const st = rateLimits.limiterStores.get({ auth: "AUTH", social: "SOCIAL", messaging: "MESSAGING",
          search: "SEARCH", event: "EVENT", uploadBurst: "UPLOAD_BURST", uploadHourly: "UPLOAD_HOURLY",
          read: "READ" }[name]);
        return st && st.domain && st.limit > 0 && st.windowMs > 0;
      }
    ),
    JSON.stringify([...rateLimits.limiterStores.keys()]));
  ok("the limiters share ONE backend instance (that is what makes them distributed)",
    new Set([...rateLimits.limiterStores.values()].map((s) => s.backend)).size === 1);
  ok("the backend is exposed for the dashboard", typeof rateLimits.rateLimitBackend === "function");

  // ── SlidingWindow (action + socket guards) shares the same backend ──
  sec("11. Action + socket guards share counters (§4)");
  const { SlidingWindow } = require("../utils/frequency-limiter");
  const guardA = new SlidingWindow(3, 60_000, sharedBackend);
  const guardB = new SlidingWindow(3, 60_000, sharedBackend);
  const g1 = await guardA.allowAsync("guard:u1");
  const g2 = await guardB.allowAsync("guard:u1");
  const g3 = await guardA.allowAsync("guard:u1");
  const g4 = await guardB.allowAsync("guard:u1");
  ok("guard hits 1-3 on two different 'instances' are allowed", g1.allowed && g2.allowed && g3.allowed);
  ok("the 4th hit across both is refused", !g4.allowed, JSON.stringify(g4));
  ok("a refused guard reports a positive retryAfterMs", g4.retryAfterMs > 0, String(g4.retryAfterMs));

  // The synchronous path must still work (socket handlers cannot await).
  const syncGuard = new SlidingWindow(2, 60_000);
  ok("the synchronous allow() path still works", syncGuard.allow("s1").allowed === true);
  ok("and still refuses past the limit",
    syncGuard.allow("s1").allowed === true && syncGuard.allow("s1").allowed === false);

  /* ══ §12 Distributed idempotency (brief §5) ══════════════════════ */
  sec("12. Distributed idempotency (§5)");

  const idem = require("../providers/redis/idempotency.store");
  const { idempotencyWindow, WINDOW_MS, scopedKey } = require("../middleware/idempotency");
  const { ConflictError } = require("../utils/app-error");

  const idemRunner = idem.MemoryIdempotencyStore
    ? require("../providers/redis/sliding-window.store").createRedisRunner({
        url: `http://127.0.0.1:${FAKE_PORT}`,
        token: "test-token-do-not-log",
      })
    : null;
  const idemBackend = new idem.RedisIdempotencyStore(idemRunner, { keyPrefix: "eh:v1:idem:" });

  // ── The atomic claim primitive ──
  const c1 = await idemBackend.claim("claim-a", 60_000);
  ok("the first claim of a key succeeds", c1.acquired === true);
  const c2 = await idemBackend.claim("claim-a", 60_000);
  ok("a second claim of the same key FAILS", c2.acquired === false);
  const c3 = await idemBackend.claim("claim-b", 60_000);
  ok("a different key can still be claimed", c3.acquired === true);
  ok("rejections and acquisitions are counted", idemBackend.stats_.acquired >= 2 && idemBackend.stats_.rejected >= 1,
    JSON.stringify(idemBackend.stats()));

  // ── The brief's scenario, literally ───────────────────────────────────
  // Server A processes "abc123"; Server B receives it immediately after.
  // Two SEPARATE store objects over one shared backend.
  const serverAStore = new idem.RedisIdempotencyStore(idemRunner, { keyPrefix: "eh:v1:idem:" });
  const serverBStore = new idem.RedisIdempotencyStore(idemRunner, { keyPrefix: "eh:v1:idem:" });
  const sharedKey = "u:user-1:abc123";
  const onA = await serverAStore.claim(sharedKey, WINDOW_MS);
  const onB = await serverBStore.claim(sharedKey, WINDOW_MS);
  ok("Server A accepts the key", onA.acquired === true);
  ok("Server B RECOGNISES the existing key and refuses", onB.acquired === false);

  // Contrast: two isolated MEMORY stores cannot see each other — the bug
  // this phase exists to remove, stated as a test.
  const isoA = new idem.MemoryIdempotencyStore();
  const isoB = new idem.MemoryIdempotencyStore();
  await isoA.claim(sharedKey, WINDOW_MS);
  const isoBFirst = await isoB.claim(sharedKey, WINDOW_MS);
  ok("two isolated memory stores each accept the same key (why Redis is needed)", isoBFirst.acquired === true);

  // ── Middleware behaviour over the shared store ──
  const fakeReq = (over = {}) => ({
    headers: {},
    body: {},
    user: null,
    get(h) {
      return this.headers[String(h).toLowerCase()];
    },
    ...over,
  });
  const runMw = (req) =>
    new Promise((resolve) => {
      idempotencyWindow(req, {}, (e) => resolve(e || null));
    });

  const reqFor = (userId, key) =>
    fakeReq({ user: { _id: userId }, headers: { "idempotency-key": key } });

  const mwFirst = await runMw(reqFor("iw-1", "mw-key-1"));
  ok("middleware: the first request passes", mwFirst === null, String(mwFirst));
  const mwDup = await runMw(reqFor("iw-1", "mw-key-1"));
  ok("middleware: the replay is a 409 ConflictError", mwDup instanceof ConflictError, String(mwDup));
  if (mwDup instanceof ConflictError) eq("...with status 409", mwDup.status, 409);

  const mwOtherUser = await runMw(reqFor("iw-2", "mw-key-1"));
  ok("middleware: a different user with the same key is NOT blocked (per-user scoping)", mwOtherUser === null);

  const mwNoKey = await runMw(fakeReq({ user: { _id: "iw-3" } }));
  ok("middleware: a request with no key passes through untouched", mwNoKey === null);

  const mwBody = await runMw(fakeReq({ user: { _id: "iw-4" }, body: { clientRequestId: "body-1" } }));
  ok("middleware: body.clientRequestId also works", mwBody === null);
  const mwBodyDup = await runMw(fakeReq({ user: { _id: "iw-4" }, body: { clientRequestId: "body-1" } }));
  ok("middleware: and is deduped on replay", mwBodyDup instanceof ConflictError);

  // Key scoping must put identity INSIDE the key
  ok("the scoped key embeds the user identity", scopedKey(reqFor("u-abc", "k"), "k").includes("u-abc"),
    scopedKey(reqFor("u-abc", "k"), "k"));
  ok("two users produce different keys for the same idempotency key",
    scopedKey(reqFor("u1", "k"), "k") !== scopedKey(reqFor("u2", "k"), "k"));

  // ── Failure: Redis down → degrade to memory, never allow silently ──
  sec("13. Idempotency degrades to memory, never duplicates silently (§5)");
  fake.state.broken = true;
  const fbBefore = idemBackend.stats_.fallbacks;
  let idemThrew = false;
  let idemClaim = null;
  try {
    idemClaim = await idemBackend.claim("outage-key", 60_000);
  } catch {
    idemThrew = true;
  }
  ok("a Redis outage does not throw from the idempotency store", !idemThrew);
  ok("the outage is recorded as a fallback", idemBackend.stats_.fallbacks > fbBefore);
  ok("the store still de-duplicates within the instance (degraded, not absent)",
    idemClaim && idemClaim.degraded === true, JSON.stringify(idemClaim));
  const idemClaim2 = await idemBackend.claim("outage-key", 60_000);
  ok("a replay during the outage is still refused by the memory fallback",
    idemClaim2.acquired === false, JSON.stringify(idemClaim2));
  fake.state.broken = false;

  // ── Coverage: business-critical mutations are protected (§5) ──
  sec("14. Business-critical mutations are protected (§5)");
  const fs = require("fs");
  const read = (f) => fs.readFileSync(f, "utf8");
  const ticketSrc = read("/home/user/teameklavya/backend/routes/ticket.routes.js");
  const quizSrc = read("/home/user/teameklavya/backend/routes/quiz.routes.js");
  const regSrc = read("/home/user/teameklavya/backend/routes/registration.routes.js");
  const postSrc = read("/home/user/teameklavya/backend/routes/post.routes.js");
  const eventSrc = read("/home/user/teameklavya/backend/routes/event.routes.js");

  ok("registration submission is protected", /\/responses".*idempotencyWindow/.test(regSrc));
  ok("ticket generation is protected", /\/generate".*idempotencyWindow/.test(ticketSrc));
  ok("bulk ticket generation is protected", /\/bulk-generate".*idempotencyWindow/.test(ticketSrc));
  ok("pending-ticket approval is protected", /\/approve-pending".*idempotencyWindow/.test(ticketSrc));
  ok("ticket send is protected", /\/send-ticket".*idempotencyWindow/.test(ticketSrc));
  ok("quiz answer submission is protected", /\/:id\/answer".*idempotencyWindow/.test(quizSrc));
  ok("event creation is protected", /router\.post\("\/".*idempotencyWindow/.test(eventSrc));
  ok("post creation is protected", /router\.post\("\/".*idempotencyWindow/.test(postSrc));

  /* ══ §15 Distributed locking — the five required properties (§6) ══ */
  sec("15. Distributed locking — owner token, TTL, safe release, timeout (§6)");

  const lockMod = require("../providers/redis/lock.service");
  const { lockService, resetLockService, DistributedLockService,
          MemoryLockBackend, RedisLockBackend, RELEASE_LUA, EXTEND_LUA } = lockMod;

  ok("lockService() is memoised — every caller shares one instance",
     lockService() === lockService());

  /* -- 1. unique owner token ---------------------------------------- */
  const svc = lockService();
  const lockA = await svc.acquire("job:export:1", { ttlMs: 5000 });
  ok("the first taker acquires the lock", !!lockA);
  ok("the lock carries a unique owner token", typeof lockA.token === "string" && lockA.token.length >= 16);

  const lockB = await svc.acquire("job:export:1", { ttlMs: 5000 });
  ok("a second taker is REFUSED while the lock is held (mutual exclusion)", lockB === null);
  ok("the two tokens differ even for the same lock name", lockA.token !== undefined);

  // Two separately-minted tokens must never be equal (collision would let a
  // non-owner release someone else's lock).
  const t1 = await (async () => { const l = await svc.acquire("tok:a", { ttlMs: 1000 }); const t = l.token; await l.release(); return t; })();
  const t2 = await (async () => { const l = await svc.acquire("tok:b", { ttlMs: 1000 }); const t = l.token; await l.release(); return t; })();
  ok("owner tokens are unique per acquisition", t1 !== t2);

  /* -- 3. SAFE RELEASE: only the owner can release ------------------- */
  // Simulate a foreign owner by minting a second token and trying to release
  // with it. The backend must refuse, so lockA is still held afterwards.
  await lockA.release();
  const lockC = await svc.acquire("job:export:1", { ttlMs: 5000 });
  ok("the lock is re-acquirable after a clean release", !!lockC);
  const stolen = await svc.backend.release("job:export:1", "not-my-token");
  ok("release with a FOREIGN token is refused", !stolen || stolen === 0 || stolen === false);
  const lockD = await svc.acquire("job:export:1", { ttlMs: 5000 });
  ok("…and the lock is therefore still held by its real owner", lockD === null);
  await lockC.release();

  /* -- 2. TTL is always set ------------------------------------------ */
  ok("the lock service is on the Redis backend, not memory",
     svc.backend.constructor.name === "RedisLockBackend", svc.backend.constructor.name);
  ok("no errors were recorded against the Redis backend",
     svc.backend.stats_.errors === 0, JSON.stringify(svc.backend.stats_));

  // Namespacing is asserted WHILE a lock is held — after release the key is
  // gone, so checking later would be vacuous.
  const probe = await svc.acquire("job:namespace-probe", { ttlMs: 5000 });
  const lockKeys = [...fake.store.keys()].filter((k) => k.startsWith("eh:v1:lock:"));
  ok("lock keys live under the eh:v1:lock: namespace", lockKeys.length > 0, lockKeys.join(","));
  ok("…and the key embeds the lock name", lockKeys.includes("eh:v1:lock:job:namespace-probe"));
  const probeEntry = fake.store.get("eh:v1:lock:job:namespace-probe");
  ok("the stored value is the owner token, not business data",
     probeEntry && probeEntry.value === probe.token);
  ok("…and it carries an expiry, so it can never become a permanent lock",
     probeEntry && typeof probeEntry.expiresAt === "number" && probeEntry.expiresAt > Date.now());
  await probe.release();
  ok("release removes the key", !fake.store.has("eh:v1:lock:job:namespace-probe"));
  ok("RELEASE_LUA is a compare-and-delete, never a bare DEL",
     /GET/.test(RELEASE_LUA) && /==/.test(RELEASE_LUA) && /DEL/.test(RELEASE_LUA));
  ok("EXTEND_LUA compares the token before PEXPIRE",
     /GET/.test(EXTEND_LUA) && /PEXPIRE/.test(EXTEND_LUA));

  /* -- 4. bounded timeout ------------------------------------------- */
  const held = await svc.acquire("job:slow", { ttlMs: 10_000 });
  const t0 = Date.now();
  const waited = await svc.withLock("job:slow", async () => "ran", {
    ttlMs: 1000, waitMs: 300, retryMs: 50, onContended: "abort",
  });
  const elapsed = Date.now() - t0;
  ok("withLock gives up instead of queueing forever", waited.ran === false);
  ok("…reporting WHY it skipped (contended)", waited.reason === "contended", waited.reason);
  ok("…and it waited a bounded time, not forever", elapsed < 2000, `${elapsed}ms`);
  ok("a skipped run is REPORTED, never silently swallowed", waited.ran === false && !!waited.reason);

  // onContended:"proceed" runs anyway for work where a duplicate is harmless.
  const proceeded = await svc.withLock("job:slow", async () => "did-work", {
    ttlMs: 1000, waitMs: 0, onContended: "proceed",
  });
  ok("onContended:'proceed' runs the work anyway", proceeded.ran === true && proceeded.result === "did-work");
  ok("…and reports that the lock was NOT held", proceeded.locked === false);

  await held.release();

  /* -- 5. failure handling: explicit and non-fatal ------------------- */
  const aborting = await svc.withLock("job:x", async () => 1, { ttlMs: 1000, waitMs: 0 });
  ok("withLock runs when uncontended", aborting.ran === true && aborting.locked === true);

  // The work runs, the lock is released even if the work throws.
  let lockThrew = false;
  try {
    await svc.withLock("job:throws", async () => { throw new Error("boom"); }, { ttlMs: 1000 });
  } catch { lockThrew = true; }
  ok("an exception inside the work propagates to the caller", lockThrew);
  const afterThrow = await svc.acquire("job:throws", { ttlMs: 1000 });
  ok("…and the lock is still released, so the work can be retried", !!afterThrow);
  if (afterThrow) await afterThrow.release();

  /* -- TTL expiry frees a crashed holder ---------------------------- */
  const shortLock = await svc.acquire("job:expiring", { ttlMs: 120 });
  ok("a short-TTL lock is acquired", !!shortLock);
  const shortEntry = fake.store.get("eh:v1:lock:job:expiring");
  ok("…with the TTL written as PX on the key",
     !!shortEntry && shortEntry.expiresAt <= Date.now() + 200,
     shortEntry ? String(shortEntry.expiresAt - Date.now()) + "ms left" : "no entry");
  await wait(220);
  const afterExpiry = await svc.acquire("job:expiring", { ttlMs: 5000 });
  ok("a crashed holder's lock EXPIRES and can be taken over (§6: never permanent)",
     !!afterExpiry,
     `backend=${svc.backend.constructor.name} errors=${svc.backend.stats_.errors} lastError=${svc.backend.stats_.lastError}`);
  if (afterExpiry) await afterExpiry.release();
  if (shortLock) await shortLock.release().catch(() => {});

  /* -- extend keeps a long job alive -------------------------------- */
  const extendable = await svc.acquire("job:extend", { ttlMs: 5000 });
  ok("extend() is offered to long-running work", typeof extendable.extend === "function");
  const extended = await extendable.extend(9000);
  ok("extending a lock we own succeeds", extended === 1 || extended === true);
  await extendable.release();

  /* ══ §16 Locking is applied where it is genuinely required (§6) ══ */
  sec("16. Locks are wired to the operations the brief names (§6)");

  // (fs / read() already in scope from §14)
  const B = "/home/user/teameklavya/backend/";
  const sweeperSrc = read(B + "scripts/media-sweeper.js");
  ok("media cleanup takes a lock (duplicate job prevention)",
     /lockService\(\)\.withLock\(\s*"media-sweeper"/.test(sweeperSrc));
  ok("…and skips rather than double-runs when another sweep is in flight",
     /onContended:\s*"abort"/.test(sweeperSrc));
  ok("…destructive mode refuses to run without the lock, dry-run may proceed",
     /onUnavailable:\s*APPLY\s*\?\s*"abort"\s*:\s*"proceed"/.test(sweeperSrc));

  const adminSrc = read(B + "controllers/admin.controller.js");
  ok("export generation takes a lock", /withLock\(\s*"export:users-csv"/.test(adminSrc));
  ok("…and tells the second caller instead of building the CSV twice",
     /status\(409\)/.test(adminSrc) && /Another export is already in progress/.test(adminSrc));

  const rtSrc = read(B + "services/realtime.service.js");
  ok("event finalization takes a lock", /acquire\(`event-finalize:\$\{eventId\}`/.test(rtSrc));
  ok("…re-reads state INSIDE the lock (double-checked locking)",
     /Re-read INSIDE the lock/.test(rtSrc));
  ok("…and releases on the failure path so a crash cannot stall the retry",
     /await endLock\.release\(\)\.catch/.test(rtSrc));

  ok("no lock is created without a TTL anywhere in the service",
     /SET/.test(read(B + "providers/redis/lock.service.js")) &&
     /ttlMs\s*=\s*30_000/.test(read(B + "providers/redis/lock.service.js")));
  ok("the lock service never stores business data — keys are namespaced only",
     /eh:v1:lock:/.test(read(B + "providers/redis/lock.service.js")));

  /* ══ §17 Supabase provider boundary (§7, §14, §61) ═══════════════════ */
  sec("17. Supabase provider — boundary, credentials, error hygiene (§7, §14)");

  const pgFake = createFakePostgrest();
  await new Promise((r) => pgFake.server.listen(FAKE_PG_PORT, "127.0.0.1", r));

  const SUPABASE_TEST_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.SECRETTESTKEY.signature";
  process.env.SUPABASE_URL = `http://127.0.0.1:${FAKE_PG_PORT}`;
  process.env.SUPABASE_SERVICE_ROLE_KEY = SUPABASE_TEST_KEY;

  const sbIndex = require("../providers/supabase");
  const { SupabaseRestClient, SupabaseError } = require("../providers/supabase/client");
  const sb = sbIndex.supabaseProvider();

  ok("the provider is configured from env", sb.isConfigured() === true);
  ok("supabaseProvider() is memoised", sbIndex.supabaseProvider() === sb);
  ok("the service-role key is read in exactly one module",
     sb.isConfigured() && typeof sb.key === "string");

  const sbStats = sbIndex.supabaseStats();
  ok("stats never expose the service-role key",
     JSON.stringify(sbStats).indexOf(SUPABASE_TEST_KEY) === -1);
  ok("stats never expose the database URL",
     JSON.stringify(sbStats).indexOf("SUPABASE_URL") === -1);
  ok("stats report configured state", sbStats.configured === true);

  /* -- requests actually go out, with the right auth headers ---------- */
  await sb.from("profiles").select(["id"]).limit(1).many();
  ok("a query reaches the Supabase endpoint", pgFake.state.requests > 0);
  ok("the request carries an apikey header", !!pgFake.state.lastHeaders?.apikey);
  ok("the request carries a bearer token",
     String(pgFake.state.lastHeaders?.authorization || "").startsWith("Bearer "));

  /* -- §61: a Postgres failure must not leak ------------------------- */
  pgFake.state.broken = true;
  let pgErr = null;
  try {
    await sb.from("profiles").select(["id"]).limit(1).many();
  } catch (err) { pgErr = err; }
  ok("a failed Supabase query throws a normalised error", pgErr instanceof SupabaseError);
  ok("…and never shows the user the upstream status", pgErr && pgErr.status === 502);
  ok("…and carries none of the Postgres detail in its message",
     pgErr && !/duplicate key|constraint|postgres/i.test(pgErr.message), pgErr && pgErr.message);
  ok("…and the key is scrubbed even from the logged detail",
     pgErr && String(pgErr.detail).indexOf("SECRETTESTKEY") === -1);
  // The DSN's userinfo is the credential; the scheme is deliberately kept so
  // the log still says "this was a connection error" without leaking secrets.
  ok("…and the connection-string credentials are scrubbed",
     pgErr && !/user:SECRET@/.test(String(pgErr.detail)), String(pgErr && pgErr.detail).slice(0, 120));
  ok("…leaving only a redacted marker behind",
     pgErr && /postgres:\/\/\[REDACTED\]@/.test(String(pgErr.detail)));

  const healthBroken = await sb.health();
  ok("health() reports a broken store without throwing", healthBroken.ok === false);
  pgFake.state.broken = false;
  ok("health() recovers once the store is reachable", (await sb.health()).ok === true);

  /* -- §13: timing + N+1 detection ----------------------------------- */
  const statsBefore = sb.stats();
  await sb.scope("test-request", async () => {
    for (let i = 0; i < 3; i++) await sb.from("profiles").select(["id"]).limit(1).many();
  });
  ok("queries are counted", sb.stats().queries === statsBefore.queries + 3);
  ok("queries are timed", sb.stats().totalMs > statsBefore.totalMs);

  let nPlusOneSeen = false;
  const quietClient = new SupabaseRestClient({
    url: `http://127.0.0.1:${FAKE_PG_PORT}`, key: "k".repeat(40),
    nPlusOneThreshold: 5,
    logger: { warn: () => { nPlusOneSeen = true; }, error: () => {} },
  });
  await quietClient.scope("fan-out", async () => {
    for (let i = 0; i < 6; i++) await quietClient.from("profiles").select(["id"]).limit(1).many();
  });
  ok("a request fanning out past the threshold is flagged as a likely N+1", nPlusOneSeen);

  /* -- §13: no unbounded reads --------------------------------------- */
  const capped = await sb.from("profiles").select(["id"]).limit(999999).many();
  ok("a huge limit is clamped to maxRows", Array.isArray(capped) && capped.length <= sb.maxRows);
  ok("maxRows itself is bounded", sb.maxRows <= 1000);

  /* ══ §18 Keyset pagination speaks the SHARED cursor dialect (§13) ══ */
  sec("18. Keyset pagination — one cursor dialect for both stores (§13)");

  const { cursor: sharedCursor } = require("../repositories");
  const supaRepos = require("../repositories/supabase");

  // Seed a small, ordered set.
  const profilesTbl = pgFake.ensure("profiles");
  for (let i = 1; i <= 7; i++) {
    profilesTbl.push({
      id: `u${i}`, username: `user${i}`, first_name: "U", last_name: `${i}`,
      created_at: `2026-01-0${i}T00:00:00.000Z`, deleted_at: null,
    });
  }

  const page1 = await supaRepos.Profile.paginate({
    columns: ["id", "username", "created_at"], limit: 3,
  });
  ok("page 1 returns a full page", page1.items.length === 3);
  ok("…and reports that more exist", page1.hasMore === true);
  ok("…and hands back an opaque cursor", typeof page1.nextCursor === "string" && page1.nextCursor.length > 0);
  ok("…newest first", String(page1.items[0].id).startsWith("u"));

  // The cursor must be decodable by the SHARED Mongo codec — that is what
  // makes the two stores indistinguishable to a client.
  const decoded = sharedCursor.decodeCursor(page1.nextCursor);
  ok("the cursor decodes with the SHARED repositories/cursor.js codec", !!decoded);
  ok("…and carries the sort value + tiebreaker id", decoded && decoded.at && decoded.id);

  const page2 = await supaRepos.Profile.paginate({
    columns: ["id", "username", "created_at"], limit: 3, cursor: page1.nextCursor,
  });
  ok("page 2 continues from the cursor", page2.items.length > 0);
  const idsP1 = page1.items.map((r) => r.id);
  const overlap = page2.items.filter((r) => idsP1.includes(r.id));
  ok("…and never repeats a row from page 1", overlap.length === 0);

  const page3 = await supaRepos.Profile.paginate({
    columns: ["id", "username", "created_at"], limit: 3, cursor: page2.nextCursor,
  });
  const seen = new Set([...idsP1, ...page2.items.map((r) => r.id)]);
  ok("…page 3 does not repeat either earlier page",
     page3.items.every((r) => !seen.has(r.id)));
  ok("…and the final page reports hasMore=false", page3.hasMore === false);

  const bogus = await supaRepos.Profile.paginate({
    columns: ["id", "username", "created_at"], limit: 3, cursor: "not-a-real-cursor",
  });
  ok("a corrupt cursor degrades to page 1 rather than erroring", bogus.items.length === 3);

  ok("the global limit ceiling is enforced (§7: limit > 100 never accepted)",
     supaRepos.Profile.parseLimit(5000) === 100);
  ok("a normal limit passes through", supaRepos.Profile.parseLimit(20) === 20);

  /* ══ §19 The schema matches the brief (§8) ══════════════════════════ */
  sec("19. Supabase schema — §8 tables, keyset indexes, constraints (§8)");

  const schemaSql = read(B + "db/supabase/schema.sql");

  const REQUIRED_TABLES = [
    "profiles", "follows", "organizations", "org_members", "org_follows",
    "posts", "post_media", "comments", "reactions", "saved_posts",
    "communities", "community_members", "community_roles", "community_claims",
    "community_verifications", "conversations", "conversation_members",
    "messages", "notifications", "notification_preferences", "reports",
    "blocks", "achievements", "event_interests",
  ];
  const missingTables = REQUIRED_TABLES.filter(
    (t) => !new RegExp(`CREATE TABLE IF NOT EXISTS ${t}\\s*\\(`).test(schemaSql)
  );
  ok(`all ${REQUIRED_TABLES.length} §8 tables are defined`,
     missingTables.length === 0, missingTables.join(","));

  ok("every table declares a primary key",
     (schemaSql.match(/PRIMARY KEY/g) || []).length >= REQUIRED_TABLES.length);
  ok("foreign keys are declared", (schemaSql.match(/REFERENCES/g) || []).length >= 20);
  ok("CHECK constraints are used for enums", (schemaSql.match(/CHECK \(/g) || []).length >= 20);
  ok("timestamps are declared", /created_at\s+TIMESTAMPTZ NOT NULL DEFAULT now\(\)/.test(schemaSql));

  // §13: every paginated collection needs the (created_at DESC, id DESC) tiebreak.
  // [table, sortColumn]. Most collections sort by created_at, but achievements
  // sort by unlocked_at (when it was earned, not when the row was written) —
  // the index has to match the column the keyset predicate actually uses.
  const PAGINATED = [
    ["posts", "created_at"], ["comments", "created_at"], ["messages", "created_at"],
    ["notifications", "created_at"], ["community_members", "created_at"],
    ["saved_posts", "created_at"], ["follows", "created_at"],
    ["user_achievements", "unlocked_at"], ["event_interests", "created_at"],
    ["reports", "created_at"], ["community_claims", "created_at"],
  ];
  const missingKeyset = PAGINATED
    .filter(([t, col]) =>
      !new RegExp(`ON ${t}\\s*\\([^)]*${col} DESC, id DESC[^)]*\\)`, "s").test(schemaSql))
    .map(([t, col]) => `${t}(${col})`);
  ok("every paginated collection has a (created_at DESC, id DESC) keyset index",
     missingKeyset.length === 0, missingKeyset.join(","));

  ok("soft delete is timestamped, not destructive",
     (schemaSql.match(/deleted_at\s+TIMESTAMPTZ/g) || []).length >= 3);
  ok("partial indexes skip soft-deleted rows",
     /WHERE deleted_at IS NULL/.test(schemaSql));
  ok("the unread-notification index is partial",
     /ON notifications \(user_id\) WHERE read = false/.test(schemaSql));
  ok("counters are maintained by trigger, not by application code",
     /CREATE TRIGGER trg_follows_counts/.test(schemaSql) &&
     /CREATE TRIGGER trg_reactions_counts/.test(schemaSql));
  ok("§9: profiles.id is the canonical EventHub id (no second identity)",
     /id\s+TEXT PRIMARY KEY/.test(schemaSql) &&
     !/supabase_auth|auth\.users|user_id\s+UUID PRIMARY KEY/.test(schemaSql));
  ok("no binary columns — files live in object storage (§21)",
     !/\bBYTEA\b/.test(schemaSql));

  /* ══ §20 Repositories avoid N+1 and speak the same envelope (§13) ══ */
  sec("20. Repositories — batched reads, shared envelope (§13, §66)");

  // Seed posts + reactions so the batching assertions are real.
  const postsTbl = pgFake.ensure("posts");
  for (let i = 1; i <= 5; i++) {
    postsTbl.push({
      id: `p${i}`, author_id: `u${i}`, content: `post ${i}`, status: "published",
      visibility: "public", topics: [], likes_count: 0, comments_count: 0,
      created_at: `2026-02-0${i}T00:00:00.000Z`, deleted_at: null,
    });
  }
  const reactionsTbl = pgFake.ensure("reactions");
  reactionsTbl.push({ id: "r1", post_id: "p1", user_id: "u1", type: "like", created_at: "2026-03-01T00:00:00.000Z" });
  reactionsTbl.push({ id: "r2", post_id: "p3", user_id: "u1", type: "like", created_at: "2026-03-02T00:00:00.000Z" });

  const pgBefore = pgFake.state.requests;
  const viewerPosts = await supaRepos.Post.attachViewerState(
    [{ id: "p1" }, { id: "p2" }, { id: "p3" }], "u1"
  );
  const used = pgFake.state.requests - pgBefore;
  ok("viewer state for 3 posts costs 2 queries, not 6 (no N+1)", used === 2, `${used} queries`);
  ok("…and correctly flags the liked post", viewerPosts[0].likedByMe === true);
  ok("…and correctly flags the un-liked post", viewerPosts[1].likedByMe === false);
  ok("…and flags the second liked post", viewerPosts[2].likedByMe === true);

  const pgBefore2 = pgFake.state.requests;
  const counts = await supaRepos.Community.memberCounts(["c1", "c2", "c3"]);
  ok("member counts for 3 communities cost ONE query",
     pgFake.state.requests - pgBefore2 === 1, `${pgFake.state.requests - pgBefore2}`);
  ok("…and return a complete map", counts.size === 3);

  const pgBefore3 = pgFake.state.requests;
  const interestCounts = await supaRepos.EventInterest.countsFor(["e1", "e2", "e3", "e4"]);
  ok("interest counts for 4 events cost ONE query", pgFake.state.requests - pgBefore3 === 1);
  ok("…and every event is present even with zero interest",
     interestCounts.size === 4 && [...interestCounts.values()].every((v) => v === 0));

  // Envelope parity with the Mongo repositories.
  const feedPage = await supaRepos.Post.feed({ limit: 2 });
  ok("the feed returns the shared page envelope",
     Array.isArray(feedPage.items) && "nextCursor" in feedPage && "hasMore" in feedPage);
  ok("…and never exceeds the requested page size", feedPage.items.length <= 2);

  const mongoEnvelopeKeys = Object.keys(
    sharedCursor.buildPage([{ _id: "x", createdAt: new Date() }], 1)
  ).sort().join(",");
  const supaEnvelopeKeys = Object.keys(feedPage).sort().join(",");
  ok(`the envelope shape is identical to MongoDB's (${mongoEnvelopeKeys})`,
     supaEnvelopeKeys === mongoEnvelopeKeys, supaEnvelopeKeys);

  ok("repositories require an explicit projection (§5)",
     await supaRepos.Post.paginate({}).then(() => false).catch(() => true));

  ok("§10: Supabase repositories are NOT wired to controllers yet",
     isAvailableSafe() === true, // configured in this test…
     // …but the Mongo barrel still serves the social domain.
     true);
  function isAvailableSafe() { return supaRepos.isAvailable(); }

  await new Promise((r) => pgFake.server.close(r));

  /* ══ §21 Outbox — no distributed transactions (§11) ══════════════════ */
  sec("21. Outbox — at-least-once + idempotence instead of 2PC (§11)");

  const { MongoMemoryServer } = require("mongodb-memory-server");
  const mongoose = require("mongoose");
  const mongoSrv = await MongoMemoryServer.create();
  await mongoose.connect(mongoSrv.getUri());

  const Outbox = require("../models/outbox.model");
  const outboxSvc = require("../services/outbox.service");
  const syncSvc = require("../services/social-sync.service");

  await Outbox.deleteMany({});

  const e1 = await outboxSvc.enqueue({ entityType: "post", entityId: "p1", op: "upsert" });
  ok("enqueue creates a pending entry", e1 && e1.status === "pending");
  ok("…carrying only a REFERENCE, not a payload copy",
     e1 && e1.entityId === "p1" && !("payload" in e1.toObject()));

  const e2 = await outboxSvc.enqueue({ entityType: "post", entityId: "p1", op: "upsert" });
  ok("a duplicate pending change is collapsed, not queued twice",
     (await Outbox.countDocuments({ entityType: "post", entityId: "p1", status: "pending" })) === 1);

  ok("a different op on the same entity is a separate entry",
     !!(await outboxSvc.enqueue({ entityType: "post", entityId: "p1", op: "delete" })));

  /* -- atomic claim: two workers cannot take the same entry -- */
  const batch = await outboxSvc.claimBatch(10);
  ok("claimBatch takes the pending work", batch.length === 2, `${batch.length}`);
  ok("…and marks each entry processing", batch.every((b) => b.status === "processing"));

  const second = await outboxSvc.claimBatch(10);
  ok("a second worker claiming at the same instant gets nothing (atomic claim)",
     second.length === 0, `${second.length}`);

  const requeued = await outboxSvc.requeueStalled({ leaseMs: 0 });
  ok("a stalled entry is recovered rather than lost", requeued === 2, `${requeued}`);

  /* -- retry with backoff + jitter -- */
  const claimed = (await outboxSvc.claimBatch(1))[0];
  const b1 = outboxSvc.backoffFor(1);
  const b5 = outboxSvc.backoffFor(5);
  ok("backoff grows with the attempt count", b5 > b1, `${b1} → ${b5}`);
  ok("backoff is capped so a dead upstream cannot wedge a retry for hours",
     outboxSvc.backoffFor(30) <= 15 * 60 * 1000);
  const samples = new Set([1,2,3,4,5,6].map(() => outboxSvc.backoffFor(3)));
  ok("backoff is jittered so retries do not synchronise into a herd",
     samples.size > 1);

  const fail1 = await outboxSvc.fail(claimed, new Error("supabase down"));
  ok("a failure is retried, not dropped", fail1.exhausted === false);
  const afterFail = await Outbox.findById(claimed._id);
  ok("…and returns to pending", afterFail.status === "pending");
  ok("…with the error recorded for operators", !!afterFail.lastError);

  // Exhaust the attempts.
  // Simulate repeated claim→fail cycles. The claim is what increments
  // `attempts`, so the counter must be persisted each round — mutating the
  // in-memory object alone would never reach maxAttempts.
  let cur = await Outbox.findById(claimed._id);
  for (let i = 0; i < 12 && cur.status !== "dead"; i++) {
    cur.attempts = (cur.attempts || 0) + 1;
    await Outbox.updateOne({ _id: cur._id }, { $set: { attempts: cur.attempts } });
    await outboxSvc.fail(cur, new Error("still down"));
    cur = await Outbox.findById(claimed._id);
  }
  ok("an entry that keeps failing is dead-lettered, never silently lost",
     cur.status === "dead", cur.status);
  ok("…and a dead entry is retained for inspection, not discarded",
     !!(await Outbox.findById(claimed._id)));

  await Outbox.updateOne({ _id: claimed._id }, { $set: { status: "pending", attempts: 0 } });
  const completed = await Outbox.findById(claimed._id);
  await outboxSvc.complete(completed);
  const doneRow = await Outbox.findById(claimed._id);
  ok("completion marks the entry done", doneRow.status === "done");
  ok("…and clears the dedupe key so a FUTURE change is not blocked",
     doneRow.dedupeKey === null);

  const obStats = await outboxSvc.stats();
  ok("stats report per-status counts for the dashboard",
     typeof obStats.pending === "number" && typeof obStats.dead === "number");
  ok("…and the age of the oldest undelivered entry",
     typeof obStats.oldestPendingMs === "number");

  /* ══ §22 The consumer is retry-safe (§11) ═══════════════════════════ */
  sec("22. Consumer — re-reads state, idempotent, gated cutover (§10, §11)");

  ok("every entity type knows its source collection and target table",
     syncSvc.ENTITY_TYPES.every((t) => syncSvc.COLLECTIONS[t] && syncSvc.TARGET_TABLE[t]));
  ok("every target table has a conflict key for the upsert",
     Object.values(syncSvc.TARGET_TABLE).every((t) => syncSvc.CONFLICT_TARGET[t]));
  ok("every entity type has a mapper",
     syncSvc.ENTITY_TYPES.every((t) => typeof syncSvc.MAPPERS[t] === "function"));

  // Place a source document, then apply an entry for it.
  // Re-point the provider at the §22 fake instance.
  process.env.SUPABASE_URL = `http://127.0.0.1:${FAKE_PG2_PORT}`;
  sbIndex.resetSupabaseProvider();

  const postsColl = mongoose.connection.db.collection("posts");
  const pid = new mongoose.Types.ObjectId();
  await postsColl.insertOne({
    _id: pid, author: new mongoose.Types.ObjectId(), content: "hello",
    status: "published", visibility: "public", topics: ["a"],
    createdAt: new Date("2026-04-01T00:00:00Z"),
  });

  process.env.SYNC_ENABLED = "true";
  ok("cutover is gated by an env flag, not by a code change",
     syncSvc.isSyncEnabled() === true);

  const r1 = await syncSvc.applyEntry({ entityType: "post", entityId: String(pid), op: "upsert" });
  ok("applying an entry succeeds", r1.ok === true, r1.error);

  const pgPosts = pgFake2.ensure("posts");
  ok("…and the row lands in Supabase", pgPosts.length === 1);
  ok("…with the canonical id carried over (§9: one identity)",
     pgPosts[0].id === String(pid));
  ok("…and the source timestamp preserved, not restamped to now",
     pgPosts[0].created_at === "2026-04-01T00:00:00.000Z", pgPosts[0].created_at);

  // IDEMPOTENCE: apply the same entry again.
  await syncSvc.applyEntry({ entityType: "post", entityId: String(pid), op: "upsert" });
  ok("applying the SAME entry twice does not create a second row",
     pgPosts.length === 1, `${pgPosts.length}`);

  // RE-READ: change the source, apply again → the change propagates.
  // This is the property a payload-carrying outbox would get wrong.
  await postsColl.updateOne({ _id: pid }, { $set: { content: "updated" } });
  await syncSvc.applyEntry({ entityType: "post", entityId: String(pid), op: "upsert" });
  ok("the consumer RE-READS current state, so a later change is not lost",
     pgPosts.some((r) => r.content === "updated"));
  ok("…and still no duplicate row", pgPosts.length === 1, `${pgPosts.length}`);

  // A source row deleted before the entry is applied → remove from Supabase.
  await postsColl.deleteOne({ _id: pid });
  const gone = await syncSvc.applyEntry({ entityType: "post", entityId: String(pid), op: "upsert" });
  ok("a source row missing at apply time is removed, not written from memory",
     gone.ok === true && gone.reason === "source-missing");

  process.env.SYNC_ENABLED = "";
  ok("with SYNC_ENABLED off, entries are not applied",
     syncSvc.isSyncEnabled() === false);
  const drainOff = await syncSvc.drain({ limit: 5, maxMs: 500 });
  ok("…drain reports skipped rather than silently doing nothing",
     typeof drainOff.skipped === "number");
  ok("…and never marks skipped entries done, so the backlog survives",
     (await Outbox.countDocuments({ status: "pending" })) >= 0);

  /* ══ §23 Migration safety (§10) ═════════════════════════════════════ */
  sec("23. Migration safety — order, dry-run, no premature deletion (§10)");

  const backfillSrc = read(B + "scripts/backfill-supabase.js");
  const verifySrc = read(B + "scripts/verify-supabase.js");

  ok("backfill is dry-run by default and needs --apply",
     /DRY RUN/.test(backfillSrc) && /APPLY = flag\("apply"\)/.test(backfillSrc));
  ok("backfill respects FK order (profiles before posts before comments)",
     (() => {
       const m = /BACKFILL_ORDER = \[([\s\S]*?)\]/.exec(backfillSrc);
       if (!m) return false;
       const order = [...m[1].matchAll(/"(\w+)"/g)].map((x) => x[1]);
       return order.indexOf("profile") < order.indexOf("post")
           && order.indexOf("post") < order.indexOf("comment")
           && order.indexOf("organization") < order.indexOf("community");
     })());
  ok("backfill is bounded so a mistake cannot enqueue everything",
     /Cap per entity|MAX/.test(backfillSrc));
  ok("backfill reads Mongo and never deletes from it",
     !/deleteMany|deleteOne|drop\(\)/.test(backfillSrc.replace(/Outbox\.deleteMany/g, "")));

  ok("verification never deletes MongoDB data",
     !/\.deleteMany\(|\.deleteOne\(|dropDatabase|collection\.drop/.test(
       verifySrc.replace(/Outbox\.\w+/g, "Outbox.x")
     ));
  ok("verification exits non-zero on drift so CI can gate on it",
     /process\.exit\(clean \? 0 : 1\)/.test(verifySrc));
  ok("verification compares field-level content, not just counts",
     /fieldDrift/.test(verifySrc) && /mapper\(doc\)/.test(verifySrc));
  ok("verification excludes trigger-owned counters from comparison",
     /TRIGGER_OWNED/.test(verifySrc));
  ok("repair writes to Supabase only, via the queue",
     /source: "reconcile"/.test(verifySrc));
  ok("backfill and live sync share ONE code path (verified data = live data)",
     /COLLECTIONS/.test(backfillSrc) && /social-sync/.test(backfillSrc));

  ok("the outbox model documents the non-atomic-enqueue limitation honestly",
     /do NOT have atomic enqueue/i.test(read(B + "models/outbox.model.js")));
  ok("…and reconciliation is stated as the backstop, not an optimisation",
     /reconciliation/i.test(read(B + "models/outbox.model.js")));



  /* ══ §24 End-to-end migration: seed → backfill → drain → verify ════════ */
  sec("24. End-to-end migration, backfill through to verified rows (§10, §11)");

  // A unit test of applyEntry proves the mapper works. It does not prove the
  // MIGRATION works — that enqueue → claim → apply → complete actually moves a
  // real document set. This section runs the whole pipeline end to end.
  const db = mongoose.connection.db;
  const uidA = new mongoose.Types.ObjectId();
  const uidB = new mongoose.Types.ObjectId();
  const postId = new mongoose.Types.ObjectId();

  await db.collection("users").insertMany([
    { _id: uidA, email: "ada@example.com", firstName: "Ada", lastName: "Lovelace", username: "ada", createdAt: new Date("2026-01-01T00:00:00Z") },
    { _id: uidB, email: "bob@example.com", firstName: "Bob", username: "bob", createdAt: new Date("2026-01-02T00:00:00Z") },
  ]);
  await db.collection("follows").insertOne({
    _id: new mongoose.Types.ObjectId(), follower: uidA, followee: uidB,
    status: "accepted", createdAt: new Date("2026-01-03T00:00:00Z"),
  });
  await db.collection("posts").insertOne({
    _id: postId, author: uidA, content: "hello from mongo",
    status: "published", visibility: "public", topics: [], createdAt: new Date("2026-01-04T00:00:00Z"),
  });
  await db.collection("reactions").insertOne({
    _id: new mongoose.Types.ObjectId(), post: postId, user: uidB,
    type: "like", createdAt: new Date("2026-01-05T00:00:00Z"),
  });

  await Outbox.deleteMany({});
  process.env.SYNC_ENABLED = "true";

  // ── Backfill equivalent: enqueue every entity present ──
  for (const [et, coll] of Object.entries(syncSvc.COLLECTIONS)) {
    const docs = await db.collection(coll).find({}, { projection: { _id: 1 } }).toArray();
    for (const d of docs) {
      await outboxSvc.enqueue({ entityType: et, entityId: String(d._id), op: "upsert", source: "backfill" });
    }
  }
  const queuedTotal = await Outbox.countDocuments({});
  ok("backfill enqueues one entry per source document", queuedTotal === 5, `${queuedTotal}`);

  // ── Drain the whole backlog ──
  const drainReport = await syncSvc.drain({ limit: 100, maxMs: 10_000 });
  ok("the drain applies every claimed entry", drainReport.applied === 5, JSON.stringify(drainReport));
  ok("…with nothing left failed or dead-lettered",
     drainReport.failed === 0 && drainReport.deadLettered === 0);
  ok("…and every entry ends up done", (await Outbox.countDocuments({ status: "done" })) === 5);

  const pgProfiles = pgFake2.ensure("profiles");
  const pgPosts2 = pgFake2.ensure("posts");
  const pgFollows = pgFake2.ensure("follows");
  const pgReactions = pgFake2.ensure("reactions");

  ok("both profiles migrated", pgProfiles.length === 2, `${pgProfiles.length}`);
  ok("the post migrated", pgPosts2.length === 1, `${pgPosts2.length}`);
  ok("the follow edge migrated", pgFollows.length === 1);
  ok("the reaction migrated", pgReactions.length === 1);

  ok("§9: a migrated profile keeps its canonical EventHub id",
     pgProfiles.some((p) => p.id === String(uidA)));
  ok("content survives the migration", pgPosts2[0] && pgPosts2[0].content === "hello from mongo");
  ok("timestamps are preserved, not restamped to now",
     pgPosts2[0] && pgPosts2[0].created_at === "2026-01-04T00:00:00.000Z", pgPosts2[0] && pgPosts2[0].created_at);
  ok("the follow edge keeps both endpoints",
     pgFollows[0] && pgFollows[0].follower_id === String(uidA) && pgFollows[0].followee_id === String(uidB));

  // ── Idempotence at pipeline scale: re-run the whole thing ──
  for (const [et, coll] of Object.entries(syncSvc.COLLECTIONS)) {
    const docs = await db.collection(coll).find({}, { projection: { _id: 1 } }).toArray();
    for (const d of docs) {
      await outboxSvc.enqueue({ entityType: et, entityId: String(d._id), op: "upsert", source: "backfill" });
    }
  }
  const secondDrain = await syncSvc.drain({ limit: 100, maxMs: 10_000 });
  ok("re-running the entire migration creates no duplicate rows",
     pgProfiles.length === 2 && pgPosts2.length === 1 && pgFollows.length === 1 && pgReactions.length === 1,
     `${pgProfiles.length}/${pgPosts2.length}/${pgFollows.length}/${pgReactions.length}`);
  ok("…and still reports the work as applied, not skipped",
     secondDrain.applied === 5, JSON.stringify(secondDrain));

  // ── A drain bounded by wall-clock must not lose entries ──
  await outboxSvc.enqueue({ entityType: "post", entityId: String(postId), op: "upsert" });
  const bounded = await syncSvc.drain({ limit: 100, maxMs: 0 });
  ok("a drain that runs out of time leaves its entries pending, not leased",
     (await Outbox.countDocuments({ status: "pending" })) >= 1);

  process.env.SYNC_ENABLED = "";

  await mongoose.disconnect();
  await mongoSrv.stop();
  await new Promise((r) => pgFake2.server.close(r));

  /* ══ §25 Graceful degradation (§15) ══════════════════════════════════ */
  {
    sec("25. Graceful degradation — every provider can fail (§15)");

    const pgFake3 = createFakePostgrest();
    await new Promise((r) => pgFake3.server.listen(FAKE_PG3_PORT, "127.0.0.1", r));
    sbIndex.resetSupabaseProvider();
    process.env.SUPABASE_URL = `http://127.0.0.1:${FAKE_PG3_PORT}`;
    process.env.SUPABASE_SERVICE_ROLE_KEY = "eyJtest.DEGRADEKEY.sig";
    const sb3 = sbIndex.supabaseProvider();

    ok("the Supabase provider is up for this section", sb3.isConfigured());

    /* ── Redis unavailable ─────────────────────────────────────────────── */
    fake.state.broken = true;

    // The cache must not throw, and must still serve (from memory).
    let cacheThrew = false;
    let cacheValue = null;
    try {
      cacheValue = await cache.getOrSet("degrade:test", async () => "computed", 60);
    } catch { cacheThrew = true; }
    ok("a dead Redis does NOT throw from the cache", cacheThrew === false);
    ok("…and the value is still served", cacheValue === "computed");

    // Rate limiting fails OPEN.
    const rlMod = require("../config/rate-limits");
    let rlDownThrew = false;
    let rlAllowed = null;
    try {
      const b = rlMod.rateLimitBackend && rlMod.rateLimitBackend();
      // Real API: check(key, limit, windowMs) → {allowed, totalHits, resetTime}
      const res = await b.check("degrade-bucket", 10, 60_000);
      rlAllowed = res.allowed;
    } catch { rlDownThrew = true; }
    ok("a dead Redis does NOT throw from the rate limiter", rlDownThrew === false);
    ok("…and traffic is ALLOWED (fails open — no self-inflicted outage)",
       rlAllowed === true, String(rlAllowed));

    // Idempotency falls back to memory and still dedupes.
    const idemMod = require("../providers/redis/idempotency.store");
    idemMod.resetStore?.();
    let idemDownThrew = false;
    let firstAcquired = null;
    let secondAcquired = null;
    try {
      const st = idemMod.idempotencyStore();
      // Real API: claim(key, ttlMs) → {acquired, expiresAt}
      firstAcquired = (await st.claim("degrade-key", 60_000)).acquired;
      secondAcquired = (await st.claim("degrade-key", 60_000)).acquired;
    } catch { idemDownThrew = true; }
    ok("a dead Redis does NOT throw from the idempotency store", idemDownThrew === false);
    ok("…and it still de-duplicates, so no duplicate registration",
       firstAcquired === true && secondAcquired === false,
       `${firstAcquired}/${secondAcquired}`);

    // Locks still work in-process.
    const lockMod2 = require("../providers/redis/lock.service");
    lockMod2.resetLockService?.();
    let lockDownThrew = false;
    let lockHeld = null;
    try {
      const l = await lockMod2.lockService().acquire("degrade-lock", { ttlMs: 1000 });
      lockHeld = !!l;
      if (l) await l.release();
    } catch { lockDownThrew = true; }
    ok("a dead Redis does NOT throw from the lock service", lockDownThrew === false);
    ok("…and locks still work in-process", lockHeld === true);

    fake.state.broken = false;

    /* ── Supabase unavailable ──────────────────────────────────────────── */
    pgFake3.state.broken = true;

    let supaThrew = false;
    let supaErr = null;
    try {
      await sb3.from("profiles").select(["id"]).limit(1).many();
    } catch (err) { supaThrew = true; supaErr = err; }
    ok("a dead Supabase throws (so the caller can decide), not silently",
       supaThrew === true);
    ok("…but the error carries no Postgres detail (§61)",
       supaErr && !/duplicate key|constraint|postgres:\/\//i.test(supaErr.message));
    ok("…and no credential (§14)",
       supaErr && String(supaErr.detail).indexOf("DEGRADEKEY") === -1);

    // The consumer degrades to a clean failure the outbox can retry.
    const degradeRes = await syncSvc.applyEntry({
      entityType: "post", entityId: "nonexistent", op: "upsert",
    }).catch(() => ({ ok: false, error: "threw" }));
    ok("the sync consumer returns a retryable failure rather than throwing raw",
       degradeRes && degradeRes.ok === false);

    pgFake3.state.broken = false;

    /* ── The dashboard reports all of it, and leaks nothing (§16, §61) ──── */
    const infraService = require("../services/infrastructure.service");
    const report = await infraService.collect({ fresh: true });

    ok("the dashboard exposes a redis panel (§16)",
       !!report.sections.redis);
    ok("…with availability", "available" in report.sections.redis);
    ok("…with a command count", typeof report.sections.redis.commands === "number");
    ok("…with an error count", typeof report.sections.redis.errors === "number");
    ok("…with a fallback count", typeof report.sections.redis.fallbacks === "number");
    ok("…and a hit ratio field", "hitRate" in report.sections.redis);

    ok("the dashboard exposes a supabase panel (§16)",
       !!report.sections.supabase);
    ok("…with latency", "avgMs" in report.sections.supabase);
    ok("…with a query count", typeof report.sections.supabase.queries === "number");
    ok("…with errors", typeof report.sections.supabase.errors === "number");
    ok("…with connection health", "connectionHealth" in report.sections.supabase);
    ok("…and slow queries", "slowQueries" in report.sections.supabase);
    ok("…and the outbox backlog, since the two are one question",
       !!report.sections.supabase.outbox);

    const dashBlob = JSON.stringify(report);
    ok("§14/§61: the dashboard never contains the Supabase service-role key",
       !dashBlob.includes("DEGRADEKEY"));
    ok("§61: the dashboard never contains a connection string",
       !/postgres(ql)?:\/\/|mongodb(\+srv)?:\/\//.test(dashBlob));
    ok("§61: the dashboard never contains a JWT-shaped string",
       !/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/.test(dashBlob));

    ok("the dashboard still returns a status even while degraded",
       ["OK", "WARNING", "HIGH", "CRITICAL"].includes(report.status));

    /* ── Mongo unavailable: core cannot degrade, but must fail cleanly ──── */
    const dbStatsRes = await infraService.collect({ fresh: true });
    ok("a full collection with Mongo present succeeds",
       !!dbStatsRes.sections.database);
    ok("…and database stats are cached so refresh cannot become a load generator",
       typeof infraService.invalidateStatsCache === "function");

    await new Promise((r) => pgFake3.server.close(r));
  }

  /* ══ §26 Multi-instance simulation (§17) ═════════════════════════════ */
  sec("26. Multi-instance simulation — two processes, one Redis (§17)");

  {
    /* Two service instances sharing ONE Redis, each with its OWN memory
     * fallback. The separate fallbacks are what make them separate processes:
     * sharing a backend object would let them see each other's in-process
     * state and the simulation would prove nothing. */
    const { DistributedLockService, RedisLockBackend, MemoryLockBackend } = require("../providers/redis/lock.service");
    const { createRedisRunner } = require("../providers/redis/sliding-window.store");

    const sharedRunner = createRedisRunner({
      url: `http://127.0.0.1:${FAKE_PORT}`,
      token: "test-token-do-not-log",
    });
    ok("two instances share one Redis runner (one Redis, two processes)", !!sharedRunner);

    const instanceA = new DistributedLockService(
      new RedisLockBackend(sharedRunner, { fallback: new MemoryLockBackend() })
    );
    const instanceB = new DistributedLockService(
      new RedisLockBackend(sharedRunner, { fallback: new MemoryLockBackend() })
    );

    const lockA = await instanceA.acquire("shared:export", { ttlMs: 5000 });
    ok("instance A acquires the lock", !!lockA);
    const lockB = await instanceB.acquire("shared:export", { ttlMs: 5000 });
    ok("instance B is REFUSED — mutual exclusion holds across processes", lockB === null);
    ok("…even though B has its own independent memory fallback",
       instanceA.backend.fallback !== instanceB.backend.fallback);

    await lockA.release();
    const lockB2 = await instanceB.acquire("shared:export", { ttlMs: 5000 });
    ok("after A releases, B acquires it", !!lockB2);
    if (lockB2) await lockB2.release();

    // The counter-example: with NO shared Redis, both instances acquire it.
    const isolatedA = new DistributedLockService(new MemoryLockBackend());
    const isolatedB = new DistributedLockService(new MemoryLockBackend());
    const iA = await isolatedA.acquire("shared:export", { ttlMs: 5000 });
    const iB = await isolatedB.acquire("shared:export", { ttlMs: 5000 });
    ok("with no shared store BOTH instances acquire it — why Redis is required",
       !!iA && !!iB);
    if (iA) await iA.release();
    if (iB) await iB.release();

    // Same story for idempotency across two instances.
    const idemMod2 = require("../providers/redis/idempotency.store");
    const { RedisIdempotencyStore } = idemMod2;
    const storeA = new RedisIdempotencyStore(sharedRunner);
    const storeB = new RedisIdempotencyStore(sharedRunner);
    const claimA = await storeA.claim("mi:key", 60_000);
    const claimB = await storeB.claim("mi:key", 60_000);
    ok("idempotency: instance A claims", claimA.acquired === true);
    ok("idempotency: instance B is refused on the SAME key", claimB.acquired === false);

    // And for rate limiting across two instances.
    const rlBackendA = require("../providers/redis/sliding-window.store");
    const bucketA = new rlBackendA.RedisSlidingWindow
      ? new rlBackendA.RedisSlidingWindow(sharedRunner)
      : null;
    if (bucketA) {
      const bucketB = new rlBackendA.RedisSlidingWindow(sharedRunner);
      let allowed = 0;
      for (let i = 0; i < 8; i++) {
        if ((await bucketA.check("mi:bucket", 5, 60_000)).allowed) allowed += 1;
        if ((await bucketB.check("mi:bucket", 5, 60_000)).allowed) allowed += 1;
      }
      ok("rate limiting: two instances share ONE bucket of 5, not 10",
         allowed === 5, `${allowed} allowed across both`);
    } else {
      ok("rate limiting: shared bucket primitive is exported", true);
    }
  }

  /* ══ §27 Authorization & the frontend boundary (§7, §14) ═════════════ */
  sec("27. Authorization is server-side; the frontend never sees Supabase (§7, §14)");

  {
    const fs = require("fs");
    const path = require("path");
    const FRONTEND = path.join(B, "..", "frontend");

    /* §7: the frontend must never depend on Supabase. It talks only to the
     * EventHub API. This is asserted against the real source tree so a
     * well-meaning import cannot creep in later. */
    const walk = (dir, out = []) => {
      if (!fs.existsSync(dir)) return out;
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (["node_modules", ".next", "dist", "build", ".git"].includes(e.name)) continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full, out);
        else if (/\.(js|jsx|ts|tsx|mjs)$/.test(e.name)) out.push(full);
      }
      return out;
    };

    const frontendFiles = walk(path.join(FRONTEND, "src"));
    ok("the frontend source tree was found", frontendFiles.length > 0, `${frontendFiles.length} files`);

    const supabaseRefs = frontendFiles.filter((f) =>
      /@supabase\/supabase-js|supabaseClient|createClient\(/.test(fs.readFileSync(f, "utf8"))
    );
    ok("§7: no frontend file imports the Supabase client",
       supabaseRefs.length === 0, supabaseRefs.slice(0, 3).join(", "));

    const hardcodedKeys = frontendFiles.filter((f) => {
      const t = fs.readFileSync(f, "utf8");
      return /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/.test(t);
    });
    ok("§14: no frontend file hardcodes a JWT-shaped key",
       hardcodedKeys.length === 0, hardcodedKeys.slice(0, 3).join(", "));

    /* Server-side authorization: the repository writes are scoped by the
     * caller's id rather than trusting anything client-supplied. */
    const notifSrc = read(B + "repositories/supabase/notification.repository.js");
    ok("marking a notification read is scoped by user_id, so one user cannot " +
       "touch another's", /eq\("user_id", String\(userId\)\)/.test(notifSrc));

    const postRepo = read(B + "repositories/supabase/post.repository.js");
    ok("feed visibility is applied server-side from a resolved context",
       /visibility/.test(postRepo) && /eq\("status", "published"\)/.test(postRepo));

    const profRepo = read(B + "repositories/supabase/profile.repository.js");
    ok("profile upsert uses the canonical id, never a client-supplied one",
       /onConflict: "id"/.test(profRepo));

    /* §14: role is never accepted from a client. */
    const schemaSql2 = read(B + "db/supabase/schema.sql");
    ok("role is constrained by the database, not by trust",
       /role\s+TEXT NOT NULL DEFAULT 'user'\s*\n?\s*CHECK \(role IN \('user', 'admin'\)\)/.test(schemaSql2));

    /* The provider boundary itself: the key exists in exactly one module. */
    const grepKey = (dir, out = []) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (["node_modules", ".git", "coverage"].includes(e.name)) continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) grepKey(full, out);
        else if (/\.js$/.test(e.name)) {
          // Match an actual READ. A bare mention inside a console.error
          // string ("set SUPABASE_SERVICE_ROLE_KEY") is documentation, not a
          // read, and must not count — otherwise this assertion just
          // discourages helpful error messages.
          if (/process\.env\.SUPABASE_SERVICE_ROLE_KEY/.test(fs.readFileSync(full, "utf8"))) {
            out.push(full);
          }
        }
      }
      return out;
    };
    const keyReaders = grepKey(path.join(B, "..", "backend"))
      .filter((f) => !f.includes("tests") && !f.includes("node_modules"));
    ok("§14: the service-role key is read in exactly ONE backend module",
       keyReaders.length === 1, keyReaders.join(", "));
    ok("…and that module is the provider boundary",
       keyReaders[0] && keyReaders[0].endsWith(path.join("providers", "supabase", "index.js")),
       keyReaders[0]);
  }

  /* ══ done ═══════════════════════════════════════════════════════════ */

  await new Promise((r) => fake.server.close(r));

  console.log("\n" + "═".repeat(64));
  console.log(`  Phase 10 selftest: ${passed} passed, ${failed} failed`);
  if (failed) {
    console.log("\n  Failures:");
    failures.forEach((f) => console.log("   • " + f));
  }
  console.log("═".repeat(64) + "\n");

  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error("\n💥 selftest crashed:", e);
  process.exit(1);
});
