/**
 * PostRepository (Supabase) (Phase 5 — §8, §13, §35–§38)
 * ─────────────────────────────────────────────────────────────────────────────
 * Mirrors the MongoDB PostRepository surface so Phase 6 can swap the barrel
 * entry without touching a controller (§66).
 *
 * Feed assembly keeps the shape the Mongo repository established:
 *   1. resolve the viewer's social graph ONCE (never per post),
 *   2. filter by visibility as a pure function of that context,
 *   3. attach counts from denormalised columns — not per-post queries.
 *
 * Step 3 is where the Postgres version is strictly better: `likes_count` and
 * `comments_count` are maintained by trigger on the posts row, so attaching
 * them costs ZERO extra queries. The Mongo version needed two aggregations
 * per page. That is the §13 argument for this migration in one sentence.
 */

"use strict";

const { BaseSupabaseRepository } = require("./base.repository");
const { decodeCursor, encodeCursor, MAX_LIMIT } = require("../cursor");

const POST_COLUMNS = [
  "id", "author_id", "content", "status", "visibility", "topics",
  "event_id", "organization_id", "community_id",
  "likes_count", "comments_count", "created_at",
];

function decodeAfter(raw) {
  const d = decodeCursor(raw);
  return d && d.at !== undefined && d.id !== undefined ? { sortValue: d.at, id: d.id } : null;
}
function encodeAfter(after) {
  return after ? encodeCursor({ at: after.sortValue, id: after.id }) : null;
}

class PostRepository extends BaseSupabaseRepository {
  constructor() { super({ table: "posts", sortColumn: "created_at" }); }

  /** One post with its counter columns already on the row. */
  async byId(id) {
    if (!id) return null;
    return this.first({
      columns: POST_COLUMNS,
      where: (q) => q.eq("id", String(id)).is("deleted_at", "null"),
    });
  }

  /**
   * The main feed. Visibility is applied server-side from a resolved context
   * — never trusted from the client (§14).
   */
  async feed({ limit, cursor: raw, visibility = ["public"] } = {}) {
    const q = this.query().select(POST_COLUMNS);
    q.eq("status", "published").is("deleted_at", "null");
    q.in("visibility", Array.isArray(visibility) ? visibility : [visibility]);

    const { rows, nextAfter, hasMore } = await q.paginate({
      after: decodeAfter(raw),
      limit: this.parseLimit(limit),
      sortColumn: "created_at",
      direction: "desc",
    });
    return { items: rows, nextCursor: encodeAfter(nextAfter), hasMore };
  }

  /** One author's timeline. */
  async byAuthor(authorId, { limit, cursor: raw } = {}) {
    const q = this.query().select(POST_COLUMNS);
    q.eq("author_id", String(authorId)).is("deleted_at", "null");

    const { rows, nextAfter, hasMore } = await q.paginate({
      after: decodeAfter(raw),
      limit: this.parseLimit(limit),
      sortColumn: "created_at",
      direction: "desc",
    });
    return { items: rows, nextCursor: encodeAfter(nextAfter), hasMore };
  }

  /** Posts attached to an event (event_id is a MongoDB id — no FK). */
  async byEvent(eventId, { limit, cursor: raw } = {}) {
    const q = this.query().select(POST_COLUMNS);
    q.eq("event_id", String(eventId)).is("deleted_at", "null");

    const { rows, nextAfter, hasMore } = await q.paginate({
      after: decodeAfter(raw),
      limit: this.parseLimit(limit),
      sortColumn: "created_at",
      direction: "desc",
    });
    return { items: rows, nextCursor: encodeAfter(nextAfter), hasMore };
  }

  /**
   * Attach viewer-specific flags (liked-by-me, saved-by-me) for a page of
   * posts in exactly TWO queries, regardless of page size.
   * The naive version is one query per post — the semi-N+1 the audit flagged.
   */
  async attachViewerState(posts, viewerId) {
    if (!viewerId || !posts.length) return posts;
    const ids = posts.map((p) => String(p.id));

    const [likes, saves] = await Promise.all([
      this.client.from("reactions").select(["post_id"]).in("post_id", ids).eq("user_id", String(viewerId)).limit(MAX_LIMIT).many(),
      this.client.from("saved_posts").select(["post_id"]).in("post_id", ids).eq("user_id", String(viewerId)).limit(MAX_LIMIT).many(),
    ]);

    const liked = new Set(likes.map((r) => String(r.post_id)));
    const saved = new Set(saves.map((r) => String(r.post_id)));
    return posts.map((p) => ({ ...p, likedByMe: liked.has(String(p.id)), savedByMe: saved.has(String(p.id)) }));
  }

