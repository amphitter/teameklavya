const mongoose = require("mongoose");

const REQUEST_CATEGORIES = Object.freeze(["COLLEGE", "UNIVERSITY", "AFFILIATED_CLUB"]);
const REQUEST_STATUSES = Object.freeze([
  "DRAFT",
  "PENDING_REVIEW",
  "NEEDS_INFORMATION",
  "APPROVED",
  "REJECTED",
  "WITHDRAWN",
]);

const reviewHistorySchema = new mongoose.Schema(
  {
    action: {
      type: String,
      enum: [
        "CREATED",
        "SUBMITTED",
        "RESUBMITTED",
        "NEEDS_INFORMATION",
        "APPROVED",
        "REJECTED",
        "WITHDRAWN",
        "COMMENT",
        "ORG_CREATED",
        "ORG_LINKED",
      ],
      required: true,
    },
    actor: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    actorRole: { type: String, enum: ["APPLICANT", "SUPER_ADMIN", "SYSTEM"], default: "APPLICANT" },
    message: { type: String, default: "" },
    fromStatus: { type: String, default: "" },
    toStatus: { type: String, default: "" },
    metadata: { type: mongoose.Schema.Types.Mixed, default: null },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const evidenceSchema = new mongoose.Schema(
  {
    officialWebsite: { type: String, default: "" },
    officialEmail: { type: String, default: "" },
    authorizationLetterUrl: { type: String, default: "" },
    authorizationLetterPublicId: { type: String, default: "" },
    registrationCertificateUrl: { type: String, default: "" },
    registrationCertificatePublicId: { type: String, default: "" },
    affiliationLetterUrl: { type: String, default: "" },
    affiliationLetterPublicId: { type: String, default: "" },
    collegeWebsiteListingUrl: { type: String, default: "" },
    otherEvidenceUrls: { type: [String], default: [] },
    otherEvidencePublicIds: { type: [String], default: [] },
    notes: { type: String, default: "", maxlength: 2000 },
  },
  { _id: false }
);

const proposedParentSchema = new mongoose.Schema(
  {
    name: { type: String, default: "", maxlength: 120 },
    website: { type: String, default: "" },
    email: { type: String, default: "" },
    city: { type: String, default: "" },
    country: { type: String, default: "" },
    description: { type: String, default: "", maxlength: 500 },
  },
  { _id: false }
);

const organizationRegistrationRequestSchema = new mongoose.Schema(
  {
    applicant: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },

    // Category as per product requirement
    category: { type: String, enum: REQUEST_CATEGORIES, required: true, index: true },

    // Proposed organization identity
    proposedName: { type: String, required: true, trim: true, maxlength: 120 },
    proposedSlug: { type: String, trim: true, lowercase: true, maxlength: 80, default: "" },
    description: { type: String, default: "", maxlength: 1000 },
    website: { type: String, default: "" },
    email: { type: String, trim: true, lowercase: true, maxlength: 254, default: "" },
    phone: { type: String, trim: true, maxlength: 40, default: "" },
    socialLinks: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },

    // Address
    addressLine: { type: String, default: "", maxlength: 300 },
    city: { type: String, default: "", maxlength: 120 },
    state: { type: String, default: "", maxlength: 120 },
    country: { type: String, default: "", maxlength: 120 },
    postalCode: { type: String, default: "", maxlength: 32 },
    latitude: { type: Number, min: -90, max: 90, default: null },
    longitude: { type: Number, min: -180, max: 180, default: null },

    // Branding - reuse existing storage
    logoUrl: { type: String, default: "" },
    logoPublicId: { type: String, default: "" },
    coverUrl: { type: String, default: "" },
    coverPublicId: { type: String, default: "" },

    // Evidence
    evidence: { type: evidenceSchema, default: () => ({}) },

    // Parent institution for affiliated club
    parentOrganizationId: { type: mongoose.Schema.Types.ObjectId, ref: "Organization", default: null },
    proposedParent: { type: proposedParentSchema, default: () => ({}) },

    // Applicant role
    applicantRole: { type: String, default: "", maxlength: 120 },
    designation: { type: String, default: "", maxlength: 120 },

    // Lifecycle
    status: { type: String, enum: REQUEST_STATUSES, default: "PENDING_REVIEW", index: true },
    rejectionReason: { type: String, default: "", maxlength: 1000 },
    infoRequestMessage: { type: String, default: "", maxlength: 1000 },

    // Resulting organization
    resultingOrganizationId: { type: mongoose.Schema.Types.ObjectId, ref: "Organization", default: null },

    // Reviewer
    reviewer: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    reviewedAt: { type: Date, default: null },

    // History and versioning
    reviewHistory: { type: [reviewHistorySchema], default: [] },
    resubmissionCount: { type: Number, default: 0 },
    version: { type: Number, default: 1 },

    // Idempotency and declaration
    idempotencyKey: { type: String, default: undefined },
    declarationAccepted: { type: Boolean, default: false },
    declarationAcceptedAt: { type: Date, default: null },

    // Submission tracking
    submittedAt: { type: Date, default: null },
    lastUpdatedByApplicantAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Indexes for queries
organizationRegistrationRequestSchema.index({ applicant: 1, status: 1 });
organizationRegistrationRequestSchema.index({ status: 1, createdAt: -1 });
organizationRegistrationRequestSchema.index({ category: 1, status: 1 });
organizationRegistrationRequestSchema.index({ proposedSlug: 1 });
organizationRegistrationRequestSchema.index({ parentOrganizationId: 1 });
organizationRegistrationRequestSchema.index({ resultingOrganizationId: 1 }, { sparse: true });
organizationRegistrationRequestSchema.index({ idempotencyKey: 1 }, { unique: true, sparse: true });
organizationRegistrationRequestSchema.index({ createdAt: -1, _id: -1 });

// Text index for search
organizationRegistrationRequestSchema.index({ proposedName: "text", description: "text" });

module.exports = {
  OrganizationRegistrationRequest: mongoose.model(
    "OrganizationRegistrationRequest",
    organizationRegistrationRequestSchema
  ),
  REQUEST_CATEGORIES,
  REQUEST_STATUSES,
};
