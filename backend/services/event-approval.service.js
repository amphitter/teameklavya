"use strict";

const mongoose = require("mongoose");
const Event = require("../models/event.model");
const Organization = require("../models/organization.model");
const User = require("../models/user.model");
const { isClubCategory, normalizeCategory } = require("../config/organization");
const { EVENT_APPROVAL_STATUSES, EVENT_MATERIAL_FIELDS } = require("../config/event");
const { isSuperAdminEmail } = require("./ownership.service");
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
  const OrganizationMembership = require("../models/organizationMembership.model");
  const uid = user.id || user._id;
  if (isSameId(club.createdBy, uid)) return true;
  const mem = await OrganizationMembership.findOne({ organizationId: club._id, userId: uid, status: "ACTIVE" }).lean();
  if (mem && ["OWNER", "ADMIN", "MANAGER", "EVENT_MANAGER"].includes(mem.role)) return true;
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
  if (mem && ["OWNER", "ADMIN", "MANAGER", "EVENT_MANAGER"].includes(mem.role)) return true;
  if ((institution.managers || []).some((m) => isSameId(m, uid))) return true;
  return false;
}

function pushApprovalHistory(event, entry) {
  if (!Array.isArray(event.approvalHistory)) event.approvalHistory = [];
  event.approvalHistory.push({
    action: entry.action,
    actor: entry.actor || null,
    actorRole: entry.actorRole || "CREATOR",
    fromStatus: entry.fromStatus || event.approvalStatus || "DRAFT",
    toStatus: entry.toStatus,
    reason: entry.reason || "",
    message: entry.message || "",
    createdAt: new Date(),
  });
}

function detectMaterialChanges(oldEvent, newData) {
  for (const field of EVENT_MATERIAL_FIELDS) {
    if (newData[field] !== undefined) {
      const oldVal = oldEvent[field];
      const newVal = newData[field];
      if (oldVal instanceof Date || newVal instanceof Date) {
        const oldTime = oldVal ? new Date(oldVal).getTime() : null;
        const newTime = newVal ? new Date(newVal).getTime() : null;
        if (oldTime !== newTime) return field;
      } else if (String(oldVal ?? "") !== String(newVal ?? "")) {
        // For numbers, compare as numbers too
        if (typeof oldVal === "number" || typeof newVal === "number") {
          if (Number(oldVal) !== Number(newVal)) return field;
        } else if (oldVal !== newVal) {
          return field;
        }
      }
    }
  }
  return null;
}

// ── Core Workflow ────────────────────────────────────────────────

async function createProposal({ eventData, clubOrg, creator }) {
  // Validate club affiliation approved
  if (!clubOrg.parentOrganizationId) {
    throw Object.assign(new Error("Club must have an approved parent institution affiliation"), { status: 400 });
  }
  if (clubOrg.affiliationStatus !== "APPROVED") {
    throw Object.assign(new Error(`Club affiliation is ${clubOrg.affiliationStatus}, must be APPROVED`), { status: 400 });
  }

  const parentInstitution = await Organization.findById(clubOrg.parentOrganizationId).select("_id status category name slug").lean();
  if (!parentInstitution) throw Object.assign(new Error("Parent institution not found"), { status: 404 });
  if (parentInstitution.status !== "APPROVED") throw Object.assign(new Error("Parent institution must be approved"), { status: 400 });

  // Build event with approval fields
  const now = new Date();
  const event = new Event({
    ...eventData,
    createdBy: creator.id || creator._id,
    organizerType: "ORGANIZATION",
    organizerId: clubOrg._id,
    organization: clubOrg._id, // association for discovery
    proposingOrganizationId: clubOrg._id,
    parentInstitutionId: parentInstitution._id,
    approvalStatus: "PENDING_REVIEW",
    submittedAt: now,
    version: 1,
    liveState: "DRAFT",
    visibility: "private", // unpublished until approved
  });
  pushApprovalHistory(event, {
    action: "CREATED",
    actor: creator.id || creator._id,
    actorRole: "CREATOR",
    fromStatus: "",
    toStatus: "PENDING_REVIEW",
    reason: "",
    message: "Event proposal created",
  });
  pushApprovalHistory(event, {
    action: "SUBMITTED",
    actor: creator.id || creator._id,
    actorRole: "CLUB_ADMIN",
    fromStatus: "DRAFT",
    toStatus: "PENDING_REVIEW",
    reason: "",
    message: "Submitted for institution approval",
  });

  await event.save();

  // Notify institution admins
  try {
    const OrganizationMembership = require("../models/organizationMembership.model");
    const members = await OrganizationMembership.find({ organizationId: parentInstitution._id, status: "ACTIVE", role: { $in: ["OWNER", "ADMIN", "MANAGER", "EVENT_MANAGER"] } }).select("userId").lean();
    const ids = members.map((m) => m.userId);
    if (parentInstitution.createdBy) ids.push(parentInstitution.createdBy);
    const unique = [...new Set(ids.map((id) => String(id)))].filter((id) => String(id) !== String(creator.id || creator._id));
    if (unique.length) {
      await notifyMany(unique.map((uid) => ({ user: uid, actor: creator.id || creator._id, type: "announcement", event: event._id, organization: clubOrg._id })));
    }
  } catch (e) {
    console.warn("event proposal notify failed", e.message);
  }

  return event;
}

