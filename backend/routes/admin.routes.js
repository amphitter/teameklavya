const express = require("express");
const router = express.Router();
const { requireAuth, requireAdmin } = require("../middleware/auth.middleware");
const { limiters } = require("../config/rate-limits");
const adminController = require("../controllers/admin.controller");
const communicationController = require("../controllers/communication.controller");

router.get("/stats", requireAuth, requireAdmin, adminController.getDashboardStats);
router.get("/users", requireAuth, requireAdmin, adminController.getAllUsers);
router.get("/users/export", requireAuth, requireAdmin, adminController.exportUsersCSV);
router.get("/events", requireAuth, requireAdmin, adminController.getAdminEvents);
router.get("/activity", requireAuth, requireAdmin, adminController.getRecentActivity);
router.get("/analytics", requireAuth, requireAdmin, adminController.getAnalytics);
// Part 5, Phase 7 (§59/§60/§61) — admin-only; exposes provider budgets
router.get("/infrastructure", requireAuth, requireAdmin, adminController.getInfrastructure);

// Part 8 — platform-wide communications and recipient-level delivery history.
router.get("/communications", requireAuth, requireAdmin, communicationController.listAdminCommunications);
router.get("/communications/:communicationId/deliveries", requireAuth, requireAdmin, communicationController.listDeliveries);
router.post("/communications/platform", requireAuth, requireAdmin, limiters.communication, communicationController.sendPlatformMessage);
module.exports = router;
