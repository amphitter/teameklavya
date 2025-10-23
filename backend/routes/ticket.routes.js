// routes/ticket.routes.js
const express = require("express");
const router = express.Router();
const ticketController = require("../controllers/ticket.controller");
const { requireAuth, requireAdmin } = require("../middleware/auth.middleware");

// User routes
router.post("/generate", requireAuth, ticketController.generateTicket);
router.get("/user-tickets", requireAuth, ticketController.getUserTickets);
router.get("/download/:filename", requireAuth, ticketController.downloadTicket);

// Admin ticket management routes
router.post("/bulk-generate", requireAuth, requireAdmin, ticketController.generateBulkTickets);
router.post("/approve-pending", requireAuth, requireAdmin, ticketController.approvePendingTickets);
router.get("/pending/:eventId", requireAuth, requireAdmin, ticketController.getPendingTickets);
router.post("/send-ticket", requireAuth, requireAdmin, ticketController.sendTicketToUser);

// Scan routes (admin only)
router.post("/scan", requireAuth, requireAdmin, ticketController.scanTicket);
router.get("/token/:token", requireAuth, requireAdmin, ticketController.getTicketByToken);

// Analytics routes (admin only)
router.get("/event/:eventId/stats", requireAuth, requireAdmin, ticketController.getEventScanStats);
router.get("/event/:eventId/recent-scans", requireAuth, requireAdmin, ticketController.getRecentScans);
router.get("/event/:eventId/scanned-tickets", requireAuth, requireAdmin, ticketController.getEventScannedTickets);

module.exports = router;