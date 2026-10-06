/**
 * RegistrationRepository (Part 5, Phase 3 — spec §2, §4, §5, §7, §36, §41)
 * ──────────────────────────────────────────────────────────────────────────
 * EVENT DOMAIN. The ONLY place that queries RegistrationResponse.
 *
 * Fixes delivered in this file (all flagged CRITICAL in the Phase 0 audit):
 *
 *  P0-1  `getEventResponses` was UNBOUNDED — every registration for an event
 *        was loaded, populated and serialized. A 5,000-person event produced
 *        a 5,000-document response. Now: cursor pagination, hard-capped at
 *        MAX_LIMIT (100), with server-side search + status filter (§41).
 *
 *  P0-2  `exportRegistrations` read the entire registration set into RAM and
 *        built the whole CSV string in memory. Now: `iterateByEvent()` is a
 *        bounded async generator (batchSize rows at a time) that the
 *        controller streams straight to the HTTP response.
 *
 *  P0-3  `getRegistrationCounts` issued TWO queries PER eventId
 *        (`Event.exists` + `countDocuments`) — 2N round trips for N events.
 *        Now: ONE aggregation for the whole batch (§36).
 *
 *  P0-4  `getRegistrationStats` issued 5 separate queries (3 counts + 2
 *        aggregations). Now: ONE `$facet` aggregation.
 *
 * Cache policy (§9–13): registration COUNTS are public integers, so they are
 * cached under `counts:event:{id}` with a short TTL and invalidated on every
 * registration write. Participant ROWS are never cached (private PII).
 */

const mongoose = require("mongoose");
const RegistrationResponse = require("../models/registrationResponse.model");
const User = require("../models/user.model");
const { cache, keys, TTL } = require("../services/cache.service");
const { parseLimit, buildPage, withCursor } = require("./cursor");
const { containsRegex, clampQuery } = require("../utils/regex");

/* ── Projections (§5, §6): only what the participant table renders ─────── */
const ROW_FIELDS = "_id eventId userId answers status createdAt source";
const USER_FIELDS = "firstName lastName email profile";
/** My-events cards — the event summary a registered user needs, nothing more. */
const EVENT_CARD_FIELDS =
  "title slug description bannerUrl startDate endDate startTime endTime venue eventType category organizer price visibility isLive";

/** Rows per export batch — bounds memory regardless of event size. */
const EXPORT_BATCH = 200;

const idOf = (v) => (v && v._id ? v._id : v);

/**
 * Resolve a free-text query to matching user ids in ONE bounded query.
 * Name/email live on User, so we filter registrations by userId rather than
 * pulling every registration into memory to match on populated fields.
 * Returns null when there is no query.
 */
async function resolveUserIds(q) {
  if (!q) return null;
  const rx = containsRegex(q);
  if (!rx) return null;
  const users = await User.find({
    $or: [{ firstName: rx }, { lastName: rx }, { email: rx }, { username: rx }],
  })
    .select("_id")
    .limit(200) // bounded: a 1-char query must not match the whole directory
    .lean();
  return users.map((u) => u._id);
}

/**
 * Paginated participant list with server-side search + status filter (§41).
 *
 * @param {object} p
 * @param {string} p.eventId
 * @param {number} [p.limit]   clamped to MAX_LIMIT
 * @param {string} [p.cursor]  opaque cursor
 * @param {string} [p.q]       match name / email / answer text
 * @param {"all"|"confirmed"|"pending"} [p.status]
 * @returns {{ items: Array, nextCursor: string|null, hasMore: boolean }}
 */
async function listByEvent({ eventId, limit, cursor, q, status }) {
  const size = parseLimit(limit, { def: 20, max: 100 });
  const filter = { eventId };

  if (status === "confirmed" || status === "pending") filter.status = status;

  const query = clampQuery(q, 100);
  if (query) {
    const userIds = await resolveUserIds(query);
    const rx = containsRegex(query);
    const clauses = [];
    if (userIds && userIds.length) clauses.push({ userId: { $in: userIds } });
    if (rx) clauses.push({ "answers.value": rx });
    // A query that matches neither a user nor an answer must yield nothing,
    // not everything — hence the explicit empty-$or guard.
    filter.$or = clauses.length ? clauses : [{ _id: null }];
  }

  const finalFilter = withCursor(filter, cursor);

  // limit + 1 → derive `hasMore` from the slice; no countDocuments() (§5)
  const rows = await RegistrationResponse.find(finalFilter)
    .select(ROW_FIELDS)
    .populate("userId", USER_FIELDS)
    .sort({ createdAt: -1, _id: -1 })
    .limit(size + 1)
    .lean();

  return buildPage(rows, size);
}

/**
 * Bounded async generator over every registration for an event.
 * Walks the `_id` index in batches so peak memory is one batch, not the
 * whole event — this is what makes CSV export safe on large events (§40).
 */
async function* iterateByEvent({ eventId, batchSize = EXPORT_BATCH }) {
  let lastId = null;
  for (;;) {
    const filter = lastId ? { eventId, _id: { $gt: lastId } } : { eventId };
    const rows = await RegistrationResponse.find(filter)
      .select(ROW_FIELDS)
      .populate("userId", USER_FIELDS)
      .sort({ _id: 1 })
      .limit(batchSize)
      .lean();
    if (!rows.length) return;
    yield rows;
    if (rows.length < batchSize) return;
    lastId = rows[rows.length - 1]._id;
  }
}

