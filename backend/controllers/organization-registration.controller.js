"use strict";

const mongoose = require("mongoose");
const {
  OrganizationRegistrationRequest,
  REQUEST_CATEGORIES,
  REQUEST_STATUSES,
} = require("../models/organizationRegistrationRequest.model");
const Organization = require("../models/organization.model");
const {
  validateRequestPayload,
  checkDuplicateRequests,
  buildReviewHistoryEntry,
  approveRequest,
  rejectRequest,
  requestMoreInfo,
  slugify,
} = require("../services/organization-registration.service");
const urlSafety = require("../services/url-safety.service");
const { parseLimit, isCursorRequest, withCursor, buildPage } = require("../repositories/cursor");
const { ERROR_CODES } = require("../utils/app-error");

function validObjectId(id) {
  return mongoose.Types.ObjectId.isValid(String(id || ""));
}

function errBody(code, message) {
  return { success: false, message, error: { code, message } };
}

function normalizeUrl(value) {
  if (!value) return "";
  const res = urlSafety.validateExternalUrl(value);
  return res.ok ? res.url : "";
}

// Applicant: Create request
exports.createRequest = async (req, res, next) => {
  try {
    const body = req.body || {};

    // Enforce applicant identity from auth, not body
    const applicantId = req.user.id;

    // Idempotency key handling
    const idempotencyKey = String(req.get("idempotency-key") || body.idempotencyKey || body.clientRequestId || "").trim();
    if (idempotencyKey) {
      const existing = await OrganizationRegistrationRequest.findOne({
        idempotencyKey,
        applicant: applicantId,
      }).lean();
      if (existing) {
        return res.status(200).json({ success: true, request: existing, deduped: true });
      }
    }

    const errors = validateRequestPayload(body, { isUpdate: false });
    if (errors.length) {
      return res.status(400).json(errBody(ERROR_CODES.VALIDATION_ERROR, errors[0]));
    }

    // Duplicate check
    const dup = await checkDuplicateRequests(applicantId, body);
    if (dup) {
      return res.status(409).json(errBody(ERROR_CODES.CONFLICT, dup.reason));
    }

    // Normalize URLs
    const website = normalizeUrl(body.website);
    const evidenceOfficialWebsite = normalizeUrl(body.evidence?.officialWebsite);
    const collegeListing = normalizeUrl(body.evidence?.collegeWebsiteListingUrl);

    // Validate parent org if provided
    let parentOrgId = null;
    if (body.parentOrganizationId) {
      if (!validObjectId(body.parentOrganizationId)) {
        return res.status(400).json(errBody(ERROR_CODES.VALIDATION_ERROR, "Invalid parentOrganizationId"));
      }
      const parent = await Organization.findById(body.parentOrganizationId).lean();
      if (!parent) {
        return res.status(400).json(errBody(ERROR_CODES.VALIDATION_ERROR, "Parent institution not found"));
      }
      if (parent.status !== "APPROVED") {
        return res.status(400).json(errBody(ERROR_CODES.VALIDATION_ERROR, "Parent institution not approved"));
      }
      parentOrgId = parent._id;
    }

    const isDraft = body.status === "DRAFT" || body.draft === true;
    const status = isDraft ? "DRAFT" : "PENDING_REVIEW";

    const proposedSlug = body.proposedSlug ? slugify(body.proposedSlug) : slugify(body.proposedName);

    const doc = {
      applicant: applicantId,
      category: body.category,
      proposedName: String(body.proposedName).trim(),
      proposedSlug: proposedSlug,
      description: String(body.description || "").slice(0, 1000),
      website,
      email: String(body.email || "").trim().toLowerCase(),
      phone: String(body.phone || "").trim(),
      socialLinks: body.socialLinks || {},
      addressLine: String(body.addressLine || body.address || "").slice(0, 300),
      city: String(body.city || "").slice(0, 120),
      state: String(body.state || "").slice(0, 120),
      country: String(body.country || "").slice(0, 120),
      postalCode: String(body.postalCode || "").slice(0, 32),
      latitude: body.latitude !== undefined && body.latitude !== "" ? Number(body.latitude) : null,
      longitude: body.longitude !== undefined && body.longitude !== "" ? Number(body.longitude) : null,
      logoUrl: String(body.logoUrl || ""),
      logoPublicId: String(body.logoPublicId || ""),
      coverUrl: String(body.coverUrl || ""),
      coverPublicId: String(body.coverPublicId || ""),
      evidence: {
        officialWebsite: evidenceOfficialWebsite,
        officialEmail: String(body.evidence?.officialEmail || "").trim(),
        authorizationLetterUrl: String(body.evidence?.authorizationLetterUrl || ""),
        authorizationLetterPublicId: String(body.evidence?.authorizationLetterPublicId || ""),
        registrationCertificateUrl: String(body.evidence?.registrationCertificateUrl || ""),
        registrationCertificatePublicId: String(body.evidence?.registrationCertificatePublicId || ""),
        affiliationLetterUrl: String(body.evidence?.affiliationLetterUrl || ""),
        affiliationLetterPublicId: String(body.evidence?.affiliationLetterPublicId || ""),
        collegeWebsiteListingUrl: collegeListing,
        otherEvidenceUrls: Array.isArray(body.evidence?.otherEvidenceUrls) ? body.evidence.otherEvidenceUrls.slice(0, 10) : [],
        otherEvidencePublicIds: Array.isArray(body.evidence?.otherEvidencePublicIds) ? body.evidence.otherEvidencePublicIds.slice(0, 10) : [],
        notes: String(body.evidence?.notes || "").slice(0, 2000),
      },
      parentOrganizationId: parentOrgId,
      proposedParent: body.proposedParent
        ? {
            name: String(body.proposedParent.name || "").slice(0, 120),
            website: normalizeUrl(body.proposedParent.website),
            email: String(body.proposedParent.email || "").trim(),
            city: String(body.proposedParent.city || "").slice(0, 120),
            country: String(body.proposedParent.country || "").slice(0, 120),
            description: String(body.proposedParent.description || "").slice(0, 500),
          }
        : {},
      applicantRole: String(body.applicantRole || "").slice(0, 120),
      designation: String(body.designation || "").slice(0, 120),
      status,
      ...(idempotencyKey ? { idempotencyKey } : {}),
      declarationAccepted: Boolean(body.declarationAccepted),
      declarationAcceptedAt: body.declarationAccepted ? new Date() : null,
      submittedAt: status === "PENDING_REVIEW" ? new Date() : null,
      lastUpdatedByApplicantAt: new Date(),
      reviewHistory: [
        buildReviewHistoryEntry({
          action: status === "DRAFT" ? "CREATED" : "SUBMITTED",
          actor: applicantId,
          actorRole: "APPLICANT",
          message: status === "DRAFT" ? "Draft created" : "Submitted for review",
          fromStatus: "",
          toStatus: status,
        }),
      ],
    };

    const created = await OrganizationRegistrationRequest.create(doc);
    return res.status(201).json({ success: true, request: created });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json(errBody(ERROR_CODES.CONFLICT, "Duplicate request - already submitted"));
    }
    return next(error);
  }
};

