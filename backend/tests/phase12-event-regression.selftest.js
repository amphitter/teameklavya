#!/usr/bin/env node
"use strict";

/**
 * Roadmap Phase 12 — Event model and public projection contract checks.
 * Distinct from the legacy Part 7 `tests/phase12.selftest.js`.
 * This suite needs no database or external provider.
 */
process.env.NODE_ENV = "test";
process.env.REDIS_ENABLED = "false";
process.env.CACHE_PROVIDER = "memory";

const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const Event = require("../models/event.model");
const { EventRepository } = require("../repositories/event.repository");

let checks = 0;
function check(name, condition) {
  assert.ok(condition, name);
  checks += 1;
  console.log(`  ✅ ${name}`);
}

async function shouldReject(name, fn) {
  let rejected = false;
  try { await fn(); } catch { rejected = true; }
  check(name, rejected);
}

function eventFixture({ title = "Regression Event", startDate, endDate, ...extra } = {}) {
  const now = Date.now();
  return new Event({
    title,
    description: "Phase 12 Event model regression fixture",
    eventType: "offline",
    venue: "Delhi",
    startDate: startDate || new Date(now + 24 * 60 * 60 * 1000),
    endDate: endDate || new Date(now + 26 * 60 * 60 * 1000),
    ...extra,
  });
}

