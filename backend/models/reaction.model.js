const mongoose = require("mongoose");

/**
 * Reaction — one per user per post. `type` is extensible
 * (like / celebrate / …) but currently only "like" is used.
 */
const reactionSchema = new mongoose.Schema(
  {
    post: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Post",
      required: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    type: {
      type: String,
      enum: ["like"],
      default: "like",
    },
  },
  { timestamps: true }
);

reactionSchema.index({ post: 1, user: 1 }, { unique: true });

module.exports = mongoose.model("Reaction", reactionSchema);
