const Notification = require("../models/notification.model");
const User = require("../models/user.model");

// Claude #8: Budgeted notifications — cap pushes at ~3/week by default, only 4 triggers matter + weekly digest
// Critical types bypass budget: approval/rejection/cancellation/changes/registration
const CRITICAL_TYPES = new Set([
  "event_approved",
  "event_rejected",
  "event_cancelled",
  "event_changes_requested",
  "event_registration",
  "registration_confirmed",
  "ticket_ready",
]);
const DEFAULT_WEEKLY_CAP = 3;

async function checkBudget(userId, type) {
  if (CRITICAL_TYPES.has(type)) return true; // never cap critical
  try {
    const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000);
    const count = await Notification.countDocuments({
      user: userId,
      createdAt: { $gte: weekAgo },
      type: { $nin: Array.from(CRITICAL_TYPES) },
    });
    return count < DEFAULT_WEEKLY_CAP;
  } catch {
    return true; // fail open
  }
}

/**
 * Fire-and-forget notification creator. Never throws — a failing
 * notification must never break the action that triggered it.
 * Self-notifications are skipped. Per-type mute preferences (user.
 * notificationPrefs) are honoured — the client can never override this.
 * actor may be null for system notifications (reminders, achievements).
 * Budgeted: ~3/week cap for non-critical, critical bypasses.
 */
async function notify({ user, actor = null, type, post = undefined, event = undefined, organization = undefined, community = undefined }) {
  try {
    if (!user) return;
    if (actor && String(user) === String(actor)) return;
    const recipient = await User.findById(user).select("notificationPrefs").lean();
    if (!recipient || recipient.notificationPrefs?.[type]) return; // muted
    if (!(await checkBudget(user, type))) {
      console.log(`[notify] budget cap hit for ${user} type ${type} — skipped`);
      return;
    }
    await Notification.create({ user, actor, type, post, event, organization, community });
  } catch (err) {
    console.error("Notification create failed:", err.message);
  }
}

/**
 * Bulk variant for announcements (already filtered to non-actors).
 * Per-type mutes are honoured with ONE batched prefs lookup.
 * System docs (actor: null) are allowed.
 */
async function notifyMany(docs) {
  try {
    if (!docs?.length) return;
    const ids = [...new Set(docs.map((d) => String(d.user)))];
    const users = await User.find({ _id: { $in: ids } }).select("notificationPrefs").lean();
    // Per-user per-type check — prefs map, one DB query
    const prefsMap = new Map(users.map((u) => [String(u._id), u.notificationPrefs || {}]));
    const allowed = docs.filter((d) => !prefsMap.get(String(d.user))?.[d.type]);
    if (!allowed.length) return;
    await Notification.insertMany(allowed, { ordered: false });
  } catch (err) {
    console.error("Bulk notification failed:", err.message);
  }
}

module.exports = { notify, notifyMany };
