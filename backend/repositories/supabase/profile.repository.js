/**
 * ProfileRepository / FollowRepository / BlockRepository (Phase 5 — §8, §9)
 * ─────────────────────────────────────────────────────────────────────────────
 * §9 GLOBAL IDENTITY: `profiles.id` IS the EventHub user id — the same 24-char
 * identifier MongoDB uses. These repositories never mint an id, never map
 * between ids, and never create a second identity. A user row is created by
 * upserting on the canonical id, which makes the write idempotent and makes
 * backfill safely re-runnable (§11).
 */

"use strict";

const { BaseSupabaseRepository } = require("./base.repository");

const PROFILE_COLUMNS = [
  "id", "username", "first_name", "last_name", "avatar_url", "bio",
  "institution", "course", "year", "location", "interests",
  "role", "profile_visibility", "followers_count", "following_count",
  "posts_count", "created_at",
];

class ProfileRepository extends BaseSupabaseRepository {
  constructor() { super({ table: "profiles", sortColumn: "created_at" }); }

  /**
   * Idempotent upsert on the canonical EventHub id.
   * Safe to replay: the same user backfilled twice is one row.
   */
  async upsert(profile) {
    return this.insert({ ...profile, id: String(profile.id) }, {
      upsert: true,
      onConflict: "id",
    });
  }

  async byId(id, columns = PROFILE_COLUMNS) {
    return this.first({ columns, where: (q) => q.eq("id", String(id)) });
  }

  async byUsername(username, columns = PROFILE_COLUMNS) {
    return this.first({ columns, where: (q) => q.eq("username", username) });
  }

  /** Batched lookup — one query for N profiles, never N queries (§13). */
  async byIds(ids, columns = PROFILE_COLUMNS) {
    const unique = [...new Set((ids || []).map(String))].filter(Boolean);
    if (!unique.length) return [];
    const q = this.query().select(columns).in("id", unique).limit(unique.length);
    return q.many();
  }

  /**
   * Name/username search. Backed by the trigram indexes in schema.sql, so it
   * is index-assisted rather than a sequential scan with ILIKE.
   */
  async search(term, { limit } = {}) {
    const q = String(term || "").trim();
    if (!q) return { items: [], nextCursor: null, hasMore: false };
    const size = this.parseLimit(limit);
    const rows = await this.query()
      .select(PROFILE_COLUMNS)
      .orNameMatch(q)
      .limit(size)
      .many();
    return { items: rows, nextCursor: null, hasMore: false };
  }

  /** Soft delete — the row survives for moderation/restore. */
  async softDelete(id) {
    return this.update({ deleted_at: new Date().toISOString() }, {
      where: (q) => q.eq("id", String(id)),
    });
  }
}

class FollowRepository extends BaseSupabaseRepository {
  constructor() { super({ table: "follows", sortColumn: "created_at" }); }

  /**
   * The follow edge is UNIQUE on (follower, followee), so this write is
   * idempotent: a double-tap cannot create two rows and inflate the counter.
   */
  async follow(followerId, followeeId, { status = "accepted" } = {}) {
    if (String(followerId) === String(followeeId)) return null; // no self-follow
    return this.insert(
      { follower_id: String(followerId), followee_id: String(followeeId), status },
      { upsert: true, onConflict: "follower_id,followee_id" }
    );
  }

  async unfollow(followerId, followeeId) {
    return this.deleteWhere({
      where: (q) => q.eq("follower_id", String(followerId)).eq("followee_id", String(followeeId)),
    });
  }

  /** Who follows this user — the expensive direction, index-backed. */
  async followers(userId, { limit, cursor: raw } = {}) {
    return this.paginate({
      columns: ["id", "follower_id", "status", "created_at"],
      limit, cursor: raw,
      where: (q) => q.eq("followee_id", String(userId)).eq("status", "accepted"),
    });
  }

  /** Who this user follows. */
  async following(userId, { limit, cursor: raw } = {}) {
    return this.paginate({
      columns: ["id", "followee_id", "status", "created_at"],
      limit, cursor: raw,
      where: (q) => q.eq("follower_id", String(userId)).eq("status", "accepted"),
    });
  }

  async pendingRequests(userId, { limit, cursor: raw } = {}) {
    return this.paginate({
      columns: ["id", "follower_id", "created_at"],
      limit, cursor: raw,
      where: (q) => q.eq("followee_id", String(userId)).eq("status", "pending"),
    });
  }

  /**
   * The whole follow list in ONE query, bounded by MAX_LIMIT.
   * This is what replaces the three duplicate `Follow.find({follower})`
   * queries the audit flagged — resolved once, then reused (§13).
   */
  async followingIds(userId) {
    const rows = await this.query()
      .select(["followee_id"])
      .eq("follower_id", String(userId))
      .eq("status", "accepted")
      .limit(require("../cursor").MAX_LIMIT)
      .many();
    return rows.map((r) => String(r.followee_id));
  }

  async isFollowing(followerId, followeeId) {
    return this.exists({
      where: (q) =>
        q.eq("follower_id", String(followerId))
         .eq("followee_id", String(followeeId))
         .eq("status", "accepted"),
    });
  }

  async accept(followerId, followeeId) {
    return this.update({ status: "accepted" }, {
      where: (q) => q.eq("follower_id", String(followerId)).eq("followee_id", String(followeeId)),
    });
  }
}

class BlockRepository extends BaseSupabaseRepository {
  constructor() { super({ table: "blocks", sortColumn: "created_at" }); }

  async block(blockerId, blockedId) {
    if (String(blockerId) === String(blockedId)) return null;
    return this.insert(
      { blocker_id: String(blockerId), blocked_id: String(blockedId) },
      { upsert: true, onConflict: "blocker_id,blocked_id" }
    );
  }

  async unblock(blockerId, blockedId) {
    return this.deleteWhere({
      where: (q) => q.eq("blocker_id", String(blockerId)).eq("blocked_id", String(blockedId)),
    });
  }

  /**
   * Has either party blocked the other? Checked before any direct message —
   * a block is symmetric in effect even though it is stored one-way.
   */
  async eitherBlocks(a, b) {
    // Two bounded reads, not N. PostgREST `or` needs one composite filter
    // expression, and composing it here would be less readable than the two
    // index-backed existence checks it would replace.
    const forward = await this.exists({
      where: (q) => q.eq("blocker_id", String(a)).eq("blocked_id", String(b)),
    });
    if (forward) return true;
    return this.exists({
      where: (q) => q.eq("blocker_id", String(b)).eq("blocked_id", String(a)),
    });
  }

  async blockedIds(blockerId) {
    const rows = await this.query()
      .select(["blocked_id"])
      .eq("blocker_id", String(blockerId))
      .limit(require("../cursor").MAX_LIMIT)
      .many();
    return rows.map((r) => String(r.blocked_id));
  }
}

module.exports = { ProfileRepository, FollowRepository, BlockRepository, PROFILE_COLUMNS };
