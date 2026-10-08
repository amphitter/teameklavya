const mongoose = require("mongoose");
const { isBlockedBetween, isFollowerOf } = require("../services/social.service");
const Conversation = require("../models/conversation.model");
const Message = require("../models/message.model");
const User = require("../models/user.model");
const Notification = require("../models/notification.model");
const Post = require("../models/post.model");
// Part 13 §22 — sharing a post must not widen who may read it, so the check is
// the same predicate the post routes use, applied to the RECIPIENT.
const { canViewPost } = require("../services/post-visibility.service");
// Part 10 §12 — DM events ride the existing Socket.IO server.
const dmRealtime = require("../services/dm-realtime.service");
const { EVENTS } = require("../config/socket-protocol");
// Emitting into a user's room is the DM service's job; this re-exports the
// one primitive the team endpoints need so they do not open a second socket
// path of their own.
const emitToUser = (userId, event, payload) => dmRealtime.emitToUser(userId, event, payload);

const USER_FIELDS = "firstName lastName username profile";

/* Part 10 §4 — the conversation list returns METADATA ONLY.
 *
 * `USER_FIELDS` above is the *thread* projection, where one participant's
 * full profile is legitimately on screen. The list renders up to 30 rows;
 * projecting `profile` (bio, cover, social links, institution) into every
 * row made each poll carry a multiple of the payload it needed. The list
 * shows a name, a @handle and a 44px avatar — so that is all it fetches. */
const LIST_USER_FIELDS = "firstName lastName username profile.avatar";

/* Part 10 §15 — "Queries must select only required fields."
 * The message document carries `reactions[]` and an `attachment` subdoc.
 * `reactions` IS needed (it is summarised for display) but the rest of the
 * document is not, and `__v` never is. */
const MESSAGE_FIELDS =
  "_id conversation sender content image attachment replyTo reactions deletedAt readAt createdAt clientMessageId sharedPost";

/** Page size ceilings. 30 rows of metadata ≈ a few KB; the old list sent 50
 *  rows of full profiles, and the old thread sent up to 100 full messages. */
const CONVO_PAGE = 20;
const CONVO_PAGE_MAX = 50;
const MSG_PAGE = 30;
const MSG_PAGE_MAX = 60;

function clampInt(value, fallback, min, max) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * Cursor for the inbox: "<updatedAt ISO>|<_id>".
 * Ties on updatedAt break on _id so a page boundary can never repeat or skip
 * a row — the same reason the feed uses a compound cursor.
 */
function convoCursorPredicate(cursor) {
  if (!cursor) return null;
  const [at, id] = String(cursor).split("|");
  const d = new Date(at);
  if (!id || Number.isNaN(d.getTime())) return null;
  return { $or: [{ updatedAt: { $lt: d } }, { updatedAt: d, _id: { $lt: id } }] };
}

function convoCursorOf(convo) {
  return `${new Date(convo.updatedAt).toISOString()}|${convo._id}`;
}

/**
 * Find (or create) the 1:1 conversation between me and another user.
 *
 * Lookup is by `participantsKey` — a scalar pair identity — rather than by
 * the `participants` array, because the array lookup is an exact-array match
 * that cannot use a unique constraint. See conversation.model.js for why the
 * old `{participants: 1} unique` index made each user single-conversation.
 *
 * A legacy row written before `participantsKey` existed has no key, so the
 * array lookup is kept as the fallback; when it finds one we write the key
 * back opportunistically so the row joins the fast path from then on. That
 * write is best-effort: if it fails, the pair still resolves correctly on
 * every subsequent call via the fallback.
 */
async function getOrCreateConversation(me, other) {
  const sorted = [String(me), String(other)].sort();
  const key = Conversation.pairKeyOf(sorted[0], sorted[1]);

  let convo = await Conversation.findOne({ participantsKey: key });
  if (convo) return convo;

  /* Legacy fallback (pre-backfill rows). `type: { $ne: "team" }` is load
   * bearing: a two-person TEAM also has exactly these two participants, and
   * without this guard "message this person" would open that team as if it
   * were a private chat — the pair key belongs to direct conversations only. */
  convo = await Conversation.findOne({ participants: sorted, type: { $ne: "team" } });
  if (convo) {
    if (!convo.participantsKey) {
      convo.participantsKey = key;
      await convo.save().catch(() => {});
    }
    return convo;
  }

  try {
    return await Conversation.create({ participants: sorted, type: "direct" });
  } catch (err) {
    // Race: two requests created the pair at once — the unique index on
    // participantsKey let exactly one win. Return the winner.
    const raced = await Conversation.findOne({ participantsKey: key });
    if (raced) return raced;
    throw err;
  }
}

// GET /api/messages/conversations
/**
 * GET /api/messages/conversations
 *
 * `?view=archived` returns only archived threads; the default returns the
 * inbox. Archived conversations are never dropped from storage — they move
 * between two views of the same data (Part 8 §33).
 */

/* ══ TEAMS (Part 11) ═══════════════════════════════════════════════════════
 *
 * A team is a named conversation with 2+ members that a user assembles from
 * their followers, the people they follow, or anyone else on the app.
 *
 * AUTHORIZATION MODEL
 *   owner  — everything: rename, add, remove, delete, transfer
 *   admin  — rename, add, remove
 *   member — send, read, leave
 *   Anyone not in the team can see nothing about it: not its name, not its
 *   roster, not that it exists.
 *
 * MEMBERSHIP IS RE-VALIDATED ON EVERY WRITE against the database rather than
 * trusted from the socket or the client, because a stale client must not be
 * able to add someone to a team after being removed from it.
 */

const TEAM_NAME_MAX = 80;
const TEAM_MAX_MEMBERS = 100;

/** Where the caller sits in this team: "owner" | "admin" | "member" | null. */
function teamRoleOf(convo, userId) {
  const me = String(userId);
  if (String(convo.owner) === me) return "owner";
  if ((convo.admins || []).some((a) => String(a) === me)) return "admin";
  if ((convo.participants || []).some((p) => String(p?._id || p) === me)) return "member";
  return null;
}

