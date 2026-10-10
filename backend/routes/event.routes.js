// routes/event.routes.js
const express = require("express");
const { idempotencyWindow } = require("../middleware/idempotency");
// Part 5, Phase 2 — event action bucket (§24)
const { limiters } = require("../config/rate-limits");

const router = express.Router();
const eventController = require("../controllers/event.controller");
const communicationController = require("../controllers/communication.controller");
const {
  requireAuth,
  requireAdmin,
  optionalUser,
  requireEventManager,
} = require("../middleware/auth.middleware");
const { requireEventCreation } = require("../middleware/enforcement.middleware");

// Public routes
router.get("/", eventController.getEvents);
router.get("/meta/categories", eventController.getEventCategories);
router.get("/slug/:slug", optionalUser, eventController.getEventBySlug);
router.get("/trending", optionalUser, eventController.getTrendingEvents);
router.get("/for-you", requireAuth, eventController.getEventsForYou);

// Platform-wide administration stays admin-only. Event-scoped operations use
// the explicit owner-aware backend guard below.
router.get("/admin/list", requireAuth, requireAdmin, eventController.getAdminEvents);
router.get("/admin/with-stats", requireAuth, requireAdmin, eventController.getEventsWithTicketStats);
router.post("/", requireAuth, requireEventCreation, idempotencyWindow, eventController.createEvent);
router.get("/:id/communications", requireAuth, requireEventManager, communicationController.listEventCommunications);
router.get("/:id/communications/:communicationId/deliveries", requireAuth, requireEventManager, communicationController.listDeliveries);
router.post("/:id/communications", requireAuth, requireEventManager, limiters.communication, communicationController.sendEventMessage);
router.get("/organization/:organizationId/manage", requireAuth, eventController.getOrganizationManagedEvents);
router.get("/:id", requireAuth, requireEventManager, eventController.getEventById);
router.get("/:id/participants", optionalUser, eventController.getEventParticipants);
router.get("/:id/interest", optionalUser, eventController.getEventInterest);
router.post("/:id/interest", requireAuth, limiters.event, eventController.toggleEventInterest);
router.put("/:id", requireAuth, requireEventManager, eventController.updateEvent);
router.patch("/:id/archive", requireAuth, requireEventManager, eventController.setEventArchived);
// Hard deletion is intentionally not included in Organization Event Manager scope.
router.delete("/:id", requireAuth, requireAdmin, eventController.deleteEvent);

// Event-scoped RSVP/invitation actions. Global all-user announcements remain
// platform-admin-only because they are not limited to the Event audience.
router.post("/rsvp/send-with-verification", requireAuth, requireEventManager, limiters.communication, eventController.sendRSVPWithVerification);
router.get("/rsvp/verify/:token", eventController.verifyRSVP);
router.get("/:id/rsvp-analytics", requireAuth, requireEventManager, eventController.getRSVPAnalytics);
router.post("/send-rsvp", requireAuth, requireEventManager, limiters.communication, eventController.sendRSVP);
router.post("/:id/notify-all", requireAuth, requireAdmin, limiters.communication, eventController.sendEventNotificationToAllUsers);

// Analytics and settings
router.get("/:id/stats", requireAuth, requireEventManager, eventController.getEventStats);
router.get("/:id/analytics", requireAuth, eventController.getEventAnalytics); // controller performs owner check
router.patch("/:id/ticket-settings", requireAuth, requireEventManager, eventController.updateTicketSettings);

// ── Master Refactor: Institution–Club Approval Workflow ──
// Institution queue & club proposals (specific before :id)
router.get("/approvals/institution/:institutionId/queue", requireAuth, eventController.getInstitutionApprovalQueue);
router.get("/approvals/club/:clubId/proposals", requireAuth, eventController.getClubProposals);
router.get("/:id/approval-history", requireAuth, eventController.getEventApprovalHistory);
router.post("/:id/approve", requireAuth, eventController.approveEventProposal);
router.post("/:id/reject", requireAuth, eventController.rejectEventProposal);
router.post("/:id/request-changes", requireAuth, eventController.requestEventChanges);
router.post("/:id/resubmit", requireAuth, eventController.resubmitEventProposal);
router.post("/:id/cancel", requireAuth, eventController.cancelEventProposal);
router.patch("/:id/with-reapproval", requireAuth, eventController.updateEventWithReapprovalCheck);

// Live Event Engine (Part 4)
router.get("/:id/live-settings", requireAuth, eventController.getLiveSettings);
router.put("/:id/live-settings", requireAuth, eventController.updateLiveSettings);
router.post("/:id/join-code/regenerate", requireAuth, eventController.regenerateJoinCode);
router.get("/:id/live/state", requireAuth, require("../controllers/live.controller").getLiveState);
router.get("/:id/results", requireAuth, require("../controllers/live.controller").getEventResults);
router.get("/:id/live/eligibility", requireAuth, require("../controllers/live.controller").getJoinEligibility);
router.post("/join-by-code", requireAuth, limiters.event, require("../controllers/live.controller").joinByCode);

module.exports = router;
