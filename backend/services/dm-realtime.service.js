/**
 * EventHub DM Realtime (Part 10 §12, §13, §14, §28)
 * ─────────────────────────────────────────────────
 * Direct messages had NO realtime before this. The client polled the thread
 * every 6 s and the inbox every 12 s, which is why the UI felt slow, why an
 * optimistic bubble vanished on the next poll, and why every message cost a
 * full refetch of the conversation.
 *
 * ── ROOM DESIGN: one room per USER, not per conversation ────────────────
 * Every socket joins `user:{id}` on connect. DM events fan out to the two
 * participants' user rooms. This is deliberately NOT `dm:{conversationId}`
 * with join/leave bookkeeping, for three reasons:
 *
 *   1. The inbox needs events from conversations the user is NOT currently
 *      reading. A conversation-scoped room cannot deliver those, so we would
 *      need the user room anyway — this is the smaller system.
 *   2. No join/leave state to leak. A client that forgets `dm:leave` (crash,
 *      killed tab) would keep receiving another thread's typing events
 *      forever. User rooms are derived from the authenticated socket, so
 *      there is nothing to forget.
 *   3. Multi-device works for free: every tab and phone the user has open
 *      is in the room, so sending from one updates the others.
 *
 * The client routes by `conversationId`: matching the open thread → append;
 * anything else → update the list row and the unread badge (§12).
 *
 * ── WHAT IS DELIBERATELY NOT HERE ───────────────────────────────────────
 *   • No DB write for typing (§13). Typing is pure socket, debounced by the
 *     client, and self-expiring here so a missed `typing:false` cannot leave
 *     a permanent "typing…".
 *   • No per-message read receipt write (§14). Reads are batched by the
 *     caller into one updateMany, and this module only ANNOUNCES the result.
 *   • No separate io instance and no new adapter (§22 — the Redis adapter is
 *     not auto-deployed). This attaches to the single existing Socket.IO
 *     server owned by realtime.service.js.
 */
const Conversation = require("../models/conversation.model");
const Message = require("../models/message.model");
const User = require("../models/user.model");

const { EVENTS } = require("../config/socket-protocol");

/** How long a typing signal survives without a refresh, in ms (§13). */
const TYPING_TTL_MS = 6000;

let io = null;

/** userId → count of live sockets, so we can tell "app is open" from "gone". */
const connectedUsers = new Map();

/** `${userId}:${conversationId}` → timeout handle for the typing expiry. */
const typingTimers = new Map();

function userRoomKey(userId) {
  return `user:${String(userId)}`;
}

/** Attach to the one Socket.IO server. Called from realtime.service init. */
function attach(socketIo) {
  io = socketIo;
  console.log("✅ DM realtime attached (user rooms)");
}

/**
 * Join a socket to its own user room. Called on EVERY connect, including
 * reconnects — Socket.IO re-runs the connection handler, so a reconnect
 * re-joins automatically and no replay bookkeeping is needed (§28).
 */
function joinUserRoom(socket) {
  const uid = socket.data?.user?.id;
  if (!uid) return null;
  socket.join(userRoomKey(uid));
  connectedUsers.set(uid, (connectedUsers.get(uid) || 0) + 1);
  return userRoomKey(uid);
}

function leaveUserRoom(socket) {
  const uid = socket.data?.user?.id;
  if (!uid) return;
  const next = (connectedUsers.get(uid) || 0) - 1;
  if (next <= 0) connectedUsers.delete(uid);
  else connectedUsers.set(uid, next);
}

/** Is this user holding at least one open socket? (diagnostics + tests) */
function isUserConnected(userId) {
  return connectedUsers.has(String(userId));
}

/* ── Wire shapes ─────────────────────────────────────────────────────────
 * Only what a client needs to render a row. The whole message document is
 * never broadcast: `reactions` (per-user), `__v` and the raw ObjectId graph
 * would inflate every event and leak other participants' identifiers. */
function wireMessage(doc) {
  return {
    _id: String(doc._id),
    conversationId: String(doc.conversation),
    senderId: String(doc.sender?._id || doc.sender),
    content: doc.content || "",
    image: doc.image || "",
    attachment: doc.attachment?.url
      ? {
          url: doc.attachment.url,
          name: doc.attachment.name || "",
          size: doc.attachment.size || 0,
          mime: doc.attachment.mime || "",
        }
      : undefined,
    replyTo: doc.replyTo ? String(doc.replyTo) : null,
    clientMessageId: doc.clientMessageId || null,
    createdAt: doc.createdAt,
    deletedAt: doc.deletedAt || null,
  };
}

function emitToUser(userId, event, payload) {
  if (!io) return false;
  io.to(userRoomKey(userId)).emit(event, payload);
  return true;
}

/**
 * Announce a newly persisted message to both participants.
 *
 * Called AFTER the message is committed, so a client that reacts by fetching
 * can never read a message the database does not have yet. The sender's own
 * other devices get it too, which is how a chat stays in sync across a phone
 * and a laptop.
 */
function publishMessage({ conversation, message, recipientId, senderId }) {
  const payload = {
    conversationId: String(conversation._id),
    message: wireMessage(message),
    // The archived flag is per-recipient: the same event must tell the
    // recipient "this thread is archived for you" without telling the sender
    // anything about the other person's inbox (§24).
    recipientArchived: (conversation.archivedBy || []).some((m) => String(m) === String(recipientId)),
    senderArchived: (conversation.archivedBy || []).some((m) => String(m) === String(senderId)),
    // Preview for the inbox row, so a list update needs zero extra requests.
    preview: {
      text: (message.content || "Photo").slice(0, 200),
      at: message.createdAt || new Date(),
      senderId: String(senderId),
    },
  };
  emitToUser(recipientId, EVENTS.S_DM_MESSAGE, payload);
  emitToUser(senderId, EVENTS.S_DM_MESSAGE, { ...payload, self: true });
  return payload;
}

