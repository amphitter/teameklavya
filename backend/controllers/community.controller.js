const mongoose = require("mongoose");
const Community = require("../models/community.model");
const CommunityMember = require("../models/communityMember.model");
const User = require("../models/user.model");
const Organization = require("../models/organization.model");
const Event = require("../models/event.model");
const Post = require("../models/post.model");
const Reaction = require("../models/reaction.model");
const Comment = require("../models/comment.model");
const Save = require("../models/save.model");
const Follow = require("../models/follow.model");
const { notify } = require("../services/notification.service");
const CommunityClaim = require("../models/communityClaim.model");
const AuditLog = require("../models/auditLog.model");
const { isSuperAdminEmail } = require("../middleware/auth.middleware");
const { isInstitutionalDomain, emailDomain } = require("../utils/domain");
const { guardSuperAdmin, isSelfAction, PROTECTED_ACTIONS } = require("../services/ownership.service");

const AUTHOR_FIELDS = "firstName lastName username verified profile.avatar profile.institution";
const EVENT_FIELDS = "title slug bannerUrl startDate endDate venue eventType category organizer price visibility isLive";
const ORG_FIELDS = "name slug logoUrl";
const COMMUNITY_FIELDS = "name slug avatarUrl";
const MEMBER_PAGE = 30;

const slugify = (s) =>
  String(s)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);

const MEMBER_FIELDS = "firstName lastName username verified profile.avatar profile.institution";

/** Deterministic unique slug (used for safe renames too). */
async function uniqueCommunitySlug(base, excludeId = null) {
  let candidate = base;
  let n = 1;
  while (
    await Community.exists(excludeId ? { slug: candidate, _id: { $ne: excludeId } } : { slug: candidate })
  ) {
    candidate = `${base}-${++n}`;
  }
  return candidate;
}

/** Fire-and-forget audit entry — never blocks the action. */
function audit({ community = null, organization = null, actor, action, details = "" }) {
  AuditLog.create({ community, organization, actor, action, details }).catch((e) =>
    console.error("Audit log failed:", e.message)
  );
}

/**
 * Super Admin check that works for BOTH a JWT payload (no email in old
 * tokens → DB fallback) and a full DB user doc (fast path).
 */
async function isSuperAdminUser(user) {
  if (!user) return false;
  if (user.email) return isSuperAdminEmail(user.email);
  if (!user.id) return false;
  const dbUser = await User.findById(user.id).select("email").lean();
  return Boolean(dbUser && isSuperAdminEmail(dbUser.email));
}

/** Ownership Verification: who may act for this organization. */
async function isOrgManager(user, organizationId) {
  if (!user) return false;
  if (await isSuperAdminUser(user)) return true;
  const org = await Organization.findById(organizationId).select("createdBy managers").lean();
  if (!org) return false;
  if (String(org.createdBy) === String(user.id)) return true;
  return (org.managers || []).some((m) => String(m) === String(user.id));
}

/** Real member count per community (active memberships only). */
async function memberCounts(communityIds) {
  if (!communityIds.length) return new Map();
  const agg = await CommunityMember.aggregate([
    { $match: { community: { $in: communityIds }, status: "active" } },
    { $group: { _id: "$community", count: { $sum: 1 } } },
  ]);
  return new Map(agg.map((a) => [String(a._id), a.count]));
}

/**
 * Community manager = platform admin, community creator, or a member
 * with role "admin". Deleted communities are never manageable (404 first).
 */
async function isCommunityManager(user, communityId) {
  if (!user) return false;
  if (user.role === "admin") return true;
  const member = await CommunityMember.findOne({ community: communityId, user: user.id }).lean();
  if (member && member.status === "active" && member.role === "admin") return true;
  const community = await Community.findById(communityId).select("createdBy").lean();
  return Boolean(community && String(community.createdBy) === String(user.id));
}

async function findLiveCommunityBySlug(slug) {
  return Community.findOne({ slug, deletedAt: null });
}

/**
 * Fetch a community allowed to be *seen* by this request. Suspended
 * communities stay visible only to their admins and the Super Admin.
 */
async function findVisibleCommunity(slug, user) {
  const community = await findLiveCommunityBySlug(slug);
  if (!community) return { community: null };
  if (community.status === "suspended") {
    const allowed = (await isSuperAdminUser(user)) || (await isCommunityManager(user, community._id));
    if (!allowed) return { community: null };
  }
  return { community };
}

/* ── List & detail ───────────────────────────────────────── */

// GET /api/communities?q=&limit=&page=
exports.getCommunities = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
    const q = String(req.query.q || "").trim();
    // Suspended communities are hidden platform-wide
    const filter = { deletedAt: null, status: { $ne: "suspended" } };
    if (q) filter.name = { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };

    const [communities, total] = await Promise.all([
      Community.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate("organization", "name slug logoUrl isVerified")
        .populate("officialOrganization", "name slug logoUrl isVerified")
        .lean(),
      Community.countDocuments(filter),
    ]);

    const counts = await memberCounts(communities.map((c) => c._id));
    res.json({
      success: true,
      communities: communities.map((c) => ({ ...c, memberCount: counts.get(String(c._id)) || 0 })),
      page,
      hasMore: page * limit < total,
    });
  } catch (error) {
    console.error("Get communities error:", error.message);
    res.status(500).json({ success: false, message: "Failed to load communities" });
  }
};

