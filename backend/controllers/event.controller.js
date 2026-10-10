const Event = require("../models/event.model");
const Organization = require("../models/organization.model");
const Community = require("../models/community.model");
const User = require("../models/user.model");
const RegistrationResponse = require("../models/registrationResponse.model");
const EventInterest = require("../models/eventInterest.model");
const OrgFollow = require("../models/orgFollow.model");
const Ticket = require("../models/ticket.model");
const mongoose = require('mongoose');
const crypto = require('crypto');
const { notifyMany } = require("../services/notification.service");
const { sendTrackedCommunication } = require("../services/communication.service");
const templates = require("../services/emailTemplates");
const { canManageEvent } = require("../middleware/auth.middleware");
const { canCreateOrganizationEvent, isPlatformEventAdmin } = require("../services/event-permissions.service");
const { canManageOrganizationEvents } = require("../services/organization-permissions.service");
const Post = require("../models/post.model");
const Reaction = require("../models/reaction.model");
const Comment = require("../models/comment.model");
const { EventRepository, PostRepository, cursor } = require("../repositories");
const { parseLimit, buildPage, withCursor, isCursorRequest } = cursor;
const urlSafety = require("../services/url-safety.service");
const media = require("../services/media.service");

const MAX_DIRECT_EMAIL_RECIPIENTS = 500;

function recipientIdsOrRespond(req, res) {
  const userIds = req.body?.userIds;
  if (!Array.isArray(userIds) || userIds.length === 0) {
    res.status(400).json({ success: false, message: "Select at least one recipient" });
    return null;
  }
  if (userIds.length > MAX_DIRECT_EMAIL_RECIPIENTS) {
    res.status(400).json({
      success: false,
      message: `A single Event email send is limited to ${MAX_DIRECT_EMAIL_RECIPIENTS} recipients`,
    });
    return null;
  }

  const ids = [...new Set(userIds.map((id) => String(id)))];
  if (ids.some((id) => !mongoose.Types.ObjectId.isValid(id))) {
    res.status(400).json({ success: false, message: "Recipient ids must be valid user ids" });
    return null;
  }
  return ids;
}

async function managedCommunicationEventOrRespond(req, res, eventId) {
  if (!eventId || !mongoose.Types.ObjectId.isValid(String(eventId))) {
    res.status(400).json({ success: false, message: "A valid Event id is required" });
    return null;
  }

  const event = req.managedEvent && String(req.managedEvent._id) === String(eventId)
    ? req.managedEvent
    : await Event.findById(eventId);
  if (!event) {
    res.status(404).json({ success: false, message: "Event not found" });
    return null;
  }
  if (!(await canManageEvent(req.user, event))) {
    res.status(403).json({ success: false, message: "You can't manage this event" });
    return null;
  }
  return event;
}

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

async function retireEventMediaAsset(publicId) {
  if (!publicId) return;
  try {
    const result = await media.deleteImage(publicId);
    if (!result?.ok) await media.markCleanupPending(publicId, "event_deleted_remove_failed");
  } catch (error) {
    console.warn("Event media cleanup failed:", error?.message || error);
    await media.markCleanupPending(publicId, "event_deleted_remove_failed");
  }
}

const getEventLocationHTML = (event) => {
  switch (event.eventType) {
    case 'online':
      return `<p><strong>🌐 Platform:</strong> ${event.platform || 'Online'}</p>
              ${event.onlineEventLink ? `<p><strong>🔗 Event Link:</strong> ${urlSafety.safeEmailLink(event.onlineEventLink, "Join Online")}</p>` : ''}`;
    case 'offline':
      return `<p><strong>📍 Venue:</strong> ${event.venue}</p>`;
    case 'hybrid':
      return `<p><strong>📍 Venue:</strong> ${event.venue}</p>
              ${event.onlineEventLink ? `<p><strong>🌐 Online Option:</strong> ${urlSafety.safeEmailLink(event.onlineEventLink, "Join Online")}</p>` : ''}`;
    default:
      return `<p><strong>📍 Venue:</strong> ${event.venue}</p>`;
  }
};

