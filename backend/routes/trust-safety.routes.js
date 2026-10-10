"use strict";

const express = require("express");
const router = express.Router();
const { requireAuth, requireSuperAdmin } = require("../middleware/auth.middleware");
const { limiters } = require("../config/rate-limits");
const reportController = require("../controllers/report.controller");
const trustSafetyController = require("../controllers/trust-safety.controller");

// User-facing report routes
router.post("/reports", requireAuth, limiters.social, reportController.submitReport);
router.get("/reports/mine", requireAuth, reportController.getMyReports);

// Super Admin moderation routes
router.get("/admin/moderation/overview", requireAuth, requireSuperAdmin, trustSafetyController.getOverview);
router.get("/admin/moderation/reports/list", requireAuth, requireSuperAdmin, reportController.listReports);
router.get("/admin/moderation/reports/:id", requireAuth, requireSuperAdmin, reportController.getReport);
router.post("/admin/moderation/reports/:id/resolve", requireAuth, requireSuperAdmin, reportController.resolveReport);

router.get("/admin/moderation/cases", requireAuth, requireSuperAdmin, trustSafetyController.listCases);
router.get("/admin/moderation/cases/:id", requireAuth, requireSuperAdmin, trustSafetyController.getCase);
router.post("/admin/moderation/cases/:id/assign", requireAuth, requireSuperAdmin, trustSafetyController.assignCase);
router.post("/admin/moderation/cases/:id/note", requireAuth, requireSuperAdmin, trustSafetyController.addNote);
router.post("/admin/moderation/cases/:id/resolve", requireAuth, requireSuperAdmin, trustSafetyController.resolveCase);

router.post("/admin/moderation/content/:contentType/:contentId/:action", requireAuth, requireSuperAdmin, trustSafetyController.moderateContent);
router.post("/admin/moderation/content/:contentType/:contentId", requireAuth, requireSuperAdmin, trustSafetyController.moderateContent);

router.get("/admin/moderation/users/search", requireAuth, requireSuperAdmin, trustSafetyController.searchUsers);
router.get("/admin/moderation/users/:id", requireAuth, requireSuperAdmin, trustSafetyController.getUserDetail);
router.post("/admin/moderation/users/:id/enforce", requireAuth, requireSuperAdmin, trustSafetyController.enforceUser);

router.get("/admin/moderation/enforcements", requireAuth, requireSuperAdmin, trustSafetyController.listEnforcements);
router.post("/admin/moderation/enforcement/:id/reverse", requireAuth, requireSuperAdmin, trustSafetyController.reverseEnforcement);

router.get("/admin/moderation/ip", requireAuth, requireSuperAdmin, trustSafetyController.listIpRestrictions);
router.post("/admin/moderation/ip", requireAuth, requireSuperAdmin, trustSafetyController.createIpRestriction);
router.post("/admin/moderation/ip/:ip/unblock", requireAuth, requireSuperAdmin, trustSafetyController.unblockIp);

router.get("/admin/moderation/audit", requireAuth, requireSuperAdmin, trustSafetyController.getAuditLogs);

module.exports = router;
