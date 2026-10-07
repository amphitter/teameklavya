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
  /* Archive (Part 8 §32-33), per participant — archiving is a personal view
     change, so it must never affect the other participant's inbox.
     Distinct from `hiddenBy`: hiding auto-reverses on the next message,
     archiving does not. See the behaviour note in the message controller. */
  archivedBy: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }], default: [] },
  /** When each participant last opened the thread — drives unread counts
   *  without scanning messages (§34). */
  lastReadAt: { type: Map, of: Date, default: {} },
});

conversationSchema.index({ participants: 1 }, { unique: true });
conversationSchema.index({ updatedAt: -1 });

module.exports = mongoose.model("Conversation", conversationSchema);
