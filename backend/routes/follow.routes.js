/**
 * EventHub Follow Routes — the user-to-user social graph
 * ──────────────────────────────────────
 *  POST /api/follow/:userId                    toggle follow / request / cancel
 *  GET  /api/follow/:userId/status             viewer-aware follow state
 *  GET  /api/follow/:userId/followers?page=    followers list (paginated)
 *  GET  /api/follow/:userId/following?page=    following list (paginated)
 *  GET  /api/follow/requests                   my incoming follow requests
 *  POST /api/follow/requests/:userId/accept    approve a request
 *  POST /api/follow/requests/:userId/decline   decline a request
 */
const express = require("express");
// Part 5, Phase 2 — follow/unfollow loop cap (§24, §27)
const { limiters } = require("../config/rate-limits");
const { actionGuard } = require("../middleware/action-guard");

const router = express.Router();
const followController = require("../controllers/follow.controller");
const { optionalUser, requireAuth } = require("../middleware/auth.middleware");

// Static segments must be registered before /:userId
router.get("/requests", requireAuth, followController.getRequests);
router.post("/requests/:userId/accept", requireAuth, followController.acceptRequest);
router.post("/requests/:userId/decline", requireAuth, followController.declineRequest);

router.post("/:userId", requireAuth, limiters.social, actionGuard("GUARD_FOLLOW_TOGGLE"), followController.toggleFollow);
router.get("/:userId/status", optionalUser, followController.getFollowStatus);
router.get("/:userId/followers", optionalUser, followController.getFollowers);
router.get("/:userId/following", optionalUser, followController.getFollowing);

module.exports = router;