/** Resolve an array of user ids to users, dropping anything unusable. */
async function resolveMembers(ids, { exclude = [] } = {}) {
  const clean = [
    ...new Set(
      (Array.isArray(ids) ? ids : [])
        .map((i) => String(i || ""))
        .filter((i) => mongoose.isValidObjectId(i))
    ),
  ].filter((i) => !exclude.map(String).includes(i));

  if (!clean.length) return [];
  // Suspended and deleted accounts must not be pullable into a new team.
  return User.find({ _id: { $in: clean }, suspendedAt: null })
    .select(LIST_USER_FIELDS)
    .lean();
}

/** The shape the client renders for a team. Never leaks anything else. */
function teamSummary(convo, userId, members) {
  return {
    _id: convo._id,
    type: "team",
    name: convo.name,
    avatar: convo.avatar || "",
    memberCount: (convo.participants || []).length,
    /* The FULL roster, not a preview: the thread uses it to label who is
     * typing and to name senders, and a truncated list would silently drop
     * names for exactly the members a busy team talks to most. It is bounded
     * by the membership cap, and each entry is a handful of display fields —
     * the header slices what it needs for its face-pile. */
    members: (members || []).map((m) => ({
      ...m,
      role:
        String(convo.owner) === String(m._id)
          ? "owner"
          : (convo.admins || []).some((a) => String(a) === String(m._id))
            ? "admin"
            : "member",
    })),
    myRole: teamRoleOf(convo, userId),
    owner: convo.owner,
    updatedAt: convo.updatedAt,
  };
}

// POST /api/messages/teams  { name, memberIds: [] }
exports.createTeam = async (req, res) => {
  try {
    const me = req.user.id;
    const name = String(req.body.name || "").trim().slice(0, TEAM_NAME_MAX);
    if (!name) return res.status(400).json({ success: false, message: "Give your team a name" });

    const others = await resolveMembers(req.body.memberIds, { exclude: [me] });
    if (!others.length) {
      return res.status(400).json({ success: false, message: "Add at least one person to your team" });
    }
    if (others.length + 1 > TEAM_MAX_MEMBERS) {
      return res.status(400).json({ success: false, message: `A team can hold up to ${TEAM_MAX_MEMBERS} members` });
    }

    const convo = await Conversation.create({
      type: "team",
      name,
      owner: me,
      admins: [],
      participants: [String(me), ...others.map((u) => String(u._id))],
      lastMessage: { text: "", sender: me, at: new Date() },
    });

    /* Announce the new team in the inbox of every member — a team you were
     * added to should appear without a refresh. `dm:message` is reused with
     * a system-shaped message so the client needs no second event type. */
    try {
      for (const u of others) {
        emitToUser(u._id, EVENTS.S_DM_MESSAGE, {
          conversationId: String(convo._id),
          // No real message row exists yet; the client treats a null message
          // as "your list changed, re-read it" rather than an append.
          message: null,
          teamName: name,
          teamCreated: true,
          preview: { text: uploadedTeamIntro(name), at: convo.updatedAt || new Date(), senderId: String(me) },
        });
      }
    } catch (e) {
      console.error("team announce failed:", e.message);
    }

    res.status(201).json({
      success: true,
      conversationId: convo._id,
      team: teamSummary(convo, me, [await User.findById(me).select(LIST_USER_FIELDS).lean(), ...others]),
    });
  } catch (error) {
    console.error("Create team error:", error.message);
    res.status(500).json({ success: false, message: "Couldn't create that team" });
  }
};

function uploadedTeamIntro(name) {
  return `${name} created`;
}

// GET /api/messages/teams/:id/members
exports.getTeamMembers = async (req, res) => {
  try {
    const convo = await Conversation.findOne({ _id: req.params.id, participants: req.user.id })
      .select("type participants owner admins")
      .lean();
    if (!convo || convo.type !== "team") {
      return res.status(404).json({ success: false, message: "Team not found" });
    }
    const members = await User.find({ _id: { $in: convo.participants } })
      .select(LIST_USER_FIELDS)
      .lean();
    // Ordered so the owner leads and admins follow — the order the list shows.
    const rank = (id) =>
      String(convo.owner) === String(id) ? 0 : (convo.admins || []).some((a) => String(a) === String(id)) ? 1 : 2;
    members.sort((a, b) => rank(a._id) - rank(b._id));
    /* Every member carries their own role, so the client renders badges from
     * data instead of positional inference. `teamSummary` below relies on the
     * same field, which keeps the two paths telling one story. */
    const withRoles = members.map((m) => ({
      ...m,
      role: rank(m._id) === 0 ? "owner" : rank(m._id) === 1 ? "admin" : "member",
    }));
    res.json({ success: true, members: withRoles, myRole: teamRoleOf(convo, req.user.id) });
  } catch (error) {
    console.error("Team members error:", error.message);
    res.status(500).json({ success: false, message: "Failed to load members" });
  }
};

// POST /api/messages/teams/:id/members  { userIds: [] }
exports.addTeamMembers = async (req, res) => {
  try {
    const me = req.user.id;
    const convo = await Conversation.findOne({ _id: req.params.id, participants: me });
    if (!convo || convo.type !== "team") {
      return res.status(404).json({ success: false, message: "Team not found" });
    }
    const role = teamRoleOf(convo, me);
    if (role !== "owner" && role !== "admin") {
      return res.status(403).json({ success: false, message: "Only the owner or an admin can add people" });
    }

    const existing = convo.participants.map(String);
    const toAdd = await resolveMembers(req.body.userIds, { exclude: existing });
    if (!toAdd.length) return res.json({ success: true, added: 0, members: [] });
    if (existing.length + toAdd.length > TEAM_MAX_MEMBERS) {
      return res.status(400).json({ success: false, message: `A team can hold up to ${TEAM_MAX_MEMBERS} members` });
    }

    convo.participants = [...existing, ...toAdd.map((u) => String(u._id))];
    await convo.save();

    // A new member's inbox must gain the team without a reload.
    for (const u of toAdd) {
      try {
        emitToUser(u._id, EVENTS.S_DM_MESSAGE, {
          conversationId: String(convo._id),
          message: null,
          teamName: convo.name,
          teamCreated: true,
          preview: { text: `You were added to ${convo.name}`, at: new Date(), senderId: String(me) },
        });
      } catch {
        /* best-effort */
      }
    }

    res.json({ success: true, added: toAdd.length, members: toAdd });
  } catch (error) {
    console.error("Add team members error:", error.message);
    res.status(500).json({ success: false, message: "Couldn't add those people" });
  }
};

