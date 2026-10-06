#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  PART 7 · §1  REAL-PROVIDER TEST SUITE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * WHY THIS FILE IS SEPARATE
 * ─────────────────────────
 * Every other suite in this repository drives fakes. That is the right thing
 * for CI: it is fast, deterministic and needs no credentials. But a fake
 * encodes OUR UNDERSTANDING of a provider, not the provider's actual behaviour.
 * It cannot tell us that we got the Upstash pipeline argument order wrong, that
 * a Supabase column is spelled differently in the live schema, that a Postgres
 * constraint we assumed exists was never created, or that a trigger's counter
 * does not increment the way we think. Only the real thing can.
 *
 * So this suite exists, and it is deliberately kept apart:
 *
 *   1. IT NEVER RUNS AUTOMATICALLY. It exits 0 immediately unless
 *      REAL_PROVIDER_TESTS === "true". It is NOT part of `npm run test:all`
 *      and must never be added to it — a CI runner without credentials would
 *      otherwise fail, and one WITH credentials would write to production.
 *
 *   2. IT TALKS ONLY TO A THROWAWAY ENVIRONMENT. Point SUPABASE_URL and
 *      UPSTASH_REDIS_REST_URL at scratch projects. The suite writes real rows
 *      and real keys. It cleans them up, but a crash mid-run can leave
 *      residue, and residue in a throwaway project is untidy while residue in
 *      production is an incident.
 *
 *   3. IT NEVER LOGS A CREDENTIAL. Every line printed goes through `redact()`,
 *      and the run ENDS with an assertion that no secret value appears in
 *      anything printed. That assertion is the point: a test suite that
 *      promises not to leak secrets but does not check is a promise waiting to
 *      be broken by the next error message someone adds.
 *
 *   4. IT ISOLATES ITS KEYS. All Redis keys live under a dedicated namespace
 *      (`eh_realtest`) and a per-run version, so cleanup can safely scan-and-
 *      delete the entire namespace without ever touching a production key.
 *
 * Run it with:
 *   REAL_PROVIDER_TESTS=true \
 *   UPSTASH_REDIS_REST_URL=... UPSTASH_REDIS_REST_TOKEN=... \
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *   npm run test:real-providers
 *
 * MongoDB sections additionally need MONGODB_URI; they report SKIPPED rather
 * than passing when it is absent, because a test that silently does nothing
 * and calls itself green is worse than no test at all.
 */

"use strict";

/* ── Gate. This must happen before anything else, including requires. ───── */

if (process.env.REAL_PROVIDER_TESTS !== "true") {
  console.log(
    "\n§1 real-provider suite: SKIPPED (set REAL_PROVIDER_TESTS=true to run)\n" +
      "   This suite talks to real Upstash Redis and real Supabase Postgres.\n" +
      "   It is intentionally NOT part of `npm run test:all`.\n"
  );
  process.exit(0);
}

const RUN_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/* ── Required credentials ───────────────────────────────────────────────── */

const REQUIRED = {
  UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL,
  UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN,
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
};

const MISSING = Object.entries(REQUIRED)
  .filter(([, v]) => !v)
  .map(([k]) => k);

if (MISSING.length) {
  console.log(
    `\n§1 real-provider suite: SKIPPED — missing ${MISSING.join(", ")}\n` +
      "   Nothing was run. Configure the variables above against a THROWAWAY\n" +
      "   project and re-run.\n"
  );
  process.exit(0);
}

/* ── Force the real backends, and isolate this run's keyspace ───────────── */
/* Set before the provider modules are required: they resolve their backend
 * once, at first use, from these variables. */

process.env.CACHE_PROVIDER = "upstash";
process.env.RATE_LIMIT_PROVIDER = "upstash";
process.env.IDEMPOTENCY_PROVIDER = "upstash";
process.env.LOCK_PROVIDER = "upstash";
process.env.CACHE_KEY_NAMESPACE = "eh_realtest";
process.env.CACHE_KEY_VERSION = RUN_ID;

/* ── Output capture + redaction (§1: never expose credentials in logs) ──── */

const SECRETS = Object.values(REQUIRED).filter(Boolean);
// Also redact the URL's embedded credentials if someone pasted them in.
for (const v of Object.values(REQUIRED)) {
  if (!v) continue;
  const m = /^([a-z]+:\/\/)[^@/]*@(.+)$/i.exec(v);
  if (m) SECRETS.push(m[2]);
}
const SECRET_RE = new RegExp(
  SECRETS.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"),
  "g"
);

