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
 * Part 6, Phase 3 (§5): the key store is now SHARED. Previously `seen` was a
 * process-local Map, so with two instances the same Idempotency-Key arriving
 * at Server B was invisible to Server A — the exact duplicate the middleware
 * exists to prevent. Claims now go through providers/redis/idempotency.store.js
 * which uses `SET NX PX` in Redis when configured and degrades to the
 * per-instance map when it is not.
 *
 * This middleware is now ASYNC. It always was conceptually — the claim is an
 * atomic remote operation — and Express supports an async handler as long as
 * errors are forwarded to next().
 */
const { ConflictError } = require("../utils/app-error");
const { idempotencyStore } = require("../providers/redis/idempotency.store");

const WINDOW_MS = 2 * 60 * 1000; // dedup window

/**
 * Build the scoped key. Identity is part of the key, so one user's key can
 * never consume another's — a collision there would let one user's retry
 * block a different user's legitimate request.
 */
function scopedKey(req, raw) {
  const id = req.user && (req.user._id || req.user.id);
  const scope = id ? `u:${id}` : `ip:${req.ip || "unknown"}`;
  return `${scope}:${raw.slice(0, 128)}`;
}

async function idempotencyWindow(req, _res, next) {
  const raw = String(req.get("idempotency-key") || (req.body && req.body.clientRequestId) || "").trim();
  // No key → opt-in middleware does nothing. Legacy clients are unaffected.
  if (!raw) return next();

  const key = scopedKey(req, raw);
  const store = idempotencyStore();

  try {
    const result = await store.claim(key, WINDOW_MS);
    if (!result.acquired) {
      return next(new ConflictError("Duplicate request — this was already submitted."));
    }
    return next();
  } catch (err) {
    /**
     * A store failure must not turn into a duplicate write, and must not turn
     * into a mysterious 500 either. The store itself already falls back to
     * per-instance memory on a Redis error; reaching here means even that
     * failed, so we fail CLOSED for safety — a business-critical mutation
     * that cannot be de-duplicated is worse than one that is refused.
     */
    console.error("[idempotency] claim failed, refusing the write:", err?.message || err);
    return next(new ConflictError("Could not verify this request is unique. Please retry."));
  }
}

module.exports = { idempotencyWindow, WINDOW_MS, scopedKey, idempotencyStore };
