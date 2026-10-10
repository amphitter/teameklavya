"use strict";

const mongoose = require("mongoose");
const User = require("../models/user.model");
const Event = require("../models/event.model");
const RegistrationResponse = require("../models/registrationResponse.model");
const Communication = require("../models/communication.model");
const CommunicationDelivery = require("../models/communicationDelivery.model");
const { canManageEvent } = require("../middleware/auth.middleware");
const templates = require("../services/emailTemplates");
const { sendTrackedCommunication, communicationPage } = require("../services/communication.service");
const { parseLimit, isCursorRequest, withCursor, buildPage, cursorFor } = require("../repositories/cursor");

const MAX_EVENT_RECIPIENTS = 500;
const MAX_SUBJECT_LENGTH = 180;
const MAX_MESSAGE_LENGTH = 8000;

function campaignContentOrRespond(req, res) {
  const subject = String(req.body?.subject || "").trim();
  const message = String(req.body?.message || "").trim();
  if (!subject || subject.length > MAX_SUBJECT_LENGTH) {
    res.status(400).json({ success: false, message: `Subject must be 1–${MAX_SUBJECT_LENGTH} characters` });
    return null;
  }
  if (!message || message.length > MAX_MESSAGE_LENGTH) {
    res.status(400).json({ success: false, message: `Message must be 1–${MAX_MESSAGE_LENGTH} characters` });
    return null;
  }
  return { subject, message };
}

function eventPageUrl(event) {
  if (!event?.slug || !process.env.FRONTEND_URL) return undefined;
  const base = String(process.env.FRONTEND_URL).replace(/\/+$/, "");
  return `${base}/events/${encodeURIComponent(event.slug)}`;
}

function publicCommunication(communication) {
  if (!communication) return null;
  return {
    _id: communication._id,
    scope: communication.scope,
    eventId: communication.eventId,
    kind: communication.kind,
    subject: communication.subject,
    status: communication.status,
    recipientCount: communication.recipientCount,
    sentCount: communication.sentCount,
    failedCount: communication.failedCount,
    startedAt: communication.startedAt,
    completedAt: communication.completedAt,
    createdAt: communication.createdAt,
  };
}

async function sendPlatformMessage(req, res, next) {
  try {
    const content = campaignContentOrRespond(req, res);
    if (!content) return;

    let event = null;
    const rawEventId = req.body?.eventId;
    if (rawEventId) {
      if (!mongoose.Types.ObjectId.isValid(String(rawEventId))) {
        return res.status(400).json({ success: false, message: "Invalid Event id" });
      }
      event = await Event.findById(rawEventId).select("title slug eventType venue startDate startTime endTime organizer price");
      if (!event) return res.status(404).json({ success: false, message: "Event not found" });
    }

    const recipients = User.find({}).select("_id email firstName").cursor();
    const { communication } = await sendTrackedCommunication({
      senderId: req.user.id,
      scope: "PLATFORM",
      eventId: event?._id || null,
      kind: "PLATFORM_CUSTOM",
      subject: content.subject,
      recipients,
      batchSize: 50,
      deliverRecipient: async (user, _email, emailService) => {
        const payload = templates.customCommunication({
          user,
          event,
          subject: content.subject,
          message: content.message,
          ctaUrl: eventPageUrl(event),
        });
        return emailService.send({ to: user.email, subject: content.subject, ...payload });
      },
    });

    return res.status(201).json({
      success: true,
      message: `Message processed: ${communication.sentCount} sent, ${communication.failedCount} failed`,
      communication: publicCommunication(communication),
    });
  } catch (error) {
    console.error("Platform communication failed:", error?.message || error);
    return next(error);
  }
}

async function sendEventMessage(req, res, next) {
  try {
    const content = campaignContentOrRespond(req, res);
    if (!content) return;

    const eventId = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(String(eventId))) {
      return res.status(400).json({ success: false, message: "Invalid Event id" });
    }
    const event = req.managedEvent && String(req.managedEvent._id) === String(eventId)
      ? req.managedEvent
      : await Event.findById(eventId);
    if (!event) return res.status(404).json({ success: false, message: "Event not found" });
    if (!(await canManageEvent(req.user, event))) {
      return res.status(403).json({ success: false, message: "You can't manage this event" });
    }

    const rawIds = req.body?.userIds;
    if (!Array.isArray(rawIds) || rawIds.length === 0 || rawIds.length > MAX_EVENT_RECIPIENTS) {
      return res.status(400).json({
        success: false,
        message: `Select between 1 and ${MAX_EVENT_RECIPIENTS} registered recipients`,
      });
    }
    const recipientIds = [...new Set(rawIds.map((id) => String(id)))];
    if (recipientIds.some((id) => !mongoose.Types.ObjectId.isValid(id))) {
      return res.status(400).json({ success: false, message: "Recipient ids must be valid user ids" });
    }

    const registeredIds = await RegistrationResponse.distinct("userId", {
      eventId: event._id,
      userId: { $in: recipientIds },
    });
    const registeredSet = new Set(registeredIds.map(String));
    if (recipientIds.some((id) => !registeredSet.has(id))) {
      return res.status(400).json({
        success: false,
        message: "Event messages may only be sent to users registered for this Event",
      });
    }

    const recipients = await User.find({ _id: { $in: registeredIds } }).select("_id email firstName");
    if (recipients.length !== recipientIds.length) {
      return res.status(400).json({ success: false, message: "One or more recipients are unavailable" });
    }

    const { communication, results } = await sendTrackedCommunication({
      senderId: req.user.id,
      scope: "EVENT",
      eventId: event._id,
      kind: "EVENT_CUSTOM",
      subject: content.subject,
      recipients,
      includeResults: true,
      deliverRecipient: async (user, _email, emailService) => {
        const payload = templates.customCommunication({
          user,
          event,
          subject: content.subject,
          message: content.message,
          ctaUrl: eventPageUrl(event),
        });
        return emailService.send({ to: user.email, subject: content.subject, ...payload });
      },
    });

    return res.status(201).json({
      success: true,
      message: `Message processed: ${communication.sentCount} sent, ${communication.failedCount} failed`,
      communication: publicCommunication(communication),
      results,
    });
  } catch (error) {
    console.error("Event communication failed:", error?.message || error);
    return next(error);
  }
}

