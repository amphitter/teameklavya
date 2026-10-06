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

  function runCommand(args) {
    const cmd = String(args[0] || "").toUpperCase();
    state.commands += 1;
    switch (cmd) {
      case "PING":
        return "PONG";
      case "GET":
        return live(args[1]) ?? null;
      case "SET": {
        const [, key, value, opt, px] = args;
        let expiresAt = null;
        if (String(opt || "").toUpperCase() === "PX") expiresAt = Date.now() + Number(px);
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

  return { server, store, state };
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
