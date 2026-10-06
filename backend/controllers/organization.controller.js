const mongoose = require("mongoose");
const Organization = require("../models/organization.model");
const User = require("../models/user.model");
const OrgFollow = require("../models/orgFollow.model");
const { notify } = require("../services/notification.service");
const { PostRepository, OrganizationRepository } = require("../repositories");
const Event = require("../models/event.model");
const RegistrationResponse = require("../models/registrationResponse.model");
const AuditLog = require("../models/auditLog.model");
const { isSuperAdminEmail } = require("../middleware/auth.middleware");

const slugify = (s) =>
  String(s).toLowerCase().trim().replace(/[^a-z0-9\s-]/g, "").replace(/[\s_]+/g, "-").replace(/-+/g, "-").slice(0, 60);

/**
 * True if the request user may manage the org:
 * creator, assigned managers (Ownership Verification system),
 * platform admins, or the permanent Super Admin.
 */
async function canManageOrg(req, org) {
  if (!req.user) return false;
  if (req.user.role === "admin") return true;
  if (String(org.createdBy) === String(req.user.id)) return true;
  if ((org.managers || []).some((m) => String(m) === String(req.user.id))) return true;
  const me = await User.findById(req.user.id).select("email").lean();
  return Boolean(me && isSuperAdminEmail(me.email));
}

/* ── Create ──────────────────────────────────────────────── */

// POST /api/organizations  (admin)
exports.createOrganization = async (req, res) => {
  try {
    const { name, description = "", logoUrl = "", coverUrl = "", website = "" } = req.body;
    if (!String(name || "").trim()) {
      return res.status(400).json({ success: false, message: "Organization name is required" });
    }

    // Unique slug (suffix on collision)
    const base = slugify(name) || "org";
    let slug = base;
    for (let i = 1; await Organization.exists({ slug }); i++) slug = `${base}-${i}`;

    const org = await Organization.create({
      name: String(name).trim(),
      slug,
      description: String(description).slice(0, 1000),
      logoUrl: String(logoUrl),
      coverUrl: String(coverUrl),
      website: String(website),
      createdBy: req.user.id,
    });
    res.status(201).json({ success: true, organization: org });
  } catch (error) {
    console.error("Create organization error:", error.message);
    res.status(500).json({ success: false, message: "Failed to create organization" });
  }
};

/* ── Update ──────────────────────────────────────────────── */

// PUT /api/organizations/:id  (creator or admin)
exports.updateOrganization = async (req, res) => {
  try {
    const org = await Organization.findById(req.params.id);
    if (!org) return res.status(404).json({ success: false, message: "Organization not found" });
    if (!(await canManageOrg(req, org))) {
      return res.status(403).json({ success: false, message: "You can't manage this organization" });
    }

    const { name, description, logoUrl, coverUrl, website } = req.body;
    if (name !== undefined && String(name).trim()) org.name = String(name).trim();
    if (description !== undefined) org.description = String(description).slice(0, 1000);
    if (logoUrl !== undefined) org.logoUrl = String(logoUrl);
    if (coverUrl !== undefined) org.coverUrl = String(coverUrl);
    if (website !== undefined) org.website = String(website);
    await org.save();

    res.json({ success: true, organization: org });
  } catch (error) {
    console.error("Update organization error:", error.message);
    res.status(500).json({ success: false, message: "Failed to update organization" });
  }
};

/* ── Read ────────────────────────────────────────────────── */

