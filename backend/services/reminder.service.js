const Event = require("../models/event.model");
const RegistrationResponse = require("../models/registrationResponse.model");
const EventInterest = require("../models/eventInterest.model");
const Notification = require("../models/notification.model");

/**
 * Event reminder scheduler (Part 3, Phase 8).
 *
 * Lightweight in-process job (default: every 15 minutes) that sends
 * "event_reminder" notifications to REGISTERED + INTERESTED users:
 *   · 24 hours before start  (window: 23h–25h ahead, not yet sent)
 *   ·  1 hour before start   (window: 50m–70m ahead, not yet sent)
 * Deterministic + deduped via Event.reminderSent timestamps. A reminder is
 * sent at most once per user per event per horizon — the notification
 * service's per-type mute preferences are honoured. Actor is null so the
 * item renders as an EventHub system notification.
 */

const USER_FIELDS = "user";

async function sendRemindersFor(horizon) {
  const now = Date.now();
  const windows = {
    h24: { from: now + 23 * 3600 * 1000, to: now + 25 * 3600 * 1000 },
    h1: { from: now + 50 * 60 * 1000, to: now + 70 * 60 * 1000 },
  };
  const w = windows[horizon];

  // Events starting inside the window whose reminder hasn't gone out yet
  const events = await Event.find({
    startDate: { $gte: new Date(w.from), $lte: new Date(w.to) },
    visibility: { $in: ["public", "unlisted"] },
    $expr: {
      $eq: [
        { $ifNull: [`$reminderSent.${horizon}`, null] }, null,
      ],
    },
  })
    .select("_id slug title startDate createdBy reminderSent")
    .lean();

  if (!events.length) return 0;

  let sent = 0;
  for (const event of events) {
    // Audience: registered + interested, deduped
    const [regs, interests] = await Promise.all([
      RegistrationResponse.find({ eventId: event._id }).select(USER_FIELDS).lean(),
      EventInterest.find({ event: event._id }).select(USER_FIELDS).lean(),
    ]);
    const audience = [
      ...new Set(regs.map((r) => String(r.userId)).concat(interests.map((i) => String(i.user)))),
    ];

    if (audience.length) {
      // Honour per-user mute preferences for this type
      const User = require("../models/user.model");
      const users = await User.find({ _id: { $in: audience } })
        .select("notificationPrefs")
        .lean();
      const allowed = users
        .filter((u) => !u.notificationPrefs?.event_reminder)
        .map((u) => String(u._id));

      if (allowed.length) {
        const docs = allowed.map((user) => ({
          user,
          actor: null,
          type: "event_reminder",
          event: event._id,
        }));
        await Notification.insertMany(docs, { ordered: false }).catch((err) =>
          console.error("Reminder insert failed:", err.message)
        );
        sent += allowed.length;
      }
    }

    // Dedupe: mark this horizon as sent regardless of audience size
    const update = {};
    update[`reminderSent.${horizon}`] = new Date();
    await Event.updateOne({ _id: event._id }, { $set: update });
  }
  return sent;
}

/** One scheduler tick — both horizons, never throws. */
async function reminderTick() {
  try {
    const a = await sendRemindersFor("h24");
    const b = await sendRemindersFor("h1");
    if (a || b) console.log(`⏰ Reminders sent: ${a} (24h) + ${b} (1h)`);
  } catch (err) {
    console.error("Reminder tick failed:", err.message);
  }
}

let timer = null;

function startReminderScheduler() {
  if (timer) return;
  if (process.env.DISABLE_REMINDERS === "true") {
    console.log("⏰ Event reminders disabled (DISABLE_REMINDERS=true)");
    return;
  }
  const minutes = Math.max(5, parseInt(process.env.REMINDER_INTERVAL_MIN) || 15);
  // First tick soon after boot, then on a fixed interval
  setTimeout(reminderTick, 60 * 1000);
  timer = setInterval(reminderTick, minutes * 60 * 1000);
  console.log(`⏰ Event reminder scheduler started (every ${minutes} min)`);
}

module.exports = { startReminderScheduler, reminderTick };
