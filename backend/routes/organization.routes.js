/**
 * EventHub Organization Routes
 * ─────────────────────────────
 *  POST /api/organizations                 create (admin)
 *  GET  /api/organizations?q=              public list + counts
 *  GET  /api/organizations/mine            orgs I can attach events to (auth)
 *  GET  /api/organizations/mine/followed   communities in my sidebar (auth)
 *  GET  /api/organizations/:slug           public profile (viewer-aware)
 *  GET  /api/organizations/:slug/events    public events of the org
 *  PUT  /api/organizations/:id             update (creator/admin)
 *  POST /api/organizations/:id/follow      toggle follow (auth)
 */
const express = require("express");
const router = express.Router();
const orgController = require("../controllers/organization.controller");
const { requireAuth, requireAdmin, optionalUser, requireSuperAdmin } = require("../middleware/auth.middleware");

router.post("/", requireAuth, requireAdmin, orgController.createOrganization);
router.get("/", orgController.getOrganizations);
router.get("/mine", requireAuth, orgController.getMyOrganizations);
router.get("/mine/followed", requireAuth, orgController.getFollowedOrganizations);
router.get("/suggested", requireAuth, orgController.getSuggestedOrganizations);
router.get("/:slug", optionalUser, orgController.getOrganizationBySlug);
router.get("/:slug/events", orgController.getOrganizationEvents);
router.get("/:slug/posts", optionalUser, orgController.getOrganizationPosts);
router.get("/:slug/communities", orgController.getOrganizationCommunities);
router.put("/:id", requireAuth, orgController.updateOrganization);
router.post("/:id/follow", requireAuth, orgController.toggleFollowOrg);

/* ── Ownership Verification (Super Admin) ── */
router.post("/:id/verify", requireAuth, requireSuperAdmin, orgController.verifyOrganization);
router.post("/:id/unverify", requireAuth, requireSuperAdmin, orgController.unverifyOrganization);
router.post("/:id/managers", requireAuth, requireSuperAdmin, orgController.addOrgManager);
router.post("/:id/managers/remove", requireAuth, requireSuperAdmin, orgController.removeOrgManager);

module.exports = router;
