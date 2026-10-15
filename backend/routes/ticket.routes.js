// routes/ticket.routes.js
const express = require("express");
const { idempotencyWindow } = require("../middleware/idempotency");
// Part 5, Phase 2 — ticket generate + door-scan guard (§24, §27)
const { limiters } = require("../config/rate-limits");
const { actionGuard } = require("../middleware/action-guard");

const router = express.Router();
const ticketController = require("../controllers/ticket.controller");
const { requireAuth, requireEventManager } = require("../middleware/auth.middleware");

// User routes
router.post("/generate", requireAuth, idempotencyWindow, limiters.event, ticketController.generateTicket);
router.get("/user-tickets", requireAuth, ticketController.getUserTickets);

// Event-specific operational management: owners/admins and active Organization
// EVENT_MANAGERs for explicitly Organization-owned Events.
router.post("/bulk-generate", requireAuth, requireEventManager, idempotencyWindow, ticketController.generateBulkTickets);
router.post("/approve-pending", requireAuth, limiters.event, idempotencyWindow, ticketController.approvePendingTickets);
router.get("/pending/:eventId", requireAuth, requireEventManager, ticketController.getPendingTickets);
router.post("/send-ticket", requireAuth, limiters.event, idempotencyWindow, ticketController.sendTicketToUser);

router.post("/scan", requireAuth, actionGuard("GUARD_TICKET_SCAN"), ticketController.scanTicket);
router.get("/token/:token", requireAuth, ticketController.getTicketByToken);

router.get("/event/:eventId/stats", requireAuth, requireEventManager, ticketController.getEventScanStats);
router.get("/event/:eventId/recent-scans", requireAuth, requireEventManager, ticketController.getRecentScans);
router.get("/event/:eventId/scanned-tickets", requireAuth, requireEventManager, ticketController.getEventScannedTickets);

module.exports = router;