// Applicant: List my requests
exports.listMyRequests = async (req, res, next) => {
  try {
    const limit = parseLimit(req.query.limit, { def: 20, max: 50 });
    const query = { applicant: req.user.id };
    if (req.query.status && REQUEST_STATUSES.includes(req.query.status)) {
      query.status = req.query.status;
    }
    if (req.query.category && REQUEST_CATEGORIES.includes(req.query.category)) {
      query.category = req.query.category;
    }

    const sort = { createdAt: -1, _id: -1 };
    let requests;
    let legacyPagination = null;
    let cursorPage = null;

    if (isCursorRequest(req.query)) {
      const rows = await OrganizationRegistrationRequest.find(withCursor(query, req.query.cursor))
        .sort(sort)
        .limit(limit + 1)
        .lean();
      cursorPage = buildPage(rows, limit);
      requests = cursorPage.items;
    } else {
      const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
      const [rows, total] = await Promise.all([
        OrganizationRegistrationRequest.find(query).sort(sort).skip((page - 1) * limit).limit(limit).lean(),
        OrganizationRegistrationRequest.countDocuments(query),
      ]);
      requests = rows;
      legacyPagination = { page, limit, total, pages: Math.ceil(total / limit) };
    }

    return res.json({
      success: true,
      requests,
      ...(legacyPagination ? { pagination: legacyPagination } : { limit, nextCursor: cursorPage.nextCursor, hasMore: cursorPage.hasMore }),
    });
  } catch (error) {
    return next(error);
  }
};

