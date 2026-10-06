/**
 * EventHub Block Routes — social graph safety
 * ──────────────────────────────────────
 *  POST /api/blocks/:userId   toggle block/unblock (severs follows)
 *  GET  /api/blocks           users I have blocked
 */
const express = require("express");
const router = express.Router();
const blockController = require("../controllers/block.controller");
const { requireAuth } = require("../middleware/auth.middleware");

router.post("/:userId", requireAuth, blockController.toggleBlock);
router.get("/", requireAuth, blockController.getMyBlocks);

module.exports = router;
