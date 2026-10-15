"use strict";

const mongoose = require("mongoose");
const {
  OrganizationRegistrationRequest,
  REQUEST_CATEGORIES,
  REQUEST_STATUSES,
} = require("../models/organizationRegistrationRequest.model");
const Organization = require("../models/organization.model");
const OrganizationMembership = require("../models/organizationMembership.model");
const User = require("../models/user.model");
const { ORGANIZATION_CATEGORIES, ORGANIZATION_PARENT_LINKS } = require("../config/organization");
const urlSafety = require("./url-safety.service");
const { EventRepository } = require("../repositories/event.repository");
const { ValidationError, NotFoundError } = require("../utils/app-error");

const MAX_SLUG_LEN = 60;
const slugify = (s) =>
  String(s || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, MAX_SLUG_LEN);

const CATEGORY_TO_ORG_CATEGORY = Object.freeze({
  COLLEGE: "COLLEGE",
  UNIVERSITY: "UNIVERSITY",
  AFFILIATED_CLUB: "COLLEGE_CLUB",
});

const VALID_TRANSITIONS = Object.freeze({
  DRAFT: ["PENDING_REVIEW", "WITHDRAWN"],
  PENDING_REVIEW: ["NEEDS_INFORMATION", "APPROVED", "REJECTED", "WITHDRAWN"],
  NEEDS_INFORMATION: ["PENDING_REVIEW", "WITHDRAWN"],
  APPROVED: [],
  REJECTED: ["PENDING_REVIEW"], // resubmit after rejection goes to PENDING_REVIEW via resubmit flow, but allow if policy permits
  WITHDRAWN: [],
});

function canTransition(from, to) {
  if (from === to) return false;
  const allowed = VALID_TRANSITIONS[from] || [];
  return allowed.includes(to);
}

function normalizeUrlField(value, fieldName) {
  if (value === undefined || value === null || String(value).trim() === "") return { ok: true, url: "" };
  const result = urlSafety.validateExternalUrl(value, { field: fieldName });
  if (!result.ok) return { ok: false, reason: result.reason };
  return { ok: true, url: result.url };
}

function validateRequestPayload(body, { isUpdate = false } = {}) {
  const errors = [];

  if (!isUpdate || body.category !== undefined) {
    if (!REQUEST_CATEGORIES.includes(body.category)) {
      errors.push(`category must be one of ${REQUEST_CATEGORIES.join(", ")}`);
    }
  }

  if (!isUpdate || body.proposedName !== undefined) {
    const name = String(body.proposedName || "").trim();
    if (!name) errors.push("proposedName is required");
    else if (name.length > 120) errors.push("proposedName must be 120 characters or fewer");
    else if (name.length < 3) errors.push("proposedName must be at least 3 characters");
  }

  if (body.description !== undefined) {
    if (String(body.description).length > 1000) errors.push("description must be 1000 characters or fewer");
  }

  // URL validations
  const urlFields = ["website", "evidence.officialWebsite", "evidence.collegeWebsiteListingUrl"];
  for (const field of urlFields) {
    const parts = field.split(".");
    let value = body;
    for (const p of parts) value = value?.[p];
    if (value !== undefined) {
      const res = normalizeUrlField(value, field);
      if (!res.ok) errors.push(res.reason);
    }
  }

  // Email validations
  if (body.email !== undefined && body.email) {
    const email = String(body.email).trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push("email must be a valid email");
  }
  if (body.evidence?.officialEmail !== undefined && body.evidence.officialEmail) {
    const email = String(body.evidence.officialEmail).trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push("evidence.officialEmail must be a valid email");
  }

  // Coordinates
  if (body.latitude !== undefined && body.latitude !== null && body.latitude !== "") {
    const lat = Number(body.latitude);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) errors.push("latitude must be between -90 and 90");
  }
  if (body.longitude !== undefined && body.longitude !== null && body.longitude !== "") {
    const lng = Number(body.longitude);
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) errors.push("longitude must be between -180 and 180");
  }

  // Applicant role
  if (body.applicantRole !== undefined && String(body.applicantRole).length > 120) {
    errors.push("applicantRole must be 120 characters or fewer");
  }
  if (body.designation !== undefined && String(body.designation).length > 120) {
    errors.push("designation must be 120 characters or fewer");
  }

  // Parent institution for affiliated club
  if (body.category === "AFFILIATED_CLUB" || body.parentOrganizationId || body.proposedParent) {
    if (body.category === "AFFILIATED_CLUB") {
      const hasParent = body.parentOrganizationId || (body.proposedParent && body.proposedParent.name);
      if (!isUpdate && !hasParent) {
        errors.push("AFFILIATED_CLUB requires parentOrganizationId or proposedParent.name");
      }
    }
  }

  // Declaration
  if (!isUpdate && body.declarationAccepted !== true) {
    errors.push("declarationAccepted must be true");
  }

  return errors;
}

