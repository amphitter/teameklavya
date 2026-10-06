/**
 * ModerationRepository + AchievementRepository + EventInterestRepository
 * (Phase 5 — §8, §13)
 * ─────────────────────────────────────────────────────────────────────────────
 * Reports are polymorphic (post / comment / event / user), so `target_id`
 * cannot be a foreign key — the (target_type, target_id) pair is documented
 * rather than enforced by the database. `snapshot` preserves what was
 * reported at the time, because the target may be edited or deleted before a
 * moderator ever looks at it.
 */

"use strict";

const { BaseSupabaseRepository } = require("./base.repository");
const { decodeCursor, encodeCursor, MAX_LIMIT } = require("../cursor");

function decodeAfter(raw) {
  const d = decodeCursor(raw);
  return d && d.at !== undefined && d.id !== undefined ? { sortValue: d.at, id: d.id } : null;
}
function encodeAfter(after) {
  return after ? encodeCursor({ at: after.sortValue, id: after.id }) : null;
}

class ModerationRepository extends BaseSupabaseRepository {
  constructor() { super({ table: "reports", sortColumn: "created_at" }); }

  /**
   * UNIQUE(target_type, target_id, reporter_id) means re-reporting reopens
   * rather than stacking up duplicate rows in the moderator queue.
   */
  async report({ reporterId, targetType, targetId, reason, details = null, snapshot = null }) {
    return this.insert(
      {
        reporter_id: String(reporterId),
        target_type: targetType,
        target_id: String(targetId),
        reason,
        details,
        snapshot,
      },
      { upsert: true, onConflict: "target_type,target_id,reporter_id" }
    );
  }

  /** The moderation queue, keyset-paginated on (status, created_at, id). */
  async queue({ status = "open", limit, cursor: raw } = {}) {
    const q = this.query()
      .select(["id", "reporter_id", "target_type", "target_id", "reason", "details", "status", "created_at"]);
    q.eq("status", status);

    const { rows, nextAfter, hasMore } = await q.paginate({
      after: decodeAfter(raw),
      limit: this.parseLimit(limit),
      sortColumn: "created_at",
      direction: "desc",
    });
    return { items: rows, nextCursor: encodeAfter(nextAfter), hasMore };
  }

  async resolve(reportId, { status, resolution = null, resolvedBy }) {
    return this.update(
      {
        status,
        resolution,
        resolved_by: resolvedBy ? String(resolvedBy) : null,
        resolved_at: new Date().toISOString(),
      },
      { where: (q) => q.eq("id", String(reportId)) }
    );
  }

  async forTarget(targetType, targetId) {
    return this.query()
      .select(["id", "reporter_id", "reason", "status", "created_at"])
      .eq("target_type", targetType)
      .eq("target_id", String(targetId))
      .limit(MAX_LIMIT)
      .many();
  }
}

class AchievementRepository extends BaseSupabaseRepository {
  constructor() { super({ table: "user_achievements", sortColumn: "unlocked_at" }); }

  /**
   * UNIQUE(user_id, code) is what makes awarding idempotent — a code unlocks
   * once, ever. That constraint is why the award path needs no distributed
   * lock (Phase 4 documented this as a deliberate omission).
   */
  async unlock(userId, code) {
    return this.insert(
      { user_id: String(userId), code },
      { upsert: true, onConflict: "user_id,code" }
    );
  }

  async forUser(userId, { limit } = {}) {
    const size = this.parseLimit(limit, { def: 50 });
    return this.query()
      .select(["id", "code", "unlocked_at"])
      .eq("user_id", String(userId))
      .order("unlocked_at.desc")
      .limit(size)
      .many();
  }

  async catalogue() {
    return this.client.from("achievements")
      .select(["code", "title", "description", "icon", "category", "points"])
      .limit(MAX_LIMIT)
      .many();
  }
}

/**
 * Event interests. `event_id` is a MongoDB id, so there is no FK — the
 * (event_id, user_id) unique constraint is what prevents duplicate interest.
 */
class EventInterestRepository extends BaseSupabaseRepository {
  constructor() { super({ table: "event_interests", sortColumn: "created_at" }); }

  async add(eventId, userId) {
    return this.insert(
      { event_id: String(eventId), user_id: String(userId) },
      { upsert: true, onConflict: "event_id,user_id" }
    );
  }

  async remove(eventId, userId) {
    return this.deleteWhere({
      where: (q) => q.eq("event_id", String(eventId)).eq("user_id", String(userId)),
    });
  }

  /** Batched counts for many events in ONE query (§13). */
  async countsFor(eventIds) {
    const ids = [...new Set((eventIds || []).map(String))].filter(Boolean);
    if (!ids.length) return new Map();
    const rows = await this.query()
      .select(["event_id"])
      .in("event_id", ids.slice(0, MAX_LIMIT))
      .limit(MAX_LIMIT)
      .many();
    const out = new Map(ids.map((id) => [id, 0]));
    for (const r of rows) {
      const k = String(r.event_id);
      if (out.has(k)) out.set(k, out.get(k) + 1);
    }
    return out;
  }
}

module.exports = { ModerationRepository, AchievementRepository, EventInterestRepository };