exports.createEvent = async (req, res, next) => {
  try {
    const body = { ...(req.body || {}) };
    const requestedOwnerType = String(body.organizerType || "USER").trim().toUpperCase();
    for (const field of [
      "organizerType", "organizerId", "createdBy", "removedAt", "removedBy",
      "archivedAt", "archivedBy", "checkIns", "bannerPublicId", "logoUrl", "logoPublicId", "joinCode", "reminderSent",
      "approvalStatus", "proposingOrganizationId", "parentInstitutionId", "approvedBy", "approvedAt", "rejectedAt",
      "rejectionReason", "changeRequestMessage", "submittedAt", "lastResubmittedAt", "version", "requiresReapproval",
      "lastMaterialChangeAt", "approvalHistory", "previousApprovedSnapshot",
    ]) delete body[field];
    if (requestedOwnerType !== "USER" && requestedOwnerType !== "ORGANIZATION") {
      return res.status(400).json({ success: false, message: "Event owner must be USER or ORGANIZATION" });
    }

    let ownerOrganization = null;
    let ownerOrganizationFull = null;
    if (requestedOwnerType === "ORGANIZATION") {
      if (!body.organization) {
        return res.status(400).json({ success: false, message: "An organization is required for an organization-owned event" });
      }
      ownerOrganizationFull = await Organization.findById(body.organization).select("_id createdBy managers category parentOrganizationId affiliationStatus status name slug").lean();
      if (!ownerOrganizationFull) {
        return res.status(400).json({ success: false, message: "Organization not found" });
      }
      ownerOrganization = ownerOrganizationFull;
      if (!(await canCreateOrganizationEvent(req.user, ownerOrganizationFull))) {
        return res.status(403).json({ success: false, message: "You can't create events for this organization" });
      }
      body.organization = ownerOrganizationFull._id;
    } else if (!(await isPlatformEventAdmin(req.user))) {
      return res.status(403).json({ success: false, message: "Organization-owned event creation required" });
    } else if (body.organization) {
      const org = await Organization.findById(body.organization).select("_id").lean();
      if (!org) return res.status(400).json({ success: false, message: "Organization not found" });
      body.organization = org._id;
    }

    if (requestedOwnerType === "ORGANIZATION") delete body.isFeatured;

    if (body.community) {
      const community = await Community.findById(body.community).select("deletedAt").lean();
      if (!community || community.deletedAt) {
        return res.status(400).json({ success: false, message: "Community not found" });
      }
    }

    if (body.visibility && !VISIBILITY_LEVELS.includes(body.visibility)) {
      return res.status(400).json({ success: false, message: "Visibility must be 'public', 'unlisted', or 'private'" });
    }

    if (!body.eventType || !['online', 'offline', 'hybrid'].includes(body.eventType)) {
      return res.status(400).json({ success: false, message: "Event type must be 'online', 'offline', or 'hybrid'" });
    }

    if ((body.eventType === 'offline' || body.eventType === 'hybrid') && !body.venue) {
      return res.status(400).json({ success: false, message: "Venue is required for offline and hybrid events" });
    }

    if (urlSafety.rejectUnsafeUrls(req, res, ["onlineEventLink"])) return;

    if ((body.eventType === 'online' || body.eventType === 'hybrid') && !body.onlineEventLink) {
      return res.status(400).json({ success: false, message: "Online event link is required for online and hybrid events" });
    }

    if (!body.ticketSettings) {
      body.ticketSettings = { autoGenerate: false, sendEmail: true, manualApproval: false };
    }
    if (!body.requiredProfileFields) {
      body.requiredProfileFields = { institution: false, course: false, year: false };
    }
    if (!body.registrationForm) body.registrationForm = [];

    if (body.registrationForm && Array.isArray(body.registrationForm)) {
      body.registrationForm = body.registrationForm.map(field => ({
        label: field.label || '',
        type: field.type || 'text',
        required: Boolean(field.required),
        options: Array.isArray(field.options) ? field.options : [],
        autoFillFromProfile: field.autoFillFromProfile || null
      }));
    }

    try {
      const moderationService = require("../services/moderation.service");
      const textToCheck = [body.title, body.description].filter(Boolean).join(" ");
      const modResult = await moderationService.moderateText({ text: textToCheck, contentType: "event", authorId: req.user.id });
      if (modResult.status === "quarantined" || (modResult.confidence >= 0.85 && modResult.categories.length)) {
        return res.status(400).json({ success: false, message: "Event contains prohibited content: " + (modResult.categories.join(", ") || modResult.reason), error: { code: "VALIDATION_ERROR" } });
      }
    } catch (err) {
      if (err.status) return res.status(err.status).json({ success: false, message: err.message });
      console.warn("Event moderation check failed:", err.message);
    }

    try {
      const enforcementService = require("../services/enforcement.service");
      const check = await enforcementService.checkFeatureRestriction(req.user.id, "eventCreation");
      if (check.restricted) {
        return res.status(403).json({ success: false, message: check.reason || "Event creation restricted" });
      }
    } catch (_) {}

    if (!body.slug && body.title) {
      body.slug = body.title.toLowerCase().replace(/\s+/g, "-").replace(/[^\w-]+/g, "");
    }

    const { isClubCategory } = require("../config/organization");
    let event;
    // Master refactor: only affiliated clubs (with parentOrganizationId) require approval. Non-affiliated clubs/institutions auto-approved for backward compat.
    const requiresApproval = requestedOwnerType === "ORGANIZATION" && ownerOrganizationFull && ownerOrganizationFull.parentOrganizationId;
    if (requiresApproval) {
      const approvalService = require("../services/event-approval.service");
      try {
        const clubDoc = await Organization.findById(ownerOrganizationFull._id);
        event = await approvalService.createProposal({ eventData: body, clubOrg: clubDoc, creator: req.user });
      } catch (e) {
        const status = e.status || 400;
        return res.status(status).json({ success: false, message: e.message });
      }
    } else {
      event = await Event.create({
        ...body,
        createdBy: req.user.id,
        organizerType: requestedOwnerType,
        organizerId: requestedOwnerType === "USER" ? req.user.id : ownerOrganization._id,
        archivedAt: null,
        archivedBy: null,
        approvalStatus: "APPROVED",
        approvedAt: new Date(),
        approvedBy: req.user.id,
        proposingOrganizationId: requestedOwnerType === "ORGANIZATION" ? ownerOrganization._id : null,
        parentInstitutionId: null,
        version: 1,
        approvalHistory: [
          {
            action: "APPROVED",
            actor: req.user.id,
            actorRole: requestedOwnerType === "USER" ? "SUPER_ADMIN" : "INSTITUTION_ADMIN",
            fromStatus: "",
            toStatus: "APPROVED",
            reason: "Auto-approved institution/platform event",
            message: "Event auto-approved",
            createdAt: new Date(),
          },
        ],
      });
    }

    require("../services/achievement.service").checkAchievements(req.user.id);

    if (event.organization && event.approvalStatus === "APPROVED") {
      try {
        const followers = await OrgFollow.find({ organization: event.organization }).select("user").lean();
        const docs = followers
          .map((f) => f.user)
          .filter((uid) => String(uid) !== String(req.user.id))
          .map((user) => ({ user, actor: req.user.id, type: "announcement", event: event._id }));
        if (docs.length) await notifyMany(docs);
      } catch (notifyErr) {
        console.error("Org followers notify error:", notifyErr.message);
      }
    }
    
    res.status(201).json({ success: true, event });
  } catch (error) {
    console.error("Create Event Error:", error);
    return next(error);
  }
};

