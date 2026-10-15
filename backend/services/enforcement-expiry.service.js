"use strict";

const { EnforcementAction } = require("../models/enforcementAction.model");
const { IpRestriction } = require("../models/ipRestriction.model");
const User = require("../models/user.model");

async function expireEnforcementsTick() {
  try {
    const now = new Date();
    const expired = await EnforcementAction.find({
      status: "active",
      expiresAt: { $ne: null, $lt: now },
    }).limit(100).lean();

    if (!expired.length) return 0;

    let cleared = 0;
    for (const action of expired) {
      await EnforcementAction.updateOne({ _id: action._id }, { $set: { status: "expired" } });
      const user = await User.findById(action.targetUser);
      if (!user) continue;
      let changed = false;
      switch (action.actionType) {
        case "temporary_suspension":
          if (user.suspensionExpiresAt && new Date(user.suspensionExpiresAt).getTime() < now.getTime()) {
            user.suspendedAt = null;
            user.suspensionReason = "";
            user.suspensionExpiresAt = null;
            changed = true;
          }
          break;
        case "posting_restriction":
          if (user.restrictions?.posting?.until && new Date(user.restrictions.posting.until).getTime() < now.getTime()) {
            user.restrictions.posting.until = null;
            changed = true;
          }
          break;
        case "comment_restriction":
          if (user.restrictions?.commenting?.until && new Date(user.restrictions.commenting.until).getTime() < now.getTime()) {
            user.restrictions.commenting.until = null;
            changed = true;
          }
          break;
        case "messaging_restriction":
          if (user.restrictions?.messaging?.until && new Date(user.restrictions.messaging.until).getTime() < now.getTime()) {
            user.restrictions.messaging.until = null;
            changed = true;
          }
          break;
        case "event_creation_restriction":
          if (user.restrictions?.eventCreation?.until && new Date(user.restrictions.eventCreation.until).getTime() < now.getTime()) {
            user.restrictions.eventCreation.until = null;
            changed = true;
          }
          break;
        default:
          break;
      }
      if (changed) {
        await user.save();
        cleared++;
      }
    }
    if (cleared) console.log(`[enforcement-expiry] cleared ${cleared} expired enforcements`);
    return cleared;
  } catch (err) {
    console.error("[enforcement-expiry] tick failed:", err.message);
    return 0;
  }
}

async function expireIpRestrictionsTick() {
  try {
    const now = new Date();
    const result = await IpRestriction.updateMany(
      { active: true, expiresAt: { $lt: now } },
      { $set: { active: false } }
    );
    if (result.modifiedCount) {
      console.log(`[ip-expiry] expired ${result.modifiedCount} IP restrictions`);
    }
    return result.modifiedCount || 0;
  } catch (err) {
    console.error("[ip-expiry] tick failed:", err.message);
    return 0;
  }
}

async function combinedTick() {
  await expireEnforcementsTick();
  await expireIpRestrictionsTick();
}

let timer = null;

function startEnforcementExpiryScheduler() {
  if (timer) return;
  if (process.env.DISABLE_ENFORCEMENT_EXPIRY === "true") {
    console.log("[enforcement-expiry] disabled");
    return;
  }
  const minutes = Math.max(1, parseInt(process.env.ENFORCEMENT_EXPIRY_INTERVAL_MIN) || 5);
  setTimeout(combinedTick, 30 * 1000);
  timer = setInterval(combinedTick, minutes * 60 * 1000);
  console.log(`[enforcement-expiry] scheduler started every ${minutes} min`);
}

module.exports = { startEnforcementExpiryScheduler, expireEnforcementsTick, expireIpRestrictionsTick, combinedTick };