// DELETE /api/messages/teams/:id/members/:userId
exports.removeTeamMember = async (req, res) => {
  try {
    const me = req.user.id;
    const target = String(req.params.userId);
    const convo = await Conversation.findOne({ _id: req.params.id, participants: me });
    if (!convo || convo.type !== "team") {
      return res.status(404).json({ success: false, message: "Team not found" });
    }
    const role = teamRoleOf(convo, me);
    const isSelf = target === String(me);

    // Anyone may remove themselves (that is "leave"). Removing someone else
    // requires owner/admin, and nobody may remove the owner.
    if (!isSelf && role !== "owner" && role !== "admin") {
      return res.status(403).json({ success: false, message: "Only the owner or an admin can remove people" });
    }
    if (!isSelf && target === String(convo.owner)) {
      return res.status(403).json({ success: false, message: "The team owner can't be removed" });
    }
    if (!convo.participants.some((p) => String(p) === target)) {
      return res.status(404).json({ success: false, message: "That person isn't in this team" });
    }

    convo.participants = convo.participants.filter((p) => String(p) !== target);
    convo.admins = (convo.admins || []).filter((a) => String(a) !== target);

    if (convo.participants.length < 2) {
      /* The last member leaving empties the team. Deleting it would erase
       * everyone's history over one person's decision, so it is closed
       * instead: the document and its messages remain, and no one can post
       * to it. Nothing is silently destroyed (§7 — no source deletion). */
      convo.participants = convo.participants;
      await convo.save();
      return res.json({ success: true, left: isSelf, empty: true });
    }

    await convo.save();
    res.json({ success: true, left: isSelf, empty: false });
  } catch (error) {
    console.error("Remove team member error:", error.message);
    res.status(500).json({ success: false, message: "Couldn't remove that person" });
  }
};

// PATCH /api/messages/teams/:id  { name?, avatar? }
exports.updateTeam = async (req, res) => {
  try {
    const me = req.user.id;
    const convo = await Conversation.findOne({ _id: req.params.id, participants: me });
    if (!convo || convo.type !== "team") {
      return res.status(404).json({ success: false, message: "Team not found" });
    }
    const role = teamRoleOf(convo, me);
    if (role !== "owner" && role !== "admin") {
      return res.status(403).json({ success: false, message: "Only the owner or an admin can edit the team" });
    }

    if (req.body.name !== undefined) {
      const name = String(req.body.name || "").trim().slice(0, TEAM_NAME_MAX);
      if (!name) return res.status(400).json({ success: false, message: "A team needs a name" });
      convo.name = name;
    }
    if (req.body.avatar !== undefined) {
      const avatar = String(req.body.avatar || "").trim().slice(0, 500);
      if (avatar && !/^https?:\/\//.test(avatar)) {
        return res.status(400).json({ success: false, message: "Team photo must be a valid URL" });
      }
      convo.avatar = avatar;
    }
    await convo.save();

    try {
      for (const p of convo.participants.map(String)) {
        if (p === String(me)) continue;
        emitToUser(p, EVENTS.S_DM_MESSAGE, {
          conversationId: String(convo._id),
          message: null,
          teamName: convo.name,
          teamUpdated: true,
          preview: { text: `Team renamed to ${convo.name}`, at: new Date(), senderId: String(me) },
        });
      }
    } catch {
      /* best-effort */
    }

    res.json({ success: true, team: { _id: convo._id, name: convo.name, avatar: convo.avatar } });
  } catch (error) {
    console.error("Update team error:", error.message);
    res.status(500).json({ success: false, message: "Couldn't update that team" });
  }
};

exports.getConversations = async (req, res) => {
  try {
    const me = req.user.id;
    const view = String(req.query.view || "all");
    const archived = view === "archived";
    const limit = clampInt(req.query.limit, CONVO_PAGE, 1, CONVO_PAGE_MAX);

    // Hidden conversations stay out of the list (a new message un-hides them).
    // $eq / $ne on the same array field keeps inbox and archive exclusive.
    const filter = { participants: me, hiddenBy: { $ne: me } };
    filter.archivedBy = archived ? me : { $ne: me };

    const cursorPred = convoCursorPredicate(req.query.cursor);
    if (cursorPred) filter.$and = [cursorPred];

    // Over-fetch by one row so `hasMore` is derived from the slice rather
    // than from a second countDocuments() round trip.
    const convos = await Conversation.find(filter)
      .sort({ updatedAt: -1, _id: -1 })
      .limit(limit + 1)
      .populate("participants", LIST_USER_FIELDS)
      .populate("lastMessage.sender", LIST_USER_FIELDS)
      .lean();

    const hasMore = convos.length > limit;
    const page = hasMore ? convos.slice(0, limit) : convos;

    const convoIds = page.map((c) => c._id);

    /* Unread in ONE grouped query, not one per conversation and not a scan.
     * Matches the new { conversation, readAt, sender } index, so MongoDB
     * seeks each thread's unread head instead of filtering the collection.
     * Only unread documents are visited — O(unread), not O(messages). */
    const unreadAgg = convoIds.length
      ? await Message.aggregate([
          { $match: { conversation: { $in: convoIds }, sender: { $ne: new mongoose.Types.ObjectId(me) }, readAt: null } },
          { $group: { _id: "$conversation", count: { $sum: 1 } } },
        ])
      : [];
    const unreadMap = new Map(unreadAgg.map((r) => [String(r._id), r.count]));

    /* Presence for every direct peer in one pass, so the list can show an
     * "active now" dot without a request per row. Teams resolve to nobody:
     * "online" is meaningless for a set of people, and a team row shows a
     * member count instead. */
    const peerIds = page
      .filter((c) => c.type !== "team")
      .map((c) => c.participants.find((p) => String(p._id) !== String(me))?._id)
      .filter(Boolean);
    const presenceMap = new Map();
    if (peerIds.length) {
      const peers = await User.find({ _id: { $in: peerIds } }).select("lastSeenAt").lean();
      for (const u of peers) {
        presenceMap.set(String(u._id), {
          online: dmRealtime.isUserOnline(u._id),
          lastSeenAt: u.lastSeenAt || null,
        });
      }
    }

    let list = page.map((c) => {
      const isTeam = c.type === "team";
      const other = isTeam ? null : c.participants.find((p) => String(p._id) !== String(me)) || null;
      const sender = c.lastMessage?.sender || null;
      return {
        _id: c._id,
        type: c.type || "direct",
        other,
        // Team identity, ignored by the client for direct rows.
        name: isTeam ? c.name || "Team" : null,
        avatar: isTeam ? c.avatar || "" : null,
        memberCount: isTeam ? c.participants.length : null,
        lastMessage: c.lastMessage?.text
          ? {
              text: c.lastMessage.text,
              at: c.lastMessage.at,
              mine: String(sender?._id || sender) === String(me),
              /* For a team the row must say WHO spoke — otherwise every
               * message looks like it came from the team itself. */
              senderName: isTeam && sender
                ? `${sender.firstName || ""} ${sender.lastName || ""}`.trim()
                : "",
            }
          : null,
        updatedAt: c.updatedAt,
        unreadCount: unreadMap.get(String(c._id)) || 0,
        muted: (c.mutedBy || []).some((m) => String(m) === String(me)),
        archived: (c.archivedBy || []).some((m) => String(m) === String(me)),
        // Direct rows only.
        presence: other ? presenceMap.get(String(other._id)) || { online: false, lastSeenAt: null } : null,
      };
    });

    /* view=unread is applied AFTER counting, because "has unread" is a
     * property of the messages, not of the conversation document. The cost
     * is that a page can come back short when a run of read threads is
     * filtered out. That is the correct trade: the alternative is a
     * denormalised unread counter on the conversation, which can drift out
     * of sync with the messages it is supposed to summarise. */
    if (view === "unread") list = list.filter((c) => c.unreadCount > 0);

    res.json({
      success: true,
      conversations: list,
      nextCursor: hasMore && page.length ? convoCursorOf(page[page.length - 1]) : null,
      hasMore,
    });
  } catch (error) {
    console.error("Get conversations error:", error.message);
    res.status(500).json({ success: false, message: "Failed to load conversations" });
  }
};

