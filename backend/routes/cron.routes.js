const express = require("express");
const router = express.Router();
const { reminderTick } = require("../services/reminder.service");
const { generateWeeklyDigest } = require("../services/weekly-digest.service");

/**
 * External cron endpoint for Render sleep mitigation.
 * Claude #2: in-process scheduler won't fire if instance asleep.
 * Use external cron (e.g., Upstash QStash, Render cron, GitHub Actions)
 * hitting POST /api/cron/reminders with header x-cron-secret = CRON_SECRET env.
 * Idempotent via Event.reminderSent timestamps — safe to call frequently.
 */

router.post("/reminders", async (req, res) => {
  const secret = process.env.CRON_SECRET;
  // If CRON_SECRET not set, allow in dev but require in prod
  if (secret) {
    const provided = req.headers["x-cron-secret"] || req.query.secret;
    if (provided !== secret) {
      return res.status(401).json({
        success: false,
        message: "Invalid cron secret",
        error: { code: "UNAUTHORIZED", message: "Invalid cron secret" },
      });
    }
  } else if (process.env.NODE_ENV === "production") {
    console.warn("[cron] CRON_SECRET not set in production — cron endpoint open");
  }

  try {
    await reminderTick();
    return res.json({ success: true, message: "Reminder tick executed" });
  } catch (err) {
    console.error("[cron] reminder tick failed:", err.message);
    return res.status(500).json({
      success: false,
      message: "Reminder tick failed",
      error: { code: "INTERNAL", message: err.message },
    });
  }
});

// Weekly digest trigger
router.post("/weekly-digest", async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const provided = req.headers["x-cron-secret"] || req.query.secret;
    if (provided !== secret) {
      return res.status(401).json({ success: false, message: "Invalid cron secret" });
    }
  }
  try {
    const count = await generateWeeklyDigest();
    return res.json({ success: true, sent: count });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Health for cron monitoring
router.get("/health", (req, res) => {
  res.json({ status: "OK", service: "cron", timestamp: new Date().toISOString() });
});

module.exports = router;
