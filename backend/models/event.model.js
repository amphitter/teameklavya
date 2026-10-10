// models/event.model.js
const mongoose = require("mongoose");

const speakerSchema = new mongoose.Schema({
  name: String,
  designation: String,
  company: String,
  linkedin: String,
  imageUrl: String,
});

const scheduleSchema = new mongoose.Schema({
  day: String,
  time: String,
  title: String,
  description: String,
  speakers: [String],
});

const partnerSchema = new mongoose.Schema({
  name: String,
  role: String,
  website: String,
  logoUrl: String,
});

/**
 * Live engine settings (Part 4, spec §74). Scoring values are NEVER
 * hard-coded into the engine — organizers configure them here.
 */
const scoringSchema = new mongoose.Schema(
  {
    basePoints: { type: Number, default: 100, min: 0, max: 10000 },
    speedBonus: { type: Number, default: 0, min: 0, max: 10000 },
    negativeMarking: { type: Number, default: 0, min: 0, max: 10000 }, // penalty magnitude
    partialScoring: { type: Boolean, default: false },
    questionWeighting: { type: Boolean, default: false }, // use per-question points
  },
  { _id: false }
);

const liveSettingsSchema = new mongoose.Schema(
  {
    allowLateJoin: { type: Boolean, default: true },
    requireRegistration: { type: Boolean, default: false },
    requireCheckIn: { type: Boolean, default: false },
    leaderboardVisibility: {
      type: String,
      enum: ["never", "every_question", "every_n", "after_activity", "checkpoints", "final"],
      default: "after_activity",
    },
    leaderboardInterval: { type: Number, default: 1, min: 1, max: 50 }, // for every_n
    allowAnswerChanges: { type: Boolean, default: false },
    chatEnabled: { type: Boolean, default: true },
    qaEnabled: { type: Boolean, default: true },
    pollsEnabled: { type: Boolean, default: true },
    teamMode: { type: Boolean, default: false },
    requireFullScreen: { type: Boolean, default: false }, // optional (spec §67) — not a real anti-cheat
    scoring: { type: scoringSchema, default: () => ({}) },
  },
  { _id: false }
);

const eventSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    slug: { type: String, unique: true, required: true },
    description: { type: String, required: true },
    category: { type: String, default: "General" },
    
    // Event type - online/offline
    eventType: {
      type: String,
      enum: ["online", "offline", "hybrid"],
      default: "offline",
      required: true
    },
    
    // Physical venue details (for offline/hybrid events)
    venue: { 
      type: String, 
      required: function() {
        return this.eventType === 'offline' || this.eventType === 'hybrid';
      }
    },
    venueIframeLink: { 
      // Map embed URL — optional (an event can have a venue without a map embed)
      type: String,
      default: ""
    },
    
    // Online event details (for online/hybrid events)
    onlineEventLink: {
      type: String,
      required: function() {
        return this.eventType === 'online' || this.eventType === 'hybrid';
      },
      validate: {
        validator: function(v) {
          if (this.eventType === 'online' || this.eventType === 'hybrid') {
            return v && v.length > 0;
          }
          return true;
        },
        message: 'Online event link is required for online and hybrid events'
      }
    },
    platform: {
      type: String,
      enum: ["zoom", "google-meet", "teams", "youtube", "other", null],
      default: null
    },
    meetingId: String,
    passcode: String,
    
    // Date and time
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    startTime: String,
    endTime: String,
    
    // Media and branding. The event logo is independent of its banner and
    // optional for legacy Events; no backfill guesses a logo from associations.
    bannerUrl: String,
    bannerPublicId: String, // Provider public id (used to replace/delete the asset)
    logoUrl: { type: String, default: null },
    logoPublicId: { type: String, default: null },
    organizer: String,
    
    // Attendance limits
    maxAttendees: { type: Number, default: 100 },
    minAttendees: { type: Number, default: 1 },
    price: { type: Number, default: 0 },
    
    // Theme
    theme: {
      type: String,
      enum: ["Fire","Forest","Ocean","Cosmic","Sunset","Electric","Golden","Rose","Dark","Arctic"],
      default: "Fire",
    },
    isFeatured: { type: Boolean, default: false },

    // Visibility (backwards compatible — existing events default to public)
    // public   → discoverable in search/discovery
    // unlisted → accessible via direct link only, hidden from discovery
    removedAt: { type: Date, default: null },
    removedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    // Owner lifecycle is separate from visibility and moderation. Archiving is
    // reversible and never deletes registrations, tickets, posts, or the Event.
    archivedAt: { type: Date, default: null },
    archivedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

    // ── LIVE EVENT ENGINE (Part 4, Phase 1) ──────────────────────────────
    // Explicit operational state machine (spec §13). The display-lifecycle
    // virtual (upcoming/ongoing/past) is separate and untouched.
    liveState: {
      type: String,
      enum: [
        "DRAFT",
        "PUBLISHED",
        "REGISTRATION_OPEN",
        "REGISTRATION_CLOSED",
        "CHECK_IN",
        "WAITING",
        "LIVE",
        "PAUSED",
        "COMPLETED",
        "CANCELLED",
      ],
      default: "PUBLISHED", // legacy events behave exactly as before
      index: true,
    },
    // Short human-friendly join code (HACKCRAFT 3.0 → HCF30 style).
    // Never contains authentication material — the QR encodes a safe URL.
    joinCode: {
      type: String,
      default: () => {
        const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
        let code = "";
        for (let i = 0; i < 6; i += 1) code += chars[Math.floor(Math.random() * chars.length)];
        return code;
      },
      index: { unique: true },
    },
    // Live engine configuration (spec §74) — all server-enforced
    liveSettings: {
      type: liveSettingsSchema,
      default: () => ({}),
    },
    // private  → accessible to organizer/admin and invited participants only
    visibility: {
      type: String,
      enum: ["public", "unlisted", "private"],
      default: "public",
      index: true,
    },

    // Registration form
    registrationForm: [{
      label: { type: String, required: true },
      type: {
        type: String,
        enum: ["text", "email", "number", "dropdown", "checkbox", "file"],
        required: true,
      },
      required: { type: Boolean, default: false },
      options: [String],
      autoFillFromProfile: { 
        type: String, 
        enum: ["institution", "course", "year"], 
        default: null 
      },
    }],

    // Ticket generation settings
    ticketSettings: {
      autoGenerate: { type: Boolean, default: false },
      sendEmail: { type: Boolean, default: true },
      manualApproval: { type: Boolean, default: false },
    },

    // Event content
    speakers: [speakerSchema],
    schedule: [scheduleSchema],
    benefits: [String],
    partners: [partnerSchema],

    // Links
    registrationLink: String,
    whatsappGroup: String,

    // Creator is immutable provenance and is not an owner transfer field.
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    // Explicit controller/organization/platform ownership. `organization` and
    // `community` below remain independent discovery/host associations.
    organizerType: { type: String, enum: ["USER", "ORGANIZATION", "PLATFORM"] },
    organizerId: { type: mongoose.Schema.Types.ObjectId, default: null },
    // Organization association (historically described as owner, but does not
    // grant access unless organizerType is explicitly ORGANIZATION).
    organization: { type: mongoose.Schema.Types.ObjectId, ref: "Organization", default: null },
    // Community hosting this event (Phase 6) — shown on the community page
    community: { type: mongoose.Schema.Types.ObjectId, ref: "Community", default: null },
    // Reminder scheduler dedupe (Phase 8) — set once the reminder went out
    reminderSent: {
      h24: { type: Date, default: null },
      h1: { type: Date, default: null },
    },

    // Profile requirements
    requiredProfileFields: {
      institution: { type: Boolean, default: false },
      course: { type: Boolean, default: false },
      year: { type: Boolean, default: false },
    },

    // Check-ins (for offline events)
    checkIns: [
      {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        checkInTime: Date,
        checkOutTime: Date,
      },
    ],

    // Online event specific fields
    recordingLink: String, // For posting recording after the event
    materials: [{ // Presentation slides, resources, etc.
      title: String,
      url: String,
      type: String
    }],
    
    // Event instructions (different for online/offline)
    instructions: {
      online: String, // Instructions for online participants
      offline: String, // Instructions for offline participants
      general: String // General instructions for all
    },

    // Trust & Safety moderation
    moderationStatus: {
      type: String,
      enum: ["pending", "approved", "quarantined", "removed", "flagged"],
      default: "approved",
      index: true,
    },
    moderationCategory: { type: String, default: "" },
    moderationConfidence: { type: Number, default: 0 },
    moderationCheckedAt: { type: Date, default: null },
    moderationCase: { type: mongoose.Schema.Types.ObjectId, ref: "ModerationCase", default: null },

    // ── Institution–Club Event Approval Workflow (Master Refactor) ──
    approvalStatus: {
      type: String,
      enum: ["DRAFT", "PENDING_REVIEW", "APPROVED", "REJECTED", "CHANGES_REQUESTED", "CANCELLED", "SUSPENDED"],
      default: "APPROVED", // backward compat: existing events are approved
      index: true,
    },
    proposingOrganizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      default: null,
      index: true,
    },
    parentInstitutionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      default: null,
      index: true,
    },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    approvedAt: { type: Date, default: null },
    rejectedAt: { type: Date, default: null },
    rejectionReason: { type: String, default: "", maxlength: 2000 },
    changeRequestMessage: { type: String, default: "", maxlength: 2000 },
    submittedAt: { type: Date, default: null },
    lastResubmittedAt: { type: Date, default: null },
    version: { type: Number, default: 1 },
    requiresReapproval: { type: Boolean, default: false },
    lastMaterialChangeAt: { type: Date, default: null },
    approvalHistory: {
      type: [
        {
          action: {
            type: String,
            enum: [
              "CREATED",
              "SUBMITTED",
              "RESUBMITTED",
              "APPROVED",
              "REJECTED",
              "CHANGES_REQUESTED",
              "CANCELLED",
              "SUSPENDED",
              "MATERIAL_CHANGE",
              "AUTO_REQUIRES_REAPPROVAL",
            ],
            required: true,
          },
          actor: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
          actorRole: {
            type: String,
            enum: ["CLUB_ADMIN", "INSTITUTION_ADMIN", "SUPER_ADMIN", "SYSTEM", "CREATOR"],
            default: "CREATOR",
          },
          fromStatus: { type: String, default: "" },
          toStatus: { type: String, default: "" },
          reason: { type: String, default: "", maxlength: 2000 },
          message: { type: String, default: "", maxlength: 2000 },
          createdAt: { type: Date, default: Date.now },
        },
      ],
      default: [],
    },
    previousApprovedSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true }
);

