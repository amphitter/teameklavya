/**
 * Live Event HTTP controller (Part 4, Phase 2 — spec §5, §7, §78).
 * HTTP handles pre-flight state + join-code resolution; the realtime
 * engine owns everything live. All authorization server-side.
 */
const Event = require("../models/event.model");
const { canManageEvent } = require("../middleware/auth.middleware");
const realtime = require("../services/realtime.service");
const resultService = require("../services/result.service");
const ParticipantSession = require("../models/participantSession.model");
const { certificateFor, qualifiedCodes } = require("../services/completion.service");

// GET /api/events/:id/live/state — role-scoped (participant vs organizer)
exports.getLiveState = async (req, res) => {
  try {
    const result = await realtime.liveStateFor(req.params.id, req.user);
    if (result.notFound) {
      return res.status(404).json({ success: false, message: "Event not found" });
    }
    if (result.organizer) {
      return res.json({ success: true, role: "organizer", state: result.organizer });
    }
    return res.json({ success: true, role: "participant", state: result.participant });
  } catch (error) {
    console.error("Live state error:", error.message);
    res.status(500).json({ success: false, message: "Failed to load live state" });
  }
};

// POST /api/events/join-by-code { code } — resolves a join code to the event.
// This only RESOLVES the code; join eligibility is re-validated by the
// realtime engine (spec §7) — nothing here grants access.
exports.joinByCode = async (req, res) => {
  try {
    const code = String(req.body.code || "").trim().toUpperCase();
    if (!code || code.length < 4 || code.length > 12) {
      return res.status(400).json({ success: false, message: "Enter a valid join code" });
    }
    const event = await Event.findOne({ joinCode: code, removedAt: null }).select("slug title liveState").lean();
    if (!event) {
      return res.status(404).json({ success: false, message: "No event found for this code" });
    }
    res.json({ success: true, event: { slug: event.slug, title: event.title, liveState: event.liveState } });
  } catch (error) {
    console.error("Join by code error:", error.message);
    res.status(500).json({ success: false, message: "Failed to resolve code" });
  }
};

// GET /api/events/:id/results — post-event results (Phase 8 — §58–59, §64–66).
// Reads the immutable EventResult snapshot. Organizer gets full analytics
// (activities, questions); participants get the public board + their own row.
exports.getEventResults = async (req, res) => {
  try {
    const event = await Event.findById(req.params.id).select("title slug liveState removedAt createdBy");
    if (!event || event.removedAt) {
      return res.status(404).json({ success: false, message: "Event not found" });
    }
    if (event.liveState !== "COMPLETED") {
      return res.status(400).json({ success: false, message: "Results unlock when the event completes" });
    }
    const result = await resultService.getOrBuildResults(String(event._id));
    if (!result) {
      return res.status(500).json({ success: false, message: "Couldn't build results" });
    }
    const isOrganizer = await canManageEvent(req.user, event);
    const payload = {
      success: true,
      event: { title: event.title, slug: event.slug, liveState: event.liveState },
      summary: result.summary || {},
      leaderboard: result.leaderboard || [],
      finalizedAt: result.finalizedAt,
    };
    if (isOrganizer) {
      payload.activities = result.activities || [];
      payload.questions = result.questions || [];
    } else {
      // Own row only — other participants stay public-identity (§39).
      // Phase 9 (§63): memory-page extras — duration, achievement codes
      // qualified at this event, certificate availability.
      const mine = (result.leaderboard || []).find(
        (e) => String(e.participantId) === String(req.user.id)
      ) || null;
      if (mine) {
        const session = await ParticipantSession.findOne({ event: event._id, user: req.user.id })
          .select("joinedAt completedAt")
          .lean();
        const durationMs =
          session?.joinedAt && session?.completedAt
            ? new Date(session.completedAt).getTime() - new Date(session.joinedAt).getTime()
            : null;
        payload.me = { ...mine, durationMs };
        payload.achievements = qualifiedCodes(mine);
        payload.certificate = await certificateFor(String(event._id), req.user.id);
      } else {
        payload.me = null;
        payload.achievements = [];
        payload.certificate = { available: false };
      }
    }
    res.json(payload);
  } catch (error) {
    console.error("Event results error:", error.message);
    res.status(500).json({ success: false, message: "Failed to load results" });
  }
};

// GET /api/events/:id/live/eligibility — pre-flight join check (participant)
exports.getJoinEligibility = async (req, res) => {
  try {
    const event = await Event.findById(req.params.id).select("liveState removedAt visibility liveSettings slug title");
    if (!event || event.removedAt) {
      return res.status(404).json({ success: false, message: "Event not found" });
    }
    const isOrganizer = await canManageEvent(req.user, event);
    const joinable = ["CHECK_IN", "WAITING", "LIVE", "PAUSED"].includes(event.liveState);
    const response = { success: true, liveState: event.liveState, joinable, isOrganizer };
    if (!isOrganizer && joinable) {
      // Surface only the FIRST blocking reason — no eligibility detail leak
      const RegistrationResponse = require("../models/registrationResponse.model");
      const Ticket = require("../models/ticket.model");
      const settings = event.liveSettings || {};
      if (settings.requireRegistration && !(await RegistrationResponse.exists({ eventId: event._id, userId: req.user.id }))) {
        response.blockedReason = "registration";
      } else if (
        settings.requireCheckIn &&
        !(await Ticket.exists({ eventId: event._id, userId: req.user.id, checkedIn: true }))
      ) {
        response.blockedReason = "check_in";
      }
    }
    res.json(response);
  } catch (error) {
    console.error("Join eligibility error:", error.message);
    res.status(500).json({ success: false, message: "Failed to check eligibility" });
  }
};