/**
 * Typing signal. Never touches the database (§13).
 *
 * Expires itself after TYPING_TTL_MS. The client sends `false` when the box
 * empties or the message is sent, but a client that is killed mid-typing can
 * never send that — so without this timer the peer would sit on a permanent
 * "typing…". The timer is keyed by user+conversation and reset on every
 * signal, so a continuously typing user keeps their indicator alive.
 */
function publishTyping({ conversationId, fromUserId, toUserId, typing }) {
  const key = `${toUserId}:${conversationId}`;
  const existing = typingTimers.get(key);
  if (existing) clearTimeout(existing);

  emitToUser(toUserId, EVENTS.S_DM_TYPING, {
    conversationId: String(conversationId),
    userId: String(fromUserId),
    typing: Boolean(typing),
  });

  if (typing) {
    typingTimers.set(
      key,
      setTimeout(() => {
        typingTimers.delete(key);
        emitToUser(toUserId, EVENTS.S_DM_TYPING, {
          conversationId: String(conversationId),
          userId: String(fromUserId),
          typing: false,
          expired: true,
        });
      }, TYPING_TTL_MS)
    );
  } else {
    typingTimers.delete(key);
  }
}

/**
 * Announce that a participant's messages were read (§14).
 *
 * The write already happened — one batched updateMany in the controller.
 * This only tells the other side so their ticks turn to "read" without a
 * refetch. `at` is the timestamp the batch was applied at.
 */
function publishRead({ conversationId, readerId, otherId, at }) {
  emitToUser(otherId, EVENTS.S_DM_READ, {
    conversationId: String(conversationId),
    readerId: String(readerId),
    at,
  });
  // The reader's own other devices also need to hear it, so a second tab
  // that showed the same unread badge clears it.
  emitToUser(readerId, EVENTS.S_DM_READ, {
    conversationId: String(conversationId),
    readerId: String(readerId),
    at,
    self: true,
  });
}

/** A message was unsent — the peer must drop its content too. */
function publishDeleted({ conversationId, messageId, fromUserId, otherId }) {
  const payload = { conversationId: String(conversationId), messageId: String(messageId) };
  emitToUser(otherId, EVENTS.S_DM_DELETED, payload);
  emitToUser(fromUserId, EVENTS.S_DM_DELETED, { ...payload, self: true });
}

/* ── Socket handlers ─────────────────────────────────────────────────────
 * Registered per connection from realtime.service's registerHandlers.
 * Every handler re-derives the user from socket.data (never from the
 * payload — §80) and re-checks participation against the database, because
 * a socket that joined a room before being blocked or removed from a
 * conversation must not be able to keep writing to it.
 */
function registerDmHandlers(socket, { rateLimit }) {
  const me = socket.data?.user?.id;
  if (!me) return;

  /** Shared authorization: am I a participant of this conversation? */
  const participantOf = async (conversationId) => {
    if (!conversationId) return null;
    return Conversation.findOne({ _id: conversationId, participants: me }).select("participants").lean();
  };

  /* dm:typing { conversationId, typing }
   * Rate limited per socket: a client that ignores the debounce guidance
   * cannot turn typing into a flood. Never persisted. */
  socket.on(EVENTS.C_DM_TYPING, async (payload = {}) => {
    try {
      if (rateLimit && !rateLimit()) return;
      const convo = await participantOf(payload.conversationId);
      if (!convo) return; // silently ignore — not a participant
      const otherId = convo.participants.find((p) => String(p) !== String(me));
      if (!otherId) return;
      publishTyping({
        conversationId: convo._id,
        fromUserId: me,
        toUserId: otherId,
        typing: Boolean(payload.typing),
      });
    } catch {
      /* typing is best-effort; a failure must never surface as an error */
    }
  });

  /* dm:read { conversationId }
   * The batched write lives in the REST controller (POST /:id/read) so the
   * HTTP path and the socket path cannot drift apart. This handler exists so
   * the client can fire-and-forget without a request when the thread is
   * already open — and it still writes, because a read receipt the peer
   * never hears about is worse than no receipt. */
  socket.on(EVENTS.C_DM_READ, async (payload = {}) => {
    try {
      const convo = await participantOf(payload.conversationId);
      if (!convo) return;
      const at = new Date();
      await Message.updateMany(
        { conversation: convo._id, sender: { $ne: me }, readAt: null },
        { readAt: at }
      );
      const otherId = convo.participants.find((p) => String(p) !== String(me));
      if (otherId) publishRead({ conversationId: convo._id, readerId: me, otherId, at });
    } catch (e) {
      console.error("dm:read failed:", e.message);
    }
  });
}

module.exports = {
  attach,
  joinUserRoom,
  leaveUserRoom,
  registerDmHandlers,
  publishMessage,
  publishTyping,
  publishRead,
  publishDeleted,
  isUserConnected,
  userRoomKey,
  typingErrorCount: () => typingTimers.size,
  _resetTimers: () => {
    for (const t of typingTimers.values()) clearTimeout(t);
    typingTimers.clear();
  },
};
