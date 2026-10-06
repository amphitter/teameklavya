const mongoose = require("mongoose");

/**
 * Poll Response (Part 4, Phase 1) — one vote per participant per poll
 * activity. Individual votes are never exposed unless the activity config
 * explicitly allows it (spec §39).
 */
const pollResponseSchema = new mongoose.Schema(
  {
    activity: { type: mongoose.Schema.Types.ObjectId, ref: "Activity", required: true, index: true },
    event: { type: mongoose.Schema.Types.ObjectId, ref: "Event", required: true, index: true },
    session: { type: mongoose.Schema.Types.ObjectId, ref: "ParticipantSession", required: true },
    choice: { type: Number, required: true, min: 0 },
  },
  { timestamps: true }
);

pollResponseSchema.index({ activity: 1, session: 1 }, { unique: true });

module.exports = mongoose.model("PollResponse", pollResponseSchema);
