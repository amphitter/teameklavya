/**
 * Global search (Part 3, Phase 11).
 * GET /api/search?q=&type=  (public; optionalUser for own-post results)
 * type: all (default) | events | communities | people | posts | organizations
 */
const Event = require("../models/event.model");
const Organization = require("../models/organization.model");
const { clampQuery } = require("../utils/regex");
const { parseLimit, withCursor, buildPage } = require("../repositories/cursor");
const Community = require("../models/community.model");
const User = require("../models/user.model");
const Follow = require("../models/follow.model");
const Post = require("../models/post.model");

const EVENT_FIELDS = "title slug description category venue startDate endDate bannerUrl logoUrl price eventType visibility";
const COMMUNITY_FIELDS = "name slug description avatarUrl category status verified";
const USER_FIELDS = "firstName lastName username profile.avatar profile.institution socialSettings.profileVisibility verified";
const ORGANIZATION_FIELDS = "name handle slug category description logo cover logoUrl coverUrl city state country isVerified createdAt";

const TYPES = ["events", "communities", "people", "posts", "organizations"];

function escapeRegex(q) {
  return String(q).replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&");
}

exports.globalSearch = async (req, res) => {
  try {
    const q = clampQuery(req.query.q, 100);
    const type = TYPES.includes(req.query.type) ? req.query.type : "all";
    const defaultLimit = type === "all" ? 5 : 20;
    const limit = parseLimit(req.query.limit, { def: defaultLimit, max: 50 });

    if (q.length < 2) {
      return res.json({
        success: true,
        q,
        events: [],
        communities: [],
        people: [],
        posts: [],
        organizations: [],
        ...(type === "organizations" ? { nextCursor: null, hasMore: false } : {}),
      });
    }
    const rx = new RegExp(escapeRegex(q), "i");

    const wants = (t) => type === "all" || type === t;
    const viewerId = req.user?.id || null;
    const organizationSearchFilter = {
      $or: [{ name: rx }, { handle: rx }, { slug: rx }, { description: rx }, { city: rx }],
    };
    const paginateOrganizations = type === "organizations";

    const [events, communities, peopleRaw, postsRaw, organizationRows] = await Promise.all([
      wants("events")
        ? Event.find({
            visibility: "public",
            removedAt: null,
            archivedAt: null,
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
            bannedAt: null,
            hidePersonalProfileFromDiscovery: { $ne: true },
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
            archivedAt: null,
            moderationStatus: { $nin: ["removed", "quarantined", "pending"] },
            $or: [{ visibility: "public" }, ...(viewerId ? [{ author: viewerId }] : [])],
            content: rx,
          })
            .select("content author visibility createdAt")
            .sort({ createdAt: -1 })
            .limit(limit)
            .populate("author", USER_FIELDS)
            .lean()
        : Promise.resolve([]),
      wants("organizations")
        ? Organization.find(withCursor(organizationSearchFilter, paginateOrganizations ? req.query.cursor : null))
            .select(ORGANIZATION_FIELDS)
            .sort({ createdAt: -1, _id: -1 })
            .limit(paginateOrganizations ? limit + 1 : limit)
            .lean()
        : Promise.resolve([]),
    ]);

    // Privacy: for people search, private accounts are discoverable (username/avatar) but bio/institution stripped unless self/follower
    let people = peopleRaw;
    let followingSet = new Set();
    if (viewerId && peopleRaw.length) {
      const myFollowing = await Follow.find({ follower: viewerId, status: "accepted" }).select("followee").lean();
      followingSet = new Set(myFollowing.map((f) => String(f.followee)));
    }
    people = peopleRaw.map((u) => {
      const isPrivate = u.socialSettings?.profileVisibility === "private";
      const isSelf = viewerId && String(u._id) === String(viewerId);
      const isFollower = followingSet.has(String(u._id));
      const canViewDetails = !isPrivate || isSelf || isFollower;
      return {
        _id: u._id,
        firstName: u.firstName,
        lastName: u.lastName,
        username: u.username,
        profile: {
          avatar: u.profile?.avatar || "",
          institution: canViewDetails ? u.profile?.institution || "" : "",
        },
        verified: u.verified,
        isPrivate,
      };
    });

    // Posts: additionally filter out posts whose author is private and viewer not follower/self (defense-in-depth)
    let posts = postsRaw;
    if (postsRaw.length) {
      const authorIds = [...new Set(postsRaw.map((p) => String(p.author?._id || p.author)).filter(Boolean))];
      if (authorIds.length) {
        const authors = await User.find({ _id: { $in: authorIds } }).select("socialSettings.profileVisibility").lean();
        const privateMap = new Map();
        authors.forEach((a) => {
          privateMap.set(String(a._id), a.socialSettings?.profileVisibility === "private");
        });
        if (viewerId) {
          // already have followingSet from above if people search, but recompute if not
          if (!followingSet.size) {
            const myFollowing = await Follow.find({ follower: viewerId, status: "accepted" }).select("followee").lean();
            followingSet = new Set(myFollowing.map((f) => String(f.followee)));
          }
        }
        posts = postsRaw.filter((p) => {
          const aid = String(p.author?._id || p.author);
          if (!privateMap.get(aid)) return true;
          if (!viewerId) return false;
          if (String(viewerId) === aid) return true;
          return followingSet.has(aid);
        });
      }
    }

    const organizationPage = paginateOrganizations
      ? buildPage(organizationRows, limit)
      : { items: organizationRows, nextCursor: null, hasMore: false };

    const mutualsByUser = new Map();
    if (viewerId && people.length) {
      const myFollowing = await Follow.find({ follower: viewerId, status: "accepted" }).select("followee").lean();
      const mine = myFollowing.map((f) => f.followee);
      if (mine.length) {
        const rows = await Follow.aggregate([
          {
            $match: {
              follower: { $in: people.map((u) => u._id) },
              followee: { $in: mine },
              status: "accepted",
            },
          },
          { $group: { _id: "$follower", count: { $sum: 1 } } },
        ]);
        rows.forEach((r) => mutualsByUser.set(String(r._id), r.count));
      }
    }

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
        isPrivate: u.isPrivate,
        ...(viewerId ? { mutuals: mutualsByUser.get(String(u._id)) || 0 } : {}),
      })),
      posts: posts.map((p) => ({
        _id: p._id,
        content: String(p.content || "").slice(0, 200),
        author: p.author,
        createdAt: p.createdAt,
      })),
      organizations: organizationPage.items.map((organization) => ({
        ...organization,
        handle: organization.handle || organization.slug,
        category: organization.category || "OTHER",
        logo: organization.logo || organization.logoUrl || "",
        cover: organization.cover || organization.coverUrl || "",
        city: organization.city || "",
        state: organization.state || "",
        country: organization.country || "",
      })),
      ...(paginateOrganizations
        ? { nextCursor: organizationPage.nextCursor, hasMore: organizationPage.hasMore }
        : {}),
    });
  } catch (error) {
    console.error("Global search error:", error.message);
    res.status(500).json({ success: false, message: "Search failed" });
  }
};
