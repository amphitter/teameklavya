const mongoose = require("mongoose");
const Organization = require("../models/organization.model");
const User = require("../models/user.model");
const OrgFollow = require("../models/orgFollow.model");
const OrganizationMembership = require("../models/organizationMembership.model");
const { notify } = require("../services/notification.service");
const {
  getEffectiveOrganizationMembership,
  canEditOrganizationProfile,
  getOrganizationMembershipAdminRole,
  canManageOrganizationEvents,
} = require("../services/organization-permissions.service");
const { PostRepository, OrganizationRepository } = require("../repositories");
const Event = require("../models/event.model");
const RegistrationResponse = require("../models/registrationResponse.model");
const AuditLog = require("../models/auditLog.model");
const { isSuperAdminEmail } = require("../middleware/auth.middleware");
const { ERROR_CODES } = require("../utils/app-error");
const urlSafety = require("../services/url-safety.service");
const {
  ORGANIZATION_CATEGORIES,
  ORGANIZATION_PARENT_CATEGORIES,
  parentCategoriesForOrganization,
  childCategoriesForOrganization,
} = require("../config/organization");
const {
  parseLimit,
  decodeCursor,
  encodeCursor,
  buildPage,
  withCursor,
} = require("../repositories/cursor");

const slugify = (s) =>
  String(s).toLowerCase().trim().replace(/[^a-z0-9\s-]/g, "").replace(/[\s_]+/g, "-").replace(/-+/g, "-").slice(0, 60);

const ORGANIZATION_DIRECTORY_FIELDS = [
  "name handle slug category description logo cover logoUrl coverUrl website",
  "address city state country postalCode isVerified verifiedAt createdBy managers",
  "parentOrganizationId affiliationStatus affiliationApprovedAt createdAt updatedAt",
].join(" ");
const ORGANIZATION_RELATION_FIELDS = [
  "name handle slug category description logo cover logoUrl coverUrl",
  "city state country isVerified createdAt parentOrganizationId affiliationStatus",
].join(" ");

const PROFILE_TEXT_LIMITS = Object.freeze({
  address: 300,
  city: 120,
  state: 120,
  country: 120,
  postalCode: 32,
  phone: 40,
});

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function validationResponse(res, message) {
  return res.status(400).json({
    success: false,
    message,
    error: { code: ERROR_CODES.VALIDATION_ERROR, message },
  });
}

/** Only store safe http(s) links in social-link fields that become anchors. */
function normalizeSocialLinks(raw) {
  if (raw === null) return { value: {} };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { error: "socialLinks must be an object of platform URLs" };
  }

  const entries = Object.entries(raw);
  if (entries.length > 12) return { error: "socialLinks may contain at most 12 links" };
  const value = {};
  for (const [platform, rawUrl] of entries) {
    const key = String(platform).trim().toLowerCase();
    if (!/^[a-z][a-z0-9_-]{0,31}$/.test(key)) {
      return { error: `Invalid social link name: ${platform}` };
    }
    if (rawUrl === undefined || rawUrl === null || (typeof rawUrl === "string" && !rawUrl.trim())) continue;
    if (typeof rawUrl !== "string" || rawUrl.length > 2048) {
      return { error: `socialLinks.${key} must be a URL of 2048 characters or fewer` };
    }
    const safe = urlSafety.validateExternalUrl(rawUrl, { field: `socialLinks.${key}` });
    if (!safe.ok) return { error: safe.reason };
    value[key] = safe.url;
  }
  return { value };
}

/** Parse and whitelist profile fields; lifecycle and ownership are not writable here. */
function profilePatchFromBody(body = {}) {
  const patch = {};

  if (body.category !== undefined) {
    const category = typeof body.category === "string" ? body.category.trim().toUpperCase() : "";
    if (!ORGANIZATION_CATEGORIES.includes(category)) {
      return { error: "Choose a valid organization category" };
    }
    patch.category = category;
  }

  for (const [field, max] of Object.entries(PROFILE_TEXT_LIMITS)) {
    if (body[field] === undefined) continue;
    if (body[field] !== null && typeof body[field] !== "string") {
      return { error: `${field} must be text` };
    }
    patch[field] = String(body[field] ?? "").trim().slice(0, max);
  }

  if (body.email !== undefined) {
    if (body.email !== null && typeof body.email !== "string") return { error: "email must be text" };
    const email = String(body.email ?? "").trim().toLowerCase().slice(0, 254);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return { error: "Enter a valid contact email" };
    }
    patch.email = email;
  }

  if (body.socialLinks !== undefined) {
    const socialLinks = normalizeSocialLinks(body.socialLinks);
    if (socialLinks.error) return socialLinks;
    patch.socialLinks = socialLinks.value;
  }

  if (body.mapUrl !== undefined) {
    if (body.mapUrl === null || body.mapUrl === "") {
      patch.mapUrl = "";
    } else {
      if (typeof body.mapUrl !== "string") return { error: "mapUrl must be text" };
      const trimmed = String(body.mapUrl).trim().slice(0, 2048);
      if (!trimmed) {
        patch.mapUrl = "";
      } else {
        const safe = urlSafety.validateExternalUrl(trimmed, { field: "mapUrl" });
        if (!safe.ok) return { error: safe.reason };
        // Additional allowlist for map providers – keep safe but restrict to known domains for embed safety
        try {
          const u = new URL(safe.url);
          const host = u.hostname.toLowerCase();
          const allowedHosts = [
            "google.com",
            "www.google.com",
            "maps.google.com",
            "maps.app.goo.gl",
            "goo.gl",
            "openstreetmap.org",
            "www.openstreetmap.org",
            "bing.com",
            "www.bing.com",
            "maps.bing.com",
            "mapbox.com",
            "api.mapbox.com",
            "www.mapbox.com",
            "here.com",
            "maps.here.com",
          ];
          const isAllowed = allowedHosts.some((h) => host === h || host.endsWith(`.${h}`));
          if (!isAllowed) {
            return { error: "mapUrl must be a Google Maps, OpenStreetMap, Bing, or Mapbox link" };
          }
        } catch {
          return { error: "Invalid mapUrl" };
        }
        patch.mapUrl = safe.url;
      }
    }
  }

  for (const [field, min, max] of [["latitude", -90, 90], ["longitude", -180, 180]]) {
    if (body[field] === undefined) continue;
    const raw = body[field];
    if (raw === null || raw === "") {
      patch[field] = null;
      continue;
    }
    const number = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isFinite(number) || number < min || number > max) {
      return { error: `${field} must be between ${min} and ${max}` };
    }
    patch[field] = number;
  }

  return { patch };
}

function organizationByPublicHandle(value, projection) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return null;
  let query = Organization.findOne({ $or: [{ handle: normalized }, { slug: normalized }] });
  if (projection) query = query.select(projection);
  return query;
}