async function approveEvent({ eventId, approver, reason }) {
  // Concurrent-safe: only approve if currently PENDING_REVIEW or CHANGES_REQUESTED
  // Use findOneAndUpdate with condition to prevent duplicate processing
  const event = await Event.findById(eventId);
  if (!event) throw Object.assign(new Error("Event not found"), { status: 404 });

  if (event.approvalStatus === "APPROVED") {
    // idempotent
    return event;
  }

  if (!["PENDING_REVIEW", "CHANGES_REQUESTED"].includes(event.approvalStatus)) {
    throw Object.assign(new Error(`Cannot approve event in status ${event.approvalStatus}`), { status: 400 });
  }

  if (!event.parentInstitutionId) throw Object.assign(new Error("Event has no parent institution"), { status: 400 });

  const parent = await Organization.findById(event.parentInstitutionId).select("_id createdBy managers status").lean();
  if (!parent) throw Object.assign(new Error("Parent institution not found"), { status: 404 });

  // Only correct parent institution admins + Super Admin
  const isSuper = (await isPermanentSuperAdmin(approver)) || approver.role === "admin";
  let isInstitutionAdmin = false;
  if (!isSuper) {
    const OrganizationMembership = require("../models/organizationMembership.model");
    const uid = approver.id || approver._id;
    if (isSameId(parent.createdBy, uid)) isInstitutionAdmin = true;
    else {
      const mem = await OrganizationMembership.findOne({ organizationId: parent._id, userId: uid, status: "ACTIVE" }).lean();
      if (mem && ["OWNER", "ADMIN", "MANAGER", "EVENT_MANAGER"].includes(mem.role)) isInstitutionAdmin = true;
      else if ((parent.managers || []).some((m) => isSameId(m, uid))) isInstitutionAdmin = true;
    }
  }

  if (!isSuper && !isInstitutionAdmin) {
    throw Object.assign(new Error("Only parent institution admins or Super Admin can approve"), { status: 403 });
  }

  // Club cannot self-approve: check if approver is only club admin but not institution admin and not super
  if (!isSuper) {
    const club = await Organization.findById(event.proposingOrganizationId || event.organizerId).select("_id createdBy managers").lean();
    if (club) {
      // If approver is club admin but NOT institution admin, block
      // We already checked institution admin; if not institution admin, it's not allowed anyway
      // But extra check: if proposing club == parent (shouldn't happen) – blocked
      if (isSameId(club._id, parent._id)) {
        throw Object.assign(new Error("Club cannot self-approve"), { status: 403 });
      }
    }
  }

  // Validate affiliation still approved
  const proposingClub = await Organization.findById(event.proposingOrganizationId || event.organizerId).select("affiliationStatus parentOrganizationId").lean();
  if (proposingClub) {
    if (proposingClub.affiliationStatus !== "APPROVED" || !isSameId(proposingClub.parentOrganizationId, event.parentInstitutionId)) {
      throw Object.assign(new Error("Club affiliation is no longer valid with this institution"), { status: 400 });
    }
  }

  // Concurrent-safe update
  const updated = await Event.findOneAndUpdate(
    { _id: event._id, approvalStatus: { $in: ["PENDING_REVIEW", "CHANGES_REQUESTED"] } },
    {
      $set: {
        approvalStatus: "APPROVED",
        approvedBy: approver.id || approver._id,
        approvedAt: new Date(),
        liveState: "PUBLISHED",
        visibility: "public",
        requiresReapproval: false,
        lastMaterialChangeAt: null,
      },
      $push: {
        approvalHistory: {
          action: "APPROVED",
          actor: approver.id || approver._id,
          actorRole: isSuper ? "SUPER_ADMIN" : "INSTITUTION_ADMIN",
          fromStatus: event.approvalStatus,
          toStatus: "APPROVED",
          reason: reason || "",
          message: reason || "",
          createdAt: new Date(),
        },
      },
    },
    { new: true }
  );

  if (!updated) {
    // Another concurrent approval happened – fetch current and return idempotent
    const current = await Event.findById(eventId);
    if (current && current.approvalStatus === "APPROVED") return current;
    throw Object.assign(new Error("Event approval conflict, please retry"), { status: 409 });
  }

  // Notify club
  try {
    const OrganizationMembership = require("../models/organizationMembership.model");
    const clubId = updated.proposingOrganizationId || updated.organizerId;
    if (clubId) {
      const members = await OrganizationMembership.find({ organizationId: clubId, status: "ACTIVE", role: { $in: ["OWNER", "ADMIN", "MANAGER", "EVENT_MANAGER"] } }).select("userId").lean();
      const clubDoc = await Organization.findById(clubId).select("createdBy").lean();
      const ids = members.map((m) => m.userId);
      if (clubDoc?.createdBy) ids.push(clubDoc.createdBy);
      const unique = [...new Set(ids.map((id) => String(id)))].filter((id) => String(id) !== String(approver.id || approver._id));
      if (unique.length) {
        await notifyMany(unique.map((uid) => ({ user: uid, actor: approver.id || approver._id, type: "announcement", event: updated._id, organization: clubId })));
      }
    }
  } catch (e) {
    console.warn("event approve notify failed", e.message);
  }

  return updated;
}

