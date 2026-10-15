/**
 * Registration controller (Part 5, Phase 3 — refactor)
 * ─────────────────────────────────────────────────────
 * All query construction now lives in RegistrationRepository (§4). This file
 * owns HTTP concerns only: parse + validate input, call the repository, shape
 * the response.
 *
 * Behaviours fixed here (all flagged CRITICAL in the Phase 0 audit):
 *   • getEventResponses   was UNBOUNDED → now cursor-paginated, hard-capped,
 *                         with server-side search + status filter (§7, §41).
 *   • exportRegistrations read the whole event into RAM → now streams (§40).
 *   • getRegistrationCounts  2 queries per event id → now ONE aggregation (§36).
 *   • getRegistrationStats   5 queries → now ONE $facet aggregation (§40).
 *   • getUserEvents          unbounded full-event populate → paginated +
 *                            projected (§5).
 *
 * Backward compatibility: every response keeps its original keys. New
 * endpoints ADD `items` / `nextCursor` / `hasMore` alongside them, so old
 * clients keep working unchanged.
 */

const Event = require("../models/event.model");
const { notify } = require("../services/notification.service");
const User = require("../models/user.model");
const Ticket = require("../models/ticket.model");
const { isValidObjectId } = require("mongoose");

const {
  RegistrationRepository,
  EventRepository,
  PostRepository,
  cursor: { parseLimit },
} = require("../repositories");
const { streamCsv } = require("../utils/csv-stream");
const { clampQuery } = require("../utils/regex");

/* ── Registration status ─────────────────────────────────── */

// Check registration status
exports.getRegistrationStatus = async (req, res, next) => {
  try {
    const { eventId } = req.params;
    const userId = req.user.id;

    const response = await RegistrationRepository.findForUser(eventId, userId);

    res.json({
      success: true,
      registered: !!response,
      response: response || null,
    });
  } catch (error) {
    return next(error);
  }
};

/* ── Form ────────────────────────────────────────────────── */

// Get form for registration (Public)
exports.getForm = async (req, res, next) => {
  try {
    const { eventId } = req.params;
    const event = await Event.findById(eventId);

    // Moderation takedowns (Part 3, Phase 10) accept no new registrations
    if (!event || event.removedAt || event.archivedAt) {
      return res.status(404).json({ message: "Event not found" });
    }

    // Private events: only a user who manages this exact Event may fetch the form
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
                ...(field.toObject ? field.toObject() : field),
                value: user[field.autoFillFromProfile],
              };
            }
            return { ...(field.toObject ? field.toObject() : field), value: "" };
          });
        }
      }

      return res.json({
        success: true,
        form: { eventId, fields: preFilledFields },
      });
    }

    // If no custom form exists, create default based on required profile fields
    const defaultFields = [
      { label: "Full Name", type: "text", required: true },
      { label: "Email", type: "email", required: true },
    ];

    if (event.requiredProfileFields?.institution) {
      defaultFields.push({ label: "Institution/Organization", type: "text", required: true });
    }
    if (event.requiredProfileFields?.course) {
      defaultFields.push({ label: "Course/Program", type: "text", required: true });
    }
    if (event.requiredProfileFields?.year) {
      defaultFields.push({ label: "Academic Year", type: "text", required: true });
    }

    res.json({ success: true, form: { eventId, fields: defaultFields } });
  } catch (error) {
    console.error("Get form error:", error);
    return next(error);
  }
};

/* ── Submit ──────────────────────────────────────────────── */

