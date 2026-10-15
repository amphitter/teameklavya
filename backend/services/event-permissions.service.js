"use strict";

const mongoose = require("mongoose");
const Event = require("../models/event.model");
const Organization = require("../models/organization.model");
const User = require("../models/user.model");
const RegistrationResponse = require("../models/registrationResponse.model");
const { isSuperAdminEmail } = require("./ownership.service");
const { getEffectiveOrganizationMembership } = require("./organization-permissions.service");

const ORGANIZATION_EVENT_ROLES = new Set(["OWNER", "ADMIN", "EVENT_MANAGER"]);
const OWNER_TYPES = new Set(["USER", "ORGANIZATION", "PLATFORM"]);

function requestUserId(user) {
  return user?.id || user?._id || null;
}

function sameId(left, right) {
  return left != null && right != null && String(left) === String(right);
}

/** Resolve a fresh, complete owner projection when a caller passed a partial event. */
async function resolveEvent(eventOrId) {
  if (!eventOrId) return null;
  if (typeof eventOrId === "string" || eventOrId instanceof mongoose.Types.ObjectId) {
    if (!mongoose.Types.ObjectId.isValid(String(eventOrId))) return null;
    return Event.findById(eventOrId).select("_id organizerType organizerId createdBy parentInstitutionId proposingOrganizationId approvalStatus").lean();
  }

  const event = eventOrId;
  const id = event._id || event.id;
  if (!id || !mongoose.Types.ObjectId.isValid(String(id))) return event;

  const isMongooseDocument = Boolean(event.$__ && typeof event.isSelected === "function");
  const missingOwnerProjection = isMongooseDocument
    ? !event.isSelected("organizerType") || !event.isSelected("organizerId") || !event.isSelected("createdBy")
    : !Object.prototype.hasOwnProperty.call(event, "organizerType") ||
      !Object.prototype.hasOwnProperty.call(event, "organizerId") ||
      !Object.prototype.hasOwnProperty.call(event, "createdBy");

  if (missingOwnerProjection) {
    return (await Event.findById(id).select("_id organizerType organizerId createdBy parentInstitutionId proposingOrganizationId approvalStatus").lean()) || event;
  }
  return event;
}

async function isPlatformEventAdmin(user) {
  const userId = requestUserId(user);
  if (!userId || !mongoose.Types.ObjectId.isValid(String(userId))) return false;
  const account = await User.findById(userId).select("role email").lean();
  return Boolean(account && (account.role === "admin" || isSuperAdminEmail(account.email)));
}

/**
 * Event ownership authorization.
 *
 * New records use explicit USER / ORGANIZATION / PLATFORM ownership. During
 * the staged backfill, a record with no owner type remains compatible with
 * the confirmed legacy mapping: createdBy → USER; missing createdBy →
 * PLATFORM. Event.organization and Event.community are never consulted as an
 * authorization fallback.
 */
async function canManageEvent(user, eventOrId) {
  const userId = requestUserId(user);
  if (!userId || !mongoose.Types.ObjectId.isValid(String(userId))) return false;
  if (await isPlatformEventAdmin(user)) return true;

  const event = await resolveEvent(eventOrId);
  if (!event) return false;

  // Master refactor: if event is a club proposal, allow parent institution admins to manage/view for approval
  // Need full event with parentInstitutionId and proposingOrganizationId
  let fullEvent = event;
  if (!event.parentInstitutionId && event._id) {
    // Try to load parentInstitutionId if not present
    const extra = await Event.findById(event._id).select("parentInstitutionId proposingOrganizationId approvalStatus").lean();
    if (extra) fullEvent = { ...event, ...extra };
  }

  if (fullEvent.parentInstitutionId) {
    const parentId = fullEvent.parentInstitutionId;
    if (mongoose.Types.ObjectId.isValid(String(parentId))) {
      const parentOrg = await Organization.findById(parentId).select("_id createdBy managers").lean();
      if (parentOrg) {
        const membership = await getEffectiveOrganizationMembership(user, parentOrg);
        if (membership && ORGANIZATION_EVENT_ROLES.has(membership.role)) return true;
        // Legacy managers fallback already handled in getEffectiveOrganizationMembership via createdBy check, but also check direct managers for parent
        if (parentOrg.createdBy && sameId(parentOrg.createdBy, userId)) return true;
      }
    }
  }

  let ownerType = event.organizerType;
  let ownerId = event.organizerId;

  // Staged compatibility: legacy events still work before the backfill runs.
  if (ownerType == null) {
    ownerType = event.createdBy ? "USER" : "PLATFORM";
    ownerId = event.createdBy || null;
  }
  if (!OWNER_TYPES.has(ownerType)) return false;

  if (ownerType === "USER") {
    // Only the explicit user owner controls a migrated event. createdBy is a
    // compatibility fallback only when the owner id has not yet been filled.
    return sameId(ownerId || event.createdBy, userId);
  }
  if (ownerType === "PLATFORM") return false;

  if (!ownerId || !mongoose.Types.ObjectId.isValid(String(ownerId))) return false;
  const organization = await Organization.findById(ownerId)
    .select("_id createdBy managers")
    .lean();
  if (!organization) return false;

  const membership = await getEffectiveOrganizationMembership(user, organization);
  return Boolean(membership && ORGANIZATION_EVENT_ROLES.has(membership.role));
}

