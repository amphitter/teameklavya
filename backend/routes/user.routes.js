/**
 * EventHub User Routes (public profiles + social identity)
 * ──────────────────────────────────────
 *  GET  /api/users/me/social          own social profile + privacy settings
 *  PUT  /api/users/me/social          update username/bio/avatar/cover/interests/privacy
 *  GET  /api/users/:idOrUsername/profile   public profile + real stats (viewer-aware)
 *  GET  /api/users/:idOrUsername/posts     user's feed posts (privacy-enforced)
 *  GET  /api/users/:idOrUsername/events    profile event history (attendance-aware)
 *
 *  :idOrUsername accepts both legacy ObjectIds and @usernames.
 */
const express = require("express");
const router = express.Router();
const userController = require("../controllers/user.controller");
const { optionalUser, requireAuth } = require("../middleware/auth.middleware");

router.get("/me/social", requireAuth, userController.getMySocial);
router.put("/me/social", requireAuth, userController.updateMySocial);
router.put("/me/discovery-privacy", requireAuth, userController.updateDiscoveryPrivacy);

router.get("/suggested", requireAuth, userController.getSuggestedUsers);

router.get("/:id/achievements", optionalUser, userController.getUserAchievements);

router.get("/:id/profile", optionalUser, userController.getPublicProfile);
router.get("/:id/posts", optionalUser, userController.getUserPosts);
router.get("/:id/events", optionalUser, userController.getUserEvents);
// Part 11 §5 — the profile Media tab browses images, paginated:
// GET /api/users/:id/media?page=1&limit=18
router.get("/:id/media", optionalUser, userController.getUserMedia);

module.exports = router;
