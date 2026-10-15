"use strict";

const express = require("express");
const router = express.Router();
const { requireAuth, requireSuperAdmin } = require("../middleware/auth.middleware");
const { idempotencyWindow } = require("../middleware/idempotency");
const { isRateLimitingDisabled } = require("../config/rate-limits");
const controller = require("../controllers/organization-registration.controller");

// Rate limit for creation - 10 per 15 min per user, respects RATE_LIMIT_DISABLED
// Fixed IPv6-safe key generator using ipKeyGenerator (was req.ip directly -> ERR_ERL_KEY_GEN_IPV6)
const orgRegCreateLimiter = (() => {
  if (isRateLimitingDisabled()) return (req, _res, next) => next();
  const { ipKeyGenerator } = require("express-rate-limit");
  const rateLimit = require("express-rate-limit").rateLimit || require("express-rate-limit");
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      const id = req.user && (req.user._id || req.user.id);
      if (id) return `u:${id}`;
      const ip = req.ip || (req.socket && req.socket.remoteAddress) || "unknown";
      try {
        return `ip:${ipKeyGenerator(ip)}`;
      } catch {
        return `ip:${ip}`;
      }
    },
    handler: (req, res, next) => {
      const { RateLimitError } = require("../utils/app-error");
      const resetTime = req.rateLimit && req.rateLimit.resetTime;
      const retryAfterMs = resetTime instanceof Date ? Math.max(1000, resetTime.getTime() - Date.now()) : 15 * 60 * 1000;
      next(new RateLimitError("Too many registration requests, try later", retryAfterMs));
    },
  });
})();

// Applicant routes
router.post("/", requireAuth, orgRegCreateLimiter, idempotencyWindow, controller.createRequest);
router.get("/mine", requireAuth, controller.listMyRequests);
router.get("/mine/:id", requireAuth, controller.getMyRequest);
router.get("/parent-institutions", requireAuth, controller.listParentInstitutions);
router.patch("/:id", requireAuth, controller.updateMyRequest);
router.post("/:id/submit", requireAuth, controller.submitDraft);
router.post("/:id/withdraw", requireAuth, controller.withdrawRequest);
router.post("/:id/resubmit", requireAuth, controller.resubmitRequest);
router.get("/:id", requireAuth, controller.getMyRequest);

// Super Admin routes
router.get("/admin/list", requireAuth, requireSuperAdmin, controller.listAllRequests);
router.get("/admin/:id", requireAuth, requireSuperAdmin, controller.getRequestDetail);
router.get("/admin/:id/history", requireAuth, requireSuperAdmin, controller.getHistory);
router.post("/admin/:id/approve", requireAuth, requireSuperAdmin, idempotencyWindow, controller.approve);
router.post("/admin/:id/reject", requireAuth, requireSuperAdmin, controller.reject);
router.post("/admin/:id/request-info", requireAuth, requireSuperAdmin, controller.requestInfo);

module.exports = router;
