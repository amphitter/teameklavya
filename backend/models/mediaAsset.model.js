/**
 * MediaAsset — upload bookkeeping for orphan reclamation (Part 5, §55)
 * ─────────────────────────────────────────────────────────────────────
 * The problem this solves: an upload and the database write that consumes it
 * are two separate operations. If the upload succeeds but the write fails
 * (validation error, transient DB blip, request aborted), the bytes sit in
 * Cloudinary forever with nothing referencing them — silent, unbounded
 * storage growth on a metered plan.
 *
 * Lifecycle:
 *   pending         → just uploaded; not yet attached to a domain object
 *   active          → referenced by an event/post/user; NEVER reclaimed
 *   cleanup_pending → the consuming write failed; eligible for reclamation
 *   deleted         → removed from the provider; kept as an audit record
 *
 * Safety rules baked into the design:
 *   • Nothing is deleted immediately on failure. A transient DB error must
 *     not destroy a user's upload, so failures get a 24h grace window.
 *   • Only `pending` / `cleanup_pending` past `cleanupAfter` are reclaimable.
 *     `active` assets are never touched by the sweeper (§53: user content is
 *     permanent until an explicit policy removes it).
 *   • The sweeper is a separate script (`scripts/media-sweeper.js`) — never
 *     an on-request side effect, so storage errors can't fail a user action
 *     (§68).
 */

const mongoose = require("mongoose");

const mediaAssetSchema = new mongoose.Schema(
  {
    /** Provider's identifier for the asset (Cloudinary public_id). */
    publicId: { type: String, required: true, unique: true },
    provider: { type: String, enum: ["cloudinary", "local"], default: "cloudinary" },

    /** Upload folder / purpose, used for reporting and per-class limits. */
    folder: { type: String, default: "misc" },
    purpose: {
      type: String,
      enum: ["avatar", "logo", "poster", "post", "banner", "default"],
      default: "default",
    },

    url: { type: String, default: "" },
    bytes: { type: Number, default: 0 },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

    status: {
      type: String,
      enum: ["pending", "active", "cleanup_pending", "deleted"],
      default: "pending",
    },

    /** What consumes this asset, e.g. "event:665f…" — proves it is in use. */
    attachedTo: { type: String, default: null },

    /** Why it became reclaimable (audit trail). */
    cleanupReason: { type: String, default: null },
    /** Reclaimable only after this timestamp (the safety grace window). */
    cleanupAfter: { type: Date, default: null },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Sweeper query: status + grace window.
mediaAssetSchema.index({ status: 1, cleanupAfter: 1 });
// Per-user / per-folder storage reporting (Phase 7 infra dashboard).
mediaAssetSchema.index({ uploadedBy: 1, createdAt: -1 });
mediaAssetSchema.index({ folder: 1, createdAt: -1 });

/**
 * Reclaimable = not in use, and past its grace window.
 * Deliberately excludes `active` and `deleted` — user content is permanent.
 */
mediaAssetSchema.statics.reclaimable = function (now = new Date()) {
  return this.find({
    status: { $in: ["pending", "cleanup_pending"] },
    cleanupAfter: { $ne: null, $lte: now },
  });
};

module.exports = mongoose.model("MediaAsset", mediaAssetSchema);