// Applicant: Get one own request
exports.getMyRequest = async (req, res, next) => {
  try {
    if (!validObjectId(req.params.id)) {
      return res.status(400).json(errBody(ERROR_CODES.VALIDATION_ERROR, "Invalid request id"));
    }
    const request = await OrganizationRegistrationRequest.findById(req.params.id)
      .populate("parentOrganizationId", "name slug category city")
      .populate("resultingOrganizationId", "name slug handle")
      .lean();
    if (!request) return res.status(404).json(errBody(ERROR_CODES.NOT_FOUND, "Request not found"));
    if (String(request.applicant) !== String(req.user.id)) {
      return res.status(403).json(errBody(ERROR_CODES.FORBIDDEN, "You can't view this request"));
    }
    return res.json({ success: true, request });
  } catch (error) {
    return next(error);
  }
};

// Applicant: Update draft or needs_info
exports.updateMyRequest = async (req, res, next) => {
  try {
    if (!validObjectId(req.params.id)) {
      return res.status(400).json(errBody(ERROR_CODES.VALIDATION_ERROR, "Invalid request id"));
    }
    const existing = await OrganizationRegistrationRequest.findById(req.params.id);
    if (!existing) return res.status(404).json(errBody(ERROR_CODES.NOT_FOUND, "Request not found"));
    if (String(existing.applicant) !== String(req.user.id)) {
      return res.status(403).json(errBody(ERROR_CODES.FORBIDDEN, "You can't edit this request"));
    }
    if (!["DRAFT", "NEEDS_INFORMATION"].includes(existing.status)) {
      return res.status(400).json(errBody(ERROR_CODES.VALIDATION_ERROR, `Cannot edit request in status ${existing.status}`));
    }

    const body = req.body || {};
    // Prevent mass assignment of privileged fields
    const forbidden = ["status", "reviewer", "reviewedAt", "resultingOrganizationId", "applicant", "reviewHistory", "resubmissionCount", "version"];
    for (const f of forbidden) delete body[f];

    const errors = validateRequestPayload({ ...existing.toObject(), ...body }, { isUpdate: true });
    if (errors.length) {
      return res.status(400).json(errBody(ERROR_CODES.VALIDATION_ERROR, errors[0]));
    }

    // Apply allowed fields
    const allowed = [
      "category",
      "proposedName",
      "proposedSlug",
      "description",
      "website",
      "email",
      "phone",
      "socialLinks",
      "addressLine",
      "city",
      "state",
      "country",
      "postalCode",
      "latitude",
      "longitude",
      "logoUrl",
      "logoPublicId",
      "coverUrl",
      "coverPublicId",
      "evidence",
      "parentOrganizationId",
      "proposedParent",
      "applicantRole",
      "designation",
    ];
    for (const field of allowed) {
      if (body[field] !== undefined) {
        if (field === "website" || field === "evidence") {
          // handled separately
          continue;
        }
        existing[field] = body[field];
      }
    }
    if (body.website !== undefined) existing.website = normalizeUrl(body.website);
    if (body.evidence) {
      const ev = body.evidence;
      if (ev.officialWebsite !== undefined) existing.evidence.officialWebsite = normalizeUrl(ev.officialWebsite);
      if (ev.collegeWebsiteListingUrl !== undefined) existing.evidence.collegeWebsiteListingUrl = normalizeUrl(ev.collegeWebsiteListingUrl);
      const simpleFields = [
        "officialEmail",
        "authorizationLetterUrl",
        "authorizationLetterPublicId",
        "registrationCertificateUrl",
        "registrationCertificatePublicId",
        "affiliationLetterUrl",
        "affiliationLetterPublicId",
        "notes",
      ];
      for (const f of simpleFields) if (ev[f] !== undefined) existing.evidence[f] = ev[f];
      if (Array.isArray(ev.otherEvidenceUrls)) existing.evidence.otherEvidenceUrls = ev.otherEvidenceUrls.slice(0, 10);
      if (Array.isArray(ev.otherEvidencePublicIds)) existing.evidence.otherEvidencePublicIds = ev.otherEvidencePublicIds.slice(0, 10);
    }
    if (body.parentOrganizationId !== undefined) {
      if (body.parentOrganizationId) {
        if (!validObjectId(body.parentOrganizationId)) {
          return res.status(400).json(errBody(ERROR_CODES.VALIDATION_ERROR, "Invalid parentOrganizationId"));
        }
        const parent = await Organization.findById(body.parentOrganizationId).lean();
        if (!parent) return res.status(400).json(errBody(ERROR_CODES.VALIDATION_ERROR, "Parent not found"));
        existing.parentOrganizationId = parent._id;
      } else {
        existing.parentOrganizationId = null;
      }
    }
    if (body.proposedParent !== undefined) existing.proposedParent = body.proposedParent;
    if (body.proposedName !== undefined) existing.proposedName = String(body.proposedName).trim();
    if (body.proposedSlug !== undefined) existing.proposedSlug = slugify(body.proposedSlug);
    if (body.description !== undefined) existing.description = String(body.description).slice(0, 1000);

    existing.lastUpdatedByApplicantAt = new Date();
    existing.version += 1;
    existing.reviewHistory.push(
      buildReviewHistoryEntry({
        action: "COMMENT",
        actor: req.user.id,
        actorRole: "APPLICANT",
        message: "Updated request details",
        fromStatus: existing.status,
        toStatus: existing.status,
      })
    );

    await existing.save();
    return res.json({ success: true, request: existing });
  } catch (error) {
    return next(error);
  }
};

