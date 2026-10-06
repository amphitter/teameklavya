const mongoose = require("mongoose");
const { isBlockedBetween, isFollowerOf } = require("../services/social.service");
const Conversation = require("../models/conversation.model");
const Message = require("../models/message.model");
const User = require("../models/user.model");
const Notification = require("../models/notification.model");

const USER_FIELDS = "firstName lastName username profile";

/** Find (or create) the 1:1 conversation between me and another user. */
async function getOrCreateConversation(me, other) {
  const sorted = [String(me), String(other)].sort();
  let convo = await Conversation.findOne({ participants: sorted });
  if (!convo) {
    try {
      convo = await Conversation.create({ participants: sorted });
    } catch (err) {
      // Race: unique index — re-fetch
      convo = await Conversation.findOne({ participants: sorted });
    }
  }
  return convo;
}

// GET /api/messages/conversations
exports.getConversations = async (req, res) => {
  try {
    // Hidden conversations stay out of the list (a new message un-hides them)
    const convos = await Conversation.find({ participants: req.user.id, hiddenBy: { $ne: req.user.id } })
      .sort({ updatedAt: -1 })
      .limit(50)
      .populate("participants", USER_FIELDS)
      .populate("lastMessage.sender", USER_FIELDS)
      .lean();

    const otherIds = convos.map((c) => c.participants.find((p) => String(p._id) !== String(req.user.id))?._id).filter(Boolean);
    const unreadAgg = await Message.aggregate([
      { $match: { conversation: { $in: convos.map((c) => c._id) }, sender: { $ne: new mongoose.Types.ObjectId(req.user.id) }, readAt: null } },
      { $group: { _id: "$conversation", count: { $sum: 1 } } },
    ]);
    const unreadMap = new Map(unreadAgg.map((r) => [String(r._id), r.count]));

    const list = convos.map((c) => {
      const other = c.participants.find((p) => String(p._id) !== String(req.user.id)) || null;
      return {
        _id: c._id,
        other,
        lastMessage: c.lastMessage?.text
          ? {
              text: c.lastMessage.text,
              at: c.lastMessage.at,
              mine: String(c.lastMessage.sender?._id || c.lastMessage.sender) === String(req.user.id),
            }
          : null,
        updatedAt: c.updatedAt,
        unreadCount: unreadMap.get(String(c._id)) || 0,
        muted: (c.mutedBy || []).some((m) => String(m) === String(req.user.id)),
      };
    });

    res.json({ success: true, conversations: list });
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
exports.getMessages = async (req, res) => {
  try {
    const convo = await Conversation.findOne({ _id: req.params.id, participants: req.user.id });
    if (!convo) return res.status(404).json({ success: false, message: "Conversation not found" });

    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
    const [messages, other] = await Promise.all([
      Message.find({ conversation: convo._id }).sort({ createdAt: -1 }).limit(limit).populate("sender", USER_FIELDS).lean(),
      User.findById(convo.participants.find((p) => String(p) !== String(req.user.id))).select(USER_FIELDS).lean(),
    ]);

    // Mark the other person's messages as read
    await Message.updateMany({ conversation: convo._id, sender: { $ne: req.user.id }, readAt: null }, { readAt: new Date() });
    // The user has now seen this conversation — drop its pending
    // missed-message notifications (no stale unread bell entries)
    await Notification.deleteMany({ user: req.user.id, type: "message", read: false, conversation: convo._id }).catch(() => {});

    const muted = (convo.mutedBy || []).some((m) => String(m) === String(req.user.id));
    res.json({ success: true, messages: messages.reverse(), other, conversationId: convo._id, muted });
  } catch (error) {
    console.error("Get messages error:", error.message);
    res.status(500).json({ success: false, message: "Failed to load messages" });
  }
};

// POST /api/messages/conversations/:id  { content, image? }
exports.sendMessage = async (req, res) => {
  try {
    const content = String(req.body.content || "").trim();
    const image = String(req.body.image || "").trim();
    if (!content && !image) {
      return res.status(400).json({ success: false, message: "Message can't be empty" });
    }
    if (content && image) {
      return res.status(400).json({ success: false, message: "Send text or a photo, not both" });
    }

    const convo = await Conversation.findOne({ _id: req.params.id, participants: req.user.id });
    if (!convo) return res.status(404).json({ success: false, message: "Conversation not found" });

    // A block added later must silence existing conversations too
    const otherId = convo.participants.find((p) => String(p) !== String(req.user.id));
    if (otherId && (await isBlockedBetween(req.user.id, otherId))) {
      return res.status(403).json({ success: false, message: "You can't message this user" });
    }

    const message = await Message.create({ conversation: convo._id, sender: req.user.id, content, image });

    // Un-hide for both participants (a new message revives a hidden chat)
    convo.hiddenBy = [];
    convo.lastMessage = { text: (content || "Photo").slice(0, 200), sender: req.user.id, at: new Date() };
    await convo.save();

    // Missed-message notification: only when the recipient hasn't muted the
    // conversation. Deduped to the LATEST unread message per conversation.
    if (otherId) {
      try {
        const recipientMuted = (convo.mutedBy || []).some((m) => String(m) === String(otherId));
        if (!recipientMuted) {
          await Notification.deleteMany({ user: otherId, type: "message", read: false, conversation: convo._id });
          const { notify } = require("../services/notification.service");
          notify({ user: otherId, actor: req.user.id, type: "message", conversation: convo._id });
        }
      } catch (notifyErr) {
        console.error("Message notify error:", notifyErr.message);
      }
    }

    const populated = await Message.findById(message._id).populate("sender", USER_FIELDS).lean();
    res.status(201).json({ success: true, message: populated });
  } catch (error) {
    console.error("Send message error:", error.message);
    res.status(500).json({ success: false, message: "Failed to send message" });
  }
};

// GET /api/messages/unread-count
exports.getUnreadCount = async (req, res) => {
  try {
    const convos = await Conversation.find({ participants: req.user.id }).select("_id").lean();
    const unreadCount = await Message.countDocuments({
      conversation: { $in: convos.map((c) => c._id) },
      sender: { $ne: req.user.id },
      readAt: null,
    });
    res.json({ success: true, unreadCount });
  } catch (error) {
    console.error("Unread messages error:", error.message);
    res.status(500).json({ success: false, message: "Failed to load unread count" });
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
