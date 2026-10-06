/**
 * Per-user action-frequency guard (Part 5, Phase 2 — spec §27)
 * ────────────────────────────────────────────────────────────
 * Abuse caps for repeatable actions: follow/unfollow loops, comment floods,
 * community-create cooldown, ticket-scan throughput. Mounted AFTER requireAuth
 * so req.user is guaranteed → every user gets their own window.
 *
 * Layering (all three coexist):
 *   1. Unique compound indexes  — prevent duplicate rows (§28)
 *   2. Domain rate buckets      — cap aggregate request rates (§24)
 *   3. THIS guard               — caps the *pattern* (loop/flood/cooldown)
 *
 * Numbers live in config/rate-limits.js (env-overridable, one source of truth).
 */
const { SlidingWindow } = require("../utils/frequency-limiter");
const { RateLimitError } = require("../utils/app-error");
const metrics = require("../services/metrics.service");
const { LIMITS, isRateLimitingDisabled } = require("../config/rate-limits");

const windows = new Map(); // action -> SlidingWindow (one per process)

/**
 * Build an express middleware that caps `action` per user.
 * @param {string} action  key into LIMITS (GUARD_*), e.g. "GUARD_COMMENT"
 */
function actionGuard(action) {
  const cfg = LIMITS[action];
  if (!cfg) throw new Error(`actionGuard: unknown action "${action}" — add it to config/rate-limits.js`);
  if (!windows.has(action)) {
    windows.set(action, new SlidingWindow(cfg.limit, cfg.windowMs));
  }
  const win = windows.get(action);
  return (req, _res, next) => {
    if (isRateLimitingDisabled()) return next();
    const id = req.user && (req.user._id || req.user.id);
    const key = id ? `u:${id}` : `ip:${req.ip || "unknown"}`;
    const verdict = win.allow(key);
    if (!verdict.allowed) {
      metrics.recordRateLimit(action);
      return next(
        new RateLimitError("You're doing that too fast — take a short break.", verdict.retryAfterMs)
      );
    }
    next();
  };
}

module.exports = { actionGuard };
