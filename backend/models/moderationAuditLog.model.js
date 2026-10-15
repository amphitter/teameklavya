"use strict";

/**
 * ModerationAuditLog — enforcement history, appeals, audit logs for Trust & Safety
 */

const mongoose = require("mongoose");

const moderationAuditLogSchema = new mongoose.Schema(
  {
    actor: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    actorType: { type: String, enum: ["human", "automated", "system"], default: "human" },
    action: { type: String, required: true, index: true }, // e.g. report_submitted, case_opened, case_assigned, content_quarantined, content_removed, warning_issued, suspension_applied, ban_applied, reversal, appeal_submitted, etc.
    targetType: { type: String, required: true }, // user, post, comment, report, case, enforcement, ip
    targetId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    // Previous and resulting states
    previousState: { type: Object, default: {} },
    resultingState: { type: Object, default: {} },
    reason: { type: String, default: "" },
    policyCategory: { type: String, default: "" },
    duration: { type: String, default: "" }, // for suspensions
    metadata: { type: Object, default: {} },
    // Related case/report
    relatedCase: { type: mongoose.Schema.Types.ObjectId, ref: "ModerationCase", default: null },
    relatedReport: { type: mongoose.Schema.Types.ObjectId, ref: "ContentReport", default: null },
  },
  { timestamps: true }
);

moderationAuditLogSchema.index({ targetType: 1, targetId: 1, createdAt: -1 });
moderationAuditLogSchema.index({ actor: 1, createdAt: -1 });
moderationAuditLogSchema.index({ action: 1, createdAt: -1 });

module.exports = {
  ModerationAuditLog: mongoose.model("ModerationAuditLog", moderationAuditLogSchema),
};
