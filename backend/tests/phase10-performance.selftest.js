"use strict";

/**
 * Phase 10 — performance/pagination/index regression checks.
 *
 * Uses MongoMemoryServer only; email is never sent and no real database is
 * connected. Target compound indexes are installed in this isolated database
 * from the same declarative plan used by the dry-run migration.
 */
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "phase10-performance-test-secret";
process.env.REDIS_ENABLED = "false";
process.env.RATE_LIMIT_DISABLED = "1";

const assert = require("node:assert/strict");
const express = require("express");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const User = require("../models/user.model");
const Event = require("../models/event.model");
const Organization = require("../models/organization.model");
const Community = require("../models/community.model");
const CommunityMember = require("../models/communityMember.model");
const Notification = require("../models/notification.model");
const Communication = require("../models/communication.model");
const CommunicationDelivery = require("../models/communicationDelivery.model");
const RegistrationResponse = require("../models/registrationResponse.model");
const Ticket = require("../models/ticket.model");
const Message = require("../models/message.model");
const { cursor } = require("../repositories");
const { PERFORMANCE_INDEXES, planPerformanceIndexes } = require("../migrations/performance-indexes.plan");

const MODELS = {
  Event,
  Community,
  Notification,
  Communication,
  CommunicationDelivery,
  RegistrationResponse,
  Message,
};
const FIXED_TIME = new Date("2026-05-01T12:00:00.000Z");
let checks = 0;
let eventSequence = 0;

function check(name, condition, details = "") {
  assert.ok(condition, `${name}${details ? ` — ${details}` : ""}`);
  checks += 1;
  console.log(`  ✅ ${name}`);
}

function tokenFor(user) {
  return jwt.sign(
    { id: String(user._id), role: user.role, purpose: "auth" },
    process.env.JWT_SECRET,
    { expiresIn: "1h" }
  );
}

