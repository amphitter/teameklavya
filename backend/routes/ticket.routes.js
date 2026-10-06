// routes/ticket.routes.js
const express = require("express");
// Part 5, Phase 2 — ticket generate + door-scan guard (§24, §27)
const { limiters } = require("../config/rate-limits");
const { actionGuard } = require("../middleware/action-guard");

const router = express.Router();
const ticketController = require("../controllers/ticket.controller");
const { requireAuth, requireAdmin } = require("../middleware/auth.middleware");

// User routes
router.post("/generate", requireAuth, limiters.event, ticketController.generateTicket);
router.get("/user-tickets", requireAuth, ticketController.getUserTickets);

// Admin ticket management routes
router.post("/bulk-generate", requireAuth, requireAdmin, ticketController.generateBulkTickets);
router.post("/approve-pending", requireAuth, requireAdmin, ticketController.approvePendingTickets);
router.get("/pending/:eventId", requireAuth, requireAdmin, ticketController.getPendingTickets);
router.post("/send-ticket", requireAuth, requireAdmin, ticketController.sendTicketToUser);

// Scan routes (admin only)
router.post("/scan", requireAuth, requireAdmin, actionGuard("GUARD_TICKET_SCAN"), ticketController.scanTicket);
router.get("/token/:token", requireAuth, requireAdmin, ticketController.getTicketByToken);

// Analytics routes (admin only)
router.get("/event/:eventId/stats", requireAuth, requireAdmin, ticketController.getEventScanStats);
router.get("/event/:eventId/recent-scans", requireAuth, requireAdmin, ticketController.getRecentScans);
router.get("/event/:eventId/scanned-tickets", requireAuth, requireAdmin, ticketController.getEventScannedTickets);

module.exports = router;