async function rejectEvent({ eventId, approver, reason }) {
  if (!reason || !String(reason).trim()) throw Object.assign(new Error("Rejection reason required"), { status: 400 });
  const event = await Event.findById(eventId);
  if (!event) throw Object.assign(new Error("Event not found"), { status: 404 });

  if (event.approvalStatus === "REJECTED") return event;

  if (!["PENDING_REVIEW", "CHANGES_REQUESTED"].includes(event.approvalStatus)) {
    throw Object.assign(new Error(`Cannot reject event in status ${event.approvalStatus}`), { status: 400 });
  }

  const parent = await Organization.findById(event.parentInstitutionId).select("_id createdBy managers").lean();
  if (!parent) throw Object.assign(new Error("Parent institution not found"), { status: 404 });

  const isSuper = (await isPermanentSuperAdmin(approver)) || approver.role === "admin";
  if (!isSuper) {
    const OrganizationMembership = require("../models/organizationMembership.model");
    const uid = approver.id || approver._id;
    let ok = false;
    if (isSameId(parent.createdBy, uid)) ok = true;
    else {
      const mem = await OrganizationMembership.findOne({ organizationId: parent._id, userId: uid, status: "ACTIVE" }).lean();
      if (mem && ["OWNER", "ADMIN", "MANAGER", "EVENT_MANAGER"].includes(mem.role)) ok = true;
      else if ((parent.managers || []).some((m) => isSameId(m, uid))) ok = true;
    }
    if (!ok) throw Object.assign(new Error("Only parent institution admins or Super Admin can reject"), { status: 403 });
  }

  const updated = await Event.findOneAndUpdate(
    { _id: event._id, approvalStatus: { $in: ["PENDING_REVIEW", "CHANGES_REQUESTED"] } },
    {
      $set: {
        approvalStatus: "REJECTED",
        rejectedAt: new Date(),
        rejectionReason: reason,
        liveState: "DRAFT",
        visibility: "private",
      },
      $push: {
        approvalHistory: {
          action: "REJECTED",
          actor: approver.id || approver._id,
          actorRole: isSuper ? "SUPER_ADMIN" : "INSTITUTION_ADMIN",
          fromStatus: event.approvalStatus,
          toStatus: "REJECTED",
          reason,
          message: reason,
          createdAt: new Date(),
        },
      },
    },
    { new: true }
  );

  if (!updated) {
    const cur = await Event.findById(eventId);
    if (cur && cur.approvalStatus === "REJECTED") return cur;
    throw Object.assign(new Error("Reject conflict, please retry"), { status: 409 });
  }

  // Notify club
  try {
    const OrganizationMembership = require("../models/organizationMembership.model");
    const clubId = updated.proposingOrganizationId || updated.organizerId;
    if (clubId) {
      const members = await OrganizationMembership.find({ organizationId: clubId, status: "ACTIVE", role: { $in: ["OWNER", "ADMIN"] } }).select("userId").lean();
      const clubDoc = await Organization.findById(clubId).select("createdBy").lean();
      const ids = members.map((m) => m.userId);
      if (clubDoc?.createdBy) ids.push(clubDoc.createdBy);
      const unique = [...new Set(ids.map((id) => String(id)))].filter((id) => String(id) !== String(approver.id || approver._id));
      if (unique.length) await notifyMany(unique.map((uid) => ({ user: uid, actor: approver.id || approver._id, type: "announcement", event: updated._id })));
    }
  } catch (e) {
    console.warn("reject notify failed", e.message);
  }

  return updated;
}

