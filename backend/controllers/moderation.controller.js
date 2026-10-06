/**
 * Moderation controller (Part 3, Phase 10) — report system + admin actions.
 * ─────────────────────────────────────────────────────────────────────────
 *  POST /api/moderation/reports              create a report (auth)
 *  GET  /api/moderation/reports?status=      moderation queue (admin)
 *  GET  /api/moderation/my-reports           my reports + status (auth)
 *  POST /api/moderation/reports/:id/resolve  act on a report (admin)
 *  POST /api/moderation/suspend-user         { userId, reason } (admin)
 *  POST /api/moderation/unsuspend-user       { userId } (admin)
 *  GET  /api/moderation/stats                queue counts (admin)
 *
 * All permission checks are server-side (requireAuth / requireAdmin in
 * routes). Every admin action writes an immutable AuditLog entry.
 */
const Report = require("../models/report.model");
const Post = require("../models/post.model");
const Comment = require("../models/comment.model");
const Event = require("../models/event.model");
const User = require("../models/user.model");
const AuditLog = require("../models/auditLog.model");

const REPORTER_FIELDS = "firstName lastName username profile";
const REASONS = ["spam", "harassment", "inappropriate", "misinformation", "other"];

/** Fire-and-forget audit entry — never blocks the action. */
function audit(actor, action, details = "") {
  AuditLog.create({ community: null, organization: null, actor, action, details }).catch((e) =>
    console.error("Audit log error:", e.message)
  );
}

/** Resolve ALL open reports on a target (multiple reporters → one action). */
async function markTargetActioned(targetType, targetId, adminId, resolution) {
  await Report.updateMany(
    { targetType, targetId, status: "open" },
    { status: "actioned", resolution, resolvedBy: adminId, resolvedAt: new Date() }
  );
}

/** Load the target and return { targetUser, snapshot } or null. */
async function loadTarget(targetType, targetId) {
  if (targetType === "post") {
    const post = await Post.findById(targetId).select("author content status").lean();
    if (!post) return null;
    return { targetUser: post.author, snapshot: String(post.content || "").slice(0, 280) };
  }
  if (targetType === "comment") {
    const comment = await Comment.findById(targetId).select("author content removedAt").lean();
    if (!comment) return null;
    return { targetUser: comment.author, snapshot: String(comment.content || "").slice(0, 280) };
  }
  if (targetType === "event") {
    const event = await Event.findById(targetId).select("title createdBy organizer removedAt").lean();
    if (!event) return null;
    return { targetUser: event.createdBy || event.organizer || null, snapshot: `Event: ${event.title}` };
  }
  if (targetType === "user") {
    const user = await User.findById(targetId).select("firstName lastName username").lean();
    if (!user) return null;
    return { targetUser: user._id, snapshot: `User: ${user.firstName} ${user.lastName} (@${user.username || ""})` };
  }
  return null;
}

// POST /api/moderation/reports  { targetType, targetId, reason, details? }
exports.createReport = async (req, res) => {
  try {
    const { targetType, targetId, reason, details } = req.body;
    if (!REASONS.includes(reason)) {
      return res.status(400).json({ success: false, message: "Pick a valid reason" });
    }
    if (!["post", "comment", "event", "user"].includes(targetType)) {
      return res.status(400).json({ success: false, message: "Invalid report target" });
    }

    const target = await loadTarget(targetType, targetId);
    if (!target) return res.status(404).json({ success: false, message: "Target not found" });
    if (String(target.targetUser) === String(req.user.id)) {
      return res.status(400).json({ success: false, message: "You can't report your own content" });
    }

    // Dedupe: one report per user per target
    const existing = await Report.findOne({ targetType, targetId, reporter: req.user.id }).lean();
    if (existing) {
      return res.json({ success: true, alreadyReported: true, status: existing.status });
    }

    const report = await Report.create({
      reporter: req.user.id,
      targetType,
      targetId,
      targetUser: target.targetUser,
      snapshot: target.snapshot,
      reason,
      details: String(details || "").slice(0, 500),
    });
    res.status(201).json({ success: true, report: { _id: report._id, status: report.status } });
  } catch (error) {
    console.error("Create report error:", error.message);
    res.status(500).json({ success: false, message: "Failed to submit report" });
  }
};

// GET /api/moderation/reports?status=open|dismissed|actioned  (admin queue)
exports.getReports = async (req, res) => {
  try {
    const status = ["open", "dismissed", "actioned"].includes(req.query.status) ? req.query.status : "open";
    const reports = await Report.find({ status })
      .sort({ createdAt: -1 })
      .limit(100)
      .populate("reporter", REPORTER_FIELDS)
      .populate("targetUser", REPORTER_FIELDS)
      .lean();
    res.json({ success: true, reports });
  } catch (error) {
    console.error("Get reports error:", error.message);
    res.status(500).json({ success: false, message: "Failed to load reports" });
  }
};

// GET /api/moderation/my-reports
exports.getMyReports = async (req, res) => {
  try {
    const reports = await Report.find({ reporter: req.user.id })
      .sort({ createdAt: -1 })
      .limit(50)
      .select("targetType targetId snapshot reason status resolution createdAt")
      .lean();
    res.json({ success: true, reports });
  } catch (error) {
    console.error("My reports error:", error.message);
    res.status(500).json({ success: false, message: "Failed to load your reports" });
  }
};

