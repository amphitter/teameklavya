"use strict";

/**
 * ModerationCase — investigation or related set of reports
 */

const mongoose = require("mongoose");

const CASE_STATUSES = ["open", "under_review", "pending_user", "resolved", "dismissed", "escalated"];
const SEVERITIES = ["low", "medium", "high", "critical"];
const PRIORITIES = ["low", "medium", "high", "critical"];

const moderationCaseSchema = new mongoose.Schema(
  {
    // Related reports
    reports: [{ type: mongoose.Schema.Types.ObjectId, ref: "ContentReport" }],
    // Content references (can be multiple)
    contentRefs: [
      {
        contentType: { type: String, required: true },
        contentId: { type: mongoose.Schema.Types.ObjectId, required: true },
        snapshot: { type: String, default: "" },
      },
    ],
    // Target user (if any)
    targetUser: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
    // Severity and priority
    severity: { type: String, enum: SEVERITIES, default: "medium", index: true },
    priority: { type: String, enum: PRIORITIES, default: "medium", index: true },
    // Assigned reviewer
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
    status: { type: String, enum: CASE_STATUSES, default: "open", index: true },
    // Internal reviewer notes (private, not visible to affected user)
    internalNotes: [
      {
        note: { type: String, required: true },
        author: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        at: { type: Date, default: Date.now },
      },
    ],
    // User-facing decision details
    decision: {
      action: { type: String, default: "" },
      reason: { type: String, default: "" },
      policyCategory: { type: String, default: "" },
      messageToUser: { type: String, default: "" },
    },
    // Decision history (audit)
    decisionHistory: [
      {
        action: { type: String, required: true },
        actor: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        fromStatus: { type: String, default: "" },
        toStatus: { type: String, default: "" },
        reason: { type: String, default: "" },
        at: { type: Date, default: Date.now },
        metadata: { type: Object, default: {} },
      },
    ],
    // Auto-generated from reports or manual
    source: { type: String, enum: ["auto", "manual", "report"], default: "report" },
  },
  { timestamps: true }
);

moderationCaseSchema.index({ status: 1, priority: -1, createdAt: -1 });
moderationCaseSchema.index({ assignedTo: 1, status: 1 });
moderationCaseSchema.index({ targetUser: 1, createdAt: -1 });

module.exports = {
  ModerationCase: mongoose.model("ModerationCase", moderationCaseSchema),
  CASE_STATUSES,
  SEVERITIES,
  PRIORITIES,
};
