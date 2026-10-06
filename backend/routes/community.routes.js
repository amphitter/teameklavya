/**
 * EventHub Community Routes (Part 3, Phase 6)
 * ─────────────────────────────────────────
 *  GET    /api/communities?q=&page=            list communities (public)
 *  GET    /api/communities/my                  my active communities (auth)
 *  POST   /api/communities                     create (admin / org manager)
 *  GET    /api/communities/:slug               public profile + my context
 *  PUT    /api/communities/:slug               update (community admins)
 *  DELETE /api/communities/:slug               soft delete (community admins)
 *  GET    /api/communities/:slug/members       member list (pending/invited: admins)
 *  GET    /api/communities/:slug/posts         posts (active members only)
 *  GET    /api/communities/:slug/events        hosted events (public)
 *  POST   /api/communities/:slug/join          join / accept invite (auth)
 *  POST   /api/communities/:slug/leave         leave / decline invite (auth)
 *  POST   /api/communities/:slug/invite        invite by username (admins)
 *  POST   /api/communities/:slug/requests/:memberId/:action   approve|reject (admins)
 *  POST   /api/communities/:slug/invitations/:action          accept|decline (invitee)
 *  POST   /api/communities/:slug/members/:memberId/remove     remove member (admins)
 */
const express = require("express");
// Part 5, Phase 2 — community-create cooldown + join/leave cap (§27)
const { actionGuard } = require("../middleware/action-guard");

const router = express.Router();
const communityController = require("../controllers/community.controller");
const { requireAuth, optionalUser, requireSuperAdmin } = require("../middleware/auth.middleware");

router.get("/", optionalUser, communityController.getCommunities);
router.get("/my", requireAuth, communityController.getMyCommunities);
router.post("/", requireAuth, actionGuard("GUARD_COMMUNITY_CREATE"), communityController.createCommunity);

/* ── Ownership Verification (Super Admin system) ── */
router.get("/claims", requireAuth, requireSuperAdmin, communityController.getClaims);
router.post("/claims/:claimId/review", requireAuth, communityController.reviewClaim);

router.get("/:slug", optionalUser, communityController.getCommunityBySlug);
router.put("/:slug", requireAuth, communityController.updateCommunity);
router.delete("/:slug", requireAuth, communityController.deleteCommunity);

router.get("/:slug/members", optionalUser, communityController.getCommunityMembers);
router.get("/:slug/posts", requireAuth, communityController.getCommunityPosts);
router.get("/:slug/events", optionalUser, communityController.getCommunityEvents);

router.post("/:slug/join", requireAuth, actionGuard("GUARD_COMMUNITY_JOIN"), communityController.joinCommunity);
router.post("/:slug/leave", requireAuth, actionGuard("GUARD_COMMUNITY_JOIN"), communityController.leaveCommunity);
router.post("/:slug/invite", requireAuth, communityController.inviteMember);
router.post("/:slug/requests/:memberId/:action", requireAuth, communityController.resolveJoinRequest);
router.post("/:slug/invitations/:action", requireAuth, communityController.resolveInvitation);
router.post("/:slug/members/:memberId/remove", requireAuth, communityController.removeMember);

/* ── Ownership Verification (per community) ── */
router.post("/:slug/claim", requireAuth, communityController.submitClaim);
router.post("/:slug/verification", requireAuth, requireSuperAdmin, communityController.setVerification);
router.post("/:slug/suspend", requireAuth, requireSuperAdmin, communityController.setSuspension);
router.put("/:slug/admin", requireAuth, requireSuperAdmin, communityController.adminUpdateCommunity);
router.post("/:slug/transfer", requireAuth, requireSuperAdmin, communityController.transferOwnership);
router.post("/:slug/resolve-duplicate", requireAuth, requireSuperAdmin, communityController.resolveDuplicate);
router.get("/:slug/audit", requireAuth, communityController.getAuditLog);

module.exports = router;
