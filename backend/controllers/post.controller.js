const Post = require("../models/post.model");
const Comment = require("../models/comment.model");
const { isBlockedBetween } = require("../services/social.service");
const Reaction = require("../models/reaction.model");
const Save = require("../models/save.model");
const { notify } = require("../services/notification.service");
const RegistrationResponse = require("../models/registrationResponse.model");
const EventInterest = require("../models/eventInterest.model");
const { checkAchievements } = require("../services/achievement.service");
const Community = require("../models/community.model");
const CommunityMember = require("../models/communityMember.model");
const { isFollowerOf } = require("../services/social.service");
const Follow = require("../models/follow.model");
const OrgFollow = require("../models/orgFollow.model");
const Event = require("../models/event.model");
const Organization = require("../models/organization.model");
const User = require("../models/user.model");
const { PostRepository } = require("../repositories");
const mongoose = require("mongoose");
const { ERROR_CODES } = require("../utils/app-error");

const AUTHOR_FIELDS = "firstName lastName username verified email profile.avatar profile.institution";
const EVENT_FIELDS = "title slug bannerUrl startDate endDate venue eventType category organizer price visibility isLive";
const ORG_FIELDS = "name slug logoUrl";
const COMMUNITY_FIELDS = "name slug avatarUrl";

/* ── Helpers ─────────────────────────────────────────────── */

/**
 * Feed helpers now DELEGATE to PostRepository (Part 5, Phase 3 — §4, §35).
 *
 * The viewer's social graph (follows, org follows, registrations, interests,
 * community memberships) used to be queried inline here, which meant it was
 * re-queried on every call. A single feed request ran `Follow.find` up to
 * THREE times: once to build the visibility filter, once for ranking, and
 * once inside the counter attach for the "following" badge.
 *
 * `getFeedContext()` resolves that graph ONCE per user and caches it under a
 * PRIVATE, identity-scoped key (never shared, never stale-revalidated).
 * These wrappers keep the original signatures so every call site below is
 * unchanged — but each call is now a cache lookup, not a database query.
 */

/** Attach likeCount / commentCount / likedByMe / savedByMe to a page of posts. */
async function attachCounts(posts, viewerId) {
  const ctx = await PostRepository.getFeedContext(viewerId);
  return PostRepository.attachCounts(posts, ctx, viewerId);
}

/** Hide non-public events from populated posts (unless they were never public). */
function sanitizeEvent(post) {
  return PostRepository.sanitizeEvent(post);
}

/* ── Topics & mentions (Part 3) ──────────────────────────── */

const TOPIC_RE = /#([a-zA-Z0-9_]{2,30})/g;
const MENTION_RE = /@([a-z0-9_]{3,30})/gi;

/** Parse #hashtags from content into normalized topics (max 10). */
function parseTopics(content) {
  const topics = new Set();
  for (const m of String(content || "").matchAll(TOPIC_RE)) {
    topics.add(m[1].toLowerCase());
    if (topics.size >= 10) break;
  }
  return [...topics];
}

/** Parse @username mentions into real users (never the author). */
async function parseMentions(content, excludeUserId) {
  const handles = new Set();
  for (const m of String(content || "").matchAll(MENTION_RE)) {
    handles.add(m[1].toLowerCase());
  }
  if (!handles.size) return [];
  const users = await User.find({ username: { $in: [...handles] } }).select("_id").lean();
  return users.filter((u) => excludeUserId && String(u._id) !== String(excludeUserId));
}

/* ── Visibility (backend-enforced, Part 3 §9/§57) ────────── */

/**
 * Mongo filter matching posts the viewer is allowed to see.
 *   public             → everyone
 *   followers          → accepted followers of the author (+ the author)
 *   event_participants → users registered to the attached event (+ the author)
 *   community          → active members of the attached community (+ author)
 *   (soft-deleted communities are excluded, so their posts vanish)
 */
async function visibilityFilter(viewerId) {
  // Cached social-graph lookup — see the Helpers note above.
  const ctx = await PostRepository.getFeedContext(viewerId);
  return PostRepository.visibilityFilter(ctx, viewerId);
}