// Public: Get events with cursor pagination; explicit `page` stays compatible.
exports.getEvents = async (req, res, next) => {
  try {
    const {
      category,
      featured,
      type = 'all',
      q,
      eventType,
      price,
    } = req.query;
    const limit = parseLimit(req.query.limit, { def: 12, max: 50 });

    const query = {};

    // Free-text search semantics are intentionally unchanged.
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

    if (category && category !== 'all') query.category = category;
    if (featured === 'true') query.isFeatured = true;
    if (eventType && eventType !== 'all') query.eventType = eventType;

    const now = new Date();
    if (type === 'upcoming') {
      query.endDate = { $gte: now };
    } else if (type === 'ongoing') {
      query.startDate = { $lte: now };
      query.endDate = { $gte: now };
    } else if (type === 'past') {
      query.endDate = { $lt: now };
    }

    if (price === 'free') query.price = { $lte: 0 };
    else if (price === 'paid') query.price = { $gt: 0 };

    // Discovery only ever shows PUBLIC + APPROVED events. Pending approval proposals are private until approved.
    query.visibility = 'public';
    query.removedAt = null;
    query.archivedAt = null;
    query.approvalStatus = 'APPROVED';

    const sort = { startDate: 1, _id: 1 };
    let events;
    let legacyPagination = null;
    let cursorPage = null;

    if (isCursorRequest(req.query)) {
      const rows = await Event.find(withCursor(query, req.query.cursor, {
        sortField: "startDate",
        direction: "asc",
      }))
        .select('title slug description category venue venueIframeLink eventType startDate endDate startTime endTime bannerUrl logoUrl organizer price theme isFeatured visibility maxAttendees')
        .sort(sort)
        .limit(limit + 1)
        .lean();
      cursorPage = buildPage(rows, limit, (row) => cursor.cursorFor(row, "startDate"));
      events = cursorPage.items;
    } else {
      const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
      const [rows, total] = await Promise.all([
        Event.find(query)
          .select('title slug description category venue venueIframeLink eventType startDate endDate startTime endTime bannerUrl logoUrl organizer price theme isFeatured visibility maxAttendees')
          .sort(sort)
          .skip((page - 1) * limit)
          .limit(limit)
          .lean(),
        Event.countDocuments(query),
      ]);
      events = rows;
      legacyPagination = {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      };
    }

    const eventsWithStatus = events.map((event) => ({
      ...event,
      status: new Date(event.endDate) < now
        ? 'past'
        : new Date(event.startDate) <= now ? 'ongoing' : 'upcoming',
    }));

    return res.json({
      success: true,
      events: eventsWithStatus,
      ...(legacyPagination
        ? { pagination: legacyPagination }
        : { limit, nextCursor: cursorPage.nextCursor, hasMore: cursorPage.hasMore }),
    });
  } catch (error) {
    console.error("Get Events Error:", error);
    return next(error);
  }
};

// Public: distinct categories (discovery filters)
exports.getEventCategories = async (_req, res) => {
  try {
    const categories = await Event.distinct("category", { visibility: "public", removedAt: null, archivedAt: null });
    res.json({ success: true, categories: categories.filter(Boolean).sort() });
  } catch (error) {
    console.error("Get categories error:", error);
    return next(error);
  }
};

// Public: get by slug (unlisted reachable by link; private needs this Event's owner/manager)
exports.getEventBySlug = async (req, res, next) => {
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
      return res.json({ success: true, event }); // full document only for an authorized Event manager
    }

    // Already the redacted public projection — do not re-strip.
    res.json({ success: true, event });
  } catch (error) {
    console.error("Get event by slug error:", error);
    return next(error);
  }
};

// Owner-aware Event detail read (authorization is for this exact Event)
exports.getEventById = async (req, res, next) => {
  try {
    const event = await Event.findById(req.params.id).populate("organization", "name slug handle logoUrl");
    if (!event) return res.status(404).json({ success: false, message: "Event not found" });
    if (!(await canManageEvent(req.user, event))) {
      return res.status(403).json({ success: false, message: "You can't manage this event" });
    }
    res.json({ success: true, event });
  } catch (error) {
    console.error("Get event by id error:", error);
    return next(error);
  }
};

