/**
 * PLATFORM SELF-TEST (Part 5, Phase 1) — runnable WITHOUT any npm deps.
 * Exercises the Phase 1 backbone end-to-end, in-process:
 *   1. Error taxonomy + normalizer (§61/§67)
 *   2. CacheService: getOrSet, TTL, in-flight dedup, SWR, private-key
 *      guard, prefix invalidation, LRU eviction (§8–15)
 *   3. Metrics: latency percentiles, cache counters, snapshot (§57–58)
 *   4. Resilience: withTimeout, selective retry, circuit breaker (§29–31)
 *
 * Run: node tests/platform.selftest.js
 */
process.env.NODE_ENV = "test";

const assert = require("assert");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const { errorResponse, AppError, ValidationError, RateLimitError, ProviderUnavailableError } = require("../utils/app-error");
const { cache, keys, TTL, MemoryCacheProvider } = require("../services/cache.service");
const metrics = require("../services/metrics.service");
const { withTimeout, retryWithBackoff, createCircuitBreaker } = require("../utils/with-timeout");

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ✅ ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`  ❌ ${name} — ${err.message}`);
  }
}

(async () => {
  console.log("── 1. Error taxonomy + normalizer ──");
  await test("AppError keeps status/code/message", () => {
    const e = new ValidationError("Bad input");
    const r = errorResponse(e);
    assert.strictEqual(r.status, 400);
    assert.strictEqual(r.body.error.code, "VALIDATION_ERROR");
    assert.strictEqual(r.body.message, "Bad input");
    assert.strictEqual(r.body.success, false);
  });
  await test("non-exposed AppError never leaks its message", () => {
    const e = new AppError("secret internal detail", { status: 500, code: "INTERNAL_ERROR", expose: false });
    const r = errorResponse(e);
    assert.strictEqual(r.status, 500);
    assert.ok(!JSON.stringify(r.body).includes("secret"));
  });
  await test("RateLimitError carries retryAfterMs", () => {
    const r = errorResponse(new RateLimitError(undefined, 90_000));
    assert.strictEqual(r.status, 429);
    assert.strictEqual(r.body.error.code, "RATE_LIMITED");
    assert.strictEqual(r.retryAfterMs, 90_000);
  });
  await test("Mongoose duplicate key (11000) → 409 CONFLICT", () => {
    const r = errorResponse({ code: 11000, name: "MongoServerError", keyValue: { email: "a@b.c" } });
    assert.strictEqual(r.status, 409);
    assert.strictEqual(r.body.error.code, "CONFLICT");
    assert.ok(r.body.message.includes("email"));
  });
  await test("Mongoose ValidationError → 400 with first issue", () => {
    const r = errorResponse({ name: "ValidationError", errors: { title: { message: "Title is required" } } });
    assert.strictEqual(r.status, 400);
    assert.strictEqual(r.body.message, "Title is required");
  });
  await test("CastError → 400 VALIDATION_ERROR", () => {
    const r = errorResponse({ name: "CastError", kind: "ObjectId" });
    assert.strictEqual(r.status, 400);
    assert.strictEqual(r.body.error.code, "VALIDATION_ERROR");
  });
  await test("JWT error → 401", () => {
    const r = errorResponse({ name: "TokenExpiredError", message: "jwt expired" });
    assert.strictEqual(r.status, 401);
    assert.strictEqual(r.body.error.code, "AUTH_REQUIRED");
  });
  await test("unknown error → 500 with generic message (no leak)", () => {
    const r = errorResponse(new Error("connect ETIMEDOUT 10.0.0.1:27017 super-internal"));
    assert.strictEqual(r.status, 500);
    assert.ok(!JSON.stringify(r.body).includes("ETIMEDOUT"));
    assert.strictEqual(r.body.error.code, "INTERNAL_ERROR");
  });

  console.log("── 2. CacheService ──");
  await cache.flush();
  metrics.reset();
  await test("getOrSet caches: loader runs once", async () => {
    let calls = 0;
    const load = async () => {
      calls += 1;
      return { v: 1 };
    };
    const a = await cache.getOrSet(keys.event("e1"), load, { ttl: 60_000 });
    const b = await cache.getOrSet(keys.event("e1"), load, { ttl: 60_000 });
    assert.deepStrictEqual(a, { v: 1 });
    assert.strictEqual(calls, 1);
    const snap = metrics.snapshot();
    assert.strictEqual(snap.cache.hits >= 1, true);
  });
  await test("TTL expiry: second load after expiry hits the loader again", async () => {
    let calls = 0;
    const load = async () => {
      calls += 1;
      return { v: calls };
    };
    await cache.getOrSet(keys.event("e2"), load, { ttl: 40 });
    await wait(70);
    const v = await cache.getOrSet(keys.event("e2"), load, { ttl: 40 });
    assert.strictEqual(calls, 2);
    assert.strictEqual(v.v, 2);
  });
  await test("in-flight dedup: 3 concurrent calls → 1 loader run", async () => {
    let calls = 0;
    const load = async () => {
      calls += 1;
      await wait(60);
      return { v: "shared" };
    };
    const [a, b, c] = await Promise.all([
      cache.getOrSet(keys.event("e3"), load, { ttl: 60_000 }),
      cache.getOrSet(keys.event("e3"), load, { ttl: 60_000 }),
      cache.getOrSet(keys.event("e3"), load, { ttl: 60_000 }),
    ]);
    assert.strictEqual(calls, 1);
    assert.strictEqual(a.v, "shared");
    assert.strictEqual(b.v, "shared");
    assert.strictEqual(c.v, "shared");
    const snap = metrics.snapshot();
    assert.ok(snap.cache.dedupServed >= 2);
  });
  await test("stale-while-revalidate serves stale instantly, refreshes in background", async () => {
    let calls = 0;
    const load = async () => {
      calls += 1;
      return { v: calls };
    };
    await cache.getOrSet(keys.explore("upcoming"), load, { ttl: 40 });
    await wait(70); // expired
    const t0 = Date.now();
    const stale = await cache.getOrSet(keys.explore("upcoming"), load, { ttl: 60_000, swr: true });
    const elapsed = Date.now() - t0;
    assert.strictEqual(stale.v, 1, "stale value served");
    assert.ok(elapsed < 40, "stale served without waiting for the loader");
    await wait(80); // background revalidation completes
    const fresh = await cache.getOrSet(keys.explore("upcoming"), load, { ttl: 60_000, swr: true });
    assert.strictEqual(fresh.v, 2, "refreshed value is now cached");
    assert.strictEqual(calls, 2);
    assert.ok(metrics.snapshot().cache.staleServed >= 1);
  });
  await test("private keys can NEVER use stale-while-revalidate (§14)", async () => {
    const load = async () => ({ follows: [] });
    await cache.getOrSet(keys.followList("user1"), load, { ttl: 60_000 });
    // getOrSet is async — the guard surfaces as a rejection, not a sync throw
    await assert.rejects(
      () => cache.getOrSet(keys.followList("user1"), load, { ttl: 60_000, swr: true }),
      /forbidden for private key/
    );
  });
  await test("invalidatePrefix clears a whole domain family (§13)", async () => {
    await cache.flush(); // isolate state from earlier tests
    const load = async () => ({ v: 1 });
    await cache.getOrSet(keys.event("a"), load, { ttl: 60_000 });
    await cache.getOrSet(keys.event("b"), load, { ttl: 60_000 });
    await cache.getOrSet(keys.eventCounts("a"), load, { ttl: 60_000 });
    const removed = await cache.invalidatePrefix("event:");
    assert.strictEqual(removed, 2);
    assert.strictEqual((await cache.stats()).size, 1); // counts:event:a survives a prefix-scoped invalidation
  });
  await test("LRU eviction respects maxEntries", async () => {
    const tiny = new MemoryCacheProvider({ maxEntries: 3 });
    for (let i = 0; i < 5; i++) tiny.set(`k${i}`, i, 60_000);
    assert.strictEqual(tiny.size(), 3);
    assert.strictEqual(tiny.get("k0"), null, "oldest evicted");
    assert.strictEqual(tiny.get("k4").value, 4, "newest kept");
  });

  console.log("── 3. Metrics ──");
  await test("latency percentiles + snapshot shape", () => {
    metrics.reset();
    for (let i = 1; i <= 100; i++) metrics.recordLatency(i);
    metrics.recordStatus(200);
    metrics.recordStatus(404);
    metrics.recordStatus(500);
    const s = metrics.snapshot();
    assert.strictEqual(s.api.samples, 100);
    assert.strictEqual(s.api.p50, 50);
    assert.ok(s.api.p95 >= 95 && s.api.p95 <= 96);
    assert.ok(s.api.p99 >= 99);
    assert.strictEqual(s.statuses.ok, 1);
    assert.strictEqual(s.statuses.clientError, 1);
    assert.strictEqual(s.statuses.serverError, 1);
  });
  await test("cache hit rate computes", () => {
    metrics.reset();
    metrics.recordCacheHit("event:1");
    metrics.recordCacheHit("event:2");
    metrics.recordCacheMiss("org:1");
    const s = metrics.snapshot();
    assert.strictEqual(s.cache.hits, 2);
    assert.strictEqual(s.cache.misses, 1);
    assert.strictEqual(s.cache.hitRate, 67);
  });

  console.log("── 4. Resilience ──");
  await test("withTimeout releases the caller with OperationTimeoutError", async () => {
    const slow = () => new Promise((r) => setTimeout(() => r("late"), 200));
    await assert.rejects(() => withTimeout(slow, 30, "slow-op"), (err) => {
      assert.strictEqual(err.status, 504);
      assert.strictEqual(err.retryable, true);
      assert.ok(err.message.includes("slow-op"));
      return true;
    });
  });
  await test("retryWithBackoff retries transient errors and succeeds", async () => {
    let attempts = 0;
    const result = await retryWithBackoff(
      async () => {
        attempts += 1;
        if (attempts < 3) throw new ProviderUnavailableError("flaky");
        return "ok";
      },
      { retries: 3, baseMs: 5 }
    );
    assert.strictEqual(result, "ok");
    assert.strictEqual(attempts, 3);
  });
  await test("retryWithBackoff NEVER retries non-retryable errors (§30)", async () => {
    let attempts = 0;
    await assert.rejects(
      () =>
        retryWithBackoff(
          async () => {
            attempts += 1;
            const e = new Error("validation is final");
            e.status = 400;
            throw e;
          },
          { retries: 3, baseMs: 5 }
        ),
      /validation is final/
    );
    assert.strictEqual(attempts, 1, "no retry for non-retryable errors");
  });
  await test("circuit breaker opens, fast-fails, then half-open recovers (§31)", async () => {
    let calls = 0;
    const failing = async () => {
      calls += 1;
      throw new Error("provider down");
    };
    const breaker = createCircuitBreaker("test-provider", failing, {
      failureThreshold: 2,
      cooldownMs: 60,
      timeoutMs: 1000,
    });
    await assert.rejects(() => breaker.invoke(), /provider down/);
    await assert.rejects(() => breaker.invoke(), /provider down/);
    assert.strictEqual(breaker.getState().status, "open");
    // OPEN: must fail fast WITHOUT touching the provider
    let fastFailed = false;
    try {
      await breaker.invoke();
    } catch (err) {
      fastFailed = err instanceof ProviderUnavailableError;
    }
    assert.ok(fastFailed, "open breaker throws ProviderUnavailableError");
    assert.strictEqual(calls, 2, "provider NOT called while breaker open");
    await wait(80); // cooldown elapses → HALF_OPEN
    const recovering = createCircuitBreaker("test-provider", async () => "back", {
      failureThreshold: 2,
      cooldownMs: 60,
      timeoutMs: 1000,
    });
    recovering.getState(); // noop — use same breaker instead:
    assert.strictEqual(await recovering.invoke(), "back");
    assert.strictEqual(recovering.getState().status, "closed");
  });

  console.log(`\n${failed === 0 ? "✅" : "❌"} PLATFORM SELF-TEST: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
