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

const eventSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    slug: { type: String, unique: true, required: true },
    description: { type: String, required: true },
    category: { type: String, default: "General" },
    venue: { type: String, required: true },
    venueIframeLink: { type: String }, // <-- Added this field for venue map embed
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    startTime: String,
    endTime: String,
    bannerUrl: String,
    organizer: String,
    maxAttendees: { type: Number, default: 100 },
    minAttendees: { type: Number, default: 1 },
    price: { type: Number, default: 0 },
    theme: {
      type: String,
      enum: ["Fire","Forest","Ocean","Cosmic","Sunset","Electric","Golden","Rose","Dark","Arctic"],
      default: "Fire",
    },
    isFeatured: { type: Boolean, default: false },

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

    speakers: [speakerSchema],
    schedule: [scheduleSchema],
    benefits: [String],
    partners: [partnerSchema],

    registrationLink: String,
    whatsappGroup: String,

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },

    requiredProfileFields: {
      institution: { type: Boolean, default: false },
      course: { type: Boolean, default: false },
      year: { type: Boolean, default: false },
    },

    checkIns: [
      {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        checkInTime: Date,
        checkOutTime: Date,
      },
    ],
  },
  { timestamps: true }
);

eventSchema.pre("validate", function (next) {
  if (!this.slug && this.title) {
    this.slug = this.title.toLowerCase().replace(/\s+/g, "-").replace(/[^\w-]+/g, "");
  }
  next();
});

// Index for better query performance
eventSchema.index({ slug: 1 });
eventSchema.index({ startDate: 1 });
eventSchema.index({ isFeatured: 1 });
eventSchema.index({ createdBy: 1 });
eventSchema.index({ "ticketSettings.autoGenerate": 1 });

module.exports = mongoose.model("Event", eventSchema);