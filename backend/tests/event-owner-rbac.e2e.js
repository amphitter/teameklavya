"use strict";

/** Focused Phase 5/7 checks: explicit Event ownership, Organization Event
 * Manager scope, scoped communication sends, Super Admin identity hints, soft
 * archive behavior, and dry-run/apply owner backfill. Uses only an in-memory
 * MongoDB; it never touches production or a configured MONGO_URI. */
process.env.NODE_ENV = "test";
process.env.PORT = "5077";
process.env.JWT_SECRET = "event-owner-rbac-test-secret";
process.env.REDIS_ENABLED = "false";

const assert = require("node:assert/strict");
const express = require("express");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const User = require("../models/user.model");
const Event = require("../models/event.model");
const Organization = require("../models/organization.model");
const OrganizationMembership = require("../models/organizationMembership.model");
const RegistrationResponse = require("../models/registrationResponse.model");
const Ticket = require("../models/ticket.model");
const Post = require("../models/post.model");
const emailService = require("../services/email.service");
const attemptedEmails = [];
const originalEmailSend = emailService.send;
emailService.send = async (message) => {
  attemptedEmails.push(message);
  return { accepted: [message.to] };
};
const { SUPER_ADMIN_EMAIL } = require("../services/ownership.service");
const { runEventOwnerPhase5Backfill } = require("../migrations/event-owner-phase5-backfill.migration");

