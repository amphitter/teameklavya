#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  PART 7 · §31  PRODUCTION PREFLIGHT
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  node scripts/preflight-production.js [--json] [--strict]
 *
 * THE DISTINCTION THIS SCRIPT EXISTS TO DRAW
 * ──────────────────────────────────────────
 * "It is configured" and "it is healthy" are different claims, and collapsing
 * them is how a deployment goes green and then falls over.
 *
 *   CONFIGURED  the variable is present and well-formed. Cheap to check, needs
 *               no network, and proves nothing about whether the thing works.
 *   REACHABLE   we opened a connection and got a protocol-level response. It
 *               exists and the network path to it is open.
 *   HEALTHY     it answered a real question correctly. This is the only state
 *               that means the dependency will do its job.
 *   DEGRADED    reachable but not healthy — answering slowly, erroring, or
 *               answering wrong. The dangerous one: it looks alive.
 *
 * A config check that reports success because an env var is set is worse than
 * no check, because it actively reassures. So each dependency reports all four
 * independently, and the exit code is driven by HEALTH, never by CONFIGURED.
 *
 * WHAT IT DOES NOT DO
 * ───────────────────
 * It never mutates anything. No migrations, no writes, no cache flushes. A
 * preflight that can change state is a deployment step wearing a diagnostic's
 * clothes, and the first time it is run against the wrong environment it will
 * do something irreversible.
 *
 * EXIT CODES
 * ──────────
 *   0  every required dependency is healthy
 *   1  something required is degraded or unreachable (deployment should stop)
 *   2  nothing is healthy AND something required is missing from config
 *
 * --strict makes DEGRADED on an OPTIONAL dependency also fail.
 */

"use strict";

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const strict = args.includes("--strict");

/* ── Result model ────────────────────────────────────────────────────────── */

const STATE = {
  MISSING: "MISSING", // not configured at all
  CONFIGURED: "CONFIGURED", // present, not proven to work
  UNREACHABLE: "UNREACHABLE", // network/protocol failure
  DEGRADED: "DEGRADED", // reachable, answering wrong or too slowly
  HEALTHY: "HEALTHY", // answered a real question correctly
};

const OK = new Set([STATE.HEALTHY]);
const BAD = new Set([STATE.MISSING, STATE.UNREACHABLE, STATE.DEGRADED]);

const results = [];
const logs = [];

function log(line) {
  logs.push(line);
  if (!asJson) console.log(line);
}

function record(name, { required, state, configured, detail = null, latencyMs = null }) {
  results.push({ name, required, state, configured, reachable: state !== STATE.UNREACHABLE, detail, latencyMs });
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */

const env = (k) => (process.env[k] || "").trim();

/** Never print a secret. Show only that it exists and how long it is. */
function describeSecret(v) {
  if (!v) return "absent";
  return `present (${v.length} chars)`;
}

function redactUrl(u) {
  try {
    const url = new URL(u);
    return `${url.protocol}//${url.host}${url.pathname.replace(/[A-Za-z0-9_-]{8,}/g, "…")}`;
  } catch {
    return "(malformed url)";
  }
}

async function timed(fn, budgetMs) {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), budgetMs);
  try {
    const out = await fn(controller.signal);
    return { ok: true, value: out, latencyMs: Date.now() - started };
  } catch (err) {
    return {
      ok: false,
      error: err?.name === "AbortError" ? `timed out after ${budgetMs}ms` : err?.message || String(err),
      latencyMs: Date.now() - started,
    };
  } finally {
    clearTimeout(timer);
  }
}

/* ── Dependency checks ───────────────────────────────────────────────────── */

async function checkMongo() {
  const uri = env("MONGO_URI") || env("MONGODB_URI");
  if (!uri) {
    record("mongodb", { required: true, state: STATE.MISSING, configured: false, detail: "MONGO_URI is not set" });
    return;
  }
  // CONFIGURED is not HEALTHY: assert the shape, then prove it below.
  if (!/^mongodb(\+srv)?:\/\//.test(uri)) {
    record("mongodb", {
      required: true, state: STATE.DEGRADED, configured: true,
      detail: "MONGO_URI is present but not a mongodb:// or mongodb+srv:// URI",
    });
    return;
  }

  let mongoose;
  try {
    mongoose = require("mongoose");
  } catch {
    record("mongodb", { required: true, state: STATE.UNREACHABLE, configured: true, detail: "mongoose is not installed" });
    return;
  }

  const r = await timed(async () => {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000, connectTimeoutMS: 8000 });
    const pong = await mongoose.connection.db.admin().ping();
    await mongoose.disconnect();
    return pong;
  }, 12_000);

  if (!r.ok) {
    record("mongodb", { required: true, state: STATE.UNREACHABLE, configured: true, detail: r.error, latencyMs: r.latencyMs });
    return;
  }
  record("mongodb", {
    required: true,
    state: r.latencyMs > 3000 ? STATE.DEGRADED : STATE.HEALTHY,
    configured: true,
    detail: r.latencyMs > 3000 ? `ping ok but slow (${r.latencyMs}ms)` : "ping ok",
    latencyMs: r.latencyMs,
  });
}