/** Point-check: may this viewer see this specific post? */
async function canViewPost(post, viewerId) {
  if (viewerId && String(post.author) === String(viewerId)) return true;
  if (post.status !== "published") return false;
  if (!post.visibility || post.visibility === "public") return true;
  if (!viewerId) return false;
  if (post.visibility === "followers") return isFollowerOf(viewerId, post.author);
  if (post.visibility === "event_participants") {
    return Boolean(post.event && (await RegistrationResponse.exists({ userId: viewerId, eventId: post.event })));
  }
  if (post.visibility === "community") {
    if (!post.community) return false;
    const community = await Community.findById(post.community).select("deletedAt status").lean();
    if (!community || community.deletedAt || community.status === "suspended") return false; // gone → post vanishes
    return Boolean(await CommunityMember.exists({ community: post.community, user: viewerId, status: "active" }));
  }
  return false;
}

/* ── Feed ────────────────────────────────────────────────── */

/*
 * FEED ALGORITHM v2 (Part 3 §30) — deterministic, documented:
 *
 *  "following" tab — pure chronological posts from followed users/orgs.
 *
 *  "for-you" tab — chronological with priority weighting:
 *    1. Candidate pool = latest FEED_POOL published posts the viewer may see.
 *    2. Source weight, expressed as hours of ranking head-start:
 *         own posts .............. 72h
 *         followed users ......... 60h
 *         followed organizations . 48h
 *         registered events ...... 36h   (posts attached to events you
 *                                          registered for)
 *         interested events ....... 24h  (soft-follow via "Interested")
 *         my communities .......... 18h  (posts in communities you're in)
 *         everything else ........  0h
 *    3. sortKey = weight × 3.6e6 + createdAt(ms). A followed author's post
 *       outranks a newer public post until its head-start expires, then pure
 *       recency wins. No ML, no randomization — same input, same feed.
 *    4. Cursor = "<sortKey>|<_id>" of the last returned post. Both parts are
 *       immutable, so pagination is stable across requests.
 *
 *  Known limit: the pool is capped at FEED_POOL (latest posts), so very deep
 *  scrolling past the pool is truncated — fine at this product scale.
 */
const FEED_POOL = 400;
const FEED_WEIGHTS = { self: 72, followedUser: 60, followedOrg: 48, eventParticipant: 36, eventInterested: 24, communityMember: 18 };

