const mongoose = require("mongoose");

/** Saved post (bookmark). One per user per post. */
const saveSchema = new mongoose.Schema(
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
  },
  { timestamps: true }
);

saveSchema.index({ post: 1, user: 1 }, { unique: true });
saveSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model("Save", saveSchema);