async function checkDuplicateRequests(applicantId, payload, { excludeRequestId = null } = {}) {
  const { proposedName, city, category, proposedSlug } = payload;
  const trimmedName = String(proposedName || "").trim();
  if (!trimmedName) return null;

  // Same applicant same name pending
  const sameApplicantQuery = {
    applicant: applicantId,
    proposedName: { $regex: `^${trimmedName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" },
    status: { $in: ["DRAFT", "PENDING_REVIEW", "NEEDS_INFORMATION"] },
  };
  if (excludeRequestId) sameApplicantQuery._id = { $ne: excludeRequestId };
  const existingSame = await OrganizationRegistrationRequest.findOne(sameApplicantQuery).lean();
  if (existingSame) {
    return {
      reason: "You already have a pending request for this organization name",
      code: "CONFLICT",
    };
  }

  // Slug conflict with existing org
  if (proposedSlug) {
    const slug = slugify(proposedSlug);
    if (slug) {
      const orgExists = await Organization.exists({ slug });
      if (orgExists) {
        return { reason: `An organization with slug '${slug}' already exists`, code: "CONFLICT" };
      }
    }
  }

  // Existing org same name+city (potential duplicate, but not hard reject - just warning, but for approval we check)
  // For creation, we allow similar names but flag for reviewer; duplicate prevention is soft except for same applicant.

  return null;
}

async function generateUniqueOrgSlug(baseName, proposedSlug) {
  const base = slugify(proposedSlug || baseName) || "org";
  let slug = base.slice(0, MAX_SLUG_LEN);
  let suffix = 1;
  while (await Organization.exists({ slug })) {
    const suffixStr = `-${suffix}`;
    slug = `${base.slice(0, MAX_SLUG_LEN - suffixStr.length)}${suffixStr}`;
    suffix += 1;
    if (suffix > 100) break; // safety
  }
  return slug;
}

function buildReviewHistoryEntry({ action, actor, actorRole, message, fromStatus, toStatus, metadata }) {
  return {
    action,
    actor: actor?._id || actor?.id || actor || null,
    actorRole,
    message: String(message || "").slice(0, 1000),
    fromStatus: fromStatus || "",
    toStatus: toStatus || "",
    metadata: metadata || null,
    createdAt: new Date(),
  };
}

// Approval service - atomic and idempotent
async function approveRequest({ requestId, reviewer, idempotencyKey = null }) {
  if (!mongoose.Types.ObjectId.isValid(String(requestId))) {
    throw new ValidationError("Invalid request id");
  }

  // Early fetch outside transaction for fast fail and to handle idempotent APPROVED case
  const earlyRequest = await OrganizationRegistrationRequest.findById(requestId);
  if (!earlyRequest) {
    throw new NotFoundError("Request not found");
  }
  if (earlyRequest.status === "APPROVED" && earlyRequest.resultingOrganizationId) {
    const existingOrg = await Organization.findById(earlyRequest.resultingOrganizationId);
    if (existingOrg) {
      return { organization: existingOrg, request: earlyRequest };
    }
  }
  if (!["PENDING_REVIEW", "NEEDS_INFORMATION", "APPROVED"].includes(earlyRequest.status)) {
    throw new ValidationError(`Cannot approve request in status ${earlyRequest.status}`);
  }

  const session = await mongoose.startSession();
  let resultOrg = null;
  let finalRequest = null;

  try {
    await session.withTransaction(async () => {
      // 1. Fetch request with lock (findOneAndUpdate to claim)
      const request = await OrganizationRegistrationRequest.findById(requestId).session(session);
      if (!request) {
        throw new NotFoundError("Request not found");
      }

      // Idempotency: if already approved and has resulting org, return existing
      if (request.status === "APPROVED" && request.resultingOrganizationId) {
        const existingOrg = await Organization.findById(request.resultingOrganizationId).session(session);
        if (existingOrg) {
          resultOrg = existingOrg;
          finalRequest = request;
          return;
        }
      }

      if (!["PENDING_REVIEW", "NEEDS_INFORMATION"].includes(request.status)) {
        // Allow APPROVED idempotent, but reject others
        if (request.status !== "APPROVED") {
          throw new ValidationError(`Cannot approve request in status ${request.status}`);
        }
      }

      // 2. Validate applicant still exists
      const applicant = await User.findById(request.applicant).session(session);
      if (!applicant) {
        throw new ValidationError("Applicant no longer exists");
      }

      // 3. Validate parent institution for affiliated club
      if (request.category === "AFFILIATED_CLUB") {
        if (request.parentOrganizationId) {
          const parentOrg = await Organization.findById(request.parentOrganizationId).session(session);
          if (!parentOrg) {
            throw new ValidationError("Parent institution not found");
          }
          if (!["COLLEGE", "UNIVERSITY", "SCHOOL", "INSTITUTE"].includes(parentOrg.category)) {
            throw new ValidationError("Parent must be a COLLEGE, UNIVERSITY, SCHOOL or INSTITUTE");
          }
          if (parentOrg.status !== "APPROVED") {
            throw new ValidationError("Parent institution is not approved");
          }
        } else if (request.proposedParent && request.proposedParent.name) {
          // If proposed parent, we should not auto-create parent here; require manual review or create parent as separate org?
          // For now, we will create parent org as well if proposedParent provided and no existing parent.
          // But to avoid duplicate parent creation, check if org with same name exists
          const parentName = String(request.proposedParent.name).trim();
          let parentOrg = await Organization.findOne({
            name: { $regex: `^${parentName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" },
          }).session(session);
          if (!parentOrg) {
            const parentSlug = await generateUniqueOrgSlug(parentName, "");
            parentOrg = await Organization.create(
              [
                {
                  name: parentName,
                  slug: parentSlug,
                  handle: parentSlug,
                  description: String(request.proposedParent.description || "").slice(0, 1000),
                  website: String(request.proposedParent.website || ""),
                  email: String(request.proposedParent.email || ""),
                  city: String(request.proposedParent.city || ""),
                  country: String(request.proposedParent.country || ""),
                  category: "COLLEGE", // default for proposed parent
                  status: "APPROVED",
                  verificationStatus: "UNVERIFIED",
                  ownershipStatus: "PERSONAL",
                  createdBy: reviewer._id || reviewer.id,
                },
              ],
              { session }
            ).then((docs) => docs[0]);
          }
          request.parentOrganizationId = parentOrg._id;
        } else {
          throw new ValidationError("Affiliated club requires parent institution");
        }
      }

      // 4. Handle slug conflicts - generate unique
      const finalSlug = await generateUniqueOrgSlug(request.proposedName, request.proposedSlug);

      // 5. Check if organization already created for this request (idempotency via resultingOrganizationId)
      let org = null;
      if (request.resultingOrganizationId) {
        org = await Organization.findById(request.resultingOrganizationId).session(session);
      }

      if (!org) {
        // Check if org with same idempotencyKey or same request link already exists? Use unique slug as guard
        // Create organization
        const orgCategory = CATEGORY_TO_ORG_CATEGORY[request.category] || "OTHER";
        // Ensure category is valid in ORGANIZATION_CATEGORIES
        const validOrgCategory = ORGANIZATION_CATEGORIES.includes(orgCategory) ? orgCategory : "OTHER";

        const orgData = {
          name: String(request.proposedName).trim(),
          slug: finalSlug,
          handle: finalSlug,
          description: String(request.description || "").slice(0, 1000),
          website: String(request.website || ""),
          email: String(request.email || ""),
          phone: String(request.phone || ""),
          socialLinks: request.socialLinks || {},
          address: String(request.addressLine || ""),
          city: String(request.city || ""),
          state: String(request.state || ""),
          country: String(request.country || ""),
          postalCode: String(request.postalCode || ""),
          latitude: request.latitude ?? null,
          longitude: request.longitude ?? null,
          logo: String(request.logoUrl || ""),
          logoUrl: String(request.logoUrl || ""),
          cover: String(request.coverUrl || ""),
          coverUrl: String(request.coverUrl || ""),
          category: validOrgCategory,
          parentOrganizationId: request.parentOrganizationId || null,
          status: "APPROVED",
          verificationStatus: "UNVERIFIED", // approval != verification
          ownershipStatus: "PERSONAL",
          createdBy: request.applicant,
          isVerified: false,
        };

        org = await Organization.create([orgData], { session }).then((docs) => docs[0]);

        // Invalidate caches for org directory
        try {
          const { cache } = require("./cache.service");
          await cache.invalidatePrefix("org:");
          await cache.invalidatePrefix("explore:");
        } catch {}
      }

      resultOrg = org;

      // 6. Create OWNER membership - idempotent via upsert
      await OrganizationMembership.updateOne(
        { organizationId: org._id, userId: request.applicant },
        {
          $set: { role: "OWNER", status: "ACTIVE" },
          $setOnInsert: { joinedAt: new Date() },
        },
        { upsert: true, session }
      );

      // 7. Link request to org and transition to APPROVED
      const fromStatus = request.status;
      request.resultingOrganizationId = org._id;
      request.status = "APPROVED";
      request.reviewer = reviewer._id || reviewer.id;
      request.reviewedAt = new Date();
      request.rejectionReason = "";
      request.infoRequestMessage = "";
      request.version += 1;

      request.reviewHistory.push(
        buildReviewHistoryEntry({
          action: "APPROVED",
          actor: reviewer,
          actorRole: "SUPER_ADMIN",
          message: `Approved and created organization ${org.name}`,
          fromStatus,
          toStatus: "APPROVED",
          metadata: { organizationId: org._id, slug: org.slug },
        })
      );
      request.reviewHistory.push(
        buildReviewHistoryEntry({
          action: "ORG_CREATED",
          actor: reviewer,
          actorRole: "SUPER_ADMIN",
          message: `Organization ${org.name} created`,
          fromStatus: "APPROVED",
          toStatus: "APPROVED",
          metadata: { organizationId: org._id },
        })
      );

      await request.save({ session });
      finalRequest = request;
    });

    // Outside transaction: notifications and cache invalidation
    if (finalRequest && resultOrg) {
      try {
        const { notify } = require("./notification.service");
        await notify({
          user: finalRequest.applicant,
          actor: reviewer._id || reviewer.id,
          type: "organization_request_approved",
          organization: resultOrg._id,
        });
      } catch {}
      try {
        await EventRepository.invalidate({ _id: resultOrg._id, slug: resultOrg.slug });
      } catch {}
    }

    return { organization: resultOrg, request: finalRequest };
  } finally {
    await session.endSession();
  }
}