// GET /api/posts/feed?page=1&limit=10&tab=for-you|following&cursor=
exports.getFeed = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(20, Math.max(1, parseInt(req.query.limit) || 10));
    const tab = req.query.tab === "following" ? "following" : "for-you";
    const cursor = req.query.cursor ? String(req.query.cursor) : null;
    const viewerId = req.user?.id || null;

    /* ── following: chronological from followed sources ── */
    if (tab === "following") {
      if (!viewerId) {
        return res.json({ success: true, posts: [], page, hasMore: false, nextCursor: null, tab });
      }
      // ONE cached social-graph load replaces two per-request queries.
      const ctx = await PostRepository.getFeedContext(viewerId);
      const authors = ctx.following;
      const orgs = ctx.orgs;
      if (!authors.length && !orgs.length) {
        return res.json({ success: true, posts: [], page, hasMore: false, nextCursor: null, tab });
      }
      const scope = {
        $or: [
          ...(authors.length ? [{ author: { $in: authors } }] : []),
          ...(orgs.length ? [{ organization: { $in: orgs } }] : []),
        ],
      };
      const visible = PostRepository.visibilityFilter(ctx, viewerId);
      const filter = { status: "published", $and: [scope, visible] };

      // Cursor mode (createdAt|_id) with offset fallback for old clients
      if (cursor) {
        const [at, id] = cursor.split("|");
        const d = new Date(at);
        if (!isNaN(d.getTime())) {
          filter.$and.push({
            $or: [{ createdAt: { $lt: d } }, { createdAt: d, _id: { $lt: id } }],
          });
        }
      }

      // Over-fetch by one row and derive `hasMore` from the slice. This
      // replaces the per-page `countDocuments()` — one fewer round trip on
      // the hottest screen in the app (§5).
      const rows = await Post.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip(cursor ? 0 : (page - 1) * limit)
        .limit(limit + 1)
        .populate("author", AUTHOR_FIELDS)
        .populate("event", EVENT_FIELDS)
        .populate("organization", ORG_FIELDS)
        .lean();

      const hasMore = rows.length > limit;
      const posts = hasMore ? rows.slice(0, limit) : rows;
      const enriched = (await attachCounts(posts, viewerId)).map(sanitizeEvent);
      const last = posts[posts.length - 1];
      return res.json({
        success: true,
        posts: enriched,
        page,
        hasMore,
        nextCursor: last ? `${new Date(last.createdAt).toISOString()}|${last._id}` : null,
        tab,
      });
    }

    /* ── for-you: weighted pool + cursor ── */
    // ONE cached social-graph load replaces FIVE per-request queries
    // (follows, org follows, registrations, interests, memberships) — the
    // audit's "semi-N+1": the same data was being fetched 3× per feed page.
    const ctx = await PostRepository.getFeedContext(viewerId);

    const pool = await Post.find({
      status: "published",
      ...PostRepository.visibilityFilter(ctx, viewerId),
    })
      .sort({ createdAt: -1, _id: -1 })
      .limit(FEED_POOL)
      .populate("author", AUTHOR_FIELDS)
      .populate("event", EVENT_FIELDS)
      .populate("organization", ORG_FIELDS)
      .populate("community", COMMUNITY_FIELDS)
      .lean();

    const followedUserSet = new Set(ctx.following);
    const followedOrgSet = new Set(ctx.orgs);
    const registeredEventSet = new Set(ctx.events);
    const interestedEventSet = new Set(ctx.interests);
    const communitySet = new Set(ctx.communities);

    const scored = pool.map((post) => {
      const authorId = String(post.author?._id || post.author);
      const orgId = post.organization ? String(post.organization._id || post.organization) : null;
      const eventId = post.event ? String(post.event._id || post.event) : null;
      const communityId = post.community ? String(post.community._id || post.community) : null;
      let weight = 0;
      if (viewerId && authorId === String(viewerId)) weight = FEED_WEIGHTS.self;
      else if (followedUserSet.has(authorId)) weight = FEED_WEIGHTS.followedUser;
      else if (orgId && followedOrgSet.has(orgId)) weight = FEED_WEIGHTS.followedOrg;
      else if (eventId && registeredEventSet.has(eventId)) weight = FEED_WEIGHTS.eventParticipant;
      else if (eventId && interestedEventSet.has(eventId)) weight = FEED_WEIGHTS.eventInterested;
      else if (communityId && communitySet.has(communityId)) weight = FEED_WEIGHTS.communityMember;
      return { post, key: weight * 3_600_000 + new Date(post.createdAt).getTime() };
    });
    scored.sort((a, b) => b.key - a.key || String(b.post._id).localeCompare(String(a.post._id)));

    // cursor = "<sortKey>|<_id>" — resume strictly below the cursor position
    let offset = (page - 1) * limit;
    if (cursor) {
      const [ck, cid] = cursor.split("|");
      const cursorKey = Number(ck);
      const idx = scored.findIndex((it) => String(it.key) === ck && String(it.post._id) === cid);
      if (idx !== -1) {
        offset = idx + 1; // cursor item still in the pool → start after it
      } else {
        // cursor item fell out of the pool (newer posts pushed in) —
        // resume at the first item ranked strictly below the cursor key
        const below = scored.findIndex((it) => it.key < cursorKey);
        offset = below === -1 ? scored.length : below;
      }
    }
    const slice = scored.slice(offset, offset + limit);

    const enriched = (await attachCounts(slice.map((it) => it.post), viewerId)).map(sanitizeEvent);
    const last = slice[slice.length - 1];

    res.json({
      success: true,
      posts: enriched,
      page,
      hasMore: offset + limit < scored.length,
      nextCursor: last ? `${last.key}|${last.post._id}` : null,
      tab,
    });
  } catch (error) {
    console.error("Get feed error:", error.message);
    res.status(500).json({ success: false, message: "Failed to load feed" });
  }
};

