const mongoose = require('mongoose');

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

  // ── Social identity (Part 3) ─────────────────────────────
  username: {
    type: String,
    lowercase: true,
    trim: true,
    match: [/^[a-z0-9_]{3,30}$/, 'Username must be 3-30 characters: letters, numbers, underscore'],
    // sparse: legacy users without a username don't collide on the unique index
    index: { unique: true, sparse: true }
  },
  verified: { type: Boolean, default: false },
  points: { type: Number, default: 0, min: 0 },
  socialSettings: { type: socialSettingsSchema, default: () => ({}) },

  // Email verification fields
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

// 🔹 Optional: virtual full name for convenience
userSchema.virtual('fullName').get(function () {
  return `${this.firstName} ${this.lastName}`.trim();
});

module.exports = mongoose.model('User', userSchema);