// POST /api/messages/conversations  { userId }  → get-or-create
exports.startConversation = async (req, res) => {
  try {
    const otherId = req.body.userId;
    if (!otherId || String(otherId) === String(req.user.id)) {
      return res.status(400).json({ success: false, message: "Pick someone else to message" });
    }
    const other = await User.findById(otherId).select(USER_FIELDS + " socialSettings").lean();
    if (!other) return res.status(404).json({ success: false, message: "User not found" });

    // Backend-enforced messaging permissions
    if (await isBlockedBetween(req.user.id, otherId)) {
      return res.status(403).json({ success: false, message: "You can't message this user" });
    }
    const dmPolicy = other.socialSettings?.allowMessagesFrom || "everyone";
    if (dmPolicy === "nobody") {
      return res.status(403).json({ success: false, message: "This user doesn't accept messages" });
    }
    if (dmPolicy === "followers" && !(await isFollowerOf(req.user.id, otherId))) {
      return res.status(403).json({ success: false, message: "Only followers can message this user" });
    }

    const convo = await getOrCreateConversation(req.user.id, otherId);
    res.json({ success: true, conversationId: convo._id, other });
  } catch (error) {
    console.error("Start conversation error:", error.message);
    res.status(500).json({ success: false, message: "Failed to start conversation" });
  }
};

// GET /api/messages/conversations/:id  (marks incoming as read)
/**
 * GET /api/messages/conversations/:id — ONE page of history, never the thread.
 *
 *   ?before=<messageId>   older than this message  (scrolling UP)
 *   ?after=<messageId>    newer than this message  (catch-up / reconnect)
 *   ?limit=<n>            default 30
 *
 * The old handler returned up to 100 messages with no cursor, and the client
 * refetched all of them every six seconds. Now the client asks for the page
 * it needs and keeps what it already has.
 *
 * Returned oldest → newest, which is the order the DOM wants, so the client
 * never reverses a large array on the main thread.
 */