// GET /api/posts/:id
exports.getPostById = async (req, res, next) => {
  try {
    /* §16: a malformed identifier is a CLIENT error, not a server fault.
     * Post.findById("not-an-objectid") throws a CastError, and the generic
     * catch below used to turn that into a 500. That is wrong three ways: it
     * reports a user mistake as an outage (polluting error alerting), it tells
     * the client to retry a request that can never succeed, and it hands an
     * attacker a clean oracle for "which inputs reach Mongo unvalidated".
     * Reject it here, and route anything genuinely unexpected through next()
     * so the central normalizer decides the status (§30). */
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid identifier",
        error: { code: ERROR_CODES.VALIDATION_ERROR, message: "Invalid identifier" },
      });
    }

    const post = await Post.findById(req.params.id)
      .populate("author", AUTHOR_FIELDS)
      .populate("event", EVENT_FIELDS)
      .populate("organization", ORG_FIELDS)
      .lean();
    if (!post) return res.status(404).json({ success: false, message: "Post not found" });
    if (!(await canViewPost(post, req.user?.id || null))) {
      return res.status(404).json({ success: false, message: "Post not found" });
    }

    const [enriched] = await attachCounts([post], req.user?.id || null);
    res.json({ success: true, post: sanitizeEvent(enriched) });
  } catch (error) {
    // Let the taxonomy decide the status: a CastError is 400, a real outage
    // is 503, and neither leaks a stack trace (§61).
    if (typeof next === "function") return next(error);
    res.status(500).json({ success: false, message: "Failed to load post" });
  }
};

/* ── Create ──────────────────────────────────────────────── */

// GET /api/posts/event/:eventId — memories: posts attached to an event
exports.getEventPosts = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
    const filter = {
      event: req.params.eventId,
      status: "published",
      ...(await visibilityFilter(req.user?.id || null)),
    };

    // Over-fetch by one row and derive `hasMore` from the slice, instead of
    // paying for a second `countDocuments()` round trip on every scroll (§5).
    const rows = await Post.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit + 1)
      .populate("author", AUTHOR_FIELDS)
      .populate("event", EVENT_FIELDS)
      .populate("organization", ORG_FIELDS)
      .populate("community", COMMUNITY_FIELDS)
      .lean();

    const hasMore = rows.length > limit;
    const posts = hasMore ? rows.slice(0, limit) : rows;

    const enriched = (await attachCounts(posts, req.user?.id || null)).map(sanitizeEvent);
    res.json({ success: true, posts: enriched, page, hasMore });
  } catch (error) {
    console.error("Get event posts error:", error.message);
    res.status(500).json({ success: false, message: "Failed to load event posts" });
  }
};

