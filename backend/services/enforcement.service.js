"use strict";

/**
 * Enforcement Service — progressive enforcement, warnings, restrictions, suspensions, bans, session revocation, IP restrictions
 */

const mongoose = require("mongoose");
const User = require("../models/user.model");
const { EnforcementAction } = require("../models/enforcementAction.model");
const { IpRestriction } = require("../models/ipRestriction.model");
const { ModerationAuditLog } = require("../models/moderationAuditLog.model");
const { ValidationError, NotFoundError, ConflictError } = require("../utils/app-error");

// Configurable policy stages (example, not universal fixed penalties)
const POLICY = {
  // First confirmed minor violation: warning + content removal
  // Repeated minor: temp feature restriction
  // Further: short suspension
  // Continued serious: longer suspension
  // Severe/persistent: permanent ban

  thresholds: {
    warning: 1,
    restriction: 2,
    shortSuspension: 3,
    longSuspension: 5,
    ban: 7,
  },
  durations: {
    posting_restriction: 24 * 60 * 60 * 1000, // 24h
    commenting_restriction: 24 * 60 * 60 * 1000,
    messaging_restriction: 24 * 60 * 60 * 1000,
    event_creation_restriction: 7 * 24 * 60 * 60 * 1000, // 7 days
    short_suspension: 3 * 24 * 60 * 60 * 1000, // 3 days
    long_suspension: 30 * 24 * 60 * 60 * 1000, // 30 days
  },
  severeCategories: ["csam", "sexual_exploitation", "explicit_nudity", "threats"],
};

async function recordEnforcementAction({
  targetUser,
  actionType,
  scope,
  reason,
  policyCategory,
  actor,
  actorType = "human",
  expiresAt = null,
  relatedCase = null,
  relatedReports = [],
  metadata = {},
  idempotencyKey = null,
}) {
  // Prevent duplicate active actions
  if (idempotencyKey) {
    const existing = await EnforcementAction.findOne({ idempotencyKey }).lean();
    if (existing) {
      return existing;
    }
  }

  // Check for conflicting active actions
  const activeQuery = {
    targetUser,
    actionType,
    status: "active",
  };
  if (targetUser) {
    // For account-level actions, check if already active
    const existingActive = await EnforcementAction.findOne(activeQuery).lean();
    if (existingActive && actionType !== "warning" && actionType !== "content_removal") {
      // Allow warnings and content removals to stack, but prevent duplicate restrictions/suspensions/bans
      if (["posting_restriction", "comment_restriction", "messaging_restriction", "event_creation_restriction", "temporary_suspension", "permanent_ban"].includes(actionType)) {
        throw new ConflictError(`Active ${actionType} already exists for this user`);
      }
    }
  }

  const action = await EnforcementAction.create({
    targetUser,
    actionType,
    scope,
    reason,
    policyCategory,
    actor,
    actorType,
    expiresAt,
    relatedCase,
    relatedReports,
    metadata,
    idempotencyKey,
  });

  // Audit log
  try {
    await ModerationAuditLog.create({
      actor,
      actorType,
      action: actionType,
      targetType: "user",
      targetId: targetUser,
      previousState: {},
      resultingState: { actionType, scope, reason, expiresAt },
      reason,
      policyCategory,
      duration: expiresAt ? `${Math.round((new Date(expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24))} days` : "permanent",
      metadata,
      relatedCase,
    });
  } catch {}

  return action;
}

