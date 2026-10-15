const mongoose = require('mongoose');

/* A crop is four numbers — a VALUE, not a document. `_id: false` keeps an
 * ObjectId out of the payload: the client compares crops by value, and an
 * identifier on a plain coordinate would be meaningless noise. */
const cropSchema = new mongoose.Schema(
  { x: Number, y: Number, w: Number, h: Number },
  { _id: false }
);

const profileSchema = new mongoose.Schema({
  institution: { type: String, default: '' },
  course: { type: String, default: '' },
  year: { type: String, default: '' },
  // ── Social profile (Part 3) ──────────────────────────────
  avatar: { type: String, default: '' },        // Cloudinary URL
  coverImage: { type: String, default: '' },    // Cloudinary URL
  /* Vertical focal point of the cover, as a CSS object-position percentage
   * (0 = show the top of the image, 100 = show the bottom).
   *
   * WHY THIS IS STORED, NOT JUST APPLIED
   *   A cover is authored at 1600×400 and shown in containers from a 96px
   *   mobile strip to a 240px desktop banner. Without a stored focal point
   *   the browser centres the crop, which decapitates any photo whose subject
   *   is not in the middle. §7 asks for a banner that is
   *   "croppable / repositionable", and a reposition that resets on reload is
   *   not a reposition — so the value is persisted with the image.
   *
   *   Default 50 keeps every existing cover rendering exactly as it does
   *   today (plain `object-position: center`). */
  coverPosition: { type: Number, default: 50, min: 0, max: 100 },

  /* ── Canonical crops (§6) ──────────────────────────────────────────────
   * The framing the user chose in the crop editor, as fractions of the
   * ORIGINAL image: { x, y, w, h }, each 0–1.
   *
   * The stored avatar is already rendered from this crop, so nothing needs it
   * to display correctly. It is kept so "re-crop" opens on the user's own
   * framing instead of a fresh centre crop — and so a future re-render (a
   * larger canonical size, say) can reproduce exactly what they chose.
   *
   * A stored avatar WITHOUT one of these is a legacy upload from before the
   * editor existed: the UI offers those users a one-tap re-crop (§7). */
  avatarCrop: { type: cropSchema, default: null },
  coverCrop: { type: cropSchema, default: null },

  /* ── Asset versions (§27) ──────────────────────────────────────────────
   * Bumped ONLY when the asset is replaced, and appended to delivery URLs as
   * `?v=`. A new photo is therefore never served from a CDN or browser cache,
   * while an unchanged one keeps caching indefinitely — which a render-time
   * timestamp could not do. */
  avatarVersion: { type: Number, default: 0 },
  coverVersion: { type: Number, default: 0 },
  bio: { type: String, default: '', maxlength: [280, 'Bio is too long (max 280 characters)'] },
  location: { type: String, default: '', maxlength: 80 },
  /* §2-7 lists "website/location" as profile fields. The edit sheet had the
   * input state for this but no field to write to, so it was silently
   * discarded on save — the classic "looks implemented" gap. */
  website: { type: String, default: '', maxlength: 200 },
  interests: { type: [String], default: [] },    // lowercase topics, max 10 enforced in controller
  // Per-type notification mutes (Part 3, Phase 8): { like: true, comment: true, … }
  // Missing/false = allowed. Enforced in the notification service, never the client.
  notificationPrefs: { type: Object, default: {} },
}, { _id: false });

/** Who can see the profile / message the user (backend-enforced). */
const socialSettingsSchema = new mongoose.Schema({
  profileVisibility: { type: String, enum: ['public', 'followers', 'private'], default: 'public' },
  allowMessagesFrom: { type: String, enum: ['everyone', 'followers', 'nobody'], default: 'everyone' },
  showAttendance: { type: Boolean, default: true },
  showAchievements: { type: Boolean, default: true }
}, { _id: false });