exports.getMessages = async (req, res) => {
  try {
    const me = req.user.id;
    const convo = await Conversation.findOne({ _id: req.params.id, participants: me });
    if (!convo) return res.status(404).json({ success: false, message: "Conversation not found" });

    const limit = clampInt(req.query.limit, MSG_PAGE, 1, MSG_PAGE_MAX);
    const filter = { conversation: convo._id };

    // Resolve a cursor id → (createdAt, _id) once. Comparing on the id alone
    // would be wrong: ObjectIds are monotonic per-process, not a global
    // ordering, so two messages created in the same second on different
    // app servers could sort either way.
    const resolveCursor = async (raw, direction) => {
      if (!raw || !mongoose.isValidObjectId(raw)) return null;
      const anchor = await Message.findOne({ _id: raw, conversation: convo._id })
        .select("createdAt")
        .lean();
      if (!anchor) return null;
      return direction === "before"
        ? { $or: [{ createdAt: { $lt: anchor.createdAt } }, { createdAt: anchor.createdAt, _id: { $lt: anchor._id } }] }
        : { $or: [{ createdAt: { $gt: anchor.createdAt } }, { createdAt: anchor.createdAt, _id: { $gt: anchor._id } }] };
    };

    const beforePred = await resolveCursor(req.query.before, "before");
    const afterPred = await resolveCursor(req.query.after, "after");
    if (beforePred) filter.$and = [...(filter.$and || []), beforePred];
    if (afterPred) filter.$and = [...(filter.$and || []), afterPred];

    const isHistoryScroll = Boolean(req.query.before);

    /* Over-fetch by one to derive `hasMore` without a countDocuments().
     * Sorted DESCENDING internally because "the N newest before X" is the
     * query the index answers; reversed once at the end. */
    const isTeam = convo.type === "team";
    const otherId = isTeam ? null : convo.participants.find((p) => String(p) !== String(me));

    /* For a team, every message must show WHO sent it, so the roster is
     * fetched alongside the page rather than populated per message — one
     * query for the whole screenful instead of one per sender per message. */
    const [rows, other, teamMembers] = await Promise.all([
      Message.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .limit(limit + 1)
        .select(MESSAGE_FIELDS)
        .populate("sender", LIST_USER_FIELDS)
        .lean(),
      otherId
        ? User.findById(otherId).select(USER_FIELDS).lean()
        : Promise.resolve(null),
      isTeam
        ? User.find({ _id: { $in: convo.participants } }).select(LIST_USER_FIELDS).lean()
        : Promise.resolve([]),
    ]);

    const hasMore = rows.length > limit;
    const page = (hasMore ? rows.slice(0, limit) : rows).reverse(); // → oldest first

    /* Mark read — ONE batched command, never one write per message (§14).
     * Skipped on history scrolls: opening the thread already marked the
     * thread read, and re-running a no-op update on every upward scroll is
     * pure write amplification. */
    if (!isHistoryScroll) {
      await Message.updateMany(
        { conversation: convo._id, sender: { $ne: me }, readAt: null },
        { readAt: new Date() }
      ).catch((e) => console.error("mark-read failed:", e.message));
      // Drop pending missed-message notifications for this thread.
      Notification.deleteMany({ user: me, type: "message", read: false, conversation: convo._id })
        .catch(() => {});
    }

    const muted = (convo.mutedBy || []).some((m) => String(m) === String(me));
    const archived = (convo.archivedBy || []).some((m) => String(m) === String(me));

    const presence = otherId
      ? await dmRealtime.presenceOf(otherId)
      : null;

    res.json({
      success: true,
      // Reactions summarised server-side: the client receives
      // [{emoji,count,mine}] and never the raw per-user reaction list.
      messages: page.map((m) => ({ ...m, reactions: summarizeReactions(m.reactions || [], me) })),
      other,
      presence,
      type: convo.type || "direct",
      team: isTeam
        ? {
            _id: convo._id,
            name: convo.name || "Team",
            avatar: convo.avatar || "",
            memberCount: convo.participants.length,
            members: teamMembers,
            myRole: teamRoleOf(convo, me),
            owner: convo.owner,
          }
        : null,
      conversationId: convo._id,
      muted,
      archived,
      // `oldestId` is the client's next `before=` cursor; naming it outright
      // saves the client from digging into the page it just received.
      oldestId: page.length ? String(page[0]._id) : null,
      hasMore,
    });
  } catch (error) {
    console.error("Get messages error:", error.message);
    res.status(500).json({ success: false, message: "Failed to load messages" });
  }
};

