const mongoose = require("mongoose");

/**
 * Unlocked achievement (Part 3, Phase 8). One per user per achievement code.
 * Unlocks are computed from REAL data by the achievement service — never
 * granted manually, never simulated.
 */
const userAchievementSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    // See config/achievements.js for the authoritative definitions
    code: { type: String, required: true },
    // Provenance (Phase 9): live-event unlocks record the event they came
    // from. {user, code} stays unique — a code unlocks once, ever.
    context: { event: { type: mongoose.Schema.Types.ObjectId, ref: "Event", default: null } },
    unlockedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

userAchievementSchema.index({ user: 1, code: 1 }, { unique: true });

module.exports = mongoose.model("UserAchievement", userAchievementSchema);
