/**
 * NotificationRepository (Part 5, Phase 3 — spec §4, §7, §10, §37)
 * ─────────────────────────────────────────────────────────────────
 * SOCIAL DOMAIN. Owns notification reads.
 *
 * Notifications are strictly PER-USER, so every cache key here embeds the
 * user id and is registered under the private `notif:` prefix. That prefix is
 * listed in `PRIVATE_PREFIXES` in the cache service, which means:
 *   • stale-while-revalidate is *forbidden* for these keys (asserted at
 *     runtime), because serving one user's notifications from a stale entry
 *     is indistinguishable from leaking them if identities ever collide;
 *   • they are never shared across users (§10).
 *
 * The unread badge is the hottest notification read (the frontend polls it),
 * so it is a cached COUNT — never a load of the notification rows (§37).
 */

const Notification = require("../models/notification.model");
const { cache } = require("../services/cache.service");
const { parseLimit, buildPage, withCursor } = require("./cursor");

/** Notification row projection — enough to render an item (§6). */
const FIELDS =
  "_id type actor post event organization community conversation read createdAt";
const ACTOR_FIELDS = "firstName lastName username profile.avatar";

/** Short TTL — the badge must feel live; event-driven invalidation does the rest. */
const UNREAD_TTL = 15 * 1000;

/**
 * Paginated notification list for one user.
 * @param {object} p
 * @param {boolean} [p.unreadOnly] filter to unread items only
 */
async function listForUser({ userId, limit, cursor, unreadOnly = false }) {
  const size = parseLimit(limit, { def: 20, max: 50 });
  const filter = { user: userId };
  if (unreadOnly) filter.read = false;

  const rows = await Notification.find(withCursor(filter, cursor))
    .select(FIELDS)
    .populate("actor", ACTOR_FIELDS)
    .sort({ createdAt: -1, _id: -1 })
    .limit(size + 1)
    .lean();

  return buildPage(rows, size);
}

/** Cached unread COUNT for the header badge (§37 — never load rows to count). */
function unreadCount(userId) {
  return cache.getOrSet(
    `notif:unread:${userId}`,
    () => Notification.countDocuments({ user: userId, read: false }),
    { ttl: UNREAD_TTL }
  );
}

/**
 * Invalidate a user's cached unread count (§13).
 * Called on: notification created, notification read, mark-all-read.
 */
function invalidate(userId) {
  if (userId) cache.invalidate(`notif:unread:${userId}`);
}

module.exports = {
  NotificationRepository: { listForUser, unreadCount, invalidate },
  FIELDS,
  ACTOR_FIELDS,
};