async function requestChanges({ eventId, approver, message }) {
  if (!message || !String(message).trim()) throw Object.assign(new Error("Change request message required"), { status: 400 });
  const event = await Event.findById(eventId);
  if (!event) throw Object.assign(new Error("Event not found"), { status: 404 });

  if (!["PENDING_REVIEW"].includes(event.approvalStatus)) {
    throw Object.assign(new Error(`Cannot request changes in status ${event.approvalStatus}`), { status: 400 });
  }

  const parent = await Organization.findById(event.parentInstitutionId).select("_id createdBy managers").lean();
  if (!parent) throw Object.assign(new Error("Parent institution not found"), { status: 404 });

  const isSuper = (await isPermanentSuperAdmin(approver)) || approver.role === "admin";
  if (!isSuper) {
    const OrganizationMembership = require("../models/organizationMembership.model");
    const uid = approver.id || approver._id;
    let ok = false;
    if (isSameId(parent.createdBy, uid)) ok = true;
    else {
      const mem = await OrganizationMembership.findOne({ organizationId: parent._id, userId: uid, status: "ACTIVE" }).lean();
      if (mem && ["OWNER", "ADMIN", "MANAGER", "EVENT_MANAGER"].includes(mem.role)) ok = true;
      else if ((parent.managers || []).some((m) => isSameId(m, uid))) ok = true;
    }
    if (!ok) throw Object.assign(new Error("Only parent institution admins or Super Admin can request changes"), { status: 403 });
  }

  const updated = await Event.findOneAndUpdate(
    { _id: event._id, approvalStatus: "PENDING_REVIEW" },
    {
      $set: {
        approvalStatus: "CHANGES_REQUESTED",
        changeRequestMessage: message,
      },
      $push: {
        approvalHistory: {
          action: "CHANGES_REQUESTED",
          actor: approver.id || approver._id,
          actorRole: isSuper ? "SUPER_ADMIN" : "INSTITUTION_ADMIN",
          fromStatus: event.approvalStatus,
          toStatus: "CHANGES_REQUESTED",
          reason: message,
          message,
          createdAt: new Date(),
        },
      },
    },
    { new: true }
  );

  if (!updated) throw Object.assign(new Error("Request changes conflict"), { status: 409 });

  // Notify club
  try {
    const OrganizationMembership = require("../models/organizationMembership.model");
    const clubId = updated.proposingOrganizationId || updated.organizerId;
    if (clubId) {
      const members = await OrganizationMembership.find({ organizationId: clubId, status: "ACTIVE", role: { $in: ["OWNER", "ADMIN"] } }).select("userId").lean();
      const clubDoc = await Organization.findById(clubId).select("createdBy").lean();
      const ids = members.map((m) => m.userId);
      if (clubDoc?.createdBy) ids.push(clubDoc.createdBy);
      const unique = [...new Set(ids.map((id) => String(id)))].filter((id) => String(id) !== String(approver.id || approver._id));
      if (unique.length) await notifyMany(unique.map((uid) => ({ user: uid, actor: approver.id || approver._id, type: "announcement", event: updated._id })));
    }
  } catch (e) {
    console.warn("requestChanges notify failed", e.message);
  }

  return updated;
}