// POST /api/posts  { content, images: [url], eventId?, visibility?, type? }
exports.createPost = async (req, res) => {
  try {
    const {
      content = "",
      images = [],
      eventId,
      organizationId: body_organizationId,
      communityId,
      visibility: bodyVisibility,
      type: bodyType,
    } = req.body;

    const trimmed = String(content).trim();
    if (trimmed.length > 2000) {
      return res.status(400).json({ success: false, message: "Post is too long (max 2000 characters)" });
    }
    const imgs = Array.isArray(images) ? images.filter(Boolean).slice(0, 4) : [];

    if (!trimmed && imgs.length === 0) {
      return res.status(400).json({ success: false, message: "Write something or add a photo" });
    }

    // Visibility (backend-enforced; event-memory shares of non-public
    // events are forced into the event channel further below)
    let visibility = ["public", "followers", "event_participants", "community"].includes(bodyVisibility)
      ? bodyVisibility
      : "public";

    let eventRef = null;
    let memoryData = null;
    if (eventId) {
      const event = await Event.findById(eventId);
      if (!event) return res.status(404).json({ success: false, message: "Event not found" });
      if (bodyType === "event_memory") {
        // Structured event-memory share (Phase 9 — §63): rank/score/
        // accuracy/achievements come from the immutable EventResult
        // snapshot — the client's numbers are never trusted.
        const EventResult = require("../models/eventResult.model");
        const { qualifiedCodes } = require("../services/completion.service");
        const result = await EventResult.findOne({ event: event._id }).lean();
        if (!result) {
          return res.status(400).json({ success: false, message: "Share your memory once the event completes" });
        }
        const mine = (result.leaderboard || []).find(
          (e) => String(e.participantId) === String(req.user.id)
        );
        if (!mine) {
          return res.status(403).json({ success: false, message: "Only participants can share an event memory" });
        }
        memoryData = {
          rank: mine.rank,
          score: mine.score || 0,
          accuracy: mine.accuracy ?? null,
          achievements: qualifiedCodes(mine),
        };
        // A private event's memories stay inside its channel
        if (event.visibility !== "public") visibility = "event_participants";
        eventRef = event._id;
      } else if (event.visibility !== "public") {
        return res.status(400).json({
          success: false,
          message: "Only public events can be shared to the feed",
        });
      } else {
        eventRef = event._id;
      }
    }

    // Posting on behalf of an organization (creator or platform admin)
    let orgRef = null;
    if (body_organizationId) {
      const org = await Organization.findById(body_organizationId);
      if (!org) return res.status(404).json({ success: false, message: "Organization not found" });
      const canPost =
        req.user.role === "admin" || String(org.createdBy) === String(req.user.id);
      if (!canPost) {
        return res.status(403).json({ success: false, message: "You can't post for this organization" });
      }
      orgRef = org._id;
    }

    if (visibility === "event_participants" && !eventRef) {
      return res.status(400).json({
        success: false,
        message: "Attach an event to post for its participants",
      });
    }

    // Event channel integrity: participants-only posts require the author to
    // be a registered participant (organizers/admins exempt)
    if (visibility === "event_participants") {
      const isParticipant = await RegistrationResponse.exists({ userId: req.user.id, eventId: eventRef });
      if (!isParticipant && req.user.role !== "admin") {
        const ev = await Event.findById(eventRef).select("createdBy").lean();
        if (!ev || String(ev.createdBy) !== String(req.user.id)) {
          return res.status(403).json({ success: false, message: "Only participants can post in the event channel" });
        }
      }
    }

    // Community posts: author must be an active member of a live community
    let communityRef = null;
    if (communityId) {
      const community = await Community.findById(communityId);
      if (!community || community.deletedAt) {
        return res.status(404).json({ success: false, message: "Community not found" });
      }
      if (community.status === "suspended") {
        return res.status(403).json({ success: false, message: "This community is suspended" });
      }
      const membership = await CommunityMember.findOne({ community: communityId, user: req.user.id });
      if (!membership || membership.status !== "active") {
        return res.status(403).json({ success: false, message: "Join this community to post" });
      }
      communityRef = community._id;
      if (visibility !== "community") {
        // Community posts default to members-only; members may still share wider
        // (public posts also surface on the community page)
      }
    }
    if (visibility === "community" && !communityRef) {
      return res.status(400).json({ success: false, message: "Attach a community for members-only posts" });
    }

    // Post type: explicit special types are validated, otherwise derived
    const allowedTypes = ["achievement", "event_memory", "announcement", "text", "image", "event"];
    const type = allowedTypes.includes(bodyType)
      ? bodyType
      : eventRef
        ? "event"
        : orgRef
          ? "announcement"
          : imgs.length
            ? "image"
            : "text";

    // Topics (#hashtags) + mentions (@usernames) parsed server-side
    const topics = parseTopics(trimmed);
    const mentionedUsers = await parseMentions(trimmed, req.user.id);

    const post = await Post.create({
      author: req.user.id,
      content: trimmed,
      images: imgs,
      event: eventRef,
      organization: orgRef,
      community: communityRef,
      type,
      visibility,
      topics,
      mentions: mentionedUsers.map((u) => u._id),
      ...(memoryData ? { memory: memoryData } : {}),
    });

    // Mention notifications (real users only, author excluded)
    for (const mentioned of mentionedUsers) {
      notify({ user: mentioned._id, actor: req.user.id, type: "mention", post: post._id });
    }

    // Achievements: first_post / prolific_poster / memory_maker (real data)
    checkAchievements(req.user.id);

    const populated = await Post.findById(post._id)
      .populate("author", AUTHOR_FIELDS)
      .populate("event", EVENT_FIELDS)
      .populate("organization", "name slug logoUrl")
      .populate("community", "name slug avatarUrl")
      .lean();

    res.status(201).json({
      success: true,
      post: { ...populated, likeCount: 0, commentCount: 0, likedByMe: false, savedByMe: false },
    });
  } catch (error) {
    console.error("Create post error:", error.message);
    res.status(500).json({ success: false, message: "Failed to create post" });
  }
};

/* ── Likes & saves ───────────────────────────────────────── */

// POST /api/posts/:id/like  (toggle)
exports.toggleLike = async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ success: false, message: "Post not found" });
    if (post.status !== "published" || !(await canViewPost(post, req.user.id))) {
      return res.status(404).json({ success: false, message: "Post not found" });
    }
    if (await isBlockedBetween(req.user.id, post.author)) {
      return res.status(403).json({ success: false, message: "You can't interact with this post" });
    }

    const existing = await Reaction.findOne({ post: post._id, user: req.user.id });
    if (existing) {
      await existing.deleteOne();
    } else {
      await Reaction.create({ post: post._id, user: req.user.id });
      notify({ user: post.author, actor: req.user.id, type: "like", post: post._id });
    }

    const likeCount = await Reaction.countDocuments({ post: post._id });
    res.json({ success: true, liked: !existing, likeCount });
  } catch (error) {
    console.error("Toggle like error:", error.message);
    res.status(500).json({ success: false, message: "Failed to update like" });
  }
};

