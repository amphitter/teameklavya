const mongoose = require("mongoose");

/** A single message inside a conversation. */
const messageSchema = new mongoose.Schema(
  {
    conversation: { type: mongoose.Schema.Types.ObjectId, ref: "Conversation", required: true },
    sender: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    content: { type: String, maxlength: 2000, trim: true, default: "" },
    // Optional image attachment (uploaded via /upload/image?folder=messages)
    image: { type: String, default: "" },
    // Soft-delete (unsend): content wiped for everyone, record kept for audit
    deletedAt: { type: Date, default: null },
    readAt: { type: Date, default: null },

    // ── Reactions (Part 8 §31) ──────────────────────────────────────────
    // Stored per-user-per-emoji rather than as a Set, so the UI can show
    // "❤️ 2 🔥 1" with counts and highlight the viewer's own pick.
    reactions: [
      {
        user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        emoji: { type: String, required: true, maxlength: 16 },
        at: { type: Date, default: Date.now },
      },
    ],

    // ── Reply target (Part 8 §30) ───────────────────────────────────────
    replyTo: { type: mongoose.Schema.Types.ObjectId, ref: "Message", default: null },

    /** Optional attachment metadata — files beyond the image field. */
    attachment: {
      url: { type: String, default: "" },
      name: { type: String, default: "" },
      size: { type: Number, default: 0 },
      mime: { type: String, default: "" },
    },
  },
  { timestamps: true }
);

messageSchema.index({ conversation: 1, createdAt: -1 });

module.exports = mongoose.model("Message", messageSchema);