async function resubmitEvent({ eventId, actor, updates }) {
  const event = await Event.findById(eventId);
  if (!event) throw Object.assign(new Error("Event not found"), { status: 404 });

  if (!["REJECTED", "CHANGES_REQUESTED", "DRAFT"].includes(event.approvalStatus)) {
    throw Object.assign(new Error(`Cannot resubmit event in status ${event.approvalStatus}`), { status: 400 });
  }

  const clubId = event.proposingOrganizationId || event.organizerId;
  if (!clubId) throw Object.assign(new Error("Event has no proposing club"), { status: 400 });

  const club = await Organization.findById(clubId).select("_id createdBy managers affiliationStatus parentOrganizationId").lean();
  if (!club) throw Object.assign(new Error("Proposing club not found"), { status: 404 });

  if (!(await canManageClub(actor, club))) {
    throw Object.assign(new Error("Only club admins can resubmit"), { status: 403 });
  }

  // Apply updates if provided (limited fields)
  const allowedUpdateFields = ["title", "description", "category", "venue", "onlineEventLink", "eventType", "startDate", "endDate", "bannerUrl", "logoUrl", "maxAttendees", "price", "platform", "meetingId", "passcode", "registrationForm", "requiredProfileFields", "speakers", "schedule", "benefits", "partners", "instructions", "theme", "isFeatured", "visibility"];
  // Actually isFeatured should not be set by club – ignore if not super
  const isSuper = (await isPermanentSuperAdmin(actor)) || actor.role === "admin";
  const sanitized = {};
  if (updates) {
    for (const f of allowedUpdateFields) {
      if (updates[f] !== undefined) {
        if (f === "isFeatured" && !isSuper) continue;
        sanitized[f] = updates[f];
      }
    }
  }

  // If previously approved and now resubmitting due to material change, handled elsewhere – here it's rejected/changes_requested
  const updated = await Event.findOneAndUpdate(
    { _id: event._id, approvalStatus: { $in: ["REJECTED", "CHANGES_REQUESTED", "DRAFT"] } },
    {
      $set: {
        ...sanitized,
        approvalStatus: "PENDING_REVIEW",
        lastResubmittedAt: new Date(),
        rejectionReason: "",
        changeRequestMessage: "",
        version: (event.version || 1) + 1,
      },
      $push: {
        approvalHistory: {
          action: "RESUBMITTED",
          actor: actor.id || actor._id,
          actorRole: "CLUB_ADMIN",
          fromStatus: event.approvalStatus,
          toStatus: "PENDING_REVIEW",
          reason: "",
          message: "Resubmitted for approval",
          createdAt: new Date(),
        },
      },
    },
    { new: true }
  );

  if (!updated) throw Object.assign(new Error("Resubmit conflict"), { status: 409 });

  // Notify institution
  try {
    const parentId = updated.parentInstitutionId;
    if (parentId) {
      const parent = await Organization.findById(parentId).select("_id createdBy").lean();
      const OrganizationMembership = require("../models/organizationMembership.model");
      const members = await OrganizationMembership.find({ organizationId: parentId, status: "ACTIVE", role: { $in: ["OWNER", "ADMIN", "MANAGER", "EVENT_MANAGER"] } }).select("userId").lean();
      const ids = members.map((m) => m.userId);
      if (parent?.createdBy) ids.push(parent.createdBy);
      const unique = [...new Set(ids.map((id) => String(id)))].filter((id) => String(id) !== String(actor.id || actor._id));
      if (unique.length) await notifyMany(unique.map((uid) => ({ user: uid, actor: actor.id || actor._id, type: "announcement", event: updated._id })));
    }
  } catch (e) {
    console.warn("resubmit notify failed", e.message);
  }

  return updated;
}

