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
router.delete("/:id", requireAuth, messageController.deleteMessage);
router.post("/conversations/:id/mute", requireAuth, messageController.toggleMute);
router.post("/conversations/:id/hide", requireAuth, messageController.hideConversation);

module.exports = router;
