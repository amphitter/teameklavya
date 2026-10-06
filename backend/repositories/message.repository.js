/**
 * MessageRepository (Part 5, Phase 3 — spec §4, §7, §36)
 * ────────────────────────────────────────────────────────
 * SOCIAL DOMAIN (messaging). Owns conversation + message reads.
 *
 * Batching fix (§36): the inbox renders a row per conversation, and each row
 * needs an unread badge. The naive shape is one count query per conversation
 * — an N+1 that grows with how many people you talk to. Here the unread
 * counts for the WHOLE page come from a single `$group` aggregation keyed by
 * conversation, so the inbox is a fixed number of queries regardless of page
 * size.
 *
 * Cursors everywhere (§7): message history is unbounded and scrolling it with
 * OFFSET would degrade linearly.
 */

const Conversation = require("../models/conversation.model");
const Message = require("../models/message.model");
const { cache } = require("../services/cache.service");
const { parseLimit, buildPage, withCursor } = require("./cursor");

/** Inbox row fields — enough to render the list, nothing more (§6). */
const CONVERSATION_FIELDS = "participants lastMessage updatedAt createdAt";
const MESSAGE_FIELDS = "_id conversation sender content image createdAt readAt deletedAt";
const PARTICIPANT_FIELDS = "firstName lastName username profile.avatar";

/** Short TTL: unread counts are personal and change constantly. */
const UNREAD_TTL = 15 * 1000;

/**
 * Inbox page: conversations + batched unread counts (2 queries total).
 * The unread aggregation excludes the viewer's own messages and soft-deleted
 * rows, matching what the UI counts as unread.
 */
async function listConversations({ userId, limit, cursor }) {
  const size = parseLimit(limit, { def: 20, max: 50 });
  const filter = withCursor({ participants: userId }, cursor);

  const rows = await Conversation.find(filter)
    .select(CONVERSATION_FIELDS)
    .populate("participants", PARTICIPANT_FIELDS)
    .sort({ updatedAt: -1, _id: -1 })
    .limit(size + 1)
    .lean();

  const page = buildPage(rows, size);
  if (!page.items.length) return page;

  // ONE aggregation for every conversation on the page (§36)
  const ids = page.items.map((c) => c._id);
  const unread = await Message.aggregate([
    {
      $match: {
        conversation: { $in: ids },
        sender: { $ne: userId },
        readAt: null,
        deletedAt: null,
      },
    },
    { $group: { _id: "$conversation", count: { $sum: 1 } } },
  ]);
  const unreadMap = new Map(unread.map((r) => [String(r._id), r.count]));

  return {
    ...page,
    items: page.items.map((c) => ({ ...c, unreadCount: unreadMap.get(String(c._id)) || 0 })),
  };
}

/** Paginated message history for one conversation (newest first). */
async function listMessages({ conversationId, limit, cursor }) {
  const size = parseLimit(limit, { def: 30, max: 100 });
  const filter = withCursor({ conversation: conversationId, deletedAt: null }, cursor);

  const rows = await Message.find(filter)
    .select(MESSAGE_FIELDS)
    .populate("sender", PARTICIPANT_FIELDS)
    .sort({ createdAt: -1, _id: -1 })
    .limit(size + 1)
    .lean();

  return buildPage(rows, size);
}

/**
 * Total unread across all conversations — cached very briefly.
 * This backs the header badge that the frontend polls; the short TTL keeps
 * polling cheap without letting the badge lie for long (§12, §37).
 */
function unreadTotal(userId) {
  return cache.getOrSet(
    `msg:unread:${userId}`,
    async () => {
      const conversations = await Conversation.find({ participants: userId }).select("_id").lean();
      if (!conversations.length) return 0;
      const ids = conversations.map((c) => c._id);
      return Message.countDocuments({
        conversation: { $in: ids },
        sender: { $ne: userId },
        readAt: null,
        deletedAt: null,
      });
    },
    { ttl: UNREAD_TTL }
  );
}

/** Drop cached unread state after a send/read (§13). */
async function invalidate(userId) {
  if (userId) {
    try {
      await cache.invalidate(keys.unreadMessages(userId));
    } catch (err) {
      console.warn("[cache] invalidation failed:", err?.message || err);
    }
  }
}

module.exports = {
  MessageRepository: { listConversations, listMessages, unreadTotal, invalidate },
  CONVERSATION_FIELDS,
  MESSAGE_FIELDS,
  PARTICIPANT_FIELDS,
};
