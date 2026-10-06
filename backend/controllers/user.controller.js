const mongoose = require("mongoose");
const User = require("../models/user.model");
const Post = require("../models/post.model");
const Comment = require("../models/comment.model");
const Reaction = require("../models/reaction.model");
const Save = require("../models/save.model");
const Follow = require("../models/follow.model");
const Block = require("../models/block.model");
const RegistrationResponse = require("../models/registrationResponse.model");
const Event = require("../models/event.model");
const Ticket = require("../models/ticket.model");

const AUTHOR_FIELDS = "firstName lastName username verified email profile.avatar profile.institution";
const POST_FIELDS = "author content images event organization createdAt";

/** Usernames that can never be claimed (route/namespace collisions). */
const RESERVED_USERNAMES = new Set([
  "admin", "administrator", "api", "auth", "login", "logout", "signup", "register",
  "events", "event", "explore", "feed", "home", "messages", "message", "notifications",
  "organizations", "organization", "orgs", "profile", "user", "users", "post", "posts",
  "saved", "community", "communities", "quiz", "quizzes", "support", "help", "root",
  "system", "moderator", "moderators", "official", "eventhub", "teameklavya",
]);

const USERNAME_RE = /^[a-z0-9_]{3,30}$/;

/** Attach likeCount/commentCount viewer flags to posts (shared shape with feed). */
async function enrichPosts(posts, viewerId) {
  if (!posts.length) return [];
  const ids = posts.map((p) => p._id);
  const [likeAgg, commentAgg, myReactions, mySaves] = await Promise.all([
    Reaction.aggregate([
      { $match: { post: { $in: ids } } },
      { $group: { _id: "$post", count: { $sum: 1 } } },
    ]),
    Comment.aggregate([
      { $match: { post: { $in: ids } } },
      { $group: { _id: "$post", count: { $sum: 1 } } },
    ]),
    viewerId ? Reaction.find({ post: { $in: ids }, user: viewerId }).select("post").lean() : [],
    viewerId ? Save.find({ post: { $in: ids }, user: viewerId }).select("post").lean() : [],
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
  }));
}

/**
 * Resolve a profile route param that may be an ObjectId OR a @username.
 * Legacy /profile/<id> links keep working; new links use /profile/<username>.
 */
async function resolveUser(idOrUsername) {
  const raw = String(idOrUsername || "").toLowerCase();
  if (mongoose.isValidObjectId(raw)) {
    const byId = await User.findById(raw).lean();
    if (byId) return byId;
  }
  return User.findOne({ username: raw }).lean();
}

/** Can the viewer see this user's posts/events/media? Backend-enforced. */
function canViewContent(userDoc, viewerId, viewerFollows) {
  const visibility = userDoc.socialSettings?.profileVisibility || "public";
  if (visibility === "public") return true;
  const isSelf = viewerId && String(userDoc._id) === String(viewerId);
  if (isSelf) return true;
  return Boolean(viewerFollows); // "followers" and "private" both gate on following
}

/* ── My social profile (settings + editable fields) ──────── */

// GET /api/users/me/social
exports.getMySocial = async (req, res) => {
  try {
    const user = await User.findById(req.user.id)
      .select("firstName lastName username verified points profile socialSettings createdAt")
      .lean();
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    res.json({ success: true, user });
  } catch (error) {
    console.error("Get my social error:", error.message);
    res.status(500).json({ success: false, message: "Failed to load profile" });
  }
};

