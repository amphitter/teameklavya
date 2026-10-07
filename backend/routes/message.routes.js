/**
 * EventHub Message Routes — direct messages
 * ─────────────────────────────────────────
 *  GET  /api/messages/conversations          my conversations (auth)
 *  POST /api/messages/conversations          get-or-create with { userId } (auth)
 *  GET  /api/messages/conversations/:id      messages in a conversation (auth, participant only)
 *  POST /api/messages/conversations/:id      send message (auth, participant only)
 *  GET  /api/messages/unread-count           badge count (auth)
 *  DELETE /api/messages/:id                  unsend own message (auth)
 *  POST /api/messages/conversations/:id/mute toggle chat notifications (auth)
 *  POST /api/messages/conversations/:id/hide hide chat until next message (auth)
 *  POST /api/messages/conversations/:id/archive archive/unarchive (auth) — Part 8 §32
 *  GET  /api/messages/conversations?view=archived             archived inbox (auth)
 *  POST /api/messages/conversations/:id/read    mark thread read (auth)
 *  POST /api/messages/:id/react  { emoji }      toggle a reaction (auth) — Part 8 §31
 */
const express = require("express");
// Part 5, Phase 2 — messaging send bucket (§24)
const { limiters } = require("../config/rate-limits");

const router = express.Router();
const { requireAuth } = require("../middleware/auth.middleware");
const messageController = require("../controllers/message.controller");

router.get("/conversations", requireAuth, messageController.getConversations);
router.post("/conversations", requireAuth, limiters.messaging, messageController.startConversation);
router.get("/conversations/:id", requireAuth, messageController.getMessages);
router.post("/conversations/:id", requireAuth, limiters.messaging, messageController.sendMessage);
router.get("/unread-count", requireAuth, messageController.getUnreadCount);
// Part 10 §25 — server-side search. Must precede /:id so "search"
// is not captured as a message id.
router.get("/search", requireAuth, messageController.searchMessages);
router.delete("/:id", requireAuth, messageController.deleteMessage);
router.post("/conversations/:id/mute", requireAuth, messageController.toggleMute);
router.post("/conversations/:id/hide", requireAuth, messageController.hideConversation);
router.post("/conversations/:id/archive", requireAuth, messageController.archiveConversation);
router.post("/conversations/:id/read", requireAuth, messageController.markRead);
router.post("/:id/react", requireAuth, limiters.messaging, messageController.reactToMessage);

module.exports = router;
