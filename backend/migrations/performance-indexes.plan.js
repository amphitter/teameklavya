"use strict";

/**
 * Phase 10 compound indexes for measured, bounded list queries.
 *
 * These are deliberately kept out of Mongoose schema declarations: Mongoose
 * autoIndex is enabled by default in this application, and schema indexes
 * would therefore be created on a real database at ordinary process startup.
 * The explicit migration is dry-run-by-default and is never called from
 * server.js. Every index is additive; it does not change or delete records.
 */
const PERFORMANCE_INDEXES = Object.freeze([
  {
    model: "Event",
    name: "p10_event_public_discovery_cursor",
    keys: { visibility: 1, archivedAt: 1, removedAt: 1, startDate: 1, _id: 1 },
    purpose: "public discovery: visibility/lifecycle filters + stable startDate ascending cursor",
  },
  {
    model: "Event",
    name: "p10_event_admin_created_cursor",
    keys: { removedAt: 1, createdAt: -1, _id: -1 },
    purpose: "admin Event list: active lifecycle filter + stable newest-first cursor",
  },
  {
    model: "Event",
    name: "p10_event_org_owner_created_cursor",
    keys: { organizerType: 1, organizerId: 1, createdAt: -1, _id: -1 },
    purpose: "Organization-managed Events: explicit owner pair + stable newest-first cursor",
  },
  {
    model: "Event",
    name: "p10_event_stats_created_cursor",
    keys: { createdAt: -1, _id: -1 },
    purpose: "admin ticket-stat Event list: stable newest-first cursor",
  },
  {
    model: "Community",
    name: "p10_community_directory_created_cursor",
    keys: { deletedAt: 1, createdAt: -1, _id: -1 },
    purpose: "community directory: live-record filter + stable newest-first cursor",
  },
  {
    model: "Notification",
    name: "p10_notification_user_created_cursor",
    keys: { user: 1, createdAt: -1, _id: -1 },
    purpose: "private notification inbox: recipient equality + stable newest-first cursor",
  },
  {
    model: "Communication",
    name: "p10_communication_created_cursor",
    keys: { createdAt: -1, _id: -1 },
    purpose: "unfiltered admin communication history: stable newest-first cursor",
  },
  {
    model: "Communication",
    name: "p10_communication_scope_created_cursor",
    keys: { scope: 1, createdAt: -1, _id: -1 },
    purpose: "platform/event communication history filtered by scope",
  },
  {
    model: "Communication",
    name: "p10_communication_scope_status_created_cursor",
    keys: { scope: 1, status: 1, createdAt: -1, _id: -1 },
    purpose: "status-filtered platform communication history",
  },
  {
    model: "Communication",
    name: "p10_communication_event_created_cursor",
    keys: { scope: 1, eventId: 1, createdAt: -1, _id: -1 },
    purpose: "Event-scoped communication history",
  },
  {
    model: "CommunicationDelivery",
    name: "p10_delivery_communication_created_cursor",
    keys: { communicationId: 1, createdAt: 1, _id: 1 },
    purpose: "recipient delivery history: communication equality + stable oldest-first cursor",
  },
  {
    model: "RegistrationResponse",
    name: "p10_registration_event_created_cursor",
    keys: { eventId: 1, createdAt: -1, _id: -1 },
    purpose: "Event participant/registration history: Event equality + stable newest-first cursor",
  },
  {
    model: "Message",
    name: "p10_message_conversation_created_cursor",
    keys: { conversation: 1, createdAt: -1, _id: -1 },
    purpose: "conversation message history: thread equality + stable newest-first cursor",
  },
]);

function sameKeyPattern(left, right) {
  if (!left || !right) return false;
  const a = Object.entries(left);
  const b = Object.entries(right);
  return a.length === b.length && a.every(([key, direction], index) => {
    return b[index]?.[0] === key && b[index]?.[1] === direction;
  });
}

function usableExistingIndex(index) {
  return Boolean(index && !index.sparse && !index.partialFilterExpression && !index.collation);
}

/** Pure planner; safe to test without opening a database connection. */
function planPerformanceIndexes(existingByModel = {}) {
  return PERFORMANCE_INDEXES.map((definition) => {
    const existing = (existingByModel[definition.model] || []).find((index) =>
      sameKeyPattern(index.key, definition.keys) && usableExistingIndex(index)
    );
    return {
      ...definition,
      present: Boolean(existing),
      existingName: existing?.name || null,
      action: existing ? "present" : "create",
    };
  });
}

module.exports = { PERFORMANCE_INDEXES, sameKeyPattern, planPerformanceIndexes };
