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

/* ── Presence (Part 11 — "active / last seen") ────────────────────────────
 *
 * WHY THE WRITE IS THROTTLED AND THE STATE IS NOT
 *   "Online" is derived from live sockets and lives only in memory — it is
 *   true the instant a socket opens and false the instant the last one closes,
 *   with no database involved. `lastSeenAt` is the durable half, and it is
 *   written at most once a minute per connected user plus once on the final
 *   disconnect. A per-connect write would turn every reconnect (flaky mobile
 *   networks do this constantly) into a row update.
 */
const lastSeenWriteAt = new Map(); // userId → epoch ms of last persisted write
const LAST_SEEN_WRITE_INTERVAL_MS = 60_000;

/* conversationId → Set<userId> currently watching (thread open on screen).
 * userId → Set<conversationId> they are watching — the reverse index, so a
 * presence change can find every watcher it concerns without scanning. */
const watchRegistry = new Map();
const watchingBy = new Map();

function recordLastSeen(userId, { force = false } = {}) {
  const id = String(userId);
  const now = Date.now();
  if (!force && now - (lastSeenWriteAt.get(id) || 0) < LAST_SEEN_WRITE_INTERVAL_MS) return;
  lastSeenWriteAt.set(id, now);
  User.updateOne({ _id: id }, { $set: { lastSeenAt: new Date(now) } }).catch((e) =>
    console.error("lastSeen write failed:", e.message)
  );
}

/** Is this user holding at least one open socket right now? */
function isUserOnline(userId) {
  return connectedUsers.has(String(userId));
}

/** { online, lastSeenAt } for a user — memory first, then the stored value. */
async function presenceOf(userId) {
  const id = String(userId);
  if (connectedUsers.has(id)) return { online: true, lastSeenAt: null };
  const u = await User.findById(id).select("lastSeenAt").lean();
  return { online: false, lastSeenAt: u?.lastSeenAt || null };
}

/**
 * Tell everyone who is looking at a conversation that one of its members
 * changed presence.
 *
 * Scoped deliberately: only watchers of conversations the user actually
 * belongs to are notified. Broadcasting presence to every connected client
 * would leak the activity pattern of every user to every other user, and
 * would cost one emit per socket per connect.
 */
function broadcastPresence(userId, online) {
  const id = String(userId);
  const conversations = watchingBy.get(id);
  if (!conversations?.size) return;
  const now = new Date();
  for (const conversationId of conversations) {
    const watchers = watchRegistry.get(conversationId);
    if (!watchers?.size) continue;
    for (const watcherId of watchers) {
      if (watcherId === id) continue;
      emitToUser(watcherId, EVENTS.S_DM_PRESENCE, {
        userId: id,
        online,
        lastSeenAt: online ? null : now,
      });
    }
  }
}

/** The user opened a conversation: start routing presence to them. */
function watchConversation(socket, conversationId, participantIds) {
  const me = String(socket.data?.user?.id || "");
  if (!me || !conversationId) return;
  const cid = String(conversationId);

  if (!watchRegistry.has(cid)) watchRegistry.set(cid, new Set());
  watchRegistry.get(cid).add(me);

  if (!watchingBy.has(me)) watchingBy.set(me, new Set());
  watchingBy.get(me).add(cid);

  /* Register this user against the conversation's OTHER participants so that
   * when any of them comes online or goes away, `broadcastPresence` can find
   * this conversation from the reverse index. */
  for (const pid of participantIds || []) {
    const other = String(pid);
    if (other === me) continue;
    if (!watchingBy.has(other)) watchingBy.set(other, new Set());
    watchingBy.get(other).add(cid);
  }
}

function unwatchConversation(socket, conversationId) {
  const me = String(socket.data?.user?.id || "");
  if (!me) return;
  const cid = conversationId ? String(conversationId) : null;
  if (cid) {
    watchRegistry.get(cid)?.delete(me);
    if (!watchRegistry.get(cid)?.size) watchRegistry.delete(cid);
    watchingBy.get(me)?.delete(cid);
  } else {
    // Socket went away entirely — drop every conversation it was watching.
    for (const c of watchingBy.get(me) || []) watchRegistry.get(c)?.delete(me);
    watchingBy.delete(me);
  }
}

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
  const wasOffline = !connectedUsers.has(uid);
  connectedUsers.set(uid, (connectedUsers.get(uid) || 0) + 1);
  // Only the FIRST socket of a user flips them online — opening a second tab
  // must not re-announce them.
  if (wasOffline) {
    recordLastSeen(uid, { force: true });
    broadcastPresence(uid, true);
  }
  return userRoomKey(uid);
}

function leaveUserRoom(socket) {
  const uid = socket.data?.user?.id;
  if (!uid) return;
  const next = (connectedUsers.get(uid) || 0) - 1;
  if (next <= 0) {
    connectedUsers.delete(uid);
    // The durable half of presence. Written immediately because this is the
    // last signal we get — there is no later request to piggyback on.
    recordLastSeen(uid, { force: true });
    broadcastPresence(uid, false);
  } else {
    connectedUsers.set(uid, next);
  }
  unwatchConversation(socket, null);
}

