const mongoose = require("mongoose");

const commentSchema = new mongoose.Schema(
  {
    post: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Post",
      required: true,
    },
    author: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    content: {
      type: String,
      trim: true,
      required: true,
      maxlength: [500, "Comment is too long (max 500 characters)"],
    },
    // ── Moderation removal (Part 3, Phase 10): removedAt set = removed by
    // moderation; hidden from all comment lists, record kept for audit ──
    removedAt: { type: Date, default: null },
    removedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

    // ── Replies (Part 8 §13) ────────────────────────────────────────────
    // Null = top-level comment. Otherwise the parent comment id.
    //
    // ONE LEVEL ONLY, enforced server-side (see controllers/post.controller.js):
    // a reply to a reply is re-parented onto the grandparent. That is what
    // keeps the UI at "View replies (N)" instead of an unbounded nested tree —
    // the constraint lives in the data layer so no client can produce a thread
    // the UI cannot render.
    parent: { type: mongoose.Schema.Types.ObjectId, ref: "Comment", default: null, index: true },

    /** Denormalised reply counter — the UI shows "View replies (N)" without
     *  loading them. */
    replyCount: { type: Number, default: 0 },

    // ── Comment likes (Part 8 §13) ──────────────────────────────────────
    likers: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    likesCount: { type: Number, default: 0 },

    // ── Trust & Safety moderation ──
    moderationStatus: {
      type: String,
      enum: ["pending", "approved", "quarantined", "removed", "flagged"],
      default: "approved",
      index: true,
    },
    moderationCategory: { type: String, default: "" },
    moderationConfidence: { type: Number, default: 0 },
    moderationCheckedAt: { type: Date, default: null },
    moderationCase: { type: mongoose.Schema.Types.ObjectId, ref: "ModerationCase", default: null },
  },
  { timestamps: true }
);

commentSchema.index({ post: 1, createdAt: 1 });
// Loading the replies of one comment.
commentSchema.index({ parent: 1, createdAt: 1 });

module.exports = mongoose.model("Comment", commentSchema);