// GET /api/organizations?q=  (public list with real counts)
exports.getOrganizations = async (req, res) => {
  try {
    const { q } = req.query;
    const filter = {};
    if (q && String(q).trim()) {
      const escaped = String(q).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      filter.name = { $regex: escaped, $options: "i" };
    }

    const orgs = await Organization.find(filter).sort({ createdAt: -1 }).limit(50).lean();
    const ids = orgs.map((o) => o._id);

    const [followerAgg, eventAgg] = await Promise.all([
      OrgFollow.aggregate([
        { $match: { organization: { $in: ids } } },
        { $group: { _id: "$organization", count: { $sum: 1 } } },
      ]),
      Event.aggregate([
        { $match: { organization: { $in: ids }, visibility: "public", endDate: { $gte: new Date() } } },
        { $group: { _id: "$organization", count: { $sum: 1 } } },
      ]),
    ]);
    const fMap = new Map(followerAgg.map((r) => [String(r._id), r.count]));
    const eMap = new Map(eventAgg.map((r) => [String(r._id), r.count]));

    res.json({
      success: true,
      organizations: orgs.map((o) => ({
        ...o,
        followerCount: fMap.get(String(o._id)) || 0,
        upcomingEventCount: eMap.get(String(o._id)) || 0,
      })),
    });
  } catch (error) {
    console.error("List organizations error:", error.message);
    res.status(500).json({ success: false, message: "Failed to load organizations" });
  }
};

// GET /api/organizations/mine  (orgs the caller can attach events to)
exports.getMyOrganizations = async (req, res) => {
  try {
    // Super Admin sees all; admins see all; everyone else sees orgs they
    // created OR were assigned to manage (Ownership Verification system)
    const meDoc = await User.findById(req.user.id).select("email role").lean();
    const isSA = Boolean(meDoc && isSuperAdminEmail(meDoc.email));
    const filter =
      req.user.role === "admin" || isSA
        ? {}
        : { $or: [{ createdBy: req.user.id }, { managers: req.user.id }] };
    const orgs = await Organization.find(filter).select("name slug logoUrl isVerified").sort({ name: 1 }).lean();
    res.json({ success: true, organizations: orgs });
  } catch (error) {
    console.error("My organizations error:", error.message);
    res.status(500).json({ success: false, message: "Failed to load organizations" });
  }
};

// GET /api/organizations/mine/followed  (sidebar communities)
exports.getFollowedOrganizations = async (req, res) => {
  try {
    const follows = await OrgFollow.find({ user: req.user.id })
      .populate("organization", "name slug logoUrl")
      .sort({ createdAt: -1 })
      .lean();
    res.json({
      success: true,
      organizations: follows.map((f) => f.organization).filter(Boolean),
    });
  } catch (error) {
    console.error("Followed organizations error:", error.message);
    res.status(500).json({ success: false, message: "Failed to load communities" });
  }
};

// GET /api/organizations/:slug  (public profile, viewer-aware)
exports.getOrganizationBySlug = async (req, res) => {
  try {
    const org = await Organization.findOne({ slug: String(req.params.slug).toLowerCase() }).lean();
    if (!org) return res.status(404).json({ success: false, message: "Organization not found" });

    const orgId = org._id;
    const now = new Date();
    const [followers, upcomingCount, pastCount, viewerFollow, recentFollowers, managerDocs] = await Promise.all([
      OrgFollow.countDocuments({ organization: orgId }),
      Event.countDocuments({ organization: orgId, visibility: "public", endDate: { $gte: now } }),
      Event.countDocuments({ organization: orgId, visibility: "public", endDate: { $lt: now } }),
      req.user
        ? OrgFollow.exists({ user: req.user.id, organization: orgId })
        : Promise.resolve(false),
      // Real followers preview (recent 6, counts only in public view)
      OrgFollow.find({ organization: orgId })
        .sort({ createdAt: -1 })
        .limit(6)
        .populate("user", "firstName lastName username profile.avatar")
        .lean(),
      // Org team: creator + assigned managers (real docs)
      User.find({ _id: { $in: [org.createdBy, ...(org.managers || [])] } })
        .select("firstName lastName username profile.avatar")
        .lean(),
    ]);

    const canManage = req.user
      ? await canManageOrg(req, { ...org, managers: org.managers })
      : false;

    res.json({
      success: true,
      organization: {
        ...org,
        followerCount: followers,
        upcomingEventCount: upcomingCount,
        pastEventCount: pastCount,
        following: Boolean(viewerFollow),
        followersPreview: recentFollowers.map((f) => f.user).filter(Boolean),
        managers: managerDocs,
        canManage,
      },
    });
  } catch (error) {
    console.error("Get organization error:", error.message);
    res.status(500).json({ success: false, message: "Failed to load organization" });
  }
};

