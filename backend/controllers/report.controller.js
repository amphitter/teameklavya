"use strict";

const mongoose = require("mongoose");
const { ContentReport, REPORT_REASONS, CONTENT_TYPES } = require("../models/contentReport.model");
const { ModerationCase } = require("../models/moderationCase.model");
const { ModerationAuditLog } = require("../models/moderationAuditLog.model");
const User = require("../models/user.model");
const Post = require("../models/post.model");
const Comment = require("../models/comment.model");
const Event = require("../models/event.model");
const { ERROR_CODES } = require("../utils/app-error");
const { checkAbuse, getClientIp } = require("../services/abuse.service");

function errBody(code, message) {
  return { success: false, message, error: { code, message } };
}

function validObjectId(id) {
  return mongoose.Types.ObjectId.isValid(String(id));
}

// POST /api/reports — submit report
exports.submitReport = async (req, res, next) => {
  try {
    const { contentType, contentId, reason, details, category } = req.body;
    if (!contentType || !CONTENT_TYPES.includes(contentType)) {
      return res.status(400).json(errBody(ERROR_CODES.VALIDATION_ERROR, "Invalid content type"));
    }
    if (!contentId || !validObjectId(contentId)) {
      return res.status(400).json(errBody(ERROR_CODES.VALIDATION_ERROR, "Invalid content id"));
    }
    if (!reason || !REPORT_REASONS.includes(reason)) {
      return res.status(400).json(errBody(ERROR_CODES.VALIDATION_ERROR, "Invalid reason"));
    }

    // Abuse check: excessive report submissions
    const ip = getClientIp(req);
    const abuse = await checkAbuse({ ip, userId: req.user.id, action: "report", limit: 20, windowMs: 60 * 60 * 1000 });
    if (abuse.exceeded) {
      return res.status(429).json(errBody(ERROR_CODES.RATE_LIMITED, "Too many reports, try later"));
    }

    // Fetch target user for denormalization
    let targetUser = null;
    let snapshot = "";
    try {
      if (contentType === "post") {
        const post = await Post.findById(contentId).select("author content").lean();
        if (post) {
          targetUser = post.author;
          snapshot = String(post.content || "").slice(0, 500);
        }
      } else if (contentType === "comment") {
        const comment = await Comment.findById(contentId).select("author content").lean();
        if (comment) {
          targetUser = comment.author;
          snapshot = String(comment.content || "").slice(0, 500);
        }
      } else if (contentType === "user") {
        targetUser = contentId;
      } else if (contentType === "event") {
        const event = await Event.findById(contentId).select("createdBy description").lean();
        if (event) {
          targetUser = event.createdBy;
          snapshot = String(event.description || "").slice(0, 500);
        }
      }
    } catch {}

    // Prevent duplicate reporting (unique index will also enforce)
    const existing = await ContentReport.findOne({ reporter: req.user.id, contentType, contentId }).lean();
    if (existing) {
      return res.status(409).json(errBody(ERROR_CODES.CONFLICT, "You already reported this content"));
    }

    // Priority based on reason
    let priority = "medium";
    if (["csam", "sexual_exploitation", "threats"].includes(reason)) priority = "critical";
    else if (["nudity", "sexual_content", "harassment"].includes(reason)) priority = "high";
    else if (reason === "spam") priority = "low";

    const report = await ContentReport.create({
      reporter: req.user.id,
      contentType,
      contentId,
      targetUser,
      reason,
      category: category || reason,
      details: String(details || "").slice(0, 1000),
      snapshot,
      priority,
    });

    // Create or link to moderation case
    let moderationCase = await ModerationCase.findOne({ targetUser, status: { $in: ["open", "under_review"] } }).sort({ createdAt: -1 });
    if (!moderationCase) {
      moderationCase = await ModerationCase.create({
        reports: [report._id],
        contentRefs: [{ contentType, contentId, snapshot }],
        targetUser,
        severity: priority === "critical" ? "critical" : priority,
        priority,
        status: "open",
        source: "report",
      });
    } else {
      moderationCase.reports.push(report._id);
      // Add content ref if not already
      const exists = moderationCase.contentRefs.some((r) => String(r.contentId) === String(contentId) && r.contentType === contentType);
      if (!exists) {
        moderationCase.contentRefs.push({ contentType, contentId, snapshot });
      }
      await moderationCase.save();
    }

    report.moderationCase = moderationCase._id;
    await report.save();

    // Audit log
    try {
      await ModerationAuditLog.create({
        actor: req.user.id,
        action: "report_submitted",
        targetType: "report",
        targetId: report._id,
        reason,
        policyCategory: category || reason,
        metadata: { contentType, contentId },
        relatedCase: moderationCase._id,
      });
    } catch {}

    return res.status(201).json({ success: true, report });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json(errBody(ERROR_CODES.CONFLICT, "You already reported this content"));
    }
    return next(error);
  }
};