// POST /api/posts/:id/save  (toggle)
exports.toggleSave = async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ success: false, message: "Post not found" });
    if (post.status !== "published" || !(await canViewPost(post, req.user.id))) {
      return res.status(404).json({ success: false, message: "Post not found" });
    }

    const existing = await Save.findOne({ post: post._id, user: req.user.id });
    if (existing) {
      await existing.deleteOne();
    } else {
      await Save.create({ post: post._id, user: req.user.id });
    }

    res.json({ success: true, saved: !existing });
  } catch (error) {
    console.error("Toggle save error:", error.message);
    res.status(500).json({ success: false, message: "Failed to update saved post" });
  }
};

/* ── Comments ────────────────────────────────────────────── */

// GET /api/posts/:id/comments
exports.getComments = async (req, res) => {
  try {
    const post = await Post.findById(req.params.id).select("author status visibility event");
    if (!post || post.status !== "published" || !(await canViewPost(post, req.user?.id || null))) {
      return res.status(404).json({ success: false, message: "Post not found" });
    }
    const comments = await Comment.find({ post: req.params.id, removedAt: null })
      .sort({ createdAt: 1 })
      .populate("author", AUTHOR_FIELDS)
      .lean();
    res.json({ success: true, comments });
  } catch (error) {
    console.error("Get comments error:", error.message);
    res.status(500).json({ success: false, message: "Failed to load comments" });
  }
};

// POST /api/posts/:id/comments  { content }
exports.addComment = async (req, res) => {
  try {
    const content = String(req.body.content || "").trim();
    if (!content) return res.status(400).json({ success: false, message: "Comment can't be empty" });

    if (content.length > 1000) {
      return res.status(400).json({ success: false, message: "Comment is too long (max 1000 characters)" });
    }
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ success: false, message: "Post not found" });
    if (post.status !== "published" || !(await canViewPost(post, req.user.id))) {
      return res.status(404).json({ success: false, message: "Post not found" });
    }
    if (await isBlockedBetween(req.user.id, post.author)) {
      return res.status(403).json({ success: false, message: "You can't interact with this post" });
    }

    const comment = await Comment.create({ post: post._id, author: req.user.id, content });
    notify({ user: post.author, actor: req.user.id, type: "comment", post: post._id });

    // @mention notifications inside comments (real users, author excluded)
    for (const mentioned of await parseMentions(content, req.user.id)) {
      if (String(mentioned._id) !== String(post.author)) {
        notify({ user: mentioned._id, actor: req.user.id, type: "mention", post: post._id });
      }
    }
    const populated = await Comment.findById(comment._id).populate("author", AUTHOR_FIELDS).lean();

    res.status(201).json({ success: true, comment: populated });
  } catch (error) {
    console.error("Add comment error:", error.message);
    res.status(500).json({ success: false, message: "Failed to add comment" });
  }

    // Achievements: conversation_starter (10 real comments)
    checkAchievements(req.user.id);
};

// DELETE /api/posts/:id/comments/:commentId  (own comments only)
exports.deleteComment = async (req, res) => {
  try {
    const comment = await Comment.findById(req.params.commentId);
    if (!comment) return res.status(404).json({ success: false, message: "Comment not found" });
    if (String(comment.author) !== req.user.id) {
      return res.status(403).json({ success: false, message: "You can only delete your own comments" });
    }
    await comment.deleteOne();
    res.json({ success: true });
  } catch (error) {
    console.error("Delete comment error:", error.message);
    res.status(500).json({ success: false, message: "Failed to delete comment" });
  }
};

/* ── Delete ──────────────────────────────────────────────── */

