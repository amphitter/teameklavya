#!/usr/bin/env node
/**
 * EventHub Load Test Harness (Part 7, §20)
 * ────────────────────────────────────────
 * Runs profiles A–H against a running EventHub and reports p50/p95/p99, error
 * rate, throughput, cache hit ratio and outbox lag.
 *
 * WHY THIS EXISTS INSTEAD OF k6
 * ─────────────────────────────
 * The obvious choice is k6. It is not installed here and adding a binary
 * dependency to a project that runs on Render's free tier is a real cost.
 * More importantly, a load test nobody can run is a load test that never
 * runs. This harness is dependency-free — it uses only Node's `http` and
 * `WebSocket` — so `npm run load-test` works anywhere Node does.
 *
 * Node 20 needs `--experimental-websocket` for profile C (Socket.IO). The
 * npm script sets it. HTTP-only profiles work without the flag.
 *
 * USAGE
 *   npm run load-test -- --profile A --base-url http://localhost:5000
 *   npm run load-test -- --profile C --base-url http://localhost:5000 --sockets 500
 *   npm run load-test -- --profile A --json out.json
 *   npm run load-test -- --list
 *
 * Profiles F (2h soak) and G (flush Redis) are deliberately NOT default-runnable:
 * F takes two hours and G destroys cache. Both are opt-in and say so.
 *
 * This is a measuring instrument, not a gate. It reports; `perf-guard.js`
 * decides pass/fail against budgets.
 */
"use strict";

const http = require("http");
const https = require("https");
const { URL } = require("url");

/* ── CLI ─────────────────────────────────────────────────────────────── */

function parseArgs(argv) {
  const out = {
    profile: "A",
    baseUrl: process.env.LOAD_BASE_URL || "http://localhost:5000",
    duration: null,
    rps: null,
    sockets: null,
    concurrency: null,
    json: null,
    list: false,
    token: process.env.LOAD_AUTH_TOKEN || "",
    allowDestructive: false,
    redisFlushUrl: process.env.LOAD_REDIS_FLUSH_URL || "",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case "--profile": case "-p": out.profile = next(); break;
      case "--base-url": case "-b": out.baseUrl = next(); break;
      case "--duration": case "-d": out.duration = Number(next()); break;
      case "--rps": out.rps = Number(next()); break;
      case "--sockets": out.sockets = Number(next()); break;
      case "--concurrency": out.concurrency = Number(next()); break;
      case "--json": out.json = next(); break;
      case "--token": out.token = next(); break;
      case "--list": out.list = true; break;
      case "--allow-destructive": out.allowDestructive = true; break;
      case "--redis-flush-url": out.redisFlushUrl = next(); break;
      case "--help": case "-h": out.list = true; break;
      default: break;
    }
  }
  return out;
}

/* ── Profiles ────────────────────────────────────────────────────────── */

/**
 * Each profile is a shape, a duration and a set of endpoints with weights.
 * `destructive` profiles are refused unless --allow-destructive is passed.
 */