/** True only for a platform admin or an active OWNER/ADMIN/EVENT_MANAGER with eligible org state. */
async function canCreateOrganizationEvent(user, organizationOrId) {
  if (!user || !organizationOrId) return false;
  if (await isPlatformEventAdmin(user)) return true;

  const organization =
    typeof organizationOrId === "string" || organizationOrId instanceof mongoose.Types.ObjectId
      ? await Organization.findById(organizationOrId)
          .select("_id createdBy managers status verificationStatus affiliationStatus parentOrganizationId")
          .lean()
      : organizationOrId;
  if (!organization) return false;

  // Only APPROVED orgs can create events
  if (organization.status && organization.status !== "APPROVED") return false;
  if (organization.verificationStatus && ["SUSPENDED", "REVOKED"].includes(organization.verificationStatus)) return false;

  if (organization.parentOrganizationId) {
    if (organization.affiliationStatus && organization.affiliationStatus !== "APPROVED") return false;
    try {
      const parent = await Organization.findById(organization.parentOrganizationId)
        .select("status verificationStatus")
        .lean();
      if (!parent) return false;
      if (parent.status !== "APPROVED") return false;
      if (parent.verificationStatus && ["SUSPENDED", "REVOKED"].includes(parent.verificationStatus)) return false;
    } catch {
      return false;
    }
  }

  const userId = requestUserId(user);
  if (!userId || !mongoose.Types.ObjectId.isValid(String(userId))) return false;
  try {
    const account = await User.findById(userId)
      .select("bannedAt suspendedAt suspensionExpiresAt restrictions role")
      .lean();
    if (!account) return false;
    if (account.bannedAt) return false;
    if (account.suspendedAt) {
      const exp = account.suspensionExpiresAt ? new Date(account.suspensionExpiresAt).getTime() : null;
      if (!exp || exp > Date.now()) return false;
    }
    const evRest = account.restrictions?.eventCreation;
    if (evRest?.until && new Date(evRest.until).getTime() > Date.now()) return false;
  } catch {
    return false;
  }

  const membership = await getEffectiveOrganizationMembership(user, organization);
  return Boolean(membership && ORGANIZATION_EVENT_ROLES.has(membership.role));
}

async function hasEligibleOrganizationForDiscoveryPrivacy(user) {
  if (!user) return false;
  if (await isPlatformEventAdmin(user)) return true;
  const userId = requestUserId(user);
  if (!userId || !mongoose.Types.ObjectId.isValid(String(userId))) return false;
  try {
    const OrganizationMembership = require("../models/organizationMembership.model");
    const memberships = await OrganizationMembership.find({ userId, status: "ACTIVE" })
      .select("organizationId role")
      .lean();
    const ownedOrgs = await Organization.find({
      $or: [{ createdBy: userId }, { managers: userId }],
      status: "APPROVED",
    })
      .select("_id status verificationStatus affiliationStatus parentOrganizationId createdBy managers")
      .lean();

    const orgMap = new Map();
    for (const o of ownedOrgs) orgMap.set(String(o._id), o);

    const missingIds = memberships
      .map((m) => String(m.organizationId))
      .filter((id) => !orgMap.has(id));
    if (missingIds.length) {
      const extraOrgs = await Organization.find({ _id: { $in: missingIds } })
        .select("_id status verificationStatus affiliationStatus parentOrganizationId createdBy managers")
        .lean();
      for (const o of extraOrgs) orgMap.set(String(o._id), o);
    }

    for (const mem of memberships) {
      if (!ORGANIZATION_EVENT_ROLES.has(mem.role)) continue;
      const org = orgMap.get(String(mem.organizationId));
      if (!org) continue;
      if (org.status !== "APPROVED") continue;
      if (org.verificationStatus && ["SUSPENDED", "REVOKED"].includes(org.verificationStatus)) continue;
      if (org.parentOrganizationId && org.affiliationStatus && org.affiliationStatus !== "APPROVED") continue;
      return true;
    }
    for (const org of ownedOrgs) {
      if (org.status !== "APPROVED") continue;
      if (org.verificationStatus && ["SUSPENDED", "REVOKED"].includes(org.verificationStatus)) continue;
      if (org.parentOrganizationId && org.affiliationStatus && org.affiliationStatus !== "APPROVED") continue;
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Private Event data is available to its manager or a registered participant.
 * Callers keep their own endpoint-specific lifecycle checks (for example,
 * removed Events still return 404). Public and unlisted direct-link behavior
 * is unchanged. `event` must include `_id`, `visibility`, and the owner fields.
 */
async function canAccessPrivateEvent(user, event) {
  const hasVisibility = Boolean(
    event && (
      Object.prototype.hasOwnProperty.call(event, "visibility") ||
      (event.$__ && typeof event.isSelected === "function" && event.isSelected("visibility"))
    )
  );
  if (!event?._id || !hasVisibility) return false;
  if (event.visibility !== "private") return true;
  if (await canManageEvent(user, event)) return true;

  const userId = requestUserId(user);
  if (!userId || !mongoose.Types.ObjectId.isValid(String(userId))) return false;
  return Boolean(await RegistrationResponse.exists({ eventId: event._id, userId }));
}

module.exports = {
  ORGANIZATION_EVENT_ROLES,
  OWNER_TYPES,
  resolveEvent,
  isPlatformEventAdmin,
  canManageEvent,
  canAccessPrivateEvent,
  canCreateOrganizationEvent,
  hasEligibleOrganizationForDiscoveryPrivacy,
};
