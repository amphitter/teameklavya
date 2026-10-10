"use strict";

/**
 * EnforcementAction — account and content enforcement
 * Supports warnings, content removal, feature restrictions, suspensions, bans, network restrictions, reversals.
 */

const mongoose = require("mongoose");

const ACTION_TYPES = [
  "warning",
  "content_removal",
  "content_quarantine",
  "posting_restriction",
  "comment_restriction",
  "messaging_restriction",
  "event_creation_restriction",
  "temporary_suspension",
  "permanent_ban",
  "temporary_network_restriction",
  "enforcement_reversal",
  "account_deletion",
];

const SCOPES = ["account", "content", "feature", "network"];
const STATUSES = ["active", "expired", "reversed", "pending_review"];

const enforcementActionSchema = new mongoose.Schema(
  {
    targetUser: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    targetContentType: { type: String, default: null }, // post, comment, etc.
    targetContentId: { type: mongoose.Schema.Types.ObjectId, default: null },
    actionType: { type: String, enum: ACTION_TYPES, required: true, index: true },
    scope: { type: String, enum: SCOPES, required: true },
    reason: { type: String, required: true },
    policyCategory: { type: String, required: true, index: true },
    actor: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }, // admin or system
    actorType: { type: String, enum: ["human", "automated"], default: "human" },
    startAt: { type: Date, default: Date.now, index: true },
    expiresAt: { type: Date, default: null, index: true }, // null for permanent
    relatedCase: { type: mongoose.Schema.Types.ObjectId, ref: "ModerationCase", default: null, index: true },
    relatedReports: [{ type: mongoose.Schema.Types.ObjectId, ref: "ContentReport" }],
    status: { type: String, enum: STATUSES, default: "active", index: true },
    // Appeal/review
    appealStatus: { type: String, enum: ["none", "pending", "approved", "rejected"], default: "none" },
    appealReason: { type: String, default: "" },
    appealReviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    appealReviewedAt: { type: Date, default: null },
    // Reversal
    reversedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    reversedAt: { type: Date, default: null },
    reversalReason: { type: String, default: "" },
    // Metadata
    metadata: { type: Object, default: {} },
    // Idempotency for retry-safe
    idempotencyKey: { type: String, default: null, index: { unique: true, sparse: true } },
  },
  { timestamps: true }
);

// Prevent duplicate active actions of same type for same user/content
enforcementActionSchema.index(
  { targetUser: 1, actionType: 1, targetContentId: 1, status: 1 },
  { partialFilterExpression: { status: "active" } }
);
enforcementActionSchema.index({ expiresAt: 1, status: 1 });
enforcementActionSchema.index({ targetUser: 1, createdAt: -1 });

module.exports = {
  EnforcementAction: mongoose.model("EnforcementAction", enforcementActionSchema),
  ACTION_TYPES,
  SCOPES,
  ENFORCEMENT_STATUSES: STATUSES,
};
