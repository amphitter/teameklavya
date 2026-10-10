"use strict";

const mongoose = require("mongoose");
const Organization = require("../models/organization.model");
const { isInstitutionCategory, isClubCategory, parentCategoriesForOrganization, normalizeCategory } = require("../config/organization");
const { isSuperAdminEmail } = require("./ownership.service");
const User = require("../models/user.model");
const { notifyMany } = require("./notification.service");

function isSameId(a, b) {
  return a != null && b != null && String(a) === String(b);
}

async function isPermanentSuperAdmin(user) {
  const uid = user?.id || user?._id;
  if (!uid || !mongoose.Types.ObjectId.isValid(String(uid))) return false;
  const acc = await User.findById(uid).select("email").lean();
  return Boolean(acc && isSuperAdminEmail(acc.email));
}

async function canManageClub(user, club) {
  if (!user || !club) return false;
  if (user.role === "admin") return true;
  if (await isPermanentSuperAdmin(user)) return true;
  // Check membership OWNER/ADMIN
  const OrganizationMembership = require("../models/organizationMembership.model");
  const uid = user.id || user._id;
  if (isSameId(club.createdBy, uid)) return true;
  const mem = await OrganizationMembership.findOne({ organizationId: club._id, userId: uid, status: "ACTIVE" }).lean();
  if (mem && ["OWNER", "ADMIN"].includes(mem.role)) return true;
  if ((club.managers || []).some((m) => isSameId(m, uid))) return true;
  return false;
}

async function canManageInstitution(user, institution) {
  if (!user || !institution) return false;
  if (user.role === "admin") return true;
  if (await isPermanentSuperAdmin(user)) return true;
  const OrganizationMembership = require("../models/organizationMembership.model");
  const uid = user.id || user._id;
  if (isSameId(institution.createdBy, uid)) return true;
  const mem = await OrganizationMembership.findOne({ organizationId: institution._id, userId: uid, status: "ACTIVE" }).lean();
  if (mem && ["OWNER", "ADMIN", "MANAGER"].includes(mem.role)) return true;
  if ((institution.managers || []).some((m) => isSameId(m, uid))) return true;
  return false;
}

function pushAffiliationHistory(org, entry) {
  if (!Array.isArray(org.affiliationHistory)) org.affiliationHistory = [];
  org.affiliationHistory.push({
    action: entry.action,
    actor: entry.actor || null,
    actorRole: entry.actorRole || "CLUB_ADMIN",
    fromParent: entry.fromParent || null,
    toParent: entry.toParent || null,
    fromStatus: entry.fromStatus || org.affiliationStatus || "NONE",
    toStatus: entry.toStatus,
    reason: entry.reason || "",
    createdAt: new Date(),
  });
}

async function validateParentForClub(clubCategory, parentOrg) {
  if (!parentOrg) throw Object.assign(new Error("Parent institution not found"), { status: 400 });
  if (!isInstitutionCategory(parentOrg.category)) {
    throw Object.assign(new Error("Parent must be an institution (COLLEGE, UNIVERSITY, SCHOOL, INSTITUTE)"), { status: 400 });
  }
  const allowed = parentCategoriesForOrganization(clubCategory);
  if (allowed.length && !allowed.includes(parentOrg.category)) {
    throw Object.assign(new Error(`Category ${clubCategory} cannot be affiliated with ${parentOrg.category}`), { status: 400 });
  }
  if (parentOrg.parentOrganizationId) {
    throw Object.assign(new Error("Nested institution links are not supported"), { status: 400 });
  }
  if (parentOrg.status !== "APPROVED") {
    throw Object.assign(new Error("Parent institution must be approved"), { status: 400 });
  }
}