// GET /api/communities/my — the signed-in user's active communities
exports.getMyCommunities = async (req, res) => {
  try {
    const memberships = await CommunityMember.find({ user: req.user.id, status: "active" })
      .select("community role")
      .populate("community", "name slug avatarUrl description joinPolicy deletedAt")
      .lean();
    const communities = memberships
      .filter((m) => m.community && !m.community.deletedAt)
      .map((m) => ({ ...m.community, myRole: m.role }));
    res.json({ success: true, communities });
  } catch (error) {
    console.error("Get my communities error:", error.message);
    res.status(500).json({ success: false, message: "Failed to load your communities" });
  }
};

// GET /api/communities/:slug — public profile + viewer membership context
exports.getCommunityBySlug = async (req, res) => {
  try {
    const { community } = await findVisibleCommunity(req.params.slug, req.user);
    if (!community) return res.status(404).json({ success: false, message: "Community not found" });
    await community.populate([
      { path: "organization", select: "name slug logoUrl isVerified" },
      { path: "officialOrganization", select: "name slug logoUrl isVerified" },
    ]);

    const [count, myMember] = await Promise.all([
      CommunityMember.countDocuments({ community: community._id, status: "active" }),
      req.user
        ? CommunityMember.findOne({ community: community._id, user: req.user.id }).lean()
        : null,
    ]);

    const eventCount = await Event.countDocuments({ community: community._id, visibility: "public" });
    const isManager = await isCommunityManager(req.user, community._id);

    res.json({
      success: true,
      community: {
        ...community.toObject(),
        memberCount: count,
        eventCount,
        myMember: myMember ? { status: myMember.status, role: myMember.role } : null,
        isManager,
      },
    });
  } catch (error) {
    console.error("Get community error:", error.message);
    res.status(500).json({ success: false, message: "Failed to load community" });
  }
};

/* ── Create / update / delete ────────────────────────────── */

/*
 * POST /api/communities { name, description, joinPolicy, organizationId? }
 *
 * Ownership Verification rules (server-side enforced):
 *   • Super Admin — anything (still starts unverified; verification is separate)
 *   • Organization manager (creator / assigned) — org-backed community
 *   • Any signed-in user WITH an institutional email domain — the domain is
 *     stored as an AFFILIATION SIGNAL only; it grants nothing automatically.
 * Every new community starts status "unverified". No exceptions — official
 * verification always requires proof + manual review.
 */
exports.createCommunity = async (req, res) => {
  try {
    const { name, description = "", joinPolicy = "open", organizationId } = req.body;
    const trimmed = String(name || "").trim();
    if (trimmed.length < 3 || trimmed.length > 60) {
      return res.status(400).json({ success: false, message: "Community name must be 3–60 characters" });
    }
    if (!["open", "request", "invite"].includes(joinPolicy)) {
      return res.status(400).json({ success: false, message: "Invalid join policy" });
    }

    const creator = await User.findById(req.user.id).select("email role");
    if (!creator) return res.status(401).json({ success: false, message: "Authentication required" });
    const superAdmin = isSuperAdminEmail(creator.email);

    let orgRef = null;
    const affiliation = emailDomain(creator.email);

    if (organizationId) {
      const org = await Organization.findById(organizationId).select("createdBy managers");
      if (!org) return res.status(404).json({ success: false, message: "Organization not found" });
      if (!(await isOrgManager(creator, organizationId))) {
        return res.status(403).json({ success: false, message: "You can only create communities for an organization you manage" });
      }
      orgRef = org._id;
    } else if (!superAdmin) {
      // Regular users need an institutional email to create a community.
      // (Domain = affiliation signal, NOT ownership — students share it.)
      if (!isInstitutionalDomain(creator.email)) {
        return res.status(400).json({
          success: false,
          message: "Communities are created with an institutional email (e.g. your college or company address)",
        });
      }
    }

    let slug = slugify(trimmed);
    if (!slug) slug = `community-${Date.now()}`;
    const candidate = await uniqueCommunitySlug(slug);

    const community = await Community.create({
      name: trimmed,
      slug: candidate,
      description: String(description || "").trim().slice(0, 1000),
      joinPolicy,
      organization: orgRef,
      createdBy: req.user.id,
      status: "unverified", // ALWAYS — verification never happens at creation
      affiliationDomain: affiliation,
    });

    // Creator becomes the first community admin
    await CommunityMember.create({ community: community._id, user: req.user.id, role: "admin", status: "active" });

    audit({
      community: community._id,
      actor: req.user.id,
      action: "created",
      details: `created with affiliation domain "${affiliation}" (signal only, unverified)`,
    });

    res.status(201).json({ success: true, community: { ...community.toObject(), memberCount: 1 } });
  } catch (error) {
    console.error("Create community error:", error.message);
    res.status(500).json({ success: false, message: "Failed to create community" });
  }
};

// PUT /api/communities/:slug { name?, description?, joinPolicy?, avatarUrl? }
exports.updateCommunity = async (req, res) => {
  try {
    const { community } = await findVisibleCommunity(req.params.slug, req.user);
    if (!community) return res.status(404).json({ success: false, message: "Community not found" });
    const requester = await User.findById(req.user.id).select("email");
    if (!(await isCommunityManager(req.user, community._id)) && !isSuperAdminEmail(requester?.email)) {
      return res.status(403).json({ success: false, message: "Only community admins can update this community" });
    }

    const { name, description, joinPolicy, avatarUrl } = req.body || {};
    if (name !== undefined) {
      const trimmed = String(name).trim();
      if (trimmed.length < 3 || trimmed.length > 60) {
        return res.status(400).json({ success: false, message: "Community name must be 3–60 characters" });
      }
      community.name = trimmed;
    }
    if (description !== undefined) community.description = String(description).trim().slice(0, 1000);
    if (joinPolicy !== undefined) {
      if (!["open", "request", "invite"].includes(joinPolicy)) {
        return res.status(400).json({ success: false, message: "Invalid join policy" });
      }
      community.joinPolicy = joinPolicy;
    }
    if (avatarUrl !== undefined) community.avatarUrl = String(avatarUrl);

    await community.save();
    res.json({ success: true, community });
  } catch (error) {
    console.error("Update community error:", error.message);
    res.status(500).json({ success: false, message: "Failed to update community" });
  }
};