// Submit registration
exports.submitResponse = async (req, res, next) => {
  try {
    const { eventId, answers } = req.body;
    const userId = req.user.id;

    const event = await Event.findById(eventId);
    // Moderation takedown (Part 3, Phase 10): no new registrations
    if (!event || event.removedAt || event.archivedAt) return res.status(404).json({ message: "Event not found" });

    const existing = await RegistrationRepository.existsForUser(eventId, userId);
    if (existing) return res.status(400).json({ message: "Already registered for this event" });

    // Private events are invite-only: participants are added by an authorized
    // Event manager (e.g. via RSVP). Self-registration is not allowed unless invited.
    if (event.visibility === "private") {
      const { canManageEvent } = require("../middleware/auth.middleware");
      const authorized = await canManageEvent(req.user, event);
      if (!authorized) {
        return res.status(403).json({ message: "This event is invite-only" });
      }
    }

    // Check if event has reached max attendees.
    // Cached count (§37): registration counts are public integers.
    const registrationCount = await RegistrationRepository.countByEvent(eventId);
    if (event.maxAttendees && registrationCount >= event.maxAttendees) {
      return res.status(400).json({ message: "Event is full" });
    }

    const RegistrationResponse = require("../models/registrationResponse.model");
    const response = await RegistrationResponse.create({
      eventId,
      userId,
      answers,
      status: "confirmed",
    });

    // §13 — a registration write invalidates every count derived from it,
    // otherwise "Event is full" and the dashboard would serve stale numbers.
    RegistrationRepository.invalidateEvent(eventId);
    // The viewer's cached social graph contains the events they registered
    // for, which feed ranking depends on.
    PostRepository.invalidateFeedContext(userId);

    // Let the organizer know someone signed up
    await notify({ user: event.createdBy, actor: userId, type: "event_registration", event: event._id });
    // Achievements: event_explorer (first real registration)
    require("../services/achievement.service").checkAchievements(userId);

    // Generate ticket based on event settings
    if (event.ticketSettings?.autoGenerate) {
      try {
        const ticketController = require("./ticket.controller");

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
          status: event.ticketSettings.manualApproval ? "pending" : "active",
          autoGenerated: true,
        });

        // Send email if not manual approval
        if (event.ticketSettings.sendEmail && !event.ticketSettings.manualApproval) {
          const user = await User.findById(userId);
          await ticketController.sendTicketEmail(ticket, user, event);
        }

        const message = event.ticketSettings.manualApproval
          ? "Registration successful! Your ticket is pending approval."
          : "Registration successful! Your ticket has been emailed to you.";

        return res.status(201).json({ success: true, response, message });
      } catch (ticketError) {
        console.error("Auto-ticket generation failed:", ticketError);
        // Continue with registration even if ticket generation fails (§68)
      }
    }

    // If auto-generate is disabled
    res.status(201).json({
      success: true,
      response,
      message: "Registration successful! Your ticket will be provided by the organizer.",
    });
  } catch (error) {
    return next(error);
  }
};

/* ── Statistics ──────────────────────────────────────────── */

// Get registration statistics for analytics (§40 — ONE $facet aggregation)
exports.getRegistrationStats = async (req, res, next) => {
  try {
    const { id } = req.params;
    const stats = await RegistrationRepository.statsByEvent(id);
    res.json({ success: true, stats });
  } catch (error) {
    console.error("Get registration stats error:", error);
    return next(error);
  }
};

/* ── Participant list (§41) ──────────────────────────────── */

/**
 * GET /api/registration/responses/:eventId
 *   ?limit=20&cursor=…&q=…&status=confirmed|pending
 *
 * BEFORE: `find({eventId})` with no limit — every participant, populated,
 * serialized in one response. A 5,000-person event meant a 5,000-document
 * payload on every page load.
 *
 * AFTER: cursor-paginated, hard-capped at 100, server-side search/filter.
 * `responses` is retained as an alias of `items` so existing clients work.
 */
exports.getEventResponses = async (req, res, next) => {
  try {
    const { eventId } = req.params;
    if (!isValidObjectId(eventId)) {
      return res.status(400).json({ success: false, message: "Invalid event id" });
    }

    const status = ["confirmed", "pending"].includes(req.query.status) ? req.query.status : "all";
    const q = clampQuery(req.query.q, 100);

    const page = await RegistrationRepository.listByEvent({
      eventId,
      limit: req.query.limit,
      cursor: req.query.cursor,
      q,
      status,
    });

    res.json({
      success: true,
      // New cursor contract (§7)
      items: page.items,
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
      // Legacy key — existing admin screens read `responses`
      responses: page.items,
    });
  } catch (error) {
    console.error("Get event responses error:", error);
    return next(error);
  }
};

/**
 * GET /api/registration/responses/:eventId/export
 *
 * Streams the CSV batch-by-batch instead of building it in memory (§40).
 * Memory is now O(batch), not O(event size).
 */