/**
 * Registration counts for MANY events in ONE aggregation (§36).
 * Before: 2 queries per event id — the admin dashboard passed every event id.
 * Results are written through to the per-event count cache so the single
 * `countByEvent` path benefits too.
 */
async function countsBatch(eventIds) {
  const input = Array.isArray(eventIds) ? eventIds : [];
  const unique = [...new Set(input.filter((id) => mongoose.Types.ObjectId.isValid(id)).map(String))];
  if (!unique.length) return {};

  const objectIds = unique.map((id) => new mongoose.Types.ObjectId(id));
  const rows = await RegistrationResponse.aggregate([
    { $match: { eventId: { $in: objectIds } } },
    { $group: { _id: "$eventId", count: { $sum: 1 } } },
  ]);

  const map = new Map(rows.map((r) => [String(r._id), r.count]));
  const out = {};

  // Zero DB cost: seed the cache from results we already have.
  await Promise.all(
    unique.map(async (id) => {
      const value = map.get(id) || 0;
      out[id] = value;
      await cache.getOrSet(keys.eventCounts(id), async () => value, { ttl: TTL.EVENT_COUNTS });
    })
  );

  return out;
}

/** Cached registration count for a single event (public integer — §9). */
function countByEvent(eventId) {
  return cache.getOrSet(
    keys.eventCounts(eventId),
    () => RegistrationResponse.countDocuments({ eventId }),
    { ttl: TTL.EVENT_COUNTS }
  );
}

/**
 * All dashboard statistics in ONE `$facet` aggregation (§40).
 * Before: 3 countDocuments + 2 aggregations = 5 round trips.
 */
function statsByEvent(eventId) {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const oid = new mongoose.Types.ObjectId(String(eventId));

  return cache.getOrSet(
    `stats:event:${eventId}`,
    async () => {
      const [facet] = await RegistrationResponse.aggregate([
        { $match: { eventId: oid } },
        {
          $facet: {
            status: [{ $group: { _id: "$status", count: { $sum: 1 } } }],
            daily: [
              { $match: { createdAt: { $gte: thirtyDaysAgo } } },
              {
                $group: {
                  _id: { date: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } } },
                  count: { $sum: 1 },
                },
              },
              { $sort: { "_id.date": 1 } },
            ],
            source: [{ $group: { _id: "$source", count: { $sum: 1 } } }],
          },
        },
      ]);

      const byStatus = Object.fromEntries((facet?.status || []).map((r) => [r._id || "unknown", r.count]));
      const total = (facet?.status || []).reduce((sum, r) => sum + r.count, 0);
      const confirmed = byStatus.confirmed || 0;
      const pending = byStatus.pending || 0;

      const sourceBreakdown = { web: 0, mobile: 0, admin: 0 };
      for (const row of facet?.source || []) {
        const key = row._id || "web";
        sourceBreakdown[key] = (sourceBreakdown[key] || 0) + row.count;
      }

      return {
        totalRegistrations: total,
        confirmedRegistrations: confirmed,
        pendingRegistrations: pending,
        registrationRate: total > 0 ? (confirmed / total) * 100 : 0,
        dailyRegistrations: (facet?.daily || []).map((d) => ({ date: d._id.date, count: d.count })),
        sourceBreakdown,
      };
    },
    { ttl: TTL.EVENT_COUNTS }
  );
}

/**
 * The events a user registered for — paginated + projected (was an unbounded
 * `populate("eventId")` of every full event document).
 */
async function listUserEvents({ userId, limit, cursor }) {
  const size = parseLimit(limit, { def: 20, max: 100 });
  const filter = withCursor({ userId }, cursor);

  const rows = await RegistrationResponse.find(filter)
    .select("_id eventId status createdAt")
    .populate({ path: "eventId", select: EVENT_CARD_FIELDS })
    .sort({ createdAt: -1, _id: -1 })
    .limit(size + 1)
    .lean();

  const page = buildPage(rows, size);
  return {
    ...page,
    // Back-compat: the endpoint historically returned a plain `events` array.
    events: page.items.map((r) => r.eventId).filter(Boolean),
  };
}

/**
 * The viewer's own registration for an event, or null.
 * Returns the full document because the status endpoint hands it back to the
 * client; it is a single row, so there is nothing to project away.
 */
function findForUser(eventId, userId) {
  return RegistrationResponse.findOne({ eventId, userId }).lean();
}

/**
 * Cheap existence check for write paths (double-submit guard).
 * `exists()` selects only `_id`, so this stays lighter than findForUser.
 */
function existsForUser(eventId, userId) {
  return RegistrationResponse.exists({ eventId, userId });
}

/**
 * Invalidate every cached derivative of an event's registration data.
 * MUST be called on each registration write (§13).
 */
function invalidateEvent(eventId) {
  cache.invalidate(keys.eventCounts(eventId));
  cache.invalidate(`stats:event:${eventId}`);
}

module.exports = {
  RegistrationRepository: {
    listByEvent,
    iterateByEvent,
    countsBatch,
    countByEvent,
    statsByEvent,
    listUserEvents,
    findForUser,
    existsForUser,
    invalidateEvent,
  },
  ROW_FIELDS,
  USER_FIELDS,
  EVENT_CARD_FIELDS,
  EXPORT_BATCH,
};
