const mongoose = require("mongoose");

/**
 * Story — a 9:16 portrait image or video that lives for 24 hours, then moves
 * to the owner's archive.
 *
 * ── Expiry is enforced at QUERY time, not by a scheduled job ──────────────
 * "Active" means `expiresAt > now`, full stop. A story is therefore never
 * visible a moment past its window even if no sweeper ever runs, and a broken
 * cron cannot strand a live story. `archivedAt` is stamped lazily on the first
 * read after expiry purely so the archive listing has a stable sort key.
 *
 * Both guarantees hold without a background worker, which keeps the story
 * lifecycle correct on a single-instance deployment and on N instances alike.
 *
 * ── Media ────────────────────────────────────────────────────────────────
 * Only the Cloudinary URL / publicId is stored. Binary bytes never enter
 * Mongo (Part 6 §21) — the client uploads through /api/upload/image?folder=stories
 * first and passes the returned URL here.
 */
const storySchema = new mongoose.Schema(
  {
    author: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },

    media: {
      url: { type: String, required: true },
      publicId: { type: String, default: "" }, // enables real deletion from Cloudinary
      type: { type: String, enum: ["image", "video"], default: "image" },
      /** Client-reported intrinsic dimensions, used to reserve layout space
       *  before load so the feed does not reflow (Part 8 §47). */
      width: { type: Number, default: 0 },
      height: { type: Number, default: 0 },
      poster: { type: String, default: "" }, // video still frame
    },

    caption: { type: String, default: "", maxlength: 200 },

    /** Category drives the ring icon in the story rail. Validated against the
     *  central map so the client and server cannot drift (Part 8 §39). */
    category: { type: String, default: "", lowercase: true, trim: true },

    /** Optional event / community / organization the story is about. */
    event: { type: mongoose.Schema.Types.ObjectId, ref: "Event", default: null },
    community: { type: mongoose.Schema.Types.ObjectId, ref: "Community", default: null },
    organization: { type: mongoose.Schema.Types.ObjectId, ref: "Organization", default: null },

    /** Overlay metadata the composer can attach (Part 8 §17). */
    mentions: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    textOverlay: { type: String, default: "", maxlength: 200 },
    link: { type: String, default: "" },

    /* ── Story layers (Part 9 §21) ────────────────────────────────────────
     * Every overlay the creator places is a LAYER, stored as metadata rather
     * than flattened into the image: text, emoji, stickers and freehand
     * strokes, each with its own transform.
     *
     * Why metadata and not a flattened render: the published story has to look
     * exactly like the preview (it is re-rendered by the same component), a
     * stroke stays crisp at any size instead of carrying the resolution of
     * whatever canvas happened to draw it, and "store enough metadata to
     * reproduce the story" is then literally true — nothing about the original
     * edit is lost.
     *
     * `Mixed` on purpose: the layer vocabulary is owned by one sanitizer
     * (`sanitizeLayers` in story.controller.js) which whitelists every type and
     * clamps every number before anything is written. A rigid sub-schema here
     * would be a second, silently-drifting copy of that contract.
     */
    layers: { type: [mongoose.Schema.Types.Mixed], default: [] },

    // ── Lifecycle ────────────────────────────────────────────────────────
    createdAt: { type: Date, default: Date.now },
    expiresAt: {
      type: Date,
      required: true,
      default: () => new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
    /** Set lazily once the story has aged out. Null while active. */
    archivedAt: { type: Date, default: null },

    /** Hard removal by the author — distinct from expiry. */
    deletedAt: { type: Date, default: null },

    /** Viewer ids, for the owner's view count. Capped: a viral story must not
     *  grow an unbounded array inside the document. */
    viewers: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    viewsCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// Hot path: "active stories for people I follow", newest first.
storySchema.index({ author: 1, expiresAt: -1 });
storySchema.index({ expiresAt: 1, archivedAt: 1 });
// Archive listing: everything the author ever posted, newest first.
storySchema.index({ author: 1, deletedAt: 1, createdAt: -1 });
// Category rails (Part 8 §15).
storySchema.index({ category: 1, expiresAt: -1 });

/**
 * Sweep: stamp archivedAt on every expired-but-unstamped story.
 * Safe to run at any time and idempotent — it is an optimisation for the
 * archive listing, never the mechanism that hides a story.
 */
storySchema.statics.archiveExpired = async function (olderThan = new Date()) {
  const res = await this.updateMany(
    { expiresAt: { $lte: olderThan }, archivedAt: null },
    { $set: { archivedAt: new Date() } }
  );
  return res.modifiedCount || 0;
};

module.exports = mongoose.model("Story", storySchema);