function publicOrganizationShape(org) {
  const visible = { ...org };
  // Lifecycle and ownership state remains backend-only; Phase 3 exposes only
  // the parent relation and a narrow public Organization card.
  for (const field of ["status", "verificationStatus", "ownershipStatus", "latitude", "longitude"]) {
    delete visible[field];
  }
  return {
    ...visible,
    handle: org.handle || org.slug,
    category: org.category || "OTHER",
    logo: org.logo || org.logoUrl || "",
    cover: org.cover || org.coverUrl || "",
    address: org.address || "",
    city: org.city || "",
    state: org.state || "",
    country: org.country || "",
    postalCode: org.postalCode || "",
    mapUrl: org.mapUrl || "",
    email: org.email || "",
    phone: org.phone || "",
    socialLinks: org.socialLinks && typeof org.socialLinks === "object" ? org.socialLinks : {},
    parentOrganizationId: org.parentOrganizationId || null,
    affiliationStatus: org.affiliationStatus || "NONE",
    affiliationApprovedAt: org.affiliationApprovedAt || null,
  };
}

function publicOrganizationCard(org) {
  if (!org) return null;
  return {
    _id: org._id,
    name: org.name,
    handle: org.handle || org.slug,
    slug: org.slug,
    category: org.category || "OTHER",
    description: org.description || "",
    logo: org.logo || org.logoUrl || "",
    cover: org.cover || org.coverUrl || "",
    city: org.city || "",
    state: org.state || "",
    country: org.country || "",
    isVerified: org.isVerified === true,
    parentOrganizationId: org.parentOrganizationId || null,
    affiliationStatus: org.affiliationStatus || "NONE",
  };
}

function cursorAfterDate(rawCursor, field, direction) {
  const cursor = decodeCursor(rawCursor);
  if (!cursor?.at || !cursor?.id) return null;
  const at = new Date(cursor.at);
  if (Number.isNaN(at.getTime()) || typeof cursor.id !== "string" || !mongoose.Types.ObjectId.isValid(cursor.id)) return null;
  const id = new mongoose.Types.ObjectId(cursor.id);
  const operator = direction === "asc" ? "$gt" : "$lt";
  return {
    $or: [
      { [field]: { [operator]: at } },
      { [field]: at, _id: { [operator]: id } },
    ],
  };
}

function pageByDate(rows, limit, field) {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  const date = last?.[field] ? new Date(last[field]) : null;
  return {
    items,
    hasMore,
    nextCursor: hasMore && last && date && !Number.isNaN(date.getTime())
      ? encodeCursor({ at: date.toISOString(), id: String(last._id) })
      : null,
  };
}

/** Profile capability used by existing edit/link endpoints. */
async function canManageOrg(req, org) {
  return canEditOrganizationProfile(req.user, org);
}

const ASSIGNABLE_ORGANIZATION_ROLES = new Set(["ADMIN", "EDITOR", "EVENT_MANAGER", "MEMBER"]);

function validObjectId(value) {
  return typeof value === "string" && /^[a-f0-9]{24}$/i.test(value);
}

function publicMembership(membership) {
  if (!membership) return null;
  const member = typeof membership.toObject === "function" ? membership.toObject() : { ...membership };
  const user = member.userId && typeof member.userId === "object" && !member.userId._bsontype
    ? member.userId
    : null;
  return {
    _id: member._id,
    user: user ? {
      _id: user._id,
      firstName: user.firstName || "",
      lastName: user.lastName || "",
      username: user.username || "",
      profile: { avatar: user.profile?.avatar || "" },
    } : member.userId ? { _id: String(member.userId) } : null,
    role: member.role,
    status: member.status,
    joinedAt: member.joinedAt || null,
    invitedAt: member.invitedAt || null,
    createdAt: member.createdAt,
  };
}

/* ── Create ──────────────────────────────────────────────── */

// POST /api/organizations  (admin)
/** Slugs are indexed; Mongo rejects an index key over ~1024 bytes. */
const MAX_SLUG_LEN = 80;

exports.createOrganization = async (req, res, next) => {
  try {
    const body = req.body || {};
    // §27 — website is rendered as an href; only http(s) may be stored.
    if (urlSafety.rejectUnsafeUrls(req, res, ["website"])) return;

    const { name, description = "", logoUrl = "", coverUrl = "", website = "" } = body;
    if (!String(name || "").trim()) {
      return res.status(400).json({ success: false, message: "Organization name is required" });
    }

    /* Bound input before using the name to construct the unique slug. */
    const trimmed = String(name).trim();
    if (trimmed.length > 100) {
      return validationResponse(res, "Organization name must be 100 characters or fewer");
    }

    const profile = profilePatchFromBody(body);
    if (profile.error) return validationResponse(res, profile.error);

    // Unique slug (suffix on collision); the model mirrors this to `handle`.
    const base = (slugify(trimmed) || "org").slice(0, MAX_SLUG_LEN);
    let slug = base;
    for (let i = 1; await Organization.exists({ slug }); i++) slug = `${base}-${i}`;

    const org = await Organization.create({
      name: trimmed,
      slug,
      description: String(description).slice(0, 1000),
      logoUrl: String(logoUrl),
      coverUrl: String(coverUrl),
      website: String(website),
      createdBy: req.user.id,
      ...profile.patch,
    });
    // Preserve the existing admin-only creation flow. If membership storage
    // is temporarily unavailable, createdBy remains a compatibility fallback.
    await OrganizationMembership.updateOne(
      { organizationId: org._id, userId: req.user.id },
      { $set: { role: "OWNER", status: "ACTIVE" }, $setOnInsert: { joinedAt: org.createdAt } },
      { upsert: true, runValidators: true }
    ).catch((membershipError) => {
      console.error("Organization owner membership sync failed:", membershipError.message);
    });
    res.status(201).json({ success: true, organization: publicOrganizationShape(org.toObject()) });
  } catch (error) {
    if (typeof next === "function") return next(error);
    if (error.name === "ValidationError" || error.name === "CastError") {
      return validationResponse(res, error.message);
    }
    res.status(500).json({ success: false, message: "Failed to create organization" });
  }
};

/* ── Update ──────────────────────────────────────────────── */