function pageEnvelope(items, total, page, limit) {
  return {
    items,
    page,
    limit,
    total,
    hasMore: page * limit < total,
    nextPage: page * limit < total ? page + 1 : null,
  };
}

async function listWithPagination({ req, model, filter, fields, populates = [], sort, sortField = "createdAt", direction = "desc" }) {
  if (isCursorRequest(req.query)) {
    const limit = parseLimit(req.query.limit, { def: 25, max: 100 });
    let query = model.find(withCursor(filter, req.query.cursor, { sortField, direction })).select(fields);
    for (const populate of populates) query = query.populate(populate);
    const rows = await query
      .sort(sort)
      .limit(limit + 1)
      .lean();
    const page = buildPage(rows, limit, (row) => cursorFor(row, sortField));
    return { ...page, limit };
  }

  const { limit, page, skip } = communicationPage(req.query);
  let query = model.find(filter).select(fields);
  for (const populate of populates) query = query.populate(populate);
  const [items, total] = await Promise.all([
    query.sort(sort).skip(skip).limit(limit).lean(),
    model.countDocuments(filter),
  ]);
  return pageEnvelope(items, total, page, limit);
}

async function listAdminCommunications(req, res, next) {
  try {
    const filter = {};
    if (["PLATFORM", "EVENT"].includes(String(req.query.scope || "").toUpperCase())) {
      filter.scope = String(req.query.scope).toUpperCase();
    }
    if (["pending", "sending", "sent", "partial", "failed"].includes(String(req.query.status || "").toLowerCase())) {
      filter.status = String(req.query.status).toLowerCase();
    }
    const page = await listWithPagination({
      req,
      model: Communication,
      filter,
      fields: "sender scope eventId kind subject status recipientCount sentCount failedCount startedAt completedAt createdAt",
      populates: [
        { path: "sender", select: "firstName lastName email" },
        { path: "eventId", select: "title slug" },
      ],
      sort: { createdAt: -1, _id: -1 },
    });
    return res.json({ success: true, ...page });
  } catch (error) {
    return next(error);
  }
}

async function listEventCommunications(req, res, next) {
  try {
    const eventId = req.params.id;
    if (!(await canManageEvent(req.user, eventId))) {
      return res.status(403).json({ success: false, message: "You can't manage this event" });
    }
    const filter = { scope: "EVENT", eventId };
    const page = await listWithPagination({
      req,
      model: Communication,
      filter,
      fields: "sender scope eventId kind subject status recipientCount sentCount failedCount startedAt completedAt createdAt",
      populates: [{ path: "sender", select: "firstName lastName" }],
      sort: { createdAt: -1, _id: -1 },
    });
    return res.json({ success: true, ...page });
  } catch (error) {
    return next(error);
  }
}

async function listDeliveries(req, res, next) {
  try {
    const communicationId = req.params.communicationId;
    if (!mongoose.Types.ObjectId.isValid(String(communicationId))) {
      return res.status(400).json({ success: false, message: "Invalid communication id" });
    }

    const filter = { _id: communicationId };
    if (req.params.id) {
      filter.scope = "EVENT";
      filter.eventId = req.params.id;
      if (!(await canManageEvent(req.user, req.params.id))) {
        return res.status(403).json({ success: false, message: "You can't manage this event" });
      }
    }
    const communication = await Communication.findOne(filter).select("_id").lean();
    if (!communication) return res.status(404).json({ success: false, message: "Communication not found" });

    const page = await listWithPagination({
      req,
      model: CommunicationDelivery,
      filter: { communicationId },
      fields: "recipientId recipientEmail status provider sentAt createdAt",
      sort: { createdAt: 1, _id: 1 },
      direction: "asc",
    });
    return res.json({ success: true, ...page });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  sendPlatformMessage,
  sendEventMessage,
  listAdminCommunications,
  listEventCommunications,
  listDeliveries,
};
