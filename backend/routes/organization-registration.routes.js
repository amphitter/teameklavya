"use strict";

const express = require("express");
const router = express.Router();
const { requireAuth, requireSuperAdmin } = require("../middleware/auth.middleware");
const { idempotencyWindow } = require("../middleware/idempotency");
const { limiters, isRateLimitingDisabled } = require("../config/rate-limits");
const rateLimit = require("express-rate-limit");
const controller = require("../controllers/organization-registration.controller");

// Rate limit for creation - 10 per 15 min per user, respects RATE_LIMIT_DISABLED
const createLimiter = (() => {
  if (isRateLimitingDisabled()) return (req, _res, next) => next();
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      const id = req.user && (req.user._id || req.user.id);
      return id ? `u:${id}` : req.ip;
    },
    message: { success: false, message: "Too many registration requests, try later" },
  });
})();

// Applicant routes
router.post("/", requireAuth, createLimiter, idempotencyWindow, controller.createRequest);
router.get("/mine", requireAuth, controller.listMyRequests);
router.get("/mine/:id", requireAuth, controller.getMyRequest);
router.get("/parent-institutions", requireAuth, controller.listParentInstitutions);
router.patch("/:id", requireAuth, controller.updateMyRequest);
router.post("/:id/submit", requireAuth, controller.submitDraft);
router.post("/:id/withdraw", requireAuth, controller.withdrawRequest);
router.post("/:id/resubmit", requireAuth, controller.resubmitRequest);
router.get("/:id", requireAuth, controller.getMyRequest); // alias, but will check ownership - for applicant, same as mine/:id but we keep both

// Super Admin routes (separate router mount will also use requireSuperAdmin, but we enforce here too)
router.get("/admin/list", requireAuth, requireSuperAdmin, controller.listAllRequests);
router.get("/admin/:id", requireAuth, requireSuperAdmin, controller.getRequestDetail);
router.get("/admin/:id/history", requireAuth, requireSuperAdmin, controller.getHistory);
router.post("/admin/:id/approve", requireAuth, requireSuperAdmin, idempotencyWindow, controller.approve);
router.post("/admin/:id/reject", requireAuth, requireSuperAdmin, controller.reject);
router.post("/admin/:id/request-info", requireAuth, requireSuperAdmin, controller.requestInfo);

module.exports = router;
