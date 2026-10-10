"use strict";

const mongoose = require("mongoose");
const User = require("../models/user.model");
const OrganizationMembership = require("../models/organizationMembership.model");
const { isSuperAdminEmail } = require("./ownership.service");

const ORGANIZATION_CAPABILITIES = Object.freeze({
  EDIT_PROFILE: Object.freeze(["OWNER", "ADMIN", "MANAGER"]),
  MANAGE_MEMBERS: Object.freeze(["OWNER", "ADMIN"]),
  MANAGE_EVENTS: Object.freeze(["OWNER", "ADMIN", "EVENT_MANAGER"]),
});

const PROFILE_EDIT_ROLES = new Set(ORGANIZATION_CAPABILITIES.EDIT_PROFILE);
const MEMBERSHIP_ADMIN_ROLES = new Set(ORGANIZATION_CAPABILITIES.MANAGE_MEMBERS);
const EVENT_MANAGEMENT_ROLES = new Set(ORGANIZATION_CAPABILITIES.MANAGE_EVENTS);

function requestUserId(user) {
  return user?.id || user?._id || null;
}

function isSameId(left, right) {
  return left != null && right != null && String(left) === String(right);
}

/**
 * Resolve the caller's Organization role without granting permissions from
 * affiliation, verification, following, or parent/child links.
 *
 * An explicit membership row always wins over legacy fields. In particular,
 * REVOKED/SUSPENDED rows must not fall through to a stale `managers[]` entry.
 * Legacy fallback keeps existing records working until the reviewed backfill
 * is applied: createdBy → OWNER and managers[] → MANAGER.
 */
async function getEffectiveOrganizationMembership(user, organization) {
  const userId = requestUserId(user);
  if (!userId || !organization || !mongoose.Types.ObjectId.isValid(String(userId))) return null;

  // Ownership is still anchored to createdBy in Phase 4; no ownership
  // transfer workflow has been authorized, so a stale membership row cannot
  // demote the recorded creator.
  if (isSameId(organization.createdBy, userId)) {
    return { organizationId: organization._id, userId, role: "OWNER", status: "ACTIVE", source: "createdBy" };
  }

  const membership = await OrganizationMembership.findOne({
    organizationId: organization._id,
    userId,
  }).lean();
  if (membership) {
    if (membership.status !== "ACTIVE") return null;
    return { ...membership, source: "membership" };
  }
  if ((organization.managers || []).some((managerId) => isSameId(managerId, userId))) {
    return { organizationId: organization._id, userId, role: "MANAGER", status: "ACTIVE", source: "legacy-managers" };
  }
  return null;
}

async function isPermanentSuperAdmin(user) {
  const userId = requestUserId(user);
  if (!userId || !mongoose.Types.ObjectId.isValid(String(userId))) return false;
  const account = await User.findById(userId).select("email").lean();
  return Boolean(account && isSuperAdminEmail(account.email));
}

/** Existing global-admin/Super-Admin profile access is preserved. */
async function canEditOrganizationProfile(user, organization) {
  if (!user || !organization) return false;
  if (user.role === "admin") return true;
  if (await isPermanentSuperAdmin(user)) return true;
  const membership = await getEffectiveOrganizationMembership(user, organization);
  return Boolean(membership && PROFILE_EDIT_ROLES.has(membership.role));
}

/** Only active OWNER/ADMIN memberships administer the membership roster. */
async function getOrganizationMembershipAdminRole(user, organization) {
  const membership = await getEffectiveOrganizationMembership(user, organization);
  return membership && MEMBERSHIP_ADMIN_ROLES.has(membership.role) ? membership.role : null;
}

async function canManageOrganizationMembers(user, organization) {
  return Boolean(await getOrganizationMembershipAdminRole(user, organization));
}

/** OWNER/ADMIN/EVENT_MANAGER manage only Events explicitly owned by this Organization. */
async function getOrganizationEventManagerRole(user, organization) {
  const membership = await getEffectiveOrganizationMembership(user, organization);
  return membership && EVENT_MANAGEMENT_ROLES.has(membership.role) ? membership.role : null;
}

async function canManageOrganizationEvents(user, organization) {
  if (!user || !organization) return false;
  const userId = requestUserId(user);
  if (userId && mongoose.Types.ObjectId.isValid(String(userId))) {
    const account = await User.findById(userId).select("role").lean();
    if (account?.role === "admin") return true;
  }
  if (await isPermanentSuperAdmin(user)) return true;
  return Boolean(await getOrganizationEventManagerRole(user, organization));
}

module.exports = {
  ORGANIZATION_CAPABILITIES,
  PROFILE_EDIT_ROLES,
  MEMBERSHIP_ADMIN_ROLES,
  EVENT_MANAGEMENT_ROLES,
  getEffectiveOrganizationMembership,
  canEditOrganizationProfile,
  getOrganizationMembershipAdminRole,
  canManageOrganizationMembers,
  getOrganizationEventManagerRole,
  canManageOrganizationEvents,
};