async function rejectRequest({ requestId, reviewer, reason }) {
  if (!reason || String(reason).trim().length < 5) {
    throw new ValidationError("Rejection reason is required (min 5 chars)");
  }
  const request = await OrganizationRegistrationRequest.findById(requestId);
  if (!request) throw new NotFoundError("Request not found");
  if (!["PENDING_REVIEW", "NEEDS_INFORMATION"].includes(request.status)) {
    throw new ValidationError(`Cannot reject request in status ${request.status}`);
  }
  const fromStatus = request.status;
  request.status = "REJECTED";
  request.rejectionReason = String(reason).slice(0, 1000);
  request.infoRequestMessage = "";
  request.reviewer = reviewer._id || reviewer.id;
  request.reviewedAt = new Date();
  request.version += 1;
  request.reviewHistory.push(
    buildReviewHistoryEntry({
      action: "REJECTED",
      actor: reviewer,
      actorRole: "SUPER_ADMIN",
      message: reason,
      fromStatus,
      toStatus: "REJECTED",
    })
  );
  await request.save();

  try {
    const { notify } = require("./notification.service");
    await notify({
      user: request.applicant,
      actor: reviewer._id || reviewer.id,
      type: "organization_request_rejected",
      organization: request.resultingOrganizationId || undefined,
    });
  } catch {}

  return request;
}

