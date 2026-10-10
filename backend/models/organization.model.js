const mongoose = require("mongoose");
const {
  ORGANIZATION_CATEGORIES,
  ORGANIZATION_STATUSES,
  ORGANIZATION_VERIFICATION_STATUSES,
  ORGANIZATION_OWNERSHIP_STATUSES,
  ORGANIZATION_AFFILIATION_STATUSES,
} = require("../config/organization");

/**
 * EventHub Organization — first-class entity (colleges, clubs, communities).
 *
 * This model is deliberately additive. `slug`, `logoUrl`, `coverUrl`,
 * `isVerified`, and `managers` remain available to every existing API/client.
 * New documents keep the handle/slug and logo/cover aliases in sync; legacy
 * records are not rewritten as a side effect of loading the model.
 */
const organizationSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Organization name is required"],
      trim: true,
      maxlength: [80, "Name is too long"],
    },

    /**
     * `handle` is the new public identifier. `slug` remains the compatibility
     * field used by current routes, posts, notifications, and event links.
     * The pre-validation hook mirrors them on new records and explicit edits;
     * old records can continue resolving by slug until a reviewed backfill.
     */
    handle: {
      type: String,
      lowercase: true,
      trim: true,
      match: [/^[a-z0-9-]*$/, "Handle may contain lowercase letters, numbers, and hyphens"],
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },

    category: {
      type: String,
      enum: ORGANIZATION_CATEGORIES,
      default: "OTHER",
      index: true,
    },
    description: {
      type: String,
      trim: true,
      maxlength: [1000, "Description is too long"],
      default: "",
    },

    // New names plus the established API aliases.
    logo: { type: String, default: "" },
    cover: { type: String, default: "" },
    // Keep the original fields' permissive behavior for current clients.
    logoUrl: { type: String, default: "" },
    coverUrl: { type: String, default: "" },

    address: { type: String, trim: true, maxlength: 300, default: "" },
    city: { type: String, trim: true, maxlength: 120, default: "", index: true },
    state: { type: String, trim: true, maxlength: 120, default: "" },
    country: { type: String, trim: true, maxlength: 120, default: "" },
    postalCode: { type: String, trim: true, maxlength: 32, default: "" },
    // Safe map URL – validated via url-safety allowlist, embed only if https and trusted domain
    mapUrl: { type: String, trim: true, maxlength: 2048, default: "" },
    latitude: { type: Number, min: -90, max: 90, default: null },
    longitude: { type: Number, min: -180, max: 180, default: null },

    website: { type: String, default: "" },
    email: { type: String, trim: true, lowercase: true, maxlength: 254, default: "" },
    phone: { type: String, trim: true, maxlength: 40, default: "" },
    // Platform names are intentionally extensible; URL safety is enforced by
    // the write API when these fields become editable in the profile phase.
    socialLinks: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },

    // Phase 3 institution/club affiliation only; never an ownership or RBAC grant.
    parentOrganizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      default: null,
    },

    // Master refactor: explicit affiliation lifecycle (pending/approved/suspended/revoked/rejected)
    affiliationStatus: {
      type: String,
      enum: ORGANIZATION_AFFILIATION_STATUSES,
      default: "NONE",
      index: true,
    },
    affiliationRequestedAt: { type: Date, default: null },
    affiliationRequestedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    affiliationApprovedAt: { type: Date, default: null },
    affiliationApprovedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    affiliationRejectedAt: { type: Date, default: null },
    affiliationRejectedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    affiliationRejectionReason: { type: String, default: "", maxlength: 1000 },
    lastAffiliationChangeAt: { type: Date, default: null },
    affiliationHistory: {
      type: [
        {
          action: {
            type: String,
            enum: ["REQUESTED", "APPROVED", "REJECTED", "SUSPENDED", "REVOKED", "TRANSFERRED", "TRANSFER_REQUESTED"],
            required: true,
          },
          actor: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
          actorRole: { type: String, enum: ["CLUB_ADMIN", "INSTITUTION_ADMIN", "SUPER_ADMIN", "SYSTEM"], default: "CLUB_ADMIN" },
          fromParent: { type: mongoose.Schema.Types.ObjectId, ref: "Organization", default: null },
          toParent: { type: mongoose.Schema.Types.ObjectId, ref: "Organization", default: null },
          fromStatus: { type: String, default: "" },
          toStatus: { type: String, default: "" },
          reason: { type: String, default: "", maxlength: 1000 },
          createdAt: { type: Date, default: Date.now },
        },
      ],
      default: [],
    },

    status: {
      type: String,
      enum: ORGANIZATION_STATUSES,
      // Existing organization creation is platform-admin-only and immediately
      // public. Preserve that behavior; future self-service creation can pass
      // PENDING_REVIEW explicitly when its API/UI is introduced.
      default: "APPROVED",
    },
    verificationStatus: {
      type: String,
      enum: ORGANIZATION_VERIFICATION_STATUSES,
      default: function defaultVerificationStatus() {
        return this.isVerified ? "VERIFIED" : "UNVERIFIED";
      },
    },
    ownershipStatus: {
      type: String,
      enum: ORGANIZATION_OWNERSHIP_STATUSES,
      default: "PERSONAL",
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    /* ── Legacy verification and manager fields (kept for compatibility) ── */
    isVerified: { type: Boolean, default: false },
    verifiedAt: { type: Date, default: null },
    // Compatibility projection for Super Admin-assigned managers. Phase 4 maps
    // these IDs to MANAGER memberships; writes keep the array in sync for older clients.
    managers: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }], default: [] },
  },
  { timestamps: true }
);

