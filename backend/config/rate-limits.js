/**
 * Central rate-limit configuration + applier (Part 5, Phase 2 — spec §24–26)
 * ────────────────────────────────────────────────────────────
 * ONE file owns every bucket. server.js and route files only ever import
 * limiters from here — no ad-hoc numbers buried in routes.
 *
 * HTTP domains (§24):
 *   AUTH        login/signup/OTP — 25/15m (unchanged, spec-locked)
 *   SOCIAL      follow/like/comment/post/save — 30/min
 *   MESSAGING   message send — 20/min
 *   SEARCH      search queries — 30/min
 *   EVENT       registration/check-in/join — 20/min
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

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

const DEFAULTS = {
  /* ── HTTP domains (§24) ── */
  AUTH:          { limit: 25,  windowMs: 15 * MINUTE },
  SOCIAL:        { limit: 30,  windowMs: MINUTE },
  MESSAGING:     { limit: 20,  windowMs: MINUTE },
  SEARCH:        { limit: 30,  windowMs: MINUTE },
  EVENT:         { limit: 20,  windowMs: MINUTE },
  UPLOAD_BURST:  { limit: 15,  windowMs: 10 * MINUTE },
  UPLOAD_HOURLY: { limit: 10,  windowMs: HOUR },
  READ:          { limit: 300, windowMs: MINUTE },

  /* ── Socket-side (§24 REALTIME) — consumed by realtime.service.js.
   * The per-socket cooldowns already in the engine stay; these add the
   * cross-socket per-user/IP dimension (reconnect storms, join spam). ── */
  REALTIME_CONNECT_USER: { limit: 10, windowMs: MINUTE },
  REALTIME_CONNECT_IP:   { limit: 30, windowMs: MINUTE },
  REALTIME_JOIN:         { limit: 15, windowMs: MINUTE },
  REALTIME_ANSWER:       { limit: 60, windowMs: MINUTE }, // never binds a fast quiz; kills multi-socket spam

  /* ── Action guards (§27) — on top of unique indexes + domain buckets ── */
  GUARD_FOLLOW_TOGGLE:    { limit: 20, windowMs: MINUTE },   // follow/unfollow loop cap
  GUARD_INTERACT_TOGGLE:  { limit: 20, windowMs: MINUTE },   // like/unlike + save/unsave loop cap
  GUARD_COMMENT:          { limit: 10, windowMs: MINUTE },   // comment flood cap
  GUARD_COMMUNITY_CREATE: { limit: 3,  windowMs: HOUR },     // community-create cooldown
  GUARD_COMMUNITY_JOIN:   { limit: 15, windowMs: MINUTE },   // join/leave loop cap
  GUARD_TICKET_SCAN:      { limit: 60, windowMs: MINUTE },   // door scanning is legitimately rapid
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

/**
 * Realtime CONCURRENCY caps (Part 5, Phase 6 — spec §43).
 * ─────────────────────────────────────────────────────────────────────────
 * The rate windows above bound how OFTEN a client may connect. These bound
 * how many connections may exist AT ONCE. Both are required: a client that
 * reconnects every 8 seconds never trips a per-minute rate window, yet it
 * still accumulates sockets without bound — and every socket costs memory
 * and event-loop time on a single small instance.
 *
 * Deliberately NOT in `DEFAULTS`: that table is iterated into `{limit,
 * windowMs}` limiter configs, and these are plain counts. Kept separate and
 * env-overridable on the same pattern.
 */
const CAP_DEFAULTS = {
  /** Tabs/devices one authenticated user may hold open simultaneously. */
  SOCKETS_PER_USER: 5,
  /**
   * Sockets from one IP at once. Higher than per-user because a classroom,
   * office or carrier NAT legitimately shares an address — but bounded, so
   * one NAT cannot occupy every slot.
   */
  SOCKETS_PER_IP: 20,
  /** Participants that may sit in one event room (config per §43). */
  PARTICIPANTS_PER_ROOM: 500,
  /** A room with zero sockets is reaped once idle this long. */
  IDLE_ROOM_TTL_MS: 30 * MINUTE,
  /** How often the stale-socket sweep runs. */
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
  return rateLimit({
    windowMs,
    limit,
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
  auth: createLimiter("AUTH"),
  social: createLimiter("SOCIAL"),
  messaging: createLimiter("MESSAGING"),
  search: createLimiter("SEARCH"),
  event: createLimiter("EVENT"),
  uploadBurst: createLimiter("UPLOAD_BURST"),
  uploadHourly: createLimiter("UPLOAD_HOURLY"),
  read: createLimiter("READ"),
};

/**
 * Prefix-level wiring (called from server.js BEFORE route mounts):
 *   /api          → READ (generous browsing bucket, §26)
 *   /api/auth     → AUTH (covers both auth.routes and google.routes)
 *   /api/search   → SEARCH
 *   /api/upload   → UPLOAD burst + hourly session cap (§23)
 * Action-scoped domains (SOCIAL/MESSAGING/EVENT) are mounted inside their
 * route files so list/browse endpoints stay under READ only.
 */
function applyGlobalRateLimits(app) {
  app.use("/api", limiters.read);
  app.use("/api/auth", limiters.auth);
  app.use("/api/search", limiters.search);
  app.use("/api/upload", limiters.uploadBurst, limiters.uploadHourly);
}

module.exports = {
  LIMITS,
  REALTIME_CAPS,
  limiters,
  applyGlobalRateLimits,
  createLimiter,
  defaultKeyGenerator,
  isRateLimitingDisabled,
};
