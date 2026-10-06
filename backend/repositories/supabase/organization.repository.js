/**
 * OrganizationRepository (Phase 5 — §8)
 * ─────────────────────────────────────────────────────────────────────────────
 * Mirrors the MongoDB OrganizationRepository surface (publicBySlug, counts,
 * listFollowers, invalidate) so Phase 6 can swap the barrel entry without
 * touching a controller (§66).
 */

"use strict";

const { BaseSupabaseRepository } = require("./base.repository");

const ORG_COLUMNS = [
  "id", "name", "slug", "description", "logo_url", "cover_url",
  "website", "created_by", "verified_at", "created_at",
];

class OrganizationRepository extends BaseSupabaseRepository {
  constructor() { super({ table: "organizations", sortColumn: "created_at" }); }

  async publicBySlug(slug) {
    if (!slug) return null;
    return this.first({
      columns: ORG_COLUMNS,
      where: (q) => q.eq("slug", slug).is("deleted_at", "null"),
    });
  }

  async publicById(id) {
    if (!id) return null;
    return this.first({
      columns: ORG_COLUMNS,
      where: (q) => q.eq("id", String(id)).is("deleted_at", "null"),
    });
  }

  /**
   * Batched counts for many organizations in ONE query.
   * This is the §13 fix for the "counts in a loop" pattern: the naive version
   * issues 2 queries per org and an N-org page costs 2N round trips.
   */
  async counts(orgIds) {
    const ids = [...new Set((orgIds || []).map(String))].filter(Boolean);
    if (!ids.length) return new Map();

    const { MAX_LIMIT } = require("../cursor");
    const capped = ids.slice(0, MAX_LIMIT);

    const [followers, members] = await Promise.all([
      this.client.from("org_follows")
        .select(["organization_id"])
        .in("organization_id", capped)
        .limit(MAX_LIMIT)
        .many(),
      this.client.from("org_members")
        .select(["organization_id"])
        .in("organization_id", capped)
        .limit(MAX_LIMIT)
        .many(),
    ]);

    const out = new Map();
    for (const id of capped) out.set(id, { followers: 0, members: 0 });
    for (const r of followers) {
      const k = String(r.organization_id);
      if (out.has(k)) out.get(k).followers += 1;
    }
    for (const r of members) {
      const k = String(r.organization_id);
      if (out.has(k)) out.get(k).members += 1;
    }
    return out;
  }

  /** Followers of one organization, keyset-paginated. */
  async listFollowers(orgId, { limit, cursor: raw } = {}) {
    return this.client.from("org_follows").paginate({
      after: decodeAfter(raw),
      limit: this.parseLimit(limit),
      sortColumn: "created_at",
      direction: "desc",
    }).then(({ rows, nextAfter, hasMore }) => ({
      items: rows,
      nextCursor: encodeAfter(nextAfter),
      hasMore,
    }));
  }

  async follow(userId, orgId) {
    return this.client.from("org_follows").insert(
      { user_id: String(userId), organization_id: String(orgId) },
      { upsert: true, onConflict: "user_id,organization_id" }
    );
  }

  async unfollow(userId, orgId) {
    const q = this.client.from("org_follows");
    q.eq("user_id", String(userId)).eq("organization_id", String(orgId));
    return q.delete({ returning: false });
  }

  /**
   * Cache invalidation. Redis owns the cache; this exists so the call sites
   * match the Mongo repository surface and Phase 6 can swap implementations.
   */
  async invalidate(orgId) {
    if (!orgId) return;
    try {
      const { cache } = require("../../services/cache.service");
      await cache.delPrefix(`org:${orgId}`);
    } catch {
      /* cache invalidation must never fail the request */
    }
  }
}

/* Cursor helpers — the SHARED codec, so this is wire-identical to Mongo. */
const { decodeCursor, encodeCursor } = require("../cursor");
function decodeAfter(raw) {
  const d = decodeCursor(raw);
  return d && d.at !== undefined && d.id !== undefined ? { sortValue: d.at, id: d.id } : null;
}
function encodeAfter(after) {
  return after ? encodeCursor({ at: after.sortValue, id: after.id }) : null;
}

module.exports = { OrganizationRepository, ORG_COLUMNS };