async function requestAffiliation({ clubId, parentId, requester, reason }) {
  if (!mongoose.Types.ObjectId.isValid(String(clubId)) || !mongoose.Types.ObjectId.isValid(String(parentId))) {
    throw Object.assign(new Error("Valid club and parent ids required"), { status: 400 });
  }
  if (String(clubId) === String(parentId)) throw Object.assign(new Error("An organization cannot be its own parent"), { status: 400 });

  const [club, parent] = await Promise.all([
    Organization.findById(clubId),
    Organization.findById(parentId).select("_id category parentOrganizationId status name slug"),
  ]);
  if (!club) throw Object.assign(new Error("Club not found"), { status: 404 });
  if (!parent) throw Object.assign(new Error("Parent institution not found"), { status: 404 });

  const clubCat = normalizeCategory(club.category);
  if (!isClubCategory(clubCat)) {
    throw Object.assign(new Error("Only club categories can request affiliation"), { status: 400 });
  }

  await validateParentForClub(clubCat, parent);

  if (!(await canManageClub(requester, club))) {
    throw Object.assign(new Error("You can't manage this club"), { status: 403 });
  }

  // If already approved to same parent, idempotent
  if (isSameId(club.parentOrganizationId, parent._id) && club.affiliationStatus === "APPROVED") {
    return club;
  }

  const prevStatus = club.affiliationStatus || "NONE";
  const prevParent = club.parentOrganizationId || null;

  club.parentOrganizationId = parent._id;
  club.affiliationStatus = "PENDING";
  club.affiliationRequestedAt = new Date();
  club.affiliationRequestedBy = requester.id || requester._id;
  club.lastAffiliationChangeAt = new Date();
  club.affiliationRejectionReason = "";
  pushAffiliationHistory(club, {
    action: prevParent ? "TRANSFER_REQUESTED" : "REQUESTED",
    actor: requester.id || requester._id,
    actorRole: "CLUB_ADMIN",
    fromParent: prevParent,
    toParent: parent._id,
    fromStatus: prevStatus,
    toStatus: "PENDING",
    reason: reason || "",
  });

  await club.save();

  // Notify institution admins
  try {
    const OrganizationMembership = require("../models/organizationMembership.model");
    const members = await OrganizationMembership.find({ organizationId: parent._id, status: "ACTIVE", role: { $in: ["OWNER", "ADMIN", "MANAGER"] } }).select("userId").lean();
    const ids = members.map((m) => m.userId);
    if (parent.createdBy) ids.push(parent.createdBy);
    const unique = [...new Set(ids.map((id) => String(id)))].filter((id) => String(id) !== String(requester.id || requester._id));
    if (unique.length) {
      await notifyMany(unique.map((uid) => ({ user: uid, actor: requester.id || requester._id, type: "announcement", organization: club._id })));
    }
  } catch (e) {
    console.warn("affiliation request notify failed", e.message);
  }

  return club;
}