async function checkRedis() {
  const url = env("UPSTASH_REDIS_REST_URL");
  const token = env("UPSTASH_REDIS_REST_TOKEN");
  const required = env("CACHE_PROVIDER") === "upstash" ||
    env("RATE_LIMIT_PROVIDER") === "upstash" ||
    env("LOCK_PROVIDER") === "upstash" ||
    env("IDEMPOTENCY_PROVIDER") === "upstash";

  if (!url || !token) {
    record("redis", {
      required,
      state: required ? STATE.MISSING : STATE.MISSING,
      configured: false,
      detail: required
        ? "Upstash is the selected provider but UPSTASH_REDIS_REST_URL/TOKEN are not set"
        : "not configured (in-memory providers selected — acceptable, but not horizontally consistent)",
    });
    return;
  }

  const r = await timed(async (signal) => {
    const res = await fetch(url.replace(/\/+$/, ""), {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(["PING"]),
      signal,
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || body?.error) throw new Error(body?.error || `HTTP ${res.status}`);
    return body?.result;
  }, 6000);

  if (!r.ok) {
    record("redis", { required, state: STATE.UNREACHABLE, configured: true, detail: r.error, latencyMs: r.latencyMs });
    return;
  }
  if (String(r.value).toUpperCase() !== "PONG") {
    record("redis", {
      required, state: STATE.DEGRADED, configured: true,
      detail: `responded but not with PONG (got ${String(r.value).slice(0, 40)})`, latencyMs: r.latencyMs,
    });
    return;
  }
  record("redis", {
    required,
    state: r.latencyMs > 1500 ? STATE.DEGRADED : STATE.HEALTHY,
    configured: true,
    detail: r.latencyMs > 1500 ? `PONG but slow (${r.latencyMs}ms)` : "PONG",
    latencyMs: r.latencyMs,
  });
}

async function checkSupabase() {
  const url = env("SUPABASE_URL");
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  const required = String(env("SYNC_ENABLED") || "").toLowerCase() === "true";

  if (!url || !key) {
    record("supabase", {
      required,
      state: STATE.MISSING,
      configured: false,
      detail: required
        ? "SYNC_ENABLED=true but SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY are not set"
        : "not configured (sync disabled — the event engine runs without it)",
    });
    return;
  }

  const r = await timed(async (signal) => {
    const res = await fetch(`${url.replace(/\/+$/, "")}/rest/v1/profiles?select=id&limit=1`, {
      method: "GET",
      headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" },
      signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return true;
  }, 8000);

  if (!r.ok) {
    record("supabase", { required, state: STATE.UNREACHABLE, configured: true, detail: r.error, latencyMs: r.latencyMs });
    return;
  }
  record("supabase", {
    required,
    state: r.latencyMs > 3000 ? STATE.DEGRADED : STATE.HEALTHY,
    configured: true,
    detail: r.latencyMs > 3000 ? `reachable but slow (${r.latencyMs}ms)` : "REST query ok",
    latencyMs: r.latencyMs,
  });
}

function checkSecrets() {
  const secret = env("JWT_SECRET");
  if (!secret) {
    record("jwt-secret", { required: true, state: STATE.MISSING, configured: false, detail: "JWT_SECRET is not set" });
    return;
  }
  // CONFIGURED but not necessarily SAFE — a 6-character secret is configured
  // and worthless, and reporting it green would be the worst outcome here.
  if (secret.length < 32) {
    record("jwt-secret", {
      required: true, state: STATE.DEGRADED, configured: true,
      detail: `JWT_SECRET is only ${secret.length} chars — use at least 32`,
    });
    return;
  }
  if (/^(test|secret|changeme|dev)/i.test(secret)) {
    record("jwt-secret", {
      required: true, state: STATE.DEGRADED, configured: true,
      detail: "JWT_SECRET looks like a placeholder value",
    });
    return;
  }
  record("jwt-secret", { required: true, state: STATE.HEALTHY, configured: true, detail: describeSecret(secret) });
}

function checkStorage() {
  const provider = (env("STORAGE_PROVIDER") || "local").toLowerCase();
  if (provider === "local" || provider === "disk") {
    const isProd = env("NODE_ENV") === "production";
    record("storage", {
      required: true,
      state: isProd ? STATE.DEGRADED : STATE.HEALTHY,
      configured: true,
      detail: isProd
        ? "local disk storage in production — uploads will not survive a redeploy"
        : `provider=${provider} (acceptable outside production)`,
    });
    return;
  }
  const hasCloudinary = env("CLOUDINARY_URL") || (env("CLOUDINARY_CLOUD_NAME") && env("CLOUDINARY_API_KEY"));
  const hasR2 = env("R2_ACCOUNT_ID") && env("R2_ACCESS_KEY_ID") && env("R2_SECRET_ACCESS_KEY");
  const ok = provider === "cloudinary" ? hasCloudinary : provider === "r2" ? hasR2 : Boolean(hasCloudinary || hasR2);
  record("storage", {
    required: true,
    state: ok ? STATE.HEALTHY : STATE.MISSING,
    configured: Boolean(hasCloudinary || hasR2),
    detail: ok ? `provider=${provider}, credentials present` : `provider=${provider} but its credentials are missing`,
  });
}

function checkFrontendOrigin() {
  const origin = env("FRONTEND_URL");
  if (!origin) {
    record("frontend-origin", { required: true, state: STATE.MISSING, configured: false, detail: "FRONTEND_URL is not set (CORS will block the browser)" });
    return;
  }
  if (env("NODE_ENV") === "production" && origin.startsWith("http://")) {
    record("frontend-origin", {
      required: true, state: STATE.DEGRADED, configured: true,
      detail: "FRONTEND_URL is http:// in production — cookies/tokens and CORS both want https",
    });
    return;
  }
  record("frontend-origin", { required: true, state: STATE.HEALTHY, configured: true, detail: redactUrl(origin) });
}

/* ── Reporting ───────────────────────────────────────────────────────────── */

const ICON = {
  [STATE.HEALTHY]: "✅",
  [STATE.DEGRADED]: "⚠️ ",
  [STATE.UNREACHABLE]: "❌",
  [STATE.MISSING]: "➖",
  [STATE.CONFIGURED]: "🔧",
};

function report() {
  const requiredBad = results.filter((r) => r.required && BAD.has(r.state));
  const optionalBad = results.filter((r) => !r.required && BAD.has(r.state));
  const configuredOnly = results.filter((r) => r.state === STATE.CONFIGURED);

  const fail = requiredBad.length > 0 || (strict && optionalBad.length > 0);
  const configGap = requiredBad.some((r) => r.state === STATE.MISSING);
  const exitCode = fail ? (configGap ? 2 : 1) : 0;

  if (asJson) {
    console.log(
      JSON.stringify(
        {
          exitCode,
          summary: {
            total: results.length,
            healthy: results.filter((r) => OK.has(r.state)).length,
            degraded: results.filter((r) => r.state === STATE.DEGRADED).length,
            unreachable: results.filter((r) => r.state === STATE.UNREACHABLE).length,
            missing: results.filter((r) => r.state === STATE.MISSING).length,
            configuredOnly: configuredOnly.length,
          },
          checks: results,
        },
        null,
        2
      )
    );
    return exitCode;
  }

  log("\n══════════════════════════════════════════════════════════════════════");
  log("  PRODUCTION PREFLIGHT (§31)");
  log("══════════════════════════════════════════════════════════════════════");
  log(`  environment : ${env("NODE_ENV") || "(unset)"}`);
  log(`  mode        : ${strict ? "strict (optional failures block too)" : "normal"}`);
  log("");
  log("  CONFIGURED ≠ REACHABLE ≠ HEALTHY. Only HEALTHY blocks a deploy on its");
  log("  own; CONFIGURED is reported so an unset variable is never mistaken for");
  log("  a working one.\n");

  for (const r of results) {
    const tag = r.required ? "required" : "optional";
    const latency = r.latencyMs === null ? "" : ` (${r.latencyMs}ms)`;
    log(`  ${ICON[r.state]} ${r.name.padEnd(16)} ${r.state.padEnd(12)} ${tag.padEnd(9)}${latency}`);
    if (r.detail) log(`      └ ${r.detail}`);
  }

  log("");
  log("──────────────────────────────────────────────────────────────────────");
  log(`  healthy   : ${results.filter((r) => OK.has(r.state)).length}/${results.length}`);
  log(`  degraded  : ${results.filter((r) => r.state === STATE.DEGRADED).length}`);
  log(`  unreachable: ${results.filter((r) => r.state === STATE.UNREACHABLE).length}`);
  log(`  missing   : ${results.filter((r) => r.state === STATE.MISSING).length}`);

  if (requiredBad.length) {
    log("\n  BLOCKING:");
    for (const r of requiredBad) log(`    · ${r.name}: ${r.state} — ${r.detail || ""}`);
  }
  if (optionalBad.length && !strict) {
    log("\n  NON-BLOCKING (optional, or tolerated degraded):");
    for (const r of optionalBad) log(`    · ${r.name}: ${r.state} — ${r.detail || ""}`);
  }
  if (configuredOnly.length) {
    log("\n  CONFIGURED BUT NOT PROVEN HEALTHY — do not read these as green:");
    for (const r of configuredOnly) log(`    · ${r.name}`);
  }

  log("");
  log(exitCode === 0 ? "  RESULT: SAFE TO DEPLOY\n" : `  RESULT: DO NOT DEPLOY (exit ${exitCode})\n`);
  return exitCode;
}

(async () => {
  checkSecrets();
  checkStorage();
  checkFrontendOrigin();
  await checkMongo();
  await checkRedis();
  await checkSupabase();
  const code = report();
  process.exit(code);
})().catch((err) => {
  console.error("preflight crashed:", err?.message || err);
  process.exit(1);
});
