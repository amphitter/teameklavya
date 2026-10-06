const mongoose = require("mongoose");

/**
 * Moderation report (Part 3, Phase 10).
 * One report per user per target (unique index). A content snapshot is
 * captured at report time so the queue shows what was reported even if
 * the content is later edited or removed.
 */
const reportSchema = new mongoose.Schema(
  {
    reporter: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    targetType: { type: String, enum: ["post", "comment", "event", "user"], required: true },
    targetId: { type: mongoose.Schema.Types.ObjectId, required: true },
    // Denormalized owner of the reported content (post author, comment
    // author, event organizer, or the reported user themself)
    targetUser: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    snapshot: { type: String, default: "" },
    reason: {
      type: String,
      enum: ["spam", "harassment", "inappropriate", "misinformation", "other"],
      required: true,
    },
    details: { type: String, maxlength: 500, trim: true, default: "" },
    status: { type: String, enum: ["open", "dismissed", "actioned"], default: "open", index: true },
    resolution: { type: String, default: "" },
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    resolvedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

reportSchema.index({ targetType: 1, targetId: 1, reporter: 1 }, { unique: true });
reportSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model("Report", reportSchema);