// PUT /api/organizations/:id  (creator or admin)
exports.updateOrganization = async (req, res) => {
  try {
    const body = req.body || {};
    const org = await Organization.findById(req.params.id);
    if (!org) return res.status(404).json({ success: false, message: "Organization not found" });
    if (!(await canManageOrg(req, org))) {
      return res.status(403).json({ success: false, message: "You can't manage this organization" });
    }

    // §27 — same guard on update. Keep the existing permission boundary and
    // accept only the explicit profile allowlist below.
    if (urlSafety.rejectUnsafeUrls(req, res, ["website"])) return;
    const profile = profilePatchFromBody(body);
    if (profile.error) return validationResponse(res, profile.error);

    const finalCategory = profile.patch.category || org.category || "OTHER";
    if (profile.patch.category !== undefined) {
      const childCategories = await Organization.distinct("category", { parentOrganizationId: org._id });
      const incompatibleChild = childCategories.some(
        (childCategory) => !parentCategoriesForOrganization(childCategory).includes(finalCategory)
      );
      if (incompatibleChild) {
        return validationResponse(res, "Move or unlink affiliated clubs before changing this institution category");
      }
    }

    const parentWasProvided = body.parentOrganizationId !== undefined;
    if (parentWasProvided || profile.patch.category !== undefined) {
      const rawParentId = parentWasProvided
        ? body.parentOrganizationId
        : org.parentOrganizationId ? String(org.parentOrganizationId) : null;
      let parentId = null;
      let parentDoc = null;
      if (rawParentId !== null && rawParentId !== "") {
        if (typeof rawParentId !== "string" || !/^[a-f0-9]{24}$/i.test(rawParentId)) {
          return validationResponse(res, "parentOrganizationId must be a valid organization ID or null");
        }
        const allowedParentCategories = parentCategoriesForOrganization(finalCategory);
        if (!allowedParentCategories.length) {
          return validationResponse(res, "This organization category cannot be linked to a parent institution");
        }
        if (rawParentId === String(org._id)) {
          return validationResponse(res, "An organization cannot be its own parent");
        }
        parentDoc = await Organization.findById(rawParentId).select("_id category parentOrganizationId").lean();
        if (!parentDoc) return validationResponse(res, "Choose an existing parent institution");
        if (parentDoc.parentOrganizationId) {
          return validationResponse(res, "Nested institution links are not supported");
        }
        if (!allowedParentCategories.includes(parentDoc.category)) {
          return validationResponse(res, "Choose a compatible college, university, school, or institute");
        }
        parentId = parentDoc._id;
      }
      if (parentWasProvided || profile.patch.category !== undefined) org.parentOrganizationId = parentId;
    }

    if (body.name !== undefined && String(body.name).trim()) org.name = String(body.name).trim();
    if (body.description !== undefined) org.description = String(body.description).slice(0, 1000);
    if (body.logoUrl !== undefined) org.logoUrl = String(body.logoUrl);
    if (body.coverUrl !== undefined) org.coverUrl = String(body.coverUrl);
    if (body.website !== undefined) org.website = String(body.website);
    for (const [field, value] of Object.entries(profile.patch)) org[field] = value;

    await org.save();
    await OrganizationRepository.invalidate(org);
    const parentDoc = org.parentOrganizationId
      ? await Organization.findById(org.parentOrganizationId).select(ORGANIZATION_RELATION_FIELDS).lean()
      : null;
    const parent = parentDoc && parentCategoriesForOrganization(org.category).includes(parentDoc.category)
      ? publicOrganizationCard(parentDoc)
      : null;
    res.json({
      success: true,
      organization: {
        ...publicOrganizationShape(org.toObject()),
        parentOrganization: parent,
        supportsChildOrganizations: ORGANIZATION_PARENT_CATEGORIES.includes(org.category),
      },
    });
  } catch (error) {
    if (error.name === "ValidationError" || error.name === "CastError") {
      return validationResponse(res, error.message);
    }
    console.error("Update organization error:", error.message);
    res.status(500).json({ success: false, message: "Failed to update organization" });
  }
};

// GET /api/organizations/:id/parent-options?q=&category=&cursor=
// Only managers of the child organization may search valid institution parents.
exports.getOrganizationParentOptions = async (req, res) => {
  try {
    if (!/^[a-f0-9]{24}$/i.test(String(req.params.id || ""))) {
      return validationResponse(res, "A valid organization ID is required");
    }
    const child = await Organization.findById(req.params.id).select("_id category createdBy managers").lean();
    if (!child) return res.status(404).json({ success: false, message: "Organization not found" });
    if (!(await canManageOrg(req, child))) {
      return res.status(403).json({ success: false, message: "You can't manage this organization" });
    }

    const requestedCategory = req.query.category === undefined
      ? child.category
      : String(req.query.category || "").trim().toUpperCase();
    if (!ORGANIZATION_CATEGORIES.includes(requestedCategory)) {
      return validationResponse(res, "Choose a valid organization category");
    }
    const allowedCategories = parentCategoriesForOrganization(requestedCategory);
    if (!allowedCategories.length) {
      return res.json({ success: true, organizations: [], allowedCategories: [], nextCursor: null, hasMore: false });
    }

    const conditions = [
      { category: { $in: allowedCategories } },
      { parentOrganizationId: null },
      { _id: { $ne: child._id } },
    ];
    const query = String(req.query.q || "").trim().slice(0, 80);
    if (query) {
      const pattern = new RegExp(escapeRegex(query), "i");
      conditions.push({ $or: [{ name: pattern }, { handle: pattern }, { slug: pattern }, { city: pattern }] });
    }
    const limit = parseLimit(req.query.limit, { def: 12, max: 24 });
    const rows = await Organization.find(withCursor({ $and: conditions }, req.query.cursor))
      .select(ORGANIZATION_RELATION_FIELDS)
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit + 1)
      .lean();
    const page = buildPage(rows, limit);
    res.json({
      success: true,
      organizations: page.items.map(publicOrganizationCard),
      allowedCategories,
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
    });
  } catch (error) {
    console.error("Organization parent options error:", error.message);
    res.status(500).json({ success: false, message: "Failed to load parent organizations" });
  }
};

/* ── Read ────────────────────────────────────────────────── */

// GET /api/organizations/categories — canonical category options for filters/forms
exports.getOrganizationCategories = (_req, res) => {
  const categories = ORGANIZATION_CATEGORIES.map((value) => ({
    value,
    label: value.toLowerCase().split("_").map((part) => part[0].toUpperCase() + part.slice(1)).join(" "),
  }));
  res.json({ success: true, categories });
};

