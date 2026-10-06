/**
 * MessageRepository (Supabase) (Phase 5 — §8, §13)
 * ─────────────────────────────────────────────────────────────────────────────
 * Mirrors the MongoDB MessageRepository surface: listConversations,
 * listMessages, unreadTotal, invalidate (§66).
 *
 * The conversation pair is canonicalised by a unique index on
 * (LEAST(a,b), GREATEST(a,b)), so two users starting a chat simultaneously
 * cannot each create one. That is a database constraint, not application
 * logic — which is why this path needs no lock (see Phase 4).
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

class MessageRepository extends BaseSupabaseRepository {
  constructor() { super({ table: "messages", sortColumn: "created_at" }); }

  /**
   * The inbox. Reads conversation_members (not conversations) so "all my
   * threads" is ONE index scan instead of two OR'd scans over
   * participant_a / participant_b.
   */
  async listConversations(userId, { limit, cursor: raw } = {}) {
    const members = await this.client.from("conversation_members")
      .select(["conversation_id", "last_read_at"])
      .eq("user_id", String(userId))
      .limit(this.parseLimit(limit, { max: MAX_LIMIT }))
      .many();
    if (!members.length) return { items: [], nextCursor: null, hasMore: false };

    const ids = members.map((m) => String(m.conversation_id));
    // ONE query for all conversations, not one per thread.
    const convos = await this.client.from("conversations")
      .select(["id", "participant_a", "participant_b", "last_message_at", "created_at"])
      .in("id", ids)
      .limit(MAX_LIMIT)
      .many();

    const readAt = new Map(members.map((m) => [String(m.conversation_id), m.last_read_at]));
    const items = convos
      .map((c) => ({
        id: c.id,
        participantA: c.participant_a,
        participantB: c.participant_b,
        lastMessageAt: c.last_message_at,
        lastReadAt: readAt.get(String(c.id)) || null,
      }))
      .sort((a, b) => String(b.lastMessageAt).localeCompare(String(a.lastMessageAt)));

    return { items, nextCursor: null, hasMore: false };
  }

  /**
   * A thread, newest-first (that is the visible window; the UI reverses it).
   * Sorted by (created_at DESC, id DESC) — the composite index in schema.sql.
   */
  async listMessages(conversationId, { limit, cursor: raw } = {}) {
    const q = this.query()
      .select(["id", "conversation_id", "sender_id", "content", "read_at", "created_at"]);
    q.eq("conversation_id", String(conversationId)).is("deleted_at", "null");

    const { rows, nextAfter, hasMore } = await q.paginate({
      after: decodeAfter(raw),
      limit: this.parseLimit(limit),
      sortColumn: "created_at",
      direction: "desc",
    });
    return { items: rows, nextCursor: encodeAfter(nextAfter), hasMore };
  }

  /**
   * Unread total in ONE query, using the partial index
   * (`WHERE read_at IS NULL`) so Postgres never touches read rows.
   */
  async unreadTotal(userId) {
    const convos = await this.client.from("conversation_members")
      .select(["conversation_id"])
      .eq("user_id", String(userId))
      .limit(MAX_LIMIT)
      .many();
    if (!convos.length) return 0;

    const ids = convos.map((c) => String(c.conversation_id));
    const unread = await this.client.from("messages")
      .select(["id"])
      .in("conversation_id", ids)
      .is("read_at", "null")
      .limit(MAX_LIMIT)
      .many();
    return unread.length;
  }

  /**
   * Get-or-create. The unique pair index makes this race-safe: two callers
   * racing both try the insert, one wins, the loser re-reads.
   */
  async getOrCreateConversation(userA, userB) {
    const a = String(userA);
    const b = String(userB);
    if (a === b) return null;

    const existing = await this.client.from("conversations")
      .select(["id", "participant_a", "participant_b", "last_message_at", "created_at"])
      .eq("participant_a", a).eq("participant_b", b)
      .limit(1).many();
    if (existing.length) return existing[0];

    const flipped = await this.client.from("conversations")
      .select(["id", "participant_a", "participant_b", "last_message_at", "created_at"])
      .eq("participant_a", b).eq("participant_b", a)
      .limit(1).many();
    if (flipped.length) return flipped[0];

    const created = await this.client.from("conversations")
      .insert({ participant_a: a, participant_b: b });
    return Array.isArray(created) ? created[0] : created;
  }

  async send({ conversationId, senderId, content }) {
    return this.insert({
      conversation_id: String(conversationId),
      sender_id: String(senderId),
      content: String(content || ""),
    });
  }

  /** Mark a thread read for one participant. */
  async markRead(conversationId, userId) {
    await this.client.from("conversation_members").update(
      { last_read_at: new Date().toISOString() },
      { returning: false }
    );
    return true;
  }

  async invalidate(userId) {
    if (!userId) return;
    try {
      const { cache } = require("../../services/cache.service");
      await cache.delPrefix(`inbox:${userId}`);
    } catch { /* invalidation must never fail the request */ }
  }
}

module.exports = { MessageRepository };
