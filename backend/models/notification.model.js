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
        "organization_invite",
        "announcement",
        "mention",
        "event_update",
        "event_reminder",
        "community_invite",
        "message",
        "achievement",
        // ── Part 8 (§42) ────────────────────────────────────────────────
        // "reply" — someone replied to YOUR comment. Distinct from "comment"
        // (someone commented on your post): the notification copy and the
        // target differ, so they must be separate types.
        "reply",
        // "story_reaction" — someone reacted to / replied to your story (§42).
        "story_reaction",
        // "community_activity" — activity in a community you follow (§42).
        "community_activity",
        // ── Organization Registration Requests ───────────────────────
        "organization_request_submitted",
        "organization_request_approved",
        "organization_request_rejected",
        "organization_request_needs_info",
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
