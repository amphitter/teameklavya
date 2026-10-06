const mongoose = require("mongoose");

/** 1:1 direct-message conversation between exactly two users. */
const conversationSchema = new mongoose.Schema(
  {
    participants: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
      validate: { validator: (v) => v.length === 2, message: "A conversation needs exactly 2 participants" },
      required: true,
    },
    lastMessage: {
      text: { type: String, maxlength: 1000 },
      sender: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      at: { type: Date },
    },
  },
  { timestamps: true }
);

// Always store participants sorted so the pair is unique
conversationSchema.pre("save", function (next) {
  if (this.isModified("participants")) {
    this.participants = this.participants.sort();
  }
  next();
});

// Messaging v2: per-participant mute (no notifications) and hide
// (list-hidden until a new message arrives, which un-hides for both)
conversationSchema.add({
  mutedBy: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }], default: [] },
  hiddenBy: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }], default: [] },
});

conversationSchema.index({ participants: 1 }, { unique: true });
conversationSchema.index({ updatedAt: -1 });

module.exports = mongoose.model("Conversation", conversationSchema);
