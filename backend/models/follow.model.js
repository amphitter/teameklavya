const mongoose = require("mongoose");

/** Follow — social graph edge (user → user). Org follows arrive with Phase D. */
const followSchema = new mongoose.Schema(
  {
    follower: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    followee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    // accepted = live edge · pending = follow request awaiting approval
    // (private profiles turn follows into requests)
    status: {
      type: String,
      enum: ["accepted", "pending"],
      default: "accepted",
    },
  },
  { timestamps: true }
);

followSchema.index({ follower: 1, followee: 1 }, { unique: true });
followSchema.index({ followee: 1, status: 1, createdAt: -1 });
followSchema.index({ follower: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model("Follow", followSchema);
