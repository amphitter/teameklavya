const RegistrationForm = require("../models/registrationForm.model");
const RegistrationResponse = require("../models/registrationResponse.model");
const Event = require("../models/event.model");
const { notify } = require("../services/notification.service");
const User = require("../models/user.model");
const Ticket = require("../models/ticket.model");
const ticketService = require("../services/ticket.service");
const fs = require("fs");
const { Parser } = require("json2csv");
const { isValidObjectId } = require("mongoose");

// Check registration status
exports.getRegistrationStatus = async (req, res) => {
  try {
    const { eventId } = req.params;
    const userId = req.user.id;

    const response = await RegistrationResponse.findOne({ eventId, userId });
    
    res.json({ 
      success: true, 
      registered: !!response,
      response: response || null 
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get form for registration (Public)
// controllers/registration.controller.js
exports.getForm = async (req, res) => {
  try {
    const { eventId } = req.params;
    const event = await Event.findById(eventId);
    
    // Moderation takedowns (Part 3, Phase 10) accept no new registrations
    if (!event || event.removedAt) {
      return res.status(404).json({ message: "Event not found" });
    }

    // Private events: only the organizer/admin may fetch the form
    if (event.visibility === "private") {
      const { canManageEvent } = require("../middleware/auth.middleware");
      const authorized = await canManageEvent(req.user, event);
      if (!authorized) {
        return res.status(404).json({ message: "Event not found" });
      }
    }

    // Use event's registrationForm if it exists
    if (event.registrationForm && event.registrationForm.length > 0) {
      let preFilledFields = event.registrationForm;
      
      // Pre-fill from user profile if available
      if (req.user) {
        const user = await User.findById(req.user.id);
        if (user) {
          preFilledFields = event.registrationForm.map((field) => {
            if (field.autoFillFromProfile && user[field.autoFillFromProfile]) {
              return { 
                ...field.toObject ? field.toObject() : field, 
                value: user[field.autoFillFromProfile] 
              };
            }
            return { ...field.toObject ? field.toObject() : field, value: "" };
          });
        }
      }

      return res.json({ 
        success: true, 
        form: { 
          eventId, 
          fields: preFilledFields 
        } 
      });
    }

    // If no custom form exists, create default based on required profile fields
    const defaultFields = [
      { label: "Full Name", type: "text", required: true },
      { label: "Email", type: "email", required: true },
    ];

    if (event.requiredProfileFields?.institution) {
      defaultFields.push({ 
        label: "Institution/Organization", 
        type: "text", 
        required: true 
      });
    }
    if (event.requiredProfileFields?.course) {
      defaultFields.push({ 
        label: "Course/Program", 
        type: "text", 
        required: true 
      });
    }
    if (event.requiredProfileFields?.year) {
      defaultFields.push({ 
        label: "Academic Year", 
        type: "text", 
        required: true 
      });
    }

    res.json({ 
      success: true, 
      form: { 
        eventId, 
        fields: defaultFields 
      } 
    });
  } catch (error) {
    console.error("Get form error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Submit registration
// In controllers/registration.controller.js - Update the submitResponse function
exports.submitResponse = async (req, res) => {
  try {
    const { eventId, answers } = req.body;
    const userId = req.user.id;

    const event = await Event.findById(eventId);
    // Moderation takedown (Part 3, Phase 10): no new registrations
    if (!event || event.removedAt) return res.status(404).json({ message: "Event not found" });

    const existing = await RegistrationResponse.findOne({ eventId, userId });
    if (existing) return res.status(400).json({ message: "Already registered for this event" });

    // Private events are invite-only: participants are added by the organizer
    // (e.g. via RSVP). Self-registration is not allowed unless already invited.
    if (event.visibility === "private") {
      const { canManageEvent } = require("../middleware/auth.middleware");
      const authorized = await canManageEvent(req.user, event);
      if (!authorized) {
        return res.status(403).json({ message: "This event is invite-only" });
      }
    }

    // Check if event has reached max attendees
    const registrationCount = await RegistrationResponse.countDocuments({ eventId });
    if (event.maxAttendees && registrationCount >= event.maxAttendees) {
      return res.status(400).json({ message: "Event is full" });
    }

    const response = await RegistrationResponse.create({
      eventId,
      userId,
      answers,
      status: 'confirmed'
    });

    // Let the organizer know someone signed up
    notify({ user: event.createdBy, actor: userId, type: "event_registration", event: event._id });
    // Achievements: event_explorer (first real registration)
    require("../services/achievement.service").checkAchievements(userId);

    // Generate ticket based on event settings
    if (event.ticketSettings?.autoGenerate) {
      try {
        const ticketController = require('./ticket.controller');
        
        // Create ticket with appropriate settings
        const token = require("../utils/crypto").generateToken(32);
        const qrContent = JSON.stringify({
          ticketId: token,
          eventId,
          userId,
          type: "event-ticket",
        });

        const QRCode = require("qrcode");
        const qrCode = await QRCode.toDataURL(qrContent);

        const ticket = await Ticket.create({
          eventId,
          userId,
          qrCode,
          token,
          status: event.ticketSettings.manualApproval ? 'pending' : 'active',
          autoGenerated: true,
        });

        // Send email if not manual approval
        if (event.ticketSettings.sendEmail && !event.ticketSettings.manualApproval) {
          const user = await User.findById(userId);
          await ticketController.sendTicketEmail(ticket, user, event);
        }

        const message = event.ticketSettings.manualApproval ? 
          "Registration successful! Your ticket is pending approval." :
          "Registration successful! Your ticket has been emailed to you.";

        return res.status(201).json({ 
          success: true, 
          response,
          message
        });

      } catch (ticketError) {
        console.error("Auto-ticket generation failed:", ticketError);
        // Continue with registration even if ticket generation fails
      }
    }

    // If auto-generate is disabled
    res.status(201).json({ 
      success: true, 
      response,
      message: "Registration successful! Your ticket will be provided by the organizer."
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
// Get registration statistics for analytics
// Get registration statistics for analytics
exports.getRegistrationStats = async (req, res) => {
  try {
    const { id } = req.params;

    const totalRegistrations = await RegistrationResponse.countDocuments({ eventId: id });
    const confirmedRegistrations = await RegistrationResponse.countDocuments({ 
      eventId: id, 
      status: 'confirmed' 
    });
    const pendingRegistrations = await RegistrationResponse.countDocuments({ 
      eventId: id, 
      status: 'pending' 
    });

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const mongoose = require("mongoose");

    const dailyRegistrations = await RegistrationResponse.aggregate([
      {
        $match: {
          eventId: new mongoose.Types.ObjectId(id),
          createdAt: { $gte: thirtyDaysAgo }
        }
      },
      {
        $group: {
          _id: {
            date: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { "_id.date": 1 } }
    ]);

    const sourceAgg = await RegistrationResponse.aggregate([
      { $match: { eventId: new mongoose.Types.ObjectId(id) } },
      { $group: { _id: "$source", count: { $sum: 1 } } },
    ]);
    const sourceBreakdown = { web: 0, mobile: 0, admin: 0 };
    sourceAgg.forEach((row) => {
      const key = row._id || "web";
      sourceBreakdown[key] = (sourceBreakdown[key] || 0) + row.count;
    });

    res.json({
      success: true,
      stats: {
        totalRegistrations,
        confirmedRegistrations,
        pendingRegistrations,
        registrationRate: totalRegistrations > 0 ? (confirmedRegistrations / totalRegistrations) * 100 : 0,
        dailyRegistrations: dailyRegistrations.map(item => ({
          date: item._id.date,
          count: item.count
        })),
        sourceBreakdown
      }
    });
  } catch (error) {
    console.error("Get registration stats error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};


// Get all registration responses for an event
exports.getEventResponses = async (req, res) => {
  try {
    const { eventId } = req.params;
    
    const responses = await RegistrationResponse.find({ eventId })
      .populate("userId", "firstName lastName email profile")
      .sort({ createdAt: -1 });

    res.json({ success: true, responses });
  } catch (error) {
    console.error("Get event responses error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Export registrations to CSV
exports.exportRegistrations = async (req, res) => {
  try {
    const { eventId } = req.params;
    const responses = await RegistrationResponse.find({ eventId })
      .populate("userId", "firstName lastName email profile");

    if (responses.length === 0) {
      return res.status(404).json({ message: "No registrations found" });
    }

    // Transform data for CSV
    const jsonData = responses.map((r) => {
      const base = {
        "Registration Date": new Date(r.createdAt).toLocaleDateString(),
        "Name": `${r.userId.firstName} ${r.userId.lastName}`,
        "Email": r.userId.email,
        "Status": r.status,
        "Institution": r.userId.profile?.institution || 'N/A',
        "Course": r.userId.profile?.course || 'N/A',
        "Year": r.userId.profile?.year || 'N/A'
      };
      
      // Add custom form answers
      r.answers.forEach((ans) => {
        let value = ans.value;
        if (typeof value === 'object') value = JSON.stringify(value);
        if (typeof value === 'boolean') value = value ? 'Yes' : 'No';
        base[ans.fieldLabel] = value;
      });
      
      return base;
    });

    const json2csvParser = new Parser();
    const csv = json2csvParser.parse(jsonData);

    res.header("Content-Type", "text/csv");
    res.attachment(`registrations-${eventId}-${new Date().toISOString().split('T')[0]}.csv`);
    res.send(csv);
  } catch (error) {
    console.error("Export registrations error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get registration counts for multiple events
exports.getRegistrationCounts = async (req, res) => {
  try {
    const { eventIds } = req.body;
    
    if (!Array.isArray(eventIds)) {
      return res.status(400).json({ 
        success: false, 
        message: "eventIds must be an array" 
      });
    }

    const validEventIds = eventIds.filter(id => {
      return typeof id === 'string' && /^[0-9a-fA-F]{24}$/.test(id);
    });
    
    const counts = {};
    
    await Promise.all(
      validEventIds.map(async (eventId) => {
        try {
          const eventExists = await Event.exists({ _id: eventId });
          if (!eventExists) {
            counts[eventId] = 0;
            return;
          }
          
          const count = await RegistrationResponse.countDocuments({ eventId });
          counts[eventId] = count;
        } catch (error) {
          console.error(`Error counting registrations for event ${eventId}:`, error);
          counts[eventId] = 0;
        }
      })
    );

    res.json({ 
      success: true, 
      counts 
    });
  } catch (error) {
    console.error("Get registration counts error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get registration count for single event
exports.getRegistrationCount = async (req, res) => {
  try {
    const { eventId } = req.params;
    
    const count = await RegistrationResponse.countDocuments({ eventId });
    
    res.json({ 
      success: true, 
      count 
    });
  } catch (error) {
    console.error("Get registration count error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Admin creates a form for an event
exports.createForm = async (req, res) => {
  try {
    const { eventId, fields } = req.body;

    const event = await Event.findById(eventId);
    if (!event) return res.status(404).json({ message: "Event not found" });

    // Update or create form
    const form = await RegistrationForm.findOneAndUpdate(
      { eventId },
      { eventId, fields, createdBy: req.user.id },
      { upsert: true, new: true }
    );

    res.status(201).json({ success: true, form });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
// Get the events a user has registered for
exports.getUserEvents = async (req, res) => {
  try {
    const userId = req.user.id;
    const responses = await RegistrationResponse.find({ userId })
      .populate("eventId")
      .sort({ createdAt: -1 });

    const events = responses
      .map((response) => response.eventId)
      .filter(Boolean);

    res.json({ success: true, events });
  } catch (error) {
    console.error("Get user events error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};
