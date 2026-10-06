/**
 * Optional client-request-id dedup window (Part 5, Phase 2 — spec §28)
 * ────────────────────────────────────────────────────────────
 * Contract: if a POST carries an `Idempotency-Key` header (or a
 * `clientRequestId` body field), a second request with the SAME key inside
 * the window is rejected with 409 CONFLICT instead of creating a duplicate.
 *
 * Scope (§28 "optional client-request-id dedup window" for post double-click):
 *   • Keys are scoped per user — one user can never block another's key.
 *   • Requests WITHOUT a key pass through untouched: the server-side unique
 *     indexes (registration/event, etc.) remain the hard backstop.
 *   • Mark-on-receipt semantics: a key identifies one attempt; a retried
 *     validation failure should use a fresh key.
 *
 * The frontend starts sending the header in Phase 5; until then this is
 * dormant infrastructure with zero behavior change.
 */
const { ConflictError } = require("../utils/app-error");

const WINDOW_MS = 2 * 60 * 1000; // dedup window
const MAX_KEYS = 10_000;
const seen = new Map(); // scopedKey -> expiresAt (ms epoch)

function prune(now) {
  if (seen.size < MAX_KEYS / 2) return; // cheap skip while small
  for (const [key, expiresAt] of seen) {
    if (expiresAt <= now) seen.delete(key);
  }
  if (seen.size > MAX_KEYS) seen.clear(); // safety valve
}

function idempotencyWindow(req, _res, next) {
  const raw = String(req.get("idempotency-key") || (req.body && req.body.clientRequestId) || "").trim();
  if (!raw) return next();

  const id = req.user && (req.user._id || req.user.id);
  const scope = id ? `u:${id}` : `ip:${req.ip || "unknown"}`;
  const key = `${scope}:${raw.slice(0, 128)}`;

  const now = Date.now();
  prune(now);
  const expiresAt = seen.get(key);
  if (expiresAt && expiresAt > now) {
    return next(new ConflictError("Duplicate request — this was already submitted."));
  }
  seen.set(key, now + WINDOW_MS);
  next();
}

module.exports = { idempotencyWindow, WINDOW_MS };