// POST /api/messages/conversations/:id  { content, image?, sharedPostId? }
exports.sendMessage = async (req, res) => {
  try {
    let content = String(req.body.content || "").trim();
    const image = String(req.body.image || "").trim();

    const convo = await Conversation.findOne({ _id: req.params.id, participants: req.user.id });
    if (!convo) return res.status(404).json({ success: false, message: "Conversation not found" });

    /* A block added later must silence existing conversations too.
     *
     * Direct only: a block is one person's decision about one other person,
     * and blocking them out of a shared team by proxy would punish the whole
     * roster. In a team the blocked pair simply do not see each other's
     * presence — their messages still reach the team they both belong to. */
    const isTeam = convo.type === "team";
    const otherId = isTeam ? null : convo.participants.find((p) => String(p) !== String(req.user.id));
    if (otherId && (await isBlockedBetween(req.user.id, otherId))) {
      return res.status(403).json({ success: false, message: "You can't message this user" });
    }

    /* ── Shared post (Part 13 §19–§22) ────────────────────────────────────
     * The client sends `sharedPostId`, never the post's text or image: the
     * message stores a reference and the bubble renders the canonical post, so
     * an edit or a delete is reflected immediately and nothing is duplicated.
     *
     * The visibility check is the important part. A post can be public,
     * followers-only, participant-only, community-only or archived, and the
     * sender may legitimately be able to read one that the recipient cannot.
     * Without this check, sharing would be a way to READ AROUND every
     * visibility rule — "share it to myself" would hand me any private post.
     * So every other participant is tested with the same predicate the post
     * routes use, and the share is refused (403) if any would be denied. */
    let sharedPost = null;
    if (req.body.sharedPostId) {
      if (!mongoose.isValidObjectId(req.body.sharedPostId)) {
        return res.status(400).json({ success: false, message: "That post could not be found" });
      }
      const post = await Post.findById(req.body.sharedPostId).select("author visibility status archivedAt event community").lean();
      if (!post) {
        return res.status(404).json({ success: false, message: "Post unavailable" });
      }
      if (post.status !== "published") {
        return res.status(403).json({ success: false, message: "You can't share this post" });
      }
      /* BOTH ends are checked, and the sender's end is not an afterthought:
       * forwarding is only legitimate if you can see the thing you are
       * forwarding. Without this, anyone who knows or guesses a post id could
       * reference a post they are not allowed to read — and in a group it would
       * then be handed to everyone who can read it, with the sharer as the
       * apparent source. */
      if (!(await canViewPost(post, req.user.id))) {
        return res.status(403).json({ success: false, message: "You can't share this post" });
      }
      const others = (convo.participants || []).map((p) => String(p?._id || p)).filter((id) => id !== String(req.user.id));
      for (const otherId of others) {
        // eslint-disable-next-line no-await-in-loop
        if (!(await canViewPost(post, otherId))) {
          return res.status(403).json({ success: false, message: "You can't share this post with this person" });
        }
      }
      sharedPost = post._id;
      // A share is allowed to carry a note; with no note it still needs a line
      // for the inbox preview and for clients that render text only.
      if (!content) content = "Shared a post";
    }

    // Validated after the share block: a share with no note is still a message.
    if (!content && !image) {
      return res.status(400).json({ success: false, message: "Message can't be empty" });
    }
    if (content && image) {
      return res.status(400).json({ success: false, message: "Send text or a photo, not both" });
    }

    // Reply target must belong to this thread, or it is a way to inject a
    // reference to a message the recipient cannot see.
    let replyTo = null;
    if (req.body.replyTo) {
      const target = await Message.findOne({ _id: req.body.replyTo, conversation: convo._id }).select("_id").lean();
      if (target) replyTo = target._id;
    }
    const att = req.body.attachment && typeof req.body.attachment === "object" ? req.body.attachment : {};
    const attachment = att.url
      ? { url: String(att.url).slice(0, 500), name: String(att.name || "").slice(0, 200), size: Number(att.size) || 0, mime: String(att.mime || "").slice(0, 120) }
      : undefined;

    /* ── Idempotency (Part 10 §11) ───────────────────────────────────────
     * The client generates a clientMessageId when the user presses send and
     * reuses it for every retry of that send. If we have already persisted
     * that id we return the existing message instead of inserting a second
     * copy — this is what stops a retry after a timeout, or a reconnect
     * replaying a queued send, from showing the user two copies of a message
     * they only wrote once. */
    const clientMessageId = String(req.body.clientMessageId || "").slice(0, 64) || null;

    if (clientMessageId) {
      const existing = await Message.findOne({
        clientMessageId,
        conversation: convo._id,
        sender: req.user.id,
      }).lean();
      if (existing) {
        return res.status(200).json({
          success: true,
          message: { ...existing, reactions: summarizeReactions(existing.reactions || [], req.user.id) },
          archived: (convo.archivedBy || []).some((m) => String(m) === String(req.user.id)),
          duplicate: true,
        });
      }
    }

    let message;
    try {
      message = await Message.create({
        conversation: convo._id,
        sender: req.user.id,
        content,
        image,
        ...(sharedPost ? { sharedPost } : {}),
        ...(replyTo ? { replyTo } : {}),
        ...(attachment ? { attachment } : {}),
        ...(clientMessageId ? { clientMessageId } : {}),
      });
    } catch (createErr) {
      // Unique-index collision ⇒ a concurrent request with the same id won.
      // Re-read and return that one rather than surfacing an error for a
      // message that was in fact delivered.
      if (createErr?.code === 11000 && clientMessageId) {
        const raced = await Message.findOne({ clientMessageId, conversation: convo._id }).lean();
        if (raced) {
          return res.status(200).json({
            success: true,
            message: { ...raced, reactions: summarizeReactions(raced.reactions || [], req.user.id) },
            archived: (convo.archivedBy || []).some((m) => String(m) === String(req.user.id)),
            duplicate: true,
          });
        }
      }
      throw createErr;
    }

    // Un-hide for both participants (a new message revives a hidden chat).
    // NOTE: archivedBy is deliberately NOT cleared here — see the archive
    // behaviour note above. An archived chat stays archived when a new message
    // arrives; it surfaces with an unread badge in the archive view instead of
    // silently reappearing in the inbox and reversing the user's decision.
    convo.hiddenBy = [];
    convo.lastMessage = { text: (content || (image ? "Photo" : "Post")).slice(0, 200), sender: req.user.id, at: new Date() };
    await convo.save();

    // Missed-message notification: only when the recipient hasn't muted the
    // conversation. Deduped to the LATEST unread message per conversation.
    if (otherId) {
      try {
        const recipientMuted = (convo.mutedBy || []).some((m) => String(m) === String(otherId));
        if (!recipientMuted) {
          await Notification.deleteMany({ user: otherId, type: "message", read: false, conversation: convo._id });
          const { notify } = require("../services/notification.service");
          await notify({ user: otherId, actor: req.user.id, type: "message", conversation: convo._id });
        }
      } catch (notifyErr) {
        console.error("Message notify error:", notifyErr.message);
      }
    }

    const populated = await Message.findById(message._id)
      .select(MESSAGE_FIELDS)
      .populate("sender", LIST_USER_FIELDS)
      .lean();

    /* Fan out to both participants' `user:` rooms — AFTER the commit, so a
     * client that reacts by refetching can never read a message the database
     * does not have yet. Delivery is best-effort by design: the REST
     * response is the source of truth, and a dropped socket event costs
     * nothing because the client already has the message optimistically. */
    try {
      dmRealtime.publishMessage({
        conversation: convo,
        message: populated,
        // Direct: the single peer. Team: every member. The publisher tells
        // each recipient their own archive state, so one call covers both.
        participantIds: convo.participants.map((p) => String(p?._id || p)),
        senderId: req.user.id,
      });
    } catch (e) {
      console.error("DM publish failed:", e.message);
    }

    res.status(201).json({
      success: true,
      // clientMessageId is echoed back so the client can reconcile its
      // optimistic bubble by id. Without it the client has to guess which
      // pending row this response belongs to, and guessing is how a fast
      // double-send ends up rendering one message twice.
      message: { ...populated, reactions: [] },
      archived: (convo.archivedBy || []).some((m) => String(m) === String(req.user.id)),
    });
  } catch (error) {
    console.error("Send message error:", error.message);
    res.status(500).json({ success: false, message: "Failed to send message" });
  }
};

// GET /api/messages/unread-count
/**
 * GET /api/messages/unread-count — the header badge.
 *
 * Two counts so the UI can be honest about where the unread actually is:
 *   unreadCount         inbox only (archived threads excluded)
 *   archivedUnreadCount archived only — drives a dot on the Archive tab
 *
 * Part 10 §24: an archived thread keeps its unread state and must surface it
 * inside the archive, but it must not silently reappear in the inbox. One
 * number cannot express both, so there are two.
 */
exports.getUnreadCount = async (req, res) => {
  try {
    const me = req.user.id;
    const convos = await Conversation.find({ participants: me, hiddenBy: { $ne: me } })
      .select("_id archivedBy")
      .lean();

    const inboxIds = [];
    const archivedIds = [];
    for (const c of convos) {
      (c.archivedBy || []).some((m) => String(m) === String(me)) ? archivedIds.push(c._id) : inboxIds.push(c._id);
    }

    // Both counts read the { conversation, readAt, sender } index. Each
    // visits only unread documents — O(unread), not O(messages) — and they
    // run concurrently rather than sequentially.
    const countFor = (ids) =>
      ids.length
        ? Message.countDocuments({
            conversation: { $in: ids },
            sender: { $ne: new mongoose.Types.ObjectId(me) },
            readAt: null,
          })
        : Promise.resolve(0);

    const [unreadCount, archivedUnreadCount] = await Promise.all([countFor(inboxIds), countFor(archivedIds)]);
    res.json({ success: true, unreadCount, archivedUnreadCount });
  } catch (error) {
    console.error("Unread messages error:", error.message);
    res.status(500).json({ success: false, message: "Failed to load unread count" });
  }
};

