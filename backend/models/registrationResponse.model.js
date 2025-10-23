const mongoose = require("mongoose");

const answerSchema = new mongoose.Schema({
  fieldLabel: String,
  fieldType: String,
  value: mongoose.Schema.Types.Mixed,
}, { _id: false });

const responseSchema = new mongoose.Schema(
  {
    eventId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Event",
      required: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    answers: [answerSchema],
    status: {
      type: String,
      enum: ['confirmed', 'pending'],
      default: 'confirmed'
    },
  rsvpToken: {
    type: String,
    unique: true,
    sparse: true
  },
  rsvpVerified: {
    type: Boolean,
    default: false
  },
  rsvpVerifiedAt: Date,
  rsvpVerificationExpires: Date,
  rsvpSent: {
    type: Boolean,
    default: false
  },
  rsvpSentAt: Date,
    source: {
      type: String,
      enum: ['web', 'mobile', 'admin'],
      default: 'web'
    },
    metadata: {
      ipAddress: String,
      userAgent: String,
      referrer: String
    }
  },
  { 
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

// Index for better query performance
responseSchema.index({ eventId: 1, userId: 1 }, { unique: true });
responseSchema.index({ eventId: 1, createdAt: -1 });
responseSchema.index({ userId: 1 });
responseSchema.index({ status: 1 });

// Virtual for full name
responseSchema.virtual('userFullName').get(function() {
  return `${this.userId?.firstName} ${this.userId?.lastName}`;
});

module.exports = mongoose.model("RegistrationResponse", responseSchema);