async function applyProgressiveEnforcement({ userId, policyCategory, reason, relatedCase, relatedReports, actor }) {
  const user = await User.findById(userId);
  if (!user) throw new NotFoundError("User not found");

  // Increment violation count
  user.violationCount = (user.violationCount || 0) + 1;
  user.lastViolationAt = new Date();
  await user.save();

  const count = user.violationCount;
  let actionType = "warning";
  let scope = "account";
  let expiresAt = null;
  let durationMs = null;

  // Severe categories: immediate containment
  if (POLICY.severeCategories.includes(policyCategory)) {
    actionType = "temporary_suspension";
    scope = "account";
    durationMs = POLICY.durations.short_suspension;
    expiresAt = new Date(Date.now() + durationMs);
  } else if (count >= POLICY.thresholds.ban) {
    actionType = "permanent_ban";
    scope = "account";
    expiresAt = null;
  } else if (count >= POLICY.thresholds.longSuspension) {
    actionType = "temporary_suspension";
    scope = "account";
    durationMs = POLICY.durations.long_suspension;
    expiresAt = new Date(Date.now() + durationMs);
  } else if (count >= POLICY.thresholds.shortSuspension) {
    actionType = "temporary_suspension";
    scope = "account";
    durationMs = POLICY.durations.short_suspension;
    expiresAt = new Date(Date.now() + durationMs);
  } else if (count >= POLICY.thresholds.restriction) {
    // Rotate restrictions: posting, commenting, messaging, event creation
    const restrictions = ["posting_restriction", "comment_restriction", "messaging_restriction", "event_creation_restriction"];
    actionType = restrictions[(count - POLICY.thresholds.restriction) % restrictions.length];
    scope = "feature";
    durationMs = POLICY.durations[actionType] || POLICY.durations.posting_restriction;
    expiresAt = new Date(Date.now() + durationMs);
  } else {
    actionType = "warning";
    scope = "account";
  }

  const idempotencyKey = `enforce-${userId}-${actionType}-${Date.now()}`;

  const action = await recordEnforcementAction({
    targetUser: userId,
    actionType,
    scope,
    reason,
    policyCategory,
    actor,
    expiresAt,
    relatedCase,
    relatedReports,
    metadata: { violationCount: count, progressive: true },
    idempotencyKey,
  });

  // Apply to user model
  await applyActionToUser({ user, action });

  // Session revocation for suspensions/bans
  if (["temporary_suspension", "permanent_ban"].includes(actionType)) {
    await revokeUserSessions(userId);
  }

  // Notification via existing infrastructure
  try {
    const { notify } = require("./notification.service");
    await notify({
      user: userId,
      actor,
      type: "announcement",
      // We use announcement type for enforcement, but could have dedicated types
    });
  } catch {}

  return action;
}

async function applyActionToUser({ user, action }) {
  const now = new Date();
  switch (action.actionType) {
    case "warning":
      user.warningCount = (user.warningCount || 0) + 1;
      break;
    case "posting_restriction":
      user.restrictions = user.restrictions || {};
      user.restrictions.posting = { until: action.expiresAt, reason: action.reason };
      break;
    case "comment_restriction":
      user.restrictions = user.restrictions || {};
      user.restrictions.commenting = { until: action.expiresAt, reason: action.reason };
      break;
    case "messaging_restriction":
      user.restrictions = user.restrictions || {};
      user.restrictions.messaging = { until: action.expiresAt, reason: action.reason };
      break;
    case "event_creation_restriction":
      user.restrictions = user.restrictions || {};
      user.restrictions.eventCreation = { until: action.expiresAt, reason: action.reason };
      break;
    case "temporary_suspension":
      user.suspendedAt = now;
      user.suspensionReason = action.reason;
      user.suspensionExpiresAt = action.expiresAt;
      break;
    case "permanent_ban":
      user.bannedAt = now;
      user.banReason = action.reason;
      user.banCategory = action.policyCategory;
      break;
    default:
      break;
  }
  await user.save();
}

async function revokeUserSessions(userId) {
  const user = await User.findById(userId);
  if (!user) return;
  user.tokenVersion = (user.tokenVersion || 0) + 1;
  await user.save();

  // Also disconnect Socket.IO connections
  try {
    const { getIo } = require("./realtime.service");
    const io = getIo ? getIo() : null;
    if (io) {
      // Find sockets for this user and disconnect
      for (const [id, socket] of io.of("/").sockets) {
        if (socket.user && String(socket.user.id) === String(userId)) {
          socket.disconnect(true);
        }
      }
    }
  } catch {}
}

async function checkFeatureRestriction(userId, feature) {
  const user = await User.findById(userId).select("restrictions bannedAt suspendedAt suspensionExpiresAt").lean();
  if (!user) return { restricted: false };

  if (user.bannedAt) {
    return { restricted: true, reason: "Account permanently banned", type: "permanent_ban" };
  }
  if (user.suspendedAt) {
    if (user.suspensionExpiresAt && new Date(user.suspensionExpiresAt).getTime() < Date.now()) {
      // expired
      return { restricted: false };
    }
    return { restricted: true, reason: user.suspensionReason || "Account suspended", type: "temporary_suspension", expiresAt: user.suspensionExpiresAt };
  }

  const restrictionMap = {
    posting: user.restrictions?.posting,
    commenting: user.restrictions?.commenting,
    messaging: user.restrictions?.messaging,
    eventCreation: user.restrictions?.eventCreation,
  };

  const restriction = restrictionMap[feature];
  if (restriction && restriction.until) {
    if (new Date(restriction.until).getTime() > Date.now()) {
      return { restricted: true, reason: restriction.reason, type: `${feature}_restriction`, expiresAt: restriction.until };
    }
  }

  return { restricted: false };
}