function tokenFor(user) {
  return jwt.sign(
    { id: String(user._id), role: user.role || "user", purpose: "auth" },
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

async function makeUser(username, role = "user", email = `${username}@phase5.test`) {
  return User.create({
    firstName: username,
    lastName: "Tester",
    username,
    email,
    role,
    passwordHash: "test-password",
    emailVerified: true,
  });
}

async function makeEvent(values = {}) {
  const suffix = Math.random().toString(36).slice(2, 9);
  return Event.create({
    title: `Phase Five Event ${suffix}`,
    slug: `phase-five-event-${suffix}`,
    description: "Event ownership test fixture",
    eventType: "offline",
    venue: "Oslo",
    startDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
    endDate: new Date(Date.now() + 26 * 60 * 60 * 1000),
    ...values,
  });
}

(async () => {
  let mongod;
  let server;
  try {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
    await Promise.all([
      User.init(), Event.init(), Organization.init(), OrganizationMembership.init(),
      RegistrationResponse.init(), Ticket.init(), Post.init(),
    ]);

    const app = express();
    app.use(express.json());
    app.use("/api/auth", require("../routes/auth.routes"));
    app.use("/api/admin", require("../routes/admin.routes"));
    app.use("/api/events", require("../routes/event.routes"));
    app.use("/api/organizations", require("../routes/organization.routes"));
    app.use("/api/registration", require("../routes/registration.routes"));
    app.use("/api/tickets", require("../routes/ticket.routes"));
    app.use("/api/posts", require("../routes/post.routes"));
    await new Promise((resolve, reject) => {
      server = app.listen(0, "127.0.0.1", resolve);
      server.once("error", reject);
    });
    const base = `http://127.0.0.1:${server.address().port}/api`;

    const owner = await makeUser("p5owner");
    const orgAdmin = await makeUser("p5orgadmin");
    const eventManager = await makeUser("p5eventmanager");
    const orgManager = await makeUser("p5manager");
    const editor = await makeUser("p5editor");
    const member = await makeUser("p5member");
    const creator = await makeUser("p5creator");
    const platformAdmin = await makeUser("p5platformadmin", "admin");
    const superAdmin = await makeUser("p5superadmin", "user", SUPER_ADMIN_EMAIL);
    const mailRecipient = await makeUser("p5mailrecipient");

    // Phase 7 governance hint comes from the centralized email rule; it is not
    // a persisted User role and the browser still needs backend authorization.
    const superProfile = await request(base, "/auth/me", { user: superAdmin });
    assert.equal(superProfile.status, 200, JSON.stringify(superProfile.data));
    assert.equal(superProfile.data.user.isSuperAdmin, true);
    assert.equal(superProfile.data.user.role, "user");
    const ordinaryProfile = await request(base, "/auth/me", { user: creator });
    assert.equal(ordinaryProfile.status, 200);
    assert.equal(ordinaryProfile.data.user.isSuperAdmin, false);
    assert.equal((await request(base, "/admin/stats", { user: superAdmin })).status, 200);
    assert.equal((await request(base, "/admin/stats", { user: creator })).status, 403);

    const organization = await Organization.create({
      name: "Phase Five Event Organization",
      slug: "phase-five-event-organization",
      category: "TECH_COMMUNITY",
      createdBy: owner._id,
    });
    await OrganizationMembership.create([
      { organizationId: organization._id, userId: orgAdmin._id, role: "ADMIN", status: "ACTIVE" },
      { organizationId: organization._id, userId: eventManager._id, role: "EVENT_MANAGER", status: "ACTIVE" },
      { organizationId: organization._id, userId: orgManager._id, role: "MANAGER", status: "ACTIVE" },
      { organizationId: organization._id, userId: editor._id, role: "EDITOR", status: "ACTIVE" },
      { organizationId: organization._id, userId: member._id, role: "MEMBER", status: "ACTIVE" },
    ]);

    const createOrgEvent = await request(base, "/events", {
      user: eventManager,
      method: "POST",
      body: {
        title: "Created by an Event Manager",
        description: "An explicitly Organization-owned event",
        eventType: "offline",
        venue: "Oslo",
        startDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
        endDate: new Date(Date.now() + 4 * 24 * 60 * 60 * 1000).toISOString(),
        organization: String(organization._id),
        organizerType: "ORGANIZATION",
      },
    });
    assert.equal(createOrgEvent.status, 201, JSON.stringify(createOrgEvent.data));
    assert.equal(createOrgEvent.data.event.organizerType, "ORGANIZATION");
    assert.equal(String(createOrgEvent.data.event.organizerId), String(organization._id));
    assert.equal(String(createOrgEvent.data.event.createdBy), String(eventManager._id));
    const managerEventPost = await request(base, "/posts", {
      user: eventManager,
      method: "POST",
      body: { content: "Event Manager announcement", eventId: createOrgEvent.data.event._id, visibility: "event_participants", type: "text" },
    });
    assert.equal(managerEventPost.status, 201, JSON.stringify(managerEventPost.data));
    const profileManagerPost = await request(base, "/posts", {
      user: orgManager,
      method: "POST",
      body: { content: "Profile-only manager", eventId: createOrgEvent.data.event._id, visibility: "event_participants", type: "text" },
    });
    assert.equal(profileManagerPost.status, 403);
    assert.equal((await request(base, "/events", {
      user: orgManager,
      method: "POST",
      body: {
        title: "Not allowed",
        description: "MANAGER cannot create",
        eventType: "offline",
        venue: "Oslo",
        startDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
        endDate: new Date(Date.now() + 4 * 24 * 60 * 60 * 1000).toISOString(),
        organization: String(organization._id),
        organizerType: "ORGANIZATION",
      },
    })).status, 403);

    const orgEvent = await makeEvent({
      slug: "p5-explicit-organization-event",
      title: "Explicit Organization Event",
      organizerType: "ORGANIZATION",
      organizerId: organization._id,
      createdBy: creator._id,
      organization: organization._id,
    });
    const userOwnedAssociationEvent = await makeEvent({
      slug: "p5-user-owned-associated-event",
      title: "User Owned but Organization Associated",
      organizerType: "USER",
      organizerId: creator._id,
      createdBy: creator._id,
      organization: organization._id,
    });
    const legacyAssociatedEvent = await makeEvent({
      slug: "p5-legacy-associated-event",
      title: "Legacy Associated Event",
      createdBy: creator._id,
      organization: organization._id,
    });
    const orphanAssociatedEvent = await makeEvent({
      slug: "p5-orphan-associated-event",
      title: "Orphan Associated Event",
      organization: organization._id,
    });
    await RegistrationResponse.create({ eventId: orgEvent._id, userId: creator._id, status: "confirmed" });
    const orgTicket = await Ticket.create({
      eventId: orgEvent._id,
      userId: creator._id,
      qrCode: "fixture-qr",
      token: "phase5-org-event-ticket-token",
      status: "active",
    });

    // Phase 7: direct Event email sends are event-owner scoped, global
    // broadcasts are platform-admin-only, and recipient input is bounded.
    const mailCountBefore = attemptedEmails.length;
    const unsafeInvite = await request(base, "/events/send-rsvp", {
      user: eventManager,
      method: "POST",
      body: { eventId: orgEvent._id, userIds: [mailRecipient._id], rsvpLink: "javascript:alert(1)" },
    });
    assert.equal(unsafeInvite.status, 400);
    assert.equal(attemptedEmails.length, mailCountBefore, "unsafe CTA URLs are never emailed");

    const eventInvite = await request(base, "/events/send-rsvp", {
      user: eventManager,
      method: "POST",
      body: {
        eventId: orgEvent._id,
        userIds: [mailRecipient._id, mailRecipient._id],
        rsvpLink: "https://eventhub.test/events/phase-five-event",
      },
    });
    assert.equal(eventInvite.status, 200, JSON.stringify(eventInvite.data));
    assert.equal(eventInvite.data.results.length, 1, "duplicate recipient ids are deduplicated");
    assert.equal(attemptedEmails.length, mailCountBefore + 1);
    assert.match(attemptedEmails.at(-1).html, /https:\/\/eventhub\.test/);

    const managerCrossEventInvite = await request(base, "/events/send-rsvp", {
      user: eventManager,
      method: "POST",
      body: { eventId: userOwnedAssociationEvent._id, userIds: [mailRecipient._id] },
    });
    assert.equal(managerCrossEventInvite.status, 403, "Organization Event Managers cannot email a USER-owned associated Event");
    const profileManagerInvite = await request(base, "/events/send-rsvp", {
      user: orgManager,
      method: "POST",
      body: { eventId: orgEvent._id, userIds: [mailRecipient._id] },
    });
    assert.equal(profileManagerInvite.status, 403, "profile-only MANAGER cannot send Event email");

    const verificationInvite = await request(base, "/events/rsvp/send-with-verification", {
      user: eventManager,
      method: "POST",
      body: { eventId: orgEvent._id, userIds: [mailRecipient._id], customMessage: "Please confirm." },
    });
    assert.equal(verificationInvite.status, 200, JSON.stringify(verificationInvite.data));
    const verificationCrossEvent = await request(base, "/events/rsvp/send-with-verification", {
      user: eventManager,
      method: "POST",
      body: { eventId: userOwnedAssociationEvent._id, userIds: [mailRecipient._id] },
    });
    assert.equal(verificationCrossEvent.status, 403);

    const globalBroadcastDenied = await request(base, `/events/${orgEvent._id}/notify-all`, {
      user: eventManager, method: "POST",
    });
    assert.equal(globalBroadcastDenied.status, 403, "event managers cannot send to the platform-wide audience");
    const globalSendStart = attemptedEmails.length;
    const globalBroadcast = await request(base, `/events/${orgEvent._id}/notify-all`, {
      user: superAdmin, method: "POST",
    });
    assert.equal(globalBroadcast.status, 200, JSON.stringify(globalBroadcast.data));
    assert.equal(globalBroadcast.data.sentCount, await User.countDocuments());
    assert.equal(attemptedEmails.length - globalSendStart, await User.countDocuments());

    const eventTicket = await Ticket.create({
      eventId: orgEvent._id,
      userId: mailRecipient._id,
      qrCode: "data:image/png;base64,AAAA",
      token: "phase7-managed-ticket-token",
      status: "active",
    });
    const userOwnedTicket = await Ticket.create({
      eventId: userOwnedAssociationEvent._id,
      userId: mailRecipient._id,
      qrCode: "data:image/png;base64,AAAA",
      token: "phase7-user-owned-ticket-token",
      status: "active",
    });
    const ticketSendStart = attemptedEmails.length;
    const managedTicketSend = await request(base, "/tickets/send-ticket", {
      user: eventManager, method: "POST", body: { ticketId: eventTicket._id },
    });
    assert.equal(managedTicketSend.status, 200, JSON.stringify(managedTicketSend.data));
    assert.equal(attemptedEmails.length, ticketSendStart + 1);
    const crossEventTicketSend = await request(base, "/tickets/send-ticket", {
      user: eventManager, method: "POST", body: { ticketId: userOwnedTicket._id },
    });
    assert.equal(crossEventTicketSend.status, 403);
    assert.equal(attemptedEmails.length, ticketSendStart + 1, "unauthorized ticket sends do not send mail");

    const pendingOrgTicket = await Ticket.create({
      eventId: orgEvent._id,
      userId: mailRecipient._id,
      qrCode: "data:image/png;base64,AAAA",
      token: "phase7-pending-org-ticket-token",
      status: "pending",
    });
    const pendingUserTicket = await Ticket.create({
      eventId: userOwnedAssociationEvent._id,
      userId: mailRecipient._id,
      qrCode: "data:image/png;base64,AAAA",
      token: "phase7-pending-user-ticket-token",
      status: "pending",
    });
    const mixedApprovalMailStart = attemptedEmails.length;
    const mixedApproval = await request(base, "/tickets/approve-pending", {
      user: eventManager,
      method: "POST",
      body: { ticketIds: [pendingOrgTicket._id, pendingUserTicket._id] },
    });
    assert.equal(mixedApproval.status, 403, "mixed ticket batches are authorized before any email is sent");
    assert.equal(attemptedEmails.length, mixedApprovalMailStart);
    assert.equal((await Ticket.findById(pendingOrgTicket._id)).status, "pending");
    assert.equal((await Ticket.findById(pendingUserTicket._id)).status, "pending");

    // Explicit owner pair, not creator or association, controls Organization Events.
    assert.equal((await request(base, `/events/${orgEvent._id}`, { user: eventManager })).status, 200);
    assert.equal((await request(base, `/events/${orgEvent._id}`, { user: owner })).status, 200);
    assert.equal((await request(base, `/events/${orgEvent._id}`, { user: orgAdmin })).status, 200);
    for (const user of [orgManager, editor, member]) {
      assert.equal((await request(base, `/events/${orgEvent._id}`, { user })).status, 403, `${user.username} must not manage Events`);
    }

    // A matching Event.organization association does not grant access to USER-owned
    // or legacy creator-owned Events; their creator remains the legacy USER owner.
    for (const event of [userOwnedAssociationEvent, legacyAssociatedEvent]) {
      assert.equal((await request(base, `/events/${event._id}`, { user: eventManager })).status, 403);
      assert.equal((await request(base, `/events/${event._id}`, { user: creator })).status, 200);
    }
    assert.equal((await request(base, `/events/${orphanAssociatedEvent._id}`, { user: owner })).status, 403);
    assert.equal((await request(base, `/events/${orphanAssociatedEvent._id}`, { user: platformAdmin })).status, 200);
    assert.equal((await request(base, `/events/${orphanAssociatedEvent._id}`, { user: superAdmin })).status, 200);

    // Profile/membership administration remains out of Event Manager scope.
    const profile = await request(base, `/organizations/${organization.slug}`, { user: eventManager });
    assert.equal(profile.status, 200);
    assert.equal(profile.data.organization.canManage, false);
    assert.equal(profile.data.organization.canManageMembers, false);
    assert.equal(profile.data.organization.canManageEvents, true);
    assert.equal((await request(base, `/organizations/${organization._id}/members`, { user: eventManager })).status, 403);
    assert.equal((await request(base, `/organizations/${organization._id}`, {
      user: eventManager, method: "PUT", body: { description: "forbidden profile edit" },
    })).status, 403);
    const managerProfile = await request(base, `/organizations/${organization.slug}`, { user: orgManager });
    assert.equal(managerProfile.data.organization.canManageEvents, false);

    const managedList = await request(base, `/events/organization/${organization._id}/manage`, { user: eventManager });
    assert.equal(managedList.status, 200);
    assert.deepEqual(
      managedList.data.events.map((event) => String(event._id)).sort(),
      [String(orgEvent._id), String(createOrgEvent.data.event._id)].sort()
    );
    assert.equal((await request(base, `/events/organization/${organization._id}/manage`, { user: orgManager })).status, 403);

    // Event Manager may use the registration/ticket/event-analytics operations,
    // while MANAGER cannot. User-owned association event remains unavailable.
    assert.equal((await request(base, `/registration/responses/${orgEvent._id}`, { user: eventManager })).status, 200);
    assert.equal((await request(base, `/tickets/event/${orgEvent._id}/stats`, { user: eventManager })).status, 200);
    assert.equal((await request(base, `/events/${orgEvent._id}/live-settings`, { user: eventManager })).status, 200);
    assert.equal((await request(base, `/registration/responses/${orgEvent._id}`, { user: orgManager })).status, 403);
    assert.equal((await request(base, `/tickets/event/${userOwnedAssociationEvent._id}/stats`, { user: eventManager })).status, 403);
    assert.equal((await request(base, `/tickets/token/${orgTicket.token}`, { user: eventManager })).status, 200);
    assert.equal((await request(base, `/tickets/token/${orgTicket.token}`, { user: orgManager })).status, 403);
    await Event.updateOne({ _id: orgEvent._id }, {
      $set: { startDate: new Date(Date.now() - 60 * 60 * 1000), endDate: new Date(Date.now() + 60 * 60 * 1000) },
    });
    assert.equal((await request(base, "/tickets/scan", {
      user: orgManager, method: "POST", body: { token: orgTicket.token, action: "entry" },
    })).status, 403);
    const scanResult = await request(base, "/tickets/scan", {
      user: eventManager, method: "POST", body: { token: orgTicket.token, action: "entry" },
    });
    assert.equal(scanResult.status, 200, JSON.stringify(scanResult.data));
    assert.equal(scanResult.data.ticket.checkedIn, true);

    // A manager cannot mass-assign owner/provenance/moderation/archive fields.
    const before = {
      slug: orgEvent.slug,
      createdBy: String(orgEvent.createdBy),
      organizerType: orgEvent.organizerType,
      organizerId: String(orgEvent.organizerId),
    };
    const edited = await request(base, `/events/${orgEvent._id}`, {
      user: eventManager,
      method: "PUT",
      body: {
        description: "Updated by an authorized Event Manager",
        organizerType: "USER",
        organizerId: creator._id,
        createdBy: creator._id,
        removedAt: new Date().toISOString(),
        archivedAt: new Date().toISOString(),
        archivedBy: creator._id,
      },
    });
    assert.equal(edited.status, 200, JSON.stringify(edited.data));
    const after = await Event.findById(orgEvent._id).lean();
    assert.equal(after.description, "Updated by an authorized Event Manager");
    assert.equal(after.slug, before.slug, "ordinary updates without a title change preserve the public URL");
    assert.equal(String(after.createdBy), before.createdBy);
    assert.equal(after.organizerType, before.organizerType);
    assert.equal(String(after.organizerId), before.organizerId);
    assert.equal(after.removedAt, null);
    assert.equal(after.archivedAt, null);

    // The in-memory migration report leaves data untouched and reports related
    // objects. Applying maps only legacy ownership fields and keeps associations.
    await RegistrationResponse.collection.insertOne({ eventId: legacyAssociatedEvent._id, userId: creator._id, status: "confirmed" });
    await Ticket.collection.insertOne({
      eventId: legacyAssociatedEvent._id,
      userId: creator._id,
      qrCode: "fixture",
      token: "phase5-legacy-ticket-token",
      status: "active",
    });
    await Post.collection.insertOne({ author: creator._id, content: "legacy event post", event: legacyAssociatedEvent._id });

    const dryRun = await runEventOwnerPhase5Backfill({ apply: false });
    assert.equal(dryRun.mode, "dry-run");
    assert.equal(dryRun.eventsNeedingBackfill, 2);
    assert.equal(dryRun.userOwnersConsidered, 1);
    assert.equal(dryRun.platformOwnersConsidered, 1);
    assert.ok(dryRun.linkedRegistrationsByCohort.some((row) => row.linkedRecords >= 1));
    assert.ok(dryRun.linkedTicketsByCohort.some((row) => row.linkedRecords >= 1));
    assert.ok(dryRun.linkedPostsByCohort.some((row) => row.linkedRecords >= 1));
    assert.equal((await Event.findById(legacyAssociatedEvent._id).lean()).organizerType, undefined);

    const apply = await runEventOwnerPhase5Backfill({ apply: true });
    assert.equal(apply.mode, "apply");
    assert.equal(apply.eventsUpdated, 2);
    const mappedLegacy = await Event.findById(legacyAssociatedEvent._id).lean();
    const mappedOrphan = await Event.findById(orphanAssociatedEvent._id).lean();
    assert.equal(mappedLegacy.organizerType, "USER");
    assert.equal(String(mappedLegacy.organizerId), String(creator._id));
    assert.equal(String(mappedLegacy.organization), String(organization._id));
    assert.equal(mappedOrphan.organizerType, "PLATFORM");
    assert.equal(mappedOrphan.organizerId, null);
    assert.equal(String(mappedOrphan.organization), String(organization._id));
    assert.equal(String(mappedLegacy._id), String(legacyAssociatedEvent._id));
    assert.equal(mappedLegacy.slug, legacyAssociatedEvent.slug);

    // USER creators and Organization Event Managers continue on separate scopes.
    assert.equal((await request(base, `/events/${legacyAssociatedEvent._id}`, { user: creator })).status, 200);
    assert.equal((await request(base, `/events/${legacyAssociatedEvent._id}`, { user: eventManager })).status, 403);
    assert.equal((await request(base, `/events/${orphanAssociatedEvent._id}`, { user: eventManager })).status, 403);

    // Archive is reversible, hides public URLs/discovery and new registrations,
    // and preserves related records. It is not moderation removal or hard delete.
    await request(base, `/events/slug/${orgEvent.slug}`, { user: eventManager }).then((r) => assert.equal(r.status, 200));
    const archived = await request(base, `/events/${orgEvent._id}/archive`, {
      user: eventManager, method: "PATCH", body: { archived: true },
    });
    assert.equal(archived.status, 200);
    assert.ok(archived.data.event.archivedAt);
    assert.equal((await request(base, `/events/slug/${orgEvent.slug}`, { user: eventManager })).status, 404);
    assert.equal((await request(base, `/registration/form/${orgEvent._id}`, { user: eventManager })).status, 404);
    assert.equal((await request(base, `/events/${orgEvent._id}`, { user: eventManager, method: "DELETE" })).status, 403);
    assert.equal(await RegistrationResponse.countDocuments({ eventId: legacyAssociatedEvent._id }), 1);
    assert.equal(await Ticket.countDocuments({ eventId: legacyAssociatedEvent._id }), 1);
    assert.equal(await Post.countDocuments({ event: legacyAssociatedEvent._id }), 1);

    const archivedList = await request(base, `/events/organization/${organization._id}/manage?archived=true`, { user: eventManager });
    assert.equal(archivedList.status, 200);
    assert.ok(archivedList.data.events.some((event) => String(event._id) === String(orgEvent._id)));
    const restored = await request(base, `/events/${orgEvent._id}/archive`, {
      user: eventManager, method: "PATCH", body: { archived: false },
    });
    assert.equal(restored.status, 200);
    assert.equal(restored.data.event.archivedAt, null);
    assert.equal((await request(base, `/events/slug/${orgEvent.slug}`, { user: eventManager })).status, 200);

    console.log("✅ Event owner / Organization Event Manager Phase 5 + governance/communication Phase 7 checks passed");
  } catch (error) {
    console.error("❌ Event owner / Organization Event Manager Phase 5 checks failed:", error);
    process.exitCode = 1;
  } finally {
    emailService.send = originalEmailSend;
    if (server) await new Promise((resolve) => server.close(resolve));
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    if (mongod) await mongod.stop();
  }
})();
