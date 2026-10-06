const Notification = require("../models/notification.model");
const User = require("../models/user.model");

/**
 * Fire-and-forget notification creator. Never throws — a failing
 * notification must never break the action that triggered it.
 * Self-notifications are skipped. Per-type mute preferences (user.
 * notificationPrefs) are honoured — the client can never override this.
 * actor may be null for system notifications (reminders, achievements).
 */
async function notify({ user, actor = null, type, post = undefined, event = undefined, organization = undefined, community = undefined }) {
  try {
    if (!user) return;
    if (actor && String(user) === String(actor)) return;
    const recipient = await User.findById(user).select("notificationPrefs").lean();
    if (!recipient || recipient.notificationPrefs?.[type]) return; // muted
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