async function approveAffiliation({ clubId, approver, reason }) {
  const club = await Organization.findById(clubId);
  if (!club) throw Object.assign(new Error("Club not found"), { status: 404 });
  if (!club.parentOrganizationId) throw Object.assign(new Error("No parent institution to approve"), { status: 400 });

  const parent = await Organization.findById(club.parentOrganizationId).select("_id category status createdBy managers name").lean();
  if (!parent) throw Object.assign(new Error("Parent institution not found"), { status: 404 });

  // Only institution admins + super admin
  if (!(await canManageInstitution(approver, parent))) {
    throw Object.assign(new Error("Only parent institution admins can approve affiliation"), { status: 403 });
  }

  // Prevent cross-institution approval without transfer workflow: ensure approver is not approving a club that belongs to different institution via client tampering – we already load parent from club's current parent, so ok. But also ensure approver does not approve if club's parent changed after request (concurrent). Use version check? Simple: if club affiliation not PENDING, reject duplicate.
  if (club.affiliationStatus === "APPROVED") {
    // idempotent
    return club;
  }
  if (!["PENDING", "SUSPENDED", "REJECTED"].includes(club.affiliationStatus)) {
    throw Object.assign(new Error(`Cannot approve from status ${club.affiliationStatus}`), { status: 400 });
  }

  const prevStatus = club.affiliationStatus;
  club.affiliationStatus = "APPROVED";
  club.affiliationApprovedAt = new Date();
  club.affiliationApprovedBy = approver.id || approver._id;
  club.lastAffiliationChangeAt = new Date();
  pushAffiliationHistory(club, {
    action: "APPROVED",
    actor: approver.id || approver._id,
    actorRole: (await isPermanentSuperAdmin(approver)) || approver.role === "admin" ? "SUPER_ADMIN" : "INSTITUTION_ADMIN",
    fromParent: null,
    toParent: club.parentOrganizationId,
    fromStatus: prevStatus,
    toStatus: "APPROVED",
    reason: reason || "",
  });

  await club.save();

  // Notify club admins
  try {
    const OrganizationMembership = require("../models/organizationMembership.model");
    const members = await OrganizationMembership.find({ organizationId: club._id, status: "ACTIVE", role: { $in: ["OWNER", "ADMIN"] } }).select("userId").lean();
    const ids = members.map((m) => m.userId);
    if (club.createdBy) ids.push(club.createdBy);
    const unique = [...new Set(ids.map((id) => String(id)))].filter((id) => String(id) !== String(approver.id || approver._id));
    if (unique.length) {
      await notifyMany(unique.map((uid) => ({ user: uid, actor: approver.id || approver._id, type: "announcement", organization: club._id })));
    }
  } catch (e) {
    console.warn("affiliation approve notify failed", e.message);
  }

  return club;
}

async function rejectAffiliation({ clubId, approver, reason }) {
  if (!reason || !String(reason).trim()) throw Object.assign(new Error("Rejection reason required"), { status: 400 });
  const club = await Organization.findById(clubId);
  if (!club) throw Object.assign(new Error("Club not found"), { status: 404 });
  if (!club.parentOrganizationId) throw Object.assign(new Error("No parent to reject"), { status: 400 });
  const parent = await Organization.findById(club.parentOrganizationId).select("_id createdBy managers category").lean();
  if (!parent) throw Object.assign(new Error("Parent institution not found"), { status: 404 });
  if (!(await canManageInstitution(approver, parent))) {
    throw Object.assign(new Error("Only parent institution admins can reject"), { status: 403 });
  }
  if (club.affiliationStatus === "REJECTED" && club.affiliationRejectionReason === reason) return club;

  const prevStatus = club.affiliationStatus;
  club.affiliationStatus = "REJECTED";
  club.affiliationRejectedAt = new Date();
  club.affiliationRejectedBy = approver.id || approver._id;
  club.affiliationRejectionReason = reason;
  club.lastAffiliationChangeAt = new Date();
  pushAffiliationHistory(club, {
    action: "REJECTED",
    actor: approver.id || approver._id,
    actorRole: (await isPermanentSuperAdmin(approver)) || approver.role === "admin" ? "SUPER_ADMIN" : "INSTITUTION_ADMIN",
    fromParent: club.parentOrganizationId,
    toParent: null,
    fromStatus: prevStatus,
    toStatus: "REJECTED",
    reason,
  });
  await club.save();
  return club;
}

async function suspendAffiliation({ clubId, actor, reason }) {
  const club = await Organization.findById(clubId);
  if (!club) throw Object.assign(new Error("Club not found"), { status: 404 });
  if (!club.parentOrganizationId) throw Object.assign(new Error("No affiliation to suspend"), { status: 400 });
  const parent = await Organization.findById(club.parentOrganizationId).select("_id createdBy managers").lean();
  if (!(await canManageInstitution(actor, parent)) && !(await isPermanentSuperAdmin(actor)) && actor.role !== "admin") {
    throw Object.assign(new Error("Only institution admins or Super Admin can suspend"), { status: 403 });
  }
  const prev = club.affiliationStatus;
  club.affiliationStatus = "SUSPENDED";
  club.lastAffiliationChangeAt = new Date();
  pushAffiliationHistory(club, {
    action: "SUSPENDED",
    actor: actor.id || actor._id,
    actorRole: (await isPermanentSuperAdmin(actor)) || actor.role === "admin" ? "SUPER_ADMIN" : "INSTITUTION_ADMIN",
    fromParent: club.parentOrganizationId,
    toParent: club.parentOrganizationId,
    fromStatus: prev,
    toStatus: "SUSPENDED",
    reason: reason || "",
  });
  await club.save();
  return club;
}