(async () => {
  console.log("\n═══ Event schema compatibility and defaults ═══");

  const ownerId = new mongoose.Types.ObjectId();
  const organizationId = new mongoose.Types.ObjectId();
  const communityId = new mongoose.Types.ObjectId();
  const future = eventFixture({
    title: "Regression: Future Event",
    createdBy: ownerId,
    organizerType: "USER",
    organizerId: ownerId,
    organization: organizationId,
    community: communityId,
    platform: "zoom",
    meetingId: "legacy-meeting-id",
    passcode: "legacy-passcode",
  });
  await future.validate();
  check("title-derived slug stays compatible", future.slug === "regression-future-event");
  check("new Events default to public visibility", future.visibility === "public");
  check("legacy live-state default remains PUBLISHED", future.liveState === "PUBLISHED");
  check("optional Event logo defaults to null", future.logoUrl === null && future.logoPublicId === null);
  check("archive metadata defaults to null", future.archivedAt === null && future.archivedBy === null);
  check("join code is a generated six-character display code", /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/.test(future.joinCode));
  check("live settings keep their legacy defaults", future.liveSettings.allowLateJoin === true && future.liveSettings.chatEnabled === true);
  check("USER ownership and organization/community associations coexist", future.organizerType === "USER" && String(future.organizerId) === String(ownerId) && String(future.organization) === String(organizationId) && String(future.community) === String(communityId));
  check("offline validation clears online meeting credentials", future.platform === null && future.meetingId === null && future.passcode === null);

  const legacy = eventFixture({ createdBy: ownerId, organization: organizationId, community: communityId });
  await legacy.validate();
  check("legacy creator-owned Events may omit explicit owner fields", legacy.organizerType === undefined && legacy.organizerId === null);
  check("legacy organization/community associations are not rewritten by validation", String(legacy.organization) === String(organizationId) && String(legacy.community) === String(communityId));

  const online = eventFixture({
    eventType: "online",
    venue: undefined,
    onlineEventLink: "https://events.example.test/room",
    platform: "zoom",
  });
  await online.validate();
  check("online Event with a valid online link remains valid without a physical venue", online.eventType === "online" && online.onlineEventLink.startsWith("https://"));

  await shouldReject("online Event without an online link fails schema validation", () => eventFixture({ eventType: "online", venue: undefined }).validate());
  await shouldReject("offline Event without a required venue fails schema validation", () => eventFixture({ venue: undefined }).validate());
  await shouldReject("unsupported Event visibility fails schema validation", () => eventFixture({ visibility: "secret" }).validate());
  await shouldReject("unsupported explicit owner type fails schema validation", () => eventFixture({ organizerType: "COMMUNITY" }).validate());

  console.log("\n═══ Date virtuals, join-code method, and index invariants ═══");
  const now = Date.now();
  const ongoing = eventFixture({ startDate: new Date(now - 60 * 60 * 1000), endDate: new Date(now + 60 * 60 * 1000) });
  const past = eventFixture({ startDate: new Date(now - 2 * 24 * 60 * 60 * 1000), endDate: new Date(now - 24 * 60 * 60 * 1000) });
  await Promise.all([ongoing.validate(), past.validate()]);
  check("calendar status is ongoing while dates span the current time", ongoing.status === "ongoing" && ongoing.isLive === true);
  check("calendar status is past after endDate regardless of live-state", past.status === "past" && past.liveState === "PUBLISHED" && past.isLive === false);
  check("future calendar status stays separate from operational liveState", future.status === "upcoming" && future.liveState === "PUBLISHED");
  const regenerated = future.regenerateJoinCode();
  check("join-code regeneration preserves its public display-code format", regenerated === future.joinCode && /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/.test(regenerated));

  const schemaIndexes = Event.schema.indexes();
  const slugIndexes = schemaIndexes.filter(([keys]) => keys.slug === 1);
  const joinCodeIndexes = schemaIndexes.filter(([keys]) => keys.joinCode === 1);
  check("slug retains exactly one unique schema index", slugIndexes.length === 1 && slugIndexes[0][1].unique === true);
  check("joinCode retains exactly one unique schema index", joinCodeIndexes.length === 1 && joinCodeIndexes[0][1].unique === true);

  console.log("\n═══ Public Event projection preserves the UI contract and redacts secrets ═══");
  const rawPublic = {
    _id: new mongoose.Types.ObjectId(),
    title: "Public projection fixture",
    slug: "public-projection-fixture",
    description: "Public metadata",
    visibility: "public",
    joinCode: "ABC234",
    logoUrl: null,
    organization: { name: "Associated Org", slug: "associated-org" },
    community: { name: "Associated Community", slug: "associated-community" },
    meetingId: "do-not-expose-meeting-id",
    passcode: "do-not-expose-passcode",
    checkIns: [{ userId: ownerId }],
    bannerPublicId: "provider/banner-id",
    logoPublicId: "provider/logo-id",
    createdBy: ownerId,
    ticketSettings: { autoGenerate: true },
    whatsappGroup: "https://chat.example.test/private",
    organizerType: "USER",
    organizerId: ownerId,
    archivedAt: null,
    archivedBy: null,
  };
  const publicProjection = EventRepository.toPublicEvent(rawPublic);
  check("public slug, title, optional logo, and host associations are preserved", publicProjection.slug === rawPublic.slug && publicProjection.title === rawPublic.title && publicProjection.logoUrl === null && publicProjection.organization.name === "Associated Org" && publicProjection.community.name === "Associated Community");
  check("public short join code remains available for the read-only projector", publicProjection.joinCode === rawPublic.joinCode);
  check("public projection strips meeting credentials, attendee check-ins, provider IDs, provenance, owner, archive, ticket, and WhatsApp fields", ["meetingId", "passcode", "checkIns", "bannerPublicId", "logoPublicId", "createdBy", "organizerType", "organizerId", "archivedAt", "archivedBy", "ticketSettings", "whatsappGroup"].every((field) => !Object.hasOwn(publicProjection, field)));

  const legacyProjection = EventRepository.toPublicEvent({ title: "Legacy", slug: "legacy", visibility: "public" });
  check("legacy Event projections synthesize a null logo without a backfill", Object.hasOwn(legacyProjection, "logoUrl") && legacyProjection.logoUrl === null);

  const privateProjection = EventRepository.toPublicEvent({
    ...rawPublic,
    visibility: "private",
    onlineEventLink: "https://events.example.test/private-room",
    recordingLink: "https://events.example.test/private-recording",
    materials: [{ title: "Private slides", url: "https://events.example.test/private-slides" }],
  });
  check("private Event projection additionally strips online link, recording, and materials", ["onlineEventLink", "recordingLink", "materials"].every((field) => !Object.hasOwn(privateProjection, field)));

  console.log(`\nRoadmap Phase 12 Event model self-test: ${checks}/${checks} checks passed.`);
})().catch((error) => {
  console.error("Roadmap Phase 12 Event model self-test failed:", error);
  process.exitCode = 1;
});
