"use strict";

const mongoose = require("mongoose");

const communicationSchema = new mongoose.Schema(
  {
    sender: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    scope: { type: String, enum: ["PLATFORM", "EVENT"], required: true },
    eventId: { type: mongoose.Schema.Types.ObjectId, ref: "Event", default: null },
    kind: {
      type: String,
      enum: [
        "PLATFORM_CUSTOM",
        "EVENT_CUSTOM",
        "EVENT_INVITATION",
        "RSVP_VERIFICATION",
        "EVENT_ANNOUNCEMENT",
        "EVENT_TICKET",
      ],
      required: true,
    },
    subject: { type: String, required: true, trim: true, maxlength: 180 },
    status: {
      type: String,
      enum: ["pending", "sending", "sent", "partial", "failed"],
      default: "pending",
      required: true,
    },
    recipientCount: { type: Number, default: 0, min: 0 },
    sentCount: { type: Number, default: 0, min: 0 },
    failedCount: { type: Number, default: 0, min: 0 },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

communicationSchema.index({ scope: 1, eventId: 1, createdAt: -1 });
communicationSchema.index({ status: 1, createdAt: -1 });
module.exports = mongoose.model("Communication", communicationSchema);