const PROFILES = {
  A: {
    name: "Browse",
    blurb: "100 rps, 95% reads — cache hit ratio and the read path",
    duration: 60, rps: 100, concurrency: 40,
    weights: [
      ["GET", "/api/events?limit=20", 40],
      ["GET", "/api/events/trending?limit=10", 20],
      ["GET", "/api/posts/feed?limit=20", 20],
      ["GET", "/api/communities?limit=20", 10],
      ["GET", "/api/search?q=tech&limit=10", 10],
    ],
  },
  B: {
    name: "Registration burst",
    blurb: "500 users registering inside 60s — write contention, idempotency",
    duration: 60, rps: 60, concurrency: 50,
    weights: [
      ["GET", "/api/events?limit=20", 30],
      ["POST", "/api/registration", 70],
    ],
    needsAuth: true,
    note: "Requires a real event id via --event-id; otherwise exercises the validation path.",
  },
  C: {
    name: "Live activity",
    blurb: "500 participants joining one live activity — Socket.IO fan-out, the hardest case",
    duration: 60, sockets: 500,
    socket: true,
    needsAuth: true,
  },
  D: {
    name: "Feed scroll",
    blurb: "Sustained paginated reads — keyset pagination, N+1 regressions",
    duration: 60, rps: 80, concurrency: 30,
    weights: [
      ["GET", "/api/posts/feed?limit=20", 50],
      ["GET", "/api/events?limit=20", 50],
    ],
    paginate: true,
  },
  E: {
    name: "Write-heavy mix",
    blurb: "50/50 read/write — outbox throughput, cache invalidation",
    duration: 60, rps: 60, concurrency: 30,
    weights: [
      ["GET", "/api/events?limit=20", 25],
      ["GET", "/api/posts/feed?limit=20", 25],
      ["POST", "/api/posts", 25],
      ["POST", "/api/registration", 25],
    ],
    needsAuth: true,
  },
  F: {
    name: "Sustained soak",
    blurb: "Profile A for 2 hours — memory leaks, connection exhaustion",
    duration: 7200, rps: 100, concurrency: 40,
    destructive: "takes two hours",
    weights: [
      ["GET", "/api/events?limit=20", 40],
      ["GET", "/api/events/trending?limit=10", 20],
      ["GET", "/api/posts/feed?limit=20", 20],
      ["GET", "/api/communities?limit=20", 10],
      ["GET", "/api/search?q=tech&limit=10", 10],
    ],
  },
  G: {
    name: "Cache cold-start",
    blurb: "Flush Redis, then A — that a Redis failure does not break the app",
    duration: 90, rps: 100, concurrency: 40,
    destructive: "flushes the Redis cache",
    flushRedis: true,
    weights: [
      ["GET", "/api/events?limit=20", 40],
      ["GET", "/api/events/trending?limit=10", 20],
      ["GET", "/api/posts/feed?limit=20", 20],
      ["GET", "/api/communities?limit=20", 10],
      ["GET", "/api/search?q=tech&limit=10", 10],
    ],
  },
  H: {
    name: "Multi-instance",
    blurb: "Two API instances sharing Redis — horizontal consistency of limits, locks, idempotency",
    duration: 60, rps: 100, concurrency: 40,
    splitTraffic: true,
    weights: [
      ["GET", "/api/events?limit=20", 40],
      ["GET", "/api/events/trending?limit=10", 20],
      ["GET", "/api/posts/feed?limit=20", 20],
      ["GET", "/api/communities?limit=20", 10],
      ["GET", "/api/search?q=tech&limit=10", 10],
    ],
    note: "Pass a comma-separated --base-url to split across instances.",
  },
};

/* ── Latency recording ───────────────────────────────────────────────── */

/**
 * Reservoir of latencies. Storing every sample is fine for a minute but not
 * for profile F's two hours, so we keep a bounded reservoir and note that
 * percentiles from it are approximate. Honest approximation beats a number
 * that quietly runs out of memory halfway through a soak.
 */
class Reservoir {
  constructor(capacity = 200000) {
    this.capacity = capacity;
    this.samples = [];
    this.seen = 0;
  }
  add(ms) {
    this.seen += 1;
    if (this.samples.length < this.capacity) this.samples.push(ms);
    else {
      const i = Math.floor(Math.random() * this.seen);
      if (i < this.capacity) this.samples[i] = ms;
    }
  }
  percentile(p) {
    if (!this.samples.length) return 0;
    const sorted = this.samples.slice().sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
    return sorted[idx];
  }
  get count() { return this.seen; }
}

/* ── HTTP worker ─────────────────────────────────────────────────────── */

function request(target, method, path, { token = "", timeout = 15000, body = null } = {}) {
  return new Promise((resolve) => {
    const started = process.hrtime.bigint();
    let u;
    try {
      u = new URL(path, target);
    } catch {
      resolve({ ok: false, status: 0, ms: 0, error: "bad url" });
      return;
    }
    const lib = u.protocol === "https:" ? https : http;
    const payload = body ? JSON.stringify(body) : null;
    const headers = { accept: "application/json" };
    if (payload) {
      headers["content-type"] = "application/json";
      headers["content-length"] = Buffer.byteLength(payload);
    }
    if (token) headers.authorization = `Bearer ${token}`;

    const req = lib.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method,
        headers,
        // Load tests open many sockets; keep-alive would pool them and make
        // the test measure the pool rather than the server.
        agent: new (u.protocol === "https:" ? https : http).Agent({ keepAlive: false }),
      },
      (res) => {
        let bytes = 0;
        res.on("data", (c) => { bytes += c.length; });
        res.on("end", () => {
          const ms = Number(process.hrtime.bigint() - started) / 1e6;
          // 429 is a *correct* answer under load, not a server error. Counting
          // it as an error would make the harness report failure precisely
          // when the rate limiter is doing its job.
          const status = res.statusCode;
          resolve({
            ok: status < 400 || status === 429,
            status,
            ms,
            bytes,
            rateLimited: status === 429,
          });
        });
      }
    );
    req.setTimeout(timeout, () => {
      req.destroy();
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      resolve({ ok: false, status: 0, ms, error: "timeout" });
    });
    req.on("error", (err) => {
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      resolve({ ok: false, status: 0, ms, error: err.code || err.message });
    });
    if (payload) req.write(payload);
    req.end();
  });
}

