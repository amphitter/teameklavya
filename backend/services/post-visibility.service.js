const RegistrationResponse = require("../models/registrationResponse.model");
const Community = require("../models/community.model");
const CommunityMember = require("../models/communityMember.model");
const { isFollowerOf } = require("./social.service");

function authorIdOf(post) {
  return String(post?.author?._id || post?.author || "");
}

async function canViewPost(post, viewerId) {
  const isAuthor = viewerId && authorIdOf(post) === String(viewerId);

  if (isAuthor) {
    // Author cannot see removed content (hard removal)
    if (post.moderationStatus === "removed") return false;
    if (post.status === "deleted") return false;
    // Author can see own archived, quarantined, flagged, pending, hidden (for transparency)
    return true;
  }

  // Non-author path
  if (post.status !== "published") return false;
  if (post.archivedAt) return false;
  if (post.moderationStatus && ["removed", "quarantined", "pending", "flagged"].includes(post.moderationStatus)) {
    return false;
  }

  if (!post.visibility || post.visibility === "public") return true;
  if (!viewerId) return false;
  if (post.visibility === "followers") return isFollowerOf(viewerId, post.author);
  if (post.visibility === "event_participants") {
    return Boolean(post.event && (await RegistrationResponse.exists({ userId: viewerId, eventId: post.event })));
  }
  if (post.visibility === "community") {
    if (!post.community) return false;
    const community = await Community.findById(post.community).select("deletedAt status").lean();
    if (!community || community.deletedAt || community.status === "suspended") return false;
    return Boolean(await CommunityMember.exists({ community: post.community, user: viewerId, status: "active" }));
  }
  return false;
}

module.exports = { canViewPost, authorIdOf };