exports.exportRegistrations = async (req, res, next) => {
  try {
    const { eventId } = req.params;
    if (!isValidObjectId(eventId)) {
      return res.status(400).json({ success: false, message: "Invalid event id" });
    }

    // Cheap, cached existence check — preserves the old 404-on-empty behaviour
    // without loading a single row.
    const total = await RegistrationRepository.countByEvent(eventId);
    if (!total) {
      return res.status(404).json({ message: "No registrations found" });
    }

    const event = await Event.findById(eventId).select("registrationForm slug title").lean();

    // Column order is derived from the event's own form definition, so it is
    // stable across batches (a later form edit doesn't shift columns mid-file).
    const formLabels = (event?.registrationForm || []).map((f) => f.label).filter(Boolean);
    const header = [
      "Registration Date",
      "Name",
      "Email",
      "Status",
      "Institution",
      "Course",
      "Year",
      ...formLabels,
    ];

    const filename = `registrations-${eventId}-${new Date().toISOString().split("T")[0]}.csv`;

    await streamCsv(res, {
      filename,
      header,
      iterate: RegistrationRepository.iterateByEvent({ eventId }),
      toRow: (r) => {
        const u = r.userId || {};
        const answers = new Map((r.answers || []).map((a) => [a.fieldLabel, a.value]));
        return [
          new Date(r.createdAt).toLocaleDateString(),
          `${u.firstName || ""} ${u.lastName || ""}`.trim(),
          u.email || "",
          r.status,
          u.profile?.institution || "N/A",
          u.profile?.course || "N/A",
          u.profile?.year || "N/A",
          // Only the columns in the header — extra answers are omitted so the
          // file stays rectangular.
          ...formLabels.map((label) => answers.get(label) ?? ""),
        ];
      },
    });
  } catch (error) {
    console.error("Export registrations error:", error);
    // Headers may already be flushed — only respond if we still can (§68).
    if (!res.headersSent) {
      return next(error);
    } else {
      res.end();
    }
  }
};

/* ── Counts (§36) ────────────────────────────────────────── */

/**
 * POST /api/registration/responses/counts/batch
 *
 * BEFORE: per event id — `Event.exists()` then `countDocuments()` = 2N round
 * trips. The admin dashboard passes every event id on every load.
 * AFTER: ONE aggregation for the entire batch.
 */
exports.getRegistrationCounts = async (req, res, next) => {
  try {
    const { eventIds } = req.body;

    if (!Array.isArray(eventIds)) {
      return res.status(400).json({ success: false, message: "eventIds must be an array" });
    }

    // §63 — a client must not be able to post an unbounded id array.
    if (eventIds.length > 200) {
      return res.status(400).json({ success: false, message: "Too many event ids (max 200)" });
    }

    const counts = await RegistrationRepository.countsBatch(eventIds);
    res.json({ success: true, counts });
  } catch (error) {
    console.error("Get registration counts error:", error);
    return next(error);
  }
};

// Get registration count for single event (cached — §37)
exports.getRegistrationCount = async (req, res, next) => {
  try {
    const { eventId } = req.params;
    const count = await RegistrationRepository.countByEvent(eventId);
    res.json({ success: true, count });
  } catch (error) {
    console.error("Get registration count error:", error);
    return next(error);
  }
};

/* ── Admin form ──────────────────────────────────────────── */

// Admin creates a form for an event
exports.createForm = async (req, res, next) => {
  try {
    const { eventId, fields } = req.body;

    const event = await Event.findById(eventId);
    if (!event) return res.status(404).json({ message: "Event not found" });

    const RegistrationForm = require("../models/registrationForm.model");
    const form = await RegistrationForm.findOneAndUpdate(
      { eventId },
      { eventId, fields, createdBy: req.user.id },
      { upsert: true, new: true }
    );

    res.status(201).json({ success: true, form });
  } catch (error) {
    return next(error);
  }
};

/* ── My events (§5) ──────────────────────────────────────── */

/**
 * GET /api/registration/responses/user/events
 *
 * BEFORE: `find({userId}).populate("eventId")` — unbounded, and each populate
 * hydrated the COMPLETE event document (schedule, speakers, questions…).
 * AFTER: paginated + projected to the card fields the screen renders.
 */
exports.getUserEvents = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const page = await RegistrationRepository.listUserEvents({
      userId,
      limit: req.query.limit,
      cursor: req.query.cursor,
    });

    res.json({
      success: true,
      items: page.items,
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
      // Legacy key
      events: page.events,
    });
  } catch (error) {
    console.error("Get user events error:", error);
    return next(error);
  }
};