// GET /api/organizations?q=&category=&city=&verified=&following=&cursor=
exports.getOrganizations = async (req, res) => {
  try {
    const conditions = [];
    const rawQuery = String(req.query.q || "").trim().slice(0, 80);
    const category = String(req.query.category || "").trim().toUpperCase();
    const city = String(req.query.city || "").trim().slice(0, 120);
    const verifiedRaw = req.query.verified;
    const followingRaw = req.query.following;

    if (rawQuery) {
      const pattern = new RegExp(escapeRegex(rawQuery), "i");
      conditions.push({
        $or: [
          { name: pattern },
          { handle: pattern },
          { slug: pattern },
          { description: pattern },
        ],
      });
    }
    if (category) {
      if (!ORGANIZATION_CATEGORIES.includes(category)) {
        return validationResponse(res, "Choose a valid organization category");
      }
      conditions.push({ category });
    }
    if (city) conditions.push({ city: new RegExp(`^${escapeRegex(city)}$`, "i") });

    let verified = null;
    if (verifiedRaw !== undefined && verifiedRaw !== "") {
      const value = String(verifiedRaw).toLowerCase();
      if (!["true", "false", "1", "0"].includes(value)) {
        return validationResponse(res, "verified must be true or false");
      }
      verified = value === "true" || value === "1";
    }
    if (verified === true) {
      conditions.push({ $or: [{ isVerified: true }, { verificationStatus: "VERIFIED" }] });
    } else if (verified === false) {
      conditions.push({ isVerified: { $ne: true }, verificationStatus: { $ne: "VERIFIED" } });
    }

    let followingOnly = false;
    if (followingRaw !== undefined && followingRaw !== "") {
      const value = String(followingRaw).toLowerCase();
      if (!["true", "false", "1", "0"].includes(value)) {
        return validationResponse(res, "following must be true or false");
      }
      followingOnly = value === "true" || value === "1";
    }
    if (followingOnly && !req.user?.id) {
      return res.status(401).json({ success: false, message: "Sign in to filter followed organizations" });
    }

    const filter = conditions.length ? { $and: conditions } : {};
    if (followingOnly) {
      const followed = await OrgFollow.distinct("organization", { user: req.user.id });
      if (!followed.length) {
        return res.json({ success: true, organizations: [], nextCursor: null, hasMore: false });
      }
      filter._id = { $in: followed };
    }

    // Keep the historical default of 50 for clients that do not paginate;
    // the directory uses a smaller explicit page and follows nextCursor.
    const limit = parseLimit(req.query.limit, { def: 50, max: 50 });
    const rows = await Organization.find(withCursor(filter, req.query.cursor))
      .select(ORGANIZATION_DIRECTORY_FIELDS)
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit + 1)
      .lean();
    const page = buildPage(rows, limit);
    const ids = page.items.map((org) => org._id);

    let followerAgg = [];
    let eventAgg = [];
    let followingIds = [];
    if (ids.length) {
      [followerAgg, eventAgg, followingIds] = await Promise.all([
        OrgFollow.aggregate([
          { $match: { organization: { $in: ids } } },
          { $group: { _id: "$organization", count: { $sum: 1 } } },
        ]),
        Event.aggregate([
          { $match: { organization: { $in: ids }, visibility: "public", archivedAt: null, removedAt: null, endDate: { $gte: new Date() } } },
          { $group: { _id: "$organization", count: { $sum: 1 } } },
        ]),
        req.user?.id
          ? OrgFollow.distinct("organization", { user: req.user.id, organization: { $in: ids } })
          : Promise.resolve([]),
      ]);
    }

    const fMap = new Map(followerAgg.map((row) => [String(row._id), row.count]));
    const eMap = new Map(eventAgg.map((row) => [String(row._id), row.count]));
    const followingSet = new Set(followingIds.map(String));
    res.json({
      success: true,
      organizations: page.items.map((org) => ({
        ...publicOrganizationShape(org),
        followerCount: fMap.get(String(org._id)) || 0,
        upcomingEventCount: eMap.get(String(org._id)) || 0,
        following: followingSet.has(String(org._id)),
      })),
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
    });
  } catch (error) {
    console.error("List organizations error:", error.message);
    res.status(500).json({ success: false, message: "Failed to load organizations" });
  }
};

// GET /api/organizations/mine  (orgs the caller can attach events to)
exports.getMyOrganizations = async (req, res) => {
  try {
    // Preserve the existing all-organizations view for platform admins and the
    // permanent Super Admin. Other users only see organizations they can edit
    // or attach to existing event workflows: OWNER/ADMIN/MANAGER/EVENT_MANAGER,
    // plus legacy creator/manager records. Only APPROVED, non-suspended orgs
    // are eligible for event creation — pending/rejected/suspended/revoked are
    // excluded per organization-only creation requirement.
    const meDoc = await User.findById(req.user.id).select("email role").lean();
    const isSA = Boolean(meDoc && isSuperAdminEmail(meDoc.email));
    let filter = {};
    const baseEligibility = {
      status: "APPROVED",
      verificationStatus: { $nin: ["SUSPENDED", "REVOKED"] },
      $or: [
        { parentOrganizationId: null },
        { affiliationStatus: "APPROVED" },
        { affiliationStatus: "NONE" },
        { affiliationStatus: { $exists: false } },
      ],
    };
    if (req.user.role !== "admin" && !isSA) {
      const memberships = await OrganizationMembership.find({ userId: req.user.id })
        .select("organizationId role status")
        .lean();
      const eligibleRoles = new Set(["OWNER", "ADMIN", "MANAGER", "EVENT_MANAGER"]);
      const allowedMembershipOrgIds = memberships
        .filter((membership) => membership.status === "ACTIVE" && eligibleRoles.has(membership.role))
        .map((membership) => membership.organizationId);
      const explicitNonProfileOrgIds = memberships
        .filter((membership) => membership.status !== "ACTIVE" || !eligibleRoles.has(membership.role))
        .map((membership) => membership.organizationId);
      filter = {
        $and: [
          baseEligibility,
          { _id: { $nin: explicitNonProfileOrgIds } },
          {
            $or: [
              { createdBy: req.user.id },
              { managers: req.user.id },
              { _id: { $in: allowedMembershipOrgIds } },
            ],
          },
        ],
      };
    } else {
      filter = baseEligibility;
    }
    const orgs = await Organization.find(filter).select("name slug handle logoUrl isVerified").sort({ name: 1 }).lean();
    // Normalize handle for frontend
    const normalized = orgs.map((o) => ({ ...o, handle: o.handle || o.slug }));
    res.json({ success: true, organizations: normalized });
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
    const profileQuery = organizationByPublicHandle(req.params.slug);
    const found = profileQuery ? await profileQuery.lean() : null;
    if (!found) return res.status(404).json({ success: false, message: "Organization not found" });
    const org = publicOrganizationShape(found);

    const orgId = org._id;
    const now = new Date();
    const [followers, upcomingCount, pastCount, viewerFollow, recentFollowers, managerDocs, parentDoc] = await Promise.all([
      OrgFollow.countDocuments({ organization: orgId }),
      Event.countDocuments({ organization: orgId, visibility: "public", archivedAt: null, removedAt: null, endDate: { $gte: now } }),
      Event.countDocuments({ organization: orgId, visibility: "public", archivedAt: null, removedAt: null, endDate: { $lt: now } }),
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
      org.parentOrganizationId
        ? Organization.findById(org.parentOrganizationId).select(ORGANIZATION_RELATION_FIELDS).lean()
        : Promise.resolve(null),
    ]);

    const parentOrganization = parentDoc && parentCategoriesForOrganization(org.category).includes(parentDoc.category)
      ? publicOrganizationCard(parentDoc)
      : null;
    const [canManage, membershipAdminRole, eventsCapability, storedMembership, effectiveMembership] = req.user
      ? await Promise.all([
          canManageOrg(req, found),
          getOrganizationMembershipAdminRole(req.user, found),
          canManageOrganizationEvents(req.user, found),
          OrganizationMembership.findOne({ organizationId: orgId, userId: req.user.id })
            .select("role status")
            .lean(),
          getEffectiveOrganizationMembership(req.user, found),
        ])
      : [false, null, false, null, null];
    const myMembership = req.user && String(found.createdBy) === String(req.user.id)
      ? effectiveMembership
      : storedMembership || effectiveMembership;

    res.json({
      success: true,
      organization: {
        ...org,
        supportsChildOrganizations: ORGANIZATION_PARENT_CATEGORIES.includes(org.category),
        followerCount: followers,
        upcomingEventCount: upcomingCount,
        pastEventCount: pastCount,
        following: Boolean(viewerFollow),
        followersPreview: recentFollowers.map((f) => f.user).filter(Boolean),
        managers: managerDocs,
        parentOrganization,
        canManage,
        canManageMembers: Boolean(membershipAdminRole),
        canManageEvents: Boolean(eventsCapability),
        myMembership: myMembership ? { role: myMembership.role, status: myMembership.status } : null,
      },
    });
  } catch (error) {
    console.error("Get organization error:", error.message);
    res.status(500).json({ success: false, message: "Failed to load organization" });
  }
};