// DELETE /api/communities/:slug — soft delete (audit record kept, content vanishes)
exports.deleteCommunity = async (req, res) => {
  try {
    const { community } = await findVisibleCommunity(req.params.slug, req.user);
    if (!community) return res.status(404).json({ success: false, message: "Community not found" });
    const requester = await User.findById(req.user.id).select("email");
    if (!(await isCommunityManager(req.user, community._id)) && !isSuperAdminEmail(requester?.email)) {
      return res.status(403).json({ success: false, message: "Only community admins can delete this community" });
    }
    community.deletedAt = new Date();
    await community.save();
    res.json({ success: true, message: "Community deleted" });
  } catch (error) {
    console.error("Delete community error:", error.message);
    res.status(500).json({ success: false, message: "Failed to delete community" });
  }
};

/* ── Membership: join / leave ────────────────────────────── */

// POST /api/communities/:slug/join
exports.joinCommunity = async (req, res) => {
  try {
    const { community } = await findVisibleCommunity(req.params.slug, req.user);
    if (!community) return res.status(404).json({ success: false, message: "Community not found" });

    if (community.status === "suspended") {
      return res.status(403).json({ success: false, message: "This community is suspended" });
    }

    const existing = await CommunityMember.findOne({ community: community._id, user: req.user.id });
    if (existing) {
      if (existing.status === "active") return res.status(400).json({ success: false, message: "You're already a member" });
      if (existing.status === "pending") return res.status(400).json({ success: false, message: "Your join request is already pending" });
      // invited → joining accepts the invite
      existing.status = "active";
      await existing.save();
      require("../services/achievement.service").checkAchievements(req.user.id); // community_member
      return res.json({ success: true, status: "active" });
    }

    if (community.joinPolicy === "open") {
      await CommunityMember.create({ community: community._id, user: req.user.id, status: "active" });
      require("../services/achievement.service").checkAchievements(req.user.id); // community_member
      return res.json({ success: true, status: "active" });
    }
    if (community.joinPolicy === "request") {
      await CommunityMember.create({ community: community._id, user: req.user.id, status: "pending" });
      return res.json({ success: true, status: "pending" });
    }
    // invite-only
    res.status(403).json({ success: false, message: "This community is invite-only" });
  } catch (error) {
    console.error("Join community error:", error.message);
    res.status(500).json({ success: false, message: "Failed to join community" });
  }
};

// POST /api/communities/:slug/leave
exports.leaveCommunity = async (req, res) => {
  try {
    const { community } = await findVisibleCommunity(req.params.slug, req.user);
    if (!community) return res.status(404).json({ success: false, message: "Community not found" });

    const member = await CommunityMember.findOne({ community: community._id, user: req.user.id });
    if (!member || member.status === "invited") {
      if (member) await member.deleteOne(); // declining via leave = drop invite
      return res.json({ success: true, status: "left" });
    }

    // Never leave the community without an active admin
    if (member.role === "admin" && member.status === "active") {
      const otherAdmins = await CommunityMember.countDocuments({
        community: community._id,
        role: "admin",
        status: "active",
        user: { $ne: req.user.id },
      });
      if (otherAdmins === 0) {
        return res.status(400).json({ success: false, message: "Promote another admin before leaving — a community needs at least one admin" });
      }
    }

    await member.deleteOne();
    res.json({ success: true, status: "left" });
  } catch (error) {
    console.error("Leave community error:", error.message);
    res.status(500).json({ success: false, message: "Failed to leave community" });
  }
};

/* ── Requests & invites ──────────────────────────────────── */

// POST /api/communities/:slug/requests/:memberId/approve | reject (managers)
exports.resolveJoinRequest = async (req, res) => {
  try {
    const { community } = await findVisibleCommunity(req.params.slug, req.user);
    if (!community) return res.status(404).json({ success: false, message: "Community not found" });
    if (!(await isCommunityManager(req.user, community._id))) {
      return res.status(403).json({ success: false, message: "Only community admins can manage requests" });
    }

    const action = String(req.params.action || "");
    if (!["approve", "reject"].includes(action)) {
      return res.status(400).json({ success: false, message: "Action must be approve or reject" });
    }

    const member = await CommunityMember.findOne({ _id: req.params.memberId, community: community._id });
    if (!member || member.status !== "pending") {
      return res.status(404).json({ success: false, message: "Join request not found" });
    }

    if (action === "approve") {
      member.status = "active";
      await member.save();
      await notify({ user: member.user, actor: req.user.id, type: "community_invite", community: community._id });
      return res.json({ success: true, status: "active" });
    }
    await member.deleteOne();
    res.json({ success: true, status: "rejected" });
  } catch (error) {
    console.error("Resolve join request error:", error.message);
    res.status(500).json({ success: false, message: "Failed to resolve request" });
  }
};

