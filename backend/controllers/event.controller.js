const Event = require("../models/event.model");
const Organization = require("../models/organization.model");
const User = require("../models/user.model");
const RegistrationResponse = require("../models/registrationResponse.model");
const EventInterest = require("../models/eventInterest.model");
const OrgFollow = require("../models/orgFollow.model");
const Ticket = require("../models/ticket.model");
const mongoose = require('mongoose');
const crypto = require('crypto');
const emailService = require("../services/email.service");
const { notifyMany } = require("../services/notification.service");
const templates = require("../services/emailTemplates");
const { canManageEvent } = require("../middleware/auth.middleware");
const Post = require("../models/post.model");
const Reaction = require("../models/reaction.model");
const Comment = require("../models/comment.model");
const { EventRepository, PostRepository } = require("../repositories");

// ─── Visibility helpers ─────────────────────────────────────
const VISIBILITY_LEVELS = ["public", "unlisted", "private"];

/**
 * Strip organizer-sensitive / credential fields before returning an event
 * through a public endpoint.
 *
 * Single source of truth (Part 5, Phase 3): this lives in EventRepository
 * because the cache now stores the redacted projection. If the controller
 * kept its own copy, a cached event and a freshly-loaded event could silently
 * diverge in what they expose.
 */
const toPublicEvent = EventRepository.toPublicEvent;

const getEventLocationHTML = (event) => {
  switch (event.eventType) {
    case 'online':
      return `<p><strong>🌐 Platform:</strong> ${event.platform || 'Online'}</p>
              ${event.onlineEventLink ? `<p><strong>🔗 Event Link:</strong> <a href="${event.onlineEventLink}">Join Online</a></p>` : ''}`;
    case 'offline':
      return `<p><strong>📍 Venue:</strong> ${event.venue}</p>`;
    case 'hybrid':
      return `<p><strong>📍 Venue:</strong> ${event.venue}</p>
              ${event.onlineEventLink ? `<p><strong>🌐 Online Option:</strong> <a href="${event.onlineEventLink}">Join Online</a></p>` : ''}`;
    default:
      return `<p><strong>📍 Venue:</strong> ${event.venue}</p>`;
  }
};