// GET /api/organizations/:slug/events — legacy dual-list or a cursor page by scope
exports.getOrganizationEvents = async (req, res) => {
  try {
    const orgQuery = organizationByPublicHandle(req.params.slug, "_id");
    const org = orgQuery ? await orgQuery : null;
    if (!org) return res.status(404).json({ success: false, message: "Organization not found" });

    const now = new Date();
    const fields = "title slug description category venue eventType startDate endDate bannerUrl logoUrl organizer price isFeatured visibility maxAttendees";
    const readPage = async (scope, limit, cursor) => {
      const isPast = scope === "past";
      const sortField = isPast ? "endDate" : "startDate";
      const direction = isPast ? "desc" : "asc";
      const baseFilter = {
        organization: org._id,
        visibility: "public",
        archivedAt: null,
        removedAt: null,
        endDate: isPast ? { $lt: now } : { $gte: now },
      };
      const cursorFilter = cursorAfterDate(cursor, sortField, direction);
      const filter = cursorFilter ? { $and: [baseFilter, cursorFilter] } : baseFilter;
      const sort = isPast ? { endDate: -1, _id: -1 } : { startDate: 1, _id: 1 };
      const rows = await Event.find(filter).select(fields).sort(sort).limit(limit + 1).lean();
      return pageByDate(rows, limit, sortField);
    };

    const scope = String(req.query.scope || "").toLowerCase();
    if (scope) {
      if (scope !== "upcoming" && scope !== "past") {
        return validationResponse(res, "scope must be upcoming or past");
      }
      const limit = parseLimit(req.query.limit, { def: 12, max: 24 });
      const page = await readPage(scope, limit, req.query.cursor);
      return res.json({
        success: true,
        [scope]: page.items,
        events: page.items,
        nextCursor: page.nextCursor,
        hasMore: page.hasMore,
      });
    }

    // Keep the established `{ upcoming, past }` shape for older clients while
    // placing a hard bound on each list and exposing cursors for larger orgs.
    const [upcoming, past] = await Promise.all([
      readPage("upcoming", 100, null),
      readPage("past", 12, null),
    ]);
    res.json({
      success: true,
      upcoming: upcoming.items,
      past: past.items,
      upcomingNextCursor: upcoming.nextCursor,
      upcomingHasMore: upcoming.hasMore,
      pastNextCursor: past.nextCursor,
      pastHasMore: past.hasMore,
    });
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
    await notify({ user: org.createdBy, actor: req.user.id, type: "org_follow", organization: org._id });
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


/* ── Organization membership administration (backend-enforced RBAC) ── */

async function membershipAdminContext(req, res) {
  if (!validObjectId(req.params.id)) {
    validationResponse(res, "A valid organization ID is required");
    return null;
  }
  const organization = await Organization.findById(req.params.id);
  if (!organization) {
    res.status(404).json({ success: false, message: "Organization not found" });
    return null;
  }
  const actorRole = await getOrganizationMembershipAdminRole(req.user, organization);
  if (!actorRole) {
    res.status(403).json({ success: false, message: "Only organization owners and admins can manage membership" });
    return null;
  }
  return { organization, actorRole };
}

function auditOrganizationMembership(organization, actor, action, details) {
  AuditLog.create({ organization, actor, action, details }).catch((error) => {
    console.error("Organization membership audit log failed:", error.message);
  });
}

// GET /api/organizations/:id/members — private roster for active OWNER/ADMIN
exports.getOrganizationMembers = async (req, res) => {
  try {
    const context = await membershipAdminContext(req, res);
    if (!context) return;
    const limit = parseLimit(req.query.limit, { def: 25, max: 50 });
    const rows = await OrganizationMembership.find(withCursor(
      { organizationId: context.organization._id },
      req.query.cursor
    ))
      .select("userId role status joinedAt invitedAt createdAt")
      .populate("userId", "firstName lastName username profile.avatar")
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit + 1)
      .lean();
    const page = buildPage(rows, limit);
    const members = page.items.map(publicMembership);
    // Until the reviewed backfill is applied, show creator/managers as virtual
    // role rows so owners see the same team without writing data on a read.
    if (!req.query.cursor) {
      const legacyIds = [context.organization.createdBy, ...(context.organization.managers || [])]
        .filter(Boolean);
      const storedLegacy = await OrganizationMembership.find({
        organizationId: context.organization._id,
        userId: { $in: legacyIds },
      }).select("userId").lean();
      const storedLegacyIds = new Set(storedLegacy.map((membership) => String(membership.userId)));
      const missingLegacyIds = [...new Map(legacyIds
        .filter((id) => !storedLegacyIds.has(String(id)))
        .map((id) => [String(id), id])).values()];
      const legacyUsers = missingLegacyIds.length
        ? await User.find({ _id: { $in: missingLegacyIds } })
            .select("firstName lastName username profile.avatar")
            .lean()
        : [];
      for (const user of legacyUsers) {
        const isCreator = String(user._id) === String(context.organization.createdBy);
        members.push(publicMembership({
          _id: `legacy:${user._id}`,
          userId: user,
          role: isCreator ? "OWNER" : "MANAGER",
          status: "ACTIVE",
          joinedAt: context.organization.createdAt || null,
          createdAt: context.organization.createdAt || null,
        }));
      }
    }
    res.json({
      success: true,
      members,
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
      membershipRole: context.actorRole,
    });
  } catch (error) {
    console.error("Organization member list error:", error.message);
    res.status(500).json({ success: false, message: "Failed to load organization members" });
  }
};

// POST /api/organizations/:id/members { username, role } — invite a user
exports.inviteOrganizationMember = async (req, res) => {
  try {
    const context = await membershipAdminContext(req, res);
    if (!context) return;
    const username = String(req.body?.username || "").trim().toLowerCase();
    const role = String(req.body?.role || "MEMBER").trim().toUpperCase();
    if (!/^[a-z0-9_]{3,30}$/.test(username)) {
      return validationResponse(res, "Enter a valid username");
    }
    if (!ASSIGNABLE_ORGANIZATION_ROLES.has(role)) {
      return validationResponse(res, "Choose an assignable organization role");
    }
    if (role === "ADMIN" && context.actorRole !== "OWNER") {
      return res.status(403).json({ success: false, message: "Only the organization owner can invite an admin" });
    }

    const invitee = await User.findOne({ username })
      .select("_id username firstName lastName profile.avatar suspendedAt");
    if (!invitee) return res.status(404).json({ success: false, message: "User not found" });
    if (invitee.suspendedAt) return res.status(400).json({ success: false, message: "A suspended user cannot be invited" });
    if (String(invitee._id) === String(req.user.id)) {
      return res.status(400).json({ success: false, message: "You can't invite yourself" });
    }
    if (String(context.organization.createdBy) === String(invitee._id)) {
      return res.status(409).json({ success: false, message: "The organization creator is already its owner" });
    }
    if ((context.organization.managers || []).some((id) => String(id) === String(invitee._id))) {
      return res.status(409).json({ success: false, message: "Manager assignments are controlled by the Super Admin" });
    }

    let membership = await OrganizationMembership.findOne({
      organizationId: context.organization._id,
      userId: invitee._id,
    });
    if (membership) {
      if (membership.role === "OWNER" || membership.role === "MANAGER") {
        return res.status(403).json({ success: false, message: "This role can only be changed through its designated governance controls" });
      }
      if (membership.role === "ADMIN" && context.actorRole !== "OWNER") {
        return res.status(403).json({ success: false, message: "Only the organization owner can manage an admin" });
      }
      if (membership.status === "ACTIVE") {
        return res.status(409).json({ success: false, message: "This user is already an active member" });
      }
      if (membership.status === "INVITED") {
        return res.status(409).json({ success: false, message: "An invitation is already pending" });
      }
      if (membership.status === "SUSPENDED") {
        return res.status(403).json({ success: false, message: "A suspended membership cannot be re-invited" });
      }
      membership.role = role;
      membership.status = "INVITED";
      membership.joinedAt = null;
      membership.invitedBy = req.user.id;
      membership.invitedAt = new Date();
      await membership.save();
    } else {
      membership = await OrganizationMembership.create({
        organizationId: context.organization._id,
        userId: invitee._id,
        role,
        status: "INVITED",
        joinedAt: null,
        invitedBy: req.user.id,
        invitedAt: new Date(),
      });
    }

    await notify({ user: invitee._id, actor: req.user.id, type: "organization_invite", organization: context.organization._id });
    auditOrganizationMembership(
      context.organization._id,
      req.user.id,
      "organization_member_invited",
      `${username} invited as ${role}`
    );
    res.status(201).json({ success: true, membership: publicMembership({ ...membership.toObject(), userId: invitee }) });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ success: false, message: "A membership already exists for this user" });
    }
    console.error("Organization member invite error:", error.message);
    res.status(500).json({ success: false, message: "Failed to invite organization member" });
  }
};

