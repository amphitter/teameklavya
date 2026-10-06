/**
 * CommunityRepository (Part 5, Phase 3 — spec §4, §7, §9, §13, §37)
 * ──────────────────────────────────────────────────────────────────
 * SOCIAL DOMAIN. Owns community metadata and membership reads.
 *
 * Community metadata is public and slow-changing → cached (§9).
 * Membership is viewer-sensitive in general, but the *member list* of a
 * public community is public data, so it is cacheable only as a paginated,
 * projected list — never as a whole-set payload (§6: never return the full
 * member array to a client).
 *
 * Deleted and suspended communities are treated as non-existent everywhere
 * in this file: their posts and member lists must vanish, not 404 oddly.
 */

const Community = require("../models/community.model");
const CommunityMember = require("../models/communityMember.model");
const { cache, keys, TTL } = require("../services/cache.service");
const { parseLimit, buildPage, withCursor } = require("./cursor");

/** Public community card fields. */
const PUBLIC_FIELDS =
  "name slug description avatarUrl joinPolicy organization status affiliationDomain officialOrganization isVerified createdAt";

const LIVE = { deletedAt: null, status: { $ne: "suspended" } };

/** Cache-first public community metadata by slug. */
async function publicBySlug(slug) {
  const key = `community:slug:${slug}`;

  const hit = cache.peek(key);
  if (hit !== undefined) return hit;

  const doc = await Community.findOne({ slug, ...LIVE }).select(PUBLIC_FIELDS).lean();
  if (!doc) return null;

  await cache.getOrSet(key, async () => doc, { ttl: TTL.COMMUNITY_META });
  return doc;
}

/** Cached active-member count (§37 — a count, never a member load). */
function memberCount(communityId) {
  return cache.getOrSet(
    `counts:community:${communityId}`,
    () => CommunityMember.countDocuments({ community: communityId, status: "active" }),
    { ttl: TTL.EVENT_COUNTS }
  );
}

/** Paginated, projected member list (§6, §7). */
async function listMembers({ communityId, limit, cursor, status = "active" }) {
  const size = parseLimit(limit, { def: 20, max: 100 });
  const filter = withCursor({ community: communityId, status }, cursor);
  const rows = await CommunityMember.find(filter)
    .select("_id user role createdAt")
    .populate("user", "firstName lastName username profile.avatar")
    .sort({ createdAt: -1, _id: -1 })
    .limit(size + 1)
    .lean();
  return buildPage(rows, size);
}

/**
 * The communities a user belongs to — bounded and projected.
 * Was previously fetched unbounded inside the feed visibility filter; the
 * feed now sources this from the cached FeedContext instead.
 */
async function listForUser(userId, { limit = 50 } = {}) {
  const size = parseLimit(limit, { def: 50, max: 100 });
  const rows = await CommunityMember.find({ user: userId, status: "active" })
    .select("_id community role createdAt")
    .populate({ path: "community", select: PUBLIC_FIELDS, match: LIVE })
    .sort({ createdAt: -1 })
    .limit(size)
    .lean();
  return rows.filter((r) => r.community);
}

/** Invalidate cached community metadata + counts (§13). */
function invalidate(community) {
  if (!community) return;
  const id = community._id ? String(community._id) : String(community);
  cache.invalidate(keys.community(id));
  cache.invalidate(`counts:community:${id}`);
  if (community.slug) cache.invalidate(`community:slug:${community.slug}`);
}

module.exports = {
  CommunityRepository: { publicBySlug, memberCount, listMembers, listForUser, invalidate },
  PUBLIC_FIELDS,
  LIVE,
};