// PUT /api/users/me/social  — update username/bio/avatar/cover/location/interests/privacy
exports.updateMySocial = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    const { username, bio, avatar, coverImage, location, interests, socialSettings } = req.body;

    // Username (unique, normalized, reserved-list protected)
    if (username !== undefined) {
      const normalized = String(username || "").toLowerCase().trim();
      if (!USERNAME_RE.test(normalized)) {
        return res.status(400).json({
          success: false,
          message: "Username must be 3-30 characters: lowercase letters, numbers, underscore",
        });
      }
      if (RESERVED_USERNAMES.has(normalized)) {
        return res.status(400).json({ success: false, message: "That username is reserved" });
      }
      if (normalized !== user.username) {
        const clash = await User.findOne({ username: normalized, _id: { $ne: user._id } }).select("_id").lean();
        if (clash) return res.status(409).json({ success: false, message: "That username is already taken" });
      }
      user.username = normalized;
    }

    if (bio !== undefined) user.profile.bio = String(bio || "").trim().slice(0, 280);
    if (avatar !== undefined) user.profile.avatar = String(avatar || "").trim();
    if (coverImage !== undefined) user.profile.coverImage = String(coverImage || "").trim();
    if (location !== undefined) user.profile.location = String(location || "").trim().slice(0, 80);

    if (interests !== undefined) {
      const list = Array.isArray(interests) ? interests : [];
      const cleaned = [...new Set(list.map((t) => String(t || "").toLowerCase().trim().slice(0, 30)).filter(Boolean))];
      if (cleaned.length > 10) {
        return res.status(400).json({ success: false, message: "You can list at most 10 interests" });
      }
      user.profile.interests = cleaned;
    }

    if (socialSettings && typeof socialSettings === "object") {
      const s = socialSettings;
      if (s.profileVisibility && ["public", "followers", "private"].includes(s.profileVisibility)) {
        user.socialSettings.profileVisibility = s.profileVisibility;
      }
      if (s.allowMessagesFrom && ["everyone", "followers", "nobody"].includes(s.allowMessagesFrom)) {
        user.socialSettings.allowMessagesFrom = s.allowMessagesFrom;
      }
      if (typeof s.showAttendance === "boolean") user.socialSettings.showAttendance = s.showAttendance;
      if (typeof s.showAchievements === "boolean") user.socialSettings.showAchievements = s.showAchievements;
    }

    await user.save();

    res.json({
      success: true,
      user: {
        username: user.username,
        profile: user.profile,
        socialSettings: user.socialSettings,
      },
    });
  } catch (error) {
    console.error("Update social error:", error.message);
    if (error.code === 11000) {
      return res.status(409).json({ success: false, message: "That username is already taken" });
    }
    res.status(500).json({ success: false, message: "Failed to update profile" });
  }
};

/*
 * SUGGESTED PEOPLE (Part 3 §61) — deterministic, no ML:
 *   +5  mutual follows
 *   +3  registered for the same events as me
 *   +2  same institution on profile
 * Excluded: myself, anyone I already follow/requested, blocked either way.
 */
// GET /api/users/suggested?limit=5
exports.getSuggestedUsers = async (req, res) => {
  try {
    const me = req.user.id;
    const limit = Math.min(8, Math.max(1, parseInt(req.query.limit) || 5));

    const [myRegs, iFollow, myFollowers, meDoc, blocks] = await Promise.all([
      RegistrationResponse.find({ userId: me }).select("eventId").lean(),
      Follow.find({ follower: me }).select("followee").lean(), // includes pending
      Follow.find({ followee: me, status: "accepted" }).select("follower").lean(),
      User.findById(me).select("profile.institution").lean(),
      Block.find({ $or: [{ blocker: me }, { blocked: me }] }).lean(),
    ]);

    const exclude = new Set([String(me), ...iFollow.map((f) => String(f.followee))]);
    for (const b of blocks) {
      exclude.add(String(b.blocker));
      exclude.add(String(b.blocked));
    }
    const followerSet = new Set(myFollowers.map((f) => String(f.follower)));

    // Co-registered users (people at the same events)
    const coRegs = await RegistrationResponse.find({
      eventId: { $in: myRegs.map((r) => r.eventId) },
      userId: { $ne: me },
    })
      .select("userId")
      .limit(500)
      .lean();
    const score = new Map();
    const bump = (id, pts) => {
      const key = String(id);
      if (exclude.has(key)) return;
      score.set(key, (score.get(key) || 0) + pts);
    };
    for (const r of coRegs) bump(r.userId, 3);
    for (const f of followerSet) if (!exclude.has(String(f))) bump(f, 5); // mutuals

    // Same institution (only when the candidate list is thin)
    const institution = meDoc?.profile?.institution?.trim();
    if (institution && score.size < limit * 2) {
      const mates = await User.find({ "profile.institution": institution, _id: { $ne: me } })
        .select("_id")
        .limit(50)
        .lean();
      for (const m of mates) bump(m._id, 2);
    }

    const ranked = [...score.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([id]) => id);
    if (!ranked.length) return res.json({ success: true, users: [] });

    const users = await User.find({ _id: { $in: ranked } })
      .select("firstName lastName username verified profile.avatar profile.institution")
      .lean()
      .then((list) => ranked.map((id) => list.find((u) => String(u._id) === id)).filter(Boolean));

    res.json({ success: true, users });
  } catch (error) {
    console.error("Suggested users error:", error.message);
    res.status(500).json({ success: false, message: "Failed to load suggestions" });
  }
};

