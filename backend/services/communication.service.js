"use strict";

const Communication = require("../models/communication.model");
const CommunicationDelivery = require("../models/communicationDelivery.model");
const emailService = require("./email.service");

const DEFAULT_BATCH_SIZE = 50;

async function* batchesOf(source, size) {
  if (Array.isArray(source)) {
    for (let i = 0; i < source.length; i += size) yield source.slice(i, i + size);
    return;
  }

  let batch = [];
  for await (const recipient of source) {
    batch.push(recipient);
    if (batch.length >= size) {
      yield batch;
      batch = [];
    }
  }
  if (batch.length) yield batch;
}

function recipientIdentity(recipient) {
  const id = recipient?._id || recipient?.id;
  const email = String(recipient?.email || "").trim();
  if (!id || !email) return null;
  return { id, email, recipient };
}

/**
 * Persist one communication and per-recipient delivery state before sending.
 * Only subject/recipient snapshots/statuses are kept; message bodies are never
 * retained. QueryCursor and arrays are accepted so broad sends can stream.
 */
async function sendTrackedCommunication({
  senderId,
  scope,
  eventId = null,
  kind,
  subject,
  recipients,
  deliverRecipient,
  batchSize = DEFAULT_BATCH_SIZE,
  includeResults = false,
}) {
  if (!senderId || !scope || !kind || !subject || !recipients || typeof deliverRecipient !== "function") {
    throw new Error("Communication metadata and a delivery handler are required");
  }

  const communication = await Communication.create({
    sender: senderId,
    scope,
    eventId,
    kind,
    subject: String(subject).trim(),
    status: "pending",
  });

  let recipientCount = 0;
  let sentCount = 0;
  let failedCount = 0;
  const results = includeResults ? [] : null;
  const seenRecipientIds = new Set();

  await Communication.updateOne(
    { _id: communication._id },
    { $set: { status: "sending", startedAt: new Date() } }
  );

  try {
    for await (const rawBatch of batchesOf(recipients, Math.max(1, Math.min(100, Number(batchSize) || DEFAULT_BATCH_SIZE)))) {
      const batch = [];
      for (const rawRecipient of rawBatch) {
        const identity = recipientIdentity(rawRecipient);
        if (!identity) continue;
        const key = String(identity.id);
        if (seenRecipientIds.has(key)) continue;
        seenRecipientIds.add(key);
        batch.push(identity);
      }
      if (!batch.length) continue;

      const createdAt = new Date();
      const deliveries = await CommunicationDelivery.insertMany(
        batch.map(({ id, email }) => ({
          communicationId: communication._id,
          recipientId: id,
          recipientEmail: email,
          status: "pending",
          createdAt,
          updatedAt: createdAt,
        })),
        { ordered: true }
      );
      recipientCount += deliveries.length;
      await Communication.updateOne(
        { _id: communication._id },
        { $set: { recipientCount } }
      );

      const outcomes = await Promise.all(
        batch.map(async (identity, index) => {
          try {
            const receipt = await deliverRecipient(identity.recipient, identity.email, emailService);
            if (receipt?.skipped) {
              return { delivery: deliveries[index], status: "failed" };
            }
            return {
              delivery: deliveries[index],
              status: "sent",
              provider: receipt?.provider || null,
              messageId: receipt?.messageId || null,
              sentAt: new Date(),
            };
          } catch (_error) {
            // Provider details are intentionally not written to the history.
            return { delivery: deliveries[index], status: "failed" };
          }
        })
      );

      await CommunicationDelivery.bulkWrite(
        outcomes.map((outcome) => ({
          updateOne: {
            filter: { _id: outcome.delivery._id, communicationId: communication._id },
            update: {
              $set: {
                status: outcome.status,
                provider: outcome.provider || null,
                messageId: outcome.messageId || null,
                sentAt: outcome.sentAt || null,
              },
            },
          },
        })),
        { ordered: false }
      );

      const batchSent = outcomes.filter((outcome) => outcome.status === "sent").length;
      const batchFailed = outcomes.length - batchSent;
      sentCount += batchSent;
      failedCount += batchFailed;
      await Communication.updateOne(
        { _id: communication._id },
        { $set: { recipientCount, sentCount, failedCount, status: "sending" } }
      );

      if (results) {
        outcomes.forEach((outcome, index) => {
          results.push({
            recipientId: batch[index].id,
            email: batch[index].email,
            status: outcome.status,
            ...(outcome.status === "failed" ? { error: "Delivery failed" } : {}),
          });
        });
      }
    }

    const finalStatus = recipientCount === 0
      ? "failed"
      : failedCount === 0
        ? "sent"
        : sentCount === 0
          ? "failed"
          : "partial";
    const completedAt = new Date();
    await Communication.updateOne(
      { _id: communication._id },
      { $set: { recipientCount, sentCount, failedCount, status: finalStatus, completedAt } }
    );
  } catch (error) {
    // If a process/storage error interrupts a fan-out, unsent rows remain
    // pending. Keeping the communication as partial/failed makes the
    // uncertainty visible rather than inventing a successful outcome.
    const finalStatus = sentCount > 0 ? "partial" : "failed";
    await Communication.updateOne(
      { _id: communication._id },
      { $set: { recipientCount, sentCount, failedCount, status: finalStatus, completedAt: new Date() } }
    ).catch(() => {});
    throw error;
  }

  const saved = await Communication.findById(communication._id).lean();
  return { communication: saved, results: results || undefined };
}

function communicationPage(query = {}) {
  const limit = Math.max(1, Math.min(100, Number.parseInt(query.limit, 10) || 25));
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  return { limit, page, skip: (page - 1) * limit };
}

module.exports = { sendTrackedCommunication, communicationPage };
