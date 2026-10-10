"use strict";

/** Focused Phase 6 coverage: nullable Event logos, a separate square upload /
 * replace / remove lifecycle, owner authorization, public redaction, and the
 * generic upload-attachment ownership guard. Uses only in-memory MongoDB. */
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "event-logo-phase6-test-secret";
process.env.REDIS_ENABLED = "false";
for (const key of ["CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"]) delete process.env[key];

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const express = require("express");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

const uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), "event-logo-phase6-"));
process.env.UPLOADS_DIR = uploadsDir;

const User = require("../models/user.model");
const Event = require("../models/event.model");
const MediaAsset = require("../models/mediaAsset.model");
const uploadRoutes = require("../routes/upload.routes");
const eventRoutes = require("../routes/event.routes");

function png(width, height) {
  const buffer = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0);
  buffer.writeUInt32BE(13, 8);
  buffer.write("IHDR", 12, "ascii");
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

function tokenFor(user) {
  return jwt.sign(
    { id: String(user._id), role: user.role || "user", purpose: "auth" },
    process.env.JWT_SECRET,
    { expiresIn: "1h" }
  );
}

async function jsonRequest(base, route, { user, method = "GET", body } = {}) {
  const response = await fetch(`${base}${route}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(user ? { Authorization: `Bearer ${tokenFor(user)}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  let data = {};
  try { data = await response.json(); } catch {}
  return { status: response.status, data };
}

async function uploadLogo(base, eventId, user, width = 256, height = 256) {
  const form = new FormData();
  form.append("file", new Blob([png(width, height)], { type: "image/png" }), "event-logo.png");
  const response = await fetch(`${base}/upload/event/${eventId}/logo`, {
    method: "POST",
    headers: { Authorization: `Bearer ${tokenFor(user)}` },
    body: form,
  });
  let data = {};
  try { data = await response.json(); } catch {}
  return { status: response.status, data };
}

async function uploadGeneric(base, user, folder, width = 256, height = 256) {
  const form = new FormData();
  form.append("file", new Blob([png(width, height)], { type: "image/png" }), "organization-logo.png");
  const response = await fetch(`${base}/upload/image?folder=${folder}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${tokenFor(user)}` },
    body: form,
  });
  let data = {};
  try { data = await response.json(); } catch {}
  return { status: response.status, data };
}

async function makeUser(username, role = "user") {
  return User.create({
    firstName: username,
    lastName: "Tester",
    username,
    email: `${username}@phase6.test`,
    role,
    passwordHash: "phase-six-test-password",
    emailVerified: true,
  });
}

async function makeEvent(owner) {
  const suffix = Math.random().toString(36).slice(2, 9);
  return Event.create({
    title: `Logo Phase Six ${suffix}`,
    slug: `logo-phase-six-${suffix}`,
    description: "Optional Event logo fixture",
    eventType: "offline",
    venue: "Oslo",
    visibility: "public",
    createdBy: owner._id,
    startDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
    endDate: new Date(Date.now() + 26 * 60 * 60 * 1000),
  });
}

