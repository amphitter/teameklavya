const Post = require("../models/post.model");
const Comment = require("../models/comment.model");
const Follow = require("../models/follow.model");
const Event = require("../models/event.model");
const RegistrationResponse = require("../models/registrationResponse.model");
const CommunityMember = require("../models/communityMember.model");
const UserAchievement = require("../models/userAchievement.model");
const { notify } = require("./notification.service");

/**
 * Achievement engine (Part 3, Phase 8).
 *
 * `checkAchievements(userId)` recomputes every unlock condition from real
 * data and unlocks anything newly satisfied. Deterministic: same database
 * state → same unlocks, always. Fire-and-forget — never blocks an action,
 * never throws. An "achievement" notification is sent per new unlock
 * (recipient preference rules still apply via the notification service).
 */
async function unlockedCodes(userId) {
  const docs = await UserAchievement.find({ user: userId }).select("code").lean();
  return new Set(docs.map((d) => d.code));
}

async function conditions(userId) {
  const [
    postCount,
    commentCount,
    followerCount,
    hasEvent,
    hasRegistration,
    hasCommunity,
    hasChannelPost,
  ] = await Promise.all([
    Post.countDocuments({ author: userId, status: "published" }),
    Comment.countDocuments({ author: userId }), // Comment model uses `author`
    Follow.countDocuments({ followee: userId, status: "accepted" }),
    Event.exists({ createdBy: userId }),
    RegistrationResponse.exists({ userId }),
    CommunityMember.exists({ user: userId, status: "active" }),
    // Posted in an event channel: event-attached, participants-only or memory
    Post.exists({
      author: userId,
      event: { $ne: null },
      $or: [{ visibility: "event_participants" }, { type: "event_memory" }],
    }),
  ]);

  return {
    first_post: postCount >= 1,
    prolific_poster: postCount >= 10,
    conversation_starter: commentCount >= 10,
    crowd_favorite: followerCount >= 10,
    event_host: Boolean(hasEvent),
    event_explorer: Boolean(hasRegistration),
    community_member: Boolean(hasCommunity),
    memory_maker: Boolean(hasChannelPost),
  };
}

async function checkAchievements(userId) {
  try {
    if (!userId) return;
    const [have, state] = await Promise.all([unlockedCodes(userId), conditions(userId)]);

    const newlyUnlocked = Object.entries(state)
      .filter(([code, ok]) => ok && !have.has(code))
      .map(([code]) => code);

    for (const code of newlyUnlocked) {
      await UserAchievement.create({ user: userId, code });
      // System notification (actor: null → rendered as "EventHub")
      notify({ user: userId, actor: undefined, type: "achievement" });
    }
    return newlyUnlocked;
  } catch (err) {
    console.error("Achievement check failed:", err.message);
    return [];
  }
}

/** Public profile payload: definitions + real unlock state (no fake dates). */
async function achievementsFor(userId) {
  const { ACHIEVEMENTS } = require("../config/achievements");
  const docs = await UserAchievement.find({ user: userId }).select("code unlockedAt").lean();
  const unlocked = new Map(docs.map((d) => [d.code, d.unlockedAt]));
  return Object.entries(ACHIEVEMENTS).map(([code, meta]) => ({
    code,
    ...meta,
    unlocked: unlocked.has(code),
    unlockedAt: unlocked.get(code) || null,
  }));
}

module.exports = { checkAchievements, achievementsFor };
