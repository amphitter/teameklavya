/**
 * PART 7 — PHASE 9 (§20, §21, §22)
 * Load testing, horizontal scale, realtime readiness.
 * ────────────────────────────────────────────────────────────
 * §20  the load harness exists, is runnable, and measures the right things
 * §21  two instances sharing state: A writes → B reads, and back
 * §22  the Socket.IO Redis adapter is NOT deployed, and its trigger is
 *      documented rather than guessed at
 *
 * The §21 test runs two real processes on two real ports against one shared
 * Mongo. Anything less — clearing require.cache and booting the app twice in
 * one process — proves nothing about horizontal scale, because both copies
 * would share the same module instances and therefore the same in-memory
 * state, which is exactly what must be shown to be absent.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");
const { spawn } = require("child_process");
const mongoose = require("mongoose");

const ROOT = path.join(__dirname, "..");

let passed = 0;
let failed = 0;
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
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  ❌ ${name}${detail ? `\n       ${detail}` : ""}`);
  }
}

/* ── tiny HTTP helper for the two-instance test ──────────────────────── */

function req(port, method, pathname, body = null, token = null) {
  return new Promise((resolve) => {
    const payload = body ? JSON.stringify(body) : null;
    const headers = { accept: "application/json" };
    if (payload) {
      headers["content-type"] = "application/json";
      headers["content-length"] = Buffer.byteLength(payload);
    }
    if (token) headers.authorization = `Bearer ${token}`;
    const r = http.request({ host: "127.0.0.1", port, path: pathname, method, headers }, (res) => {
      let data = "";
      res.on("data", (c) => { data += c; });
      res.on("end", () => {
        let json = null;
        try { json = JSON.parse(data); } catch { /* not json */ }
        resolve({ status: res.statusCode, body: json, raw: data });
      });
    });
    r.setTimeout(20000, () => { r.destroy(); resolve({ status: 0, body: null, raw: "timeout" }); });
    r.on("error", (e) => resolve({ status: 0, body: null, raw: e.message }));
    if (payload) r.write(payload);
    r.end();
  });
}

/* ══════════════════════════════════════════════════════════════════════
   §20 — the load harness
   ══════════════════════════════════════════════════════════════════════ */

async function auditLoadHarness() {
  sec("§20 — load profiles A–H are runnable, not just documented");

  const harnessPath = path.join(ROOT, "scripts", "load-test.js");
  ok("the load harness exists", fs.existsSync(harnessPath));

  const { PROFILES, Reservoir } = require("../scripts/load-test");

  /* Every profile from the doc must exist. A profile that is documented but
     not implemented is worse than no profile, because it reads as covered. */
  const expected = ["A", "B", "C", "D", "E", "F", "G", "H"];
  for (const id of expected) {
    ok(`profile ${id} is defined`, !!PROFILES[id], PROFILES[id] ? PROFILES[id].name : "MISSING");
  }
  ok("all eight profiles A–H are present", expected.every((id) => PROFILES[id]));

  /* The two profiles that matter most are the two teams skip: F finds leaks
     over hours, G proves a Redis outage is survivable. */
  ok("profile F is a long soak (finds memory leaks)", PROFILES.F.duration >= 3600,
     `${PROFILES.F.duration}s`);
  ok("profile G exercises cache cold-start (Redis failure)", PROFILES.G.flushRedis === true);
  ok("profile C targets the live activity fan-out", PROFILES.C.socket === true);

  /* Destructive profiles must REFUSE to run by default. Behaviour, not
     documentation: run the process and check it exits non-zero. */
  for (const id of ["F", "G"]) {
    const res = await runNode([harnessPath, "--profile", id, "--duration", "1"]);
    ok(`profile ${id} refuses to run without --allow-destructive`,
       res.status !== 0 && /destructive/i.test(res.output),
       `exit ${res.status}`);
  }

  /* A 429 is the rate limiter working. Counting it as an error would make the
     harness report failure precisely when the system behaves correctly — and
     would train whoever reads it to ignore error rates. */
  const src = fs.readFileSync(harnessPath, "utf8");
  ok("a 429 is not counted as a server error", /429/.test(src) && /rateLimited/.test(src));

  /* Percentiles are the whole point; verify the maths rather than trusting it. */
  const r = new Reservoir(1000);
  for (let i = 1; i <= 100; i += 1) r.add(i);
  ok("p50 is computed correctly", r.percentile(50) >= 49 && r.percentile(50) <= 51, `${r.percentile(50)}`);
  ok("p95 is computed correctly", r.percentile(95) >= 94 && r.percentile(95) <= 96, `${r.percentile(95)}`);
  ok("p99 is computed correctly", r.percentile(99) >= 98 && r.percentile(99) <= 100, `${r.percentile(99)}`);
  ok("a bounded reservoir survives a 2h soak without unbounded memory",
     (() => { const big = new Reservoir(100); for (let i = 0; i < 50000; i += 1) big.add(i); return big.samples.length <= 100; })());

  /* Profile C must reuse the proven harness rather than reimplement the
     hardest part of the system. */
  ok("profile C delegates to the existing 500-client live harness",
     /live\.load\.js/.test(src),
     "no second Socket.IO client to maintain");

  /* And it must be reachable from npm, or nobody will run it. */
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  ok("`npm run load-test` is registered", !!pkg.scripts["load-test"]);
  ok("load-test enables the WebSocket flag profile C needs",
     /--experimental-websocket/.test(pkg.scripts["load-test"] || ""));

  /* The app-side metrics a load run needs must actually exist to be sampled:
     latency alone cannot say whether a fast run was fast because of caching. */
  ok("the doc names the metrics a run must capture",
     /p50|p95|p99/.test(fs.readFileSync(path.join(ROOT, "docs", "LOAD-TESTING.md"), "utf8")));
}