// POST /api/communities/:slug/invite { username } (managers)
exports.inviteMember = async (req, res) => {
  try {
    const { community } = await findVisibleCommunity(req.params.slug, req.user);
    if (!community) return res.status(404).json({ success: false, message: "Community not found" });
    if (!(await isCommunityManager(req.user, community._id))) {
      return res.status(403).json({ success: false, message: "Only community admins can invite members" });
    }

    const username = String(req.body?.username || "").trim().toLowerCase();
    if (!username) return res.status(400).json({ success: false, message: "Enter a username" });
    const invitee = await User.findOne({ username }).select("_id username");
    if (!invitee) return res.status(404).json({ success: false, message: "User not found" });
    if (String(invitee._id) === String(req.user.id)) {
      return res.status(400).json({ success: false, message: "You can't invite yourself" });
    }

    const existing = await CommunityMember.findOne({ community: community._id, user: invitee._id });
    if (existing) {
      if (existing.status === "active") return res.status(400).json({ success: false, message: "Already a member" });
      existing.status = "invited";
      existing.invitedBy = req.user.id;
      await existing.save();
    } else {
      await CommunityMember.create({ community: community._id, user: invitee._id, status: "invited", invitedBy: req.user.id });
    }

    await notify({ user: invitee._id, actor: req.user.id, type: "community_invite", community: community._id });
    res.json({ success: true, invited: true });
  } catch (error) {
    console.error("Invite member error:", error.message);
    res.status(500).json({ success: false, message: "Failed to invite member" });
  }
};

// POST /api/communities/:slug/invitations/accept | decline (the invited user)
exports.resolveInvitation = async (req, res) => {
  try {
    const { community } = await findVisibleCommunity(req.params.slug, req.user);
    if (!community) return res.status(404).json({ success: false, message: "Community not found" });

    const action = String(req.params.action || "");
    if (!["accept", "decline"].includes(action)) {
      return res.status(400).json({ success: false, message: "Action must be accept or decline" });
    }

    const member = await CommunityMember.findOne({ community: community._id, user: req.user.id });
    if (!member || member.status !== "invited") {
      return res.status(404).json({ success: false, message: "No pending invitation" });
    }

    if (action === "accept") {
      member.status = "active";
      await member.save();
      return res.json({ success: true, status: "active" });
    }
    await member.deleteOne();
    res.json({ success: true, status: "declined" });
  } catch (error) {
    console.error("Resolve invitation error:", error.message);
    res.status(500).json({ success: false, message: "Failed to resolve invitation" });
  }
};

// POST /api/communities/:slug/members/:memberId/remove (managers)
exports.removeMember = async (req, res) => {
  try {
    const { community } = await findVisibleCommunity(req.params.slug, req.user);
    if (!community) return res.status(404).json({ success: false, message: "Community not found" });
    if (!(await isCommunityManager(req.user, community._id))) {
      return res.status(403).json({ success: false, message: "Only community admins can remove members" });
    }

    const member = await CommunityMember.findOne({ _id: req.params.memberId, community: community._id });
    if (!member) return res.status(404).json({ success: false, message: "Member not found" });
    if (String(member.user) === String(req.user.id)) {
      return res.status(400).json({ success: false, message: "Use leave instead" });
    }
    if (member.role === "admin" && req.user.role !== "admin") {
      return res.status(403).json({ success: false, message: "Only platform admins can remove a community admin" });
    }
    const memberUser = await User.findById(member.user).select("email").lean();
    // §10: the Super Admin cannot be stripped of a membership. Self-service
    // (leaving a community) is exempt — the owner may always walk away from
    // their own membership, and refusing that would lock them out.
    const verdict = guardSuperAdmin(memberUser, PROTECTED_ACTIONS.REMOVE_MEMBERSHIP);
    if (!verdict.allowed && !isSelfAction(req.user, memberUser)) {
      return res.status(403).json({ success: false, message: verdict.reason });
    }

    await member.deleteOne();
    res.json({ success: true });
  } catch (error) {
    console.error("Remove member error:", error.message);
    res.status(500).json({ success: false, message: "Failed to remove member" });
  }
};

/* ── Members list ────────────────────────────────────────── */

// GET /api/communities/:slug/members?status= (active public; managers see pending/invited too)
exports.getCommunityMembers = async (req, res) => {
  try {
    const { community } = await findVisibleCommunity(req.params.slug, req.user);
    if (!community) return res.status(404).json({ success: false, message: "Community not found" });

    const isManager = await isCommunityManager(req.user, community._id);
    const requested = ["pending", "invited"].includes(String(req.query.status)) ? String(req.query.status) : "active";
    if (requested !== "active" && !isManager) {
      return res.status(403).json({ success: false, message: "Only community admins can view that list" });
    }

    const page = Math.max(1, parseInt(req.query.page) || 1);
    const filter = { community: community._id, status: requested };
    const [members, total] = await Promise.all([
      CommunityMember.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * MEMBER_PAGE)
        .limit(MEMBER_PAGE)
        .populate("user", MEMBER_FIELDS)
        .populate("invitedBy", "firstName lastName username")
        .lean(),
      CommunityMember.countDocuments(filter),
    ]);

    res.json({
      success: true,
      members: members
        .filter((m) => m.user)
        .map((m) => ({
          _id: m._id,
          role: m.role,
          status: m.status,
          user: m.user,
          invitedBy: m.invitedBy || null,
          createdAt: m.createdAt,
        })),
      page,
      hasMore: page * MEMBER_PAGE < total,
    });
  } catch (error) {
    console.error("Get community members error:", error.message);
    res.status(500).json({ success: false, message: "Failed to load members" });
  }
};

