const mongoose = require("mongoose");

/**
 * Certificate (Part 4, Phase 9 — spec §62) — generation REQUEST foundation.
 * Created by the completion hook from the immutable EventResult snapshot
 * (never client claims). `status` stays "pending" until a certificate
 * designer/renderer exists — then a generation flow flips it to
 * "generated" and stamps issuedAt. One certificate per user per event.
 */
const certificateSchema = new mongoose.Schema(
  {
    event: { type: mongoose.Schema.Types.ObjectId, ref: "Event", required: true, index: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    kind: { type: String, enum: ["participation", "winner"], default: "participation" },
    status: { type: String, enum: ["pending", "generated"], default: "pending" },
    // Frozen from the EventResult snapshot at request time
    rank: { type: Number, default: null },
    score: { type: Number, default: 0 },
    eventTitle: { type: String, default: "" },
    requestedAt: { type: Date, default: Date.now },
    issuedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

certificateSchema.index({ event: 1, user: 1 }, { unique: true });

module.exports = mongoose.model("Certificate", certificateSchema);