// POST /api/moderation/reports/:id/resolve  { action, note?, suspendReason? }
// action: dismiss | hide_post | remove_comment | takedown_event | suspend_user
exports.resolveReport = async (req, res) => {
  try {
    const { action, note, suspendReason } = req.body;
    const report = await Report.findById(req.params.id);
    if (!report) return res.status(404).json({ success: false, message: "Report not found" });

    const adminId = req.user.id;
    const targetType = report.targetType;
    const targetId = report.targetId;

    if (action === "dismiss") {
      report.status = "dismissed";
      report.resolution = String(note || "Dismissed").slice(0, 300);
      report.resolvedBy = adminId;
      report.resolvedAt = new Date();
      await report.save();
      audit(adminId, "report_dismissed", `#${report._id} ${targetType} — ${report.resolution}`);
      return res.json({ success: true });
    }

    // Content actions — validate action matches target type
    const actionFor = { post: "hide_post", comment: "remove_comment", event: "takedown_event", user: "suspend_user" };
    if (actionFor[targetType] !== action) {
      return res.status(400).json({ success: false, message: `Invalid action for a ${targetType} report` });
    }

    if (action === "hide_post") {
      const post = await Post.findByIdAndUpdate(targetId, { status: "hidden" }, { new: true }).select("_id");
      if (!post) return res.status(404).json({ success: false, message: "Post no longer exists" });
    } else if (action === "remove_comment") {
      const comment = await Comment.findByIdAndUpdate(
        targetId,
        { removedAt: new Date(), removedBy: adminId },
        { new: true }
      ).select("_id");
      if (!comment) return res.status(404).json({ success: false, message: "Comment no longer exists" });
    } else if (action === "takedown_event") {
      const event = await Event.findByIdAndUpdate(
        targetId,
        { removedAt: new Date(), removedBy: adminId },
        { new: true }
      ).select("_id");
      if (!event) return res.status(404).json({ success: false, message: "Event no longer exists" });
    } else if (action === "suspend_user") {
      // The permanent super admin can never be suspended (server-side rule)
      const SUPER_ADMIN_EMAIL = (process.env.SUPER_ADMIN_EMAIL || "devanshsinghr00@gmail.com").toLowerCase();
      const target = await User.findById(targetId).select("email").lean();
      if (!target) return res.status(404).json({ success: false, message: "User no longer exists" });
      if (String(target.email).toLowerCase() === SUPER_ADMIN_EMAIL) {
        return res.status(403).json({ success: false, message: "The super admin cannot be suspended" });
      }
      const reason = String(suspendReason || "Policy violation").slice(0, 300);
      await User.findByIdAndUpdate(targetId, { suspendedAt: new Date(), suspensionReason: reason });
    }

    // Mark THIS report + every other open report on the same target as actioned
    const resolution = String(note || action).slice(0, 300);
    report.status = "actioned";
    report.resolution = resolution;
    report.resolvedBy = adminId;
    report.resolvedAt = new Date();
    await report.save();
    await Report.updateMany(
      { targetType, targetId, status: "open", _id: { $ne: report._id } },
      { status: "actioned", resolution, resolvedBy: adminId, resolvedAt: new Date() }
    );
    audit(adminId, `report_actioned_${action}`, `#${report._id} ${targetType} — ${resolution}`);
    res.json({ success: true });
  } catch (error) {
    console.error("Resolve report error:", error.message);
    res.status(500).json({ success: false, message: "Failed to resolve report" });
  }
};

// POST /api/moderation/suspend-user  { userId, reason }  (admin, standalone)
exports.suspendUser = async (req, res) => {
  try {
    const { userId, reason } = req.body;
    const reasonText = String(reason || "Policy violation").slice(0, 300);
    const target = await User.findById(userId).select("email suspendedAt").lean();
    if (!target) return res.status(404).json({ success: false, message: "User not found" });

    // The permanent super admin can never be suspended (server-side rule)
    const SUPER_ADMIN_EMAIL = (process.env.SUPER_ADMIN_EMAIL || "devanshsinghr00@gmail.com").toLowerCase();
    if (String(target.email).toLowerCase() === SUPER_ADMIN_EMAIL) {
      return res.status(403).json({ success: false, message: "The super admin cannot be suspended" });
    }

    await User.findByIdAndUpdate(userId, { suspendedAt: new Date(), suspensionReason: reasonText });
    audit(req.user.id, "user_suspended", `${target.email} — ${reasonText}`);
    res.json({ success: true });
  } catch (error) {
    console.error("Suspend user error:", error.message);
    res.status(500).json({ success: false, message: "Failed to suspend user" });
  }
};

// POST /api/moderation/unsuspend-user  { userId }  (admin)
exports.unsuspendUser = async (req, res) => {
  try {
    const { userId } = req.body;
    const user = await User.findByIdAndUpdate(userId, { suspendedAt: null, suspensionReason: "" }, { new: true }).select("_id");
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    audit(req.user.id, "user_unsuspended", String(userId));
    res.json({ success: true });
  } catch (error) {
    console.error("Unsuspend user error:", error.message);
    res.status(500).json({ success: false, message: "Failed to unsuspend user" });
  }
};

// GET /api/moderation/stats  (admin — queue tab counts)
exports.getStats = async (req, res) => {
  try {
    const [open, dismissed, actioned, suspended] = await Promise.all([
      Report.countDocuments({ status: "open" }),
      Report.countDocuments({ status: "dismissed" }),
      Report.countDocuments({ status: "actioned" }),
      User.countDocuments({ suspendedAt: { $ne: null } }),
    ]);
    res.json({ success: true, stats: { open, dismissed, actioned, suspended } });
  } catch (error) {
    console.error("Moderation stats error:", error.message);
    res.status(500).json({ success: false, message: "Failed to load stats" });
  }
};