// Applicant: Submit draft
exports.submitDraft = async (req, res, next) => {
  try {
    if (!validObjectId(req.params.id)) {
      return res.status(400).json(errBody(ERROR_CODES.VALIDATION_ERROR, "Invalid request id"));
    }
    const request = await OrganizationRegistrationRequest.findById(req.params.id);
    if (!request) return res.status(404).json(errBody(ERROR_CODES.NOT_FOUND, "Request not found"));
    if (String(request.applicant) !== String(req.user.id)) {
      return res.status(403).json(errBody(ERROR_CODES.FORBIDDEN, "You can't submit this request"));
    }
    if (request.status !== "DRAFT") {
      return res.status(400).json(errBody(ERROR_CODES.VALIDATION_ERROR, `Cannot submit from status ${request.status}`));
    }
    const errors = validateRequestPayload(request.toObject(), { isUpdate: false });
    // Remove declaration error if already accepted earlier? Re-validate
    if (errors.length && !errors.every((e) => e.includes("declarationAccepted"))) {
      return res.status(400).json(errBody(ERROR_CODES.VALIDATION_ERROR, errors[0]));
    }
    if (!request.declarationAccepted) {
      return res.status(400).json(errBody(ERROR_CODES.VALIDATION_ERROR, "Declaration must be accepted"));
    }

    const dup = await checkDuplicateRequests(req.user.id, request.toObject(), { excludeRequestId: request._id });
    if (dup) return res.status(409).json(errBody(ERROR_CODES.CONFLICT, dup.reason));

    const from = request.status;
    request.status = "PENDING_REVIEW";
    request.submittedAt = new Date();
    request.lastUpdatedByApplicantAt = new Date();
    request.version += 1;
    request.reviewHistory.push(
      buildReviewHistoryEntry({
        action: "SUBMITTED",
        actor: req.user.id,
        actorRole: "APPLICANT",
        message: "Submitted for review",
        fromStatus: from,
        toStatus: "PENDING_REVIEW",
      })
    );
    await request.save();
    return res.json({ success: true, request });
  } catch (error) {
    return next(error);
  }
};

