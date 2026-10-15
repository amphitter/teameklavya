"use strict";

/**
 * ContentReport — Trust & Safety
 * Enhanced reporting for posts, comments, messages, users, events, communities, organizations, profiles, media.
 * Prevents duplicate and abusive reporting via unique index + rate limiting.
 */

const mongoose = require("mongoose");

const CONTENT_TYPES = [
  "post",
  "comment",
  "message",
  "user",
  "event",
  "community",
  "organization",
  "profile",
  "media",
  "story",
];

const REASONS = [
  "spam",
  "harassment",
  "abusive_language",
  "threats",
  "nudity",
  "sexual_content",
  "sexual_exploitation",
  "csam",
  "impersonation",
  "malicious_links",
  "scam",
  "inappropriate",
  "misinformation",
  "other",
];

const STATUSES = ["open", "pending_review", "dismissed", "actioned", "escalated"];

const contentReportSchema = new mongoose.Schema(
  {
    reporter: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    // Reported content reference
    contentType: { type: String, enum: CONTENT_TYPES, required: true, index: true },
    contentId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    // Denormalized owner of reported content
    targetUser: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
    // For user reports, targetUser == contentId (user id)
    reason: { type: String, enum: REASONS, required: true, index: true },
    category: { type: String, default: "" }, // policy category
    details: { type: String, maxlength: 1000, trim: true, default: "" },
    // Evidence snapshot at report time
    snapshot: { type: String, default: "" },
    snapshotMetadata: { type: Object, default: {} },
    status: { type: String, enum: STATUSES, default: "open", index: true },
    priority: { type: String, enum: ["low", "medium", "high", "critical"], default: "medium", index: true },
    // Moderation linkage
    moderationCase: { type: mongoose.Schema.Types.ObjectId, ref: "ModerationCase", default: null },
    // Resolution
    resolution: { type: String, default: "" },
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    resolvedAt: { type: Date, default: null },
    // Abuse prevention: count of reports by same reporter in window (for rate limiting, not stored permanently as per spec)
    // We keep createdAt for audit, but short-lived counters in Redis
  },
  { timestamps: true }
);

contentReportSchema.index({ contentType: 1, contentId: 1, reporter: 1 }, { unique: true });
contentReportSchema.index({ status: 1, priority: -1, createdAt: -1 });
contentReportSchema.index({ reporter: 1, createdAt: -1 });
contentReportSchema.index({ targetUser: 1, createdAt: -1 });

module.exports = {
  ContentReport: mongoose.model("ContentReport", contentReportSchema),
  CONTENT_TYPES,
  REPORT_REASONS: REASONS,
  REPORT_STATUSES: STATUSES,
};