function pickWeighted(weights) {
  const total = weights.reduce((a, w) => a + w[2], 0);
  let r = Math.random() * total;
  for (const [method, path, w] of weights) {
    r -= w;
    if (r <= 0) return [method, path];
  }
  return [weights[0][0], weights[0][1]];
}

/* ── Runner ──────────────────────────────────────────────────────────── */

async function runHttpProfile(profile, opts, targets) {
  const durationMs = (opts.duration || profile.duration) * 1000;
  const targetRps = opts.rps || profile.rps;
  const concurrency = opts.concurrency || profile.concurrency || 20;

  const latencies = new Reservoir();
  const statusCounts = new Map();
  let requests = 0;
  let errors = 0;
  let rateLimited = 0;
  let bytes = 0;
  const errorSamples = [];

  const started = Date.now();
  let targetIndex = 0;
  const nextTarget = () => {
    if (targets.length === 1) return targets[0];
    targetIndex = (targetIndex + 1) % targets.length;
    return targets[targetIndex];
  };

  // A cursor shared by the pagination profile, so successive reads walk
  // forward instead of all requesting page 1.
  let cursor = "";

  async function worker() {
    const interval = 1000 / Math.max(1, targetRps / concurrency);
    while (Date.now() - started < durationMs) {
      const tick = Date.now();
      const [method, rawPath] = pickWeighted(profile.weights);
      let path = rawPath;

      if (profile.paginate && cursor) {
        path += (path.includes("?") ? "&" : "?") + `cursor=${encodeURIComponent(cursor)}`;
      }
      if (method === "POST" && /registration/.test(path) && opts.eventId) {
        path = `/api/registration`;
      }

      const body =
        method === "POST"
          ? /registration/.test(path)
            ? { eventId: opts.eventId || "000000000000000000000000", answers: [] }
            : { content: `load test ${Date.now()}` }
          : null;

      const res = await request(nextTarget(), method, path, { token: opts.token, body });

      latencies.add(res.ms);
      requests += 1;
      bytes += res.bytes || 0;
      statusCounts.set(res.status, (statusCounts.get(res.status) || 0) + 1);
      if (res.rateLimited) rateLimited += 1;
      if (!res.ok) {
        errors += 1;
        if (errorSamples.length < 5) errorSamples.push(`${method} ${path} → ${res.status} ${res.error || ""}`);
      }
      // Walk the pagination cursor forward on a plausible-looking response.
      if (profile.paginate && res.ok && Math.random() < 0.3) {
        cursor = String(Date.now());
      }

      const elapsed = Date.now() - tick;
      if (elapsed < interval) await sleep(interval - elapsed);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));

  const wall = (Date.now() - started) / 1000;
  return summarise({
    profile: opts.profile,
    name: profile.name,
    wall,
    requests,
    errors,
    rateLimited,
    bytes,
    latencies,
    statusCounts,
    errorSamples,
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function summarise({ profile, name, wall, requests, errors, rateLimited, bytes, latencies, statusCounts, errorSamples }) {
  const p50 = latencies.percentile(50);
  const p95 = latencies.percentile(95);
  const p99 = latencies.percentile(99);
  const errRate = requests ? errors / requests : 0;
  return {
    profile,
    name,
    wallSeconds: Number(wall.toFixed(1)),
    requests,
    rps: Number((requests / Math.max(wall, 0.001)).toFixed(1)),
    p50: Number(p50.toFixed(1)),
    p95: Number(p95.toFixed(1)),
    p99: Number(p99.toFixed(1)),
    errorRate: Number((errRate * 100).toFixed(3)),
    errors,
    rateLimited,
    mbReceived: Number((bytes / 1048576).toFixed(2)),
    statusCounts: Object.fromEntries([...statusCounts.entries()].sort()),
    errorSamples,
  };
}

/* ── Profile C — Socket.IO ───────────────────────────────────────────── */

/**
 * Profile C delegates to tests/live.load.js.
 *
 * That harness already exists, is already proven at 500 clients, and boots
 * its own server + in-memory Mongo for a fully controlled live-activity
 * scenario. Writing a second Socket.IO client here — a hand-rolled Engine.IO
 * implementation with no test coverage — would mean maintaining two versions
 * of the hardest part of the system, one of them untested. Reuse wins.
 *
 * It also already handles the thing that trips people up: every client
 * originates from 127.0.0.1, so the whole run shares ONE IP bucket and the
 * realtime caps throttle it at 20 sockets. The :100/:500 scripts raise those
 * caps, deliberately and visibly.
 */
async function runSocketProfile(profile, opts) {
  const count = opts.sockets || profile.sockets || 100;
  const { spawnSync } = require("child_process");

  const env = {
    ...process.env,
    LIVE_LOAD_CLIENTS: String(count),
    REALTIME_CAP_SOCKETS_PER_IP: String(count + 200),
    RATE_LIMIT_REALTIME_CONNECT_IP_LIMIT: String(count + 200),
  };

  console.log(`  delegating to tests/live.load.js with ${count} clients…`);
  const started = Date.now();
  const res = spawnSync(process.execPath, [require("path").join(__dirname, "..", "tests", "live.load.js")], {
    env,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const wall = (Date.now() - started) / 1000;

  const output = `${res.stdout || ""}${res.stderr || ""}`;
  // Surface the harness's own summary rather than inventing a second format.
  const summary = output.split("\n").filter((l) => /client|socket|join|answer|broadcast|✅|❌|PASS|FAIL/i.test(l)).slice(-25);

  return {
    profile: "C",
    name: profile.name,
    delegatedTo: "tests/live.load.js",
    socketsRequested: count,
    exitCode: res.status,
    wallSeconds: Number(wall.toFixed(1)),
    passed: res.status === 0,
    // The real verdicts (success rates, fan-out integrity, p50/p95) are in the
    // child's output — reproduced verbatim rather than re-summarised, because
    // a summary of a summary is where details get lost.
    childOutput: summary,
  };
}

function httpText(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    lib.get(url, (res) => {
      let body = "";
      res.on("data", (c) => { body += c; });
      res.on("end", () => resolve(body));
    }).on("error", reject);
  });
}

/* ── Metrics enrichment (cache hit ratio, outbox lag) ────────────────── */

/**
 * Pull the app's own view of itself after the run. Latency alone cannot tell
 * you whether a fast profile was fast because of caching or in spite of it.
 */
async function collectAppMetrics(baseUrl, token) {
  const out = {};
  for (const [key, path] of [
    ["cache", "/api/admin/metrics/cache"],
    ["outbox", "/api/admin/outbox/stats"],
    ["system", "/api/admin/system/health"],
  ]) {
    try {
      const res = await request(baseUrl, "GET", path, { token, timeout: 5000 });
      if (res.status === 200) {
        // Re-request to capture body (request() discards it for speed).
        const body = await httpText(new URL(path, baseUrl).toString()).catch(() => null);
        if (body) {
          try { out[key] = JSON.parse(body); } catch { out[key] = { raw: body.slice(0, 200) }; }
        }
      } else {
        out[key] = { unavailable: true, status: res.status };
      }
    } catch (err) {
      out[key] = { unavailable: true, error: err.message };
    }
  }
  return out;
}

/* ── Reporting ───────────────────────────────────────────────────────── */

function printReport(result, appMetrics) {
  console.log("\n══════════════════════════════════════════════════════════════");
  console.log(`  LOAD REPORT — profile ${result.profile} (${result.name})`);
  console.log("══════════════════════════════════════════════════════════════");

  if (result.skipped) {
    console.log(`  SKIPPED: ${result.reason}`);
    return;
  }
  if (result.delegatedTo) {
    console.log(`  delegated to      : ${result.delegatedTo}`);
    console.log(`  clients requested : ${result.socketsRequested}`);
    console.log(`  exit code         : ${result.exitCode} (${result.passed ? "PASS" : "FAIL"})`);
    console.log(`  wall time         : ${result.wallSeconds}s`);
    console.log("  ── child harness output ──");
    for (const line of result.childOutput) console.log(`  ${line}`);
    console.log("══════════════════════════════════════════════════════════════\n");
    return;
  }
  if (result.socketsRequested !== undefined) {
    console.log(`  sockets requested : ${result.socketsRequested}`);
    console.log(`  sockets connected : ${result.socketsConnected}`);
    console.log(`  sockets failed    : ${result.socketsFailed}`);
    console.log(`  connect p50/p95/p99: ${result.connectP50} / ${result.connectP95} / ${result.connectP99} ms`);
    if (result.errorSamples?.length) console.log(`  errors: ${result.errorSamples.join("; ")}`);
    return;
  }

  console.log(`  duration          : ${result.wallSeconds}s`);
  console.log(`  requests          : ${result.requests} (${result.rps} rps)`);
  console.log(`  p50 / p95 / p99   : ${result.p50} / ${result.p95} / ${result.p99} ms`);
  console.log(`  error rate        : ${result.errorRate}%  (${result.errors} errors)`);
  console.log(`  rate limited (429): ${result.rateLimited}  ← correct behaviour, not an error`);
  console.log(`  data received     : ${result.mbReceived} MB`);
  console.log(`  status codes      : ${JSON.stringify(result.statusCounts)}`);
  if (result.errorSamples?.length) {
    console.log("  error samples     :");
    for (const e of result.errorSamples) console.log(`    · ${e}`);
  }
  if (appMetrics && Object.keys(appMetrics).length) {
    console.log(`  app metrics       : ${JSON.stringify(appMetrics).slice(0, 300)}`);
  }
  console.log("══════════════════════════════════════════════════════════════\n");
}

/* ── Main ────────────────────────────────────────────────────────────── */

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.list) {
    console.log("\nAvailable profiles:\n");
    for (const [id, p] of Object.entries(PROFILES)) {
      const flag = p.destructive ? `  [DESTRUCTIVE: ${p.destructive}]` : "";
      console.log(`  ${id}  ${p.name.padEnd(20)} ${p.blurb}${flag}`);
    }
    console.log("\nOptions: --base-url --duration --rps --concurrency --sockets --token --json");
    console.log("         --allow-destructive (required for F and G)\n");
    return;
  }

  const profile = PROFILES[opts.profile.toUpperCase()];
  if (!profile) {
    console.error(`Unknown profile "${opts.profile}". Run with --list.`);
    process.exit(2);
  }
  opts.profile = opts.profile.toUpperCase();

  if (profile.destructive && !opts.allowDestructive) {
    console.error(
      `\nProfile ${opts.profile} is destructive (${profile.destructive}).\n` +
      `It is not something you run by accident. Re-run with --allow-destructive.\n`
    );
    process.exit(2);
  }

  const targets = opts.baseUrl.split(",").map((s) => s.trim()).filter(Boolean);
  console.log(`\n▶ profile ${opts.profile} (${profile.name}) → ${targets.join(", ")}`);
  console.log(`  ${profile.blurb}`);

  if (opts.profile === "H" && targets.length < 2) {
    console.log("  ⚠ H expects two instances: --base-url http://a:5000,http://b:5000");
  }
  if (profile.needsAuth && !opts.token) {
    console.log("  ⚠ this profile is more meaningful with --token <jwt> (writes will 401)");
  }

  // Profile G: flush the cache first, then measure the cold path.
  if (profile.flushRedis && opts.redisFlushUrl) {
    console.log("  flushing Redis…");
    try {
      await request(opts.redisFlushUrl, "POST", "/", { timeout: 5000 });
    } catch (err) {
      console.log(`  ⚠ flush failed: ${err.message}`);
    }
  }

  const result = profile.socket
    ? await runSocketProfile(profile, opts)
    : await runHttpProfile(profile, opts, targets);

  const appMetrics = opts.token ? await collectAppMetrics(targets[0], opts.token) : {};
  printReport(result, appMetrics);

  if (opts.json) {
    require("fs").writeFileSync(opts.json, JSON.stringify({ result, appMetrics }, null, 2));
    console.log(`  written to ${opts.json}\n`);
  }

  // This harness measures; it does not gate. perf-guard.js is the gate.
  // ...except for profile C, where the child harness asserts correctness
  // itself (success rates and broadcast fan-out must be 100%). Propagate that.
  if (result.delegatedTo && !result.passed) process.exit(1);
}

if (require.main === module) main().catch((err) => {
  console.error("\nload-test failed:", err && err.message);
  process.exit(1);
});

module.exports = { PROFILES, Reservoir, summarise, request };