// GET /api/organizations/:slug/events  (public events of the org)
exports.getOrganizationEvents = async (req, res) => {
  try {
    const org = await Organization.findOne({ slug: String(req.params.slug).toLowerCase() }).select("_id");
    if (!org) return res.status(404).json({ success: false, message: "Organization not found" });

    const now = new Date();
    const [upcoming, past] = await Promise.all([
      Event.find({ organization: org._id, visibility: "public", endDate: { $gte: now } })
        .select("title slug description category venue eventType startDate endDate bannerUrl organizer price isFeatured visibility maxAttendees")
        .sort({ startDate: 1 })
        .lean(),
      Event.find({ organization: org._id, visibility: "public", endDate: { $lt: now } })
        .select("title slug description category venue eventType startDate endDate bannerUrl organizer price isFeatured visibility maxAttendees")
        .sort({ endDate: -1 })
        .limit(12)
        .lean(),
    ]);

    res.json({ success: true, upcoming, past });
  } catch (error) {
    console.error("Organization events error:", error.message);
    res.status(500).json({ success: false, message: "Failed to load organization events" });
  }
};

/* ── Follow ──────────────────────────────────────────────── */

// POST /api/organizations/:id/follow  (toggle)
exports.toggleFollowOrg = async (req, res) => {
  try {
    const org = await Organization.findById(req.params.id);
    if (!org) return res.status(404).json({ success: false, message: "Organization not found" });

    const existing = await OrgFollow.findOne({ user: req.user.id, organization: org._id });
    if (existing) {
      await existing.deleteOne();
      // §13 — the follower's cached social graph holds their org follows;
      // without this the "Following" tab keeps showing org posts they just
      // unfollowed (and hides orgs they just followed).
      PostRepository.invalidateFeedContext(req.user.id);
      OrganizationRepository.invalidate(org); // follower count changed
      return res.json({ success: true, following: false });
    }
    await OrgFollow.create({ user: req.user.id, organization: org._id });
    PostRepository.invalidateFeedContext(req.user.id);
    OrganizationRepository.invalidate(org);
    notify({ user: org.createdBy, actor: req.user.id, type: "org_follow", organization: org._id });
    res.json({ success: true, following: true });
  } catch (error) {
    console.error("Toggle org follow error:", error.message);
    res.status(500).json({ success: false, message: "Failed to update follow" });
  }
};

/*
 * SUGGESTED ORGANIZATIONS (Part 3 §62) — deterministic, no ML:
 *   primary: organizations behind events I registered for (not followed yet),
 *            ranked by how many of my events belong to them;
 *   fallback: most-followed organizations (real popularity).
 */
// GET /api/organizations/suggested?limit=3
exports.getSuggestedOrganizations = async (req, res) => {
  try {
    const me = req.user.id;
    const limit = Math.min(6, Math.max(1, parseInt(req.query.limit) || 3));

    const myRegs = await RegistrationResponse.find({ userId: me })
      .populate("eventId", "organization")
      .select("eventId")
      .lean();

    const alreadyFollowed = new Set(
      (await OrgFollow.find({ user: me }).select("organization").lean()).map((f) => String(f.organization))
    );

    const orgScore = new Map();
    for (const r of myRegs) {
      const orgId = r.eventId?.organization;
      if (!orgId) continue;
      const key = String(orgId);
      if (alreadyFollowed.has(key)) continue;
      orgScore.set(key, (orgScore.get(key) || 0) + 1);
    }

    let ids = [...orgScore.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([id]) => id);

    // Fallback: most-followed orgs I don't follow yet
    if (ids.length < limit) {
      const topAgg = await OrgFollow.aggregate([
        { $group: { _id: "$organization", followers: { $sum: 1 } } },
        { $sort: { followers: -1 } },
        { $limit: limit * 4 },
      ]);
      for (const t of topAgg) {
        const key = String(t._id);
        if (alreadyFollowed.has(key) || ids.includes(key)) continue;
        ids.push(key);
        if (ids.length >= limit) break;
      }
    }
    if (!ids.length) return res.json({ success: true, organizations: [] });

    const orgs = await Organization.find({ _id: { $in: ids } })
      .select("name slug logoUrl description")
      .lean()
      .then((list) => ids.map((id) => list.find((o) => String(o._id) === id)).filter(Boolean));

    res.json({ success: true, organizations: orgs });
  } catch (error) {
    console.error("Suggested organizations error:", error.message);
    res.status(500).json({ success: false, message: "Failed to load suggestions" });
  }
};


