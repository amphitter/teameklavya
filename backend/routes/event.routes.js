// routes/event.routes.js
const express = require("express");
const router = express.Router();
const eventController = require("../controllers/event.controller");
const { requireAuth, requireAdmin } = require("../middleware/auth.middleware");

// Public routes
router.get("/", eventController.getEvents);
router.get("/slug/:slug", eventController.getEventBySlug);

// Admin routes - require authentication and admin role
router.get("/admin/list", requireAuth, requireAdmin, eventController.getAdminEvents);
router.get("/admin/with-stats", requireAuth, requireAdmin, eventController.getEventsWithTicketStats);
router.post("/", requireAuth, requireAdmin, eventController.createEvent);
router.get("/:id", requireAuth, requireAdmin, eventController.getEventById);
router.put("/:id", requireAuth, requireAdmin, eventController.updateEvent);
router.delete("/:id", requireAuth, requireAdmin, eventController.deleteEvent);

// RSVP and Communication routes
// Add these routes to your event routes file
router.post('/rsvp/send-with-verification', requireAuth, eventController.sendRSVPWithVerification);
router.get('/rsvp/verify/:token', eventController.verifyRSVP);
router.get('/:id/rsvp-analytics', requireAuth, eventController.getRSVPAnalytics);
router.post("/send-rsvp", requireAuth, requireAdmin, eventController.sendRSVP);
router.post("/:id/notify-all", requireAuth, requireAdmin, eventController.sendEventNotificationToAllUsers);

// Analytics and Settings routes
router.get("/:id/stats", requireAuth, requireAdmin, eventController.getEventStats);
router.patch("/:id/ticket-settings", requireAuth, requireAdmin, eventController.updateTicketSettings);

module.exports = router;