/** Is this user holding at least one open socket? (diagnostics + tests) */
function isUserConnected(userId) {
  return isUserOnline(userId);
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
function publishMessage({ conversation, message, participantIds, senderId }) {
  const ids = (participantIds || []).map(String);
  /* The archived flag is PER RECIPIENT: the same event must tell each member
   * "this thread is archived for you" without exposing anyone else's inbox
   * (§24). With two participants that is one flag; with a team it is a
   * per-recipient value, so the payload is built per recipient rather than
   * shared and mutated. */
  const archivedBy = (conversation.archivedBy || []).map(String);

  const base = {
    conversationId: String(conversation._id),
    message: wireMessage(message),
    senderArchived: archivedBy.includes(String(senderId)),
    // Present only for teams — the client labels the row from the sender.
    teamName: conversation.type === "team" ? conversation.name || "" : undefined,
    preview: {
      text: (message.content || "Photo").slice(0, 200),
      at: message.createdAt || new Date(),
      senderId: String(senderId),
      senderName: message.sender
        ? `${message.sender.firstName || ""} ${message.sender.lastName || ""}`.trim()
        : "",
    },
  };

  for (const pid of ids) {
    emitToUser(pid, EVENTS.S_DM_MESSAGE, {
      ...base,
      self: pid === String(senderId),
      recipientArchived: archivedBy.includes(pid),
    });
  }
  return base;
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
function publishTyping({ conversationId, fromUserId, toUserIds, typing }) {
  const targets = (toUserIds || []).map(String);
  const cid = String(conversationId);
  const event = {
    conversationId: cid,
    userId: String(fromUserId),
    typing: Boolean(typing),
  };

  for (const toUserId of targets) {
    const key = `${toUserId}:${cid}`;
    const existing = typingTimers.get(key);
    if (existing) clearTimeout(existing);

    emitToUser(toUserId, EVENTS.S_DM_TYPING, event);

    if (typing) {
      /* One expiry per recipient, because each is an independent signal: with
       * a shared timer a single peer clearing their indicator would cancel
       * everyone else's. */
      typingTimers.set(
        key,
        setTimeout(() => {
          typingTimers.delete(key);
          emitToUser(toUserId, EVENTS.S_DM_TYPING, { ...event, typing: false, expired: true });
        }, TYPING_TTL_MS)
      );
    } else {
      typingTimers.delete(key);
    }
  }
}

/**
 * Announce that a participant's messages were read (§14).
 *
 * The write already happened — one batched updateMany in the controller.
 * This only tells the other side so their ticks turn to "read" without a
 * refetch. `at` is the timestamp the batch was applied at.
 */
function publishRead({ conversationId, readerId, otherIds, at }) {
  const base = { conversationId: String(conversationId), readerId: String(readerId), at };
  for (const id of (otherIds || []).map(String)) {
    emitToUser(id, EVENTS.S_DM_READ, base);
  }
  // The reader's own other devices also need to hear it, so a second tab
  // showing the same unread badge clears itself.
  emitToUser(readerId, EVENTS.S_DM_READ, { ...base, self: true });
}

/** A message was unsent — the peer must drop its content too. */
function publishDeleted({ conversationId, messageId, fromUserId, otherIds }) {
  const payload = { conversationId: String(conversationId), messageId: String(messageId) };
  for (const id of (otherIds || []).map(String)) {
    emitToUser(id, EVENTS.S_DM_DELETED, payload);
  }
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
      /* Every other member of the thread. In a direct chat that is one peer;
       * in a team it is the whole roster, because "someone is typing" is
       * meaningful to everyone reading the room. */
      const others = (convo.participants || [])
        .map(String)
        .filter((p) => p !== String(me));
      if (!others.length) return;
      publishTyping({
        conversationId: convo._id,
        fromUserId: me,
        toUserIds: others,
        typing: Boolean(payload.typing),
      });
    } catch {
      /* typing is best-effort; a failure must never surface as an error */
    }
  });

  /* dm:watch { conversationId } / dm:unwatch { conversationId }
   * The client says "this thread is on screen". Presence updates for its
   * members are then routed here and nowhere else — a user who is not looking
   * at a conversation has no reason to receive its members' comings and
   * goings, and no reason to pay for them. */
  socket.on(EVENTS.C_DM_WATCH, async (payload = {}) => {
    try {
      if (!payload.conversationId) return;
      const convo = await Conversation.findOne({ _id: payload.conversationId, participants: me })
        .select("participants")
        .lean();
      if (!convo) return; // not a participant — ignore silently
      watchConversation(socket, convo._id, convo.participants.map(String));

      /* Answer immediately with everyone's current state, so opening a thread
       * does not wait for the first transition to learn who is around. */
      const states = await Promise.all(
        convo.participants
          .map(String)
          .filter((id) => id !== String(me))
          .map(async (id) => ({ userId: id, ...(await presenceOf(id)) }))
      );
      for (const st of states) socket.emit(EVENTS.S_DM_PRESENCE, st);
    } catch (e) {
      console.error("dm:watch failed:", e.message);
    }
  });

  socket.on(EVENTS.C_DM_UNWATCH, (payload = {}) => {
    try {
      unwatchConversation(socket, payload.conversationId);
    } catch {
      /* best-effort */
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
  emitToUser,
  isUserConnected,
  isUserOnline,
  presenceOf,
  unwatchConversation,
  userRoomKey,
  typingErrorCount: () => typingTimers.size,
  _resetTimers: () => {
    for (const t of typingTimers.values()) clearTimeout(t);
    typingTimers.clear();
  },
};