exports.createEvent = async (req, res) => {
  try {
    const body = req.body || {};
    
    // Validate organization attachment (if any)
    if (body.organization) {
      const org = await Organization.findById(body.organization);
      if (!org) {
        return res.status(400).json({ success: false, message: "Organization not found" });
      }
    }

    // Validate community attachment (Phase 6) — must exist and not be deleted
    if (body.community) {
      const community = await Community.findById(body.community).select("deletedAt").lean();
      if (!community || community.deletedAt) {
        return res.status(400).json({ success: false, message: "Community not found" });
      }
    }

    // Validate visibility
    if (body.visibility && !VISIBILITY_LEVELS.includes(body.visibility)) {
      return res.status(400).json({
        success: false,
        message: "Visibility must be 'public', 'unlisted', or 'private'",
      });
    }

    // Validate event type and related fields
    if (!body.eventType || !['online', 'offline', 'hybrid'].includes(body.eventType)) {
      return res.status(400).json({ 
        success: false, 
        message: "Event type must be 'online', 'offline', or 'hybrid'" 
      });
    }

    // Validate required fields based on event type
    if ((body.eventType === 'offline' || body.eventType === 'hybrid') && !body.venue) {
      return res.status(400).json({ 
        success: false, 
        message: "Venue is required for offline and hybrid events" 
      });
    }

    if ((body.eventType === 'online' || body.eventType === 'hybrid') && !body.onlineEventLink) {
      return res.status(400).json({ 
        success: false, 
        message: "Online event link is required for online and hybrid events" 
      });
    }

    // Set default ticket settings if not provided
    if (!body.ticketSettings) {
      body.ticketSettings = {
        autoGenerate: false,
        sendEmail: true,
        manualApproval: false,
      };
    }

    // Set default required profile fields if not provided
    if (!body.requiredProfileFields) {
      body.requiredProfileFields = {
        institution: false,
        course: false,
        year: false,
      };
    }

    // Set default registration form if not provided
    if (!body.registrationForm) {
      body.registrationForm = [];
    }

    // Validate and sanitize registration form fields
    if (body.registrationForm && Array.isArray(body.registrationForm)) {
      body.registrationForm = body.registrationForm.map(field => ({
        label: field.label || '',
        type: field.type || 'text',
        required: Boolean(field.required),
        options: Array.isArray(field.options) ? field.options : [],
        autoFillFromProfile: field.autoFillFromProfile || null
      }));
    }

    // Generate slug if not provided
    if (!body.slug && body.title) {
      body.slug = body.title.toLowerCase().replace(/\s+/g, "-").replace(/[^\w-]+/g, "");
    }
    
    const event = await Event.create({ 
      ...body, 
      createdBy: req.user.id 
    });

    // Achievements: event_host (first real event created)
    require("../services/achievement.service").checkAchievements(req.user.id);

    // Organizations v2: notify the org's followers about the new event
    // (in-app only, create-time only — deterministic, no spam on edits)
    if (event.organization) {
      try {
        const followers = await OrgFollow.find({ organization: event.organization }).select("user").lean();
        const docs = followers
          .map((f) => f.user)
          .filter((uid) => String(uid) !== String(req.user.id))
          .map((user) => ({ user, actor: req.user.id, type: "announcement", event: event._id }));
        if (docs.length) await notifyMany(docs);
      } catch (notifyErr) {
        console.error("Org followers notify error:", notifyErr.message); // never fail creation
      }
    }
    
    res.status(201).json({ success: true, event });
  } catch (error) {
    console.error("Create Event Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Public: Get all events (paginated optional)
exports.getEvents = async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 12, 
      category, 
      featured, 
      type = 'all',
      q,          // free-text search
      eventType,  // filter for event type
      price       // 'free' | 'paid' (Explore filter)
    } = req.query;
    
    let query = {};

    // Free-text search across title, description, venue and organizer
    if (q && String(q).trim()) {
      const escaped = String(q).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      query.$or = [
        { title: { $regex: escaped, $options: "i" } },
        { description: { $regex: escaped, $options: "i" } },
        { venue: { $regex: escaped, $options: "i" } },
        { organizer: { $regex: escaped, $options: "i" } },
        { category: { $regex: escaped, $options: "i" } },
      ];
    }
    
    // Category filter
    if (category && category !== 'all') {
      query.category = category;
    }
    
    // Featured filter
    if (featured === 'true') {
      query.isFeatured = true;
    }
    
    // Event type filter
    if (eventType && eventType !== 'all') {
      query.eventType = eventType;
    }
    
    // Event type filter - FIXED: Include all events by default
    const now = new Date();
    if (type === 'upcoming') {
      query.endDate = { $gte: now };
    } else if (type === 'ongoing') {
      // Live right now: started but not ended
      query.startDate = { $lte: now };
      query.endDate = { $gte: now };
    } else if (type === 'past') {
      query.endDate = { $lt: now };
    }
    // If type is 'all' or not provided, don't filter by date

    // Price filter (Explore)
    if (price === 'free') {
      query.price = { $lte: 0 };
    } else if (price === 'paid') {
      query.price = { $gt: 0 };
    }

    // Discovery only ever shows PUBLIC events.
    // Unlisted events are reachable via direct link; private via invitation.
    query.visibility = 'public';
    // Moderation takedowns (Part 3, Phase 10) are hidden from discovery
    query.removedAt = null;

    const events = await Event.find(query)
      .select('title slug description category venue venueIframeLink eventType startDate endDate startTime endTime bannerUrl organizer price theme isFeatured visibility maxAttendees')
      .sort({ startDate: 1 })
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit));
    
    const total = await Event.countDocuments(query);
    
    // Add event status for frontend
    const eventsWithStatus = events.map(event => ({
      ...event.toObject(),
      status: new Date(event.endDate) < now ? 'past' : 
             new Date(event.startDate) <= now ? 'ongoing' : 'upcoming'
    }));
    
    res.json({ 
      success: true, 
      events: eventsWithStatus,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error("Get Events Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Public: distinct categories (discovery filters)
exports.getEventCategories = async (_req, res) => {
  try {
    const categories = await Event.distinct("category", { visibility: "public" });
    res.json({ success: true, categories: categories.filter(Boolean).sort() });
  } catch (error) {
    console.error("Get categories error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Public: get by slug (unlisted reachable by link; private needs organizer/admin rights)
exports.getEventBySlug = async (req, res) => {
  try {
    // Cache-first public lookup (Part 5, Phase 3 — §9, §14).
    // Public event pages are the hottest read in EventHub and are identical
    // for every viewer, so a hit costs ZERO database queries. Private events
    // are deliberately never cached: their visibility depends on the caller.
    const event = await EventRepository.publicBySlug(req.params.slug);
    if (!event) return res.status(404).json({ success: false, message: "Event not found" });

    if (event.visibility === "private") {
      const authorized = await canManageEvent(req.user, event);
      if (!authorized) {
        // Do not reveal that a private event exists
        return res.status(404).json({ success: false, message: "Event not found" });
      }
      return res.json({ success: true, event }); // full document for the organizer
    }

    // Already the redacted public projection — do not re-strip.
    res.json({ success: true, event });
  } catch (error) {
    console.error("Get event by slug error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Admin: get by id
exports.getEventById = async (req, res) => {
  try {
    const event = await Event.findById(req.params.id).populate("organization", "name slug logoUrl");
    if (!event) return res.status(404).json({ success: false, message: "Event not found" });
    res.json({ success: true, event });
  } catch (error) {
    console.error("Get event by id error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Update event (Admin)
exports.updateEvent = async (req, res) => {
  try {
    const body = req.body || {};
    
    // Validate visibility if being updated
    if (body.visibility && !VISIBILITY_LEVELS.includes(body.visibility)) {
      return res.status(400).json({
        success: false,
        message: "Visibility must be 'public', 'unlisted', or 'private'",
      });
    }

    // Never allow these sensitive fields to be mass-assigned from the client
    delete body.checkIns;
    delete body.bannerPublicId;

    // Validate community attachment (Phase 6)
    if (body.community) {
      const community = await Community.findById(body.community).select("deletedAt").lean();
      if (!community || community.deletedAt) {
        return res.status(400).json({ success: false, message: "Community not found" });
      }
    }

    // Validate event type if being updated
    if (body.eventType && !['online', 'offline', 'hybrid'].includes(body.eventType)) {
      return res.status(400).json({ 
        success: false, 
        message: "Event type must be 'online', 'offline', or 'hybrid'" 
      });
    }

    // Update slug if title changed
    if (body.title) {
      body.slug = body.title.toLowerCase().replace(/\s+/g, "-").replace(/[^\w-]+/g, "");
    }
    
    // Ensure ticketSettings structure
    if (body.ticketSettings && typeof body.ticketSettings === 'object') {
      body.ticketSettings = {
        autoGenerate: body.ticketSettings.autoGenerate || false,
        sendEmail: body.ticketSettings.sendEmail !== undefined ? body.ticketSettings.sendEmail : true,
        manualApproval: body.ticketSettings.manualApproval || false,
      };
    }
    
    const event = await Event.findByIdAndUpdate(req.params.id, body, { new: true });
    if (!event) return res.status(404).json({ success: false, message: "Event not found" });

    // Event update → notify registered participants + interested users (soft-follow),
    // deduped, never the actor themself. Real audience only.
    try {
      const [regUsers, intUsers] = await Promise.all([
        RegistrationResponse.find({ eventId: event._id }).select("userId").lean(),
        EventInterest.find({ event: event._id }).select("user").lean(),
      ]);
      const audience = [
        ...new Set(
          [...regUsers.map((r) => String(r.userId)), ...intUsers.map((i) => String(i.user))].filter(
            (id) => id !== String(req.user.id)
          )
        ),
      ];
      if (audience.length) {
        await notifyMany(
          audience.map((user) => ({ user, actor: req.user.id, type: "event_update", event: event._id }))
        );
      }
    } catch (notifyErr) {
      console.error("Event update notify error:", notifyErr.message); // never fail the update itself
    }

    // §13 — drop every cached view of this event, or visitors keep being
    // served the pre-edit page until the TTL expires.
    EventRepository.invalidate(event);

    res.json({ success: true, event });
  } catch (error) {
    console.error("Update event error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get admin events with advanced filtering
exports.getAdminEvents = async (req, res) => {
  try {
    const { search, category, page = 1, limit = 50, status, eventType } = req.query;
    
    let query = {};
    
    // Search filter
    if (search && search.trim() !== '') {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { venue: { $regex: search, $options: 'i' } },
        { organizer: { $regex: search, $options: 'i' } },
        { slug: { $regex: search, $options: 'i' } }
      ];
    }
    
    // Category filter
    if (category && category !== 'all') {
      query.category = category;
    }

    // Event type filter
    if (eventType && eventType !== 'all') {
      query.eventType = eventType;
    }
    
    // Status filter
    if (status && status !== 'all') {
      const now = new Date();
      switch (status) {
        case 'upcoming':
          query.startDate = { $gt: now };
          break;
        case 'ongoing':
          query.startDate = { $lte: now };
          query.endDate = { $gte: now };
          break;
        case 'past':
          query.endDate = { $lt: now };
          break;
        case 'featured':
          query.isFeatured = true;
          break;
      }
    }
    
    // Moderation takedowns (Part 3, Phase 10) are hidden from event lists
    query.removedAt = null;
    const events = await Event.find(query)
      .select('-description -schedule -speakers -benefits -partners -checkIns') // Exclude heavy fields
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit));
    
    const total = await Event.countDocuments(query);
    
    res.json({ 
      success: true, 
      events,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error("Get admin events error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Delete event (Admin)
exports.deleteEvent = async (req, res) => {
  try {
    const event = await Event.findByIdAndDelete(req.params.id);
    if (!event) return res.status(404).json({ success: false, message: "Event not found" });
    // §13 — a deleted event must vanish from discovery immediately.
    EventRepository.invalidate(event);
    res.json({ success: true, message: "Event deleted" });
  } catch (error) {
    console.error("Delete event error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Send RSVP to selected users (Admin)
exports.sendRSVP = async (req, res) => {
  try {
    const { eventId, userIds, rsvpLink } = req.body;
    const event = await Event.findById(eventId);
    if (!event) return res.status(404).json({ success: false, message: "Event not found" });

    const users = await User.find({ _id: { $in: userIds } });
    if (!users.length) return res.status(404).json({ success: false, message: "No users found" });

    const note = event.ticketSettings?.autoGenerate
      ? "Your ticket will be generated automatically after you register."
      : "Tickets are issued after registration approval.";

    const results = [];
    for (const user of users) {
      try {
        const { html, text } = templates.eventInvitation({ user, event, ctaUrl: rsvpLink, note });
        await emailService.send({ to: user.email, subject: `Invitation: ${event.title}`, html, text });
        results.push({ userId: user._id, email: user.email, status: "sent" });
      } catch (err) {
        console.error(`Failed to send RSVP to ${user.email}:`, err.message);
        results.push({ userId: user._id, email: user.email, status: "failed", error: err.message });
      }
    }

    const successful = results.filter((r) => r.status === "sent").length;
    const failed = results.filter((r) => r.status === "failed").length;
    res.json({ success: true, message: `RSVP process completed: ${successful} sent, ${failed} failed`, results });
  } catch (error) {
    console.error("sendRSVP error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Send event announcement to all users (batched)
exports.sendEventNotificationToAllUsers = async (req, res) => {
  try {
    const { id } = req.params;
    const event = await Event.findById(id);
    if (!event) return res.status(404).json({ success: false, message: "Event not found" });

    const users = await User.find({}, "email firstName lastName");
    if (!users.length) return res.status(404).json({ success: false, message: "No users found" });

    const eventUrl = `${process.env.FRONTEND_URL}/events/${event.slug}`;
    let sentCount = 0;
    let failedCount = 0;

    const batchSize = 50;
    for (let i = 0; i < users.length; i += batchSize) {
      const batch = users.slice(i, i + batchSize);
      await Promise.all(
        batch.map(async (user) => {
          try {
            const { html, text } = templates.eventAnnouncement({ user, event, eventUrl });
            await emailService.send({
              to: user.email,
              subject: `New event on EventHub: ${event.title}`,
              html,
              text,
            });
            sentCount++;
          } catch (err) {
            console.error(`Failed to notify ${user.email}:`, err.message);
            failedCount++;
          }
        })
      );
    }

    // Mirror the email as an in-app notification (skip the sender themself)
    await notifyMany(
      users
        .filter((u) => String(u._id) !== String(req.user.id))
        .map((u) => ({ user: u._id, actor: req.user.id, type: "announcement", event: event._id }))
    );

    res.json({ success: true, message: `Notification sent: ${sentCount} sent, ${failedCount} failed`, sentCount, failedCount });
  } catch (error) {
    console.error("sendEventNotificationToAllUsers error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

const generateRSVPToken = () => {
  return crypto.randomBytes(32).toString('hex');
};

// Send RSVP to registered students with tickets
// Send RSVP to registered students with tickets
exports.sendRSVPWithVerification = async (req, res) => {
  try {
    const { eventId, userIds, customMessage } = req.body;
    const event = await Event.findById(eventId);
    if (!event) return res.status(404).json({ success: false, message: "Event not found" });

    const users = await User.find({ _id: { $in: userIds } });
    if (!users.length) return res.status(404).json({ success: false, message: "No users found" });

    const results = [];

    for (const user of users) {
      try {
        let registration = await RegistrationResponse.findOne({ eventId, userId: user._id });

        if (!registration) {
          registration = await RegistrationResponse.create({
            eventId,
            userId: user._id,
            rsvpToken: generateRSVPToken(),
            rsvpVerificationExpires: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
          });
        } else {
          registration.rsvpToken = generateRSVPToken();
          registration.rsvpVerificationExpires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
          registration.rsvpVerified = false;
          registration.rsvpVerifiedAt = null;
          await registration.save();
        }

        const verificationLink = `${process.env.FRONTEND_URL}/rsvp/verify/${registration.rsvpToken}`;
        const { html, text } = templates.rsvpVerification({ user, event, verificationLink, customMessage });

        await emailService.send({
          to: user.email,
          subject: `RSVP: ${event.title}`,
          html,
          text,
        });

        registration.rsvpSent = true;
        registration.rsvpSentAt = new Date();
        await registration.save();

        results.push({ userId: user._id, email: user.email, status: "sent" });
      } catch (err) {
        console.error(`Failed to send RSVP to ${user.email}:`, err.message);
        results.push({ userId: user._id, email: user.email, status: "failed", error: err.message });
      }
    }

    const successful = results.filter((r) => r.status === "sent").length;
    const failed = results.filter((r) => r.status === "failed").length;
    res.json({ success: true, message: `RSVP process completed: ${successful} sent, ${failed} failed`, results });
  } catch (error) {
    console.error("sendRSVPWithVerification error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.verifyRSVP = async (req, res) => {
  try {
    const { token } = req.params;
    
    const registration = await RegistrationResponse.findOne({
      rsvpToken: token,
      rsvpVerificationExpires: { $gt: new Date() }
    }).populate('eventId').populate('userId');

    if (!registration) {
      return res.status(400).json({ 
        success: false, 
        message: "Invalid or expired verification link" 
      });
    }

    if (registration.rsvpVerified) {
      return res.status(400).json({ 
        success: false, 
        message: "RSVP already verified" 
      });
    }

    // Update registration
    registration.rsvpVerified = true;
    registration.rsvpVerifiedAt = new Date();
    registration.status = 'confirmed';
    registration.rsvpToken = null; // Clear token after verification
    await registration.save();

    // Generate ticket if auto-generation is enabled
    let ticket = null;
    const event = await Event.findById(registration.eventId);
    
    if (event.ticketSettings?.autoGenerate) {
      ticket = await Ticket.findOne({
        eventId: registration.eventId,
        userId: registration.userId
      });

      if (!ticket) {
        ticket = await Ticket.create({
          eventId: registration.eventId,
          userId: registration.userId,
          status: 'active',
          autoGenerated: true,
          emailSent: event.ticketSettings.sendEmail
        });

        // Send ticket email if enabled
        if (event.ticketSettings.sendEmail) {
          // You'll need to implement sendTicketEmail function
          await sendTicketEmail(ticket, registration.userId, event);
        }
      }
    }

    res.json({ 
      success: true, 
      message: "RSVP confirmed successfully!",
      registration: {
        event: registration.eventId,
        user: registration.userId,
        verifiedAt: registration.rsvpVerifiedAt
      },
      ticketGenerated: !!ticket
    });
  } catch (error) {
    console.error("Verify RSVP error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get RSVP analytics
exports.getRSVPAnalytics = async (req, res) => {
  try {
    const { id } = req.params;
    
    const [
      totalRegistrations,
      rsvpSent,
      rsvpVerified,
      rsvpExpired,
      pendingVerification
    ] = await Promise.all([
      RegistrationResponse.countDocuments({ eventId: id }),
      RegistrationResponse.countDocuments({ eventId: id, rsvpSent: true }),
      RegistrationResponse.countDocuments({ eventId: id, rsvpVerified: true }),
      RegistrationResponse.countDocuments({ 
        eventId: id, 
        rsvpSent: true,
        rsvpVerified: false,
        rsvpVerificationExpires: { $lt: new Date() }
      }),
      RegistrationResponse.countDocuments({ 
        eventId: id, 
        rsvpSent: true,
        rsvpVerified: false,
        rsvpVerificationExpires: { $gt: new Date() }
      })
    ]);

    const analytics = {
      totalRegistrations,
      rsvp: {
        sent: rsvpSent,
        verified: rsvpVerified,
        expired: rsvpExpired,
        pending: pendingVerification,
        sentRate: totalRegistrations > 0 ? (rsvpSent / totalRegistrations) * 100 : 0,
        verificationRate: rsvpSent > 0 ? (rsvpVerified / rsvpSent) * 100 : 0,
        responseRate: totalRegistrations > 0 ? (rsvpVerified / totalRegistrations) * 100 : 0
      },
      timeline: {
        // You can add timeline data here for verification patterns
        last7Days: await getRSVPTimelineData(id, 7),
        last30Days: await getRSVPTimelineData(id, 30)
      }
    };

    res.json({ success: true, analytics });
  } catch (error) {
    console.error("Get RSVP analytics error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Helper function to get RSVP timeline data
const getRSVPTimelineData = async (eventId, days) => {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  
  const data = await RegistrationResponse.aggregate([
    {
      $match: {
        eventId: new mongoose.Types.ObjectId(eventId),
        rsvpVerifiedAt: { $gte: startDate }
      }
    },
    {
      $group: {
        _id: {
          $dateToString: {
            format: "%Y-%m-%d",
            date: "$rsvpVerifiedAt"
          }
        },
        count: { $sum: 1 }
      }
    },
    {
      $sort: { _id: 1 }
    }
  ]);
  
  return data;
};

// Get event statistics (Admin)
exports.getEventStats = async (req, res) => {
  try {
    const { id } = req.params;
    
    const event = await Event.findById(id);
    if (!event) return res.status(404).json({ success: false, message: "Event not found" });

    const [
      totalRegistrations,
      totalTickets,
      checkedInTickets,
      pendingTickets,
      rsvpSentCount
    ] = await Promise.all([
      RegistrationResponse.countDocuments({ eventId: id }),
      Ticket.countDocuments({ eventId: id }),
      Ticket.countDocuments({ eventId: id, checkedIn: true }),
      Ticket.countDocuments({ eventId: id, status: 'pending' }),
      RegistrationResponse.countDocuments({ eventId: id, rsvpSent: true })
    ]);

    const stats = {
      registrations: {
        total: totalRegistrations,
        withTickets: totalTickets,
        ticketCoverage: totalRegistrations > 0 ? (totalTickets / totalRegistrations) * 100 : 0,
        rsvpSent: rsvpSentCount,
        rsvpRate: totalRegistrations > 0 ? (rsvpSentCount / totalRegistrations) * 100 : 0
      },
      attendance: {
        checkedIn: checkedInTickets,
        attendanceRate: totalTickets > 0 ? (checkedInTickets / totalTickets) * 100 : 0
      },
      tickets: {
        total: totalTickets,
        pending: pendingTickets,
        active: totalTickets - pendingTickets
      },
      capacity: {
        max: event.maxAttendees,
        used: checkedInTickets,
        remaining: Math.max(0, event.maxAttendees - checkedInTickets),
        usageRate: event.maxAttendees > 0 ? (checkedInTickets / event.maxAttendees) * 100 : 0
      }
    };

    res.json({ success: true, stats });
  } catch (error) {
    console.error("Get event stats error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Update event ticket settings (Admin)
exports.updateTicketSettings = async (req, res) => {
  try {
    const { id } = req.params;
    const { ticketSettings } = req.body;

    if (!ticketSettings || typeof ticketSettings !== 'object') {
      return res.status(400).json({ 
        success: false, 
        message: "Valid ticketSettings object is required" 
      });
    }

    const event = await Event.findByIdAndUpdate(
      id,
      { 
        ticketSettings: {
          autoGenerate: ticketSettings.autoGenerate || false,
          sendEmail: ticketSettings.sendEmail !== undefined ? ticketSettings.sendEmail : true,
          manualApproval: ticketSettings.manualApproval || false,
        }
      },
      { new: true }
    );

    if (!event) {
      return res.status(404).json({ success: false, message: "Event not found" });
    }

    res.json({
      success: true,
      event,
      message: "Ticket settings updated successfully"
    });
  } catch (error) {
    console.error("Update ticket settings error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get events with ticket generation stats (Admin)
exports.getEventsWithTicketStats = async (req, res) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    
    const events = await Event.find()
      .select('title slug startDate endDate venue organizer maxAttendees ticketSettings createdAt eventType onlineEventLink platform')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit));
    
    const eventsWithStats = await Promise.all(
      events.map(async (event) => {
        const [totalTickets, totalRegistrations, pendingTickets, rsvpSentCount] = await Promise.all([
          Ticket.countDocuments({ eventId: event._id }),
          RegistrationResponse.countDocuments({ eventId: event._id }),
          Ticket.countDocuments({ eventId: event._id, status: 'pending' }),
          RegistrationResponse.countDocuments({ eventId: event._id, rsvpSent: true })
        ]);
        
        return {
          ...event.toObject(),
          stats: {
            totalTickets,
            totalRegistrations,
            pendingTickets,
            rsvpSentCount,
            ticketCoverage: totalRegistrations > 0 ? (totalTickets / totalRegistrations) * 100 : 0,
            rsvpRate: totalRegistrations > 0 ? (rsvpSentCount / totalRegistrations) * 100 : 0
          }
        };
      })
    );
    
    const total = await Event.countDocuments();
    
    res.json({ 
      success: true, 
      events: eventsWithStats,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error("Get events with ticket stats error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get public participants of an event (minimal fields — no emails)
exports.getEventParticipants = async (req, res) => {
  try {
    const { id } = req.params;
    const responses = await RegistrationResponse.find({ eventId: id, status: 'confirmed' })
      .populate('userId', 'firstName lastName profile')
      .sort({ createdAt: 1 })
      .limit(50)
      .lean();

    const participants = responses
      .filter((r) => r.userId)
      .map((r) => ({
        _id: r.userId._id,
        firstName: r.userId.firstName || 'Member',
        lastName: r.userId.lastName ? `${r.userId.lastName[0]}.` : '',
        avatar: r.userId.profile?.avatar || null,
      }));

    res.json({ success: true, participants, total: participants.length });
  } catch (error) {
    console.error("Get participants error:", error.message);
    res.status(500).json({ success: false, message: "Failed to load participants" });
  }
};

/*
 * TRENDING (Part 3 §34) — deterministic, documented:
 *   score = 2 × registrations + 1 × recent post engagement (likes + comments
 *   on the event's posts in the last 30 days). Same data, same order —
 *   no ML, no randomization. Pool: public upcoming/ongoing events.
 */
// GET /api/events/trending?limit=6
exports.getTrendingEvents = async (req, res) => {
  try {
    const limit = Math.min(12, Math.max(1, parseInt(req.query.limit) || 6));
    const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);

    const events = await Event.find({
      visibility: "public",
      endDate: { $gte: new Date(Date.now() - 24 * 3600 * 1000) },
    })
      .select("title slug bannerUrl category venue eventType startDate endDate price isFeatured")
      .sort({ createdAt: -1 })
      .limit(80)
      .lean();
    if (!events.length) return res.json({ success: true, events: [] });

    const [regAgg, likeAgg, commentAgg] = await Promise.all([
      RegistrationResponse.aggregate([{ $group: { _id: "$eventId", count: { $sum: 1 } } }]),
      Reaction.aggregate([
        { $match: { createdAt: { $gte: since } } },
        { $lookup: { from: "posts", localField: "post", foreignField: "_id", as: "pd" } },
        { $unwind: "$pd" },
        { $match: { "pd.event": { $ne: null } } },
        { $group: { _id: "$pd.event", count: { $sum: 1 } } },
      ]),
      Comment.aggregate([
        { $match: { createdAt: { $gte: since } } },
        { $lookup: { from: "posts", localField: "post", foreignField: "_id", as: "pd" } },
        { $unwind: "$pd" },
        { $match: { "pd.event": { $ne: null } } },
        { $group: { _id: "$pd.event", count: { $sum: 1 } } },
      ]),
    ]);

    const regMap = new Map(regAgg.map((r) => [String(r._id), r.count]));
    const likeMap = new Map(likeAgg.map((r) => [String(r._id), r.count]));
    const commentMap = new Map(commentAgg.map((r) => [String(r._id), r.count]));

    const scored = events
      .map((e) => {
        const id = String(e._id);
        const regs = regMap.get(id) || 0;
        const engagement = (likeMap.get(id) || 0) + (commentMap.get(id) || 0);
        return { ...e, participantCount: regs, trendScore: regs * 2 + engagement };
      })
      .sort((a, b) => b.trendScore - a.trendScore || +new Date(a.startDate) - +new Date(b.startDate))
      .slice(0, limit);

    res.json({ success: true, events: scored });
  } catch (error) {
    console.error("Trending events error:", error.message);
    res.status(500).json({ success: false, message: "Failed to load trending events" });
  }
};

/*
 * EVENT INTEREST (Part 3, Phase 5)
 * "Interested" is a lightweight, public soft-follow on an event — distinct
 * from registration. Interested users receive event update notifications.
 */
// GET /api/events/:id/interest — real state for the CTA (count + mine + preview)
exports.getEventInterest = async (req, res) => {
  try {
    const eventId = req.params.id;
    const event = await Event.findById(eventId).select("visibility createdBy").lean();
    if (!event) return res.status(404).json({ success: false, message: "Event not found" });

    // Private events are invisible to non-managers — never reveal interest data
    if (event.visibility === "private") {
      const authorized = await canManageEvent(req.user, { _id: eventId });
      if (!authorized) return res.status(404).json({ success: false, message: "Event not found" });
    }

    const [count, mine, preview] = await Promise.all([
      EventInterest.countDocuments({ event: eventId }),
      req.user ? EventInterest.findOne({ event: eventId, user: req.user.id }).lean() : null,
      EventInterest.find({ event: eventId })
        .sort({ createdAt: -1 })
        .limit(8)
        .populate("user", "firstName lastName username profile.avatar")
        .lean(),
    ]);

    res.json({
      success: true,
      count,
      interested: Boolean(mine),
      preview: preview.map((p) => p.user).filter(Boolean),
    });
  } catch (error) {
    console.error("Get event interest error:", error.message);
    res.status(500).json({ success: false, message: "Failed to load interest" });
  }
};

// POST /api/events/:id/interest — toggle (requireAuth)
exports.toggleEventInterest = async (req, res) => {
  try {
    const eventId = req.params.id;
    const event = await Event.findById(eventId).select("visibility removedAt");
    if (!event || event.removedAt) return res.status(404).json({ success: false, message: "Event not found" });

    if (event.visibility === "private") {
      const authorized = await canManageEvent(req.user, event);
      if (!authorized) return res.status(404).json({ success: false, message: "Event not found" });
    }

    const existing = await EventInterest.findOne({ event: eventId, user: req.user.id });
    if (existing) {
      await existing.deleteOne();
      PostRepository.invalidateFeedContext(req.user.id);
      EventRepository.invalidate({ _id: eventId });
      const count = await EventInterest.countDocuments({ event: eventId });
      return res.json({ success: true, interested: false, count });
    }

    await EventInterest.create({ event: eventId, user: req.user.id });
    // §13 — interest feeds the "Following"/"For you" ranking, so the viewer's
    // cached social graph is now stale.
    PostRepository.invalidateFeedContext(req.user.id);
    EventRepository.invalidate({ _id: eventId }); // interest count changed
    const count = await EventInterest.countDocuments({ event: eventId });
    res.json({ success: true, interested: true, count });
  } catch (error) {
    console.error("Toggle event interest error:", error.message);
    res.status(500).json({ success: false, message: "Failed to update interest" });
  }
};

/*
 * FOR-YOU EVENTS (Part 3, Phase 5) — deterministic, no ML:
 *   +4  events by organizations I follow
 *   +2  events by organizations behind events I registered for
 *   +3  event category matches one of my profile interests
 * Excluded: events I already registered for, private/unlisted events,
 * events already past, and events whose capacity is full.
 * Tie-break: earliest start date, then id — stable across requests.
 */
// GET /api/events/for-you?limit=6 (requireAuth)
exports.getEventsForYou = async (req, res) => {
  try {
    const me = req.user.id;
    const limit = Math.min(12, Math.max(1, parseInt(req.query.limit) || 6));

    const [meDoc, myRegs, orgFollows] = await Promise.all([
      User.findById(me).select("interests").lean(),
      RegistrationResponse.find({ userId: me }).select("eventId").lean(),
      OrgFollow.find({ user: me }).select("organization").lean(),
    ]);

    const registeredIds = myRegs.map((r) => r.eventId);
    const followedOrgSet = new Set(orgFollows.map((f) => String(f.organization)));

    // Orgs behind my registered events (frequent organizer of my events)
    const regEventOrgs = await Event.find({ _id: { $in: registeredIds }, organization: { $ne: null } })
      .select("organization")
      .lean();
    const regOrgSet = new Set(regEventOrgs.map((e) => String(e.organization)));

    const interests = new Set((meDoc?.interests || []).map((t) => String(t).toLowerCase()));

    // Candidate pool: public, not over, not already mine — latest 120
    const candidates = await Event.find({
      visibility: "public",
      endDate: { $gte: new Date(Date.now() - 24 * 3600 * 1000) },
      ...(registeredIds.length ? { _id: { $nin: registeredIds } } : {}),
    })
      .sort({ createdAt: -1 })
      .limit(120)
      .select("title slug bannerUrl description category eventType venue platform startDate endDate price maxAttendees isFeatured organization")
      .populate("organization", "name slug logoUrl")
      .lean();

    // Real registration counts for capacity + display
    const counts = await RegistrationResponse.aggregate([
      { $match: { eventId: { $in: candidates.map((c) => c._id) } } },
      { $group: { _id: "$eventId", count: { $sum: 1 } } },
    ]);
    const countMap = new Map(counts.map((c) => [String(c._id), c.count]));

    const scored = candidates
      .filter((e) => {
        const n = countMap.get(String(e._id)) || 0;
        return !(e.maxAttendees && e.maxAttendees > 0 && n >= e.maxAttendees); // drop full events
      })
      .map((e) => {
        const orgId = e.organization ? String(e.organization._id) : null;
        let score = 0;
        if (orgId && followedOrgSet.has(orgId)) score += 4;
        if (orgId && regOrgSet.has(orgId)) score += 2;
        if (interests.has(String(e.category || "").toLowerCase())) score += 3;
        return { e, score, participants: countMap.get(String(e._id)) || 0 };
      });

    scored.sort(
      (a, b) => b.score - a.score || String(a.e.startDate).localeCompare(String(b.e.startDate)) || String(a.e._id).localeCompare(String(b.e._id))
    );

    const events = scored.slice(0, limit).map(({ e, score, participants }) => ({
      ...e,
      participantCount: participants,
      forYouScore: score,
    }));
    res.json({ success: true, events });
  } catch (error) {
    console.error("For-you events error:", error.message);
    res.status(500).json({ success: false, message: "Failed to load events for you" });
  }
};

/* ── Event analytics for organizers (Part 3, Phase 11) ─────── */

// GET /api/events/:id/analytics — registration timeline, interest,
// check-in summary and top posts (organizer/admin only)
exports.getEventAnalytics = async (req, res) => {
  try {
    const { id } = req.params;
    const event = await Event.findById(id).select("_id title createdBy startDate registrationsCount");
    if (!event) return res.status(404).json({ success: false, message: "Event not found" });
    if (!(await canManageEvent(req.user, event))) {
      return res.status(403).json({ success: false, message: "You can't view analytics for this event" });
    }

    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [totalRegistrations, checkedInTickets, totalTickets, interestCount, timelineAgg, topPostDocs] =
      await Promise.all([
        RegistrationResponse.countDocuments({ eventId: id }),
        Ticket.countDocuments({ eventId: id, checkedIn: true }),
        Ticket.countDocuments({ eventId: id }),
        EventInterest.countDocuments({ event: id }),
        // Daily registration counts for the last 30 days
        RegistrationResponse.aggregate([
          { $match: { eventId: new mongoose.Types.ObjectId(id), createdAt: { $gte: since } } },
          {
            $group: {
              _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
              count: { $sum: 1 },
            },
          },
          { $sort: { _id: 1 } },
        ]),
        // Posts attached to this event → engagement below
        Post.find({ event: id, status: "published" })
          .select("content author createdAt")
          .sort({ createdAt: -1 })
          .limit(20)
          .populate("author", "firstName lastName username profile")
          .lean(),
      ]);

    // Engagement for those posts (likes + comments per post)
    const postIds = topPostDocs.map((p) => p._id);
    const Reaction = require("../models/reaction.model");
    const Comment = require("../models/comment.model");
    const [likeAgg, commentAgg] = await Promise.all([
      Reaction.aggregate([
        { $match: { post: { $in: postIds } } },
        { $group: { _id: "$post", count: { $sum: 1 } } },
      ]),
      Comment.aggregate([
        { $match: { post: { $in: postIds }, removedAt: null } },
        { $group: { _id: "$post", count: { $sum: 1 } } },
      ]),
    ]);
    const likeMap = new Map(likeAgg.map((r) => [String(r._id), r.count]));
    const commentMap = new Map(commentAgg.map((r) => [String(r._id), r.count]));
    const topPosts = topPostDocs
      .map((p) => ({
        _id: p._id,
        content: String(p.content || "").slice(0, 160),
        author: p.author,
        createdAt: p.createdAt,
        likes: likeMap.get(String(p._id)) || 0,
        comments: commentMap.get(String(p._id)) || 0,
      }))
      .sort((a, b) => b.likes + b.comments - (a.likes + a.comments))
      .slice(0, 5);

    res.json({
      success: true,
      analytics: {
        summary: {
          registrations: totalRegistrations,
          tickets: totalTickets,
          checkedIn: checkedInTickets,
          checkInRate: totalTickets > 0 ? Math.round((checkedInTickets / totalTickets) * 100) : 0,
          interested: interestCount,
        },
        timeline: timelineAgg.map((d) => ({ day: d._id, count: d.count })),
        topPosts,
      },
    });
  } catch (error) {
    console.error("Event analytics error:", error.message);
    res.status(500).json({ success: false, message: "Failed to load analytics" });
  }
};

/* ── Live engine settings (Part 4, Phase 1 — spec §74) ────── */

// GET /api/events/:id/live-settings (organizer)
exports.getLiveSettings = async (req, res) => {
  try {
    const event = await Event.findById(req.params.id).select("liveSettings joinCode liveState");
    if (!event) return res.status(404).json({ success: false, message: "Event not found" });
    if (!(await canManageEvent(req.user, event))) {
      return res.status(403).json({ success: false, message: "You can't manage this event" });
    }
    res.json({ success: true, liveSettings: event.liveSettings, joinCode: event.joinCode, liveState: event.liveState });
  } catch (error) {
    console.error("Get live settings error:", error.message);
    res.status(500).json({ success: false, message: "Failed to load live settings" });
  }
};

// PUT /api/events/:id/live-settings — whitelisted fields only, server-validated
exports.updateLiveSettings = async (req, res) => {
  try {
    const event = await Event.findById(req.params.id).select("liveSettings joinCode");
    if (!event) return res.status(404).json({ success: false, message: "Event not found" });
    if (!(await canManageEvent(req.user, event))) {
      return res.status(403).json({ success: false, message: "You can't manage this event" });
    }

    const b = req.body || {};
    const s = event.liveSettings || {};
    const BOOL_FIELDS = ["allowLateJoin", "requireRegistration", "requireCheckIn", "allowAnswerChanges", "chatEnabled", "qaEnabled", "pollsEnabled", "teamMode", "requireFullScreen"];
    BOOL_FIELDS.forEach((f) => {
      if (typeof b[f] === "boolean") s[f] = b[f];
    });
    if (["never", "every_question", "every_n", "after_activity", "checkpoints", "final"].includes(b.leaderboardVisibility)) {
      s.leaderboardVisibility = b.leaderboardVisibility;
    }
    if (Number.isInteger(Number(b.leaderboardInterval)) && Number(b.leaderboardInterval) >= 1 && Number(b.leaderboardInterval) <= 50) {
      s.leaderboardInterval = Number(b.leaderboardInterval);
    }
    if (b.scoring && typeof b.scoring === "object") {
      const sc = s.scoring || {};
      const NUM_FIELDS = ["basePoints", "speedBonus", "negativeMarking"];
      NUM_FIELDS.forEach((f) => {
        const v = Number(b.scoring[f]);
        if (Number.isFinite(v) && v >= 0 && v <= 10000) sc[f] = v;
      });
      if (typeof b.scoring.partialScoring === "boolean") sc.partialScoring = b.scoring.partialScoring;
      if (typeof b.scoring.questionWeighting === "boolean") sc.questionWeighting = b.scoring.questionWeighting;
      s.scoring = sc;
    }
    event.liveSettings = s;
    await event.save();
    res.json({ success: true, liveSettings: event.liveSettings, joinCode: event.joinCode });
  } catch (error) {
    console.error("Update live settings error:", error.message);
    res.status(500).json({ success: false, message: "Failed to update live settings" });
  }
};

// POST /api/events/:id/join-code/regenerate (organizer)
exports.regenerateJoinCode = async (req, res) => {
  try {
    const event = await Event.findById(req.params.id).select("joinCode");
    if (!event) return res.status(404).json({ success: false, message: "Event not found" });
    if (!(await canManageEvent(req.user, event))) {
      return res.status(403).json({ success: false, message: "You can't manage this event" });
    }
    // unique index retry — collisions are ~1 in a billion, but be exact
    for (let attempt = 0; attempt < 3; attempt += 1) {
      event.regenerateJoinCode();
      try {
        await event.save();
        return res.json({ success: true, joinCode: event.joinCode });
      } catch (err) {
        if (attempt === 2 || String(err.code) !== "11000") throw err;
      }
    }
  } catch (error) {
    console.error("Regenerate join code error:", error.message);
    res.status(500).json({ success: false, message: "Failed to regenerate join code" });
  }
};
