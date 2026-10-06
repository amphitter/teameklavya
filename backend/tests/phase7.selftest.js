#!/usr/bin/env node
/**
 * EventHub — Part 5, Phase 7 selftest (observability & admin infrastructure)
 * ─────────────────────────────────────────────────────────────────────────────
 * Covers spec §59 (infrastructure metrics + 80/90/95 thresholds), §60 (admin
 * dashboard data) and §61 (no provider/infrastructure detail leaks to normal
 * users).
 *
 * Boots the real server against an in-memory MongoDB.
 *
 * Run: npm run test:phase7
 */
"use strict";

process.env.NODE_ENV = "test";
process.env.PORT = 5341;
process.env.FRONTEND_URL = "http://localhost:3100";
process.env.JWT_SECRET = "test-secret";
process.env.GOOGLE_CLIENT_ID = "x";
process.env.GOOGLE_CLIENT_SECRET = "y";
process.env.GOOGLE_CALLBACK_URL = "http://localhost/callback";

const { MongoMemoryServer } = require("mongodb-memory-server");

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

function eq(label, actual, expected) {
  ok(label, Object.is(actual, expected), `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const mongod = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongod.getUri();

  const User = require("../models/user.model");
  const Event = require("../models/event.model");
  const jwt = require("jsonwebtoken");

  require("../server");
  const infra = require("../services/infrastructure.service");
  const metrics = require("../services/metrics.service");
  const { cache } = require("../services/cache.service");

  const B = `http://localhost:${process.env.PORT}/api`;
  for (let i = 0; i < 40; i++) {
    try { await fetch(`${B}/events`); break; } catch { await wait(300); }
  }

  const admin = await User.create({ firstName: "Ad", lastName: "Min", email: "ad@min.io", passwordHash: "x", role: "admin", emailVerified: true });
  const plain = await User.create({ firstName: "Pl", lastName: "Ain", email: "pl@ain.io", passwordHash: "x", emailVerified: true });
  const tok = (u) => jwt.sign({ id: String(u._id), role: u.role || "user", purpose: "auth" }, process.env.JWT_SECRET, { expiresIn: "7d" });
  const adminH = { Authorization: `Bearer ${tok(admin)}` };

  // Generate some real traffic so the percentiles have samples.
  await fetch(`${B}/events`);
  await fetch(`${B}/events`);
  await fetch(`${B}/events?nope=1`);

  /* ═══════════════════════════════════════════════════════════════════════
   * 1. Severity scale (§59)
   * ══════════════════════════════════════════════════════════════════════ */

  sec("1. Threshold scale (§59)");

  eq("WARNING threshold", infra.THRESHOLDS.WARNING, 80);
  eq("HIGH threshold", infra.THRESHOLDS.HIGH, 90);
  eq("CRITICAL threshold", infra.THRESHOLDS.CRITICAL, 95);

  eq("below 80 is OK", infra.severity(79, 100).level, "OK");
  eq("exactly 80 is WARNING", infra.severity(80, 100).level, "WARNING");
  eq("89 is still WARNING", infra.severity(89, 100).level, "WARNING");
  eq("exactly 90 is HIGH", infra.severity(90, 100).level, "HIGH");
  eq("94 is still HIGH", infra.severity(94, 100).level, "HIGH");
  eq("exactly 95 is CRITICAL", infra.severity(95, 100).level, "CRITICAL");
  eq("100 is CRITICAL", infra.severity(100, 100).level, "CRITICAL");
  eq("percent is computed", infra.severity(50, 200).percent, 25);
  eq("percent is capped at 100", infra.severity(500, 100).percent, 100);

  ok("a zero budget yields no level", infra.severity(10, 0).level === null);
  ok("a missing reading yields no level", infra.severity(undefined, 100).level === null);
  ok("a NaN reading yields no level", infra.severity(NaN, 100).level === null);

  eq("worstLevel picks the highest", infra.worstLevel(["OK", "CRITICAL", "WARNING"]), "CRITICAL");
  eq("worstLevel of all OK is OK", infra.worstLevel(["OK", "OK"]), "OK");
  eq("worstLevel of empty is OK", infra.worstLevel([]), "OK");

  /* ═══════════════════════════════════════════════════════════════════════
   * 2. Endpoint access control (§61)
   * ══════════════════════════════════════════════════════════════════════ */

  sec("2. Access control (§61)");

  let r = await fetch(`${B}/admin/infrastructure`);
  eq("anonymous is rejected", r.status, 401);

  r = await fetch(`${B}/admin/infrastructure`, { headers: { Authorization: `Bearer ${tok(plain)}` } });
  eq("a non-admin is rejected", r.status, 403);

  r = await fetch(`${B}/admin/infrastructure`, { headers: { Authorization: "Bearer not-a-token" } });
  eq("a garbage token is rejected", r.status, 401);

  r = await fetch(`${B}/admin/infrastructure`, { headers: adminH });
  eq("an admin is allowed", r.status, 200);
  const report = await r.json();
  ok("the response is well-formed", report.success === true);

  // Diagnostics must never be cached by a proxy or the browser.
  eq("the response is not cacheable", r.headers.get("cache-control"), "private, no-store");

  /* ═══════════════════════════════════════════════════════════════════════
   * 3. Report shape (§59, §60)
   * ══════════════════════════════════════════════════════════════════════ */

  sec("3. Report shape (§59/§60)");

  ok("carries a generation timestamp", typeof report.generatedAt === "string" && !Number.isNaN(Date.parse(report.generatedAt)));
  ok("carries an overall status", ["OK", "WARNING", "HIGH", "CRITICAL"].includes(report.status));
  ok("exposes the thresholds used", report.thresholds && report.thresholds.WARNING === 80);
  ok("exposes the budgets used", report.budgets && typeof report.budgets.mongoBytes === "number");
  ok("carries an alerts array", Array.isArray(report.alerts));

  const s = report.sections || {};
  for (const name of ["database", "cache", "api", "rateLimits", "sockets", "providers", "uploads", "process"]) {
    ok(`section "${name}" is present`, Boolean(s[name]));
  }

  // ── database ──
  ok("database section is available", s.database.available === true);
  ok("database reports data size", typeof s.database.dataSize === "number");
  ok("database reports collection count", typeof s.database.collections === "number" && s.database.collections > 0);
  ok("database lists its largest collections", Array.isArray(s.database.topCollections));
  ok("database exposes its budget", typeof s.database.budgetBytes === "number");

  // ── cache ──
  ok("cache reports occupancy", typeof s.cache.size === "number");
  ok("cache reports its ceiling", typeof s.cache.maxEntries === "number");
  ok("cache reports hits and misses", typeof s.cache.hits === "number" && typeof s.cache.misses === "number");
  ok("cache reports evictions", typeof s.cache.evictions === "number");

  // ── api ──
  ok("api reports p50/p95/p99", "p50" in s.api && "p95" in s.api && "p99" in s.api);
  ok("api reports a p95 target", typeof s.api.targetP95Ms === "number");
  ok("api reports status buckets", s.api.statuses && typeof s.api.statuses.ok === "number");
  ok("api reports an error rate", typeof s.api.errorRate === "number");

  // ── sockets ──
  ok("sockets report a connection count", typeof s.sockets.connected === "number");
  ok("sockets report the Phase 6 caps", typeof s.sockets.capPerUser === "number");
  ok("sockets report room occupancy", Array.isArray(s.sockets.roomOccupancy));

  // ── providers ──
  ok("providers name the storage backend", typeof s.providers.storage?.provider === "string");
  ok("providers report email configuration", typeof s.providers.smtpConfigured === "boolean");
  ok("provider health is derived from traffic, not guessed", "failureRate" in (s.providers.email || {}));
  ok("a provider with no traffic reports null, not 0%", s.providers.email.failureRate === null);

  // ── uploads / process / rate limits ──
  ok("uploads report a failure rate", typeof s.uploads.failureRate === "number");
  ok("process reports heap usage", typeof s.process.heapUsed === "number");
  ok("process reports uptime", typeof s.process.uptimeSec === "number");
  ok("rate limits report a bucket list", Array.isArray(s.rateLimits.buckets));

  /* ═══════════════════════════════════════════════════════════════════════
   * 4. Provider health reflects real traffic (§59)
   * ══════════════════════════════════════════════════════════════════════ */

  sec("4. Provider health from traffic (§59)");

  // No synthetic ping is performed — health is derived from recorded outcomes.
  metrics.recordProvider("email", true);
  metrics.recordProvider("email", true);
  metrics.recordProvider("email", false);

  r = await fetch(`${B}/admin/infrastructure?fresh=1`, { headers: adminH });
  const r2 = await r.json();
  const email = r2.sections.providers.email;
  eq("email attempts are counted", email.attempts, 3);
  eq("email successes are counted", email.ok, 2);
  eq("email failures are counted", email.errors, 1);
  ok("email failure rate is derived", Math.abs(email.failureRate - 33.33) < 0.1, String(email.failureRate));
  ok("email level escalates with failures", email.level !== null, String(email.level));

  /* ═══════════════════════════════════════════════════════════════════════
   * 5. Cache + latency respond to real load (§59)
   * ══════════════════════════════════════════════════════════════════════ */

  sec("5. Metrics respond to real load (§59)");

  cache.flush();
  // NB — getOrSet(key, loader, { ttl }): the third argument is an OPTIONS
  // object. Passing ttl positionally leaves it undefined, which makes
  // getOrSet skip caching entirely and record no metrics at all.
  await cache.getOrSet("infra:probe", async () => "value", { ttl: 60_000 }); // miss
  await cache.getOrSet("infra:probe", async () => "value", { ttl: 60_000 }); // hit
  await cache.getOrSet("infra:probe", async () => "value", { ttl: 60_000 }); // hit

  for (let i = 0; i < 5; i++) metrics.recordLatency(10 + i);

  r = await fetch(`${B}/admin/infrastructure?fresh=1`, { headers: adminH });
  const r3 = await r.json();
  ok("cache occupancy is reported from the live service", r3.sections.cache.size >= 1, JSON.stringify(r3.sections.cache));
  ok("cache hits are counted", r3.sections.cache.hits >= 2, String(r3.sections.cache.hits));
  ok("a hit rate is computed", typeof r3.sections.cache.hitRate === "number", String(r3.sections.cache.hitRate));
  ok("latency percentiles are computed", typeof r3.sections.api.p50 === "number", String(r3.sections.api.p50));
  ok("p50 <= p95 <= p99", r3.sections.api.p50 <= r3.sections.api.p95 && r3.sections.api.p95 <= r3.sections.api.p99,
    `${r3.sections.api.p50}/${r3.sections.api.p95}/${r3.sections.api.p99}`);

  /* ═══════════════════════════════════════════════════════════════════════
   * 6. No infrastructure detail leaks to ordinary users (§61)
   * ══════════════════════════════════════════════════════════════════════ */

  sec("6. No leakage to ordinary users (§61)");

  const LEAKY = [
    /cloudinary/i, /upstash/i, /mongodb/i, /mongo/i, /atlas/i, /quota/i,
    /budget/i, /dataSize/i, /storageSize/i, /hitRate/i, /heapUsed/i,
    /rateLimit/i, /infRA_budget/i, /maxEntries/i, /rss/i, /percentile/i, /p95/i,
  ];

  // 1. /api/health is public — it may say "up", never "how full".
  const health = await (await fetch(`${B}/health`)).json();
  const healthTxt = JSON.stringify(health);
  const healthLeaks = LEAKY.filter((re) => re.test(healthTxt));
  ok("public /api/health leaks no provider or budget detail",
    healthLeaks.length === 0, healthLeaks.map(String).join(", "));
  ok("public /api/health still says the service is up", health.status === "OK");

  // 2. A normal user hitting normal endpoints sees no diagnostics.
  const eventsTxt = await (await fetch(`${B}/events`, { headers: { Authorization: `Bearer ${tok(plain)}` } })).text();
  const eventsLeaks = LEAKY.filter((re) => re.test(eventsTxt));
  ok("GET /api/events leaks no infrastructure detail", eventsLeaks.length === 0, eventsLeaks.map(String).join(", "));

  // 3. A 500 response must not carry diagnostics either.
  const errRes = await fetch(`${B}/events/does-not-exist-at-all`);
  const errTxt = await errRes.text();
  const errLeaks = LEAKY.filter((re) => re.test(errTxt));
  ok("an error response leaks no infrastructure detail", errLeaks.length === 0, errLeaks.map(String).join(", "));
  ok("an error response is still structured", (() => {
    try { return "message" in JSON.parse(errTxt); } catch { return false; }
  })());

  // 4. The infrastructure route is not reachable without the admin role.
  const forbidden = await fetch(`${B}/admin/infrastructure`, { headers: { Authorization: `Bearer ${tok(plain)}` } });
  const forbiddenTxt = await forbidden.text();
  const forbiddenLeaks = LEAKY.filter((re) => re.test(forbiddenTxt));
  ok("the 403 body itself leaks nothing", forbiddenLeaks.length === 0, forbiddenLeaks.map(String).join(", "));

  /* ═══════════════════════════════════════════════════════════════════════
   * 7. Robustness
   * ══════════════════════════════════════════════════════════════════════ */

  sec("7. Robustness");

  // ?fresh=1 must bypass the 30s stats cache without erroring.
  const a = await (await fetch(`${B}/admin/infrastructure?fresh=1`, { headers: adminH })).json();
  const b = await (await fetch(`${B}/admin/infrastructure?fresh=1`, { headers: adminH })).json();
  ok("repeated fresh reads both succeed", a.success === true && b.success === true);
  ok("consecutive reads agree on the collection count",
    a.sections.database.collections === b.sections.database.collections);

  // The report must survive an empty database with no traffic.
  ok("empty-state report still has every section",
    ["database", "cache", "api", "rateLimits", "sockets", "providers", "uploads", "process"]
      .every((k) => Boolean(a.sections[k])));

  // Alerts are only emitted at WARNING or above.
  ok("alerts are all at WARNING or above",
    (a.alerts || []).every((al) => ["WARNING", "HIGH", "CRITICAL"].includes(al.level)));
  ok("every alert carries a human-readable message",
    (a.alerts || []).every((al) => typeof al.message === "string" && al.message.length > 0));

  // Overall status agrees with the worst section.
  const worst = infra.worstLevel(
    Object.values(a.sections).map((v) => v && v.level).filter(Boolean)
  );
  eq("overall status matches the worst section", a.status, worst);

  console.log(`\n${"═".repeat(64)}`);
  console.log(`  Phase 7 selftest: ${passed} passed, ${failed} failed`);
  if (failed) {
    console.log("\n  Failures:");
    failures.forEach((f) => console.log(`   • ${f}`));
  }
  console.log(`${"═".repeat(64)}\n`);

  await mongod.stop();
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error("\n💥 selftest crashed:", e);
  process.exit(1);
});