// GET /api/users/:id/achievements — real unlock state for the profile
exports.getUserAchievements = async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select("_id").lean();
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    const { achievementsFor } = require("../services/achievement.service");
    const achievements = await achievementsFor(user._id);
    res.json({ success: true, achievements });
  } catch (error) {
    console.error("Get achievements error:", error.message);
    res.status(500).json({ success: false, message: "Failed to load achievements" });
  }
};

/* ── Public profile ──────────────────────────────────────── */

// GET /api/users/:idOrUsername/profile  (public, viewer-aware, privacy-enforced)
exports.getPublicProfile = async (req, res) => {
  try {
    const user = await resolveUser(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    const userId = user._id;
    const viewerId = req.user?.id || null;
    const isSelf = Boolean(viewerId && String(userId) === String(viewerId));
    const viewerFollows = viewerId
      ? Boolean(await Follow.exists({ follower: viewerId, followee: userId, status: "accepted" }))
      : false;

    const visibility = user.socialSettings?.profileVisibility || "public";
    const canView = canViewContent(user, viewerId, viewerFollows);

    // Identity block — always visible (needed for the profile shell + follow button)
    const identity = {
      _id: user._id,
      firstName: user.firstName,
      lastName: user.lastName,
      username: user.username,
      verified: Boolean(user.verified),
      profile: { avatar: user.profile?.avatar || "" },
      createdAt: user.createdAt,
    };

    // Base counts (identity-level; fine to show even on private profiles)
    const [followers, following] = await Promise.all([
      Follow.countDocuments({ followee: userId, status: "accepted" }),
      Follow.countDocuments({ follower: userId, status: "accepted" }),
    ]);

    if (!canView) {
      // Private/followers-only: no posts, no bio details, no event history
      return res.json({
        success: true,
        user: identity,
        stats: { followers, following },
        visibility,
        canView: false,
        isSelf,
        following: viewerFollows,
      });
    }

    const now = new Date();
    const objectId =
      mongoose.Types.ObjectId.isValid(String(userId)) ? new mongoose.Types.ObjectId(String(userId)) : userId;
    const [posts, responses, attendedAgg, checkIns, eventsCreated] = await Promise.all([
      Post.countDocuments({ author: userId }),
      RegistrationResponse.countDocuments({ userId }),
      RegistrationResponse.aggregate([
        { $match: { userId: objectId } },
        { $lookup: { from: "events", localField: "eventId", foreignField: "_id", as: "event" } },
        { $unwind: "$event" },
        { $match: { "event.endDate": { $lt: now } } },
        { $count: "attended" },
      ]),
      Ticket.countDocuments({ userId, checkedIn: true }),
      Event.countDocuments({ createdBy: userId }),
    ]);

    const showAttendance = user.socialSettings?.showAttendance !== false;

    res.json({
      success: true,
      user: {
        ...identity,
        email: isSelf ? user.email : undefined,
        verified: Boolean(user.verified),
        points: user.points || 0,
        profile: user.profile,
        socialSettings: { profileVisibility: visibility },
      },
      stats: {
        posts,
        followers,
        following,
        eventsRegistered: responses,
        eventsAttended: showAttendance ? attendedAgg[0]?.attended || 0 : 0,
        eventsCreated,
        checkIns: showAttendance ? checkIns : 0,
      },
      visibility,
      canView: true,
      isSelf,
      following: viewerFollows,
    });
  } catch (error) {
    console.error("Public profile error:", error.message);
    res.status(500).json({ success: false, message: "Failed to load profile" });
  }
};

// GET /api/users/:idOrUsername/events  (profile Events tab; attendance-privacy aware)
exports.getUserEvents = async (req, res) => {
  try {
    const user = await resolveUser(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    const viewerId = req.user?.id || null;
    const isSelf = Boolean(viewerId && String(user._id) === String(viewerId));
    const viewerFollows = viewerId
      ? Boolean(await Follow.exists({ follower: viewerId, followee: user._id, status: "accepted" }))
      : false;

    if (!canViewContent(user, viewerId, viewerFollows) || user.socialSettings?.showAttendance === false) {
      return res.json({ success: true, upcoming: [], past: [], canView: isSelf });
    }

    const responses = await RegistrationResponse.find({ userId: user._id })
      .select("eventId createdAt")
      .populate("eventId", "title slug bannerUrl startDate endDate venue eventType category")
      .lean();

    const seen = new Set();
    const events = responses.map((r) => r.eventId).filter((e) => {
      if (!e || !e._id || seen.has(String(e._id))) return false;
      seen.add(String(e._id));
      return true;
    });

    const now = Date.now();
    const upcoming = events
      .filter((e) => new Date(e.startDate).getTime() > now)
      .sort((a, b) => +new Date(a.startDate) - +new Date(b.startDate))
      .slice(0, 6);
    const past = events
      .filter((e) => new Date(e.endDate).getTime() < now)
      .sort((a, b) => +new Date(b.endDate) - +new Date(a.endDate))
      .slice(0, 6);

    res.json({ success: true, upcoming, past, canView: true });
  } catch (error) {
    console.error("User events error:", error.message);
    res.status(500).json({ success: false, message: "Failed to load events" });
  }
};

// GET /api/users/:idOrUsername/posts?page=  (privacy-enforced)
exports.getUserPosts = async (req, res) => {
  try {
    const user = await resolveUser(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    const viewerId = req.user?.id || null;
    const viewerFollows = viewerId
      ? Boolean(await Follow.exists({ follower: viewerId, followee: user._id, status: "accepted" }))
      : false;

    if (!canViewContent(user, viewerId, viewerFollows)) {
      return res.json({ success: true, posts: [], page: 1, hasMore: false, canView: false });
    }

    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(24, Math.max(1, parseInt(req.query.limit) || 12));

    // Author's published posts only; drafts are visible to the author alone
    const isSelf = Boolean(viewerId && String(user._id) === String(viewerId));
    const postFilter = {
      author: user._id,
      status: isSelf ? { $in: ["published", "draft"] } : "published",
    };

    const [posts, total] = await Promise.all([
      Post.find(postFilter)
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .select(POST_FIELDS)
        .populate("author", AUTHOR_FIELDS)
        .populate("event", "title slug bannerUrl startDate endDate venue eventType category organizer price visibility isLive")
        .populate("organization", "name slug logoUrl")
        .populate("community", "name slug avatarUrl")
        .lean(),
      Post.countDocuments({ author: user._id }),
    ]);

    const enriched = (await enrichPosts(posts, viewerId || null)).map((p) => {
      if (p.event && p.event.visibility !== "public") p.event = null;
      return p;
    });

    res.json({ success: true, posts: enriched, page, hasMore: page * limit < total, canView: true });
  } catch (error) {
    console.error("User posts error:", error.message);
    res.status(500).json({ success: false, message: "Failed to load posts" });
  }
};