// DELETE /api/posts/:id  (own posts or admins)
exports.deletePost = async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ success: false, message: "Post not found" });

    const isOwner = String(post.author) === req.user.id;
    const isAdmin = req.user.role === "admin";
    if (!isOwner && !isAdmin) {
      return res.status(403).json({ success: false, message: "You can only delete your own posts" });
    }

    // Soft delete: the record stays for moderation/audit (Part 3 §56) but the
    // post disappears from every feed/list/query (status filter above).
    post.status = "deleted";
    post.deletedAt = new Date();
    await post.save();
    res.json({ success: true });
  } catch (error) {
    console.error("Delete post error:", error.message);
    res.status(500).json({ success: false, message: "Failed to delete post" });
  }
};

/* ── Topics (#hashtags, Part 3 §35) ──────────────────────── */

// GET /api/posts/topics/:topic?page= — public posts tagged with a topic
exports.getTopicPosts = async (req, res) => {
  try {
    const topic = String(req.params.topic || "").toLowerCase().replace(/[^a-z0-9_]/g, "");
    if (!topic) return res.status(400).json({ success: false, message: "Invalid topic" });

    const viewerId = req.user?.id || null;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(20, Math.max(1, parseInt(req.query.limit) || 10));

    // Topic pages surface PUBLIC posts (plus the viewer's own on that topic)
    const filter = {
      topics: topic,
      status: "published",
      $or: viewerId
        ? [{ visibility: "public" }, { author: viewerId }]
        : [{ visibility: "public" }],
    };

    // Over-fetch by one row and derive `hasMore` from the slice, instead of
    // paying for a second `countDocuments()` round trip on every scroll (§5).
    const rows = await Post.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit + 1)
      .populate("author", AUTHOR_FIELDS)
      .populate("event", EVENT_FIELDS)
      .populate("organization", ORG_FIELDS)
      .populate("community", COMMUNITY_FIELDS)
      .lean();

    const hasMore = rows.length > limit;
    const posts = hasMore ? rows.slice(0, limit) : rows;

    const enriched = (await attachCounts(posts, viewerId)).map(sanitizeEvent);
    res.json({ success: true, topic, posts: enriched, page, hasMore });
  } catch (error) {
    console.error("Topic posts error:", error.message);
    res.status(500).json({ success: false, message: "Failed to load topic posts" });
  }
};

// GET /api/posts/topics?limit=8 — trending #topics (deterministic: recent
// public post volume; no ML)
exports.getTrendingTopics = async (req, res) => {
  try {
    const limit = Math.min(12, Math.max(1, parseInt(req.query.limit) || 8));
    const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    const agg = await Post.aggregate([
      { $match: { status: "published", visibility: "public", createdAt: { $gte: since }, topics: { $ne: [] } } },
      { $unwind: "$topics" },
      { $group: { _id: "$topics", posts: { $sum: 1 }, lastAt: { $max: "$createdAt" } } },
      { $sort: { posts: -1, lastAt: -1 } },
      { $limit: limit },
    ]);
    res.json({
      success: true,
      topics: agg.map((t) => ({ topic: t._id, posts: t.posts })),
    });
  } catch (error) {
    console.error("Trending topics error:", error.message);
    res.status(500).json({ success: false, message: "Failed to load topics" });
  }
};

/* ── Saved posts (Part 3 §19) ────────────────────────────── */

// GET /api/posts/saved — my private saved list (published + visible only)
exports.getSavedPosts = async (req, res) => {
  try {
    const saves = await Save.find({ user: req.user.id })
      .sort({ createdAt: -1 })
      .limit(100)
      .populate({
        path: "post",
        populate: [
          { path: "author", select: AUTHOR_FIELDS },
          { path: "event", select: EVENT_FIELDS },
          { path: "organization", select: ORG_FIELDS },
          { path: "community", select: "name slug avatarUrl" },
        ],
      })
      .lean();

    // Drop saves whose post vanished (deleted/hidden) or is no longer visible
    const kept = [];
    for (const s of saves) {
      if (!s.post || s.post.status !== "published") continue;
      if (!(await canViewPost(s.post, req.user.id))) continue;
      kept.push({ ...s.post, savedAt: s.createdAt });
    }

    const enriched = (await attachCounts(kept, req.user.id)).map(sanitizeEvent);
    res.json({ success: true, posts: enriched });
  } catch (error) {
    console.error("Saved posts error:", error.message);
    res.status(500).json({ success: false, message: "Failed to load saved posts" });
  }
};

/* Shared helpers (Phase 6 communities reuse these) */
exports._enrichPosts = attachCounts;
exports._sanitizeEvent = sanitizeEvent;
