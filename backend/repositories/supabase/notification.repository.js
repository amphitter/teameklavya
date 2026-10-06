/**
 * NotificationRepository (Supabase) (Phase 5 — §8, §13)
 * ─────────────────────────────────────────────────────────────────────────────
 * Mirrors the MongoDB surface: listForUser, unreadCount, invalidate (§66).
 */

"use strict";

const { BaseSupabaseRepository } = require("./base.repository");
const { decodeCursor, encodeCursor, MAX_LIMIT } = require("../cursor");

const NOTIFICATION_COLUMNS = [
  "id", "user_id", "actor_id", "type", "read",
  "post_id", "event_id", "organization_id", "community_id", "conversation_id",
  "created_at",
];

function decodeAfter(raw) {
  const d = decodeCursor(raw);
  return d && d.at !== undefined && d.id !== undefined ? { sortValue: d.at, id: d.id } : null;
}
function encodeAfter(after) {
  return after ? encodeCursor({ at: after.sortValue, id: after.id }) : null;
}

class NotificationRepository extends BaseSupabaseRepository {
  constructor() { super({ table: "notifications", sortColumn: "created_at" }); }

  async listForUser(userId, { limit, cursor: raw, unreadOnly = false } = {}) {
    const q = this.query().select(NOTIFICATION_COLUMNS);
    q.eq("user_id", String(userId));
    if (unreadOnly) q.eq("read", false);

    const { rows, nextAfter, hasMore } = await q.paginate({
      after: decodeAfter(raw),
      limit: this.parseLimit(limit),
      sortColumn: "created_at",
      direction: "desc",
    });
    return { items: rows, nextCursor: encodeAfter(nextAfter), hasMore };
  }

  /**
   * The unread badge. Uses the partial index `WHERE read = false`, so this
   * does not scan the (much larger) set of read notifications.
   */
  async unreadCount(userId) {
    const rows = await this.query()
      .select(["id"])
      .eq("user_id", String(userId))
      .eq("read", false)
      .limit(MAX_LIMIT)
      .many();
    return rows.length;
  }

  async markRead(notificationId, userId) {
    // Scoped by user_id: one user can never mark another's notification read.
    return this.update({ read: true }, {
      where: (q) => q.eq("id", String(notificationId)).eq("user_id", String(userId)),
    });
  }

  async markAllRead(userId) {
    return this.update({ read: true }, {
      where: (q) => q.eq("user_id", String(userId)).eq("read", false),
      returning: false,
    });
  }

  /**
   * Create, honouring per-type preferences. Muted types are filtered at READ
   * time rather than at write time, so muting is reversible with no backfill.
   */
  async create(n) {
    return this.insert({
      user_id: String(n.userId),
      actor_id: n.actorId ? String(n.actorId) : null, // NULL = EventHub system
      type: n.type,
      post_id: n.postId ? String(n.postId) : null,
      event_id: n.eventId ? String(n.eventId) : null,
      organization_id: n.organizationId ? String(n.organizationId) : null,
      community_id: n.communityId ? String(n.communityId) : null,
      conversation_id: n.conversationId ? String(n.conversationId) : null,
    });
  }

  /** Preferences for a user in ONE query, returned as a type→prefs map. */
  async preferencesFor(userId) {
    const rows = await this.client.from("notification_preferences")
      .select(["type", "in_app", "email", "push"])
      .eq("user_id", String(userId))
      .limit(MAX_LIMIT)
      .many();
    return new Map(rows.map((r) => [r.type, r]));
  }

  async setPreference(userId, type, prefs) {
    return this.client.from("notification_preferences").insert(
      { user_id: String(userId), type, ...prefs },
      { upsert: true, onConflict: "user_id,type" }
    );
  }

  async invalidate(userId) {
    if (!userId) return;
    try {
      const { cache } = require("../../services/cache.service");
      await cache.delPrefix(`notif:${userId}`);
    } catch { /* invalidation must never fail the request */ }
  }
}

module.exports = { NotificationRepository, NOTIFICATION_COLUMNS };
