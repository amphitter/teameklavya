const Block = require("../models/block.model");
const { isSuperAdminEmail } = require("../middleware/auth.middleware");
const User = require("../models/user.model");
const { severFollows } = require("../services/social.service");

const USER_LIST_FIELDS = "firstName lastName username verified profile.avatar";

/**
 * POST /api/blocks/:userId — toggle block.
 * Blocking removes follow edges both ways and stops all interaction
 * (follow requests, messages, likes/comments) enforced backend-side.
 */
exports.toggleBlock = async (req, res) => {
  try {
    const blockerId = req.user.id;
    const blockedId = req.params.userId;

    if (String(blockerId) === String(blockedId)) {
      return res.status(400).json({ success: false, message: "You can't block yourself" });
    }
    const target = await User.findById(blockedId).select("_id email");
    if (!target) return res.status(404).json({ success: false, message: "User not found" });
    // The permanent Super Admin can never be blocked (platform control)
    if (isSuperAdminEmail(target.email)) {
      return res.status(403).json({ success: false, message: "The Super Admin cannot be blocked" });
    }

    const existing = await Block.findOne({ blocker: blockerId, blocked: blockedId });
    if (existing) {
      await existing.deleteOne();
      return res.json({ success: true, blocked: false });
    }

    await Block.create({ blocker: blockerId, blocked: blockedId });
    // Cut the social graph between the pair immediately
    await severFollows(blockerId, blockedId);

    res.json({ success: true, blocked: true });
  } catch (error) {
    console.error("Toggle block error:", error.message);
    res.status(500).json({ success: false, message: "Failed to update block" });
  }
};

// GET /api/blocks — users I have blocked
exports.getMyBlocks = async (req, res) => {
  try {
    const blocks = await Block.find({ blocker: req.user.id })
      .sort({ createdAt: -1 })
      .populate("blocked", USER_LIST_FIELDS)
      .lean();

    res.json({ success: true, users: blocks.map((b) => b.blocked).filter(Boolean) });
  } catch (error) {
    console.error("Blocks list error:", error.message);
    res.status(500).json({ success: false, message: "Failed to load blocks" });
  }
};
