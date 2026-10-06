/**
 * EventHub Moderation Routes (Part 3, Phase 10)
 * ─────────────────────────────────────────────
 *  POST /api/moderation/reports              report content (auth)
 *  GET  /api/moderation/reports?status=      queue — admin only
 *  GET  /api/moderation/my-reports           my reports (auth)
 *  POST /api/moderation/reports/:id/resolve  act/dismiss — admin only
 *  POST /api/moderation/suspend-user         admin only
 *  POST /api/moderation/unsuspend-user       admin only
 *  GET  /api/moderation/stats                admin only
 */
const express = require("express");
const router = express.Router();
const { requireAuth, requireAdmin } = require("../middleware/auth.middleware");
const moderationController = require("../controllers/moderation.controller");

router.post("/reports", requireAuth, moderationController.createReport);
router.get("/reports", requireAuth, requireAdmin, moderationController.getReports);
router.get("/my-reports", requireAuth, moderationController.getMyReports);
router.post("/reports/:id/resolve", requireAuth, requireAdmin, moderationController.resolveReport);
router.post("/suspend-user", requireAuth, requireAdmin, moderationController.suspendUser);
router.post("/unsuspend-user", requireAuth, requireAdmin, moderationController.unsuspendUser);
router.get("/stats", requireAuth, requireAdmin, moderationController.getStats);

module.exports = router;