/* ── Community posts & events ────────────────────────────── */

// GET /api/communities/:slug/posts?page= (active members only)
exports.getCommunityPosts = async (req, res) => {
  try {
    const { community } = await findVisibleCommunity(req.params.slug, req.user);
    if (!community) return res.status(404).json({ success: false, message: "Community not found" });

    if (community.status === "suspended") {
      return res.status(403).json({ success: false, message: "This community is suspended" });
    }
    const membership = await CommunityMember.findOne({ community: community._id, user: req.user.id });
    if (!membership || membership.status !== "active") {
      return res.status(403).json({ success: false, message: "Join this community to see its posts" });
    }

    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
    const filter = { community: community._id, status: "published" };

    const [posts, total] = await Promise.all([
      Post.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate("author", AUTHOR_FIELDS)
        .populate("event", EVENT_FIELDS)
        .populate("organization", ORG_FIELDS)
        .populate("community", COMMUNITY_FIELDS)
        .lean(),
      Post.countDocuments(filter),
    ]);

    // Reuse the feed's enrichment (like/comment counts, likedByMe, savedByMe…)
    const postController = require("./post.controller");
    const enriched = (await postController._enrichPosts(posts, req.user.id)).map(postController._sanitizeEvent);
    res.json({ success: true, posts: enriched, page, hasMore: page * limit < total });
  } catch (error) {
    console.error("Get community posts error:", error.message);
    res.status(500).json({ success: false, message: "Failed to load community posts" });
  }
};

// GET /api/communities/:slug/events (public — only public/unlisted events)
exports.getCommunityEvents = async (req, res) => {
  try {
    const { community } = await findVisibleCommunity(req.params.slug, req.user);
    if (!community) return res.status(404).json({ success: false, message: "Community not found" });

    const events = await Event.find({
      community: community._id,
      visibility: { $in: ["public", "unlisted"] },
      endDate: { $gte: new Date(Date.now() - 24 * 3600 * 1000) },
    })
      .sort({ startDate: 1, _id: 1 })
      .limit(50)
      .populate("organization", "name slug logoUrl")
      .lean();

    res.json({ success: true, events });
  } catch (error) {
    console.error("Get community events error:", error.message);
    res.status(500).json({ success: false, message: "Failed to load community events" });
  }
};

/* ── Ownership Verification (Super Admin system) ─────────── */

/**
 * POST /api/communities/:slug/claim { organizationId, description, documentUrl?, contactEmail }
 * An organization manager (or the Super Admin) claims this community for
 * their organization with proof. Sets community → "pending". A matching
 * email domain is captured as a signal — it NEVER auto-approves anything.
 */
exports.submitClaim = async (req, res) => {
  try {
    const { community } = await findVisibleCommunity(req.params.slug, req.user);
    if (!community) return res.status(404).json({ success: false, message: "Community not found" });

    const { organizationId, description = "", documentUrl = "", contactEmail = "" } = req.body || {};
    if (!organizationId) return res.status(400).json({ success: false, message: "Which organization is claiming?" });

    const claimant = await User.findById(req.user.id).select("email");
    if (!(await isOrgManager(claimant, organizationId))) {
      return res.status(403).json({ success: false, message: "Only managers of that organization can submit a claim" });
    }
    const org = await Organization.findById(organizationId).select("name slug");
    if (!org) return res.status(404).json({ success: false, message: "Organization not found" });

    if (["verified", "pending"].includes(community.status)) {
      return res.status(400).json({ success: false, message: `Community is already ${community.status}` });
    }
    if (String(community.officialOrganization || "") === String(organizationId)) {
      return res.status(400).json({ success: false, message: "This organization already owns this community" });
    }
    if (!String(description || "").trim()) {
      return res.status(400).json({ success: false, message: "Describe your proof of official ownership" });
    }

    const existing = await CommunityClaim.findOne({ community: community._id, organization: organizationId });
    if (existing && existing.status === "pending") {
      return res.status(400).json({ success: false, message: "A claim from this organization is already pending" });
    }

    const claim = await CommunityClaim.findOneAndUpdate(
      { community: community._id, organization: organizationId },
      {
        claimant: req.user.id,
        claimantDomain: emailDomain(claimant.email),
        proof: {
          description: String(description).trim().slice(0, 2000),
          documentUrl: String(documentUrl || "").trim(),
          contactEmail: String(contactEmail || "").trim(),
        },
        status: "pending",
        reviewedBy: null,
        reviewedAt: null,
        reviewNote: "",
        resolution: "",
      },
      { upsert: true, new: true }
    );

    community.status = "pending";
    await community.save();

    audit({
      community: community._id,
      organization: organizationId,
      actor: req.user.id,
      action: "claim_submitted",
      details: `${org.name} claimed ownership; domain signal "${claim.claimantDomain}" (signal only, manual review required)`,
    });

    res.status(201).json({ success: true, claim });
  } catch (error) {
    console.error("Submit claim error:", error.message);
    res.status(500).json({ success: false, message: "Failed to submit claim" });
  }
};