// Existing profile lookup and uniqueness indexes are retained.
organizationSchema.index({ name: 1 });
organizationSchema.index({ handle: 1 }, { unique: true, sparse: true });
organizationSchema.index({ parentOrganizationId: 1 });
organizationSchema.index({ verificationStatus: 1 });
organizationSchema.index({ status: 1 });
// Stable cursor pagination for the public discovery directory.
organizationSchema.index({ createdAt: -1, _id: -1 });

/** Keep new field names aligned with fields already consumed by the app. */
organizationSchema.pre("validate", function syncOrganizationAliases() {
  if (this.isNew) {
    const publicHandle = this.handle || this.slug;
    if (publicHandle) {
      this.handle = publicHandle;
      this.slug = publicHandle;
    }

    const logoValue = this.logo || this.logoUrl || "";
    const coverValue = this.cover || this.coverUrl || "";
    this.logo = logoValue;
    this.logoUrl = logoValue;
    this.cover = coverValue;
    this.coverUrl = coverValue;
  } else {
    if (this.isModified("handle") && !this.isModified("slug")) {
      this.slug = this.handle;
    } else if (this.isModified("slug") && !this.isModified("handle")) {
      this.handle = this.slug;
    }

    if (this.isModified("logo") && !this.isModified("logoUrl")) {
      this.logoUrl = this.logo;
    } else if (this.isModified("logoUrl") && !this.isModified("logo")) {
      this.logo = this.logoUrl;
    }
    if (this.isModified("cover") && !this.isModified("coverUrl")) {
      this.coverUrl = this.cover;
    } else if (this.isModified("coverUrl") && !this.isModified("cover")) {
      this.cover = this.coverUrl;
    }
  }

  // Legacy verification endpoints still write `isVerified`; the explicit
  // verification workflow can write `verificationStatus`. Keep both views
  // consistent without changing who is authorized to verify an organization.
  if (this.isModified("verificationStatus")) {
    this.isVerified = this.verificationStatus === "VERIFIED";
    if (this.verificationStatus !== "VERIFIED") this.verifiedAt = null;
    else if (!this.verifiedAt) this.verifiedAt = new Date();
  } else if (this.isModified("isVerified")) {
    this.verificationStatus = this.isVerified ? "VERIFIED" : "UNVERIFIED";
    if (!this.isVerified) this.verifiedAt = null;
    else if (!this.verifiedAt) this.verifiedAt = new Date();
  }
});

module.exports = mongoose.model("Organization", organizationSchema);
