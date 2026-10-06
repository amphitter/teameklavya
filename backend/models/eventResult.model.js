const mongoose = require("mongoose");

/**
 * Event Result (Part 4, Phase 1) — the final, immutable-ish snapshot created
 * when an event completes (spec §73). Source of truth for the final
 * leaderboard, certificates, analytics and event memories.
 *
 * Immutability discipline: finalized results are never updated through API
 * paths; corrections would come from an explicit admin flow only.
 */
const eventResultSchema = new mongoose.Schema(
  {
    event: { type: mongoose.Schema.Types.ObjectId, ref: "Event", required: true, unique: true },
    // Full ranking: [{ participantId, displayName, avatar, score, rank,
    // correctAnswers, accuracy, team }]
    leaderboard: { type: mongoose.Schema.Types.Mixed, default: [] },
    // Per-activity summaries: [{ activityId, type, title, participants,
    // completion, averageScore }]
    activities: { type: mongoose.Schema.Types.Mixed, default: [] },
    // Phase 8 (§65) per-question analytics: [{ questionId, activityId, type,
    // text, totalAnswers, correctCount, correctPct, avgResponseMs, distribution }]
    questions: { type: mongoose.Schema.Types.Mixed, default: [] },
    // Event-level summary: { totalParticipants, completionRate, averageScore, … }
    summary: { type: mongoose.Schema.Types.Mixed, default: {} },
    finalizedAt: { type: Date, default: Date.now },
    finalizedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("EventResult", eventResultSchema);
