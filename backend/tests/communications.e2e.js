"use strict";

// Focused communications checks. All persistence uses MongoMemoryServer and
// email delivery is stubbed; this test never calls a real provider/database.
process.env.NODE_ENV = "test";
process.env.PORT = "5078";
process.env.JWT_SECRET = "communications-test-secret";
process.env.REDIS_ENABLED = "false";
process.env.RATE_LIMIT_DISABLED = "1";

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const express = require("express");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const User = require("../models/user.model");
const Event = require("../models/event.model");
const RegistrationResponse = require("../models/registrationResponse.model");
const Communication = require("../models/communication.model");
const CommunicationDelivery = require("../models/communicationDelivery.model");
const emailService = require("../services/email.service");

const sentMail = [];
const originalEmailSend = emailService.send;
emailService.send = async (mail) => {
  sentMail.push(mail);
  if (mail.to === "fail@communications.test") throw new Error("mock provider failure");
  return { provider: "mock", messageId: `mock-${sentMail.length}` };
};

function tokenFor(user) {
  return jwt.sign({ id: String(user._id), role: user.role, purpose: "auth" }, process.env.JWT_SECRET, { expiresIn: "1h" });
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
    lastName: "Tester",
    username: name.toLowerCase().replace(/[^a-z0-9]+/g, ""),
    email,
    role,
    passwordHash: "test-password",
    emailVerified: true,
  });
}

async function makeEvent(owner) {
  const slug = `communications-${Date.now()}`;
  return Event.create({
    title: "Communications Test Event",
    slug,
    description: "Fixture",
    eventType: "offline",
    venue: "Delhi",
    startDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
    endDate: new Date(Date.now() + 26 * 60 * 60 * 1000),
    createdBy: owner._id,
    visibility: "public",
  });
}