// POST /api/organizations/:id/members/invitations/:action — accept or decline
exports.resolveOrganizationInvitation = async (req, res) => {
  try {
    if (!validObjectId(req.params.id)) return validationResponse(res, "A valid organization ID is required");
    const action = String(req.params.action || "").toLowerCase();
    if (!["accept", "decline"].includes(action)) {
      return validationResponse(res, "Action must be accept or decline");
    }
    const organization = await Organization.findById(req.params.id).select("_id");
    if (!organization) return res.status(404).json({ success: false, message: "Organization not found" });
    const membership = await OrganizationMembership.findOne({
      organizationId: organization._id,
      userId: req.user.id,
      status: "INVITED",
    });
    if (!membership) return res.status(404).json({ success: false, message: "No pending organization invitation" });

    if (action === "accept") {
      membership.status = "ACTIVE";
      membership.joinedAt = new Date();
    } else {
      membership.status = "REVOKED";
      membership.joinedAt = null;
    }
    await membership.save();
    auditOrganizationMembership(
      organization._id,
      req.user.id,
      action === "accept" ? "organization_invitation_accepted" : "organization_invitation_declined",
      `role=${membership.role}`
    );
    res.json({ success: true, status: membership.status });
  } catch (error) {
    console.error("Organization invitation resolution error:", error.message);
    res.status(500).json({ success: false, message: "Failed to resolve organization invitation" });
  }
};

// PATCH /api/organizations/:id/members/:userId { role } — adjust a member role
exports.updateOrganizationMemberRole = async (req, res) => {
  try {
    const context = await membershipAdminContext(req, res);
    if (!context) return;
    if (!validObjectId(req.params.userId)) return validationResponse(res, "A valid user ID is required");
    const role = String(req.body?.role || "").trim().toUpperCase();
    if (!ASSIGNABLE_ORGANIZATION_ROLES.has(role)) {
      return validationResponse(res, "Choose an assignable organization role");
    }
    if (String(req.params.userId) === String(req.user.id)) {
      return res.status(400).json({ success: false, message: "You can't change your own organization role" });
    }
    if (role === "ADMIN" && context.actorRole !== "OWNER") {
      return res.status(403).json({ success: false, message: "Only the organization owner can assign admins" });
    }

    const membership = await OrganizationMembership.findOne({
      organizationId: context.organization._id,
      userId: req.params.userId,
    });
    if (!membership) return res.status(404).json({ success: false, message: "Organization membership not found" });
    if (membership.role === "OWNER" || membership.role === "MANAGER") {
      return res.status(403).json({ success: false, message: "Owner and Super Admin-assigned manager roles can't be changed here" });
    }
    if (membership.role === "ADMIN" && context.actorRole !== "OWNER") {
      return res.status(403).json({ success: false, message: "Only the organization owner can manage an admin" });
    }
    if (!["ACTIVE", "INVITED"].includes(membership.status)) {
      return res.status(409).json({ success: false, message: "Only active members or pending invitations can change role" });
    }

    const oldRole = membership.role;
    membership.role = role;
    await membership.save();
    auditOrganizationMembership(
      context.organization._id,
      req.user.id,
      "organization_member_role_changed",
      `${req.params.userId}: ${oldRole} → ${role}`
    );
    res.json({ success: true, membership: publicMembership(membership) });
  } catch (error) {
    console.error("Organization member role update error:", error.message);
    res.status(500).json({ success: false, message: "Failed to update organization member role" });
  }
};

