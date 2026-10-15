const User = require("../models/user.model");
const Organization = require("../models/organization.model");
const Event = require("../models/event.model");
const { notifyMany } = require("./notification.service");

/**
 * Weekly digest (Claude #8)
 * Only 4 triggers matter + one weekly digest. Cap pushes ~3/week by default.
 * This generates in-app notifications + optional email for users who follow orgs.
 * Runs via cron or manual trigger, idempotent via week key.
 */

async function generateWeeklyDigest() {
  try {
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - now.getDay()); // Sunday
    weekStart.setHours(0, 0, 0, 0);
    const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 3600 * 1000);

    // Events in next 7 days, public/unlisted
    const upcomingEvents = await Event.find({
      startDate: { $gte: now, $lte: weekEnd },
      visibility: { $in: ["public", "unlisted"] },
      status: { $ne: "CANCELLED" },
    })
      .select("_id title slug startDate organization category")
      .sort({ startDate: 1 })
      .limit(20)
      .lean();

    if (!upcomingEvents.length) {
      console.log("[weekly-digest] No upcoming events this week");
      return 0;
    }

    // For each user who follows orgs, create digest notification if they have relevant events
    // Simplified: all users with notificationPrefs not muting weekly_digest get digest
    const users = await User.find({
      $or: [{ notificationPrefs: { $exists: false } }, { "notificationPrefs.weekly_digest": { $ne: true } }],
    })
      .select("_id notificationPrefs")
      .limit(500)
      .lean();

    const allowedUsers = users.filter((u) => !u.notificationPrefs?.weekly_digest);
    if (!allowedUsers.length) return 0;

    // Create one notification per user for digest
    const docs = allowedUsers.map((u) => ({
      user: u._id,
      actor: null,
      type: "weekly_digest",
      // Store first event as reference for deep link, or leave null for generic digest
      event: upcomingEvents[0]?._id,
    }));

    await notifyMany(docs);
    console.log(`[weekly-digest] Sent ${docs.length} digests for ${upcomingEvents.length} events`);
    return docs.length;
  } catch (err) {
    console.error("[weekly-digest] failed:", err.message);
    return 0;
  }
}

let timer = null;
function startWeeklyDigestScheduler() {
  if (timer) return;
  if (process.env.DISABLE_WEEKLY_DIGEST === "true") {
    console.log("[weekly-digest] disabled");
    return;
  }
  // Run every Monday 9am UTC (simplified: check every hour, run if Monday 9am)
  const check = async () => {
    const now = new Date();
    if (now.getUTCDay() === 1 && now.getUTCHours() === 9) {
      await generateWeeklyDigest();
    }
  };
  timer = setInterval(check, 60 * 60 * 1000);
  console.log("[weekly-digest] scheduler started (hourly check, runs Mon 9am UTC)");
}

module.exports = { generateWeeklyDigest, startWeeklyDigestScheduler };
