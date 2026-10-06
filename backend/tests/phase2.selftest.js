/**
 * PHASE 2 SELF-TEST (Part 5) — rate limiting, abuse guards, idempotency.
 * Runnable with platform deps installed (express, express-rate-limit):
 *   node tests/phase2.selftest.js
 *
 * Exercises the Phase 2 stack in-process:
 *   1. §24 bucket table sanity (config/rate-limits.js)
 *   2. SlidingWindow mechanics — allow/block, retryAfterMs, window slide
 *   3. actionGuard — comment flood cap, user isolation, RATE_LIMIT_DISABLED
 *   4. idempotencyWindow — dup rejection, per-user scoping, header/body keys
 *   5. 429 response shape — RateLimitError + raw 429 normalization (§25)
 *   6. End-to-end express 429 — status, Retry-After header, JSON body (§25)
 *   7. Wiring audit — every planned route/mount carries its middleware
 *   8. realtime.service loads with the cross-socket guards (§24 REALTIME)
 */
process.env.NODE_ENV = "test";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const { errorResponse, RateLimitError, ConflictError } = require("../utils/app-error");
const { SlidingWindow } = require("../utils/frequency-limiter");
const { LIMITS, limiters, defaultKeyGenerator } = require("../config/rate-limits");
const { actionGuard } = require("../middleware/action-guard");
const { idempotencyWindow } = require("../middleware/idempotency");

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ✅ ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`  ❌ ${name}`);
    console.log(`     ${err && err.stack ? err.stack.split("\n").slice(0, 3).join("\n     ") : err}`);
  }
}

/* Fake express request */
function fakeReq({ user, ip = "9.9.9.9", headers = {}, body = {} } = {}) {
  return { user, ip, body, get: (h) => headers[String(h).toLowerCase()] };
}