async function handleUpdateAfterApproval({ eventId, actor, updates }) {
  const event = await Event.findById(eventId);
  if (!event) throw Object.assign(new Error("Event not found"), { status: 404 });

  const clubId = event.proposingOrganizationId || event.organizerId;
  const club = clubId ? await Organization.findById(clubId).select("_id createdBy managers affiliationStatus parentOrganizationId").lean() : null;
  const parentId = event.parentInstitutionId;
  const parent = parentId ? await Organization.findById(parentId).select("_id createdBy managers").lean() : null;

  const isSuper = (await isPermanentSuperAdmin(actor)) || actor.role === "admin";
  const isClubAdmin = club ? await canManageClub(actor, club) : false;
  const isInstitutionAdmin = parent ? await canManageInstitution(actor, parent) : false;

  if (!isSuper && !isClubAdmin && !isInstitutionAdmin) {
    throw Object.assign(new Error("You can't edit this event"), { status: 403 });
  }

  // If event is APPROVED and material change detected, require reapproval
  if (event.approvalStatus === "APPROVED") {
    const materialField = detectMaterialChanges(event, updates || {});
    if (materialField) {
      // Club edits require reapproval, institution edits can directly approve per policy? Spec: material changes after approval require reapproval. Institution perms manage details per policy/approve changes.
      // If institution admin edits, allow direct update without reapproval? But spec says material changes after approval require reapproval – so even institution edits should maybe require? Let's allow institution admin to edit without reapproval if they are approver, but record material change.
      // For club: set requiresReapproval true and status back to PENDING_REVIEW? Or keep APPROVED but flag requiresReapproval? Spec: material changes after approval require reapproval. We'll implement: club material change => status PENDING_REVIEW, requiresReapproval true, save snapshot.
      if (isClubAdmin && !isInstitutionAdmin && !isSuper) {
        // Club material change triggers reapproval
        const snapshot = {
          title: event.title,
          description: event.description,
          startDate: event.startDate,
          endDate: event.endDate,
          venue: event.venue,
          onlineEventLink: event.onlineEventLink,
          category: event.category,
          bannerUrl: event.bannerUrl,
          logoUrl: event.logoUrl,
          maxAttendees: event.maxAttendees,
          price: event.price,
        };
        const updated = await Event.findOneAndUpdate(
          { _id: event._id, approvalStatus: "APPROVED" },
          {
            $set: {
              ...updates,
              approvalStatus: "PENDING_REVIEW",
              requiresReapproval: true,
              lastMaterialChangeAt: new Date(),
              previousApprovedSnapshot: snapshot,
              version: (event.version || 1) + 1,
            },
            $push: {
              approvalHistory: {
                action: "MATERIAL_CHANGE",
                actor: actor.id || actor._id,
                actorRole: "CLUB_ADMIN",
                fromStatus: "APPROVED",
                toStatus: "PENDING_REVIEW",
                reason: `Material change in ${materialField}`,
                message: `Material change requires reapproval: ${materialField}`,
                createdAt: new Date(),
              },
            },
          },
          { new: true }
        );
        if (!updated) throw Object.assign(new Error("Material change conflict"), { status: 409 });

        // Notify institution
        try {
          const OrganizationMembership = require("../models/organizationMembership.model");
          const members = await OrganizationMembership.find({ organizationId: parentId, status: "ACTIVE", role: { $in: ["OWNER", "ADMIN", "MANAGER", "EVENT_MANAGER"] } }).select("userId").lean();
          const ids = members.map((m) => m.userId);
          if (parent?.createdBy) ids.push(parent.createdBy);
          const unique = [...new Set(ids.map((id) => String(id)))].filter((id) => String(id) !== String(actor.id || actor._id));
          if (unique.length) await notifyMany(unique.map((uid) => ({ user: uid, actor: actor.id || actor._id, type: "announcement", event: updated._id })));
        } catch (e) {
          console.warn("material change notify failed", e.message);
        }

        return updated;
      } else {
        // Institution admin or super admin can edit directly, but record history
        const updated = await Event.findByIdAndUpdate(
          eventId,
          {
            $set: { ...updates, version: (event.version || 1) + 1 },
            $push: {
              approvalHistory: {
                action: "MATERIAL_CHANGE",
                actor: actor.id || actor._id,
                actorRole: isSuper ? "SUPER_ADMIN" : "INSTITUTION_ADMIN",
                fromStatus: "APPROVED",
                toStatus: "APPROVED",
                reason: `Institution edited ${materialField}`,
                message: `Institution updated material field ${materialField}`,
                createdAt: new Date(),
              },
            },
          },
          { new: true }
        );
        return updated;
      }
    }
  }

  // Non-material or non-approved event – allow edit
  const allowed = ["title", "description", "category", "venue", "onlineEventLink", "eventType", "startDate", "endDate", "bannerUrl", "logoUrl", "maxAttendees", "price", "platform", "meetingId", "passcode", "registrationForm", "requiredProfileFields", "speakers", "schedule", "benefits", "partners", "instructions", "theme", "visibility", "liveSettings"];
  const sanitized = {};
  if (updates) {
    for (const f of allowed) {
      if (updates[f] !== undefined) sanitized[f] = updates[f];
    }
  }

  const updated = await Event.findByIdAndUpdate(
    eventId,
    {
      $set: { ...sanitized, version: (event.version || 1) + 1 },
    },
    { new: true }
  );
  return updated;
}

