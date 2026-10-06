const mongoose = require("mongoose");

/**
 * Community ownership claim (Ownership Verification system).
 * An organization manager (or the Super Admin on their behalf) claims a
 * community for their organization and supplies proof. A claim is reviewed
 * MANUALLY — a matching email domain alone never auto-approves anything.
 *
 * status:
 *   pending  — awaiting review
 *   approved — reviewed and granted (resolution says what happened)
 *   rejected — reviewed and declined
 */
const communityClaimSchema = new mongoose.Schema(
  {
    community: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Community",
      required: true,
    },
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
    },
    claimant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    // Affiliation signal captured at claim time (never proof by itself)
    claimantDomain: { type: String, default: "" },
    proof: {
      description: { type: String, default: "" }, // who they are, why official
      documentUrl: { type: String, default: "" }, // uploaded proof (optional)
      contactEmail: { type: String, default: "" }, // official contact
    },
    status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending", index: true },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    reviewedAt: { type: Date, default: null },
    reviewNote: { type: String, default: "" },
    // What the reviewer chose: "grant" (verify in place) | "transfer"
    // (rename student community + create official one) — set on approve
    resolution: { type: String, enum: ["grant", "transfer", ""], default: "" },
  },
  { timestamps: true }
);

communityClaimSchema.index({ community: 1, organization: 1 }, { unique: true });
communityClaimSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model("CommunityClaim", communityClaimSchema);
