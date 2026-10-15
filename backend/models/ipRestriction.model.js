"use strict";

/**
 * IpRestriction — temporary, reviewable IP/network restrictions
 */

const mongoose = require("mongoose");

const ipRestrictionSchema = new mongoose.Schema(
  {
    ip: { type: String, required: true, index: true }, // can be CIDR or single IP
    reason: { type: String, required: true },
    source: { type: String, enum: ["auto", "manual"], default: "auto" },
    category: { type: String, default: "abuse" },
    // Expiry
    expiresAt: { type: Date, required: true, index: true },
    active: { type: Boolean, default: true, index: true },
    // Actor
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    // Review
    reviewed: { type: Boolean, default: false },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    reviewedAt: { type: Date, default: null },
    // Metadata: request counts, signals
    metadata: { type: Object, default: {} },
    // Related user if any
    relatedUser: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

ipRestrictionSchema.index({ ip: 1, active: 1 });
ipRestrictionSchema.index({ expiresAt: 1, active: 1 });

module.exports = {
  IpRestriction: mongoose.model("IpRestriction", ipRestrictionSchema),
};
