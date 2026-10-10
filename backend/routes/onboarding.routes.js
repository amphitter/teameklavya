"use strict";

const express = require("express");
const router = express.Router();
const { requireAuth } = require("../middleware/auth.middleware");
const { idempotencyWindow } = require("../middleware/idempotency");
const controller = require("../controllers/onboarding.controller");
const { limiters } = require("../config/rate-limits");

// All onboarding routes require auth
router.get("/status", requireAuth, controller.getStatus);
router.get("/institutions", requireAuth, controller.listInstitutions);
router.post("/username", requireAuth, limiters.social, idempotencyWindow, controller.setUsername);
router.post("/age-confirm", requireAuth, controller.confirmAge);
router.put("/privacy", requireAuth, controller.setPrivacy);
router.post("/media", requireAuth, limiters.uploadBurst, controller.setMedia);
router.put("/bio", requireAuth, limiters.social, controller.setBio);
router.put("/institution", requireAuth, controller.setInstitution);
router.put("/interests", requireAuth, controller.setInterests);
router.post("/complete", requireAuth, controller.complete);

// Public username check (but with auth optional for privacy? We require auth to prevent enumeration? Spec says prevent enumeration, but we allow with auth)
// For availability, we allow authenticated users
router.get("/check-username", requireAuth, controller.checkUsername);

module.exports = router;