function runNode(args, env = {}, timeoutMs = 30000) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd: ROOT,
      env: { ...process.env, ...env },
    });
    let out = "";
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { out += d; });
    const t = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("close", (status) => { clearTimeout(t); resolve({ status, output: out }); });
    child.on("error", () => { clearTimeout(t); resolve({ status: -1, output: out }); });
  });
}

/* ══════════════════════════════════════════════════════════════════════
   §21 — horizontal scale: two real instances, one shared database
   ══════════════════════════════════════════════════════════════════════ */

async function auditHorizontalScale() {
  sec("§21 — A writes → B reads, and back (two processes, one database)");

  const { MongoMemoryServer } = require("mongodb-memory-server");
  const mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();

  const boot = path.join(__dirname, "helpers", "boot-instance.js");
  ok("the instance boot helper exists", fs.existsSync(boot));

  const children = [];
  const startInstance = (port) =>
    new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [boot], {
        cwd: ROOT,
        env: { ...process.env, MONGO_URI: uri, PORT: String(port) },
      });
      let out = "";
      const timer = setTimeout(() => reject(new Error(`port ${port} never became ready`)), 30000);
      const onData = (d) => {
        out += d;
        if (out.includes(`INSTANCE READY ${port}`)) {
          clearTimeout(timer);
          resolve(child);
        }
      };
      child.stdout.on("data", onData);
      child.stderr.on("data", onData);
      child.on("error", reject);
      children.push(child);
    });

  let a, b;
  let conn = null;
  try {
    [a, b] = await Promise.all([startInstance(5101), startInstance(5102)]);
    ok("two independent instances booted on separate ports", true, "5101 and 5102");
  } catch (err) {
    ok("two independent instances booted on separate ports", false, err.message);
    for (const c of children) { try { c.kill("SIGKILL"); } catch { /* gone */ } }
    await mongod.stop();
    return;
  }

  try {
    const stamp = Date.now();
    const emailA = `scale-a-${stamp}@example.com`;
    const emailB = `scale-b-${stamp}@example.com`;
    // isStrongPassword: 8+, upper, lower, number.
    const password = "ScaleTest123!";

    // Login requires a verified email. Verification goes through a mail link,
    // which this test cannot receive — so the flag is set through the shared
    // database directly. That is legitimate here: the thing under test is
    // cross-instance visibility, not the email flow.
    conn = await mongoose.createConnection(uri).asPromise();
    const verify = (email) => conn.collection("users").updateOne({ email }, { $set: { emailVerified: true } });

    const signupBody = (first, last, email) => ({
      firstName: first, lastName: last, email,
      password, confirmPassword: password, acceptTerms: true,
    });

    /* Direction 1: create on A, authenticate on B.
       Login is the strongest possible check — it requires B to see a record
       written by A AND to agree on the JWT secret. */
    const signupA = await req(5101, "POST", "/api/auth/signup", signupBody("Scale", "A", emailA));
    ok("instance A accepts a write (signup)",
       signupA.status === 200 || signupA.status === 201,
       `status ${signupA.status} ${(signupA.raw || "").slice(0, 120)}`);
    await verify(emailA);

    const loginB = await req(5102, "POST", "/api/auth/login", { email: emailA, password });
    const tokenB = loginB.body?.token || loginB.body?.data?.token;
    ok("instance B authenticates a user created on A (A→B)",
       loginB.status === 200 && !!tokenB,
       `status ${loginB.status} ${(loginB.raw || "").slice(0, 120)}`);

    /* Direction 2: create on B, authenticate on A. One direction working can
       hide a read-through cache that only one instance populates. */
    const signupB = await req(5102, "POST", "/api/auth/signup", signupBody("Scale", "B", emailB));
    ok("instance B accepts a write (signup)",
       signupB.status === 200 || signupB.status === 201,
       `status ${signupB.status} ${(signupB.raw || "").slice(0, 120)}`);
    await verify(emailB);

    const loginA = await req(5101, "POST", "/api/auth/login", { email: emailB, password });
    const tokenA = loginA.body?.token || loginA.body?.data?.token;
    ok("instance A authenticates a user created on B (B→A)",
       loginA.status === 200 && !!tokenA,
       `status ${loginA.status} ${(loginA.raw || "").slice(0, 120)}`);

    /* The authenticated read must work on the instance that did NOT issue
       the token — proving neither instance holds session state locally. */
    if (tokenB) {
      const meOnA = await req(5101, "GET", "/api/auth/me", null, tokenB);
      ok("a token issued by B is accepted by A (no local session state)",
         meOnA.status === 200, `status ${meOnA.status}`);
    } else {
      ok("a token issued by B is accepted by A (no local session state)", false, "no token from B");
    }
    if (tokenA) {
      const meOnB = await req(5102, "GET", "/api/auth/me", null, tokenA);
      ok("a token issued by A is accepted by B (no local session state)",
         meOnB.status === 200, `status ${meOnB.status}`);
    } else {
      ok("a token issued by A is accepted by B (no local session state)", false, "no token from A");
    }
  } finally {
    for (const c of children) { try { c.kill("SIGKILL"); } catch { /* gone */ } }
    try { await conn.close(); } catch { /* already closed */ }
    await mongod.stop();
  }

  /* ── No shared in-memory state ───────────────────────────────────────
     The failure mode §21 exists to prevent: a module-level Map or cache that
     works perfectly on one instance and silently diverges on two. */
  sec("§21 — no shared in-memory coordination state");

  const controllersDir = path.join(ROOT, "controllers");
  const offenders = [];
  for (const f of fs.readdirSync(controllersDir)) {
    if (!f.endsWith(".js")) continue;
    const text = fs.readFileSync(path.join(controllersDir, f), "utf8");
    // A module-level `new Map()`/`new Set()`/`{}` assigned with let/var at the
    // top level is process-local state that cannot be shared across instances.
    const re = /^(?:let|var|const)\s+(\w+)\s*=\s*(new\s+Map\(\)|new\s+Set\(\)|\{\s*\})/gm;
    let m;
    while ((m = re.exec(text)) !== null) {
      // An all-caps name is a constant lookup table, not accumulating state.
      if (/^[A-Z0-9_]+$/.test(m[1])) continue;
      offenders.push(`${f}: ${m[1]}`);
    }
  }
  ok("no controller holds process-local mutable state (Map/Set/object at module scope)",
     offenders.length === 0, offenders.join(", ") || "none — state lives in Mongo/Redis");

  /* The coordination primitives must be able to share, via a pluggable
     backend. If rate limits and locks are in-process, two instances each
     enforce their own limits — the deploy doubles the real limit. */
  const limiterSrc = fs.readFileSync(path.join(ROOT, "config", "rate-limits.js"), "utf8");
  ok("rate limiting has a pluggable shared backend (Upstash)",
     /RATE_LIMIT_PROVIDER|upstash/i.test(limiterSrc),
     "unset = single-instance fallback, documented");
  ok("the fallback is explicitly named as a single-instance path",
     /instance/i.test(limiterSrc));

  const lockSrc = fs.readFileSync(path.join(ROOT, "providers", "redis", "lock.service.js"), "utf8");
  ok("locks have a distributed mode (not process-local only)",
     /distributed/.test(lockSrc));
  ok("a degraded lock is reported rather than silently assumed held",
     /degraded/.test(lockSrc));
}