/* ── Ownership Verification: Super Admin organization controls ── */

// POST /api/organizations/:id/verify { note? } — grant the Verified badge (Super Admin)
exports.verifyOrganization = async (req, res) => {
  try {
    const org = await Organization.findById(req.params.id);
    if (!org) return res.status(404).json({ success: false, message: "Organization not found" });
    if (org.isVerified) return res.status(400).json({ success: false, message: "Already verified" });

    org.isVerified = true;
    org.verifiedAt = new Date();
    await org.save();
    AuditLog.create({
      organization: org._id,
      actor: req.user.id,
      action: "org_verified",
      details: `Verified badge granted${req.body?.note ? `: ${String(req.body.note).slice(0, 300)}` : ""}`,
    }).catch(() => {});
    res.json({ success: true, organization: org });
  } catch (error) {
    console.error("Verify organization error:", error.message);
    res.status(500).json({ success: false, message: "Failed to verify organization" });
  }
};

// POST /api/organizations/:id/unverify { note? } — revoke the Verified badge (Super Admin)
exports.unverifyOrganization = async (req, res) => {
  try {
    const org = await Organization.findById(req.params.id);
    if (!org) return res.status(404).json({ success: false, message: "Organization not found" });
    if (!org.isVerified) return res.status(400).json({ success: false, message: "Not verified" });

    org.isVerified = false;
    org.verifiedAt = null;
    await org.save();
    // Verified communities owned by this org lose their verified status too
    const Community = require("../models/community.model");
    const demoted = await Community.updateMany(
      { officialOrganization: org._id, status: "verified" },
      { $set: { status: "revoked", officialOrganization: null } }
    );
    AuditLog.create({
      organization: org._id,
      actor: req.user.id,
      action: "org_unverified",
      details: `Verified badge revoked; ${demoted.modifiedCount || 0} community(ies) demoted to revoked`,
    }).catch(() => {});
    res.json({ success: true, organization: org, communitiesDemoted: demoted.modifiedCount || 0 });
  } catch (error) {
    console.error("Unverify organization error:", error.message);
    res.status(500).json({ success: false, message: "Failed to unverify organization" });
  }
};

// POST /api/organizations/:id/managers { userId } — assign a manager (Super Admin)
exports.addOrgManager = async (req, res) => {
  try {
    const org = await Organization.findById(req.params.id);
    if (!org) return res.status(404).json({ success: false, message: "Organization not found" });
    const { userId } = req.body || {};
    if (!userId) return res.status(400).json({ success: false, message: "User required" });
    const user = await User.findById(userId).select("email firstName lastName");
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    if ((org.managers || []).some((m) => String(m) === String(userId))) {
      return res.status(400).json({ success: false, message: "Already a manager" });
    }
    org.managers = [...(org.managers || []), userId];
    await org.save();
    AuditLog.create({
      organization: org._id,
      actor: req.user.id,
      action: "manager_assigned",
      details: `manager added: ${user.firstName || ""} ${user.lastName || ""} (${userId})`,
    }).catch(() => {});
    res.json({ success: true, organization: org });
  } catch (error) {
    console.error("Add org manager error:", error.message);
    res.status(500).json({ success: false, message: "Failed to add manager" });
  }
};

