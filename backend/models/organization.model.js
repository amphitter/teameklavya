const mongoose = require("mongoose");

/**
 * EventHub Organization — first-class entity (colleges, clubs, communities).
 * Events can belong to an organization; organizations can post to the feed.
 */
const organizationSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Organization name is required"],
      trim: true,
      maxlength: [80, "Name is too long"],
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
      maxlength: [1000, "Description is too long"],
      default: "",
    },
    logoUrl: { type: String, default: "" },
    coverUrl: { type: String, default: "" },
    website: { type: String, default: "" },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    /* ── Ownership Verification system ─────────────────────── */
    isVerified: { type: Boolean, default: false },
    verifiedAt: { type: Date, default: null },
    // Managers assigned by the Super Admin (creator is always a manager)
    managers: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }], default: [] },
  },
  { timestamps: true }
);

organizationSchema.index({ name: 1 });

module.exports = mongoose.model("Organization", organizationSchema);