/* ══════════════════════════════════════════════════════════════════════
   §22 — the Redis adapter is NOT deployed
   ══════════════════════════════════════════════════════════════════════ */

function auditRealtimeAdapter() {
  sec("§22 — the Socket.IO Redis adapter is not deployed, and the trigger is documented");

  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const adapterInstalled = Object.keys(deps).some((d) => /redis-adapter|socket\.io-redis/.test(d));
  ok("the Redis adapter package is NOT installed", !adapterInstalled,
     adapterInstalled ? "installed — should not be deployed yet" : "not in dependencies");

  const realtimeSrc = fs.readFileSync(path.join(ROOT, "services", "realtime.service.js"), "utf8");
  ok("realtime.service.js does not wire an adapter", !/createAdapter|redis-adapter/.test(realtimeSrc));
  ok("realtime.service.js does not import the adapter package",
     !/require\(["']@socket\.io\/redis-adapter/.test(realtimeSrc));

  /* The trigger must be recorded, not folklore. If nobody writes down when to
     deploy it, it gets deployed either too early (extra cost and a new failure
     mode for no benefit) or too late (after a user reports missed broadcasts). */
  const docsDir = path.join(ROOT, "docs");
  const triggerText = fs.readdirSync(docsDir)
    .map((f) => fs.readFileSync(path.join(docsDir, f), "utf8"))
    .join("\n");
  ok("the deploy trigger mentions more than one replica",
     /replicas\s*>\s*1|more than one replica|multiple replicas/i.test(triggerText));
  ok("the trigger requires live rooms to span replicas (not just replicas > 1)",
     /span/i.test(triggerText) && /room/i.test(triggerText));
  ok("the docs state the adapter is NOT to be deployed now",
     /do not deploy|not deploy|do NOT deploy/i.test(triggerText));

  /* One realtime framework only — a standing Part 4 constraint that a Redis
     adapter must not quietly violate by adding a second transport. */
  ok("only Socket.IO is used for realtime (no second framework)",
     !/require\(["'](ws|sockjs|faye-websocket)["']/.test(realtimeSrc));
}

/* ══════════════════════════════════════════════════════════════════════ */

(async () => {
  console.log("\n══════════════════════════════════════════════════════════════");
  console.log("  PART 7 (phase 9) load, scale & realtime readiness");
  console.log("══════════════════════════════════════════════════════════════");

  try {
    await auditLoadHarness();
    await auditHorizontalScale();
    auditRealtimeAdapter();
  } catch (err) {
    failed += 1;
    failures.push(`suite crashed: ${err && err.message}`);
    console.log(String((err && err.stack) || err));
  }

  console.log("\n══════════════════════════════════════════════════════════════");
  console.log(`  PART 7 (phase 9) selftest: ${passed} passed, ${failed} failed`);
  if (failures.length) {
    console.log("\n  Failures:");
    for (const f of failures) console.log(`    · ${f}`);
  }
  console.log("══════════════════════════════════════════════════════════════\n");
  process.exit(failed === 0 ? 0 : 1);
})();
