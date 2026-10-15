const express = require("express");
// Part 5, Phase 2 — registration bucket + double-submit guard (§24, §28)
const { limiters } = require("../config/rate-limits");
const { idempotencyWindow } = require("../middleware/idempotency");

const router = express.Router();
const registrationController = require("../controllers/registration.controller");
const { requireAuth, optionalUser, requireEventManager } = require("../middleware/auth.middleware");

// Public: get registration form for an event
router.get("/form/:eventId", optionalUser, registrationController.getForm);

// User routes
router.post("/responses", requireAuth, idempotencyWindow, limiters.event, registrationController.submitResponse);
router.get("/responses/status/:eventId", requireAuth, registrationController.getRegistrationStatus);
router.get("/user/events", requireAuth, registrationController.getUserEvents);

// Public: registration counts only (no personal data) — used by public event cards
router.post("/responses/counts/batch", registrationController.getRegistrationCounts);
router.get("/responses/:eventId/count", registrationController.getRegistrationCount);

// Admin routes
router.get("/responses/:eventId", requireAuth, requireEventManager, registrationController.getEventResponses);
router.get("/responses/:eventId/export", requireAuth, requireEventManager, registrationController.exportRegistrations);
router.get("/responses/:id/stats", requireAuth, requireEventManager, registrationController.getRegistrationStats);

module.exports = router;
