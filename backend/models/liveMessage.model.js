const mongoose = require("mongoose");

/**
 * Live Message (Part 4, Phase 1) — live event chat. Moderator deletion is a
 * soft-delete (deletedAt) so moderation stays auditable (spec §41).
 */
const liveMessageSchema = new mongoose.Schema(
  {
    event: { type: mongoose.Schema.Types.ObjectId, ref: "Event", required: true, index: true },
    activity: { type: mongoose.Schema.Types.ObjectId, ref: "Activity", default: null },
    sender: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    text: { type: String, required: true, trim: true, maxlength: 500 },
    pinned: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
    deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

liveMessageSchema.index({ event: 1, createdAt: -1 });

module.exports = mongoose.model("LiveMessage", liveMessageSchema);
