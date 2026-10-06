/**
 * Core achievement definitions (Part 3, Phase 8).
 * Every unlock condition is a REAL, deterministic data check — no manual
 * grants, no random badges, no simulated progress. Conditions live in
 * services/achievement.service.js; this file is the display metadata.
 */
const ACHIEVEMENTS = {
  first_post: {
    title: "First Post",
    description: "Shared your first post on the feed",
    icon: "pen_square",
  },
  event_explorer: {
    title: "Event Explorer",
    description: "Registered for your first event",
    icon: "explore",
  },
  community_member: {
    title: "Community Member",
    description: "Joined your first community",
    icon: "diversity_3",
  },
  crowd_favorite: {
    title: "Crowd Favorite",
    description: "10 people follow you",
    icon: "local_fire_department",
  },
  event_host: {
    title: "Event Host",
    description: "Created your first event",
    icon: "rocket_launch",
  },
  memory_maker: {
    title: "Memory Maker",
    description: "Posted in an event channel",
    icon: "photo_camera",
  },
  conversation_starter: {
    title: "Conversation Starter",
    description: "Wrote 10 comments",
    icon: "forum",
  },
  prolific_poster: {
    title: "Prolific Poster",
    description: "Published 10 posts",
    icon: "library_add",
  },
  // ── Live events (Part 4, Phase 9) — awarded by the completion hook
  // (services/completion.service.js) from the immutable EventResult
  // snapshot. Same discipline: real data, deterministic, idempotent.
  first_live_event: {
    title: "First Live Event",
    description: "Completed your first live event",
    icon: "celebration",
  },
  live_participant: {
    title: "In The Arena",
    description: "Answered a question in a live event",
    icon: "bolt",
  },
  top_10: {
    title: "Top 10 Finisher",
    description: "Finished in the top 10 of a live event",
    icon: "military_tech",
  },
  top_3: {
    title: "Podium Finish",
    description: "Made the podium (top 3) of a live event",
    icon: "workspace_premium",
  },
  quiz_winner: {
    title: "Quiz Winner",
    description: "Won a live event with a score on the board",
    icon: "emoji_events",
  },
};

const ACHIEVEMENT_CODES = Object.keys(ACHIEVEMENTS);

module.exports = { ACHIEVEMENTS, ACHIEVEMENT_CODES };
