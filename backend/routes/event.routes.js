// routes/event.routes.js
const express = require("express");
// Part 5, Phase 2 — event action bucket (§24)
const { limiters } = require("../config/rate-limits");

const router = express.Router();
const eventController = require("../controllers/event.controller");
const { requireAuth, requireAdmin, optionalUser } = require("../middleware/auth.middleware");

// Public routes
router.get("/", eventController.getEvents);
router.get("/meta/categories", eventController.getEventCategories);
router.get("/slug/:slug", optionalUser, eventController.getEventBySlug);

// Admin routes - require authentication and admin role
router.get("/admin/list", requireAuth, requireAdmin, eventController.getAdminEvents);
router.get("/admin/with-stats", requireAuth, requireAdmin, eventController.getEventsWithTicketStats);
router.post("/", requireAuth, requireAdmin, eventController.createEvent);
router.get("/trending", optionalUser, eventController.getTrendingEvents);
router.get("/for-you", requireAuth, eventController.getEventsForYou);
router.get("/:id", requireAuth, requireAdmin, eventController.getEventById);
router.get("/:id/participants", eventController.getEventParticipants);
router.get("/:id/interest", optionalUser, eventController.getEventInterest);
router.post("/:id/interest", requireAuth, limiters.event, eventController.toggleEventInterest);
router.put("/:id", requireAuth, requireAdmin, eventController.updateEvent);
router.delete("/:id", requireAuth, requireAdmin, eventController.deleteEvent);

// RSVP and Communication routes
router.post('/rsvp/send-with-verification', requireAuth, requireAdmin, eventController.sendRSVPWithVerification);
router.get('/rsvp/verify/:token', eventController.verifyRSVP);
router.get('/:id/rsvp-analytics', requireAuth, requireAdmin, eventController.getRSVPAnalytics);
router.post("/send-rsvp", requireAuth, requireAdmin, eventController.sendRSVP);
router.post("/:id/notify-all", requireAuth, requireAdmin, eventController.sendEventNotificationToAllUsers);

// Analytics and Settings routes
router.get("/:id/stats", requireAuth, requireAdmin, eventController.getEventStats);

// Live Event Engine (Part 4, Phase 1)
router.get("/:id/live-settings", requireAuth, eventController.getLiveSettings);
router.put("/:id/live-settings", requireAuth, eventController.updateLiveSettings);
router.post("/:id/join-code/regenerate", requireAuth, eventController.regenerateJoinCode);

// Live Event Engine realtime endpoints (Part 4, Phase 2)
const liveController = require("../controllers/live.controller");
router.get("/:id/live/state", requireAuth, liveController.getLiveState);
router.get("/:id/results", requireAuth, liveController.getEventResults); // Phase 8 — post-event snapshot
router.get("/:id/live/eligibility", requireAuth, liveController.getJoinEligibility);
router.post("/join-by-code", requireAuth, limiters.event, liveController.joinByCode);
router.get("/:id/analytics", requireAuth, eventController.getEventAnalytics);
router.patch("/:id/ticket-settings", requireAuth, requireAdmin, eventController.updateTicketSettings);

module.exports = router;