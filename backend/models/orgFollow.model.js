const mongoose = require("mongoose");

/** Organization follow — one per user per organization. */
const orgFollowSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
    },
  },
  { timestamps: true }
);

orgFollowSchema.index({ user: 1, organization: 1 }, { unique: true });
orgFollowSchema.index({ organization: 1 });
// Supports organization-first lookups while retaining the existing unique pair.
orgFollowSchema.index({ organization: 1, user: 1 });

module.exports = mongoose.model("OrgFollow", orgFollowSchema);