const userSchema = new mongoose.Schema({
  firstName: {
    type: String,
    trim: true,
    required: [true, 'First name is required']
  },
  lastName: {
    type: String,
    trim: true,
    default: '', // allow missing last name during Google OAuth
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    trim: true
  },
  passwordHash: {
    type: String,
    default: null // Google users may not have a password
  },
  role: {
    type: String,
    enum: ['user', 'admin'],
    default: 'user'
  },

  // ── Moderation (Part 3, Phase 10) ────────────────────────
  // suspendedAt set = account suspended: login + all authenticated
  // actions are blocked server-side until an admin unsuspends.
  suspendedAt: { type: Date, default: null },
  suspensionReason: { type: String, default: "" },

  // ── Enhanced moderation & enforcement (Onboarding & Trust & Safety) ──
  // Token version for session revocation after ban/suspension
  tokenVersion: { type: Number, default: 0 },
  // Permanent ban
  bannedAt: { type: Date, default: null },
  banReason: { type: String, default: "" },
  banCategory: { type: String, default: "" },
  // Temporary suspension with expiry
  suspensionExpiresAt: { type: Date, default: null },
  // Feature restrictions: { posting: { until, reason }, commenting, messaging, eventCreation }
  restrictions: {
    posting: {
      until: { type: Date, default: null },
      reason: { type: String, default: "" },
    },
    commenting: {
      until: { type: Date, default: null },
      reason: { type: String, default: "" },
    },
    messaging: {
      until: { type: Date, default: null },
      reason: { type: String, default: "" },
    },
    eventCreation: {
      until: { type: Date, default: null },
      reason: { type: String, default: "" },
    },
  },
  // Warning count and violation history
  warningCount: { type: Number, default: 0 },
  violationCount: { type: Number, default: 0 },
  lastViolationAt: { type: Date, default: null },

  // ── Social identity (Part 3) ─────────────────────────────
  username: {
    type: String,
    lowercase: true,
    trim: true,
    match: [/^[a-z0-9_]{3,30}$/, 'Username must be 3-30 characters: letters, numbers, underscore'],
    // sparse: legacy users without a username don't collide on the unique index
    index: { unique: true, sparse: true }
  },
  usernameLastChangedAt: { type: Date, default: null },
  // For first-time assignment tracking
  usernameFirstSetAt: { type: Date, default: null },

  verified: { type: Boolean, default: false },
  points: { type: Number, default: 0, min: 0 },
  socialSettings: { type: socialSettingsSchema, default: () => ({}) },

  // ── Discovery privacy (org-only event creation & profile hide) ──
  // When true, personal profile is excluded from people search/discovery listings
  // (suggested users, search type=people). Org remains searchable. Distinct from
  // suspension/deletion/org visibility. Safe default false preserves visibility.
  hidePersonalProfileFromDiscovery: { type: Boolean, default: false },
  hideFromPeopleDiscoveryUpdatedAt: { type: Date, default: null },

  // Email verification fields
  /* Part 11 — presence. Written from the socket layer, throttled (see
   * dm-realtime.service), never from a request handler: a user is "away" the
   * moment their last socket closes, which no HTTP call can observe. */
  lastSeenAt: { type: Date, default: null },

  emailVerified: { type: Boolean, default: false },
  emailVerifyToken: { type: String },
  emailVerifyExpires: { type: Date },

  // Password reset fields
  resetOtp: { type: String },
  resetOtpExpires: { type: Date },
  // NOTE: these two fields MUST exist in the schema — Mongoose strict mode
  // silently drops undeclared fields, which previously broke password reset.
  passwordResetToken: { type: String },
  passwordResetTokenExpires: { type: Date },

  // ── Onboarding (User onboarding & profile personalization) ──
  ageConfirmed: { type: Boolean, default: false },
  ageConfirmedAt: { type: Date, default: null },
  // We do NOT store full DOB unless required; just confirmation boolean + timestamp
  // Minimum age policy: 13 (documented assumption, not inventing legal requirement)
  onboardingVersion: { type: Number, default: 0 },
  onboardingCompletedAt: { type: Date, default: null },
  onboardingSteps: {
    username: { type: Boolean, default: false },
    age: { type: Boolean, default: false },
    privacy: { type: Boolean, default: false },
    avatarBanner: { type: Boolean, default: false },
    bio: { type: Boolean, default: false },
    institution: { type: Boolean, default: false },
    interests: { type: Boolean, default: false },
  },
  // Institution as Organization ref (canonical source)
  institutionOrgId: { type: mongoose.Schema.Types.ObjectId, ref: "Organization", default: null },
  // Interests with stable IDs
  interestsV2: { type: [String], default: [] },

  // OAuth providers (e.g., Google, GitHub)
  oauthProviders: [{
    provider: { type: String },
    providerId: { type: String }
  }],

  profile: profileSchema,

  createdAt: { type: Date, default: Date.now },

  // Optional relations
  pastEventsAttended: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Event' }],
  pastTickets: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Ticket' }]
});

// 🔹 Email uniqueness IS enforced at DB level — via `unique: true` on the
// field itself, which already builds this index.
// NOTE (Part 5, Phase 3): these two schema.index() calls used to duplicate
// the field-level `unique` indexes (Mongoose warned on every boot). Two
// wasted indexes on the largest hot collection in the app. The field-level
// declarations are canonical — keep those, not these.
//   userSchema.index({ email: 1 }, { unique: true });
//   userSchema.index({ username: 1 }, { unique: true, sparse: true });

// 🔹 Pre-save hook: sanitize names and guarantee a unique @username.
// Runs for email signups, Google OAuth users and legacy docs alike —
// so every user is reachable at /profile/[username].
userSchema.pre('save', async function (next) {
  if (!this.lastName) {
    this.lastName = ''; // fallback to empty string, not null
  }
  if (!this.firstName) {
    this.firstName = 'User';
  }
  if (!this.username) {
    const clean = [this.firstName, this.lastName]
      .filter(Boolean)
      .join('_')
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '')
      .slice(0, 24);
    const root = clean.length >= 3 ? clean : `${clean || 'builder'}${Math.floor(100 + Math.random() * 900)}`;
    let candidate = root.slice(0, 28);
    let i = 0;
    // Suffix loop guarantees uniqueness within the 30-char limit
    while (await mongoose.model('User').exists({ username: candidate })) {
      i += 1;
      const suffix = `_${i}`;
      candidate = root.slice(0, 30 - suffix.length) + suffix;
    }
    this.username = candidate;
  }
  next();
});

// Indexes for new onboarding & enforcement fields
userSchema.index({ bannedAt: 1 });
userSchema.index({ suspendedAt: 1, suspensionExpiresAt: 1 });
userSchema.index({ institutionOrgId: 1 });
userSchema.index({ onboardingVersion: 1 });
userSchema.index({ tokenVersion: 1 });
userSchema.index({ hidePersonalProfileFromDiscovery: 1 });

// 🔹 Optional: virtual full name for convenience
userSchema.virtual('fullName').get(function () {
  return `${this.firstName} ${this.lastName}`.trim();
});

module.exports = mongoose.model('User', userSchema);
