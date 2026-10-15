/**
 * Central rate-limit configuration + applier (Part 5, Phase 2 — spec §24–26)
 * ────────────────────────────────────────────────────────────
 * ONE file owns every bucket. server.js and route files only ever import
 * limiters from here — no ad-hoc numbers buried in routes.
 *
 * HTTP domains (§24):
 *   AUTH        login/signup/OTP — 25/15m (legacy, kept for compat)
 *   AUTH_LOGIN  login/signup — 15/15m strict per IP (brute-force protection)
 *   AUTH_ME     session check — 120/min generous per user (dashboard)
 *   AUTH_PASSWORD password forgot/reset — 5/15m strict
 *   SOCIAL      follow/like/comment/post/save — 30/min
 *   MESSAGING   message send — 20/min
 *   SEARCH      search queries — 30/min
 *   EVENT       registration/check-in/join — 20/min
 *   COMMUNICATION email fan-outs — 5/15m per authenticated actor
 *   UPLOAD      15/10m burst + 10/hr session cap (§23)
 *   READ        generous browsing bucket on /api — must never throttle
 *               normal use, including the frontend polling loops (§26)
 *
 * Socket domains (§24 REALTIME) + action guards (§27) live here too —
 * they are consumed by realtime.service.js and middleware/action-guard.js.
 *
 * 429s surface as RateLimitError → errorResponse() →
 *   { error: { code: "RATE_LIMITED", message } } + Retry-After header (§25).
 * No infrastructure details leak (§61/§64).
 *
 * Optional env overrides (documented in .env.example, Phase 8):
 *   RATE_LIMIT_DISABLED=1                 bypass ALL limiters (local load tests only)
 *   RATE_LIMIT_<DOMAIN>_LIMIT / _WINDOW_MS  per-bucket override,
 *                                          e.g. RATE_LIMIT_SEARCH_LIMIT=60
 */
const rateLimit = require("express-rate-limit").rateLimit || require("express-rate-limit");
const { ipKeyGenerator } = require("express-rate-limit");
const { RateLimitError } = require("../utils/app-error");
const metrics = require("../services/metrics.service");
const { rateLimitBackend } = require("../providers/redis/sliding-window.store");
const { SlidingWindowStore } = require("../providers/redis/rate-limit-store.adapter");

/** domain -> the store that limiter was built with (tests + dashboard). */
const limiterStores = new Map();

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

const DEFAULTS = {
  /* ── HTTP domains (§24) ── */
  AUTH:          { limit: 25,  windowMs: 15 * MINUTE }, // legacy compat
  AUTH_LOGIN:    { limit: 15,  windowMs: 15 * MINUTE }, // login/signup strict, per IP
  AUTH_ME:       { limit: 120, windowMs: MINUTE },       // session check generous, per user ID
  AUTH_PASSWORD: { limit: 5,   windowMs: 15 * MINUTE },  // password forgot/reset very strict
  SOCIAL:        { limit: 30,  windowMs: MINUTE },
  MESSAGING:     { limit: 20,  windowMs: MINUTE },
  SEARCH:        { limit: 30,  windowMs: MINUTE },
  EVENT:         { limit: 20,  windowMs: MINUTE },
  COMMUNICATION: { limit: 5,   windowMs: 15 * MINUTE },
  UPLOAD_BURST:  { limit: 15,  windowMs: 10 * MINUTE },
  UPLOAD_HOURLY: { limit: 10,  windowMs: HOUR },
  READ:          { limit: 300, windowMs: MINUTE },

  /* ── Socket-side (§24 REALTIME) ── */
  REALTIME_CONNECT_USER: { limit: 10, windowMs: MINUTE },
  REALTIME_CONNECT_IP:   { limit: 30, windowMs: MINUTE },
  REALTIME_JOIN:         { limit: 15, windowMs: MINUTE },
  REALTIME_ANSWER:       { limit: 60, windowMs: MINUTE },
  REALTIME_TYPING:       { limit: 40, windowMs: MINUTE },

  /* ── Action guards (§27) ── */
  GUARD_FOLLOW_TOGGLE:    { limit: 20, windowMs: MINUTE },
  GUARD_INTERACT_TOGGLE:  { limit: 20, windowMs: MINUTE },
  GUARD_COMMENT:          { limit: 10, windowMs: MINUTE },
  GUARD_COMMUNITY_CREATE: { limit: 3,  windowMs: HOUR },
  GUARD_COMMUNITY_JOIN:   { limit: 15, windowMs: MINUTE },
  GUARD_TICKET_SCAN:      { limit: 60, windowMs: MINUTE },
};

const isRateLimitingDisabled = () => process.env.RATE_LIMIT_DISABLED === "1";