(async () => {
  let mongod;
  let server;
  try {
    mongod = await MongoMemoryServer.create();
    process.env.MONGO_URI = mongod.getUri();
    await mongoose.connect(process.env.MONGO_URI);
    await Promise.all([User.init(), Event.init(), RegistrationResponse.init(), Communication.init(), CommunicationDelivery.init()]);

    const app = express();
    app.use(express.json());
    app.use("/api/admin", require("../routes/admin.routes"));
    app.use("/api/events", require("../routes/event.routes"));
    server = await new Promise((resolve, reject) => {
      const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
      listening.once("error", reject);
    });
    const base = `http://127.0.0.1:${server.address().port}/api`;

    const owner = await makeUser("Event Owner", "owner@communications.test");
    const outsider = await makeUser("Outsider", "outsider@communications.test");
    const attendee = await makeUser("Attendee", "attendee@communications.test");
    const failingAttendee = await makeUser("Failing Attendee", "fail@communications.test");
    const admin = await makeUser("Platform Admin", "admin@communications.test", "admin");
    const event = await makeEvent(owner);
    await RegistrationResponse.create([
      { eventId: event._id, userId: attendee._id, status: "confirmed" },
      { eventId: event._id, userId: failingAttendee._id, status: "pending" },
    ]);

    assert.equal((await request(base, "/admin/communications")).status, 401, "history requires login");
    const unauthorizedPlatformSend = await request(base, "/admin/communications/platform", {
      user: owner,
      method: "POST",
      body: { subject: "No", message: "Should not send" },
    });
    assert.equal(unauthorizedPlatformSend.status, 403, "Event owner cannot send platform-wide email");
    assert.equal(sentMail.length, 0, "authorization blocks mail before provider call");

    const unauthorizedEventSend = await request(base, `/events/${event._id}/communications`, {
      user: outsider,
      method: "POST",
      body: { subject: "No", message: "Should not send", userIds: [String(attendee._id)] },
    });
    assert.equal(unauthorizedEventSend.status, 403, "unrelated user cannot send Event email");
    assert.equal(sentMail.length, 0);

    const excludedRecipientSend = await request(base, `/events/${event._id}/communications`, {
      user: owner,
      method: "POST",
      body: { subject: "No", message: "Not registered", userIds: [String(outsider._id)] },
    });
    assert.equal(excludedRecipientSend.status, 400, "Event send is limited to registered recipients");
    assert.equal(sentMail.length, 0);

    const eventMessage = await request(base, `/events/${event._id}/communications`, {
      user: owner,
      method: "POST",
      body: {
        subject: "Schedule update",
        message: "Doors open at 9.\n<script>alert('x')</script>",
        userIds: [String(attendee._id), String(failingAttendee._id)],
      },
    });
    assert.equal(eventMessage.status, 201, JSON.stringify(eventMessage.data));
    assert.equal(eventMessage.data.communication.status, "partial");
    assert.equal(eventMessage.data.communication.recipientCount, 2);
    assert.equal(eventMessage.data.communication.sentCount, 1);
    assert.equal(eventMessage.data.communication.failedCount, 1);
    assert.equal(eventMessage.data.results.length, 2);
    assert.match(sentMail[0].html, /&lt;script&gt;/, "custom content is escaped before rendering");
    assert.doesNotMatch(sentMail[0].html, /<script>/);

    const eventDeliveries = await CommunicationDelivery.find({ communicationId: eventMessage.data.communication._id }).sort({ recipientEmail: 1 }).lean();
    assert.equal(eventDeliveries.length, 2, "one persisted row per selected recipient");
    assert.deepEqual(eventDeliveries.map((row) => [row.recipientEmail, row.status]), [
      ["attendee@communications.test", "sent"],
      ["fail@communications.test", "failed"],
    ]);
    const eventHistory = await request(base, `/events/${event._id}/communications`, { user: owner });
    assert.equal(eventHistory.status, 200);
    assert.equal(eventHistory.data.items[0].subject, "Schedule update");
    const privateDeliveries = await request(base, `/events/${event._id}/communications/${eventMessage.data.communication._id}/deliveries`, { user: outsider });
    assert.equal(privateDeliveries.status, 403, "recipient history respects Event-management authorization");

    const beforePlatform = sentMail.length;
    const platformMessage = await request(base, "/admin/communications/platform", {
      user: admin,
      method: "POST",
      body: { subject: "Platform notice", message: "A platform-wide note." },
    });
    assert.equal(platformMessage.status, 201, JSON.stringify(platformMessage.data));
    assert.equal(platformMessage.data.communication.scope, "PLATFORM");
    assert.equal(platformMessage.data.communication.recipientCount, await User.countDocuments());
    assert.equal(sentMail.length - beforePlatform, await User.countDocuments());
    const adminHistory = await request(base, "/admin/communications?scope=PLATFORM", { user: admin });
    assert.equal(adminHistory.status, 200);
    assert.equal(adminHistory.data.items[0].subject, "Platform notice");
    const adminDeliveries = await request(base, `/admin/communications/${platformMessage.data.communication._id}/deliveries`, { user: admin });
    assert.equal(adminDeliveries.status, 200);
    assert.equal(adminDeliveries.data.items.length, await User.countDocuments());

    // The 90-day cleanup is explicit, dry-run by default, and removes child
    // delivery rows before campaign rows. It never uses Mongo TTL indexes.
    const oldDate = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000);
    const oldCommunication = await Communication.create({
      sender: admin._id,
      scope: "PLATFORM",
      kind: "PLATFORM_CUSTOM",
      subject: "Expired test row",
      status: "sent",
      recipientCount: 1,
      sentCount: 1,
    });
    await Communication.collection.updateOne({ _id: oldCommunication._id }, { $set: { createdAt: oldDate } });
    const oldDelivery = await CommunicationDelivery.create({
      communicationId: oldCommunication._id,
      recipientId: attendee._id,
      recipientEmail: attendee.email,
      status: "sent",
      sentAt: oldDate,
    });
    await CommunicationDelivery.collection.updateOne({ _id: oldDelivery._id }, { $set: { createdAt: oldDate } });

    const runRetention = (args) => execFileSync("node", ["scripts/retention-sweeper.js", ...args], {
      cwd: require("node:path").join(__dirname, ".."),
      encoding: "utf8",
      env: { ...process.env },
    });
    const dryRun = runRetention(["--section=communications", "--json"]);
    assert.match(dryRun, /"mode":"dry-run"/);
    assert.ok(await Communication.exists({ _id: oldCommunication._id }), "dry run changes nothing");
    const applied = runRetention(["--section=communications", "--json", "--apply"]);
    assert.match(applied, /"mode":"apply"/);
    assert.equal(await Communication.exists({ _id: oldCommunication._id }), null);
    assert.equal(await CommunicationDelivery.exists({ _id: oldDelivery._id }), null);
    assert.ok(await Communication.exists({ _id: platformMessage.data.communication._id }), "recent history remains");

    const ttlIndexes = [Communication, CommunicationDelivery].flatMap((model) => model.schema.indexes());
    assert.equal(ttlIndexes.some(([, options]) => options?.expireAfterSeconds != null), false, "retention is handled by the paired sweeper, not TTL");

    console.log("\nCommunications E2E passed (mail mocked; MongoDB in memory).");
  } catch (error) {
    console.error("\nCommunications E2E failed:", error);
    process.exitCode = 1;
  } finally {
    emailService.send = originalEmailSend;
    if (server) await new Promise((resolve) => server.close(resolve));
    if (mongoose.connection.readyState) await mongoose.disconnect();
    if (mongod) await mongod.stop();
  }
})();
