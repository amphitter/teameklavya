const mongoose = require('mongoose');

const profileSchema = new mongoose.Schema({
  institution: { type: String, default: '' },
  course: { type: String, default: '' },
  year: { type: String, default: '' }
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

  // Email verification fields
  emailVerified: { type: Boolean, default: false },
  emailVerifyToken: { type: String },
  emailVerifyExpires: { type: Date },

  // Password reset fields
  resetOtp: { type: String },
  resetOtpExpires: { type: Date },

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

// 🔹 Ensure email uniqueness is enforced at DB level too
userSchema.index({ email: 1 }, { unique: true });

// 🔹 Pre-save hook to sanitize names if missing (esp. Google signups)
userSchema.pre('save', function (next) {
  if (!this.lastName) {
    this.lastName = ''; // fallback to empty string, not null
  }
  if (!this.firstName) {
    this.firstName = 'User';
  }
  next();
});

// 🔹 Optional: virtual full name for convenience
userSchema.virtual('fullName').get(function () {
  return `${this.firstName} ${this.lastName}`.trim();
});

module.exports = mongoose.model('User', userSchema);
