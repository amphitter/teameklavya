const mongoose = require("mongoose");
const {
  ORGANIZATION_ROLES,
  ORGANIZATION_MEMBERSHIP_STATUSES,
} = require("../config/organization");

/**
 * OrganizationMembership — persistent, one-per-user-per-organization role.
 * Phase 4 permissions prefer an active row and use legacy createdBy/managers
 * only as a compatibility fallback until the reviewed backfill is applied.
 */
const organizationMembershipSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    role: {
      type: String,
      enum: ORGANIZATION_ROLES,
      default: "MEMBER",
      required: true,
    },
    status: {
      type: String,
      enum: ORGANIZATION_MEMBERSHIP_STATUSES,
      default: "ACTIVE",
      required: true,
    },
    joinedAt: { type: Date, default: Date.now },
    invitedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    invitedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Uniqueness and the two common lookup directions (organization roster / my orgs).
organizationMembershipSchema.index({ organizationId: 1, userId: 1 }, { unique: true });
organizationMembershipSchema.index({ userId: 1, organizationId: 1 });

module.exports = mongoose.model("OrganizationMembership", organizationMembershipSchema);
