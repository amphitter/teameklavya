/**
 * Post visibility — one implementation, two callers.
 *
 * These two helpers lived inside `post.controller.js`. Sharing a post into a
 * conversation needs exactly the same rule ("may THIS person see this post?")
 * but with the RECIPIENT as the viewer — a share must never be a way to read a
 * post you were not allowed to read. The alternatives were to duplicate the
 * rules (two copies that drift, and a follower-only post that leaks the day one
 * of them is edited) or to re-ask the controller (which would drag the whole
 * post controller into the message controller for one predicate).
 *
 * So the functions move here unchanged. Behaviour is identical — this is a
 * relocation, not a rewrite, and the post controller still owns every rule about
 * how posts are listed.
 */
const RegistrationResponse = require("../models/registrationResponse.model");
const Community = require("../models/community.model");
const CommunityMember = require("../models/communityMember.model");
const { isFollowerOf } = require("./social.service");

/**
 * The author's id, whether `author` is an ObjectId or a POPULATED user.
 *
 * `String(populatedUser)` is "[object Object]", so the ownership check below
 * silently failed for every post fetched with `.populate("author")` — which is
 * how the single-post route fetches it. Nothing noticed while the only effect
 * was "the author passes the same public-visibility test as anyone else"; it
 * surfaced the moment archived posts became owner-only, because then the owner
 * was locked out of their own post.
 */
function authorIdOf(post) {
  return String(post?.author?._id || post?.author || "");
}

/**
 * Point-check: may this viewer see this specific post?
 *
 * `public` → everyone.  `followers` → accepted followers of the author.
 * `event_participants` → registered attendees of the attached event.
 * `community` → active members of the attached community.
 * The author always may. Archived and unpublished posts are owner-only.
 */
async function canViewPost(post, viewerId) {
  if (viewerId && authorIdOf(post) === String(viewerId)) return true;
  if (post.status !== "published") return false;
  /* Part 9 §12 — archived means "only I can see this".
   *
   * The lists already honoured it (`/users/:id/posts`, the feed, the profile),
   * but the permalink did not: anyone holding the URL — someone the post was
   * shared with, a link in a chat, a search result — still got the post and its
   * comments. That made the feature advisory, and made the UI's own promise
   * ("Post archived — only you can see it") untrue. The author's check above
   * returns early, so this only ever excludes OTHER people. */
  if (post.archivedAt) return false;
  if (!post.visibility || post.visibility === "public") return true;
  if (!viewerId) return false;
  if (post.visibility === "followers") return isFollowerOf(viewerId, post.author);
  if (post.visibility === "event_participants") {
    return Boolean(post.event && (await RegistrationResponse.exists({ userId: viewerId, eventId: post.event })));
  }
  if (post.visibility === "community") {
    if (!post.community) return false;
    const community = await Community.findById(post.community).select("deletedAt status").lean();
    if (!community || community.deletedAt || community.status === "suspended") return false; // gone → post vanishes
    return Boolean(await CommunityMember.exists({ community: post.community, user: viewerId, status: "active" }));
  }
  return false;
}

module.exports = { canViewPost, authorIdOf };
