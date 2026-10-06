const mongoose = require("mongoose");

/**
 * Ownership & verification audit log (Ownership Verification system).
 * Every status change, claim, review, transfer, rename, suspension and
 * manager change is recorded here — complete, immutable history.
 */
const auditLogSchema = new mongoose.Schema(
  {
    community: { type: mongoose.Schema.Types.ObjectId, ref: "Community", default: null },
    organization: { type: mongoose.Schema.Types.ObjectId, ref: "Organization", default: null },
    actor: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    // e.g. created, claim_submitted, claim_approved, claim_rejected,
    // verified, verification_revoked, ownership_transferred, renamed,
    // handle_changed, suspended, unsuspended, duplicate_resolved,
    // manager_assigned, manager_removed, org_verified, org_unverified
    action: { type: String, required: true, index: true },
    details: { type: String, default: "" },
  },
  { timestamps: true }
);

auditLogSchema.index({ community: 1, createdAt: -1 });
auditLogSchema.index({ organization: 1, createdAt: -1 });

module.exports = mongoose.model("AuditLog", auditLogSchema);
