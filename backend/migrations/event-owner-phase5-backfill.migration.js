"use strict";

const Event = require("../models/event.model");
const RegistrationResponse = require("../models/registrationResponse.model");
const Ticket = require("../models/ticket.model");
const Post = require("../models/post.model");

function eventCohortFields(prefix = "") {
  const field = (name) => `${prefix}${name}`;
  const exists = (name) => ({
    $ne: [{ $ifNull: [field(name), null] }, null],
  });
  return {
    hasCreatedBy: exists("createdBy"),
    hasOrganization: exists("organization"),
    hasCommunity: exists("community"),
  };
}

async function linkedRecordCounts(model, eventReferenceField) {
  const fields = eventCohortFields("$event.");
  return model.aggregate([
    {
      $lookup: {
        from: Event.collection.name,
        let: { linkedEventId: `$${eventReferenceField}` },
        pipeline: [
          { $match: { $expr: { $eq: ["$_id", "$$linkedEventId"] } } },
          { $project: { createdBy: 1, organization: 1, community: 1 } },
        ],
        as: "event",
      },
    },
    { $unwind: "$event" },
    { $addFields: { cohort: fields } },
    {
      $group: {
        _id: "$cohort",
        linkedRecords: { $sum: 1 },
      },
    },
    { $sort: { "_id.hasCreatedBy": -1, "_id.hasOrganization": -1, "_id.hasCommunity": -1 } },
  ]).allowDiskUse(true);
}

/**
 * Staged Event owner backfill. Dry-run by default; apply writes only the new
 * owner discriminator/pointer. It never rewrites Event ids, slugs, createdBy,
 * organization/community associations, registrations, tickets, or posts.
 *
 * Confirmed legacy rule:
 *   createdBy present → USER / organizerId = createdBy
 *   createdBy missing → PLATFORM / organizerId = null
 * Event.organization and Event.community are intentionally not consulted.
 */
async function runEventOwnerPhase5Backfill({ apply = false } = {}) {
  const summary = {
    mode: apply ? "apply" : "dry-run",
    eventsScanned: 0,
    cohorts: [],
    ownerTypesAlreadyExplicit: 0,
    userOwnersConsidered: 0,
    platformOwnersConsidered: 0,
    incompleteOwnerRecords: 0,
    eventsNeedingBackfill: 0,
    eventsUpdated: 0,
    linkedRegistrationsByCohort: [],
    linkedTicketsByCohort: [],
    linkedPostsByCohort: [],
  };

  summary.cohorts = await Event.aggregate([
    {
      $addFields: {
        hasCreatedBy: { $ne: [{ $ifNull: ["$createdBy", null] }, null] },
        hasOrganization: { $ne: [{ $ifNull: ["$organization", null] }, null] },
        hasCommunity: { $ne: [{ $ifNull: ["$community", null] }, null] },
        ownershipState: {
          $cond: [
            { $eq: [{ $ifNull: ["$organizerType", null] }, null] },
            {
              $cond: [
                { $ne: [{ $ifNull: ["$organizerId", null] }, null] },
                "INCOMPLETE_OWNER_ID_ONLY",
                "LEGACY_OWNER_MISSING",
              ],
            },
            {
              $cond: [
                {
                  $or: [
                    { $eq: ["$organizerType", "PLATFORM"] },
                    { $ne: [{ $ifNull: ["$organizerId", null] }, null] },
                  ],
                },
                "EXPLICIT_OWNER",
                "INCOMPLETE_OWNER_TYPE_ONLY",
              ],
            },
          ],
        },
        archived: { $ne: [{ $ifNull: ["$archivedAt", null] }, null] },
        moderatedRemoved: { $ne: [{ $ifNull: ["$removedAt", null] }, null] },
      },
    },
    {
      $group: {
        _id: {
          hasCreatedBy: "$hasCreatedBy",
          hasOrganization: "$hasOrganization",
          hasCommunity: "$hasCommunity",
          ownershipState: "$ownershipState",
          archived: "$archived",
          moderatedRemoved: "$moderatedRemoved",
        },
        events: { $sum: 1 },
      },
    },
    { $sort: { "_id.hasCreatedBy": -1, "_id.hasOrganization": -1, "_id.hasCommunity": -1, "_id.ownershipState": 1 } },
  ]).allowDiskUse(true);

  summary.linkedRegistrationsByCohort = await linkedRecordCounts(RegistrationResponse, "eventId");
  summary.linkedTicketsByCohort = await linkedRecordCounts(Ticket, "eventId");
  summary.linkedPostsByCohort = await linkedRecordCounts(Post, "event");

  const cursor = Event.find({})
    .select("_id organizerType organizerId createdBy")
    .lean()
    .cursor();
  const writes = [];

  const flush = async () => {
    if (!writes.length) return;
    if (apply) {
      const result = await Event.collection.bulkWrite(writes.splice(0), { ordered: false });
      summary.eventsUpdated += result.modifiedCount || 0;
    } else {
      writes.length = 0;
    }
  };

  for await (const event of cursor) {
    summary.eventsScanned += 1;

    if (event.organizerType != null) {
      summary.ownerTypesAlreadyExplicit += 1;
      const ownerIsValid =
        (event.organizerType === "PLATFORM" && event.organizerId == null) ||
        ((event.organizerType === "USER" || event.organizerType === "ORGANIZATION") && event.organizerId != null);
      if (!ownerIsValid) summary.incompleteOwnerRecords += 1;
      continue;
    }

    // Do not invent a USER owner from an unrelated association. An orphaned
    // organizerId also requires review rather than being silently replaced.
    if (event.organizerId != null) {
      summary.incompleteOwnerRecords += 1;
      continue;
    }

    const owner = event.createdBy
      ? { organizerType: "USER", organizerId: event.createdBy }
      : { organizerType: "PLATFORM", organizerId: null };
    if (event.createdBy) summary.userOwnersConsidered += 1;
    else summary.platformOwnersConsidered += 1;
    summary.eventsNeedingBackfill += 1;

    writes.push({
      updateOne: {
        filter: { _id: event._id, organizerType: null, organizerId: null },
        update: { $set: owner },
      },
    });
    if (writes.length >= 500) await flush();
  }
  await flush();

  return summary;
}

module.exports = { runEventOwnerPhase5Backfill, linkedRecordCounts };