// GET /api/communities/claims?status=pending — Super Admin queue
exports.getClaims = async (req, res) => {
  try {
    const status = ["pending", "approved", "rejected"].includes(String(req.query.status))
      ? String(req.query.status)
      : "pending";
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));

    const filter = { status };
    const [claims, total] = await Promise.all([
      CommunityClaim.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate("community", "name slug status affiliationDomain officialOrganization")
        .populate("organization", "name slug isVerified")
        .populate("claimant", "firstName lastName username email")
        .populate("reviewedBy", "firstName lastName username")
        .lean(),
      CommunityClaim.countDocuments(filter),
    ]);
    res.json({ success: true, claims, page, hasMore: page * limit < total });
  } catch (error) {
    console.error("Get claims error:", error.message);
    res.status(500).json({ success: false, message: "Failed to load claims" });
  }
};

/**
 * POST /api/communities/claims/:claimId/review { decision, resolution?, note? }
 * Reviewer = Super Admin, or a manager of a VERIFIED target organization.
 *
 * decision:
 *   approve → resolution "grant"    : community verified in place
 *                                     (official org ownership, badge granted)
 *             resolution "transfer" : student community is renamed safely
 *                                     (-students/-community/unique) and kept
 *                                     with its history; a NEW official verified
 *                                     community takes the original handle.
 *   reject  → community back to unverified, claim recorded as rejected.
 */
exports.reviewClaim = async (req, res) => {
  try {
    const { decision, resolution = "transfer", note = "" } = req.body || {};
    if (!["approve", "reject"].includes(decision)) {
      return res.status(400).json({ success: false, message: "Decision must be approve or reject" });
    }

    const claim = await CommunityClaim.findById(req.params.claimId)
      .populate("community", "name slug status createdBy joinPolicy description organization officialOrganization")
      .populate("organization", "name slug isVerified createdBy");
    if (!claim) return res.status(404).json({ success: false, message: "Claim not found" });
    if (claim.status !== "pending") {
      return res.status(400).json({ success: false, message: "Claim already reviewed" });
    }

    // Reviewer authorization: Super Admin OR manager of the (verified) target org
    const reviewer = await User.findById(req.user.id).select("email");
    const superAdmin = isSuperAdminEmail(reviewer?.email);
    if (!superAdmin) {
      if (!claim.organization?.isVerified) {
        return res.status(403).json({
          success: false,
          message: "Only the Super Admin reviews claims for unverified organizations",
        });
      }
      if (!(await isOrgManager(reviewer, claim.organization._id))) {
        return res.status(403).json({ success: false, message: "Not authorized to review this claim" });
      }
    }

    const community = claim.community;
    if (!community || community.deletedAt) {
      return res.status(404).json({ success: false, message: "Community no longer exists" });
    }

    if (decision === "reject") {
      claim.status = "rejected";
      claim.reviewedBy = req.user.id;
      claim.reviewedAt = new Date();
      claim.reviewNote = String(note).slice(0, 1000);
      await claim.save();
      if (community.status === "pending") {
        community.status = "unverified";
        await community.save();
      }
      audit({
        community: community._id,
        organization: claim.organization?._id,
        actor: req.user.id,
        action: "claim_rejected",
        details: `claim rejected${note ? `: ${String(note).slice(0, 300)}` : ""}`,
      });
      return res.json({ success: true, result: "rejected", claim });
    }

    // ── APPROVE ──
    const org = claim.organization;
    if (!["grant", "transfer"].includes(resolution)) {
      return res.status(400).json({ success: false, message: "Resolution must be grant or transfer" });
    }

    if (resolution === "grant") {
      // Same community becomes the official one
      community.status = "verified";
      community.officialOrganization = org._id;
      await community.save();
      // Org owner + claimant become community admins
      const adminIds = [...new Set([String(org.createdBy), String(claim.claimant)])];
      for (const uid of adminIds) {
        await CommunityMember.findOneAndUpdate(
          { community: community._id, user: uid },
          { role: "admin", status: "active" },
          { upsert: true }
        );
      }
      audit({
        community: community._id,
        organization: org._id,
        actor: req.user.id,
        action: "claim_approved",
        details: `verified in place (grant) for ${org.name}`,
      });
      claim.resolution = "grant";
    } else {
      // TRANSFER: rename the student community safely, create the official one
      const originalSlug = community.slug;
      const originalName = community.name;
      // Safe suffix: -students first, then -community, then unique counter
      let newSlug = await uniqueCommunitySlug(`${originalSlug}-students`, community._id);
      if (newSlug === originalSlug) newSlug = await uniqueCommunitySlug(`${originalSlug}-community`, community._id);
      community.slug = newSlug;
      if (community.name === originalName) community.name = `${originalName} Students`;
      await community.save();

      const officialSlug = await uniqueCommunitySlug(originalSlug, community._id);
      const official = await Community.create({
        name: originalName,
        slug: officialSlug,
        description: community.description,
        joinPolicy: community.joinPolicy,
        organization: org._id,
        officialOrganization: org._id,
        createdBy: req.user.id, // Super Admin action; org managers added below
        status: "verified",
        affiliationDomain: claim.claimantDomain,
      });
      const adminIds = [...new Set([String(org.createdBy), String(claim.claimant)])];
      for (const uid of adminIds) {
        await CommunityMember.findOneAndUpdate(
          { community: official._id, user: uid },
          { role: "admin", status: "active" },
          { upsert: true }
        );
      }
      audit({
        community: community._id,
        organization: org._id,
        actor: req.user.id,
        action: "ownership_transferred",
        details: `official handle "${originalSlug}" transferred to ${org.name}; student community renamed to "${newSlug}" (history preserved)`,
      });
      audit({
        community: official._id,
        organization: org._id,
        actor: req.user.id,
        action: "claim_approved",
        details: `official verified community created for ${org.name} (transfer resolution)`,
      });
      claim.resolution = "transfer";
    }

    claim.status = "approved";
    claim.reviewedBy = req.user.id;
    claim.reviewedAt = new Date();
    claim.reviewNote = String(note).slice(0, 1000);
    await claim.save();

    res.json({ success: true, result: `approved:${resolution}`, claim });
  } catch (error) {
    console.error("Review claim error:", error.message);
    res.status(500).json({ success: false, message: "Failed to review claim" });
  }
};

