const mongoose = require("mongoose");

/**
 * EventHub Post — the primary feed object.
 * A post is either a regular post (text/images), an event-native post
 * (shares a public event with a Register CTA), or later a memory post.
 */
const postSchema = new mongoose.Schema(
  {
    author: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    content: {
      type: String,
      trim: true,
      maxlength: [2000, "Post is too long (max 2000 characters)"],
      default: "",
    },
    images: {
      // Cloudinary URLs — uploaded via /api/upload/image?folder=posts
      type: [String],
      default: [],
    },
    event: {
      // Set for event-native posts. Only public events may be attached.
      type: mongoose.Schema.Types.ObjectId,
      ref: "Event",
      default: null,
    },
    organization: {
      // Set when posting on behalf of an organization (org admins).
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      default: null,
    },
    community: {
      // Set for community posts (active members only, Phase 6).
      type: mongoose.Schema.Types.ObjectId,
      ref: "Community",
      default: null,
    },

    // ── Phase 9: structured event-memory share (§63). Server-authoritative:
    // filled from the immutable EventResult snapshot on create — the client
    // only sends the caption. Never client-claimed numbers.
    memory: {
      rank: { type: Number, default: null },
      score: { type: Number, default: 0 },
      accuracy: { type: Number, default: null },
      achievements: { type: [String], default: [] },
    },
    // ── Part 3: post typing, visibility, lifecycle ──────────
    type: {
      type: String,
      enum: ["text", "image", "event", "achievement", "event_memory", "announcement"],
      default: "text",
    },
    // public = everyone · followers = accepted followers only ·
    // event_participants = registered users of the attached event only ·
    // community = active members of the attached community only
    visibility: {
      type: String,
      enum: ["public", "followers", "event_participants", "community"],
      default: "public",
    },
    // published = live · draft = author only · deleted = soft-deleted ·
    // hidden = removed by moderation (record kept for audit)
    status: {
      type: String,
      enum: ["published", "draft", "deleted", "hidden"],
      default: "published",
    },
    deletedAt: { type: Date, default: null },

    /* ── Author archive (Part 9 §12) ────────────────────────────────────
       Deliberately NOT reusing `status: "hidden"`. That value belongs to
       moderation — an admin removing a post. Overloading it would make
       "the author put this away" indistinguishable from "a moderator took
       this down", and would let a user un-hide a post a moderator removed.

       Saved / liked / archived are three different concepts and get three
       different homes: Save documents, Reaction documents, and this field. */
    archivedAt: { type: Date, default: null },

    // Normalized #topics parsed from content (lowercase, deduped)
    topics: { type: [String], default: [] },
    // @userIds parsed from content (for mention rendering + notifications)
    mentions: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }], default: [] },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

postSchema.index({ createdAt: -1, _id: -1 });
postSchema.index({ author: 1, createdAt: -1 });
postSchema.index({ event: 1, createdAt: -1 });
postSchema.index({ status: 1, createdAt: -1 });
postSchema.index({ topics: 1, status: 1, createdAt: -1 });
postSchema.index({ community: 1, status: 1, createdAt: -1 });
// Part 9 §12 — author archive listing, and the exclusion from public feeds.
postSchema.index({ author: 1, archivedAt: 1, createdAt: -1 });

module.exports = mongoose.model("Post", postSchema);