async function reverseEnforcement({ actionId, actor, reversalReason }) {
  const action = await EnforcementAction.findById(actionId);
  if (!action) throw new NotFoundError("Enforcement action not found");
  if (action.status !== "active") {
    throw new ValidationError(`Cannot reverse action in status ${action.status}`);
  }

  action.status = "reversed";
  action.reversedBy = actor._id || actor.id;
  action.reversedAt = new Date();
  action.reversalReason = reversalReason;
  await action.save();

  // Reverse in user model
  const user = await User.findById(action.targetUser);
  if (user) {
    switch (action.actionType) {
      case "temporary_suspension":
        user.suspendedAt = null;
        user.suspensionReason = "";
        user.suspensionExpiresAt = null;
        break;
      case "permanent_ban":
        user.bannedAt = null;
        user.banReason = "";
        user.banCategory = "";
        break;
      case "posting_restriction":
        if (user.restrictions?.posting) user.restrictions.posting.until = null;
        break;
      case "comment_restriction":
        if (user.restrictions?.commenting) user.restrictions.commenting.until = null;
        break;
      case "messaging_restriction":
        if (user.restrictions?.messaging) user.restrictions.messaging.until = null;
        break;
      case "event_creation_restriction":
        if (user.restrictions?.eventCreation) user.restrictions.eventCreation.until = null;
        break;
      default:
        break;
    }
    await user.save();
  }

  // Audit
  try {
    await ModerationAuditLog.create({
      actor: actor._id || actor.id,
      action: "enforcement_reversal",
      targetType: "enforcement",
      targetId: action._id,
      previousState: { status: "active" },
      resultingState: { status: "reversed", reversalReason },
      reason: reversalReason,
      metadata: { originalAction: action.actionType },
      relatedCase: action.relatedCase,
    });
  } catch {}

  return action;
}

async function expireOldRestrictions() {
  // Find expired enforcement actions and mark expired
  const now = new Date();
  const expiredActions = await EnforcementAction.find({
    status: "active",
    expiresAt: { $ne: null, $lt: now },
  }).lean();

  for (const action of expiredActions) {
    await EnforcementAction.updateOne({ _id: action._id }, { $set: { status: "expired" } });

    // Clear from user model
    const user = await User.findById(action.targetUser);
    if (!user) continue;

    switch (action.actionType) {
      case "temporary_suspension":
        if (user.suspensionExpiresAt && new Date(user.suspensionExpiresAt).getTime() < now.getTime()) {
          user.suspendedAt = null;
          user.suspensionReason = "";
          user.suspensionExpiresAt = null;
          await user.save();
        }
        break;
      case "posting_restriction":
        if (user.restrictions?.posting?.until && new Date(user.restrictions.posting.until).getTime() < now.getTime()) {
          user.restrictions.posting.until = null;
          await user.save();
        }
        break;
      case "comment_restriction":
        if (user.restrictions?.commenting?.until && new Date(user.restrictions.commenting.until).getTime() < now.getTime()) {
          user.restrictions.commenting.until = null;
          await user.save();
        }
        break;
      case "messaging_restriction":
        if (user.restrictions?.messaging?.until && new Date(user.restrictions.messaging.until).getTime() < now.getTime()) {
          user.restrictions.messaging.until = null;
          await user.save();
        }
        break;
      case "event_creation_restriction":
        if (user.restrictions?.eventCreation?.until && new Date(user.restrictions.eventCreation.until).getTime() < now.getTime()) {
          user.restrictions.eventCreation.until = null;
          await user.save();
        }
        break;
      default:
        break;
    }
  }

  return expiredActions.length;
}

module.exports = {
  POLICY,
  recordEnforcementAction,
  applyProgressiveEnforcement,
  applyActionToUser,
  revokeUserSessions,
  checkFeatureRestriction,
  reverseEnforcement,
  expireOldRestrictions,
};
