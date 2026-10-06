/**
 * PostRepository (Part 5, Phase 3 — spec §4, §5, §6, §35–§38)
 * ─────────────────────────────────────────────────────────────
 * SOCIAL DOMAIN. Owns feed assembly: visibility, ranking, and the batched
 * counter attach. Controllers no longer build these queries inline.
 *
 * N+1 / duplicate-query fix (audit §4 "semi-N+1"):
 *   Before, ONE feed request ran the SAME `Follow.find({follower})` query
 *   THREE times — inside `visibilityFilter()`, again for ranking, and a third
 *   time inside `attachCounts()` for the "following" badge. Each was also
 *   unbounded in size.
 *
 *   Now the viewer's social graph is resolved ONCE per user into a
 *   `FeedContext`, cached under the PRIVATE key `followlist:{userId}`
 *   (§10 — identity is in the key, and PRIVATE_PREFIXES forbids SWR).
 *   `visibilityFilter()` and `attachCounts()` are then pure functions of that
 *   context: zero extra database round trips.
 *
 *   Feed cost per page: 1 pool query (+populates) + 2 count aggregations +
 *   2 viewer-state finds. The per-page `countDocuments()` was dropped —
 *   `hasMore` is derived from the over-fetched slice instead (§5).
 */

const Follow = require("../models/follow.model");
const OrgFollow = require("../models/orgFollow.model");
const RegistrationResponse = require("../models/registrationResponse.model");
const EventInterest = require("../models/eventInterest.model");
const CommunityMember = require("../models/communityMember.model");
const Reaction = require("../models/reaction.model");
const Comment = require("../models/comment.model");
const Save = require("../models/save.model");
const { cache, keys, TTL } = require("../services/cache.service");

/** Ranking pool — latest N published posts considered for the for-you feed. */
const FEED_POOL = 400;

/**
 * Ranking weights in HOURS of head-start (Part 3 §30 — deterministic, no ML).
 * A followed author's post outranks a newer public post until the head-start
 * expires, after which pure recency wins. Same input → same feed, always.
 */
const FEED_WEIGHTS = {
  self: 72,
  followedUser: 60,
  followedOrg: 48,
  eventParticipant: 36,
  eventInterested: 24,
  communityMember: 18,
};

/** Anonymous viewer: the smallest possible context. */
const ANON_CONTEXT = Object.freeze({
  following: [],
  orgs: [],
  events: [],
  interests: [],
  communities: [],
  isAnon: true,
});

/**
 * Load the viewer's social graph — ONCE per user per TTL window.
 * Arrays (not Sets) so the value stays serialisable for a future Redis
 * provider without changing any call site (§66).
 */
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
    // Suspended/deleted communities are filtered out by the populate `match`
    communities: memberships.filter((m) => m.community).map((m) => String(m.community._id)),
    isAnon: false,
    loadedAt: Date.now(),
  };
}

/**
 * Cached social-graph lookup. Private key → never shared between users,
 * never served stale-while-revalidate (enforced by the cache service).
 */
async function getFeedContext(userId) {
  if (!userId) return ANON_CONTEXT;
  return cache.getOrSet(keys.followList(userId), () => loadFeedContext(userId), {
    ttl: TTL.FOLLOW_LIST,
  });
}

/** Drop the cached context after a follow/unfollow so the feed reacts. */
function invalidateFeedContext(userId) {
  if (userId) cache.invalidate(keys.followList(userId));
}

/**
 * Mongo predicate for "posts this viewer is allowed to see" (§9 backend
 * enforcement). PURE — derives entirely from the cached context.
 */
function visibilityFilter(ctx, viewerId) {
  if (!viewerId) return { visibility: "public" };
  return {
    $or: [
      { visibility: "public" },
      { visibility: "followers", author: { $in: ctx.following } },
      { visibility: "event_participants", event: { $in: ctx.events } },
      { visibility: "community", community: { $in: ctx.communities } },
      { author: viewerId },
    ],
  };
}

/**
 * Attach like/comment counts and viewer state to a page of posts.
 * Batched: 2 aggregations + 2 batched finds for the whole page — no N+1.
 * The "am I following this author?" badge now comes from the cached context
 * instead of a third `Follow.find` (see file header).
 */
async function attachCounts(posts, ctx, viewerId) {
  if (!posts.length) return [];
  const ids = posts.map((p) => p._id);
  const followingSet = new Set(ctx.following || []);

  const [likeAgg, commentAgg, myReactions, mySaves] = await Promise.all([
    Reaction.aggregate([{ $match: { post: { $in: ids } } }, { $group: { _id: "$post", count: { $sum: 1 } } }]),
    // Moderation-removed comments never count (Part 3, Phase 10)
    Comment.aggregate([
      { $match: { post: { $in: ids }, removedAt: null } },
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

/** Hide non-public events attached to a post (they are not publicly visible). */
function sanitizeEvent(post) {
  if (post.event && post.event.visibility !== "public") post.event = null;
  return post;
}

module.exports = {
  PostRepository: {
    getFeedContext,
    invalidateFeedContext,
    visibilityFilter,
    attachCounts,
    sanitizeEvent,
  },
  FEED_POOL,
  FEED_WEIGHTS,
  ANON_CONTEXT,
};