function envOverride(domain, cfg) {
  const limit = Number(process.env[`RATE_LIMIT_${domain}_LIMIT`]);
  const windowMs = Number(process.env[`RATE_LIMIT_${domain}_WINDOW_MS`]);
  return {
    limit: Number.isFinite(limit) && limit > 0 ? limit : cfg.limit,
    windowMs: Number.isFinite(windowMs) && windowMs > 0 ? windowMs : cfg.windowMs,
  };
}

const CAP_DEFAULTS = {
  SOCKETS_PER_USER: 5,
  SOCKETS_PER_IP: 20,
  PARTICIPANTS_PER_ROOM: 500,
  IDLE_ROOM_TTL_MS: 30 * MINUTE,
  SWEEP_INTERVAL_MS: 5 * MINUTE,
};

const REALTIME_CAPS = {};
for (const [name, value] of Object.entries(CAP_DEFAULTS)) {
  const raw = Number(process.env[`REALTIME_CAP_${name}`]);
  REALTIME_CAPS[name] = Number.isFinite(raw) && raw > 0 ? raw : value;
}

const LIMITS = {};
for (const [domain, cfg] of Object.entries(DEFAULTS)) {
  LIMITS[domain] = envOverride(domain, cfg);
}

/**
 * Key by user when authenticated, else IP (server runs with trust proxy = 1,
 * so req.ip is the real client address behind Render's proxy).
 * ipKeyGenerator canonicalizes IPv6 (mapped-IPv4 → dotted quad, IPv6 → /56
 * network form) so suffix-rotating IPv6 clients can't bypass limits.
 */
function defaultKeyGenerator(req) {
  const id = req.user && (req.user._id || req.user.id);
  if (id) return `u:${id}`;
  const ip = req.ip || (req.socket && req.socket.remoteAddress);
  if (!ip) return "ip:unknown";
  return `ip:${ipKeyGenerator(ip)}`;
}

/** Build one express-rate-limit instance for a domain, raising RateLimitError. */
function createLimiter(domain) {
  if (isRateLimitingDisabled()) {
    return (_req, _res, next) => next();
  }
  const { limit, windowMs } = LIMITS[domain];

  const store = new SlidingWindowStore({
    backend: rateLimitBackend(),
    domain,
    limit,
    windowMs,
  });

  limiterStores.set(domain, store);

  return rateLimit({
    windowMs,
    limit,
    store,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    keyGenerator: defaultKeyGenerator,
    handler: (req, _res, next) => {
      metrics.recordRateLimit(domain);
      const resetTime = req.rateLimit && req.rateLimit.resetTime;
      const retryAfterMs =
        resetTime instanceof Date ? Math.max(1000, resetTime.getTime() - Date.now()) : windowMs;
      next(new RateLimitError("Too many requests. Please try again shortly.", retryAfterMs));
    },
  });
}

const limiters = {
  auth: createLimiter("AUTH"), // legacy, kept but not mounted globally
  authLogin: createLimiter("AUTH_LOGIN"),
  authMe: createLimiter("AUTH_ME"),
  authPassword: createLimiter("AUTH_PASSWORD"),
  social: createLimiter("SOCIAL"),
  messaging: createLimiter("MESSAGING"),
  search: createLimiter("SEARCH"),
  event: createLimiter("EVENT"),
  communication: createLimiter("COMMUNICATION"),
  uploadBurst: createLimiter("UPLOAD_BURST"),
  uploadHourly: createLimiter("UPLOAD_HOURLY"),
  read: createLimiter("READ"),
};

/**
 * Prefix-level wiring (called from server.js BEFORE route mounts):
 *   /api          → READ (generous browsing bucket, §26)
 *   /api/search   → SEARCH
 *   /api/upload   → UPLOAD burst + hourly session cap (§23)
 *   /api/auth/*   → specific limiters mounted inside auth.routes.js:
 *     - login/signup -> AUTH_LOGIN (15/15m per IP, brute-force protection)
 *     - /me        -> AUTH_ME (120/min per user, generous for dashboard)
 *     - password/* -> AUTH_PASSWORD (5/15m strict)
 * Action-scoped domains (SOCIAL/MESSAGING/EVENT) are mounted inside their
 * route files so list/browse endpoints stay under READ only.
 */
function applyGlobalRateLimits(app) {
  app.use("/api", limiters.read);
  app.use("/api/search", limiters.search);
  app.use("/api/upload", limiters.uploadBurst, limiters.uploadHourly);
  // Auth limiters are mounted per-route in auth.routes.js for granularity
}

module.exports = {
  LIMITS,
  DEFAULTS,
  REALTIME_CAPS,
  rateLimitBackend,
  limiterStores,
  limiters,
  applyGlobalRateLimits,
  createLimiter,
  defaultKeyGenerator,
  isRateLimitingDisabled,
};
