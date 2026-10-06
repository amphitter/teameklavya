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
  },
  { timestamps: true }
);

messageSchema.index({ conversation: 1, createdAt: -1 });

module.exports = mongoose.model("Message", messageSchema);
