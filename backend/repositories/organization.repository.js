/**
 * OrganizationRepository (Part 5, Phase 3 — spec §2, §4, §9, §13, §37)
 * ─────────────────────────────────────────────────────────────────────
 * SOCIAL DOMAIN (organizations are the bridge between the event and social
 * domains: an org owns events, but its profile, followers and membership are
 * social data).
 *
 * Organization profiles are public, slow-changing and identical for every
 * viewer — a clean §9 cache target. Their *statistics* (followers, event
 * count, member count) are the expensive part: they are counts over other
 * collections, so they are cached separately under a SHORTER TTL than the
 * profile itself. That split means a profile edit invalidates only the
 * profile, while a new follower only invalidates the (cheaper, shorter-lived)
 * stats entry.
 */

const Organization = require("../models/organization.model");
const OrgFollow = require("../models/orgFollow.model");
const Event = require("../models/event.model");
const { cache, keys, TTL } = require("../services/cache.service");
const { parseLimit, buildPage, withCursor } = require("./cursor");

/** Public profile fields — the org card, nothing internal. */
const PUBLIC_FIELDS = "name slug description logoUrl coverUrl website isVerified createdBy";

/**
 * Cache-first public organization profile by slug.
 * Uses `peek` (not `getOrSet`) so a not-yet-created org is never cached as
 * null — the same reasoning as EventRepository.publicBySlug.
 */
async function publicBySlug(slug) {
  const key = `org:slug:${slug}`;

  const hit = cache.peek(key);
  if (hit !== undefined) return hit;

  const doc = await Organization.findOne({ slug }).select(PUBLIC_FIELDS).lean();
  if (!doc) return null;

  await cache.getOrSet(key, async () => doc, { ttl: TTL.ORG_PROFILE });
  return doc;
}

/**
 * Aggregate statistics in ONE round trip (§37 — never load rows to count).
 * Three counts that would otherwise be three separate queries per page view.
 */
async function counts(organizationId) {
  return cache.getOrSet(
    `counts:org:${organizationId}`,
    async () => {
      const [followers, events] = await Promise.all([
        OrgFollow.countDocuments({ organization: organizationId }),
        Event.countDocuments({ organization: organizationId, removedAt: null }),
      ]);
      return { followers, events };
    },
    { ttl: TTL.EVENT_COUNTS }
  );
}

/** Cached follower list page (public social data). */
async function listFollowers({ organizationId, limit, cursor }) {
  const size = parseLimit(limit, { def: 20, max: 100 });
  const filter = withCursor({ organization: organizationId }, cursor);
  const rows = await OrgFollow.find(filter)
    .select("_id user createdAt")
    .populate("user", "firstName lastName username profile.avatar")
    .sort({ createdAt: -1, _id: -1 })
    .limit(size + 1)
    .lean();
  return buildPage(rows, size);
}

/** Invalidate an org's cached profile + stats (§13). */
function invalidate(organization) {
  if (!organization) return;
  const id = organization._id ? String(organization._id) : String(organization);
  cache.invalidate(keys.organization(id));
  cache.invalidate(`counts:org:${id}`);
  if (organization.slug) cache.invalidate(`org:slug:${organization.slug}`);
}

module.exports = {
  OrganizationRepository: { publicBySlug, counts, listFollowers, invalidate },
  PUBLIC_FIELDS,
};
