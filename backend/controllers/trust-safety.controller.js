"use strict";

const mongoose = require("mongoose");
const { ModerationCase } = require("../models/moderationCase.model");
const { ContentReport } = require("../models/contentReport.model");
const { EnforcementAction } = require("../models/enforcementAction.model");
const { ModerationAuditLog } = require("../models/moderationAuditLog.model");
const { IpRestriction } = require("../models/ipRestriction.model");
const Post = require("../models/post.model");
const Comment = require("../models/comment.model");
const Event = require("../models/event.model");
const User = require("../models/user.model");
const { ERROR_CODES } = require("../utils/app-error");
const moderationService = require("../services/moderation.service");
const enforcementService = require("../services/enforcement.service");
const abuseService = require("../services/abuse.service");

function errBody(code, message) {
  return { success: false, message, error: { code, message } };
}
function validObjectId(id) {
  return mongoose.Types.ObjectId.isValid(String(id));
}

// GET /api/admin/moderation/cases
exports.listCases = async (req, res, next) => {
  try {
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const query = {};
    if (req.query.status) query.status = req.query.status;
    if (req.query.severity) query.severity = req.query.severity;
    if (req.query.priority) query.priority = req.query.priority;
    if (req.query.assignedTo && validObjectId(req.query.assignedTo)) query.assignedTo = req.query.assignedTo;
    if (req.query.targetUser && validObjectId(req.query.targetUser)) query.targetUser = req.query.targetUser;

    const [cases, total] = await Promise.all([
      ModerationCase.find(query)
        .sort({ priority: -1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate("targetUser", "firstName lastName username email")
        .populate("assignedTo", "firstName lastName username")
        .populate("reports")
        .lean(),
      ModerationCase.countDocuments(query),
    ]);

    const counts = await ModerationCase.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]);
    const countsMap = {};
    counts.forEach((c) => (countsMap[c._id] = c.count));

    return res.json({ success: true, cases, counts: countsMap, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (error) {
    return next(error);
  }
};

// GET /api/admin/moderation/cases/:id
exports.getCase = async (req, res, next) => {
  try {
    if (!validObjectId(req.params.id)) return res.status(400).json(errBody(ERROR_CODES.VALIDATION_ERROR, "Invalid id"));
    const mc = await ModerationCase.findById(req.params.id)
      .populate("targetUser", "firstName lastName username email profile")
      .populate("assignedTo", "firstName lastName username email")
      .populate("reports")
      .populate("internalNotes.author", "firstName lastName username")
      .lean();
    if (!mc) return res.status(404).json(errBody(ERROR_CODES.NOT_FOUND, "Case not found"));
    return res.json({ success: true, case: mc });
  } catch (error) {
    return next(error);
  }
};

// POST /api/admin/moderation/cases/:id/assign
exports.assignCase = async (req, res, next) => {
  try {
    if (!validObjectId(req.params.id)) return res.status(400).json(errBody(ERROR_CODES.VALIDATION_ERROR, "Invalid id"));
    const { assignedTo } = req.body;
    if (assignedTo && !validObjectId(assignedTo)) return res.status(400).json(errBody(ERROR_CODES.VALIDATION_ERROR, "Invalid assignedTo"));
    const mc = await ModerationCase.findById(req.params.id);
    if (!mc) return res.status(404).json(errBody(ERROR_CODES.NOT_FOUND, "Case not found"));

    const prev = mc.assignedTo;
    mc.assignedTo = assignedTo || req.user.id;
    mc.status = mc.status === "open" ? "under_review" : mc.status;
    mc.decisionHistory.push({
      action: "assigned",
      actor: req.user.id,
      fromStatus: "open",
      toStatus: mc.status,
      reason: `Assigned to ${mc.assignedTo}`,
    });
    await mc.save();

    try {
      await ModerationAuditLog.create({
        actor: req.user.id,
        action: "case_assigned",
        targetType: "case",
        targetId: mc._id,
        previousState: { assignedTo: prev },
        resultingState: { assignedTo: mc.assignedTo },
        relatedCase: mc._id,
      });
    } catch {}

    return res.json({ success: true, case: mc });
  } catch (error) {
    return next(error);
  }
};

// POST /api/admin/moderation/cases/:id/note
exports.addNote = async (req, res, next) => {
  try {
    if (!validObjectId(req.params.id)) return res.status(400).json(errBody(ERROR_CODES.VALIDATION_ERROR, "Invalid id"));
    const { note } = req.body;
    if (!note || String(note).trim().length < 3) return res.status(400).json(errBody(ERROR_CODES.VALIDATION_ERROR, "Note required"));
    const mc = await ModerationCase.findById(req.params.id);
    if (!mc) return res.status(404).json(errBody(ERROR_CODES.NOT_FOUND, "Case not found"));

    mc.internalNotes.push({ note: String(note).slice(0, 2000), author: req.user.id, at: new Date() });
    await mc.save();

    return res.json({ success: true, case: mc });
  } catch (error) {
    return next(error);
  }
};

// POST /api/admin/moderation/cases/:id/resolve
exports.resolveCase = async (req, res, next) => {
  try {
    if (!validObjectId(req.params.id)) return res.status(400).json(errBody(ERROR_CODES.VALIDATION_ERROR, "Invalid id"));
    const { status, decision, reason, policyCategory, messageToUser } = req.body;
    if (!["resolved", "dismissed", "escalated"].includes(status)) {
      return res.status(400).json(errBody(ERROR_CODES.VALIDATION_ERROR, "Invalid status"));
    }
    const mc = await ModerationCase.findById(req.params.id);
    if (!mc) return res.status(404).json(errBody(ERROR_CODES.NOT_FOUND, "Case not found"));

    const from = mc.status;
    mc.status = status;
    mc.decision = {
      action: decision || status,
      reason: String(reason || "").slice(0, 1000),
      policyCategory: String(policyCategory || "").slice(0, 100),
      messageToUser: String(messageToUser || "").slice(0, 1000),
    };
    mc.decisionHistory.push({
      action: status,
      actor: req.user.id,
      fromStatus: from,
      toStatus: status,
      reason: reason || "",
      metadata: { decision, policyCategory },
    });
    await mc.save();

    if (mc.reports && mc.reports.length) {
      await ContentReport.updateMany(
        { _id: { $in: mc.reports } },
        { $set: { status: status === "dismissed" ? "dismissed" : "actioned", resolvedBy: req.user.id, resolvedAt: new Date(), resolution: reason } }
      );
    }

    try {
      await ModerationAuditLog.create({
        actor: req.user.id,
        action: `case_${status}`,
        targetType: "case",
        targetId: mc._id,
        previousState: { status: from },
        resultingState: { status, decision },
        reason,
        policyCategory,
        relatedCase: mc._id,
      });
    } catch {}

    return res.json({ success: true, case: mc });
  } catch (error) {
    return next(error);
  }
};

// Content moderation actions: hide, remove, restore, quarantine
exports.moderateContent = async (req, res, next) => {
  try {
    const { contentType, contentId } = req.params;
    const { action, reason, policyCategory } = req.body;
    const act = action || req.params.action;
    if (!["hide", "remove", "restore", "quarantine", "approve"].includes(act)) {
      return res.status(400).json(errBody(ERROR_CODES.VALIDATION_ERROR, "Invalid action"));
    }
    if (!validObjectId(contentId)) return res.status(400).json(errBody(ERROR_CODES.VALIDATION_ERROR, "Invalid content id"));

    let doc = null;
    let Model = null;
    if (contentType === "post") Model = Post;
    else if (contentType === "comment") Model = Comment;
    else if (contentType === "event") Model = Event;
    else return res.status(400).json(errBody(ERROR_CODES.VALIDATION_ERROR, "Unsupported content type"));

    doc = await Model.findById(contentId);
    if (!doc) return res.status(404).json(errBody(ERROR_CODES.NOT_FOUND, "Content not found"));

    const prevStatus = doc.moderationStatus || doc.status;

    if (act === "remove") {
      if (contentType === "post") {
        doc.status = "hidden";
        doc.moderationStatus = "removed";
      } else if (contentType === "comment") {
        doc.removedAt = new Date();
        doc.removedBy = req.user.id;
        doc.moderationStatus = "removed";
      } else if (contentType === "event") {
        doc.moderationStatus = "removed";
      }
    } else if (act === "quarantine") {
      doc.moderationStatus = "quarantined";
      if (contentType === "post") doc.status = "hidden";
    } else if (act === "hide") {
      if (contentType === "post") doc.status = "hidden";
      doc.moderationStatus = "quarantined";
    } else if (act === "restore" || act === "approve") {
      if (contentType === "post") doc.status = "published";
      doc.moderationStatus = "approved";
      if (contentType === "comment") {
        doc.removedAt = null;
        doc.removedBy = null;
      }
    }

    doc.moderationCategory = policyCategory || "";
    doc.moderationCheckedAt = new Date();
    await doc.save();

    try {
      await ModerationAuditLog.create({
        actor: req.user.id,
        action: `content_${act}`,
        targetType: contentType,
        targetId: contentId,
        previousState: { status: prevStatus },
        resultingState: { status: doc.moderationStatus || doc.status, action: act },
        reason,
        policyCategory,
      });
    } catch {}

    return res.json({ success: true, content: doc });
  } catch (error) {
    return next(error);
  }
};

// GET /api/admin/moderation/overview
exports.getOverview = async (req, res, next) => {
  try {
    const [
      pendingReports,
      highPriorityCases,
      recentActions,
      activeSuspensions,
      permanentBans,
      pendingContent,
      ipRestrictions,
    ] = await Promise.all([
      ContentReport.countDocuments({ status: "open" }),
      ModerationCase.countDocuments({ priority: { $in: ["high", "critical"] }, status: { $in: ["open", "under_review"] } }),
      EnforcementAction.find({}).sort({ createdAt: -1 }).limit(10).populate("targetUser", "username email").lean(),
      EnforcementAction.countDocuments({ actionType: "temporary_suspension", status: "active" }),
      EnforcementAction.countDocuments({ actionType: "permanent_ban", status: "active" }),
      Post.countDocuments({ moderationStatus: { $in: ["pending", "flagged", "quarantined"] } }),
      IpRestriction.countDocuments({ active: true }),
    ]);

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const repeatTrends = await EnforcementAction.aggregate([
      { $match: { createdAt: { $gte: sevenDaysAgo } } },
      { $group: { _id: "$policyCategory", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 5 },
    ]);

    return res.json({
      success: true,
      overview: {
        pendingReports,
        highPriorityCases,
        activeSuspensions,
        permanentBans,
        pendingContent,
        ipRestrictions,
        recentActions,
        repeatTrends,
      },
    });
  } catch (error) {
    return next(error);
  }
};

// GET /api/admin/moderation/users/search?q=&limit=
exports.searchUsers = async (req, res, next) => {
  try {
    const q = String(req.query.q || "").trim();
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
    if (!q) return res.json({ success: true, users: [] });

    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const users = await User.find({
      $or: [
        { username: { $regex: escaped, $options: "i" } },
        { email: { $regex: escaped, $options: "i" } },
        { firstName: { $regex: escaped, $options: "i" } },
        { lastName: { $regex: escaped, $options: "i" } },
      ],
    })
      .select("firstName lastName username email bannedAt suspendedAt violationCount warningCount createdAt profile.avatar")
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    return res.json({ success: true, users });
  } catch (error) {
    return next(error);
  }
};

// GET /api/admin/moderation/users/:id
exports.getUserDetail = async (req, res, next) => {
  try {
    if (!validObjectId(req.params.id)) return res.status(400).json(errBody(ERROR_CODES.VALIDATION_ERROR, "Invalid id"));
    const user = await User.findById(req.params.id)
      .select("firstName lastName username email bannedAt banReason suspendedAt suspensionReason suspensionExpiresAt restrictions warningCount violationCount lastViolationAt createdAt profile tokenVersion")
      .lean();
    if (!user) return res.status(404).json(errBody(ERROR_CODES.NOT_FOUND, "User not found"));

    const [enforcements, reports, cases] = await Promise.all([
      EnforcementAction.find({ targetUser: user._id }).sort({ createdAt: -1 }).limit(50).populate("actor", "username email").lean(),
      ContentReport.find({ targetUser: user._id }).sort({ createdAt: -1 }).limit(20).lean(),
      ModerationCase.find({ targetUser: user._id }).sort({ createdAt: -1 }).limit(20).lean(),
    ]);

    return res.json({ success: true, user, enforcements, reports, cases });
  } catch (error) {
    return next(error);
  }
};

// POST /api/admin/moderation/users/:id/enforce
exports.enforceUser = async (req, res, next) => {
  try {
    if (!validObjectId(req.params.id)) return res.status(400).json(errBody(ERROR_CODES.VALIDATION_ERROR, "Invalid id"));
    const { actionType, reason, policyCategory, durationDays, expiresAt } = req.body;
    if (!actionType) return res.status(400).json(errBody(ERROR_CODES.VALIDATION_ERROR, "actionType required"));
    if (!reason || String(reason).trim().length < 5) return res.status(400).json(errBody(ERROR_CODES.VALIDATION_ERROR, "Reason required min 5 chars"));

    const userId = req.params.id;
    const user = await User.findById(userId);
    if (!user) return res.status(404).json(errBody(ERROR_CODES.NOT_FOUND, "User not found"));

    if (String(userId) === String(req.user.id)) {
      return res.status(400).json(errBody(ERROR_CODES.VALIDATION_ERROR, "Cannot enforce on yourself"));
    }

    let expires = null;
    if (expiresAt) expires = new Date(expiresAt);
    else if (durationDays) expires = new Date(Date.now() + Number(durationDays) * 24 * 60 * 60 * 1000);

    if (actionType === "permanent_ban") expires = null;

    const scopeMap = {
      warning: "account",
      content_removal: "content",
      posting_restriction: "feature",
      comment_restriction: "feature",
      messaging_restriction: "feature",
      event_creation_restriction: "feature",
      temporary_suspension: "account",
      permanent_ban: "account",
    };

    const scope = scopeMap[actionType] || "account";
    const idempotencyKey = `enforce-${userId}-${actionType}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    const enforcement = await enforcementService.recordEnforcementAction({
      targetUser: userId,
      actionType,
      scope,
      reason,
      policyCategory: policyCategory || "other",
      actor: req.user.id,
      expiresAt: expires,
      metadata: { durationDays },
      idempotencyKey,
    });

    await enforcementService.applyActionToUser({ user, action: enforcement });

    if (["temporary_suspension", "permanent_ban"].includes(actionType)) {
      await enforcementService.revokeUserSessions(userId);
    }

    return res.json({ success: true, enforcement });
  } catch (error) {
    if (error.status) return res.status(error.status).json(errBody(error.code, error.message));
    return next(error);
  }
};

// POST /api/admin/moderation/enforcement/:id/reverse
exports.reverseEnforcement = async (req, res, next) => {
  try {
    if (!validObjectId(req.params.id)) return res.status(400).json(errBody(ERROR_CODES.VALIDATION_ERROR, "Invalid id"));
    const { reversalReason } = req.body;
    if (!reversalReason || String(reversalReason).trim().length < 5) {
      return res.status(400).json(errBody(ERROR_CODES.VALIDATION_ERROR, "Reversal reason required"));
    }
    const reversed = await enforcementService.reverseEnforcement({ actionId: req.params.id, actor: req.user, reversalReason });
    return res.json({ success: true, enforcement: reversed });
  } catch (error) {
    if (error.status) return res.status(error.status).json(errBody(error.code, error.message));
    return next(error);
  }
};

// GET /api/admin/moderation/enforcements
exports.listEnforcements = async (req, res, next) => {
  try {
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const query = {};
    if (req.query.actionType) query.actionType = req.query.actionType;
    if (req.query.status) query.status = req.query.status;
    if (req.query.targetUser && validObjectId(req.query.targetUser)) query.targetUser = req.query.targetUser;

    const [enforcements, total] = await Promise.all([
      EnforcementAction.find(query)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate("targetUser", "username email firstName lastName")
        .populate("actor", "username email")
        .lean(),
      EnforcementAction.countDocuments(query),
    ]);

    return res.json({ success: true, enforcements, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (error) {
    return next(error);
  }
};

// IP restrictions
exports.listIpRestrictions = async (req, res, next) => {
  try {
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const query = {};
    if (req.query.active !== undefined) query.active = req.query.active === "true";
    const [restrictions, total] = await Promise.all([
      IpRestriction.find(query).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).populate("relatedUser", "username email").lean(),
      IpRestriction.countDocuments(query),
    ]);
    return res.json({ success: true, restrictions, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (error) {
    return next(error);
  }
};

exports.createIpRestriction = async (req, res, next) => {
  try {
    const { ip, reason, category, expiresInHours, relatedUser } = req.body;
    if (!ip) return res.status(400).json(errBody(ERROR_CODES.VALIDATION_ERROR, "IP required"));
    if (!reason || String(reason).trim().length < 5) return res.status(400).json(errBody(ERROR_CODES.VALIDATION_ERROR, "Reason required"));
    const expiresInMs = (Number(expiresInHours) || 24) * 60 * 60 * 1000;
    const restriction = await abuseService.createIpRestriction({
      ip,
      reason,
      source: "manual",
      category: category || "abuse",
      expiresInMs,
      createdBy: req.user.id,
      relatedUser: relatedUser && validObjectId(relatedUser) ? relatedUser : null,
    });
    return res.status(201).json({ success: true, restriction });
  } catch (error) {
    return next(error);
  }
};

exports.unblockIp = async (req, res, next) => {
  try {
    const { ip } = req.params;
    const { reason } = req.body;
    if (!ip) return res.status(400).json(errBody(ERROR_CODES.VALIDATION_ERROR, "IP required"));
    const count = await abuseService.unblockIp({ ip, actor: req.user, reason: reason || "Manual unblock" });
    return res.json({ success: true, unblocked: count });
  } catch (error) {
    return next(error);
  }
};

// GET /api/admin/moderation/audit
exports.getAuditLogs = async (req, res, next) => {
  try {
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const query = {};
    if (req.query.action) query.action = req.query.action;
    if (req.query.targetType) query.targetType = req.query.targetType;
    if (req.query.actor && validObjectId(req.query.actor)) query.actor = req.query.actor;

    const [logs, total] = await Promise.all([
      ModerationAuditLog.find(query)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate("actor", "username email")
        .lean(),
      ModerationAuditLog.countDocuments(query),
    ]);

    return res.json({ success: true, logs, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (error) {
    return next(error);
  }
};