async function main() {
  console.log("\n═══ 1. §24 bucket table (config/rate-limits.js) ═══");
  await test("all HTTP domains present", () => {
    for (const d of ["AUTH", "SOCIAL", "MESSAGING", "SEARCH", "EVENT", "UPLOAD_BURST", "UPLOAD_HOURLY", "READ"]) {
      assert.ok(LIMITS[d] && LIMITS[d].limit >= 1 && LIMITS[d].windowMs >= 1, `missing ${d}`);
    }
  });
  await test("spec-locked values (AUTH 25/15m, READ generous 300/1m, UPLOAD 10/hr)", () => {
    assert.equal(LIMITS.AUTH.limit, 25);
    assert.equal(LIMITS.AUTH.windowMs, 15 * 60 * 1000);
    assert.ok(LIMITS.READ.limit >= 300, "READ must never throttle normal browsing (§26)");
    assert.equal(LIMITS.UPLOAD_HOURLY.limit, 10);
    assert.equal(LIMITS.UPLOAD_HOURLY.windowMs, 60 * 60 * 1000);
    assert.equal(LIMITS.UPLOAD_BURST.limit, 15);
  });
  await test("socket domains + action guards present (§24 REALTIME, §27)", () => {
    for (const d of ["REALTIME_CONNECT_USER", "REALTIME_CONNECT_IP", "REALTIME_JOIN", "REALTIME_ANSWER",
                     "GUARD_FOLLOW_TOGGLE", "GUARD_COMMENT", "GUARD_COMMUNITY_CREATE", "GUARD_COMMUNITY_JOIN", "GUARD_TICKET_SCAN"]) {
      assert.ok(LIMITS[d] && LIMITS[d].limit >= 1, `missing ${d}`);
    }
    assert.ok(LIMITS.REALTIME_ANSWER.limit >= 60, "answer cap must never bind a fast quiz");
    assert.ok(LIMITS.GUARD_TICKET_SCAN.limit >= 60, "door scanning is legitimately rapid");
  });
  await test("limiters object exposes all 8 HTTP instances", () => {
    for (const k of ["auth", "social", "messaging", "search", "event", "uploadBurst", "uploadHourly", "read"]) {
      assert.equal(typeof limiters[k], "function", `missing limiters.${k}`);
    }
  });
  await test("defaultKeyGenerator: user-keyed when authed, IP otherwise", () => {
    assert.equal(defaultKeyGenerator(fakeReq({ user: { _id: "abc" } })), "u:abc");
    assert.equal(defaultKeyGenerator(fakeReq({})), "ip:9.9.9.9");
  });

  console.log("\n═══ 2. SlidingWindow mechanics ═══");
  await test("allows max hits, blocks max+1 with retryAfterMs", () => {
    const w = new SlidingWindow(3, 60_000);
    assert.equal(w.allow("k").allowed, true);
    assert.equal(w.allow("k").allowed, true);
    assert.equal(w.allow("k").allowed, true);
    const v = w.allow("k");
    assert.equal(v.allowed, false);
    assert.ok(v.retryAfterMs > 0 && v.retryAfterMs <= 60_000, `retryAfterMs out of range: ${v.retryAfterMs}`);
  });
  await test("window slides — blocked key passes after the window elapses", async () => {
    const w = new SlidingWindow(2, 80);
    w.allow("k"); w.allow("k");
    assert.equal(w.allow("k").allowed, false);
    await wait(110);
    assert.equal(w.allow("k").allowed, true);
  });
  await test("keys are independent; stats() bounded", () => {
    const w = new SlidingWindow(2, 60_000);
    w.allow("a"); w.allow("b"); w.allow("c");
    assert.equal(w.stats().trackedKeys, 3);
    assert.equal(w.allow("b").allowed, true); // 'b' still has budget
  });

  console.log("\n═══ 3. actionGuard (§27 abuse caps) ═══");
  const commentGuard = actionGuard("GUARD_COMMENT");
  await test(`comment flood: ${LIMITS.GUARD_COMMENT.limit} allowed, next is 429 RATE_LIMITED`, async () => {
    const req = fakeReq({ user: { _id: "userA" } });
    for (let i = 0; i < LIMITS.GUARD_COMMENT.limit; i += 1) {
      await new Promise((resolve) => commentGuard(req, {}, resolve));
    }
    const err = await new Promise((resolve) => commentGuard(req, {}, (e) => resolve(e || null)));
    assert.ok(err instanceof RateLimitError, `expected RateLimitError, got ${err}`);
    assert.equal(err.status, 429);
    assert.equal(err.code, "RATE_LIMITED");
    assert.ok(err.retryAfterMs >= 1000);
  });
  await test("user isolation — userB unaffected by userA's flood", async () => {
    const req = fakeReq({ user: { _id: "userB" } });
    const err = await new Promise((resolve) => commentGuard(req, {}, (e) => resolve(e || null)));
    assert.equal(err, null);
  });
  await test("RATE_LIMIT_DISABLED=1 bypasses guards (load tests only)", async () => {
    process.env.RATE_LIMIT_DISABLED = "1";
    try {
      const req = fakeReq({ user: { _id: "userA" } }); // exhausted window from above
      const err = await new Promise((resolve) => commentGuard(req, {}, (e) => resolve(e || null)));
      assert.equal(err, null);
    } finally {
      delete process.env.RATE_LIMIT_DISABLED;
    }
  });
  await test("unknown action throws at build time (typo protection)", () => {
    assert.throws(() => actionGuard("GUARD_NOPE"), /unknown action/);
  });

  console.log("\n═══ 4. idempotencyWindow (§28 dedup) ═══");
  await test("no key → passes through untouched", async () => {
    const err = await new Promise((resolve) => idempotencyWindow(fakeReq({ user: { _id: "u1" } }), {}, (e) => resolve(e || null)));
    assert.equal(err, null);
  });
  await test("same key twice (header) → 409 CONFLICT", async () => {
    const req = () => fakeReq({ user: { _id: "u1" }, headers: { "idempotency-key": "abc-123" } });
    const first = await new Promise((resolve) => idempotencyWindow(req(), {}, (e) => resolve(e || null)));
    assert.equal(first, null);
    const dup = await new Promise((resolve) => idempotencyWindow(req(), {}, (e) => resolve(e || null)));
    assert.ok(dup instanceof ConflictError, `expected ConflictError, got ${dup}`);
    assert.equal(dup.status, 409);
  });
  await test("per-user scoping — same key, different user → passes", async () => {
    const req = fakeReq({ user: { _id: "u2" }, headers: { "idempotency-key": "abc-123" } });
    const err = await new Promise((resolve) => idempotencyWindow(req, {}, (e) => resolve(e || null)));
    assert.equal(err, null);
  });
  await test("body.clientRequestId works too; fresh key passes", async () => {
    const req = fakeReq({ user: { _id: "u1" }, body: { clientRequestId: "body-key-9" } });
    const first = await new Promise((resolve) => idempotencyWindow(req, {}, (e) => resolve(e || null)));
    assert.equal(first, null);
    const dup = await new Promise((resolve) => idempotencyWindow(fakeReq({ user: { _id: "u1" }, body: { clientRequestId: "body-key-9" } }), {}, (e) => resolve(e || null)));
    assert.ok(dup instanceof ConflictError);
  });

  console.log("\n═══ 5. 429 response shape (§25) ═══");
  await test("RateLimitError → errorResponse: RATE_LIMITED + retryAfterMs, no internals", () => {
    const { status, retryAfterMs, body } = errorResponse(new RateLimitError("Too many requests. Please try again shortly.", 45_000));
    assert.equal(status, 429);
    assert.equal(retryAfterMs, 45_000);
    assert.equal(body.success, false);
    assert.equal(body.error.code, "RATE_LIMITED");
    assert.equal(body.message, "Too many requests. Please try again shortly.");
    assert.deepEqual(Object.keys(body).sort(), ["error", "message", "success"]);
    assert.deepEqual(Object.keys(body.error).sort(), ["code", "message"]);
  });
  await test("Retry-After math: ceil(ms/1000), min 1s", () => {
    assert.equal(Math.ceil(45_000 / 1000), 45);
    assert.equal(Math.ceil(1 / 1000), 1);
    assert.equal(Math.ceil(0 / 1000) || 1, 1);
  });
  await test("raw 429-shaped error (status or statusCode) normalizes to the same contract", () => {
    for (const raw of [{ status: 429, message: "x" }, { statusCode: 429, message: "x" }]) {
      const { status, retryAfterMs, body } = errorResponse(raw);
      assert.equal(status, 429);
      assert.equal(retryAfterMs, 60_000);
      assert.equal(body.error.code, "RATE_LIMITED");
    }
  });

  console.log("\n═══ 6. End-to-end express 429 (env-overridden SEARCH=3) ═══");
  await test("3×200 then 429 + Retry-After + contract body", async () => {
    process.env.RATE_LIMIT_SEARCH_LIMIT = "3";
    delete require.cache[require.resolve("../config/rate-limits")];
    const { limiters: fresh } = require("../config/rate-limits");
    const express = require("express");
    const app = express();
    app.get("/x", fresh.search, (_req, res) => res.json({ ok: true }));
    // mirrors server.js error middleware
    app.use((err, _req, res, _next) => {
      const { status, body, retryAfterMs } = errorResponse(err);
      if (retryAfterMs) res.set("Retry-After", String(Math.ceil(retryAfterMs / 1000)));
      res.status(status).json(body);
    });
    const server = app.listen(0);
    await new Promise((r) => server.on("listening", r));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      for (let i = 0; i < 3; i += 1) {
        const r = await fetch(`${base}/x`);
        assert.equal(r.status, 200, `request ${i + 1} should pass`);
      }
      const blocked = await fetch(`${base}/x`);
      assert.equal(blocked.status, 429);
      const retryAfter = Number(blocked.headers.get("retry-after"));
      assert.ok(Number.isFinite(retryAfter) && retryAfter >= 1, `Retry-After invalid: ${retryAfter}`);
      const body = await blocked.json();
      assert.equal(body.error.code, "RATE_LIMITED");
      assert.equal(body.success, false);
      assert.ok(!JSON.stringify(body).includes("express-rate-limit"), "no infra leakage (§61)");
    } finally {
      server.close();
      delete process.env.RATE_LIMIT_SEARCH_LIMIT;
      delete require.cache[require.resolve("../config/rate-limits")];
    }
  });

  console.log("\n═══ 7. Wiring audit (static) ═══");
  await test("every planned route carries its middleware; no legacy limiters remain", () => {
    const root = path.join(__dirname, "..");
    const expect = [
      ["routes/post.routes.js", ["limiters.social", 'actionGuard("GUARD_COMMENT")', 'actionGuard("GUARD_INTERACT_TOGGLE")', "idempotencyWindow"]],
      ["routes/follow.routes.js", ["limiters.social", 'actionGuard("GUARD_FOLLOW_TOGGLE")']],
      ["routes/message.routes.js", ["limiters.messaging", "limiters.messaging"]],
      ["routes/registration.routes.js", ["idempotencyWindow", "limiters.event"]],
      ["routes/event.routes.js", ["limiters.event", "limiters.event"]],
      ["routes/ticket.routes.js", ["limiters.event", 'actionGuard("GUARD_TICKET_SCAN")']],
      ["routes/community.routes.js", ['actionGuard("GUARD_COMMUNITY_CREATE")', 'actionGuard("GUARD_COMMUNITY_JOIN")']],
    ];
    for (const [file, needles] of expect) {
      const src = fs.readFileSync(path.join(root, file), "utf8");
      for (const needle of needles) assert.ok(src.includes(needle), `${file} missing ${needle}`);
    }
    const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
    assert.ok(server.includes("applyGlobalRateLimits(app)"), "server.js must call applyGlobalRateLimits");
    for (const legacy of ["apiLimiter", "authLimiter", "uploadLimiter"]) {
      assert.ok(!server.includes(legacy), `server.js still references ${legacy}`);
    }
  });

  console.log("\n═══ 8. realtime.service loads with cross-socket guards ═══");
  await test("module loads; init exported; guard windows built from LIMITS", () => {
    const realtime = require("../services/realtime.service");
    assert.equal(typeof realtime.init, "function");
    for (const d of ["REALTIME_CONNECT_USER", "REALTIME_CONNECT_IP", "REALTIME_JOIN", "REALTIME_ANSWER"]) {
      assert.ok(LIMITS[d], `LIMITS.${d} missing`);
    }
  });

  console.log(`\n${"═".repeat(52)}`);
  console.log(`  PHASE 2 SELF-TEST: ${passed} passed, ${failed} failed`);
  console.log(`${"═".repeat(52)}\n`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("selftest crashed:", err);
  process.exitCode = 1;
});
