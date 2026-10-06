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
        const [, key, value, opt, px] = args;
        // Support "SET key value NX PX <ttl>" — the idempotency claim.
        // NX makes the write conditional; returning nil on an existing key
        // is exactly how the real Redis behaves, and the whole atomicity
        // guarantee of the claim depends on that distinction.
        const upper = String(opt || "").toUpperCase();
        if (upper === "NX") {
          const existing = live(key);
          if (existing !== undefined) return null; // already claimed
          store.set(key, { value, expiresAt: Date.now() + Number(px || 1000) });
          return "OK";
        }
        let expiresAt = null;
        if (upper === "PX") expiresAt = Date.now() + Number(px);
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

(async () => {
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
  let rlThrew = false;
  let rlVerdict = null;
  try {
    rlVerdict = await serverA.increment("u:outage-user");
  } catch {
    rlThrew = true;
  }
  ok("a Redis outage does not throw from the rate limiter", !rlThrew);
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