  async create({ authorId, content, visibility = "public", status = "published", topics = [], eventId = null, organizationId = null, communityId = null }) {
    return this.insert({
      author_id: String(authorId),
      content: String(content || ""),
      visibility,
      status,
      topics,
      event_id: eventId ? String(eventId) : null,
      organization_id: organizationId ? String(organizationId) : null,
      community_id: communityId ? String(communityId) : null,
    });
  }

  async softDelete(id) {
    return this.update({ deleted_at: new Date().toISOString(), status: "deleted" }, {
      where: (q) => q.eq("id", String(id)),
    });
  }

  /** Media rows for many posts in ONE query (§21: binaries live in R2/Cloudinary). */
  async mediaFor(postIds) {
    const ids = [...new Set((postIds || []).map(String))].filter(Boolean);
    if (!ids.length) return new Map();
    const rows = await this.client.from("post_media")
      .select(["id", "post_id", "public_id", "url", "resource_type", "width", "height", "bytes", "position"])
      .in("post_id", ids.slice(0, MAX_LIMIT))
      .limit(MAX_LIMIT)
      .many();
    const out = new Map();
    for (const r of rows) {
      const k = String(r.post_id);
      if (!out.has(k)) out.set(k, []);
      out.get(k).push(r);
    }
    for (const list of out.values()) list.sort((a, b) => a.position - b.position);
    return out;
  }
}

/* ── Reactions ─────────────────────────────────────────────────────── */
class ReactionRepository extends BaseSupabaseRepository {
  constructor() { super({ table: "reactions", sortColumn: "created_at" }); }

  /** UNIQUE(post_id, user_id) makes this idempotent — no read-then-write. */
  async like(postId, userId) {
    return this.insert(
      { post_id: String(postId), user_id: String(userId), type: "like" },
      { upsert: true, onConflict: "post_id,user_id" }
    );
  }

  async unlike(postId, userId) {
    return this.deleteWhere({
      where: (q) => q.eq("post_id", String(postId)).eq("user_id", String(userId)),
    });
  }
}

/* ── Comments ──────────────────────────────────────────────────────── */
class CommentRepository extends BaseSupabaseRepository {
  constructor() { super({ table: "comments", sortColumn: "created_at" }); }

  /** A thread is oldest-first, so the keyset direction is ascending. */
  async forPost(postId, { limit, cursor: raw } = {}) {
    const q = this.query().select(["id", "post_id", "author_id", "content", "created_at"]);
    q.eq("post_id", String(postId)).is("deleted_at", "null");

    const { rows, nextAfter, hasMore } = await q.paginate({
      after: decodeAfter(raw),
      limit: this.parseLimit(limit),
      sortColumn: "created_at",
      direction: "asc",
    });
    return { items: rows, nextCursor: encodeAfter(nextAfter), hasMore };
  }

  async create({ postId, authorId, content }) {
    return this.insert({ post_id: String(postId), author_id: String(authorId), content: String(content || "") });
  }

  async softDelete(id, removedBy = null) {
    return this.update({ deleted_at: new Date().toISOString(), removed_by: removedBy ? String(removedBy) : null }, {
      where: (q) => q.eq("id", String(id)),
    });
  }
}

/* ── Saved posts ───────────────────────────────────────────────────── */
class SavedPostRepository extends BaseSupabaseRepository {
  constructor() { super({ table: "saved_posts", sortColumn: "created_at" }); }

  async save(postId, userId) {
    return this.insert(
      { post_id: String(postId), user_id: String(userId) },
      { upsert: true, onConflict: "post_id,user_id" }
    );
  }

  async unsave(postId, userId) {
    return this.deleteWhere({
      where: (q) => q.eq("post_id", String(postId)).eq("user_id", String(userId)),
    });
  }

  async forUser(userId, { limit, cursor: raw } = {}) {
    return this.paginate({
      columns: ["id", "post_id", "created_at"],
      limit, cursor: raw,
      where: (q) => q.eq("user_id", String(userId)),
    });
  }
}

module.exports = {
  PostRepository, ReactionRepository, CommentRepository, SavedPostRepository,
  POST_COLUMNS,
};