/**
 * POST /api/communities/:slug/verification { action: "verify"|"revoke", organizationId?, note? }
 * Super Admin direct controls (no pending claim required).
 *   verify → status "verified" (+ official org if given)
 *   revoke → status "revoked" (verified badge removed permanently recorded)
 */
exports.setVerification = async (req, res) => {
  try {
    const { community } = await findVisibleCommunity(req.params.slug, req.user);
    if (!community) return res.status(404).json({ success: false, message: "Community not found" });

    const { action, organizationId, note = "" } = req.body || {};
    if (!["verify", "revoke"].includes(action)) {
      return res.status(400).json({ success: false, message: "Action must be verify or revoke" });
    }

    if (action === "verify") {
      if (organizationId) {
        const org = await Organization.findById(organizationId).select("name");
        if (!org) return res.status(404).json({ success: false, message: "Organization not found" });
        community.officialOrganization = org._id;
      }
      community.status = "verified";
      await community.save();
      audit({
        community: community._id,
        organization: community.officialOrganization,
        actor: req.user.id,
        action: "verified",
        details: `verification granted by Super Admin${note ? `: ${String(note).slice(0, 300)}` : ""}`,
      });
      return res.json({ success: true, status: "verified", community });
    }

    // revoke
    const wasVerified = community.status === "verified";
    community.status = "revoked";
    community.officialOrganization = null;
    await community.save();
    audit({
      community: community._id,
      actor: req.user.id,
      action: "verification_revoked",
      details: `verification revoked by Super Admin (was ${wasVerified ? "verified" : community.status})${note ? `: ${String(note).slice(0, 300)}` : ""}`,
    });
    res.json({ success: true, status: "revoked", community });
  } catch (error) {
    console.error("Set verification error:", error.message);
    res.status(500).json({ success: false, message: "Failed to update verification" });
  }
};

/**
 * POST /api/communities/:slug/suspend { action: "suspend"|"unsuspend", reason? }
 * Super Admin only. Suspended communities are hidden platform-wide
 * (lists, joins, posts, feed) but stay visible to their admins.
 */
exports.setSuspension = async (req, res) => {
  try {
    const community = await findLiveCommunityBySlug(req.params.slug);
    if (!community) return res.status(404).json({ success: false, message: "Community not found" });

    const { action, reason = "" } = req.body || {};
    if (!["suspend", "unsuspend"].includes(action)) {
      return res.status(400).json({ success: false, message: "Action must be suspend or unsuspend" });
    }

    if (action === "suspend") {
      if (community.status === "suspended") {
        return res.status(400).json({ success: false, message: "Already suspended" });
      }
      community.suspendedFrom = community.status; // restore on unsuspend
      community.status = "suspended";
      await community.save();
      audit({
        community: community._id,
        actor: req.user.id,
        action: "suspended",
        details: `suspended (was ${community.suspendedFrom})${reason ? `: ${String(reason).slice(0, 300)}` : ""}`,
      });
    } else {
      if (community.status !== "suspended") {
        return res.status(400).json({ success: false, message: "Not suspended" });
      }
      community.status = community.suspendedFrom || "unverified";
      community.suspendedFrom = null;
      await community.save();
      audit({
        community: community._id,
        actor: req.user.id,
        action: "unsuspended",
        details: `restored to "${community.status}"`,
      });
    }
    res.json({ success: true, status: community.status, community });
  } catch (error) {
    console.error("Set suspension error:", error.message);
    res.status(500).json({ success: false, message: "Failed to update suspension" });
  }
};

/**
 * PUT /api/communities/:slug/admin { name?, slug?, note? }
 * Super Admin only — change official handles/names safely. The old handle is
 * never silently orphaned: slugs always resolve uniquely.
 */
exports.adminUpdateCommunity = async (req, res) => {
  try {
    const community = await findLiveCommunityBySlug(req.params.slug);
    if (!community) return res.status(404).json({ success: false, message: "Community not found" });

    const { name, slug: newSlug, note = "" } = req.body || {};
    const changes = [];

    if (name !== undefined) {
      const trimmed = String(name).trim();
      if (trimmed.length < 3 || trimmed.length > 60) {
        return res.status(400).json({ success: false, message: "Community name must be 3–60 characters" });
      }
      if (trimmed !== community.name) {
        changes.push(`name "${community.name}" → "${trimmed}"`);
        community.name = trimmed;
      }
    }
    if (newSlug !== undefined && newSlug !== community.slug) {
      const base = slugify(String(newSlug));
      if (!base) return res.status(400).json({ success: false, message: "Invalid handle" });
      const unique = await uniqueCommunitySlug(base, community._id);
      changes.push(`handle "${community.slug}" → "${unique}"`);
      community.slug = unique;
    }

    if (!changes.length) return res.json({ success: true, community, message: "Nothing changed" });

    await community.save();
    audit({
      community: community._id,
      actor: req.user.id,
      action: changes.some((c) => c.startsWith("handle")) ? "handle_changed" : "renamed",
      details: changes.join("; ") + (note ? ` (${String(note).slice(0, 300)})` : ""),
    });
    res.json({ success: true, community });
  } catch (error) {
    console.error("Admin update community error:", error.message);
    res.status(500).json({ success: false, message: "Failed to update community" });
  }
};

