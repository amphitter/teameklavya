const Notification = require("../models/notification.model");
const User = require("../models/user.model");
const { NotificationRepository } = require("../repositories/notification.repository");
const { isCursorRequest, parseLimit } = require("../repositories/cursor");

const POPULATE = [
  { path: "actor", select: "firstName lastName username profile" },
  { path: "post", select: "content" },
  { path: "event", select: "title slug" },
  { path: "organization", select: "name slug" },
  { path: "community", select: "name slug" },
  { path: "conversation", select: "_id" },
];

// GET /api/notifications?limit=20&cursor=… (legacy `page` remains supported)
exports.getNotifications = async (req, res) => {
  try {
    const filter = { user: req.user.id };
    const unreadQuery = Notification.countDocuments({ ...filter, read: false });

    if (isCursorRequest(req.query)) {
      const [page, unread] = await Promise.all([
        NotificationRepository.listForUser({
          userId: req.user.id,
          limit: req.query.limit,
          cursor: req.query.cursor,
        }),
        unreadQuery,
      ]);
      return res.json({
        success: true,
        notifications: page.items,
        nextCursor: page.nextCursor,
        hasMore: page.hasMore,
        unreadCount: unread,
      });
    }

    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = parseLimit(req.query.limit, { def: 20, max: 50 });
    const [items, total, unread] = await Promise.all([
      Notification.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate(POPULATE)
        .lean(),
      Notification.countDocuments(filter),
      unreadQuery,
    ]);

    return res.json({ success: true, notifications: items, page, hasMore: page * limit < total, unreadCount: unread });
  } catch (error) {
    console.error("Get notifications error:", error.message);
    res.status(500).json({ success: false, message: "Failed to load notifications" });
  }
};

// GET /api/notifications/unread-count
exports.getUnreadCount = async (req, res) => {
  try {
    const unreadCount = await Notification.countDocuments({ user: req.user.id, read: false });
    res.json({ success: true, unreadCount });
  } catch (error) {
    console.error("Unread count error:", error.message);
    res.status(500).json({ success: false, message: "Failed to load unread count" });
  }
};

// POST /api/notifications/read-all
exports.markAllRead = async (req, res) => {
  try {
    await Notification.updateMany({ user: req.user.id, read: false }, { read: true });
    res.json({ success: true });
  } catch (error) {
    console.error("Mark all read error:", error.message);
    res.status(500).json({ success: false, message: "Failed to mark notifications read" });
  }
};

// POST /api/notifications/:id/read
exports.markRead = async (req, res) => {
  try {
    const notif = await Notification.findOne({ _id: req.params.id, user: req.user.id });
    if (!notif) return res.status(404).json({ success: false, message: "Notification not found" });
    notif.read = true;
    await notif.save();
    res.json({ success: true });
  } catch (error) {
    console.error("Mark read error:", error.message);
    res.status(500).json({ success: false, message: "Failed to mark notification read" });
  }
};


/* ── Notifications v2 (Part 3, Phase 8) ───────────────────── */

// DELETE /api/notifications/:id — remove one notification (owner only)
exports.deleteNotification = async (req, res) => {
  try {
    const notif = await Notification.findOneAndDelete({ _id: req.params.id, user: req.user.id });
    if (!notif) return res.status(404).json({ success: false, message: "Notification not found" });
    res.json({ success: true });
  } catch (error) {
    console.error("Delete notification error:", error.message);
    res.status(500).json({ success: false, message: "Failed to delete notification" });
  }
};

// POST /api/notifications/clear-read — delete every read notification
exports.clearRead = async (req, res) => {
  try {
    const result = await Notification.deleteMany({ user: req.user.id, read: true });
    res.json({ success: true, deleted: result.deletedCount || 0 });
  } catch (error) {
    console.error("Clear read error:", error.message);
    res.status(500).json({ success: false, message: "Failed to clear notifications" });
  }
};

// GET /api/notifications/preferences — per-type mute state + type catalog
exports.getPreferences = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("notificationPrefs").lean();
    const types = Notification.schema.path("type").enumValues;
    res.json({ success: true, types, mutes: user?.notificationPrefs || {} });
  } catch (error) {
    console.error("Get preferences error:", error.message);
    res.status(500).json({ success: false, message: "Failed to load preferences" });
  }
};

// PUT /api/notifications/preferences { mutes: { like: true, … } }
exports.updatePreferences = async (req, res) => {
  try {
    const mutes = req.body?.mutes;
    if (!mutes || typeof mutes !== "object") {
      return res.status(400).json({ success: false, message: "Body must include mutes" });
    }
    const allowedTypes = Notification.schema.path("type").enumValues;
    const clean = {};
    for (const [type, muted] of Object.entries(mutes)) {
      if (!allowedTypes.includes(type)) continue; // silently drop unknown types
      clean[type] = Boolean(muted);
    }
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    user.notificationPrefs = clean;
    await user.save();
    res.json({ success: true, mutes: clean });
  } catch (error) {
    console.error("Update preferences error:", error.message);
    res.status(500).json({ success: false, message: "Failed to save preferences" });
  }
};
