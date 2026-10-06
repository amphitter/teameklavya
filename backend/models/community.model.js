const mongoose = require("mongoose");

/**
 * EventHub Community (Part 3, Phase 6) — a member group with its own posts
 * and events. Created by platform admins or organization managers.
 * joinPolicy: open = anyone joins · request = admins approve · invite = admins invite.
 * Soft-deleted (deletedAt) communities vanish everywhere; record kept for audit.
 */
const communitySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: [3, "Community name is too short"],
      maxlength: [60, "Community name is too long"],
    },
    // NOTE (Part 5, Phase 3): `index: true` was removed here. `unique: true`
    // already creates the {slug:1} index; the extra declaration built a
    // duplicate B-tree on every deployment.
    slug: { type: String, required: true, unique: true },
    description: {
      type: String,
      trim: true,
      maxlength: [1000, "Description is too long"],
      default: "",
    },
    avatarUrl: { type: String, default: "" },
    joinPolicy: {
      type: String,
      enum: ["open", "request", "invite"],
      default: "open",
    },
    // Optional org backing (when created by that org's manager)
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      default: null,
    },

    /* ── Ownership Verification system ───────────────────────
     * status:
     *   unverified — default. Real community, no official claim.
     *   pending    — an ownership claim is under manual review.
     *   verified   — officially verified org ownership (badge shown).
     *   suspended  — hidden platform-wide by the Super Admin.
     *   revoked    — verification was revoked after being granted.
     * affiliationDomain is a SIGNAL ONLY (students share it too);
     * officialOrganization is set only after proof + admin review. */
    status: {
      type: String,
      enum: ["unverified", "pending", "verified", "suspended", "revoked"],
      default: "unverified",
      index: true,
    },
    affiliationDomain: { type: String, default: "" },
    officialOrganization: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      default: null,
    },
    suspendedFrom: { type: String, default: null },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

communitySchema.index({ name: 1 });
communitySchema.index({ organization: 1, deletedAt: 1 });

module.exports = mongoose.model("Community", communitySchema);
