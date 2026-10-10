/**
 * PostRepository (Part 5, Phase 3 — spec §4, §5, §6, §35–§38 + Trust & Safety)
 * SOCIAL DOMAIN. Owns feed assembly: visibility, ranking, and the batched
 * counter attach. Controllers no longer build these queries inline.
 */

const Follow = require("../models/follow.model");
const OrgFollow = require("../models/orgFollow.model");
const RegistrationResponse = require("../models/registrationResponse.model");
const EventInterest = require("../models/eventInterest.model");
const CommunityMember = require("../models/communityMember.model");
const Reaction = require("../models/reaction.model");
const Comment = require("../models/comment.model");
const Save = require("../models/save.model");
const Post = require("../models/post.model");

const AUTHOR_FIELDS = "firstName lastName username verified email profile.avatar profile.institution";
const EVENT_FIELDS = "title slug bannerUrl logoUrl startDate endDate venue eventType category organizer price visibility isLive";
const ORG_FIELDS = "name slug logoUrl";
const { cache, keys, TTL } = require("../services/cache.service");

const FEED_POOL = 400;

const FEED_WEIGHTS = {
  self: 72,
  followedUser: 60,
  followedOrg: 48,
  eventParticipant: 36,
  eventInterested: 24,
  communityMember: 18,
};

const ANON_CONTEXT = Object.freeze({
  following: [],
  orgs: [],
  events: [],
  interests: [],
  communities: [],
  isAnon: true,
});

async function loadFeedContext(userId) {
  const [following, followedOrgs, registrations, interests, memberships] = await Promise.all([
    Follow.find({ follower: userId, status: "accepted" }).select("followee").lean(),
    OrgFollow.find({ user: userId }).select("organization").lean(),
    RegistrationResponse.find({ userId }).select("eventId").lean(),
    EventInterest.find({ user: userId }).select("event").lean(),
    CommunityMember.find({ user: userId, status: "active" })
      .select("community")
      .populate({
        path: "community",
        select: "_id",
        match: { deletedAt: null, status: { $ne: "suspended" } },
      })
      .lean(),
  ]);

  return {
    following: following.map((f) => String(f.followee)),
    orgs: followedOrgs.map((f) => String(f.organization)),
    events: registrations.map((r) => String(r.eventId)),
    interests: interests.map((i) => String(i.event)),
    communities: memberships.filter((m) => m.community).map((m) => String(m.community._id)),
    isAnon: false,
    loadedAt: Date.now(),
  };
}

async function getFeedContext(userId) {
  if (!userId) return ANON_CONTEXT;
  return cache.getOrSet(keys.followList(userId), () => loadFeedContext(userId), {
    ttl: TTL.FOLLOW_LIST,
  });
}

async function invalidateFeedContext(userId) {
  if (userId) {
    try {
      await cache.invalidate(keys.followList(userId));
    } catch (err) {
      console.warn("[cache] invalidation failed:", err?.message || err);
    }
  }
}

function visibilityFilter(ctx, viewerId) {
  const moderationFilter = {
    $or: [
      { moderationStatus: "approved" },
      { moderationStatus: { $exists: false } },
      { author: viewerId },
    ],
  };

  if (!viewerId) {
    return {
      $and: [{ visibility: "public" }, moderationFilter],
    };
  }
  return {
    $and: [
      {
        $or: [
          { visibility: "public" },
          { visibility: "followers", author: { $in: ctx.following } },
          { visibility: "event_participants", event: { $in: ctx.events } },
          { visibility: "community", community: { $in: ctx.communities } },
          { author: viewerId },
        ],
      },
      moderationFilter,
    ],
  };
}

async function attachCounts(posts, ctx, viewerId) {
  if (!posts.length) return [];
  const ids = posts.map((p) => p._id);
  const followingSet = new Set(ctx.following || []);

  const [likeAgg, commentAgg, myReactions, mySaves] = await Promise.all([
    Reaction.aggregate([{ $match: { post: { $in: ids } } }, { $group: { _id: "$post", count: { $sum: 1 } } }]),
    Comment.aggregate([
      { $match: { post: { $in: ids }, removedAt: null, moderationStatus: { $nin: ["removed", "quarantined"] } } },
      { $group: { _id: "$post", count: { $sum: 1 } } },
    ]),
    viewerId ? Reaction.find({ post: { $in: ids }, user: viewerId }).select("post").lean() : Promise.resolve([]),
    viewerId ? Save.find({ post: { $in: ids }, user: viewerId }).select("post").lean() : Promise.resolve([]),
  ]);

  const likeMap = new Map(likeAgg.map((r) => [String(r._id), r.count]));
  const commentMap = new Map(commentAgg.map((r) => [String(r._id), r.count]));
  const likedSet = new Set(myReactions.map((r) => String(r.post)));
  const savedSet = new Set(mySaves.map((r) => String(r.post)));

  return posts.map((p) => ({
    ...p,
    likeCount: likeMap.get(String(p._id)) || 0,
    commentCount: commentMap.get(String(p._id)) || 0,
    likedByMe: likedSet.has(String(p._id)),
    savedByMe: savedSet.has(String(p._id)),
    authorFollowing: p.author ? followingSet.has(String(p.author._id || p.author)) : false,
  }));
}

function sanitizeEvent(post) {
  if (post.event && post.event.visibility !== "public") post.event = null;
  return post;
}

async function hydratePostsForViewer(ids, viewerId) {
  const wanted = (ids || []).filter(Boolean);
  if (!wanted.length) return [];
  const ctx = await getFeedContext(viewerId);
  const rows = await Post.find({
    _id: { $in: wanted },
    status: "published",
    $and: [visibilityFilter(ctx, viewerId)],
  })
    .populate("author", AUTHOR_FIELDS)
    .populate("event", EVENT_FIELDS)
    .populate("organization", ORG_FIELDS)
    .lean();

  const order = new Map(wanted.map((id, i) => [String(id), i]));
  rows.sort((a, b) => (order.get(String(a._id)) ?? 0) - (order.get(String(b._id)) ?? 0));
  return attachCounts(rows, ctx, viewerId);
}

module.exports = {
  PostRepository: {
    getFeedContext,
    invalidateFeedContext,
    visibilityFilter,
    attachCounts,
    hydratePostsForViewer,
    sanitizeEvent,
  },
  FEED_POOL,
  FEED_WEIGHTS,
  ANON_CONTEXT,
};