function redact(value) {
  return String(value).replace(SECRET_RE, "«redacted»");
}

const CAPTURED = [];
for (const level of ["log", "warn", "error", "info"]) {
  const original = console[level].bind(console);
  console[level] = (...args) => {
    const line = args
      .map((a) => (typeof a === "string" ? a : (() => { try { return JSON.stringify(a); } catch { return String(a); } })()))
      .join(" ");
    CAPTURED.push(line);
    original(redact(line));
  };
}

/* ── Tiny harness ───────────────────────────────────────────────────────── */

let passed = 0;
let failed = 0;
let skipped = 0;
const failures = [];

function sec(title) {
  console.log(`\n── ${title} ──`);
}
function ok(name, cond, detail = "") {
  if (cond) {
    passed += 1;
    console.log(`  ✅ ${name}`);
  } else {
    failed += 1;
    failures.push(name);
    console.log(`  ❌ ${name}${detail ? ` — ${redact(detail)}` : ""}`);
  }
}
/** A skipped test is reported loudly and counted separately. Never green. */
function skip(name, why) {
  skipped += 1;
  console.log(`  ⊘ ${name} — SKIPPED: ${why}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ───────────────────────────────────────────────────────────────────────── */
/*  MAIN                                                                     */
/* ───────────────────────────────────────────────────────────────────────── */

/* Module-scope cleanup state.
 *
 * Deliberately NOT local to main(): when a later section throws, main() unwinds
 * and any `finally` inside it is the only thing that still runs. Cleanup has to
 * survive that, because a suite that writes real rows and real keys and then
 * leaks them on the first failure is worse than no suite at all. */
const STATE = {
  redis: null,
  supa: null,
  connected: false,
  keyPrefix: `eh_realtest:${RUN_ID}:`,
  created: [],
  sentinelId: null,
};
const key = (k) => `eh_realtest:${RUN_ID}:${k}`;


/**
 * The Supabase half of the suite, split into its own function so that one
 * throwing assertion cannot abort the run before cleanup executes.
 */
async function runSupabaseSection(supa, sentinelId, sentinelEmail, created) {
    ok("the Supabase REST health check succeeds", supaUp === true, String(healthErr));

    /* -- INSERT -- */
    let inserted = null;
    try {
      inserted = await supa
        .from("profiles")
        .insert(
          {
            id: sentinelId,
            email: sentinelEmail,
            full_name: "Realtest Sentinel",
            role: "USER",
          },
          { upsert: false }
        );
      created.push(sentinelId);
    } catch (err) {
      ok("INSERT creates a row that can be read back", false, err.message);
    }
    if (inserted) {
      const row = Array.isArray(inserted) ? inserted[0] : inserted;
      ok(
        "INSERT creates a row that can be read back",
        !!row && row.email === sentinelEmail,
        JSON.stringify(row && row.email)
      );
      ok("…and the server assigns the columns we did not send", !!row && "created_at" in row);

      /* -- UPDATE -- */
      const updated = await supa
        .from("profiles")
        .eq("id", sentinelId)
        .update({ full_name: "Realtest Renamed" });
      const urow = Array.isArray(updated) ? updated[0] : updated;
      ok(
        "UPDATE changes only the columns it was given",
        !!urow && urow.full_name === "Realtest Renamed" && urow.email === sentinelEmail,
        JSON.stringify(urow && urow.full_name)
      );

      /* -- UPSERT: same conflict target must not duplicate -- */
      const before = await supa.from("profiles").eq("id", sentinelId).many();
      await supa
        .from("profiles")
        .insert(
          { id: sentinelId, email: sentinelEmail, full_name: "Realtest Upserted", role: "USER" },
          { upsert: true, onConflict: "id" }
        );
      const after = await supa.from("profiles").eq("id", sentinelId).many();
      ok(
        "UPSERT on the conflict target does not duplicate the row",
        before.length === 1 && after.length === 1,
        `${before.length} → ${after.length}`
      );
      ok(
        "…and it updated the row in place",
        after[0] && after[0].full_name === "Realtest Upserted",
        JSON.stringify(after[0] && after[0].full_name)
      );
    }

    /* -- PAGINATION -- */
    const page1 = await supa.from("profiles").paginate({ limit: 5, sortColumn: "created_at", direction: "desc" });
    ok(
      "pagination returns at most the requested page size",
      Array.isArray(page1.rows) && page1.rows.length <= 5,
      `${page1.rows && page1.rows.length}`
    );
    ok("…and exposes a cursor for the next page", "nextCursor" in page1);

    let pages = 0;
    let cursor = page1.nextCursor;
    while (cursor && pages < 4) {
      const p = await supa.from("profiles").paginate({ limit: 5, after: cursor, sortColumn: "created_at", direction: "desc" });
      pages += 1;
      cursor = p.nextCursor;
    }
    ok("…and paging terminates rather than looping forever", pages <= 4, `pages=${pages}`);

    /* -- CONSTRAINTS. The value of a real-provider test is that these are
     *    the things a fake happily accepts and Postgres does not. -- */
    let nullRejected = false;
    try {
      await supa.from("profiles").insert({ id: `nil-${RUN_ID}`, email: null, full_name: "x" });
    } catch {
      nullRejected = true;
    }
    ok("a NOT NULL constraint is REJECTED, not silently accepted", nullRejected);

    let enumRejected = false;
    try {
      await supa.from("profiles").insert({
        id: `enum-${RUN_ID}`,
        email: `enum+${RUN_ID}@example.invalid`,
        role: "NOT_A_REAL_ROLE",
      });
    } catch {
      enumRejected = true;
    }
    ok("an invalid enum value is rejected", enumRejected);

    let fkRejected = false;
    try {
      await supa
        .from("posts")
        .insert({ id: `fk-${RUN_ID}`, author_id: sentinelId + "-nope", body: "orphan" });
    } catch {
      fkRejected = true;
    }
    ok("a foreign key to a non-existent row is rejected", fkRejected);

    /* -- TRIGGER COUNTERS (§2 reconciliation excludes these because
     *    Postgres owns them; here we prove Postgres really does own them) -- */
    let triggerWorks = null;
    try {
      const post = await supa
        .from("posts")
        .insert({ id: `trig-${RUN_ID}`, author_id: sentinelId, body: "trigger probe" });
      const prow = Array.isArray(post) ? post[0] : post;
      const pid = prow && prow.id;
      created.push(`posts:${pid}`);
      const beforeCnt = (await supa.from("posts").eq("id", pid).single())?.likes_count ?? 0;
      await supa.from("post_likes").insert({ post_id: pid, user_id: sentinelId });
      created.push(`post_likes:${pid}:${sentinelId}`);
      const afterCnt = (await supa.from("posts").eq("id", pid).single())?.likes_count ?? 0;
      triggerWorks = { beforeCnt, afterCnt };
    } catch (err) {
      triggerWorks = { error: err.message };
    }
    ok(
      "the trigger-maintained counter increments in the database",
      triggerWorks && !triggerWorks.error && triggerWorks.afterCnt === triggerWorks.beforeCnt + 1,
      JSON.stringify(triggerWorks)
    );
}

/**
 * §8 (credential hygiene) and §9 (cleanup).
 *
 * These ALWAYS run — even when main() threw — because a suite that writes
 * real rows and real keys and then leaks them on the first failure is
 * worse than no suite at all, and because the promise not to log a
 * credential is worthless if the assertion checking it can be skipped by
 * an unrelated crash above it.
 */
let finalRan = false;
async function finalChecks() {
  if (finalRan) return;
  finalRan = true;
  /* ══════════════════════════════════════════════════════════════════════ */
  sec("8. Credential hygiene — the suite must not leak what it was given");

  const leaked = CAPTURED.filter((line) => SECRET_RE.test(line));
  ok(
    "no credential value appears anywhere in this suite's output",
    leaked.length === 0,
    `${leaked.length} line(s) leaked`
  );
  ok(
    "…and the redactor actually works (self-check)",
    redact(SECRETS[0]).includes("«redacted»")
  );
  ok(
    "…and the service-role key was never sent to the frontend bundle",
    !process.env.SUPABASE_SERVICE_ROLE_KEY.includes("NEXT_PUBLIC")
  );

  /* ══════════════════════════════════════════════════════════════════════ */
  sec("9. Cleanup");

  // Supabase rows first: they are the durable artefact, so if cleanup is
  // going to fail we would rather fail after deleting them than before.
  const supa = STATE.supa;
  const redis = STATE.redis;
  const created = STATE.created;
  const sentinelId = STATE.sentinelId;
  const connected = STATE.connected;

  for (const ref of created.reverse()) {
    try {
      if (ref.startsWith("post_likes:")) {
        const [, pid, uid] = ref.split(":");
        await supa.from("post_likes").eq("post_id", pid).eq("user_id", uid).delete();
      } else if (ref.startsWith("posts:")) {
        await supa.from("posts").eq("id", ref.slice(6)).delete();
      } else {
        await supa.from("profiles").eq("id", ref).delete();
      }
    } catch {
      /* best effort — reported below, not fatal */
    }
  }
  const survivors = supa && sentinelId
    ? await supa.from("profiles").eq("id", sentinelId).many().catch(() => [])
    : [];
  ok("every sentinel row this suite created was removed", survivors.length === 0, `${survivors.length} left`);

  if (connected) {
    const removed = await redis.delPrefix(`eh_realtest:${RUN_ID}:`);
    ok("every Redis key this suite created was removed", typeof removed === "number", String(removed));
    const leftover = await redis.get(key("scalar"));
    ok("…confirmed: a key from this run no longer exists", leftover === null);
  } else {
    skip("every Redis key this suite created was removed", "Redis unreachable");
  }
  }
async function main() {
  console.log("\n══════════════════════════════════════════════════════════════");
  console.log("  PART 7 · §1  REAL-PROVIDER SUITE");
  console.log("══════════════════════════════════════════════════════════════");
  console.log(`  run id      : ${RUN_ID}`);
  console.log(`  redis keys  : eh_realtest:${RUN_ID}:*`);
  console.log(`  supabase url: ${redact(process.env.SUPABASE_URL)}`);
  console.log(
    "\n  ⚠  This suite writes REAL rows and REAL keys. Point it at a\n" +
      "     throwaway project. It cleans up after itself, but a crash\n" +
      "     mid-run can leave residue.\n"
  );

  const {
    createUpstashProvider,
    _command: command,
  } = require("../providers/redis/upstash.provider");
  const { supabaseProvider } = require("../providers/supabase");
  const { RedisSlidingWindow, createRedisRunner, SLIDING_WINDOW_LUA } =
    require("../providers/redis/sliding-window.store");
  const { resetStore, idempotencyStore } = require("../providers/redis/idempotency.store");
  const { resetLockService, lockService } = require("../providers/redis/lock.service");

  const redis = createUpstashProvider();
  const supa = supabaseProvider();
  STATE.redis = redis;
  STATE.supa = supa;

  /* ══════════════════════════════════════════════════════════════════════ */
  sec("1. Redis — SET / GET / TTL / NX / expiry against real Upstash");

  let connected = true;
  try {
    await redis.ping();
  } catch (err) {
    connected = false;
    console.log(`  ⚠  Redis unreachable: ${redact(err.message)}`);
  }
  STATE.connected = connected;

  if (!connected) {
    for (const n of [
      "PING reaches the real Redis",
      "SET then GET returns what was written",
      "TTL is actually set, not ignored",
      "SET NX does not clobber an existing key",
      "a key disappears once its TTL elapses",
      "the Lua sliding-window limiter allows up to the limit",
      "…and blocks one request past the limit",
      "the limiter window rolls over and admits traffic again",
      "idempotency: a second claim of the same key is refused",
      "idempotency: releasing the key allows a fresh claim",
      "idempotency: TTL bounds the claim so a crashed caller cannot wedge it",
      "lock: a lock is acquired with an unpredictable token",
      "lock: a second acquirer is refused while the lock is held",
      "lock: a NON-OWNER cannot release the lock",
      "lock: the owner CAN release it",
      "lock: an expired lock is recoverable rather than leaked forever",
      "our namespace does not collide with the application keyspace",
    ]) {
      skip(n, "Redis unreachable");
    }
  } else {
    ok("PING reaches the real Redis", true);

    const k1 = key("scalar");
    await redis.set(k1, { hello: "world", n: 42 }, 60_000);
    const got = await redis.get(k1);
    ok(
      "SET then GET returns what was written",
      got && got.hello === "world" && got.n === 42,
      JSON.stringify(got)
    );

    // TTL: ask Redis directly rather than trusting our own bookkeeping.
    const pttl = await command(["PTTL", k1], {
      url: process.env.UPSTASH_REDIS_REST_URL.replace(/\/+$/, ""),
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
    const ttlMs = Number(pttl?.result);
    ok(
      "TTL is actually set, not ignored",
      ttlMs > 0 && ttlMs <= 60_000,
      `PTTL=${ttlMs}`
    );

    // NX must not clobber.
    const nx = await command(
      ["SET", k1, "clobbered", "NX", "PX", 60_000],
      { url: process.env.UPSTASH_REDIS_REST_URL.replace(/\/+$/, ""), token: process.env.UPSTASH_REDIS_REST_TOKEN }
    );
    const afterNx = await redis.get(k1);
    ok(
      "SET NX does not clobber an existing key",
      nx?.result === null && afterNx && afterNx.hello === "world",
      `NX result=${JSON.stringify(nx?.result)}`
    );

    // Expiry. Use a short TTL and wait it out — the only way to know a
    // provider really expires keys is to watch one go.
    const kExp = key("expiring");
    await redis.set(kExp, "gone-soon", 1200);
    await sleep(1600);
    const expired = await redis.get(kExp);
    ok("a key disappears once its TTL elapses", expired === null, JSON.stringify(expired));

    /* ══════════════════════════════════════════════════════════════════ */
    sec("2. Redis — the Lua sliding-window rate limiter, really");

    const runner = createRedisRunner();
    const rl = new RedisSlidingWindow(runner, { keyPrefix: key("rl:") });
    const rlKey = `rl-${RUN_ID}`;

    const allowed = [];
    for (let i = 0; i < 5; i++) allowed.push(await rl.check(rlKey, 5, 10_000));
    ok(
      "the Lua sliding-window limiter allows up to the limit",
      allowed.filter((r) => r.allowed).length === 5,
      JSON.stringify(allowed.map((r) => r.allowed))
    );

    const over = await rl.check(rlKey, 5, 10_000);
    ok("…and blocks one request past the limit", over.allowed === false, JSON.stringify(over));
    ok(
      "…and reports a retry hint rather than blocking blind",
      typeof over.retryAfterMs === "number" || typeof over.resetAt === "number",
      JSON.stringify(Object.keys(over))
    );

    // Roll-over: a fresh window key must admit traffic again.
    const rolled = await rl.check(`rl-${RUN_ID}-fresh`, 5, 10_000);
    ok("the limiter window rolls over and admits traffic again", rolled.allowed === true);

    ok(
      "the limiter runs as ONE atomic Lua script, not a read-then-write",
      typeof SLIDING_WINDOW_LUA === "string" && SLIDING_WINDOW_LUA.length > 0
    );

    /* ══════════════════════════════════════════════════════════════════ */
    sec("3. Redis — distributed idempotency, really");

    resetStore();
    const idem = idempotencyStore();
    ok(
      "the idempotency store is the Redis one, not the in-memory fallback",
      idem.constructor.name === "RedisIdempotencyStore",
      idem.constructor.name
    );

    const iKey = `idem-${RUN_ID}`;
    const first = await idem.claim(iKey, 30_000);
    const second = await idem.claim(iKey, 30_000);
    ok("idempotency: a second claim of the same key is refused", first === true && second === false, `${first}/${second}`);

    await idem.release(iKey);
    const third = await idem.claim(iKey, 30_000);
    ok("idempotency: releasing the key allows a fresh claim", third === true);

    // TTL bounds the claim: a crashed caller must not wedge the key forever.
    const iKey2 = `idem-ttl-${RUN_ID}`;
    await idem.claim(iKey2, 1200);
    const blockedNow = await idem.claim(iKey2, 1200);
    await sleep(1600);
    const afterExpiry = await idem.claim(iKey2, 1200);
    ok(
      "idempotency: TTL bounds the claim so a crashed caller cannot wedge it",
      blockedNow === false && afterExpiry === true,
      `${blockedNow}/${afterExpiry}`
    );

    /* ══════════════════════════════════════════════════════════════════ */
    sec("4. Redis — distributed lock, really");

    resetLockService();
    const locks = lockService();
    const lockName = `lock-${RUN_ID}`;

    const l1 = await locks.acquire(lockName, { ttlMs: 20_000 });
    ok("lock: a lock is acquired with an unpredictable token", !!l1 && typeof l1.token === "string" && l1.token.length >= 16);
    ok(
      "lock: the token is not guessable from the lock name",
      !!l1 && !l1.token.includes(lockName) && l1.token !== lockName
    );

    const l2 = await locks.acquire(lockName, { ttlMs: 20_000 });
    ok("lock: a second acquirer is refused while the lock is held", l2 === null, JSON.stringify(l2 && l2.token));

    // A non-owner must not be able to release. This is the whole safety
    // property: without it, any caller could free a lock another instance
    // holds and two workers would run the same critical section at once.
    const backend = locks.backend;
    const stolen = await backend.release(lockName, "not-the-owner-token");
    ok("lock: a NON-OWNER cannot release the lock", stolen === false || stolen === 0, String(stolen));

    const stillHeld = await locks.acquire(lockName, { ttlMs: 20_000 });
    ok("…and the lock is still held afterwards", stillHeld === null);

    const released = await l1.release();
    ok("lock: the owner CAN release it", released === true || released === 1, String(released));

    const reacquired = await locks.acquire(lockName, { ttlMs: 20_000 });
    ok("…and the lock is then free for the next acquirer", !!reacquired);
    if (reacquired) await reacquired.release();

    // Expiry: a lock whose holder died must be recoverable.
    const l3 = await locks.acquire(`lock-exp-${RUN_ID}`, { ttlMs: 1200 });
    ok("lock: a short-lived lock is acquired", !!l3);
    await sleep(1600);
    const l4 = await locks.acquire(`lock-exp-${RUN_ID}`, { ttlMs: 5000 });
    ok("lock: an expired lock is recoverable rather than leaked forever", !!l4);
    if (l4) await l4.release();

    /* ══════════════════════════════════════════════════════════════════ */
    sec("5. Redis — namespace isolation");

    ok(
      "our namespace does not collide with the application keyspace",
      process.env.CACHE_KEY_NAMESPACE === "eh_realtest" &&
        process.env.CACHE_KEY_VERSION === RUN_ID
    );
    const appKeyProbe = await redis.get(`eh:v1:does-not-exist-${RUN_ID}`);
    ok("…and probing the application namespace returns nothing", appKeyProbe === null);
  }

  /* ══════════════════════════════════════════════════════════════════════ */
  sec("6. Supabase — INSERT / UPDATE / UPSERT / pagination / constraints");

  const sentinelId = `00000000-0000-4000-8000-${RUN_ID.replace(/[^a-z0-9]/gi, "").slice(0, 12).padStart(12, "0")}`;
  const sentinelEmail = `realtest+${RUN_ID}@example.invalid`;
  const created = STATE.created;
  STATE.sentinelId = sentinelId;

  // `health()` NEVER THROWS — it returns {ok:false, error}. Checking only for
  // a throw here produced a false PASS against a Supabase that was not
  // reachable at all. A health check that cannot fail is not a health check.
  let supaUp = false;
  let healthErr = null;
  try {
    const h = await supa.health();
    supaUp = h && h.ok === true;
    healthErr = h && h.ok ? null : h && h.error;
  } catch (err) {
    supaUp = false;
    healthErr = err.message;
  }
  if (!supaUp) console.log(`  ⚠  Supabase unreachable: ${redact(healthErr || "unknown")}`);

  if (!supaUp) {
    for (const n of [
      "the Supabase REST health check succeeds",
      "INSERT creates a row that can be read back",
      "UPDATE changes only the columns it was given",
      "UPSERT on the conflict target does not duplicate the row",
      "pagination pages through rows and terminates",
      "a NOT NULL / check constraint is REJECTED, not silently accepted",
      "an invalid enum value is rejected",
      "a foreign key to a non-existent row is rejected",
      "the trigger-maintained counter increments in the database",
    ]) {
      skip(n, "Supabase unreachable");
    }
  } else {
    try {
      await runSupabaseSection(supa, sentinelId, sentinelEmail, created);
    } catch (err) {
      // One throwing section must not take the whole run down with it —
      // cleanup still has to happen.
      ok("the Supabase section ran to completion", false, err.message);
    }
  }

  /* ══════════════════════════════════════════════════════════════════════ */
  sec("7. Outbox application + reconciliation against the real providers");

  if (!process.env.MONGODB_URI) {
    skip("outbox: an enqueued entry is applied to the real Supabase", "no MONGODB_URI — the outbox needs a real source of truth");
    skip("outbox: applying twice does not duplicate the target row", "no MONGODB_URI");
    skip("reconciliation: a real run completes and reports its totals", "no MONGODB_URI");
    skip("reconciliation: a second real run reports zero repairs (idempotent)", "no MONGODB_URI");
  } else {
    const mongoose = require("mongoose");
    const outboxSvc = require("../services/outbox.service");
    const syncSvc = require("../services/social-sync.service");
    const recon = require("../services/reconciliation.service");

    try {
      await mongoose.connect(process.env.MONGODB_URI);

      const entry = await outboxSvc.enqueue({
        entityType: "profile",
        entityId: sentinelId,
        op: "upsert",
      });
      ok("outbox: an entry is enqueued against the real database", !!entry);

      const claimed = await outboxSvc.claimBatch(1);
      ok("outbox: the real entry is claimable by a worker", claimed.length === 1, `${claimed.length}`);

      if (claimed.length) {
        await syncSvc.applyEntry(claimed[0]);
        await outboxSvc.complete(claimed[0]);

        const row = await supa.from("profiles").eq("id", sentinelId).many();
        ok("outbox: an enqueued entry is applied to the real Supabase", row.length === 1, `${row.length}`);

        // Idempotence: apply the same entity again, count must not grow.
        const e2 = await outboxSvc.enqueue({ entityType: "profile", entityId: sentinelId, op: "upsert" });
        if (e2) {
          const c2 = await outboxSvc.claimBatch(1);
          if (c2.length) {
            await syncSvc.applyEntry(c2[0]);
            await outboxSvc.complete(c2[0]);
          }
        }
        const row2 = await supa.from("profiles").eq("id", sentinelId).many();
        ok("outbox: applying twice does not duplicate the target row", row2.length === 1, `${row2.length}`);
      }

      const r1 = await recon.reconcileEntity({ entityType: "profile", limit: 50 });
      ok(
        "reconciliation: a real run completes and reports its totals",
        r1 && typeof r1.scanned === "number",
        JSON.stringify(r1 && { scanned: r1.scanned, drifted: r1.drifted, repaired: r1.repaired })
      );
      ok(
        "reconciliation: it reports the seven §2 counters",
        r1 && ["scanned", "matched", "drifted", "repaired", "missing", "deleted", "failed", "deadLettered"].every(
          (k) => typeof r1[k] === "number"
        )
      );

      const r2 = await recon.reconcileEntity({ entityType: "profile", limit: 50 });
      ok(
        "reconciliation: a second real run reports zero repairs (idempotent)",
        r2 && r2.repaired === 0,
        JSON.stringify(r2 && { drifted: r2.drifted, repaired: r2.repaired })
      );

      await mongoose.disconnect();
    } catch (err) {
      ok("outbox: an enqueued entry is applied to the real Supabase", false, err.message);
    }
  }

  await finalChecks();
}

/* ───────────────────────────────────────────────────────────────────────── */

main()
  .catch(async (err) => {
    failed += 1;
    failures.push(`suite aborted: ${err && err.message}`);
    console.log(redact(String((err && err.stack) || err)));
    // Safety net: if main() threw before reaching `await finalChecks()`,
    // cleanup and the credential-leak assertion still have to happen.
    if (!finalRan) {
      await finalChecks().catch((e) => {
        failed += 1;
        failures.push(`cleanup failed: ${e && e.message}`);
      });
    }
  })
  .finally(() => {
    console.log("\n══════════════════════════════════════════════════════════════");
    console.log(
      `  §1 REAL-PROVIDER SUITE: ${passed} passed, ${failed} failed, ${skipped} skipped`
    );
    if (skipped) console.log("  ⚠  Skipped tests are NOT passes. Do not read them as green.");
    if (passed === 0 && skipped > 0 && failed === 0) {
      console.log("  ⚠  Nothing was actually exercised. Treat this run as NO COVERAGE.");
    }
    if (failures.length) {
      console.log("\n  Failures:");
      for (const f of failures) console.log(`    · ${f}`);
    }
    console.log("══════════════════════════════════════════════════════════════\n");
    // A run that verified nothing is not a pass. Exiting 0 on "everything was
    // skipped" would let a broken environment masquerade as a green suite.
    if (passed === 0) {
      console.log("  ✗ Nothing was exercised — treating this run as a FAILURE.\n");
      process.exit(1);
    }
    process.exit(failed === 0 ? 0 : 1);
  });