// GET /api/reports/mine — user-facing report status
exports.getMyReports = async (req, res, next) => {
  try {
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const [reports, total] = await Promise.all([
      ContentReport.find({ reporter: req.user.id })
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate("moderationCase", "status severity priority")
        .lean(),
      ContentReport.countDocuments({ reporter: req.user.id }),
    ]);
    return res.json({ success: true, reports, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (error) {
    return next(error);
  }
};

// GET /api/admin/moderation/reports — super admin list
exports.listReports = async (req, res, next) => {
  try {
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const query = {};
    if (req.query.status) query.status = req.query.status;
    if (req.query.reason) query.reason = req.query.reason;
    if (req.query.contentType) query.contentType = req.query.contentType;
    if (req.query.priority) query.priority = req.query.priority;
    if (req.query.targetUser && validObjectId(req.query.targetUser)) query.targetUser = req.query.targetUser;

    const [reports, total] = await Promise.all([
      ContentReport.find(query)
        .sort({ priority: -1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate("reporter", "firstName lastName username email")
        .populate("targetUser", "firstName lastName username email")
        .populate("moderationCase", "status severity")
        .lean(),
      ContentReport.countDocuments(query),
    ]);

    // Counts
    const counts = await ContentReport.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]);
    const countsMap = {};
    counts.forEach((c) => (countsMap[c._id] = c.count));

    return res.json({ success: true, reports, counts: countsMap, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (error) {
    return next(error);
  }
};

// GET /api/admin/moderation/reports/:id
exports.getReport = async (req, res, next) => {
  try {
    if (!validObjectId(req.params.id)) return res.status(400).json(errBody(ERROR_CODES.VALIDATION_ERROR, "Invalid id"));
    const report = await ContentReport.findById(req.params.id)
      .populate("reporter", "firstName lastName username email")
      .populate("targetUser", "firstName lastName username email")
      .populate("moderationCase")
      .lean();
    if (!report) return res.status(404).json(errBody(ERROR_CODES.NOT_FOUND, "Report not found"));
    return res.json({ success: true, report });
  } catch (error) {
    return next(error);
  }
};

// POST /api/admin/moderation/reports/:id/resolve
exports.resolveReport = async (req, res, next) => {
  try {
    if (!validObjectId(req.params.id)) return res.status(400).json(errBody(ERROR_CODES.VALIDATION_ERROR, "Invalid id"));
    const { status, resolution } = req.body;
    if (!["dismissed", "actioned", "escalated"].includes(status)) {
      return res.status(400).json(errBody(ERROR_CODES.VALIDATION_ERROR, "Invalid status"));
    }
    const report = await ContentReport.findById(req.params.id);
    if (!report) return res.status(404).json(errBody(ERROR_CODES.NOT_FOUND, "Report not found"));

    report.status = status;
    report.resolution = String(resolution || "").slice(0, 1000);
    report.resolvedBy = req.user.id;
    report.resolvedAt = new Date();
    await report.save();

    try {
      await ModerationAuditLog.create({
        actor: req.user.id,
        action: `report_${status}`,
        targetType: "report",
        targetId: report._id,
        reason: resolution,
        metadata: { previousStatus: report.status },
        relatedCase: report.moderationCase,
      });
    } catch {}

    return res.json({ success: true, report });
  } catch (error) {
    return next(error);
  }
};