// Virtual for checking if event is currently live
eventSchema.virtual('isLive').get(function() {
  const now = new Date();
  return now >= this.startDate && now <= this.endDate;
});

// Virtual for event status
/** New unique join code (organizer action, Part 4). Retries on collision. */
eventSchema.methods.regenerateJoinCode = function regenerateJoinCode() {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i += 1) code += chars[Math.floor(Math.random() * chars.length)];
  this.joinCode = code;
  return code;
};

eventSchema.virtual('status').get(function() {
  const now = new Date();
  if (now < this.startDate) return 'upcoming';
  if (now > this.endDate) return 'past';
  return 'ongoing';
});

eventSchema.pre("validate", function (next) {
  if (!this.slug && this.title) {
    this.slug = this.title.toLowerCase().replace(/\s+/g, "-").replace(/[^\w-]+/g, "");
  }
  
  // Set platform to null if not an online event
  if (this.eventType === 'offline') {
    this.platform = null;
    this.meetingId = null;
    this.passcode = null;
  }
  
  next();
});

// Indexes for better query performance
// NOTE (Part 5, Phase 3): `slug` already declares `unique: true` at the field
// level, which creates this exact index. Declaring it a second time built a
// DUPLICATE index on every deployment — wasted storage plus a second B-tree
// to update on every write. Removed intentionally; do not re-add.
eventSchema.index({ startDate: 1 });
eventSchema.index({ isFeatured: 1 });
eventSchema.index({ createdBy: 1 });
eventSchema.index({ organizerType: 1, organizerId: 1, createdAt: -1 });
eventSchema.index({ organization: 1 }, { sparse: true });
eventSchema.index({ community: 1 }, { sparse: true });
eventSchema.index({ "ticketSettings.autoGenerate": 1 });
eventSchema.index({ eventType: 1 }); // New index for event type filtering
eventSchema.index({ approvalStatus: 1, parentInstitutionId: 1, createdAt: -1 });
eventSchema.index({ approvalStatus: 1, proposingOrganizationId: 1, createdAt: -1 });
eventSchema.index({ parentInstitutionId: 1, approvalStatus: 1, startDate: 1 });

module.exports = mongoose.model("Event", eventSchema);