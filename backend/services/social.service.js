const Block = require("../models/block.model");
const Follow = require("../models/follow.model");

/**
 * Social guards shared by follow/messaging/interaction controllers.
 * Backend is authoritative — the frontend never decides access.
 */

/** True when either user has blocked the other (blocks are directional but cut both ways). */
async function isBlockedBetween(userA, userB) {
  if (!userA || !userB || String(userA) === String(userB)) return false;
  return Boolean(
    await Block.exists({
      $or: [
        { blocker: userA, blocked: userB },
        { blocker: userB, blocked: userA },
      ],
    })
  );
}

/** Accepted-follower check (used for "followers only" privacy gates). */
async function isFollowerOf(userId, targetId) {
  return Boolean(
    await Follow.exists({ follower: userId, followee: targetId, status: "accepted" })
  );
}

/** Remove follow edges in both directions (used when a block is created). */
async function severFollows(userA, userB) {
  await Follow.deleteMany({
    $or: [
      { follower: userA, followee: userB },
      { follower: userB, followee: userA },
    ],
  });
}

module.exports = { isBlockedBetween, isFollowerOf, severFollows };