// Applicant: Withdraw
exports.withdrawRequest = async (req, res, next) => {
  try {
    if (!validObjectId(req.params.id)) {
      return res.status(400).json(errBody(ERROR_CODES.VALIDATION_ERROR, "Invalid request id"));
    }
    const request = await OrganizationRegistrationRequest.findById(req.params.id);
    if (!request) return res.status(404).json(errBody(ERROR_CODES.NOT_FOUND, "Request not found"));
    if (String(request.applicant) !== String(req.user.id)) {
      return res.status(403).json(errBody(ERROR_CODES.FORBIDDEN, "You can't withdraw this request"));
    }
    if (!["DRAFT", "PENDING_REVIEW", "NEEDS_INFORMATION"].includes(request.status)) {
      return res.status(400).json(errBody(ERROR_CODES.VALIDATION_ERROR, `Cannot withdraw from status ${request.status}`));
    }
    const from = request.status;
    request.status = "WITHDRAWN";
    request.version += 1;
    request.reviewHistory.push(
      buildReviewHistoryEntry({
        action: "WITHDRAWN",
        actor: req.user.id,
        actorRole: "APPLICANT",
        message: "Withdrawn by applicant",
        fromStatus: from,
        toStatus: "WITHDRAWN",
      })
    );
    await request.save();
    return res.json({ success: true, request });
  } catch (error) {
    return next(error);
  }
};

// Applicant: Resubmit after needs_info or rejected
exports.resubmitRequest = async (req, res, next) => {
  try {
    if (!validObjectId(req.params.id)) {
      return res.status(400).json(errBody(ERROR_CODES.VALIDATION_ERROR, "Invalid request id"));
    }
    const request = await OrganizationRegistrationRequest.findById(req.params.id);
    if (!request) return res.status(404).json(errBody(ERROR_CODES.NOT_FOUND, "Request not found"));
    if (String(request.applicant) !== String(req.user.id)) {
      return res.status(403).json(errBody(ERROR_CODES.FORBIDDEN, "You can't resubmit this request"));
    }
    if (!["NEEDS_INFORMATION", "REJECTED"].includes(request.status)) {
      return res.status(400).json(errBody(ERROR_CODES.VALIDATION_ERROR, `Cannot resubmit from status ${request.status}`));
    }

    // Allow updating fields in resubmit payload
    const body = req.body || {};
    const forbidden = ["status", "reviewer", "resultingOrganizationId", "applicant", "reviewHistory"];
    for (const f of forbidden) delete body[f];
    if (Object.keys(body).length) {
      // Apply updates similar to updateMyRequest (simplified)
      if (body.proposedName) request.proposedName = String(body.proposedName).trim();
      if (body.description) request.description = String(body.description).slice(0, 1000);
      if (body.website) request.website = normalizeUrl(body.website);
      if (body.evidence) {
        if (body.evidence.officialWebsite) request.evidence.officialWebsite = normalizeUrl(body.evidence.officialWebsite);
        // copy other evidence fields
        for (const k of Object.keys(body.evidence)) {
          if (k !== "officialWebsite" && request.evidence[k] !== undefined) {
            request.evidence[k] = body.evidence[k];
          }
        }
      }
      if (body.parentOrganizationId !== undefined) {
        if (body.parentOrganizationId && validObjectId(body.parentOrganizationId)) {
          request.parentOrganizationId = body.parentOrganizationId;
        } else if (!body.parentOrganizationId) {
          request.parentOrganizationId = null;
        }
      }
      if (body.proposedParent) request.proposedParent = body.proposedParent;
    }

    const errors = validateRequestPayload(request.toObject(), { isUpdate: true });
    if (errors.length) return res.status(400).json(errBody(ERROR_CODES.VALIDATION_ERROR, errors[0]));

    const from = request.status;
    request.status = "PENDING_REVIEW";
    request.infoRequestMessage = "";
    request.rejectionReason = "";
    request.resubmissionCount += 1;
    request.lastUpdatedByApplicantAt = new Date();
    request.submittedAt = new Date();
    request.version += 1;
    request.reviewHistory.push(
      buildReviewHistoryEntry({
        action: "RESUBMITTED",
        actor: req.user.id,
        actorRole: "APPLICANT",
        message: "Resubmitted after review",
        fromStatus: from,
        toStatus: "PENDING_REVIEW",
      })
    );
    await request.save();
    return res.json({ success: true, request });
  } catch (error) {
    return next(error);
  }
};

