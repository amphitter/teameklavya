/**
 * CommunityRepository (Phase 5 — §8)
 * ─────────────────────────────────────────────────────────────────────────────
 * Mirrors the MongoDB CommunityRepository surface: publicBySlug, memberCount,
 * listMembers, listForUser, invalidate (§66).
 */

"use strict";

const { BaseSupabaseRepository } = require("./base.repository");
const { decodeCursor, encodeCursor, MAX_LIMIT } = require("../cursor");

const COMMUNITY_COLUMNS = [
  "id", "name", "description", "avatar_url", "join_policy", "status",
  "affiliation_domain", "official_organization", "created_by", "created_at",
];

function decodeAfter(raw) {
  const d = decodeCursor(raw);
  return d && d.at !== undefined && d.id !== undefined ? { sortValue: d.at, id: d.id } : null;
}
function encodeAfter(after) {
  return after ? encodeCursor({ at: after.sortValue, id: after.id }) : null;
}

class CommunityRepository extends BaseSupabaseRepository {
  constructor() { super({ table: "communities", sortColumn: "created_at" }); }

  async publicBySlug(slug) {
    // Communities are addressed by name-derived slug in the existing API; the
    // table keeps the canonical name and the API layer resolves it.
    if (!slug) return null;
    return this.first({
      columns: COMMUNITY_COLUMNS,
      where: (q) => q.eq("name", slug).is("deleted_at", "null"),
    });
  }

  async publicById(id) {
    if (!id) return null;
    return this.first({
      columns: COMMUNITY_COLUMNS,
      where: (q) => q.eq("id", String(id)).is("deleted_at", "null"),
    });
  }

  /**
   * Member counts for many communities in ONE query (§13).
   * The naive version counts per community: a 50-community page costs 50
   * round trips and is the classic N+1 the audit flagged.
   */
  async memberCounts(communityIds) {
    const ids = [...new Set((communityIds || []).map(String))].filter(Boolean);
    if (!ids.length) return new Map();
    const capped = ids.slice(0, MAX_LIMIT);

    const rows = await this.client.from("community_members")
      .select(["community_id"])
      .in("community_id", capped)
      .eq("status", "active")
      .limit(MAX_LIMIT)
      .many();

    const out = new Map(capped.map((id) => [id, 0]));
    for (const r of rows) {
      const k = String(r.community_id);
      if (out.has(k)) out.set(k, out.get(k) + 1);
    }
    return out;
  }

  async memberCount(communityId) {
    const counts = await this.memberCounts([communityId]);
    return counts.get(String(communityId)) || 0;
  }

  async listMembers(communityId, { limit, cursor: raw, status = "active" } = {}) {
    const q = this.client.from("community_members")
      .select(["id", "community_id", "user_id", "role", "status", "created_at"]);
    q.eq("community_id", String(communityId)).eq("status", status);

    const { rows, nextAfter, hasMore } = await q.paginate({
      after: decodeAfter(raw),
      limit: this.parseLimit(limit),
      sortColumn: "created_at",
      direction: "desc",
    });
    return { items: rows, nextCursor: encodeAfter(nextAfter), hasMore };
  }

  /** Communities this user belongs to. */
  async listForUser(userId, { limit, cursor: raw } = {}) {
    const q = this.client.from("community_members")
      .select(["community_id", "role", "status", "created_at"])
      .eq("user_id", String(userId))
      .eq("status", "active");

    const { rows, nextAfter, hasMore } = await q.paginate({
      after: decodeAfter(raw),
      limit: this.parseLimit(limit),
      sortColumn: "created_at",
      direction: "desc",
    });
    return { items: rows, nextCursor: encodeAfter(nextAfter), hasMore };
  }

  /**
   * Membership write. UNIQUE (community_id, user_id) makes a double join
   * idempotent — no lock needed, which is why Phase 4 did not lock this path.
   */
  async join(communityId, userId, { role = "member", status = "active" } = {}) {
    return this.client.from("community_members").insert(
      { community_id: String(communityId), user_id: String(userId), role, status },
      { upsert: true, onConflict: "community_id,user_id" }
    );
  }

  async leave(communityId, userId) {
    const q = this.client.from("community_members");
    q.eq("community_id", String(communityId)).eq("user_id", String(userId));
    return q.delete({ returning: false });
  }

  async invalidate(communityId) {
    if (!communityId) return;
    try {
      const { cache } = require("../../services/cache.service");
      await cache.delPrefix(`community:${communityId}`);
    } catch { /* invalidation must never fail the request */ }
  }
}

module.exports = { CommunityRepository, COMMUNITY_COLUMNS };
