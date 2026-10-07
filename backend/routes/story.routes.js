const express = require("express");
const router = express.Router();
const storyCtrl = require("../controllers/story.controller");
const { requireAuth, optionalUser } = require("../middleware/auth.middleware");

/**
 * Stories (Part 8 §15-19).
 *
 * Reading the public feed is optional-auth: a signed-out visitor sees category
 * stories rather than a wall. Everything else requires a session.
 *
 * Rate limiting: creating a story costs real Cloudinary quota, so it sits
 * behind the social limiter. Viewing is cheap and idempotent — the global
 * read limiter already covers it.
 */
router.get("/", optionalUser, storyCtrl.feed);
router.get("/categories", storyCtrl.categories);
router.get("/category/:key", optionalUser, storyCtrl.byCategory);
router.get("/archive", requireAuth, storyCtrl.archive);
router.get("/users/:id", optionalUser, storyCtrl.byAuthor);
router.get("/:id", optionalUser, storyCtrl.getOne);

const { limiters } = require("../config/rate-limits");
router.post("/", requireAuth, limiters.social, storyCtrl.create);
router.post("/:id/view", requireAuth, storyCtrl.markView);
router.delete("/:id", requireAuth, storyCtrl.remove);

module.exports = router;
