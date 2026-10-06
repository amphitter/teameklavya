const mongoose = require("mongoose");

/**
 * In-app notification. Created by real platform events only
 * (follows, likes, comments, registrations, community follows, announcements).
 */
const notificationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }, // recipient
    actor: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, // who did it (null = EventHub system)
    type: {
      type: String,
      enum: [
        "follow",
        "follow_request",
        "follow_accepted",
        "like",
        "comment",
        "event_registration",
        "org_follow",
        "announcement",
        "mention",
        "event_update",
        "event_reminder",
        "community_invite",
        "message",
        "achievement",
      ],
      required: true,
    },
    post: { type: mongoose.Schema.Types.ObjectId, ref: "Post" },
    event: { type: mongoose.Schema.Types.ObjectId, ref: "Event" },
    organization: { type: mongoose.Schema.Types.ObjectId, ref: "Organization" },
    community: { type: mongoose.Schema.Types.ObjectId, ref: "Community" },
    conversation: { type: mongoose.Schema.Types.ObjectId, ref: "Conversation" },
    read: { type: Boolean, default: false },
  },
  { timestamps: true }
);

notificationSchema.index({ user: 1, createdAt: -1 });
notificationSchema.index({ user: 1, read: 1 });

module.exports = mongoose.model("Notification", notificationSchema);