// DELETE /api/organizations/:id/members/:userId — revoke a non-owner member
exports.revokeOrganizationMember = async (req, res) => {
  try {
    const context = await membershipAdminContext(req, res);
    if (!context) return;
    if (!validObjectId(req.params.userId)) return validationResponse(res, "A valid user ID is required");
    if (String(req.params.userId) === String(req.user.id)) {
      return res.status(400).json({ success: false, message: "You can't remove yourself through member administration" });
    }
    if (String(context.organization.createdBy) === String(req.params.userId)) {
      return res.status(403).json({ success: false, message: "The organization owner can't be removed" });
    }

    const membership = await OrganizationMembership.findOne({
      organizationId: context.organization._id,
      userId: req.params.userId,
    });
    if (!membership) return res.status(404).json({ success: false, message: "Organization membership not found" });
    if (membership.role === "OWNER" || membership.role === "MANAGER") {
      return res.status(403).json({ success: false, message: "Owner and Super Admin-assigned manager roles can't be removed here" });
    }
    if (membership.role === "ADMIN" && context.actorRole !== "OWNER") {
      return res.status(403).json({ success: false, message: "Only the organization owner can remove an admin" });
    }
    if (membership.status !== "REVOKED") {
      membership.status = "REVOKED";
      await membership.save();
      auditOrganizationMembership(
        context.organization._id,
        req.user.id,
        "organization_member_revoked",
        `${req.params.userId} (${membership.role})`
      );
    }
    res.json({ success: true, status: "REVOKED" });
  } catch (error) {
    console.error("Organization member revoke error:", error.message);
    res.status(500).json({ success: false, message: "Failed to remove organization member" });
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
    if (!validObjectId(userId)) return validationResponse(res, "A valid user ID is required");
    const user = await User.findById(userId).select("email firstName lastName");
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    if (String(org.createdBy) === String(userId)) {
      return res.status(400).json({ success: false, message: "The organization creator is its owner, not an assigned manager" });
    }
    if ((org.managers || []).some((m) => String(m) === String(userId))) {
      return res.status(400).json({ success: false, message: "Already a manager" });
    }
    const existingMembership = await OrganizationMembership.findOne({ organizationId: org._id, userId });
    if (existingMembership?.role === "OWNER") {
      return res.status(409).json({ success: false, message: "An organization owner cannot be demoted to manager" });
    }
    org.managers = [...(org.managers || []), userId];
    await org.save();
    await OrganizationMembership.updateOne(
      { organizationId: org._id, userId },
      {
        $set: { role: "MANAGER", status: "ACTIVE" },
        $setOnInsert: { joinedAt: new Date() },
      },
      { upsert: true, runValidators: true }
    );
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
    const membership = await OrganizationMembership.findOne({ organizationId: org._id, userId });
    if (membership && ["OWNER", "ADMIN"].includes(membership.role)) {
      return res.status(403).json({ success: false, message: "This account is not a Super Admin-assigned manager" });
    }
    org.managers = org.managers.filter((m) => String(m) !== String(userId));
    await org.save();
    if (membership?.role === "MANAGER" && membership.status !== "REVOKED") {
      membership.status = "REVOKED";
      await membership.save();
    }
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

// GET /api/organizations/:slug/posts — cursor pages, with legacy page support
exports.getOrganizationPosts = async (req, res) => {
  try {
    const orgQuery = organizationByPublicHandle(req.params.slug, "_id");
    const org = orgQuery ? await orgQuery : null;
    if (!org) return res.status(404).json({ success: false, message: "Organization not found" });

    const Post = require("../models/post.model");
    const filter = { organization: org._id, status: "published", visibility: "public" };
    const limit = parseLimit(req.query.limit, { def: 20, max: 50 });
    let rows;
    let hasMore = false;
    let nextCursor = null;
    let pageNumber = 1;

    // Existing page-based callers keep working; new clients use keyset cursors.
    if (req.query.page !== undefined && req.query.cursor === undefined) {
      pageNumber = Math.max(1, parseInt(req.query.page, 10) || 1);
      const [legacyRows, total] = await Promise.all([
        Post.find(filter)
          .sort({ createdAt: -1, _id: -1 })
          .skip((pageNumber - 1) * limit)
          .limit(limit)
          .populate("author", "firstName lastName username verified email profile.avatar profile.institution")
          .populate("event", "title slug bannerUrl logoUrl startDate endDate venue eventType category organizer price visibility isLive")
          .populate("organization", "name handle slug logo logoUrl")
          .populate("community", "name slug avatarUrl")
          .lean(),
        Post.countDocuments(filter),
      ]);
      rows = legacyRows;
      hasMore = pageNumber * limit < total;
    } else {
      const page = await (async () => {
        const found = await Post.find(withCursor(filter, req.query.cursor))
          .sort({ createdAt: -1, _id: -1 })
          .limit(limit + 1)
          .populate("author", "firstName lastName username verified email profile.avatar profile.institution")
          .populate("event", "title slug bannerUrl logoUrl startDate endDate venue eventType category organizer price visibility isLive")
          .populate("organization", "name handle slug logo logoUrl")
          .populate("community", "name slug avatarUrl")
          .lean();
        return buildPage(found, limit);
      })();
      rows = page.items;
      hasMore = page.hasMore;
      nextCursor = page.nextCursor;
    }

    const postController = require("./post.controller");
    const enriched = (await postController._enrichPosts(rows, req.user?.id || null)).map(
      postController._sanitizeEvent
    );
    res.json({ success: true, posts: enriched, page: pageNumber, hasMore, nextCursor });
  } catch (error) {
    console.error("Get organization posts error:", error.message);
    res.status(500).json({ success: false, message: "Failed to load organization posts" });
  }
};

// GET /api/organizations/:slug/children — cursor-paginated affiliated clubs/communities
exports.getOrganizationChildren = async (req, res) => {
  try {
    const parentQuery = organizationByPublicHandle(req.params.slug, "_id category");
    const parent = parentQuery ? await parentQuery.lean() : null;
    if (!parent) return res.status(404).json({ success: false, message: "Organization not found" });
    const eligibleChildCategories = childCategoriesForOrganization(parent.category);
    if (!ORGANIZATION_PARENT_CATEGORIES.includes(parent.category) || !eligibleChildCategories.length) {
      return res.json({ success: true, children: [], nextCursor: null, hasMore: false });
    }

    const limit = parseLimit(req.query.limit, { def: 12, max: 24 });
    const rows = await Organization.find(withCursor({
      parentOrganizationId: parent._id,
      category: { $in: eligibleChildCategories },
    }, req.query.cursor))
      .select(ORGANIZATION_RELATION_FIELDS)
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit + 1)
      .lean();
    const page = buildPage(rows, limit);
    res.json({
      success: true,
      children: page.items.map(publicOrganizationCard),
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
    });
  } catch (error) {
    console.error("Organization child list error:", error.message);
    res.status(500).json({ success: false, message: "Failed to load affiliated organizations" });
  }
};

// GET /api/organizations/:slug/communities — cursor-paginated public groups
exports.getOrganizationCommunities = async (req, res) => {
  try {
    const orgQuery = organizationByPublicHandle(req.params.slug, "_id");
    const org = orgQuery ? await orgQuery : null;
    if (!org) return res.status(404).json({ success: false, message: "Organization not found" });

    const Community = require("../models/community.model");
    const CommunityMember = require("../models/communityMember.model");
    const filter = {
      $and: [
        { $or: [{ organization: org._id }, { officialOrganization: org._id }] },
        { deletedAt: null, status: { $ne: "suspended" } },
      ],
    };
    const limit = parseLimit(req.query.limit, { def: 24, max: 24 });
    const communities = await Community.find(withCursor(filter, req.query.cursor))
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit + 1)
      .lean();
    const page = buildPage(communities, limit);

    const agg = page.items.length
      ? await CommunityMember.aggregate([
          { $match: { community: { $in: page.items.map((community) => community._id) }, status: "active" } },
          { $group: { _id: "$community", count: { $sum: 1 } } },
        ])
      : [];
    const counts = new Map(agg.map((row) => [String(row._id), row.count]));

    res.json({
      success: true,
      communities: page.items.map((community) => ({
        ...community,
        memberCount: counts.get(String(community._id)) || 0,
      })),
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
    });
  } catch (error) {
    console.error("Get organization communities error:", error.message);
    res.status(500).json({ success: false, message: "Failed to load communities" });
  }
};