async function request(base, path, { user, method = "GET", body } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(user ? { Authorization: `Bearer ${tokenFor(user)}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  let data = {};
  try { data = await response.json(); } catch {}
  return { status: response.status, data };
}

async function makeUser(name, email, role = "user") {
  return User.create({
    firstName: name,
    lastName: "PhaseTen",
    email,
    role,
    passwordHash: "test-password",
    emailVerified: true,
  });
}

async function makeEvent({ title, owner, slug, startDate, visibility = "public", organizerType = "USER", organizerId, organizationId } = {}) {
  eventSequence += 1;
  const start = startDate || new Date(Date.now() + 40 * 24 * 60 * 60 * 1000);
  const eventSlug = slug || `p10-event-${eventSequence}`;
  return Event.create({
    title: title || eventSlug,
    slug: eventSlug,
    description: "Phase 10 pagination fixture",
    eventType: "offline",
    venue: "Delhi",
    startDate: start,
    endDate: new Date(start.getTime() + 4 * 60 * 60 * 1000),
    createdBy: owner?._id,
    organizerType,
    organizerId: organizerId || owner?._id,
    organization: organizationId || undefined,
    visibility,
    joinCode: `P10${String(eventSequence).padStart(6, "0")}`,
  });
}

async function makeCommunication({ sender, scope, eventId = null, index }) {
  const platform = scope === "PLATFORM";
  const row = await Communication.create({
    sender: sender._id,
    scope,
    eventId,
    kind: platform ? "PLATFORM_CUSTOM" : "EVENT_CUSTOM",
    subject: `Phase 10 ${scope} ${index}`,
    status: "sent",
    recipientCount: 1,
    sentCount: 1,
    failedCount: 0,
    startedAt: FIXED_TIME,
    completedAt: FIXED_TIME,
  });
  await Communication.collection.updateOne({ _id: row._id }, { $set: { createdAt: FIXED_TIME } });
  return row;
}

function queryString(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
  }
  return search.toString();
}

function stagesOf(value, stages = []) {
  if (!value || typeof value !== "object") return stages;
  if (Array.isArray(value)) {
    value.forEach((item) => stagesOf(item, stages));
    return stages;
  }
  if (typeof value.stage === "string") stages.push(value.stage);
  for (const child of Object.values(value)) {
    if (child && typeof child === "object") stagesOf(child, stages);
  }
  return stages;
}

async function explainBounded({ label, model, filter, sort, indexName, maxRows = 12 }) {
  const explain = await model.find(filter).sort(sort).limit(maxRows).explain("executionStats");
  const plan = explain.queryPlanner?.winningPlan;
  const stages = stagesOf(plan);
  const planText = JSON.stringify(plan);
  assert.ok(!stages.includes("SORT"), `${label}: winning plan contains a blocking SORT (${stages.join(" -> ")})`);
  assert.ok(planText.includes(indexName), `${label}: expected ${indexName} in winning plan, got ${planText}`);
  assert.ok(explain.executionStats.totalDocsExamined <= maxRows, `${label}: examined ${explain.executionStats.totalDocsExamined} docs for limit ${maxRows}`);
  assert.ok(explain.executionStats.totalKeysExamined <= maxRows + 1, `${label}: examined ${explain.executionStats.totalKeysExamined} keys for limit ${maxRows}`);
  checks += 1;
  console.log(`  ✅ explain ${label}: ${explain.executionStats.totalKeysExamined} keys / ${explain.executionStats.totalDocsExamined} docs; no SORT`);
}

async function seedIndexProbeData({ owner, admin, notificationOwner, eventId, organizationId, deliveryCommunicationId, conversationId }) {
  const count = 260;
  const now = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);
  const events = [];
  const communities = [];
  const notifications = [];
  const communications = [];
  const deliveries = [];
  const registrations = [];
  const messages = [];

  for (let i = 0; i < count; i += 1) {
    const id = new mongoose.Types.ObjectId();
    events.push({
      _id: id,
      title: `Index event ${i}`,
      slug: `p10-index-event-${i}`,
      description: "Index-plan fixture",
      eventType: "offline",
      venue: "Delhi",
      startDate: new Date(now.getTime() + i * 1000),
      endDate: new Date(now.getTime() + i * 1000 + 3600000),
      createdAt: new Date(FIXED_TIME.getTime() + i * 1000),
      updatedAt: new Date(FIXED_TIME.getTime() + i * 1000),
      createdBy: owner._id,
      organizerType: "ORGANIZATION",
      organizerId: organizationId,
      organization: organizationId,
      visibility: "public",
      archivedAt: null,
      removedAt: null,
      joinCode: `P10I${String(i).padStart(6, "0")}`,
    });
    communities.push({
      _id: new mongoose.Types.ObjectId(),
      name: `Index community ${i}`,
      slug: `p10-index-community-${i}`,
      description: "Index-plan fixture",
      createdBy: owner._id,
      status: "unverified",
      deletedAt: null,
      createdAt: new Date(FIXED_TIME.getTime() + i * 1000),
      updatedAt: new Date(FIXED_TIME.getTime() + i * 1000),
    });
    notifications.push({
      _id: new mongoose.Types.ObjectId(),
      user: notificationOwner._id,
      type: "follow",
      read: false,
      createdAt: new Date(FIXED_TIME.getTime() + i * 1000),
      updatedAt: new Date(FIXED_TIME.getTime() + i * 1000),
    });
    communications.push({
      _id: new mongoose.Types.ObjectId(),
      sender: admin._id,
      scope: "PLATFORM",
      eventId: null,
      kind: "PLATFORM_CUSTOM",
      subject: `Index communication ${i}`,
      status: "sent",
      recipientCount: 1,
      sentCount: 1,
      failedCount: 0,
      createdAt: new Date(FIXED_TIME.getTime() + i * 1000),
      updatedAt: new Date(FIXED_TIME.getTime() + i * 1000),
    });
    deliveries.push({
      _id: new mongoose.Types.ObjectId(),
      communicationId: deliveryCommunicationId,
      recipientId: new mongoose.Types.ObjectId(),
      recipientEmail: `index-${i}@phase10.test`,
      status: "sent",
      sentAt: new Date(FIXED_TIME.getTime() + i * 1000),
      createdAt: new Date(FIXED_TIME.getTime() + i * 1000),
      updatedAt: new Date(FIXED_TIME.getTime() + i * 1000),
    });
    registrations.push({
      _id: new mongoose.Types.ObjectId(),
      eventId,
      userId: new mongoose.Types.ObjectId(),
      status: "confirmed",
      rsvpSent: i % 2 === 0,
      createdAt: new Date(FIXED_TIME.getTime() + i * 1000),
      updatedAt: new Date(FIXED_TIME.getTime() + i * 1000),
    });
    messages.push({
      _id: new mongoose.Types.ObjectId(),
      conversation: conversationId,
      sender: owner._id,
      content: "Index-plan fixture",
      deletedAt: null,
      createdAt: new Date(FIXED_TIME.getTime() + i * 1000),
      updatedAt: new Date(FIXED_TIME.getTime() + i * 1000),
    });
  }

  await Promise.all([
    Event.collection.insertMany(events, { ordered: false }),
    Community.collection.insertMany(communities, { ordered: false }),
    Notification.collection.insertMany(notifications, { ordered: false }),
    Communication.collection.insertMany(communications, { ordered: false }),
    CommunicationDelivery.collection.insertMany(deliveries, { ordered: false }),
    RegistrationResponse.collection.insertMany(registrations, { ordered: false }),
    Message.collection.insertMany(messages, { ordered: false }),
  ]);
}

(async () => {
  let mongod;
  let server;
  try {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
    await Promise.all([
      User.init(), Event.init(), Organization.init(), Community.init(), CommunityMember.init(),
      Notification.init(), Communication.init(), CommunicationDelivery.init(),
      RegistrationResponse.init(), Ticket.init(), Message.init(),
    ]);

    const app = express();
    app.use(express.json());
    app.use("/api/events", require("../routes/event.routes"));
    app.use("/api/communities", require("../routes/community.routes"));
    app.use("/api/notifications", require("../routes/notification.routes"));
    app.use("/api/admin", require("../routes/admin.routes"));
    server = await new Promise((resolve, reject) => {
      const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
      listening.once("error", reject);
    });
    const base = `http://127.0.0.1:${server.address().port}/api`;

    const owner = await makeUser("Owner", "phase10-owner@example.test");
    const outsider = await makeUser("Outsider", "phase10-outsider@example.test");
    const admin = await makeUser("Admin", "phase10-admin@example.test", "admin");
    const notificationOwner = await makeUser("Inbox Owner", "phase10-inbox@example.test");
    const notificationOther = await makeUser("Inbox Other", "phase10-inbox-other@example.test");
    const recipients = await Promise.all(Array.from({ length: 8 }, (_, i) => makeUser(`Recipient${i}`, `phase10-recipient-${i}@example.test`)));

    console.log("\n═══ Cursor helper and migration plan ═══");
    const ascCursor = cursor.encodeCursor({ at: FIXED_TIME.toISOString(), id: "507f1f77bcf86cd799439011" });
    const ascFilter = cursor.keysetFilter(ascCursor, { sortField: "startDate", direction: "asc" });
    check("ascending cursor uses a strict greater-than pair", ascFilter.$or[0].startDate.$gt instanceof Date && Boolean(ascFilter.$or[1]._id.$gt));
    check("explicit page requests preserve legacy pagination mode", !cursor.isCursorRequest({ page: "1" }) && cursor.isCursorRequest({ cursor: ascCursor }));
    const planFixture = planPerformanceIndexes({ Event: [{ name: "stats-index", key: { createdAt: -1, _id: -1 } }] });
    check("index planner recognizes an already-present exact pattern", planFixture.find((item) => item.name === "p10_event_stats_created_cursor")?.present === true);
    check("phase 10 index apply plan is explicit and additive", PERFORMANCE_INDEXES.length >= 10 && PERFORMANCE_INDEXES.every((item) => item.name.startsWith("p10_")));

    const discoveryStart = new Date(Date.now() + 50 * 24 * 60 * 60 * 1000);
    const discoveryEvents = [];
    for (let i = 0; i < 7; i += 1) {
      discoveryEvents.push(await makeEvent({ title: `Discovery ${i}`, owner, startDate: discoveryStart }));
    }

    console.log("\n═══ Event discovery cursor + legacy page compatibility ═══");
    const eventOps = [];
    mongoose.set("debug", (collection, method) => eventOps.push(`${collection}.${method}`));
    const firstEvents = await request(base, "/events?limit=3&type=all");
    mongoose.set("debug", false);
    check("public discovery is still anonymous and returns a cursor page", firstEvents.status === 200 && firstEvents.data.events.length === 3 && firstEvents.data.hasMore && Boolean(firstEvents.data.nextCursor));
    check("cursor discovery avoids total-count query", !eventOps.includes("events.countDocuments"), eventOps.join(","));
    const eventIds = firstEvents.data.events.map((row) => String(row._id));
    let eventCursor = firstEvents.data.nextCursor;
    while (eventCursor) {
      const page = await request(base, `/events?${queryString({ limit: 3, type: "all", cursor: eventCursor })}`);
      check("public discovery cursor page succeeds", page.status === 200 && Array.isArray(page.data.events));
      eventIds.push(...page.data.events.map((row) => String(row._id)));
      eventCursor = page.data.nextCursor;
      assert.ok(eventIds.length <= discoveryEvents.length, "event cursor did not terminate or returned duplicates");
    }
    check("same-startDate Event pages are gap-free and duplicate-free", eventIds.length === discoveryEvents.length && new Set(eventIds).size === discoveryEvents.length);
    const eventLegacy = await request(base, "/events?type=all&page=2&limit=3");
    check("legacy Event page response keeps pagination totals", eventLegacy.status === 200 && eventLegacy.data.pagination?.page === 2 && eventLegacy.data.pagination?.total === 7 && eventLegacy.data.pagination?.pages === 3);
    const eventClamp = await request(base, "/events?type=all&limit=1000");
    check("public Event list clamps oversized page size", eventClamp.status === 200 && eventClamp.data.limit === 50);

    console.log("\n═══ Community directory cursor + legacy page compatibility ═══");
    const communities = [];
    for (let i = 0; i < 7; i += 1) {
      communities.push(await Community.create({
        name: `Group ${i} Phase10`,
        slug: `phase10-community-${i}`,
        description: "Cursor fixture",
        createdBy: owner._id,
        status: "unverified",
      }));
    }
    await Community.collection.updateMany({ _id: { $in: communities.map((item) => item._id) } }, { $set: { createdAt: FIXED_TIME } });
    const communityIds = [];
    let communityCursor = null;
    do {
      const page = await request(base, `/communities?${queryString({ limit: 3, cursor: communityCursor })}`);
      check("community cursor page succeeds", page.status === 200 && Array.isArray(page.data.communities));
      communityIds.push(...page.data.communities.map((item) => String(item._id)));
      communityCursor = page.data.nextCursor;
    } while (communityCursor);
    check("same-createdAt community pages have no duplicates or gaps", communityIds.length === 7 && new Set(communityIds).size === 7);
    const communityLegacy = await request(base, "/communities?page=2&limit=3");
    check("legacy community page still returns page and hasMore", communityLegacy.status === 200 && communityLegacy.data.page === 2 && communityLegacy.data.hasMore === true);

    console.log("\n═══ Private notification cursor + legacy page compatibility ═══");
    const notifications = [];
    for (let i = 0; i < 7; i += 1) {
      notifications.push(await Notification.create({ user: notificationOwner._id, type: "follow", read: i === 0 }));
    }
    await Notification.collection.updateMany({ user: notificationOwner._id }, { $set: { createdAt: FIXED_TIME } });
    for (let i = 0; i < 2; i += 1) await Notification.create({ user: notificationOther._id, type: "like" });
    const noAuthNotifications = await request(base, "/notifications");
    check("notification inbox remains authenticated", noAuthNotifications.status === 401);
    const notifOps = [];
    mongoose.set("debug", (collection, method, ...args) => notifOps.push({ collection, method, args }));
    const notifFirst = await request(base, "/notifications?limit=3", { user: notificationOwner });
    mongoose.set("debug", false);
    check("notification cursor page includes unread count and next cursor", notifFirst.status === 200 && notifFirst.data.notifications.length === 3 && notifFirst.data.hasMore && Boolean(notifFirst.data.nextCursor) && notifFirst.data.unreadCount === 6);
    const notifCountOps = notifOps.filter((op) => op.collection === "notifications" && op.method === "countDocuments");
    check("notification cursor avoids total-count round trip", notifCountOps.length === 1 && notifCountOps[0].args[0]?.read === false);
    const notificationIds = notifFirst.data.notifications.map((item) => String(item._id));
    let notificationCursor = notifFirst.data.nextCursor;
    while (notificationCursor) {
      const page = await request(base, `/notifications?${queryString({ limit: 3, cursor: notificationCursor })}`, { user: notificationOwner });
      check("notification cursor page succeeds", page.status === 200);
      notificationIds.push(...page.data.notifications.map((item) => String(item._id)));
      notificationCursor = page.data.nextCursor;
    }
    check("notification keyset stays user-scoped and gap-free", notificationIds.length === 7 && new Set(notificationIds).size === 7 && notificationIds.every((id) => notifications.some((row) => String(row._id) === id)));
    const notifLegacy = await request(base, "/notifications?page=2&limit=3", { user: notificationOwner });
    check("legacy notification page remains intact", notifLegacy.status === 200 && notifLegacy.data.page === 2 && notifLegacy.data.hasMore === true);

    console.log("\n═══ Communication and recipient history cursors ═══");
    const platformCommunications = [];
    for (let i = 0; i < 7; i += 1) platformCommunications.push(await makeCommunication({ sender: admin, scope: "PLATFORM", index: i }));
    const eventCommunications = [];
    for (let i = 0; i < 4; i += 1) eventCommunications.push(await makeCommunication({ sender: owner, scope: "EVENT", eventId: discoveryEvents[0]._id, index: i }));
    const communicationId = platformCommunications[0]._id;
    for (let i = 0; i < 7; i += 1) {
      await CommunicationDelivery.create({
        communicationId,
        recipientId: recipients[i]._id,
        recipientEmail: recipients[i].email,
        status: i === 6 ? "failed" : "sent",
        createdAt: FIXED_TIME,
        sentAt: FIXED_TIME,
      });
    }
    await CommunicationDelivery.collection.updateMany({ communicationId }, { $set: { createdAt: FIXED_TIME } });
    check("platform communications history remains admin-only", (await request(base, "/admin/communications")).status === 401 && (await request(base, "/admin/communications", { user: owner })).status === 403);
    const commOps = [];
    mongoose.set("debug", (collection, method) => commOps.push(`${collection}.${method}`));
    const commFirst = await request(base, "/admin/communications?scope=PLATFORM&limit=3", { user: admin });
    mongoose.set("debug", false);
    check("platform history returns cursor page", commFirst.status === 200 && commFirst.data.items.length === 3 && commFirst.data.hasMore && Boolean(commFirst.data.nextCursor));
    check("communication cursor avoids count query", !commOps.includes("communications.countDocuments"), commOps.join(","));
    const communicationIds = commFirst.data.items.map((item) => String(item._id));
    let commCursor = commFirst.data.nextCursor;
    while (commCursor) {
      const page = await request(base, `/admin/communications?${queryString({ scope: "PLATFORM", limit: 3, cursor: commCursor })}`, { user: admin });
      check("platform history cursor page succeeds", page.status === 200);
      communicationIds.push(...page.data.items.map((item) => String(item._id)));
      commCursor = page.data.nextCursor;
    }
    check("platform communication pages cover each matching row once", communicationIds.length === 7 && new Set(communicationIds).size === 7);
    const commLegacy = await request(base, "/admin/communications?scope=PLATFORM&page=2&limit=2", { user: admin });
    check("legacy communication page retains page/total/nextPage", commLegacy.status === 200 && commLegacy.data.page === 2 && commLegacy.data.total === 7 && commLegacy.data.nextPage === 3);

    const eventHistoryDenied = await request(base, `/events/${discoveryEvents[0]._id}/communications?limit=2`, { user: outsider });
    check("event communication history authorization is unchanged", eventHistoryDenied.status === 403);
    const eventHistory = await request(base, `/events/${discoveryEvents[0]._id}/communications?limit=2`, { user: owner });
    check("authorized event communication history is cursor-paginated", eventHistory.status === 200 && eventHistory.data.items.length === 2 && eventHistory.data.hasMore && Boolean(eventHistory.data.nextCursor));
    const deliveryFirst = await request(base, `/admin/communications/${communicationId}/deliveries?limit=3`, { user: admin });
    check("delivery history returns oldest-first cursor page", deliveryFirst.status === 200 && deliveryFirst.data.items.length === 3 && deliveryFirst.data.hasMore && Boolean(deliveryFirst.data.nextCursor));
    const deliveryIds = deliveryFirst.data.items.map((item) => String(item._id));
    let deliveryCursor = deliveryFirst.data.nextCursor;
    while (deliveryCursor) {
      const page = await request(base, `/admin/communications/${communicationId}/deliveries?${queryString({ limit: 3, cursor: deliveryCursor })}`, { user: admin });
      check("delivery cursor page succeeds", page.status === 200);
      deliveryIds.push(...page.data.items.map((item) => String(item._id)));
      deliveryCursor = page.data.nextCursor;
    }
    check("ascending delivery pages cover every recipient exactly once", deliveryIds.length === 7 && new Set(deliveryIds).size === 7);
    const deliveryLegacy = await request(base, `/admin/communications/${communicationId}/deliveries?page=2&limit=3`, { user: admin });
    check("legacy delivery page preserves totals", deliveryLegacy.status === 200 && deliveryLegacy.data.page === 2 && deliveryLegacy.data.total === 7);

    console.log("\n═══ Admin/Organization Event lists and batched ticket statistics ═══");
    const adminEvents = await request(base, "/events/admin/list?limit=3", { user: admin });
    check("admin Event list returns a stable cursor page", adminEvents.status === 200 && adminEvents.data.events.length === 3 && adminEvents.data.hasMore && Boolean(adminEvents.data.nextCursor));
    const adminEventLegacy = await request(base, "/events/admin/list?page=2&limit=3", { user: admin });
    check("legacy admin Event page still includes totals", adminEventLegacy.status === 200 && adminEventLegacy.data.pagination?.page === 2 && adminEventLegacy.data.pagination?.total >= 7);

    const organization = await Organization.create({ name: "Phase Ten Org", slug: "phase10-org", createdBy: owner._id });
    const organizationEvents = [];
    for (let i = 0; i < 4; i += 1) {
      organizationEvents.push(await makeEvent({
        title: `Organization Event ${i}`,
        owner,
        visibility: "private",
        organizerType: "ORGANIZATION",
        organizerId: organization._id,
        organizationId: organization._id,
      }));
    }
    const orgPath = `/events/organization/${organization._id}/manage`;
    const organizationDenied = await request(base, `${orgPath}?limit=2`, { user: outsider });
    check("Organization Event Manager authorization is unchanged", organizationDenied.status === 403);
    const orgFirst = await request(base, `${orgPath}?limit=2`, { user: owner });
    check("explicitly owned Organization Event list returns cursor page", orgFirst.status === 200 && orgFirst.data.events.length === 2 && orgFirst.data.hasMore && Boolean(orgFirst.data.nextCursor));
    const orgIds = orgFirst.data.events.map((item) => String(item._id));
    const orgSecond = await request(base, `${orgPath}?${queryString({ limit: 2, cursor: orgFirst.data.nextCursor })}`, { user: owner });
    orgIds.push(...orgSecond.data.events.map((item) => String(item._id)));
    check("Organization Event cursor pages cover only explicit owner-pair records", orgIds.length === 4 && new Set(orgIds).size === 4 && orgIds.every((id) => organizationEvents.some((event) => String(event._id) === id)));
    const orgLegacy = await request(base, `${orgPath}?page=2&limit=2`, { user: owner });
    check("legacy Organization Event page includes total", orgLegacy.status === 200 && orgLegacy.data.pagination?.page === 2 && orgLegacy.data.pagination?.total === 4);

    const statsEvent = await makeEvent({ title: "Stats Event", owner, visibility: "private" });
    const statAttendee = await makeUser("Stat Attendee", "phase10-stat-attendee@example.test");
    const ticketAttendee = await makeUser("Ticket Attendee", "phase10-ticket-attendee@example.test");
    const pendingAttendee = await makeUser("Pending Ticket Attendee", "phase10-pending-attendee@example.test");
    await RegistrationResponse.create({ eventId: statsEvent._id, userId: statAttendee._id, status: "confirmed", rsvpSent: true });
    await Ticket.create([
      { eventId: statsEvent._id, userId: ticketAttendee._id, qrCode: "phase10-qr-a", token: "phase10-ticket-a", status: "active" },
      { eventId: statsEvent._id, userId: pendingAttendee._id, qrCode: "phase10-qr-b", token: "phase10-ticket-b", status: "pending" },
    ]);
    const statOps = [];
    mongoose.set("debug", (collection, method) => statOps.push(`${collection}.${method}`));
    const statsResponse = await request(base, "/events/admin/with-stats?limit=100", { user: admin });
    mongoose.set("debug", false);
    check("admin ticket-stat Event list uses cursor envelope", statsResponse.status === 200 && Array.isArray(statsResponse.data.events) && statsResponse.data.hasMore === false);
    const stats = statsResponse.data.events.find((event) => String(event._id) === String(statsEvent._id))?.stats;
    check("ticket and RSVP metrics preserve their values", stats?.totalTickets === 2 && stats.pendingTickets === 1 && stats.totalRegistrations === 1 && stats.rsvpSentCount === 1 && stats.ticketCoverage === 200 && stats.rsvpRate === 100);
    check("ticket stats use two page-batched aggregations, not four queries per Event", statOps.filter((op) => op.endsWith(".aggregate")).length === 2 && !statOps.some((op) => op.endsWith(".countDocuments")), statOps.join(","));
    const statsLegacy = await request(base, "/events/admin/with-stats?page=1&limit=100", { user: admin });
    check("legacy ticket-stat page still returns pagination totals", statsLegacy.status === 200 && statsLegacy.data.pagination?.page === 1 && statsLegacy.data.pagination?.total >= 12);

    console.log("\n═══ Isolated index plan and explain execution checks ═══");
    for (const index of PERFORMANCE_INDEXES) {
      await MODELS[index.model].collection.createIndex(index.keys, { name: index.name });
    }
    const probeEventId = new mongoose.Types.ObjectId();
    const probeConversationId = new mongoose.Types.ObjectId();
    const probeDeliveryCommunicationId = new mongoose.Types.ObjectId();
    await seedIndexProbeData({
      owner,
      admin,
      notificationOwner,
      eventId: probeEventId,
      organizationId: organization._id,
      deliveryCommunicationId: probeDeliveryCommunicationId,
      conversationId: probeConversationId,
    });

    await explainBounded({
      label: "public Event discovery",
      model: Event,
      filter: { visibility: "public", archivedAt: null, removedAt: null },
      sort: { startDate: 1, _id: 1 },
      indexName: "p10_event_public_discovery_cursor",
    });
    await explainBounded({
      label: "Community directory",
      model: Community,
      filter: { deletedAt: null, status: { $ne: "suspended" } },
      sort: { createdAt: -1, _id: -1 },
      indexName: "p10_community_directory_created_cursor",
    });
    await explainBounded({
      label: "Notification recipient inbox",
      model: Notification,
      filter: { user: notificationOwner._id },
      sort: { createdAt: -1, _id: -1 },
      indexName: "p10_notification_user_created_cursor",
    });
    await explainBounded({
      label: "Platform Communication history",
      model: Communication,
      filter: { scope: "PLATFORM" },
      sort: { createdAt: -1, _id: -1 },
      indexName: "p10_communication_scope_created_cursor",
    });
    await explainBounded({
      label: "status-filtered platform Communication history",
      model: Communication,
      filter: { scope: "PLATFORM", status: "sent" },
      sort: { createdAt: -1, _id: -1 },
      indexName: "p10_communication_scope_status_created_cursor",
    });
    await explainBounded({
      label: "Event Communication history",
      model: Communication,
      filter: { scope: "EVENT", eventId: discoveryEvents[0]._id },
      sort: { createdAt: -1, _id: -1 },
      indexName: "p10_communication_event_created_cursor",
    });
    await explainBounded({
      label: "recipient Delivery history",
      model: CommunicationDelivery,
      filter: { communicationId: probeDeliveryCommunicationId },
      sort: { createdAt: 1, _id: 1 },
      indexName: "p10_delivery_communication_created_cursor",
    });
    await explainBounded({
      label: "admin Event list",
      model: Event,
      filter: { removedAt: null, archivedAt: null },
      sort: { createdAt: -1, _id: -1 },
      indexName: "p10_event_admin_created_cursor",
    });
    await explainBounded({
      label: "Organization-managed Event list",
      model: Event,
      filter: { organizerType: "ORGANIZATION", organizerId: organization._id, archivedAt: null },
      sort: { createdAt: -1, _id: -1 },
      indexName: "p10_event_org_owner_created_cursor",
    });
    await explainBounded({
      label: "admin ticket-stat Event list",
      model: Event,
      filter: {},
      sort: { createdAt: -1, _id: -1 },
      indexName: "p10_event_stats_created_cursor",
    });
    await explainBounded({
      label: "Event participant registration list",
      model: RegistrationResponse,
      filter: { eventId: probeEventId },
      sort: { createdAt: -1, _id: -1 },
      indexName: "p10_registration_event_created_cursor",
    });
    await explainBounded({
      label: "conversation message history",
      model: Message,
      filter: { conversation: probeConversationId, deletedAt: null },
      sort: { createdAt: -1, _id: -1 },
      indexName: "p10_message_conversation_created_cursor",
    });

    const postMigrationPlan = {};
    for (const [name, model] of Object.entries(MODELS)) postMigrationPlan[name] = await model.collection.indexes();
    check("index migration plan is idempotent after isolated apply", planPerformanceIndexes(postMigrationPlan).every((item) => item.present));

    console.log(`\nPhase 10 performance self-test: ${checks} checks passed.`);
  } catch (error) {
    console.error("\nPhase 10 performance self-test failed:", error?.stack || error);
    process.exitCode = 1;
  } finally {
    mongoose.set("debug", false);
    if (server) await new Promise((resolve) => server.close(resolve));
    await mongoose.disconnect().catch(() => {});
    if (mongod) await mongod.stop().catch(() => {});
  }
})();
