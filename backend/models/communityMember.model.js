const mongoose = require("mongoose");

/**
 * Community membership (Part 3, Phase 6). One doc per user per community.
 *   status: active  = full member
 *           pending = user requested to join (request policy — admins approve)
 *           invited = admin invited the user (user must accept)
 *   role:   admin (community manager) | member
 */
const communityMemberSchema = new mongoose.Schema(
  {
    community: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Community",
      required: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    role: { type: String, enum: ["admin", "member"], default: "member" },
    status: { type: String, enum: ["active", "pending", "invited"], default: "active" },
    invitedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

communityMemberSchema.index({ community: 1, user: 1 }, { unique: true });
communityMemberSchema.index({ user: 1, status: 1 });
communityMemberSchema.index({ community: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model("CommunityMember", communityMemberSchema);