(async () => {
  let mongod;
  let server;
  try {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
    await Promise.all([User.init(), Event.init(), MediaAsset.init()]);

    const app = express();
    app.use(express.json());
    app.use("/api/upload", uploadRoutes);
    app.use("/api/events", eventRoutes);
    await new Promise((resolve, reject) => {
      server = app.listen(0, "127.0.0.1", resolve);
      server.once("error", reject);
    });
    const base = `http://127.0.0.1:${server.address().port}/api`;

    const owner = await makeUser("phase6logoowner");
    const stranger = await makeUser("phase6logostranger");
    const admin = await makeUser("phase6logoadmin", "admin");
    const event = await makeEvent(owner);
    assert.equal(event.logoUrl, null, "new Events start with a nullable, separate logo field");
    assert.equal(event.logoPublicId, null);

    const denied = await uploadLogo(base, event._id, stranger);
    assert.equal(denied.status, 403, "a non-manager cannot upload an Event logo");
    assert.equal(await MediaAsset.countDocuments(), 0, "authorization runs before storage");

    const nonsquare = await uploadLogo(base, event._id, owner, 256, 128);
    assert.equal(nonsquare.status, 400, "the dedicated logo path enforces a square canonical crop");
    assert.equal(await MediaAsset.countDocuments(), 0, "invalid logo shape is not stored or tracked");

    const first = await uploadLogo(base, event._id, owner);
    assert.equal(first.status, 200, JSON.stringify(first.data));
    assert.equal(first.data.success, true);
    assert.equal(Object.hasOwn(first.data, "publicId"), false, "provider IDs stay out of the logo response");
    let current = await Event.findById(event._id).lean();
    assert.ok(current.logoUrl);
    assert.ok(current.logoPublicId);
    const firstAsset = await MediaAsset.findOne({ publicId: current.logoPublicId }).lean();
    assert.equal(firstAsset.status, "active");
    assert.equal(firstAsset.attachedTo, `event:${event._id}:logo`);
    const firstFile = path.join(uploadsDir, firstAsset.publicId.slice("local/".length));
    assert.equal(fs.existsSync(firstFile), true);

    const publicDetail = await jsonRequest(base, `/events/slug/${event.slug}`);
    assert.equal(publicDetail.status, 200);
    assert.equal(publicDetail.data.event.logoUrl, current.logoUrl);
    assert.equal(Object.hasOwn(publicDetail.data.event, "logoPublicId"), false);
    assert.equal(Object.hasOwn(publicDetail.data.event, "createdBy"), false);

    const second = await uploadLogo(base, event._id, owner);
    assert.equal(second.status, 200, JSON.stringify(second.data));
    current = await Event.findById(event._id).lean();
    const secondAsset = await MediaAsset.findOne({ publicId: current.logoPublicId }).lean();
    assert.notEqual(current.logoPublicId, firstAsset.publicId);
    assert.equal((await MediaAsset.findOne({ publicId: firstAsset.publicId }).lean()).status, "deleted");
    assert.equal(fs.existsSync(firstFile), false, "replaced local assets are actually removed");
    assert.equal(secondAsset.status, "active");

    const removed = await jsonRequest(base, `/upload/event/${event._id}/logo`, { user: owner, method: "DELETE" });
    assert.equal(removed.status, 200, JSON.stringify(removed.data));
    assert.equal(removed.data.logoUrl, null);
    current = await Event.findById(event._id).lean();
    assert.equal(current.logoUrl, null);
    assert.equal(current.logoPublicId, null);
    assert.equal((await MediaAsset.findOne({ publicId: secondAsset.publicId }).lean()).status, "deleted");
    const noLogo = await jsonRequest(base, `/events/slug/${event.slug}`);
    assert.equal(noLogo.status, 200);
    assert.equal(noLogo.data.event.logoUrl, null, "legacy/no-logo Events remain public and null-compatible");
    assert.equal(Object.hasOwn(noLogo.data.event, "logoPublicId"), false);

    // Generic attachment is not an authorization token: only the uploading
    // user may transition their pending asset to active.
    const genericUpload = await uploadGeneric(base, owner, "organizations");
    assert.equal(genericUpload.status, 200, JSON.stringify(genericUpload.data));
    const pendingPublicId = genericUpload.data.publicId;
    const pending = await MediaAsset.findOne({ publicId: pendingPublicId }).lean();
    assert.equal(pending.folder, "organizations", "legacy Organization folder alias is accepted");
    assert.equal(pending.purpose, "logo", "Organization folder receives the logo variant preset");
    assert.equal(pending.status, "pending");

    const attachDenied = await jsonRequest(base, "/upload/attach", {
      user: stranger,
      method: "POST",
      body: { publicId: pendingPublicId, attachedTo: "organization:any:logo" },
    });
    assert.equal(attachDenied.status, 404);
    assert.equal((await MediaAsset.findOne({ publicId: pendingPublicId }).lean()).status, "pending");
    const attachAllowed = await jsonRequest(base, "/upload/attach", {
      user: owner,
      method: "POST",
      body: { publicId: pendingPublicId, attachedTo: "organization:test-org:logo" },
    });
    assert.equal(attachAllowed.status, 200, JSON.stringify(attachAllowed.data));
    const attached = await MediaAsset.findOne({ publicId: pendingPublicId }).lean();
    assert.equal(attached.status, "active");
    assert.equal(attached.attachedTo, "organization:test-org:logo");

    const deletedEvent = await makeEvent(owner);
    const deleteLogo = await uploadLogo(base, deletedEvent._id, owner);
    assert.equal(deleteLogo.status, 200, JSON.stringify(deleteLogo.data));
    const deleteAsset = await MediaAsset.findOne({ publicId: (await Event.findById(deletedEvent._id)).logoPublicId }).lean();
    const deleteFile = path.join(uploadsDir, deleteAsset.publicId.slice("local/".length));
    const deleteResponse = await jsonRequest(base, `/events/${deletedEvent._id}`, { user: admin, method: "DELETE" });
    assert.equal(deleteResponse.status, 200, JSON.stringify(deleteResponse.data));
    assert.equal(await Event.exists({ _id: deletedEvent._id }), null);
    assert.equal((await MediaAsset.findOne({ publicId: deleteAsset.publicId }).lean()).status, "deleted");
    assert.equal(fs.existsSync(deleteFile), false, "hard-deleting an Event retires its tracked logo asset");

    console.log("✓ Phase 6 Event logo checks passed (nullable field, RBAC, square validation, replace/remove lifecycle, public ID redaction, upload attachment ownership, and hard-delete cleanup)");
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    if (mongod) await mongod.stop();
    fs.rmSync(uploadsDir, { recursive: true, force: true });
  }
})();