async function revokeAffiliation({ clubId, actor, reason }) {
  const club = await Organization.findById(clubId);
  if (!club) throw Object.assign(new Error("Club not found"), { status: 404 });
  if (!(await isPermanentSuperAdmin(actor)) && actor.role !== "admin") {
    // Allow institution admin to revoke? Spec says affiliation revocation policy preserves registrations, notifies. Allow institution admin + super admin.
    const parent = club.parentOrganizationId ? await Organization.findById(club.parentOrganizationId).select("_id createdBy managers").lean() : null;
    if (!parent || !(await canManageInstitution(actor, parent))) {
      throw Object.assign(new Error("Only Super Admin or parent institution admin can revoke"), { status: 403 });
    }
  }
  const prev = club.affiliationStatus;
  const prevParent = club.parentOrganizationId;
  club.affiliationStatus = "REVOKED";
  club.lastAffiliationChangeAt = new Date();
  pushAffiliationHistory(club, {
    action: "REVOKED",
    actor: actor.id || actor._id,
    actorRole: (await isPermanentSuperAdmin(actor)) || actor.role === "admin" ? "SUPER_ADMIN" : "INSTITUTION_ADMIN",
    fromParent: prevParent,
    toParent: null,
    fromStatus: prev,
    toStatus: "REVOKED",
    reason: reason || "",
  });
  // Keep parentOrganizationId for audit but mark revoked; do not delete to preserve history? Spec says revocation preserves registrations, no auto delete. Keep parent id for trace but status REVOKED.
  await club.save();
  return club;
}

async function transferAffiliation({ clubId, newParentId, actor, reason }) {
  if (!mongoose.Types.ObjectId.isValid(String(newParentId))) throw Object.assign(new Error("Valid new parent id required"), { status: 400 });
  const club = await Organization.findById(clubId);
  if (!club) throw Object.assign(new Error("Club not found"), { status: 404 });
  const newParent = await Organization.findById(newParentId).select("_id category parentOrganizationId status").lean();
  if (!newParent) throw Object.assign(new Error("New parent not found"), { status: 404 });
  await validateParentForClub(normalizeCategory(club.category), newParent);

  // Only club OWNER/ADMIN or Super Admin can initiate transfer? Spec says audited transfer, prevent cross-institution approval without transfer workflow.
  const isSuper = (await isPermanentSuperAdmin(actor)) || actor.role === "admin";
  if (!isSuper && !(await canManageClub(actor, club))) {
    throw Object.assign(new Error("Only club admins can request transfer"), { status: 403 });
  }

  const prevParent = club.parentOrganizationId;
  const prevStatus = club.affiliationStatus;

  // If transferring to different institution, set to PENDING and require new institution approval
  club.parentOrganizationId = newParent._id;
  club.affiliationStatus = "PENDING";
  club.affiliationRequestedAt = new Date();
  club.affiliationRequestedBy = actor.id || actor._id;
  club.lastAffiliationChangeAt = new Date();
  pushAffiliationHistory(club, {
    action: "TRANSFERRED",
    actor: actor.id || actor._id,
    actorRole: isSuper ? "SUPER_ADMIN" : "CLUB_ADMIN",
    fromParent: prevParent,
    toParent: newParent._id,
    fromStatus: prevStatus,
    toStatus: "PENDING",
    reason: reason || "",
  });
  await club.save();
  return club;
}

module.exports = {
  requestAffiliation,
  approveAffiliation,
  rejectAffiliation,
  suspendAffiliation,
  revokeAffiliation,
  transferAffiliation,
  canManageClub,
  canManageInstitution,
};
