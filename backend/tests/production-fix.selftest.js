#!/usr/bin/env node
/**
 * Production Incident Fix — Regression Tests (Priority 5)
 * Verifies fixes from PRODUCTION_AUDIT_REPORT.md
 */

"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const FRONTEND = path.join(ROOT, "..", "frontend");

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
    failures.push(name);
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const read = (p) => fs.readFileSync(p, "utf8");

async function run() {
  console.log("=== Production Incident Fix Selftest ===");

  // 1. CORS middleware order
  sec("1. CORS middleware ordering (Priority 1)");
  const serverSrc = read(path.join(ROOT, "server.js"));
  const corsIndex = serverSrc.indexOf("app.use(cors(");
  const rateLimitIndex = serverSrc.indexOf("applyGlobalRateLimits");
  ok("CORS is defined", corsIndex !== -1);
  ok("Rate limiting is defined", rateLimitIndex !== -1);
  ok("CORS before rate limiting (so 429 has CORS headers)", corsIndex !== -1 && rateLimitIndex !== -1 && corsIndex < rateLimitIndex,
    `cors at ${corsIndex}, rateLimit at ${rateLimitIndex}`);
  ok("Preflight handler uses regex /.*/ for Express 5", serverSrc.includes("app.options(/.*/") || serverSrc.includes("app.options(/.*/,"),
    "needs app.options(/.*/) not '*'");
  ok("CORS allows credentials", serverSrc.includes("credentials: true"));
  ok("CORS exposes Retry-After header", serverSrc.includes("Retry-After"));

  // 2. Origin allowlist normalization
  sec("2. Origin allowlist normalization (Priority 1)");
  ok("normalizeOrigin function exists", serverSrc.includes("function normalizeOrigin"));
  ok("expandOrigins auto-includes apex and www", serverSrc.includes("teameklavya.xyz") && serverSrc.includes("www.teameklavya.xyz"));
  ok("Strips trailing slashes", serverSrc.includes("replace(/\\/+$/, '')") || serverSrc.includes("replace(/\\/+$/"));
  ok("Allowed origins logged", serverSrc.includes("[cors] Allowed origins"));

  // 3. Rate limiter split
  sec("3. Rate limiter split (Priority 3)");
  const rlSrc = read(path.join(ROOT, "config/rate-limits.js"));
  ok("AUTH_LOGIN limiter defined", rlSrc.includes("AUTH_LOGIN"));
  ok("AUTH_ME limiter defined", rlSrc.includes("AUTH_ME"));
  ok("AUTH_PASSWORD limiter defined", rlSrc.includes("AUTH_PASSWORD"));
  ok("authLogin limiter in limiters object", rlSrc.includes("authLogin:"));
  ok("authMe limiter in limiters object", rlSrc.includes("authMe:"));
  ok("authPassword limiter in limiters object", rlSrc.includes("authPassword:"));
  ok("Global auth limiter not mounted (per-route instead)", !rlSrc.includes('app.use("/api/auth", limiters.auth)'),
    "should not mount generic AUTH globally");
  ok("READ limiter still mounted", rlSrc.includes('app.use("/api", limiters.read)'));
  ok("AUTH_ME is generous 120/min", rlSrc.includes("AUTH_ME") && rlSrc.includes("120"));
  ok("AUTH_PASSWORD strict 5/15m", rlSrc.includes("AUTH_PASSWORD") && rlSrc.includes("limit: 5"));

  // 4. IPv6-safe key generator
  sec("4. IPv6-safe key generator (Priority 3)");
  const orgRegSrc = read(path.join(ROOT, "routes/organization-registration.routes.js"));
  ok("Uses ipKeyGenerator", orgRegSrc.includes("ipKeyGenerator"));
  ok("No direct req.ip without ipKeyGenerator", !/keyGenerator:\s*\(req\)\s*=>\s*{\s*[^}]*return id \?[^:]*: req\.ip;/.test(orgRegSrc),
    "old pattern req.ip directly should be gone");
  ok("Has handler with RateLimitError", orgRegSrc.includes("RateLimitError"));

  const authRoutesSrc = read(path.join(ROOT, "routes/auth.routes.js"));
  ok("auth.routes uses authLogin limiter", authRoutesSrc.includes("authLogin"));
  ok("auth.routes uses authMe limiter", authRoutesSrc.includes("authMe"));
  ok("auth.routes uses authPassword limiter", authRoutesSrc.includes("authPassword"));

  // 5. Frontend dedup and no retry on 429
  sec("5. Frontend dedup and retry fix (Priority 2 & 3)");
  const querySrc = read(path.join(FRONTEND, "src/lib/query.ts"));
  ok("isRetryable does NOT include 429", !querySrc.includes("status === 429") || querySrc.includes("Never auto-retry 429"),
    "should not retry 429");
  ok("Comment about Priority 3 fix", querySrc.includes("Priority 3 fix") || querySrc.includes("Never auto-retry 429"));
  ok("dedupedFetch exists", querySrc.includes("function dedupedFetch"));

  const sessionHookSrc = read(path.join(FRONTEND, "src/components/shell/use-session-user.ts"));
  ok("useSessionUser uses dedupedFetch", sessionHookSrc.includes("dedupedFetch"));
  ok("No pathname dependency (prevents refetch on route change)", !sessionHookSrc.includes("usePathname") || !sessionHookSrc.includes("[pathname]"),
    "should not depend on pathname");
  ok("Throttles focus sync", sessionHookSrc.includes("SYNC_THROTTLE_MS") || sessionHookSrc.includes("throttle"));
  ok("Uses queryCache for session", sessionHookSrc.includes("queryCache"));

  const adminLayoutSrc = read(path.join(FRONTEND, "src/app/admin/layout.tsx"));
  ok("Admin layout uses shared session query", adminLayoutSrc.includes("useSessionUser") || adminLayoutSrc.includes('["session"]'));
  ok("Admin layout uses dedupedFetch for event", adminLayoutSrc.includes("dedupedFetch"));
  ok("Admin layout does NOT have direct api.get(\"/auth/me\") as sole source", !/api\.get\("\/auth\/me"\)/.test(adminLayoutSrc) || adminLayoutSrc.includes("dedupedFetch"),
    "should use dedupedFetch, not raw api.get");

  // 6. DB initialization sequencing
  sec("6. DB initialization sequencing (Priority 4)");
  ok("initializeDatabase function exists", serverSrc.includes("async function initializeDatabase"));
  ok("connectDB awaited", serverSrc.includes("await connectDB()"));
  ok("Migrations awaited after DB", serverSrc.includes("await socialMigration.ensureUsernames") || serverSrc.includes("await asiaMigration.ensureAsiaIndexes"));
  ok("Boot function awaits DB after port binding (avoids Render timeout)", serverSrc.includes("await initializeDatabase()") && serverSrc.includes("httpServer.listen"), "should bind port then init DB");
  ok("No direct connectDB() without await at top level", !/^const connectDB.*\nconnectDB\(\);/m.test(serverSrc) || serverSrc.includes("await connectDB()"),
    "old pattern should be gone");

  const asiaSrc = read(path.join(ROOT, "migrations/asia-performance-indexes.migration.js"));
  ok("Asia indexes throws on no DB instead of silent skip", asiaSrc.includes("throw new Error") || asiaSrc.includes("No DB connection, cannot create indexes"));

  // 7. Production startup
  sec("7. Production startup (Priority 4)");
  const renderYaml = read(path.join(ROOT, "..", "render.yaml"));
  ok("render.yaml startCommand is npm start", renderYaml.includes("startCommand: npm start"));
  ok("render.yaml not using npm run dev", !renderYaml.includes("startCommand: npm run dev"));

  // 8. CORS preflight and headers on error responses
  sec("8. Error handling preserves CORS (Priority 1)");
  ok("Error handler after CORS", serverSrc.indexOf("errorResponse") > corsIndex);
  ok("Socket.IO CORS uses allowedOrigins", serverSrc.includes("io = new Server") && serverSrc.includes("allowedOrigins"));

  // 9. Registration idempotency
  sec("9. Registration idempotency");
  const regRoutes = read(path.join(ROOT, "routes/registration.routes.js"));
  ok("Registration uses idempotency", regRoutes.includes("idempotency") || regRoutes.includes("Idempotency"));

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  if (failures.length) {
    console.log("\nFailed:");
    failures.forEach((f) => console.log(`  - ${f}`));
    process.exit(1);
  } else {
    console.log("\nAll production fix checks passed ✅");
    process.exit(0);
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