async function cancelEvent({ eventId, actor, reason }) {
  const event = await Event.findById(eventId);
  if (!event) throw Object.assign(new Error("Event not found"), { status: 404 });

  const clubId = event.proposingOrganizationId || event.organizerId;
  const club = clubId ? await Organization.findById(clubId).select("_id createdBy managers").lean() : null;
  const parentId = event.parentInstitutionId;
  const parent = parentId ? await Organization.findById(parentId).select("_id createdBy managers").lean() : null;

  const isSuper = (await isPermanentSuperAdmin(actor)) || actor.role === "admin";
  const isClubAdmin = club ? await canManageClub(actor, club) : false;
  const isInstitutionAdmin = parent ? await canManageInstitution(actor, parent) : false;
  const isCreator = isSameId(event.createdBy, actor.id || actor._id);

  if (!isSuper && !isClubAdmin && !isInstitutionAdmin && !isCreator) {
    throw Object.assign(new Error("You can't cancel this event"), { status: 403 });
  }

  // Preserve registrations – do not delete tickets, etc. Just mark cancelled
  const updated = await Event.findByIdAndUpdate(
    eventId,
    {
      $set: {
        approvalStatus: "CANCELLED",
        liveState: "CANCELLED",
      },
      $push: {
        approvalHistory: {
          action: "CANCELLED",
          actor: actor.id || actor._id,
          actorRole: isSuper ? "SUPER_ADMIN" : isInstitutionAdmin ? "INSTITUTION_ADMIN" : isClubAdmin ? "CLUB_ADMIN" : "CREATOR",
          fromStatus: event.approvalStatus,
          toStatus: "CANCELLED",
          reason: reason || "",
          message: reason || "Event cancelled",
          createdAt: new Date(),
        },
      },
    },
    { new: true }
  );

  // Notify stakeholders – preserve registrations, notify
  try {
    const RegistrationResponse = require("../models/registrationResponse.model");
    const regs = await RegistrationResponse.find({ event: event._id }).select("user").lean();
    const userIds = [...new Set(regs.map((r) => String(r.user)))];
    if (userIds.length) {
      await notifyMany(userIds.map((uid) => ({ user: uid, actor: actor.id || actor._id, type: "announcement", event: event._id })));
    }
  } catch (e) {
    console.warn("cancel notify failed", e.message);
  }

  return updated;
}

