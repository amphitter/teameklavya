/**
 * Global search (Part 3, Phase 11).
 * ─────────────────────────────
 *  GET /api/search?q=&type=  (public; optionalUser for own-post results)
 *
 *  type: all (default) | events | communities | people | posts
 *  - "all" returns up to 5 results per entity (nav dropdown)
 *  - a specific type returns up to 20 (search page tab)
 *
 *  Posts: only published + public (plus the viewer's own posts) —
 *  follower/community/event-participant posts never leak into search.
 */
const mongoose = require("mongoose");
const Event = require("../models/event.model");
const { clampQuery } = require("../utils/regex");
const { parseLimit } = require("../repositories/cursor");
const Community = require("../models/community.model");
const User = require("../models/user.model");
const Post = require("../models/post.model");

const EVENT_FIELDS = "title slug description category venue startDate endDate bannerUrl price eventType visibility";
const COMMUNITY_FIELDS = "name slug description avatarUrl category status verified";
const USER_FIELDS = "firstName lastName username profile verified";

const TYPES = ["events", "communities", "people", "posts"];

function escapeRegex(q) {
  return String(q).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// GET /api/search?q=&type=
exports.globalSearch = async (req, res) => {
  try {
    // §63 — cap the query string BEFORE it reaches a regex or the database.
    // An unbounded search string is both a CPU risk (catastrophic backtracking
    // on a large corpus) and a request-size vector.
    const q = clampQuery(req.query.q, 100);
    const type = TYPES.includes(req.query.type) ? req.query.type : "all";

    // §63 — client-requested page size is clamped server-side, never trusted.
    // "all" is the nav type-ahead (tiny); a specific tab may ask for more.
    const defaultLimit = type === "all" ? 5 : 20;
    const limit = parseLimit(req.query.limit, { def: defaultLimit, max: 50 });

    if (q.length < 2) {
      return res.json({ success: true, q, events: [], communities: [], people: [], posts: [] });
    }
    const rx = new RegExp(escapeRegex(q), "i");

    const wants = (t) => type === "all" || type === t;
    const viewerId = req.user?.id || null;

    const [events, communities, people, posts] = await Promise.all([
      wants("events")
        ? Event.find({
            visibility: "public",
            removedAt: null,
            $or: [{ title: rx }, { description: rx }, { venue: rx }, { organizer: rx }],
          })
            .select(EVENT_FIELDS)
            .sort({ startDate: 1 })
            .limit(limit)
            .lean()
        : Promise.resolve([]),
      wants("communities")
        ? Community.find({
            deletedAt: null,
            status: { $ne: "suspended" },
            $or: [{ name: rx }, { description: rx }],
          })
            .select(COMMUNITY_FIELDS)
            .sort({ createdAt: -1 })
            .limit(limit)
            .lean()
        : Promise.resolve([]),
      wants("people")
        ? User.find({
            suspendedAt: null,
            $or: [
              { firstName: rx },
              { lastName: rx },
              { username: rx },
              { "profile.institution": rx },
            ],
          })
            .select(USER_FIELDS)
            .sort({ points: -1 })
            .limit(limit)
            .lean()
        : Promise.resolve([]),
      wants("posts")
        ? Post.find({
            status: "published",
            $or: [{ visibility: "public" }, ...(viewerId ? [{ author: viewerId }] : [])],
            content: rx,
          })
            .select("content author visibility createdAt")
            .sort({ createdAt: -1 })
            .limit(limit)
            .populate("author", USER_FIELDS)
            .lean()
        : Promise.resolve([]),
    ]);

    res.json({
      success: true,
      q,
      events,
      communities,
      people: people.map((u) => ({
        _id: u._id,
        firstName: u.firstName,
        lastName: u.lastName,
        username: u.username,
        profile: u.profile,
        verified: u.verified,
      })),
      posts: posts.map((p) => ({
        _id: p._id,
        content: String(p.content || "").slice(0, 200),
        author: p.author,
        createdAt: p.createdAt,
      })),
    });
  } catch (error) {
    console.error("Global search error:", error.message);
    res.status(500).json({ success: false, message: "Search failed" });
  }
};
