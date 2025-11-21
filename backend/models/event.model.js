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
      type: String,
      required: function() {
        return (this.eventType === 'offline' || this.eventType === 'hybrid') && !this.isOnline;
      }
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
    
    // Media and branding
    bannerUrl: String,
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

    // Creator
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },

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
    }
  },
  { timestamps: true }
);

// Virtual for checking if event is currently live
eventSchema.virtual('isLive').get(function() {
  const now = new Date();
  return now >= this.startDate && now <= this.endDate;
});

// Virtual for event status
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
eventSchema.index({ slug: 1 });
eventSchema.index({ startDate: 1 });
eventSchema.index({ isFeatured: 1 });
eventSchema.index({ createdBy: 1 });
eventSchema.index({ "ticketSettings.autoGenerate": 1 });
eventSchema.index({ eventType: 1 }); // New index for event type filtering

module.exports = mongoose.model("Event", eventSchema);