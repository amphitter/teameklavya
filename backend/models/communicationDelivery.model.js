"use strict";

const mongoose = require("mongoose");

const communicationDeliverySchema = new mongoose.Schema(
  {
    communicationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Communication",
      required: true,
    },
    recipientId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    // Snapshot keeps the history useful if the recipient later changes email.
    recipientEmail: { type: String, required: true, trim: true, maxlength: 254 },
    status: { type: String, enum: ["pending", "sent", "failed"], default: "pending", required: true },
    provider: { type: String, maxlength: 40, default: null },
    messageId: { type: String, maxlength: 200, default: null },
    sentAt: { type: Date, default: null },
  },
  { timestamps: true }
);

communicationDeliverySchema.index({ communicationId: 1, createdAt: 1 });
communicationDeliverySchema.index({ communicationId: 1, status: 1 });
communicationDeliverySchema.index({ communicationId: 1, recipientId: 1 }, { unique: true });

module.exports = mongoose.model("CommunicationDelivery", communicationDeliverySchema);
