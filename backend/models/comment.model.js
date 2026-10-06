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
  },
  { timestamps: true }
);

commentSchema.index({ post: 1, createdAt: 1 });

module.exports = mongoose.model("Comment", commentSchema);