async function requestMoreInfo({ requestId, reviewer, message }) {
  if (!message || String(message).trim().length < 5) {
    throw new ValidationError("Information request message is required (min 5 chars)");
  }
  const request = await OrganizationRegistrationRequest.findById(requestId);
  if (!request) throw new NotFoundError("Request not found");
  if (request.status !== "PENDING_REVIEW") {
    throw new ValidationError(`Cannot request info in status ${request.status}`);
  }
  const fromStatus = request.status;
  request.status = "NEEDS_INFORMATION";
  request.infoRequestMessage = String(message).slice(0, 1000);
  request.reviewer = reviewer._id || reviewer.id;
  request.reviewedAt = new Date();
  request.version += 1;
  request.reviewHistory.push(
    buildReviewHistoryEntry({
      action: "NEEDS_INFORMATION",
      actor: reviewer,
      actorRole: "SUPER_ADMIN",
      message,
      fromStatus,
      toStatus: "NEEDS_INFORMATION",
    })
  );
  await request.save();

  try {
    const { notify } = require("./notification.service");
    await notify({
      user: request.applicant,
      actor: reviewer._id || reviewer.id,
      type: "organization_request_needs_info",
    });
  } catch {}

  return request;
}

module.exports = {
  REQUEST_CATEGORIES,
  REQUEST_STATUSES,
  CATEGORY_TO_ORG_CATEGORY,
  VALID_TRANSITIONS,
  canTransition,
  validateRequestPayload,
  checkDuplicateRequests,
  generateUniqueOrgSlug,
  buildReviewHistoryEntry,
  approveRequest,
  rejectRequest,
  requestMoreInfo,
  slugify,
};
