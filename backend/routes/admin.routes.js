const express = require("express");
const router = express.Router();
const { requireAuth, requireAdmin } = require("../middleware/auth.middleware");
const adminController = require("../controllers/admin.controller");

router.get("/stats", requireAuth, requireAdmin, adminController.getDashboardStats);
router.get("/users", requireAuth, requireAdmin, adminController.getAllUsers);
router.get("/users/export", requireAuth, requireAdmin, adminController.exportUsersCSV);
router.get("/events", requireAuth, requireAdmin, adminController.getAdminEvents);
router.get("/activity", requireAuth, requireAdmin, adminController.getRecentActivity);
router.get("/analytics", requireAuth, requireAdmin, adminController.getAnalytics);
// Part 5, Phase 7 (§59/§60/§61) — admin-only; exposes provider budgets
router.get("/infrastructure", requireAuth, requireAdmin, adminController.getInfrastructure);
module.exports = router;