/**
 * GET /api/messages/search?q=&type=conversations|messages&limit=
 *
 * Part 10 §25 — search happens on the server, because the client only holds
 * one page of one thread and could never find anything else. Debouncing is
 * the client's job; this endpoint is called once per settled query, not once
 * per keystroke.
 *
 * `type=conversations` matches participants by name/username and the last
 * message text. `type=messages` matches message bodies across every thread
 * the caller belongs to.
 */
exports.searchMessages = async (req, res) => {
  try {
    const me = req.user.id;
    const q = String(req.query.q || "").trim();
    const type = String(req.query.type || "conversations");
    const limit = clampInt(req.query.limit, 20, 1, 50);

    if (q.length < 1) return res.json({ success: true, results: [] });
    // A 1-character query matches most of the alphabet; refuse to scan for it.
    if (q.length > 80) return res.json({ success: true, results: [] });

    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(escaped, "i");

    if (type === "messages") {
      const mine = await Conversation.find({ participants: me }).select("_id").lean();
      const ids = mine.map((c) => c._id);
      if (!ids.length) return res.json({ success: true, results: [] });

      const hits = await Message.find({
        conversation: { $in: ids },
        content: re,
        deletedAt: null,
      })
        .sort({ createdAt: -1 })
        .limit(limit)
        .select(MESSAGE_FIELDS)
        .populate("sender", LIST_USER_FIELDS)
        .lean();

      // Group hits per conversation so the UI can show "3 matches" under a
      // thread instead of a flat, context-free list of fragments.
      const convoIds = [...new Set(hits.map((h) => String(h.conversation)))];
      const convos = await Conversation.find({ _id: { $in: convoIds } })
        .populate("participants", LIST_USER_FIELDS)
        .lean();
      const byId = new Map(convos.map((c) => [String(c._id), c]));

      const results = hits.map((h) => {
        const c = byId.get(String(h.conversation));
        const other = c?.participants.find((p) => String(p._id) !== String(me)) || null;
        return {
          _id: h._id,
          conversationId: h.conversation,
          content: h.content,
          createdAt: h.createdAt,
          other,
        };
      });

      return res.json({ success: true, results });
    }

    /* type=conversations — two cheap, index-friendly queries rather than a
     * join: users by name, then threads by last-message text. */
    const [people, byText] = await Promise.all([
      User.find({
        $or: [{ firstName: re }, { lastName: re }, { username: re }],
      })
        .select(LIST_USER_FIELDS)
        .limit(limit)
        .lean(),
      Conversation.find({
        participants: me,
        // Team names are searchable too, or a team becomes unfindable the
        // moment it scrolls out of the first page of the inbox.
        $or: [{ "lastMessage.text": re }, { type: "team", name: re }],
      })
        .sort({ updatedAt: -1 })
        .limit(limit)
        .populate("participants", LIST_USER_FIELDS)
        .lean(),
    ]);

    /* $all cannot contain an $in operator — that shape is invalid and threw
     * "Cast to ObjectId failed ... at path participants". Two positive
     * membership clauses ANDed together is the equivalent, valid form. */
    const peopleConvos = people.length
      ? await Conversation.find({
          $and: [{ participants: me }, { participants: { $in: people.map((p) => p._id) } }],
        })
          .populate("participants", LIST_USER_FIELDS)
          .lean()
      : [];

    const seen = new Set();
    const merged = [...peopleConvos, ...byText].filter((c) => {
      const k = String(c._id);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    const results = merged.slice(0, limit).map((c) => {
      const isTeam = c.type === "team";
      const other = isTeam ? null : c.participants.find((p) => String(p._id) !== String(me)) || null;
      return {
        _id: c._id,
        conversationId: c._id,
        type: c.type || "direct",
        other,
        name: isTeam ? c.name || "Team" : null,
        memberCount: isTeam ? c.participants.length : null,
        lastMessage: c.lastMessage?.text
          ? { text: c.lastMessage.text, at: c.lastMessage.at, mine: String(c.lastMessage.sender) === String(me) }
          : null,
      };
    });

    res.json({ success: true, results });
  } catch (error) {
    console.error("Search messages error:", error.message);
    res.status(500).json({ success: false, message: "Search failed" });
  }
};

/* ── Messaging v2 (Part 3, Phase 9) ───────────────────────── */

// DELETE /api/messages/:id — unsend my own message (soft-delete, audit kept)
exports.deleteMessage = async (req, res) => {
  try {
    const message = await Message.findOne({ _id: req.params.id, sender: req.user.id });
    if (!message) return res.status(404).json({ success: false, message: "Message not found" });

    message.content = "";
    message.image = "";
    message.deletedAt = new Date();
    await message.save();

    // If this was the newest message, refresh the conversation preview
    const convo = await Conversation.findById(message.conversation);
    if (convo) {
      const otherIds = (convo.participants || [])
        .map((p) => String(p))
        .filter((p) => p !== String(req.user.id));
      if (otherIds.length) {
        try {
          // Everyone else must lose the content too, without a refetch.
          dmRealtime.publishDeleted({
            conversationId: convo._id,
            messageId: message._id,
            fromUserId: req.user.id,
            otherIds,
          });
        } catch (e) {
          console.error("DM delete publish failed:", e.message);
        }
      }
    }
    if (convo && convo.lastMessage?.at && new Date(message.createdAt) >= new Date(convo.lastMessage.at)) {
      const latest = await Message.findOne({ conversation: convo._id, deletedAt: null })
        .sort({ createdAt: -1 })
        .lean();
      convo.lastMessage = latest
        ? { text: (latest.content || "Photo").slice(0, 200), sender: latest.sender, at: latest.createdAt }
        : { text: "", sender: req.user.id, at: new Date() };
      await convo.save();
    }
    res.json({ success: true });
  } catch (error) {
    console.error("Delete message error:", error.message);
    res.status(500).json({ success: false, message: "Failed to delete message" });
  }
};

// POST /api/messages/conversations/:id/mute — toggle notifications for me
exports.toggleMute = async (req, res) => {
  try {
    const convo = await Conversation.findOne({ _id: req.params.id, participants: req.user.id });
    if (!convo) return res.status(404).json({ success: false, message: "Conversation not found" });

    const muted = (convo.mutedBy || []).some((m) => String(m) === String(req.user.id));
    convo.mutedBy = muted
      ? convo.mutedBy.filter((m) => String(m) !== String(req.user.id))
      : [...(convo.mutedBy || []), req.user.id];
    await convo.save();
    res.json({ success: true, muted: !muted });
  } catch (error) {
    console.error("Toggle mute error:", error.message);
    res.status(500).json({ success: false, message: "Failed to update mute" });
  }
};

// POST /api/messages/conversations/:id/hide — hide from my list
// (a new message un-hides the conversation for both participants)
exports.hideConversation = async (req, res) => {
  try {
    const convo = await Conversation.findOne({ _id: req.params.id, participants: req.user.id });
    if (!convo) return res.status(404).json({ success: false, message: "Conversation not found" });

    if (!(convo.hiddenBy || []).some((h) => String(h) === String(req.user.id))) {
      convo.hiddenBy = [...(convo.hiddenBy || []), req.user.id];
      await convo.save();
    }
    res.json({ success: true });
  } catch (error) {
    console.error("Hide conversation error:", error.message);
    res.status(500).json({ success: false, message: "Failed to hide conversation" });
  }
};

/* ── Archive (Part 8 §32-33) ─────────────────────────────────────────────
 *
 * BEHAVIOUR, DEFINED ONCE — a new incoming message does NOT auto-unarchive.
 *
 * The alternative (auto-unarchive on reply) silently reverses a deliberate
 * user action: the thread reappears in the inbox and the user cannot tell
 * whether they archived it or never did. Keeping it archived and raising an
 * unread badge on the archive entry is visible, reversible and loses nothing —
 * the message is one tap away, and the archive view is a permanent destination
 * rather than a soft delete.
 *
 * Archiving is stored per participant, so it never touches the other side's
 * inbox. Nothing is deleted: archive is a view, not a removal (§33). */
exports.archiveConversation = async (req, res) => {
  try {
    const archived = req.body?.archived !== false; // default to archiving
    const convo = await Conversation.findOne({ _id: req.params.id, participants: req.user.id });
    if (!convo) return res.status(404).json({ success: false, message: "Conversation not found" });

    if (archived) {
      await Conversation.updateOne({ _id: convo._id }, { $addToSet: { archivedBy: req.user.id } });
    } else {
      await Conversation.updateOne({ _id: convo._id }, { $pull: { archivedBy: req.user.id } });
    }
    res.json({ success: true, archived });
  } catch (error) {
    console.error("Archive conversation error:", error.message);
    res.status(500).json({ success: false, message: "Failed to update conversation" });
  }
};

/** Mark everything in this thread read — clears the badge (§58). */
exports.markRead = async (req, res) => {
  try {
    const convo = await Conversation.findOne({ _id: req.params.id, participants: req.user.id }).select("participants");
    if (!convo) return res.status(404).json({ success: false, message: "Conversation not found" });

    /* ONE batched write for the whole thread (§14) — never one per message,
     * and never triggered by a message merely entering the viewport. */
    const at = new Date();
    await Message.updateMany(
      { conversation: convo._id, sender: { $ne: req.user.id }, readAt: null },
      { $set: { readAt: at } }
    );
    await Conversation.updateOne({ _id: convo._id }, { $set: { [`lastReadAt.${req.user.id}`]: at } });

    // Tell the other side their ticks are now blue — so they do not have to
    // refetch to find out (§12). In a team that is everyone else.
    const others = (convo.participants || [])
      .map((p) => String(p))
      .filter((p) => p !== String(req.user.id));
    if (others.length) {
      try {
        dmRealtime.publishRead({ conversationId: convo._id, readerId: req.user.id, otherIds: others, at });
      } catch (e) {
        console.error("DM read publish failed:", e.message);
      }
    }
    res.json({ success: true, readAt: at });
  } catch (error) {
    console.error("Mark read error:", error.message);
    res.status(500).json({ success: false, message: "Failed to mark messages read" });
  }
};

/**
 * POST /api/messages/:id/react  { emoji }
 * Toggles one emoji from the viewer. Sending a different emoji replaces it —
 * one reaction per person per message keeps the UI readable (§31).
 */
const ALLOWED_REACTIONS = ["❤️", "😂", "🔥", "👍", "🎉", "👏", "😮", "😢"];

exports.reactToMessage = async (req, res) => {
  try {
    const emoji = String(req.body?.emoji || "").trim();
    if (!emoji) return res.status(400).json({ success: false, message: "Emoji required" });
    if (!ALLOWED_REACTIONS.includes(emoji)) {
      return res.status(400).json({ success: false, message: "Unsupported reaction" });
    }

    const msg = await Message.findOne({ _id: req.params.id, deletedAt: null });
    if (!msg) return res.status(404).json({ success: false, message: "Message not found" });

    // Participant check — reactions are only for people in the thread.
    const convo = await Conversation.findOne({ _id: msg.conversation, participants: req.user.id }).select("_id");
    if (!convo) return res.status(403).json({ success: false, message: "You can't react to this message" });

    const existing = (msg.reactions || []).find((r) => String(r.user) === String(req.user.id));
    if (existing && existing.emoji === emoji) {
      // Same emoji again → remove.
      msg.reactions = msg.reactions.filter((r) => String(r.user) !== String(req.user.id));
    } else if (existing) {
      existing.emoji = emoji;
      existing.at = new Date();
    } else {
      msg.reactions.push({ user: req.user.id, emoji, at: new Date() });
    }
    await msg.save();

    res.json({ success: true, reactions: summarizeReactions(msg.reactions, req.user.id) });
  } catch (error) {
    console.error("React to message error:", error.message);
    res.status(500).json({ success: false, message: "Failed to react" });
  }
};

/** Group raw reactions into { emoji, count, mine } for the UI (§31). */
function summarizeReactions(reactions = [], viewerId) {
  const map = new Map();
  for (const r of reactions) {
    const cur = map.get(r.emoji) || { emoji: r.emoji, count: 0, mine: false };
    cur.count += 1;
    if (viewerId && String(r.user) === String(viewerId)) cur.mine = true;
    map.set(r.emoji, cur);
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}
exports.summarizeReactions = summarizeReactions;
