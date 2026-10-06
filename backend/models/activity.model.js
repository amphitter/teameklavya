const mongoose = require("mongoose");

/**
 * Live Activity (Part 4, Phase 1) — the generic activity unit of the Live
 * Event Engine. Quiz is simply ONE activity type; polls, Q&A, leaderboards
 * and future activities (coding contests, surveys…) fit the same shape.
 *
 * State machine per §14: UPCOMING → READY → LIVE → (PAUSED ⇄ LIVE) → COMPLETED
 * Volatile live state transitions happen through the realtime engine
 * (Phase 2+); this document is the persistent source of truth.
 */
const activitySchema = new mongoose.Schema(
  {
    event: { type: mongoose.Schema.Types.ObjectId, ref: "Event", required: true, index: true },
    type: {
      type: String,
      enum: ["WELCOME", "QUIZ", "POLL", "QA", "LEADERBOARD", "CUSTOM"],
      default: "QUIZ",
      required: true,
    },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, trim: true, maxlength: 500, default: "" },
    order: { type: Number, default: 0 },
    state: {
      type: String,
      enum: ["UPCOMING", "READY", "LIVE", "PAUSED", "COMPLETED"],
      default: "UPCOMING",
      index: true,
    },
    // Per-type configuration payload (poll settings, QA settings,
    // leaderboard mode, custom activity payload…). Kept as Mixed so new
    // activity types don't require schema migrations.
    config: { type: mongoose.Schema.Types.Mixed, default: {} },
    // Lifecycle timestamps (Phase 3) — analytics + deterministic reconnect
    startedAt: { type: Date, default: null },
    endedAt: { type: Date, default: null },
    // ── Question runtime (Phase 4): which question is open + synchronized
    // clock state. Server-derived remaining time; clients NEVER own time.
    questionRuntime: {
      questionId: { type: mongoose.Schema.Types.ObjectId, default: null },
      index: { type: Number, default: 0 },
      durationSec: { type: Number, default: 30 },
      startedAt: { type: Date, default: null }, // null while paused
      elapsedBeforePause: { type: Number, default: 0 }, // ms
      closed: { type: Boolean, default: false },
    },
    // Phase 6 (§40): Q&A activities stop accepting submissions when closed.
    // Lives on the document so reconnects/late organizers see the same truth.
    qaClosed: { type: Boolean, default: false },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

activitySchema.index({ event: 1, order: 1 });

module.exports = mongoose.model("Activity", activitySchema);