// Update event (owner-aware; the writable-field allowlist excludes owner/provenance)
exports.updateEvent = async (req, res, next) => {
  try {
    const body = { ...(req.body || {}) };
    const eventBefore = await Event.findById(req.params.id);
    if (!eventBefore) return res.status(404).json({ success: false, message: "Event not found" });
    if (!(await canManageEvent(req.user, eventBefore))) {
      return res.status(403).json({ success: false, message: "You can't manage this event" });
    }

    // Explicit writable fields only. Owner/provenance, moderation, archive,
    // check-in and live-engine state are never client mass-assignable.
    const writable = [
      "title", "description", "category", "eventType", "venue", "venueIframeLink",
      "onlineEventLink", "platform", "meetingId", "passcode", "startDate", "endDate",
      "startTime", "endTime", "bannerUrl", "organizer", "maxAttendees", "minAttendees",
      "price", "theme", "visibility", "registrationLink", "whatsappGroup", "ticketSettings",
      "requiredProfileFields", "registrationForm", "schedule", "speakers", "benefits", "partners",
      "organization", "community",
    ];
    const patch = {};
    for (const field of writable) {
      if (Object.prototype.hasOwnProperty.call(body, field)) patch[field] = body[field];
    }

    if (Object.prototype.hasOwnProperty.call(patch, "visibility") && !VISIBILITY_LEVELS.includes(patch.visibility)) {
      return res.status(400).json({
        success: false,
        message: "Visibility must be 'public', 'unlisted', or 'private'",
      });
    }

    if (patch.eventType && !["online", "offline", "hybrid"].includes(patch.eventType)) {
      return res.status(400).json({ success: false, message: "Invalid event type" });
    }
    if (Object.prototype.hasOwnProperty.call(patch, "onlineEventLink") && urlSafety.rejectUnsafeUrls(req, res, ["onlineEventLink"])) return;

    if (Object.prototype.hasOwnProperty.call(patch, "community") && patch.community) {
      if (!mongoose.Types.ObjectId.isValid(String(patch.community))) {
        return res.status(400).json({ success: false, message: "Invalid community" });
      }
      const community = await Community.findById(patch.community).select("deletedAt").lean();
      if (!community || community.deletedAt) {
        return res.status(400).json({ success: false, message: "Community not found" });
      }
    }

    if (Object.prototype.hasOwnProperty.call(patch, "organization")) {
      if (patch.organization) {
        if (!mongoose.Types.ObjectId.isValid(String(patch.organization))) {
          return res.status(400).json({ success: false, message: "Invalid organization" });
        }
        const organization = await Organization.findById(patch.organization).select("_id createdBy managers").lean();
        if (!organization) return res.status(400).json({ success: false, message: "Organization not found" });
        const unchanged = String(eventBefore.organization || "") === String(organization._id);
        if (!unchanged && !(await canCreateOrganizationEvent(req.user, organization))) {
          return res.status(403).json({ success: false, message: "You can't associate this event with that organization" });
        }
        patch.organization = organization._id;
      } else {
        patch.organization = null;
      }
    }

    // Only platform administrators can promote an Event on the global
    // discovery surface; Event Managers cannot mass-assign isFeatured.
    if (Object.prototype.hasOwnProperty.call(body, "isFeatured") && await isPlatformEventAdmin(req.user)) {
      patch.isFeatured = Boolean(body.isFeatured);
    }

    // Preserve established title→slug behavior; the ownership transition and
    // backfill never rewrite either field or the existing public URL.
    if (patch.title) {
      patch.slug = String(patch.title).toLowerCase().replace(/\s+/g, "-").replace(/[^\w-]+/g, "");
    }

    if (patch.ticketSettings && typeof patch.ticketSettings === "object") {
      patch.ticketSettings = {
        autoGenerate: Boolean(patch.ticketSettings.autoGenerate),
        sendEmail: patch.ticketSettings.sendEmail !== undefined ? Boolean(patch.ticketSettings.sendEmail) : true,
        manualApproval: Boolean(patch.ticketSettings.manualApproval),
      };
    }
    if (Array.isArray(patch.registrationForm)) {
      patch.registrationForm = patch.registrationForm.map((field) => ({
        label: String(field.label || ""),
        type: field.type || "text",
        required: Boolean(field.required),
        options: Array.isArray(field.options) ? field.options : [],
        autoFillFromProfile: field.autoFillFromProfile || null,
      }));
    }

    const event = await Event.findByIdAndUpdate(req.params.id, patch, { new: true, runValidators: true });
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
      console.error("Event update notify error:", notifyErr.message);
    }

    await EventRepository.invalidate(event);
    res.json({ success: true, event });
  } catch (error) {
    console.error("Update event error:", error);
    return next(error);
  }
};

// Reversible soft archive. This is deliberately separate from moderation
// removedAt and from the platform-admin hard-delete endpoint.
exports.setEventArchived = async (req, res, next) => {
  try {
    if (typeof req.body?.archived !== "boolean") {
      return res.status(400).json({ success: false, message: "archived must be true or false" });
    }
    const event = await Event.findById(req.params.id);
    if (!event) return res.status(404).json({ success: false, message: "Event not found" });
    if (!(await canManageEvent(req.user, event))) {
      return res.status(403).json({ success: false, message: "You can't manage this event" });
    }
    event.archivedAt = req.body.archived ? (event.archivedAt || new Date()) : null;
    event.archivedBy = req.body.archived ? (event.archivedBy || req.user.id) : null;
    await event.save();
    await EventRepository.invalidate(event);
    res.json({ success: true, event: { _id: event._id, archivedAt: event.archivedAt } });
  } catch (error) {
    console.error("Archive event error:", error.message);
    return next(error);
  }
};