// Super Admin: List all requests
exports.listAllRequests = async (req, res, next) => {
  try {
    const limit = parseLimit(req.query.limit, { def: 20, max: 50 });
    const query = {};

    if (req.query.status && REQUEST_STATUSES.includes(req.query.status)) query.status = req.query.status;
    if (req.query.category && REQUEST_CATEGORIES.includes(req.query.category)) query.category = req.query.category;
    if (req.query.applicant && validObjectId(req.query.applicant)) query.applicant = req.query.applicant;
    if (req.query.parentOrganizationId && validObjectId(req.query.parentOrganizationId))
      query.parentOrganizationId = req.query.parentOrganizationId;

    if (req.query.search && String(req.query.search).trim()) {
      const escaped = String(req.query.search).trim().replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&");
      query.$or = [
        { proposedName: { $regex: escaped, $options: "i" } },
        { description: { $regex: escaped, $options: "i" } },
        { city: { $regex: escaped, $options: "i" } },
      ];
    }

    const sort = { createdAt: -1, _id: -1 };
    let requests;
    let pagination = null;
    let cursorPage = null;

    if (isCursorRequest(req.query)) {
      const rows = await OrganizationRegistrationRequest.find(withCursor(query, req.query.cursor))
        .populate("applicant", "firstName lastName username email")
        .populate("parentOrganizationId", "name slug category")
        .populate("resultingOrganizationId", "name slug")
        .sort(sort)
        .limit(limit + 1)
        .lean();
      cursorPage = buildPage(rows, limit);
      requests = cursorPage.items;
    } else {
      const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
      const [rows, total] = await Promise.all([
        OrganizationRegistrationRequest.find(query)
          .populate("applicant", "firstName lastName username email")
          .populate("parentOrganizationId", "name slug category")
          .populate("resultingOrganizationId", "name slug")
          .sort(sort)
          .skip((page - 1) * limit)
          .limit(limit)
          .lean(),
        OrganizationRegistrationRequest.countDocuments(query),
      ]);
      requests = rows;
      pagination = { page, limit, total, pages: Math.ceil(total / limit) };
    }

    // Counts for dashboard
    const counts = await OrganizationRegistrationRequest.aggregate([
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]);
    const countsMap = {};
    counts.forEach((c) => (countsMap[c._id] = c.count));

    return res.json({
      success: true,
      requests,
      counts: countsMap,
      ...(pagination ? { pagination } : { limit, nextCursor: cursorPage.nextCursor, hasMore: cursorPage.hasMore }),
    });
  } catch (error) {
    return next(error);
  }
};