// POST /api/organizations/:id/managers/remove { userId } — remove a manager (Super Admin)
exports.removeOrgManager = async (req, res) => {
  try {
    const org = await Organization.findById(req.params.id);
    if (!org) return res.status(404).json({ success: false, message: "Organization not found" });
    const { userId } = req.body || {};
    if (!userId) return res.status(400).json({ success: false, message: "User required" });

    // The org creator is a permanent manager — only reassignment via Super Admin transfer
    if (String(org.createdBy) === String(userId)) {
      return res.status(400).json({ success: false, message: "The organization creator cannot be removed as manager" });
    }
    // The Super Admin can never be removed
    const target = await User.findById(userId).select("email");
    if (target && isSuperAdminEmail(target.email)) {
      return res.status(403).json({ success: false, message: "The Super Admin cannot be removed" });
    }

    if (!(org.managers || []).some((m) => String(m) === String(userId))) {
      return res.status(400).json({ success: false, message: "Not a manager" });
    }
    org.managers = org.managers.filter((m) => String(m) !== String(userId));
    await org.save();
    AuditLog.create({
      organization: org._id,
      actor: req.user.id,
      action: "manager_removed",
      details: `manager removed (${userId})`,
    }).catch(() => {});
    res.json({ success: true, organization: org });
  } catch (error) {
    console.error("Remove org manager error:", error.message);
    res.status(500).json({ success: false, message: "Failed to remove manager" });
  }
};


/* ── Organizations v2 (Part 3, Phase 7) ───────────────────── */

// GET /api/organizations/:slug/posts — public org posts (announcements, event shares)
exports.getOrganizationPosts = async (req, res) => {
  try {
    const org = await Organization.findOne({ slug: String(req.params.slug).toLowerCase() }).select("_id");
    if (!org) return res.status(404).json({ success: false, message: "Organization not found" });

    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
    const Post = require("../models/post.model");
    const filter = { organization: org._id, status: "published", visibility: "public" };

    const [posts, total] = await Promise.all([
      Post.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate("author", "firstName lastName username verified email profile.avatar profile.institution")
        .populate("event", "title slug bannerUrl startDate endDate venue eventType category organizer price visibility isLive")
        .populate("organization", "name slug logoUrl")
        .populate("community", "name slug avatarUrl")
        .lean(),
      Post.countDocuments(filter),
    ]);

    // Reuse the feed's enrichment (counts + likedByMe etc.)
    const postController = require("./post.controller");
    const enriched = (await postController._enrichPosts(posts, req.user?.id || null)).map(
      postController._sanitizeEvent
    );
    res.json({ success: true, posts: enriched, page, hasMore: page * limit < total });
  } catch (error) {
    console.error("Get organization posts error:", error.message);
    res.status(500).json({ success: false, message: "Failed to load organization posts" });
  }
};

// GET /api/organizations/:slug/communities — org-backed + officially owned communities
exports.getOrganizationCommunities = async (req, res) => {
  try {
    const org = await Organization.findOne({ slug: String(req.params.slug).toLowerCase() }).select("_id");
    if (!org) return res.status(404).json({ success: false, message: "Organization not found" });

    const Community = require("../models/community.model");
    const CommunityMember = require("../models/communityMember.model");
    const communities = await Community.find({
      $or: [{ organization: org._id }, { officialOrganization: org._id }],
      deletedAt: null,
      status: { $ne: "suspended" },
    })
      .sort({ createdAt: -1, _id: -1 })
      .limit(24)
      .lean();

    // Real member counts
    const agg = await CommunityMember.aggregate([
      { $match: { community: { $in: communities.map((c) => c._id) }, status: "active" } },
      { $group: { _id: "$community", count: { $sum: 1 } } },
    ]);
    const counts = new Map(agg.map((a) => [String(a._id), a.count]));

    res.json({
      success: true,
      communities: communities.map((c) => ({ ...c, memberCount: counts.get(String(c._id)) || 0 })),
    });
  } catch (error) {
    console.error("Get organization communities error:", error.message);
    res.status(500).json({ success: false, message: "Failed to load communities" });
  }
};