// Get admin events with advanced filtering; old page-based clients remain supported.
exports.getAdminEvents = async (req, res, next) => {
  try {
    const { search, category, status, eventType } = req.query;
    const limit = parseLimit(req.query.limit, { def: 50, max: 100 });
    const query = {};

    if (search && String(search).trim() !== '') {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { venue: { $regex: search, $options: 'i' } },
        { organizer: { $regex: search, $options: 'i' } },
        { slug: { $regex: search, $options: 'i' } },
      ];
    }
    if (category && category !== 'all') query.category = category;
    if (eventType && eventType !== 'all') query.eventType = eventType;

    // Admin's default list hides archived Events; request status=archived to restore one.
    query.archivedAt = status === "archived" ? { $ne: null } : null;

    if (status && status !== 'all') {
      const now = new Date();
      switch (status) {
        case 'archived':
          break;
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

    query.removedAt = null;
    const sort = { createdAt: -1, _id: -1 };
    const projection = '-description -schedule -speakers -benefits -partners -checkIns -bannerPublicId -logoPublicId';
    let events;
    let legacyPagination = null;
    let cursorPage = null;

    if (isCursorRequest(req.query)) {
      const rows = await Event.find(withCursor(query, req.query.cursor))
        .select(projection)
        .sort(sort)
        .limit(limit + 1)
        .lean();
      cursorPage = buildPage(rows, limit);
      events = cursorPage.items;
    } else {
      const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
      const [rows, total] = await Promise.all([
        Event.find(query)
          .select(projection)
          .sort(sort)
          .skip((page - 1) * limit)
          .limit(limit)
          .lean(),
        Event.countDocuments(query),
      ]);
      events = rows;
      legacyPagination = { page, limit, total, pages: Math.ceil(total / limit) };
    }

    return res.json({
      success: true,
      events,
      ...(legacyPagination
        ? { pagination: legacyPagination }
        : { limit, nextCursor: cursorPage.nextCursor, hasMore: cursorPage.hasMore }),
    });
  } catch (error) {
    console.error("Get admin events error:", error);
    return next(error);
  }
};

// Organization Event Manager listing. Scope is the explicit owner pair, never
// Event.organization association or Event.createdBy. Explicit `page` callers
// keep the legacy page/total response; new clients use keyset cursors.
exports.getOrganizationManagedEvents = async (req, res, next) => {
  try {
    const { organizationId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(String(organizationId || ""))) {
      return res.status(400).json({ success: false, message: "Invalid organization id" });
    }
    const organization = await Organization.findById(organizationId).select("_id name slug handle createdBy managers").lean();
    if (!organization) return res.status(404).json({ success: false, message: "Organization not found" });
    if (!(await canManageOrganizationEvents(req.user, organization))) {
      return res.status(403).json({ success: false, message: "You can't manage this organization's events" });
    }

    const limit = parseLimit(req.query.limit, { def: 20, max: 50 });
    const query = { organizerType: "ORGANIZATION", organizerId: organization._id };
    if (req.query.archived === "true") query.archivedAt = { $ne: null };
    else query.archivedAt = null;

    const status = String(req.query.status || "");
    const now = new Date();
    if (status === "upcoming") query.startDate = { $gt: now };
    else if (status === "ongoing") {
      query.startDate = { $lte: now };
      query.endDate = { $gte: now };
    } else if (status === "past") query.endDate = { $lt: now };

    if (req.query.search && String(req.query.search).trim()) {
      const escaped = String(req.query.search).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      query.$or = [
        { title: { $regex: escaped, $options: "i" } },
        { venue: { $regex: escaped, $options: "i" } },
        { slug: { $regex: escaped, $options: "i" } },
      ];
    }

    const projection = "title slug category venue eventType startDate endDate bannerUrl logoUrl organizer price visibility archivedAt createdBy organizerType organizerId createdAt";
    const sort = { createdAt: -1, _id: -1 };
    let events;
    let legacyPagination = null;
    let cursorPage = null;

    if (isCursorRequest(req.query)) {
      const rows = await Event.find(withCursor(query, req.query.cursor))
        .select(projection)
        .sort(sort)
        .limit(limit + 1)
        .lean();
      cursorPage = buildPage(rows, limit);
      events = cursorPage.items;
    } else {
      const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
      const [rows, total] = await Promise.all([
        Event.find(query)
          .select(projection)
          .sort(sort)
          .skip((page - 1) * limit)
          .limit(limit)
          .lean(),
        Event.countDocuments(query),
      ]);
      events = rows;
      legacyPagination = { page, limit, total, pages: Math.ceil(total / limit) };
    }

    return res.json({
      success: true,
      organization: { _id: organization._id, name: organization.name, slug: organization.handle || organization.slug },
      events,
      ...(legacyPagination
        ? { pagination: legacyPagination }
        : { limit, nextCursor: cursorPage.nextCursor, hasMore: cursorPage.hasMore }),
    });
  } catch (error) {
    console.error("Get organization managed events error:", error.message);
    return next(error);
  }
};

// Delete event (Admin)
exports.deleteEvent = async (req, res, next) => {
  try {
    const event = await Event.findByIdAndDelete(req.params.id);
    if (!event) return res.status(404).json({ success: false, message: "Event not found" });
    // §13 — a deleted event must vanish from discovery immediately. Remove
    // every tracked banner/logo asset through the provider abstraction too.
    await EventRepository.invalidate(event);
    for (const publicId of new Set([event.bannerPublicId, event.logoPublicId].filter(Boolean))) {
      await retireEventMediaAsset(publicId);
    }
    res.json({ success: true, message: "Event deleted" });
  } catch (error) {
    console.error("Delete event error:", error);
    return next(error);
  }
};

// Send RSVP to selected users for a managed Event
exports.sendRSVP = async (req, res, next) => {
  try {
    const { eventId, rsvpLink } = req.body || {};
    const userIds = recipientIdsOrRespond(req, res);
    if (!userIds) return;

    const rsvpUrl = urlSafety.validateExternalUrl(rsvpLink, { field: "rsvpLink" });
    if (!rsvpUrl.ok) {
      return res.status(400).json({ success: false, message: rsvpUrl.reason });
    }

    const event = await managedCommunicationEventOrRespond(req, res, eventId);
    if (!event) return;

    const users = await User.find({ _id: { $in: userIds } });
    if (!users.length) return res.status(404).json({ success: false, message: "No users found" });

    const note = event.ticketSettings?.autoGenerate
      ? "Your ticket will be generated automatically after you register."
      : "Tickets are issued after registration approval.";
    const subject = `Invitation: ${event.title}`;
    const { communication, results = [] } = await sendTrackedCommunication({
      senderId: req.user.id,
      scope: "EVENT",
      eventId: event._id,
      kind: "EVENT_INVITATION",
      subject,
      recipients: users,
      includeResults: true,
      deliverRecipient: async (user, _email, emailService) => {
        const { html, text } = templates.eventInvitation({ user, event, ctaUrl: rsvpUrl.url, note });
        return emailService.send({ to: user.email, subject, html, text });
      },
    });

    const successful = communication.sentCount;
    const failed = communication.failedCount;
    res.json({
      success: true,
      message: `RSVP process completed: ${successful} sent, ${failed} failed`,
      results: results.map((result) => ({
        userId: result.recipientId,
        email: result.email,
        status: result.status,
        ...(result.error ? { error: result.error } : {}),
      })),
      communicationId: communication._id,
    });
  } catch (error) {
    console.error("sendRSVP error:", error);
    return next(error);
  }
};

// Send event announcement to all users (batched)
exports.sendEventNotificationToAllUsers = async (req, res, next) => {
  try {
    // This audience is the entire platform, not this Event's participants.
    // Keep a controller-level guard as well as the route middleware so a new
    // route cannot accidentally expose the global broadcast operation.
    if (!(await isPlatformEventAdmin(req.user))) {
      return res.status(403).json({ success: false, message: "Platform admin access required" });
    }

    const { id } = req.params;
    const event = await Event.findById(id);
    if (!event) return res.status(404).json({ success: false, message: "Event not found" });

    const users = await User.find({}, "_id email firstName lastName");
    if (!users.length) return res.status(404).json({ success: false, message: "No users found" });

    const eventUrl = `${process.env.FRONTEND_URL}/events/${event.slug}`;
    const subject = `New event on EventHub: ${event.title}`;
    const { communication } = await sendTrackedCommunication({
      senderId: req.user.id,
      scope: "PLATFORM",
      eventId: event._id,
      kind: "EVENT_ANNOUNCEMENT",
      subject,
      recipients: users,
      batchSize: 50,
      deliverRecipient: async (user, _email, emailService) => {
        const { html, text } = templates.eventAnnouncement({ user, event, eventUrl });
        return emailService.send({ to: user.email, subject, html, text });
      },
    });

    // Mirror the email as an in-app notification (skip the sender themself)
    await notifyMany(
      users
        .filter((u) => String(u._id) !== String(req.user.id))
        .map((u) => ({ user: u._id, actor: req.user.id, type: "announcement", event: event._id }))
    );

    res.json({
      success: true,
      message: `Notification sent: ${communication.sentCount} sent, ${communication.failedCount} failed`,
      sentCount: communication.sentCount,
      failedCount: communication.failedCount,
      communicationId: communication._id,
    });
  } catch (error) {
    console.error("sendEventNotificationToAllUsers error:", error);
    return next(error);
  }
};

const generateRSVPToken = () => {
  return crypto.randomBytes(32).toString('hex');
};

// Send RSVP to registered students with tickets
// Send RSVP to registered students with tickets
exports.sendRSVPWithVerification = async (req, res, next) => {
  try {
    const { eventId, customMessage } = req.body || {};
    const userIds = recipientIdsOrRespond(req, res);
    if (!userIds) return;
    if (customMessage != null && String(customMessage).length > 2000) {
      return res.status(400).json({ success: false, message: "Custom message must be 2,000 characters or fewer" });
    }

    const event = await managedCommunicationEventOrRespond(req, res, eventId);
    if (!event) return;

    const users = await User.find({ _id: { $in: userIds } });
    if (!users.length) return res.status(404).json({ success: false, message: "No users found" });

    const subject = `RSVP: ${event.title}`;
    const { communication, results = [] } = await sendTrackedCommunication({
      senderId: req.user.id,
      scope: "EVENT",
      eventId: event._id,
      kind: "RSVP_VERIFICATION",
      subject,
      recipients: users,
      includeResults: true,
      deliverRecipient: async (user, _email, emailService) => {
        let registration = await RegistrationResponse.findOne({ eventId, userId: user._id });

        if (!registration) {
          registration = await RegistrationResponse.create({
            eventId,
            userId: user._id,
            rsvpToken: generateRSVPToken(),
            rsvpVerificationExpires: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
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
        const receipt = await emailService.send({ to: user.email, subject, html, text });
        registration.rsvpSent = true;
        registration.rsvpSentAt = new Date();
        await registration.save();
        return receipt;
      },
    });

    const successful = communication.sentCount;
    const failed = communication.failedCount;
    res.json({
      success: true,
      message: `RSVP process completed: ${successful} sent, ${failed} failed`,
      results: results.map((result) => ({
        userId: result.recipientId,
        email: result.email,
        status: result.status,
        ...(result.error ? { error: result.error } : {}),
      })),
      communicationId: communication._id,
    });
  } catch (error) {
    console.error("sendRSVPWithVerification error:", error);
    return next(error);
  }
};

exports.verifyRSVP = async (req, res, next) => {
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
    return next(error);
  }
};

// Get RSVP analytics
exports.getRSVPAnalytics = async (req, res, next) => {
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
    return next(error);
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

// Get event statistics (owner-aware, including Organization Event Managers)
exports.getEventStats = async (req, res, next) => {
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
    return next(error);
  }
};

// Update event ticket settings (owner-aware)
exports.updateTicketSettings = async (req, res, next) => {
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
    return next(error);
  }
};

// Get events with ticket generation stats (Admin).
// Counts are batched per page rather than four round trips per Event.
exports.getEventsWithTicketStats = async (req, res, next) => {
  try {
    const limit = parseLimit(req.query.limit, { def: 50, max: 100 });
    const sort = { createdAt: -1, _id: -1 };
    const projection = 'title slug startDate endDate venue organizer maxAttendees ticketSettings createdAt eventType onlineEventLink platform';
    let events;
    let legacyPagination = null;
    let cursorPage = null;

    if (isCursorRequest(req.query)) {
      const rows = await Event.find(withCursor({}, req.query.cursor))
        .select(projection)
        .sort(sort)
        .limit(limit + 1)
        .lean();
      cursorPage = buildPage(rows, limit);
      events = cursorPage.items;
    } else {
      const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
      const [rows, total] = await Promise.all([
        Event.find({})
          .select(projection)
          .sort(sort)
          .skip((page - 1) * limit)
          .limit(limit)
          .lean(),
        Event.countDocuments({}),
      ]);
      events = rows;
      legacyPagination = { page, limit, total, pages: Math.ceil(total / limit) };
    }

    const eventIds = events.map((event) => event._id);
    const [ticketRows, registrationRows] = eventIds.length
      ? await Promise.all([
          Ticket.aggregate([
            { $match: { eventId: { $in: eventIds } } },
            {
              $group: {
                _id: "$eventId",
                totalTickets: { $sum: 1 },
                pendingTickets: { $sum: { $cond: [{ $eq: ["$status", "pending"] }, 1, 0] } },
              },
            },
          ]),
          RegistrationResponse.aggregate([
            { $match: { eventId: { $in: eventIds } } },
            {
              $group: {
                _id: "$eventId",
                totalRegistrations: { $sum: 1 },
                rsvpSentCount: { $sum: { $cond: [{ $eq: ["$rsvpSent", true] }, 1, 0] } },
              },
            },
          ]),
        ])
      : [[], []];

    const ticketsByEvent = new Map(ticketRows.map((row) => [String(row._id), row]));
    const registrationsByEvent = new Map(registrationRows.map((row) => [String(row._id), row]));
    const eventsWithStats = events.map((event) => {
      const tickets = ticketsByEvent.get(String(event._id));
      const registrations = registrationsByEvent.get(String(event._id));
      const totalTickets = tickets?.totalTickets || 0;
      const totalRegistrations = registrations?.totalRegistrations || 0;
      const rsvpSentCount = registrations?.rsvpSentCount || 0;
      return {
        ...event,
        stats: {
          totalTickets,
          totalRegistrations,
          pendingTickets: tickets?.pendingTickets || 0,
          rsvpSentCount,
          ticketCoverage: totalRegistrations > 0 ? (totalTickets / totalRegistrations) * 100 : 0,
          rsvpRate: totalRegistrations > 0 ? (rsvpSentCount / totalRegistrations) * 100 : 0,
        },
      };
    });

    return res.json({
      success: true,
      events: eventsWithStats,
      ...(legacyPagination
        ? { pagination: legacyPagination }
        : { limit, nextCursor: cursorPage.nextCursor, hasMore: cursorPage.hasMore }),
    });
  } catch (error) {
    console.error("Get events with ticket stats error:", error);
    return next(error);
  }
};

// Get public participants of an event (minimal fields — no emails)
exports.getEventParticipants = async (req, res, next) => {
  try {
    const { id } = req.params;
    const visibleEvent = await Event.findById(id)
      .select("archivedAt removedAt visibility organizerType organizerId createdBy")
      .lean();
    if (!visibleEvent || visibleEvent.archivedAt || visibleEvent.removedAt) {
      return res.status(404).json({ success: false, message: "Event not found" });
    }
    if (visibleEvent.visibility === "private" && !(await canManageEvent(req.user, visibleEvent))) {
      return res.status(404).json({ success: false, message: "Event not found" });
    }
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
exports.getTrendingEvents = async (req, res, next) => {
  try {
    const limit = Math.min(12, Math.max(1, parseInt(req.query.limit) || 6));
    const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);

    const events = await Event.find({
      visibility: "public",
      archivedAt: null,
      removedAt: null,
      endDate: { $gte: new Date(Date.now() - 24 * 3600 * 1000) },
    })
      .select("title slug bannerUrl logoUrl category venue eventType startDate endDate price isFeatured")
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
exports.getEventInterest = async (req, res, next) => {
  try {
    const eventId = req.params.id;
    const event = await Event.findById(eventId).select("visibility createdBy archivedAt removedAt").lean();
    if (!event || event.archivedAt || event.removedAt) return res.status(404).json({ success: false, message: "Event not found" });

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
exports.toggleEventInterest = async (req, res, next) => {
  try {
    const eventId = req.params.id;
    const event = await Event.findById(eventId).select("visibility removedAt archivedAt");
    if (!event || event.removedAt || event.archivedAt) return res.status(404).json({ success: false, message: "Event not found" });

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
exports.getEventsForYou = async (req, res, next) => {
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
      archivedAt: null,
      removedAt: null,
      endDate: { $gte: new Date(Date.now() - 24 * 3600 * 1000) },
      ...(registeredIds.length ? { _id: { $nin: registeredIds } } : {}),
    })
      .sort({ createdAt: -1 })
      .limit(120)
      .select("title slug bannerUrl logoUrl description category eventType venue platform startDate endDate price maxAttendees isFeatured organization")
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
// check-in summary and top posts (owner-aware; no association-based access)
exports.getEventAnalytics = async (req, res, next) => {
  try {
    const { id } = req.params;
    const event = await Event.findById(id).select("_id title createdBy organizerType organizerId startDate registrationsCount");
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
exports.getLiveSettings = async (req, res, next) => {
  try {
    const event = await Event.findById(req.params.id).select("liveSettings joinCode liveState organizerType organizerId createdBy");
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
exports.updateLiveSettings = async (req, res, next) => {
  try {
    const event = await Event.findById(req.params.id).select("liveSettings joinCode organizerType organizerId createdBy");
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
exports.regenerateJoinCode = async (req, res, next) => {
  try {
    const event = await Event.findById(req.params.id).select("joinCode organizerType organizerId createdBy");
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

// ── Master Refactor: Institution–Club Event Approval Workflow ──────────
exports.approveEventProposal = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { reason } = req.body || {};
    const service = require("../services/event-approval.service");
    const event = await service.approveEvent({ eventId: id, approver: req.user, reason });
    await require("../repositories/event.repository").EventRepository.invalidate(event);
    res.json({ success: true, event });
  } catch (e) {
    const status = e.status || 500;
    if (status < 500) return res.status(status).json({ success: false, message: e.message });
    console.error("Approve event error:", e);
    return next(e);
  }
};

exports.rejectEventProposal = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { reason } = req.body || {};
    const service = require("../services/event-approval.service");
    const event = await service.rejectEvent({ eventId: id, approver: req.user, reason });
    await require("../repositories/event.repository").EventRepository.invalidate(event);
    res.json({ success: true, event });
  } catch (e) {
    const status = e.status || 500;
    if (status < 500) return res.status(status).json({ success: false, message: e.message });
    console.error("Reject event error:", e);
    return next(e);
  }
};

exports.requestEventChanges = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { message } = req.body || {};
    const service = require("../services/event-approval.service");
    const event = await service.requestChanges({ eventId: id, approver: req.user, message });
    await require("../repositories/event.repository").EventRepository.invalidate(event);
    res.json({ success: true, event });
  } catch (e) {
    const status = e.status || 500;
    if (status < 500) return res.status(status).json({ success: false, message: e.message });
    console.error("Request changes error:", e);
    return next(e);
  }
};

exports.resubmitEventProposal = async (req, res, next) => {
  try {
    const { id } = req.params;
    const updates = req.body || {};
    const service = require("../services/event-approval.service");
    const event = await service.resubmitEvent({ eventId: id, actor: req.user, updates });
    await require("../repositories/event.repository").EventRepository.invalidate(event);
    res.json({ success: true, event });
  } catch (e) {
    const status = e.status || 500;
    if (status < 500) return res.status(status).json({ success: false, message: e.message });
    console.error("Resubmit event error:", e);
    return next(e);
  }
};

exports.cancelEventProposal = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { reason } = req.body || {};
    const service = require("../services/event-approval.service");
    const event = await service.cancelEvent({ eventId: id, actor: req.user, reason });
    await require("../repositories/event.repository").EventRepository.invalidate(event);
    res.json({ success: true, event });
  } catch (e) {
    const status = e.status || 500;
    if (status < 500) return res.status(status).json({ success: false, message: e.message });
    console.error("Cancel event error:", e);
    return next(e);
  }
};

exports.getEventApprovalHistory = async (req, res, next) => {
  try {
    const event = await Event.findById(req.params.id).select("approvalHistory approvalStatus proposingOrganizationId parentInstitutionId organizerType organizerId createdBy").lean();
    if (!event) return res.status(404).json({ success: false, message: "Event not found" });
    if (!(await canManageEvent(req.user, event))) {
      return res.status(403).json({ success: false, message: "You can't manage this event" });
    }
    res.json({ success: true, history: event.approvalHistory || [], approvalStatus: event.approvalStatus });
  } catch (e) {
    console.error("Get approval history error:", e);
    return next(e);
  }
};

exports.getInstitutionApprovalQueue = async (req, res, next) => {
  try {
    const { institutionId } = req.params;
    const { status, limit, cursor } = req.query;
    const service = require("../services/event-approval.service");
    const events = await service.getApprovalQueue({ institutionId, actor: req.user, status, limit, cursor });
    res.json({ success: true, events });
  } catch (e) {
    const st = e.status || 500;
    if (st < 500) return res.status(st).json({ success: false, message: e.message });
    console.error("Get approval queue error:", e);
    return next(e);
  }
};

exports.getClubProposals = async (req, res, next) => {
  try {
    const { clubId } = req.params;
    const service = require("../services/event-approval.service");
    const events = await service.getMyProposals({ clubId, actor: req.user });
    res.json({ success: true, events });
  } catch (e) {
    const st = e.status || 500;
    if (st < 500) return res.status(st).json({ success: false, message: e.message });
    console.error("Get club proposals error:", e);
    return next(e);
  }
};

exports.updateEventWithReapprovalCheck = async (req, res, next) => {
  try {
    const body = { ...(req.body || {}) };
    const eventBefore = await Event.findById(req.params.id);
    if (!eventBefore) return res.status(404).json({ success: false, message: "Event not found" });
    if (!(await canManageEvent(req.user, eventBefore))) {
      return res.status(403).json({ success: false, message: "You can't manage this event" });
    }
    // For approved events, material changes go through reapproval flow
    if (eventBefore.approvalStatus === "APPROVED") {
      const service = require("../services/event-approval.service");
      const updated = await service.handleUpdateAfterApproval({ eventId: eventBefore._id, actor: req.user, updates: body });
      await require("../repositories/event.repository").EventRepository.invalidate(updated);
      return res.json({ success: true, event: updated });
    }
    // For non-approved, use existing update logic (simplified)
    const writable = [
      "title", "description", "category", "eventType", "venue", "venueIframeLink",
      "onlineEventLink", "platform", "meetingId", "passcode", "startDate", "endDate",
      "startTime", "endTime", "bannerUrl", "organizer", "maxAttendees", "minAttendees",
      "price", "theme", "visibility", "registrationLink", "whatsappGroup", "ticketSettings",
      "requiredProfileFields", "registrationForm", "schedule", "speakers", "benefits", "partners",
      "organization", "community",
    ];
    const patch = {};
    for (const f of writable) if (Object.prototype.hasOwnProperty.call(body, f)) patch[f] = body[f];
    const updated = await Event.findByIdAndUpdate(req.params.id, { $set: patch }, { new: true });
    await require("../repositories/event.repository").EventRepository.invalidate(updated);
    res.json({ success: true, event: updated });
  } catch (e) {
    console.error("Update with reapproval error:", e);
    return next(e);
  }
};