// ── Master Refactor: Affiliation Lifecycle ─────────────────────────
exports.requestAffiliation = async (req, res) => {
  try {
    const { id } = req.params;
    const { parentOrganizationId, reason } = req.body || {};
    const service = require("../services/affiliation.service");
    const org = await service.requestAffiliation({ clubId: id, parentId: parentOrganizationId, requester: req.user, reason });
    res.json({ success: true, organization: org });
  } catch (e) {
    const st = e.status || 500;
    if (st < 500) return res.status(st).json({ success: false, message: e.message });
    console.error("requestAffiliation error", e);
    res.status(500).json({ success: false, message: "Failed to request affiliation" });
  }
};

exports.approveAffiliation = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body || {};
    const service = require("../services/affiliation.service");
    const org = await service.approveAffiliation({ clubId: id, approver: req.user, reason });
    res.json({ success: true, organization: org });
  } catch (e) {
    const st = e.status || 500;
    if (st < 500) return res.status(st).json({ success: false, message: e.message });
    console.error("approveAffiliation error", e);
    res.status(500).json({ success: false, message: "Failed to approve affiliation" });
  }
};

exports.rejectAffiliation = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body || {};
    const service = require("../services/affiliation.service");
    const org = await service.rejectAffiliation({ clubId: id, approver: req.user, reason });
    res.json({ success: true, organization: org });
  } catch (e) {
    const st = e.status || 500;
    if (st < 500) return res.status(st).json({ success: false, message: e.message });
    console.error("rejectAffiliation error", e);
    res.status(500).json({ success: false, message: "Failed to reject affiliation" });
  }
};

exports.suspendAffiliation = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body || {};
    const service = require("../services/affiliation.service");
    const org = await service.suspendAffiliation({ clubId: id, actor: req.user, reason });
    res.json({ success: true, organization: org });
  } catch (e) {
    const st = e.status || 500;
    if (st < 500) return res.status(st).json({ success: false, message: e.message });
    console.error("suspendAffiliation error", e);
    res.status(500).json({ success: false, message: "Failed to suspend affiliation" });
  }
};

exports.revokeAffiliation = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body || {};
    const service = require("../services/affiliation.service");
    const org = await service.revokeAffiliation({ clubId: id, actor: req.user, reason });
    res.json({ success: true, organization: org });
  } catch (e) {
    const st = e.status || 500;
    if (st < 500) return res.status(st).json({ success: false, message: e.message });
    console.error("revokeAffiliation error", e);
    res.status(500).json({ success: false, message: "Failed to revoke affiliation" });
  }
};

exports.transferAffiliation = async (req, res) => {
  try {
    const { id } = req.params;
    const { newParentOrganizationId, reason } = req.body || {};
    const service = require("../services/affiliation.service");
    const org = await service.transferAffiliation({ clubId: id, newParentId: newParentOrganizationId, actor: req.user, reason });
    res.json({ success: true, organization: org });
  } catch (e) {
    const st = e.status || 500;
    if (st < 500) return res.status(st).json({ success: false, message: e.message });
    console.error("transferAffiliation error", e);
    res.status(500).json({ success: false, message: "Failed to transfer affiliation" });
  }
};

exports.getAffiliationHistory = async (req, res) => {
  try {
    const org = await Organization.findById(req.params.id).select("affiliationHistory affiliationStatus parentOrganizationId createdBy managers").lean();
    if (!org) return res.status(404).json({ success: false, message: "Organization not found" });
    // Only club admins, institution admins, super admin can view
    const service = require("../services/affiliation.service");
    const canClub = await service.canManageClub(req.user, org);
    let canInst = false;
    if (org.parentOrganizationId) {
      const parent = await Organization.findById(org.parentOrganizationId).select("_id createdBy managers").lean();
      if (parent) canInst = await service.canManageInstitution(req.user, parent);
    }
    const isSuper = req.user.role === "admin" || (await (async () => { try { const User = require("../models/user.model"); const u = await User.findById(req.user.id).select("email").lean(); return u && require("../services/ownership.service").isSuperAdminEmail(u.email); } catch { return false; } })());
    if (!canClub && !canInst && !isSuper) return res.status(403).json({ success: false, message: "You can't view affiliation history" });
    res.json({ success: true, history: org.affiliationHistory || [], affiliationStatus: org.affiliationStatus });
  } catch (e) {
    console.error("getAffiliationHistory error", e);
    res.status(500).json({ success: false, message: "Failed to load affiliation history" });
  }
};

