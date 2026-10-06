/**
 * EventRepository (Part 5, Phase 3 — spec §2, §4, §9, §13, §14)
 * ──────────────────────────────────────────────────────────────
 * EVENT DOMAIN. Owns every Event read/write cache concern.
 *
 * Public event detail is the single hottest read in EventHub: every
 * anonymous visitor, every shared link and every crawler hits it, and before
 * Phase 3 each one of those was a fresh MongoDB document load plus a
 * populate. It is also the text-book cacheable resource from §9 — public,
 * slow-changing, identical for every viewer.
 *
 * Design decisions:
 *
 *  • CACHE-FIRST via `cache.peek()`, not `getOrSet()`. A missing or private
 *    event is a *temporary* state that must never be cached: caching `null`
 *    would make a just-created event invisible until TTL expiry, and caching
 *    a private event's absence would leak nothing but would break the
 *    organizer's authorized path. `peek` gives us "0 DB queries on hit"
 *    without ever poisoning the key.
 *
 *  • PRIVATE EVENTS ARE NEVER CACHED. Authorization for them depends on the
 *    caller (`canManageEvent`), so the payload is not viewer-independent.
 *    This is the §10 rule: never share a cached response whose contents
 *    depend on who is asking.
 *
 *  • Only the already-redacted public projection is stored, so the cache
 *    never holds sensitive fields (join codes, meeting passcodes, ticket
 *    settings) even in process memory.
 */

const Event = require("../models/event.model");
const EventInterest = require("../models/eventInterest.model");
const { cache, keys, TTL } = require("../services/cache.service");

const ORG_SUMMARY = "name slug logoUrl";

/** Fields that must never reach a public response (or the cache). */
const STRIP_FIELDS = [
  "meetingId",
  "passcode",
  "checkIns",
  "bannerPublicId",
  "ticketSettings",
  "whatsappGroup",
];

/**
 * Redact an event document for public consumption.
 * Single source of truth — the controller imports this rather than keeping
 * its own copy, so the two can never drift apart.
 */
function toPublicEvent(event) {
  const doc = event && event.toObject ? event.toObject() : { ...(event || {}) };
  STRIP_FIELDS.forEach((key) => delete doc[key]);
  if (doc.visibility === "private") {
    delete doc.onlineEventLink;
    delete doc.materials;
    delete doc.recordingLink;
  }
  return doc;
}

/**
 * Cache-first public lookup by slug.
 *
 * @returns {object|null} the public projection, a raw private document
 *   (caller MUST authorize), or null when the slug doesn't resolve.
 *   A returned document carrying `visibility === "private"` is deliberately
 *   NOT cached and NOT redacted — the controller handles that path.
 */
async function publicBySlug(slug) {
  const key = keys.eventSlug(slug);

  const hit = await cache.peek(key);
  if (hit !== undefined) return hit; // 0 database queries

  const doc = await Event.findOne({ slug, removedAt: null })
    .populate("organization", ORG_SUMMARY)
    .lean();

  if (!doc) return null; // never cached — a future create resolves instantly
  if (doc.visibility === "private") return doc; // never cached — caller authorizes

  const payload = toPublicEvent(doc);
  await cache.getOrSet(key, async () => payload, { ttl: TTL.PUBLIC_EVENT });
  return payload;
}

/** Cache-first public lookup by id (same rules as publicBySlug). */
async function publicById(id) {
  const key = keys.event(id);

  const hit = await cache.peek(key);
  if (hit !== undefined) return hit;

  const doc = await Event.findById(id).populate("organization", ORG_SUMMARY).lean();
  if (!doc) return null;
  if (doc.visibility === "private") return doc;

  const payload = toPublicEvent(doc);
  await cache.getOrSet(key, async () => payload, { ttl: TTL.PUBLIC_EVENT });
  return payload;
}

/** Cached "Interested" count (public integer — safe to cache, §37). */
function interestCount(eventId) {
  return cache.getOrSet(
    `counts:interest:${eventId}`,
    () => EventInterest.countDocuments({ event: eventId }),
    { ttl: TTL.EVENT_COUNTS }
  );
}

/**
 * Invalidate every cached view of an event (§13).
 * Call on update, publish, unpublish and delete — by id AND by slug, since
 * public lookups are keyed by slug and admin lookups by id.
 */
/**
 * Invalidate every cached view of an event (§13).
 * Async since Part 6: invalidation is now a network call when the provider
 * is Redis, so callers must await it before relying on the cache being cold.
 */
async function invalidate(event) {
  if (!event) return;
  const id = event._id ? String(event._id) : String(event);
  // Invalidation is BEST-EFFORT: a failed invalidation must never fail the
  // write that triggered it — the stale entry simply expires on its TTL.
  try {
    await Promise.all([
      cache.invalidate(keys.event(id)),
      cache.invalidate(keys.eventCounts(id)),
      cache.invalidate(`stats:event:${id}`),
      cache.invalidate(`counts:interest:${id}`),
      event.slug ? cache.invalidate(keys.eventSlug(event.slug)) : Promise.resolve(),
      // Discovery feeds (explore/popular/trending) are derived from events
      cache.invalidatePrefix("explore:"),
      cache.invalidatePrefix("trending:"),
    ]);
  } catch (err) {
    console.warn("[cache] invalidation failed:", err?.message || err);
  }
}

module.exports = {
  EventRepository: {
    publicBySlug,
    publicById,
    interestCount,
    invalidate,
    toPublicEvent,
  },
  ORG_SUMMARY,
};
