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
router.get("/categories", orgController.getOrganizationCategories);
router.get("/", optionalUser, orgController.getOrganizations);
router.get("/mine", requireAuth, orgController.getMyOrganizations);
router.get("/mine/followed", requireAuth, orgController.getFollowedOrganizations);
router.get("/suggested", requireAuth, orgController.getSuggestedOrganizations);
router.get("/:id/parent-options", requireAuth, orgController.getOrganizationParentOptions);
router.get("/:id/members", requireAuth, orgController.getOrganizationMembers);
router.post("/:id/members", requireAuth, orgController.inviteOrganizationMember);
router.post("/:id/members/invitations/:action", requireAuth, orgController.resolveOrganizationInvitation);
router.patch("/:id/members/:userId", requireAuth, orgController.updateOrganizationMemberRole);
router.delete("/:id/members/:userId", requireAuth, orgController.revokeOrganizationMember);
router.get("/:slug/children", orgController.getOrganizationChildren);
router.get("/:slug", optionalUser, orgController.getOrganizationBySlug);
router.get("/:slug/events", orgController.getOrganizationEvents);
router.get("/:slug/posts", optionalUser, orgController.getOrganizationPosts);
router.get("/:slug/communities", orgController.getOrganizationCommunities);
router.put("/:id", requireAuth, orgController.updateOrganization);
router.post("/:id/follow", requireAuth, orgController.toggleFollowOrg);

/* ── Affiliation Lifecycle (Master Refactor) ── */
router.post("/:id/affiliation/request", requireAuth, orgController.requestAffiliation);
router.post("/:id/affiliation/approve", requireAuth, orgController.approveAffiliation);
router.post("/:id/affiliation/reject", requireAuth, orgController.rejectAffiliation);
router.post("/:id/affiliation/suspend", requireAuth, orgController.suspendAffiliation);
router.post("/:id/affiliation/revoke", requireAuth, orgController.revokeAffiliation);
router.post("/:id/affiliation/transfer", requireAuth, orgController.transferAffiliation);
router.get("/:id/affiliation/history", requireAuth, orgController.getAffiliationHistory);

/* ── Ownership Verification (Super Admin) ── */
router.post("/:id/verify", requireAuth, requireSuperAdmin, orgController.verifyOrganization);
router.post("/:id/unverify", requireAuth, requireSuperAdmin, orgController.unverifyOrganization);
router.post("/:id/managers", requireAuth, requireSuperAdmin, orgController.addOrgManager);
router.post("/:id/managers/remove", requireAuth, requireSuperAdmin, orgController.removeOrgManager);

module.exports = router;
