const mongoose = require("mongoose");

/**
 * Participant Session (Part 4, Phase 1) — the persistent identity of one
 * participant in one live event. Volatile presence (connected/reconnecting,
 * socket ids) lives in the realtime engine's memory, NEVER here (spec §4, §71).
 */
const participantSessionSchema = new mongoose.Schema(
  {
    event: { type: mongoose.Schema.Types.ObjectId, ref: "Event", required: true, index: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    joinedAt: { type: Date, default: Date.now },
    readyAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    // Running score across activities — updated by the server-authoritative
    // scoring engine only.
    score: { type: Number, default: 0, min: 0 },
    // Team mode foundation (Phase 5): lightweight team slot
    teamName: { type: String, default: "", maxlength: 60 },
    // Phase 6 (§41): chat moderation — muted participants can't send chat.
    // Persisted here so moderation survives reconnects (DB = truth).
    muted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// One logical participant per event (also the idempotency anchor for joins)
participantSessionSchema.index({ event: 1, user: 1 }, { unique: true });

module.exports = mongoose.model("ParticipantSession", participantSessionSchema);