/**
 * POST /api/communities/:slug/transfer { userId, note? }
 * Super Admin only — transfer community ownership to another user
 * (the new owner becomes a community admin; history is preserved).
 */
exports.transferOwnership = async (req, res) => {
  try {
    const community = await findLiveCommunityBySlug(req.params.slug);
    if (!community) return res.status(404).json({ success: false, message: "Community not found" });

    const { userId, note = "" } = req.body || {};
    if (!userId) return res.status(400).json({ success: false, message: "Target user required" });
    const target = await User.findById(userId).select("email firstName lastName");
    if (!target) return res.status(404).json({ success: false, message: "User not found" });

    // §10 UNTRANSFERABLE. Two distinct things are being protected:
    //   1. Super Admin STATUS cannot be handed to anyone else — there is no
    //      grant, so it cannot be transferred. Asserted in the audit.
    //   2. A community the Super Admin owns can only be transferred BY the
    //      Super Admin. `requireSuperAdmin` already guarantees the actor is
    //      the owner, so this is the belt to that braces: it means a future
    //      relaxation of the route guard cannot quietly strip the owner.
    const currentOwner = community.createdBy
      ? await User.findById(community.createdBy).select("email").lean()
      : null;
    const ownerVerdict = guardSuperAdmin(currentOwner, PROTECTED_ACTIONS.TRANSFER);
    if (!ownerVerdict.allowed) {
      audit({
        community: community._id,
        actor: req.user.id,
        action: "ownership_transfer_blocked",
        details: "refused: target community belongs to the permanent Super Admin",
      });
      return res.status(403).json({ success: false, message: ownerVerdict.reason });
    }

    const previous = community.createdBy;
    community.createdBy = target._id;
    await community.save();
    await CommunityMember.findOneAndUpdate(
      { community: community._id, user: target._id },
      { role: "admin", status: "active" },
      { upsert: true }
    );

    audit({
      community: community._id,
      actor: req.user.id,
      action: "ownership_transferred",
      details: `ownership transferred to ${target.firstName || ""} ${target.lastName || ""} (${target._id})${note ? `: ${String(note).slice(0, 300)}` : ""}`,
    });
    res.json({ success: true, community });
  } catch (error) {
    console.error("Transfer ownership error:", error.message);
    res.status(500).json({ success: false, message: "Failed to transfer ownership" });
  }
};

/**
 * POST /api/communities/:slug/resolve-duplicate { keep: "this"|"other", otherSlug, action? }
 * Super Admin only — resolve duplicate communities: the loser is renamed with
 * a safe suffix (and optionally suspended); the winner keeps its handle.
 */
exports.resolveDuplicate = async (req, res) => {
  try {
    const { keep = "this", otherSlug, action = "rename" } = req.body || {};
    if (!otherSlug) return res.status(400).json({ success: false, message: "Which duplicate community?" });

    const winner = await findLiveCommunityBySlug(req.params.slug);
    const loser = await findLiveCommunityBySlug(String(otherSlug));
    if (!winner || !loser) return res.status(404).json({ success: false, message: "Community not found" });
    if (String(winner._id) === String(loser._id)) {
      return res.status(400).json({ success: false, message: "Pick two different communities" });
    }

    const target = keep === "this" ? loser : winner;
    const newSlug = await uniqueCommunitySlug(`${target.slug}-community`, target._id);
    const oldSlug = target.slug;
    target.slug = newSlug;
    let suspended = false;
    if (action === "rename-suspend") {
      target.suspendedFrom = target.status === "suspended" ? target.suspendedFrom : target.status;
      target.status = "suspended";
      suspended = true;
    }
    await target.save();

    audit({
      community: target._id,
      actor: req.user.id,
      action: "duplicate_resolved",
      details: `duplicate of "${keep === "this" ? winner.slug : loser.slug}": handle "${oldSlug}" → "${newSlug}"${suspended ? " and suspended" : ""}`,
    });
    res.json({ success: true, community: target, renamedTo: newSlug, suspended });
  } catch (error) {
    console.error("Resolve duplicate error:", error.message);
    res.status(500).json({ success: false, message: "Failed to resolve duplicate" });
  }
};

// GET /api/communities/:slug/audit — full ownership/verification history
// (Super Admin + community admins only)
exports.getAuditLog = async (req, res) => {
  try {
    const { community } = await findVisibleCommunity(req.params.slug, req.user);
    if (!community) return res.status(404).json({ success: false, message: "Community not found" });

    const requester = await User.findById(req.user.id).select("email");
    if (!(await isCommunityManager(req.user, community._id)) && !isSuperAdminEmail(requester?.email)) {
      return res.status(403).json({ success: false, message: "Not authorized to view this history" });
    }

    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
    const filter = { community: community._id };
    const [entries, total] = await Promise.all([
      AuditLog.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate("actor", "firstName lastName username")
        .lean(),
      AuditLog.countDocuments(filter),
    ]);
    res.json({ success: true, entries, page, hasMore: page * limit < total });
  } catch (error) {
    console.error("Get audit log error:", error.message);
    res.status(500).json({ success: false, message: "Failed to load history" });
  }
};