// Super Admin: Get one request detail
exports.getRequestDetail = async (req, res, next) => {
  try {
    if (!validObjectId(req.params.id)) {
      return res.status(400).json(errBody(ERROR_CODES.VALIDATION_ERROR, "Invalid request id"));
    }
    const request = await OrganizationRegistrationRequest.findById(req.params.id)
      .populate("applicant", "firstName lastName username email profile")
      .populate("parentOrganizationId", "name slug category city verificationStatus")
      .populate("resultingOrganizationId", "name slug handle category")
      .populate("reviewer", "firstName lastName username email")
      .lean();
    if (!request) return res.status(404).json(errBody(ERROR_CODES.NOT_FOUND, "Request not found"));

    // Check for potential duplicates for reviewer convenience
    const potentialDuplicates = await Organization.find({
      name: { $regex: `^${String(request.proposedName).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" },
    })
      .select("name slug city category status")
      .limit(5)
      .lean();

    return res.json({ success: true, request, potentialDuplicates });
  } catch (error) {
    return next(error);
  }
};

// Super Admin: Approve
exports.approve = async (req, res, next) => {
  try {
    if (!validObjectId(req.params.id)) {
      return res.status(400).json(errBody(ERROR_CODES.VALIDATION_ERROR, "Invalid request id"));
    }
    const idempotencyKey = String(req.get("idempotency-key") || req.body?.idempotencyKey || "").trim() || null;
    const result = await approveRequest({ requestId: req.params.id, reviewer: req.user, idempotencyKey });
    return res.json({ success: true, organization: result.organization, request: result.request });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json(errBody(error.code || ERROR_CODES.INTERNAL_ERROR, error.message));
    }
    return next(error);
  }
};

// Super Admin: Reject
exports.reject = async (req, res, next) => {
  try {
    if (!validObjectId(req.params.id)) {
      return res.status(400).json(errBody(ERROR_CODES.VALIDATION_ERROR, "Invalid request id"));
    }
    const reason = String(req.body?.reason || req.body?.rejectionReason || "").trim();
    const request = await rejectRequest({ requestId: req.params.id, reviewer: req.user, reason });
    return res.json({ success: true, request });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json(errBody(error.code || ERROR_CODES.INTERNAL_ERROR, error.message));
    }
    return next(error);
  }
};

// Super Admin: Request more info
exports.requestInfo = async (req, res, next) => {
  try {
    if (!validObjectId(req.params.id)) {
      return res.status(400).json(errBody(ERROR_CODES.VALIDATION_ERROR, "Invalid request id"));
    }
    const message = String(req.body?.message || req.body?.infoRequestMessage || "").trim();
    const request = await requestMoreInfo({ requestId: req.params.id, reviewer: req.user, message });
    return res.json({ success: true, request });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json(errBody(error.code || ERROR_CODES.INTERNAL_ERROR, error.message));
    }
    return next(error);
  }
};

// Super Admin: History
exports.getHistory = async (req, res, next) => {
  try {
    if (!validObjectId(req.params.id)) {
      return res.status(400).json(errBody(ERROR_CODES.VALIDATION_ERROR, "Invalid request id"));
    }
    const request = await OrganizationRegistrationRequest.findById(req.params.id)
      .select("reviewHistory proposedName status")
      .populate("reviewHistory.actor", "firstName lastName username")
      .lean();
    if (!request) return res.status(404).json(errBody(ERROR_CODES.NOT_FOUND, "Request not found"));
    return res.json({ success: true, history: request.reviewHistory });
  } catch (error) {
    return next(error);
  }
};

// List approved parent institutions for club registration
exports.listParentInstitutions = async (req, res, next) => {
  try {
    const limit = parseLimit(req.query.limit, { def: 50, max: 100 });
    const query = {
      category: { $in: ["COLLEGE", "UNIVERSITY", "SCHOOL", "INSTITUTE"] },
      status: "APPROVED",
    };
    if (req.query.search && String(req.query.search).trim()) {
      const escaped = String(req.query.search).trim().replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&");
      query.$or = [
        { name: { $regex: escaped, $options: "i" } },
        { city: { $regex: escaped, $options: "i" } },
        { slug: { $regex: escaped, $options: "i" } },
      ];
    }
    const orgs = await Organization.find(query).select("name slug city category").sort({ name: 1 }).limit(limit).lean();
    return res.json({ success: true, organizations: orgs });
  } catch (error) {
    return next(error);
  }
};