async function getApprovalQueue({ institutionId, actor, status, limit = 20, cursor }) {
  if (!mongoose.Types.ObjectId.isValid(String(institutionId))) throw Object.assign(new Error("Invalid institution id"), { status: 400 });
  const institution = await Organization.findById(institutionId).select("_id createdBy managers category").lean();
  if (!institution) throw Object.assign(new Error("Institution not found"), { status: 404 });

  const isSuper = (await isPermanentSuperAdmin(actor)) || actor.role === "admin";
  if (!isSuper) {
    const OrganizationMembership = require("../models/organizationMembership.model");
    const uid = actor.id || actor._id;
    let ok = false;
    if (isSameId(institution.createdBy, uid)) ok = true;
    else {
      const mem = await OrganizationMembership.findOne({ organizationId: institution._id, userId: uid, status: "ACTIVE" }).lean();
      if (mem && ["OWNER", "ADMIN", "MANAGER", "EVENT_MANAGER"].includes(mem.role)) ok = true;
      else if ((institution.managers || []).some((m) => isSameId(m, uid))) ok = true;
    }
    if (!ok) throw Object.assign(new Error("Only institution admins can view approval queue"), { status: 403 });
  }

  const filter = { parentInstitutionId: institution._id };
  if (status) filter.approvalStatus = status;
  else filter.approvalStatus = { $in: ["PENDING_REVIEW", "CHANGES_REQUESTED"] };

  // Simple cursor pagination by _id
  if (cursor && mongoose.Types.ObjectId.isValid(String(cursor))) {
    filter._id = { $lt: new mongoose.Types.ObjectId(String(cursor)) };
  }

  const events = await Event.find(filter).sort({ createdAt: -1, _id: -1 }).limit(Math.min(Math.max(parseInt(limit, 10) || 20, 1), 50)).populate("proposingOrganizationId", "name slug logoUrl logo category affiliationStatus").populate("createdBy", "firstName lastName username").lean();
  return events;
}

async function getMyProposals({ clubId, actor }) {
  if (!mongoose.Types.ObjectId.isValid(String(clubId))) throw Object.assign(new Error("Invalid club id"), { status: 400 });
  const club = await Organization.findById(clubId).select("_id createdBy managers").lean();
  if (!club) throw Object.assign(new Error("Club not found"), { status: 404 });
  if (!(await canManageClub(actor, club))) throw Object.assign(new Error("You can't view this club's proposals"), { status: 403 });

  const events = await Event.find({ proposingOrganizationId: club._id }).sort({ createdAt: -1 }).populate("parentInstitutionId", "name slug logoUrl").lean();
  return events;
}

module.exports = {
  createProposal,
  approveEvent,
  rejectEvent,
  requestChanges,
  resubmitEvent,
  handleUpdateAfterApproval,
  cancelEvent,
  getApprovalQueue,
  getMyProposals,
  canManageClub,
  canManageInstitution,
  detectMaterialChanges,
};
