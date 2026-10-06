const mongoose = require("mongoose");

/**
 * Q&A Question (Part 4, Phase 1) — audience-submitted questions with upvotes
 * and organizer moderation states (spec §40).
 */
const qaQuestionSchema = new mongoose.Schema(
  {
    event: { type: mongoose.Schema.Types.ObjectId, ref: "Event", required: true, index: true },
    activity: { type: mongoose.Schema.Types.ObjectId, ref: "Activity", required: true, index: true },
    author: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    text: { type: String, required: true, trim: true, maxlength: 500 },
    // Upvoters — bounded by room size; push/pull keeps idempotency
    votes: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }], default: [] },
    status: {
      type: String,
      enum: ["open", "featured", "answered", "hidden", "closed"],
      default: "open",
      index: true,
    },
    answerText: { type: String, default: "", maxlength: 1000 },
    answeredAt: { type: Date, default: null },
  },
  { timestamps: true }
);

qaQuestionSchema.index({ activity: 1, status: 1, "votes.length": -1 });

module.exports = mongoose.model("QAQuestion", qaQuestionSchema);
