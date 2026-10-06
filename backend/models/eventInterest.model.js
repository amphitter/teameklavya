const mongoose = require("mongoose");

/**
 * Event interest (Part 3, Phase 5) — a lightweight "Interested" signal,
 * distinct from registration. Acts as a soft-follow: interested users get
 * event update notifications but no ticket. One per user per event.
 */
const eventInterestSchema = new mongoose.Schema(
  {
    event: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Event",
      required: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true }
);

eventInterestSchema.index({ event: 1, user: 1 }, { unique: true });
eventInterestSchema.index({ user: 1, createdAt: -1 });
eventInterestSchema.index({ event: 1, createdAt: -1 });

module.exports = mongoose.model("EventInterest", eventInterestSchema);
