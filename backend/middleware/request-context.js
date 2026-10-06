/**
 * Request Context Middleware (Part 5, Phase 1 — spec §56)
 * ─────────────────────────────────────────────────────────────
 * Gives every request an id, a stopwatch, and ONE structured access
 * log line on finish. Feeds the metrics service (§57).
 *
 * Logging rules (§56):
 *   • NEVER log: passwords, tokens, API keys, message/post contents,
 *     request bodies, headers, or query strings (tokens can hide there).
 *   • userId is included when the auth middleware has run (post-hoc).
 *   • Slow responses (>1500ms) log at warn level for quick triage.
 */

const crypto = require("crypto");
const metrics = require("../services/metrics.service");

const LOG_LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const configuredLevel = LOG_LEVELS[String(process.env.LOG_LEVEL || "info").toLowerCase()] ?? LOG_LEVELS.info;
const SLOW_MS = 1500;
// Health checks fire constantly (monitoring) — keep them out of the console
const QUIET_PATHS = new Set(["/api/health", "/"]);

function log(level, fields) {
  if (LOG_LEVELS[level] > configuredLevel) return;
  const line = JSON.stringify({ t: new Date().toISOString(), level, ...fields });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

function requestContext(req, res, next) {
  // Propagate an incoming request id (from the frontend/proxy) or mint one
  const incoming = String(req.headers["x-request-id"] || "").slice(0, 64).replace(/[^a-zA-Z0-9-]/g, "");
  req.id = incoming || crypto.randomUUID();
  req.startedAt = Date.now();

  res.setHeader("X-Request-Id", req.id);

  res.on("finish", () => {
    const ms = Date.now() - req.startedAt;
    metrics.recordLatency(ms);
    metrics.recordStatus(res.statusCode);

    if (QUIET_PATHS.has(req.path)) return;

    const fields = {
      requestId: req.id,
      op: `${req.method} ${req.path}`,
      status: res.statusCode,
      durationMs: ms,
    };
    // Populated when requireAuth ran for this request — safe (id only)
    if (req.user?.id) fields.userId = req.user.id;

    if (res.statusCode >= 500) log("error", fields);
    else if (ms > SLOW_MS || res.statusCode >= 400) log("warn", fields);
    else log("info", fields);
  });

  next();
}

module.exports = { requestContext, log };
