const mongoose = require("mongoose");

/**
 * Live Answer (Part 4, Phase 1) — one answer per participant per question.
 * The unique index (session, question) is the server-side idempotency
 * guarantee (spec §27, §53): duplicate submissions cannot double-score.
 *
 * Scoring is ALWAYS server-authoritative (spec §28). Subjective answers are
 * stored with status "pending_review" — never client-graded.
 */
const liveAnswerSchema = new mongoose.Schema(
  {
    session: { type: mongoose.Schema.Types.ObjectId, ref: "ParticipantSession", required: true, index: true },
    event: { type: mongoose.Schema.Types.ObjectId, ref: "Event", required: true, index: true },
    activity: { type: mongoose.Schema.Types.ObjectId, ref: "Activity", required: true, index: true },
    question: { type: mongoose.Schema.Types.ObjectId, ref: "Question", required: true },
    answer: { type: mongoose.Schema.Types.Mixed, default: null }, // index | [indices] | text
    correct: { type: Boolean, default: null }, // null = not yet determined (pending review)
    points: { type: Number, default: 0 },
    responseTime: { type: Number, default: 0 }, // ms from question start to submission
    answeredAt: { type: Date, default: Date.now },
    status: { type: String, enum: ["scored", "pending_review"], default: "scored" },
  },
  { timestamps: true }
);

// Idempotency: first valid submission counts (spec §53)
liveAnswerSchema.index({ session: 1, question: 1 }, { unique: true });
// Analytics: per-question distribution and response times
liveAnswerSchema.index({ activity: 1, question: 1 });

module.exports = mongoose.model("LiveAnswer", liveAnswerSchema);
