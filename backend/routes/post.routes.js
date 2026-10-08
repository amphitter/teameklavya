/**
 * EventHub Post Routes — the social feed
 * ────────────────────────────────────────
 *  GET    /api/posts/feed?page&limit&tab     feed (public, viewer-aware)
 *  GET    /api/posts/:id                     single post (public)
 *  POST   /api/posts                         create post (auth)
 *  POST   /api/posts/:id/like                toggle like (auth)
 *  POST   /api/posts/:id/save                toggle save (auth)
 *  GET    /api/posts/:id/comments            list comments (public)
 *  POST   /api/posts/:id/comments            add comment (auth)
 *  DELETE /api/posts/:id/comments/:commentId delete own comment (auth)
 *  DELETE /api/posts/:id                     delete own post (auth)
 */
const express = require("express");
// Part 5, Phase 2 — per-domain limits + abuse guards (§24, §27, §28)
const { limiters } = require("../config/rate-limits");
const { actionGuard } = require("../middleware/action-guard");
const { idempotencyWindow } = require("../middleware/idempotency");

const router = express.Router();
const postController = require("../controllers/post.controller");
const { requireAuth, optionalUser } = require("../middleware/auth.middleware");

router.get("/feed", optionalUser, postController.getFeed);

/* Part 14 §3/§5 — the Search screen's opening state. Real engagement ranking,
   the feed's own projection, image-first. Declared with the collection routes,
   above `/:id`, so "trending" can never be read as a post id. */
router.get("/trending", optionalUser, postController.getTrendingPosts);

/* §23/§24 — the write path for "already seen" / "not interested". Batched, and
   therefore cheap enough to call while scrolling. */
router.post("/impressions", requireAuth, postController.recordImpressions);
router.post(
  "/:id/dismiss",
  requireAuth,
  limiters.social,
  postController.toggleDismiss
);
router.get("/topics", optionalUser, postController.getTrendingTopics);
router.get("/topics/:topic", optionalUser, postController.getTopicPosts);
router.get("/saved", requireAuth, postController.getSavedPosts);
// Part 9 §11 — posts the viewer reacted to, ordered by when they reacted.
router.get("/liked", requireAuth, postController.getLikedPosts);
// Part 9 §12 — the author's own archive. Distinct from moderation-hidden.
router.get("/archived", requireAuth, postController.getArchivedPosts);
router.post("/:id/archive", requireAuth, postController.toggleArchive);
router.post("/", requireAuth, idempotencyWindow, limiters.social, postController.createPost);
router.get("/event/:eventId", optionalUser, postController.getEventPosts);
router.get("/:id", optionalUser, postController.getPostById);
router.post("/:id/like", requireAuth, limiters.social, actionGuard("GUARD_INTERACT_TOGGLE"), postController.toggleLike);
router.post("/:id/save", requireAuth, limiters.social, actionGuard("GUARD_INTERACT_TOGGLE"), postController.toggleSave);
router.get("/:id/comments", optionalUser, postController.getComments);
router.post("/:id/comments", requireAuth, limiters.social, actionGuard("GUARD_COMMENT"), postController.addComment);
router.delete("/:id/comments/:commentId", requireAuth, postController.deleteComment);
router.get("/:id/comments/:commentId/replies", optionalUser, postController.getReplies);
router.post("/:id/comments/:commentId/like", requireAuth, limiters.social, actionGuard("GUARD_INTERACT_TOGGLE"), postController.likeComment);
router.delete("/:id", requireAuth, postController.deletePost);

module.exports = router;
