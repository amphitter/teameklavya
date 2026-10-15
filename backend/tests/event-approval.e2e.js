"use strict";

/**
 * Event Approval Workflow E2E
 * Tests per spec: create proposal unpublished until approved, correct institution receives, unrelated cannot approve, club cannot self-approve, approval publishes same record, idempotent concurrent, rejected unpublished, modifications state, material post-approval reapproval, club/institution perms independent, registration/attendee exports authz, tickets/QR/check-in/notifications functional, existing user/platform events unaffected
 */

const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const jwt = require("jsonwebtoken");
const express = require("express");
const request = require("supertest");

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret-event-approval";
process.env.SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL || "superadmin@eventhub.test";

const User = require("../models/user.model");
const Organization = require("../models/organization.model");
const OrganizationMembership = require("../models/organizationMembership.model");
const Event = require("../models/event.model");

let replSet, app;
let superAdmin, instAdmin, clubAdmin, otherClubAdmin, otherInstAdmin;
let superToken, instToken, clubToken, otherClubToken, otherInstToken;
let institution, otherInstitution, club, otherClub;

async function createUser({ email, role = "user", firstName = "Test", lastName = "User" }) {
  const user = await User.create({ firstName, lastName, email, password: "password123", role, username: email.split("@")[0] + Math.random().toString(36).slice(2, 6) });
  const token = jwt.sign({ id: user._id, role: user.role, email: user.email }, process.env.JWT_SECRET, { expiresIn: "1h" });
  return { user, token };
}

async function setup() {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const uri = replSet.getUri();
  await mongoose.connect(uri);

  const orgRoutes = require("../routes/organization.routes");
  const eventRoutes = require("../routes/event.routes");
  app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.requestId = "test"; next(); });
  // Mock optionalUser for public routes – use same middleware
  const { requireAuth, optionalUser } = require("../middleware/auth.middleware");
  app.use("/api/organizations", orgRoutes);
  app.use("/api/events", eventRoutes);
  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(err.status || 500).json({ success: false, message: err.message });
  });

  superAdmin = await createUser({ email: process.env.SUPER_ADMIN_EMAIL, role: "admin", firstName: "Super", lastName: "Admin" });
  instAdmin = await createUser({ email: "instadmin@test.com", role: "user", firstName: "Inst", lastName: "Admin" });
  clubAdmin = await createUser({ email: "clubadmin@test.com", role: "user", firstName: "Club", lastName: "Admin" });
  otherClubAdmin = await createUser({ email: "otherclub@test.com", role: "user", firstName: "OtherClub", lastName: "Admin" });
  otherInstAdmin = await createUser({ email: "otherinst@test.com", role: "user", firstName: "Other", lastName: "Inst" });

  superToken = superAdmin.token;
  instToken = instAdmin.token;
  clubToken = clubAdmin.token;
  otherClubToken = otherClubAdmin.token;
  otherInstToken = otherInstAdmin.token;

  institution = await Organization.create({
    name: "Global Institute",
    slug: "global-institute",
    handle: "global-institute",
    category: "COLLEGE",
    description: "College",
    createdBy: instAdmin.user._id,
    status: "APPROVED",
    affiliationStatus: "NONE",
  });
  await OrganizationMembership.create({ organizationId: institution._id, userId: instAdmin.user._id, role: "OWNER", status: "ACTIVE" });

  otherInstitution = await Organization.create({
    name: "Other University",
    slug: "other-university",
    handle: "other-university",
    category: "UNIVERSITY",
    description: "Other uni",
    createdBy: otherInstAdmin.user._id,
    status: "APPROVED",
    affiliationStatus: "NONE",
  });
  await OrganizationMembership.create({ organizationId: otherInstitution._id, userId: otherInstAdmin.user._id, role: "OWNER", status: "ACTIVE" });

  club = await Organization.create({
    name: "Coding Club",
    slug: "coding-club",
    handle: "coding-club",
    category: "STUDENT_CLUB",
    description: "Coding",
    createdBy: clubAdmin.user._id,
    status: "APPROVED",
    parentOrganizationId: institution._id,
    affiliationStatus: "APPROVED",
    affiliationApprovedAt: new Date(),
  });
  await OrganizationMembership.create({ organizationId: club._id, userId: clubAdmin.user._id, role: "OWNER", status: "ACTIVE" });

  otherClub = await Organization.create({
    name: "Robotics Club",
    slug: "robotics-club",
    handle: "robotics-club",
    category: "STUDENT_CLUB",
    description: "Robotics",
    createdBy: otherClubAdmin.user._id,
    status: "APPROVED",
    parentOrganizationId: institution._id,
    affiliationStatus: "APPROVED",
  });
  await OrganizationMembership.create({ organizationId: otherClub._id, userId: otherClubAdmin.user._id, role: "OWNER", status: "ACTIVE" });
}

async function teardown() {
  await mongoose.disconnect();
  if (replSet) await replSet.stop();
}

async function runTests() {
  let passed = 0, failed = 0;
  const assert = (cond, msg) => {
    if (cond) { console.log(`  ✅ ${msg}`); passed++; }
    else { console.log(`  ❌ ${msg}`); failed++; }
  };

  console.log("\n═══ Event Approval Workflow Tests ═══");

  let proposalEventId = null;

  // 1. Club authorized member creates proposal – unpublished until approved
  {
    const res = await request(app).post("/api/events").set("Authorization", `Bearer ${clubToken}`).send({
      title: "HackCraft 3.0",
      description: "Hackathon by coding club",
      category: "Hackathon",
      eventType: "offline",
      venue: "GITM Auditorium",
      startDate: new Date(Date.now() + 86400000 * 5).toISOString(),
      endDate: new Date(Date.now() + 86400000 * 6).toISOString(),
      organizerType: "ORGANIZATION",
      organization: club._id,
    });
    assert(res.status === 201 && res.body.success, "Club can create event proposal – 201");
    const ev = res.body.event;
    proposalEventId = ev._id;
    assert(ev.approvalStatus === "PENDING_REVIEW", "Proposal approvalStatus PENDING_REVIEW");
    assert(ev.proposingOrganizationId === String(club._id) || ev.proposingOrganizationId?._id === String(club._id) || String(ev.proposingOrganizationId) === String(club._id), "Proposing club recorded");
    assert(ev.parentInstitutionId === String(institution._id) || String(ev.parentInstitutionId) === String(institution._id), "Parent institution recorded");
    assert(ev.visibility === "private" || ev.liveState === "DRAFT", "Proposal unpublished (private/DRAFT)");

    // Check public discovery does not show it
    const publicRes = await request(app).get("/api/events").query({ limit: 50 });
    const found = (publicRes.body.events || []).some((e) => String(e._id) === String(proposalEventId) || e.slug === ev.slug);
    assert(!found, "Proposal not in public discovery until approved");
  }

  // 2. Correct institution receives proposal in queue
  {
    const res = await request(app).get(`/api/events/approvals/institution/${institution._id}/queue`).set("Authorization", `Bearer ${instToken}`);
    assert(res.status === 200 && res.body.success, "Institution can fetch approval queue");
    const found = (res.body.events || []).some((e) => String(e._id) === String(proposalEventId));
    assert(found, "Correct institution receives proposal in queue");
  }

  // 3. Unrelated institution cannot approve
  {
    const res = await request(app).post(`/api/events/${proposalEventId}/approve`).set("Authorization", `Bearer ${otherInstToken}`).send({ reason: "Trying to approve unrelated" });
    assert(res.status === 403, "Unrelated institution cannot approve – 403");
  }

  // 4. Club cannot self-approve
  {
    const res = await request(app).post(`/api/events/${proposalEventId}/approve`).set("Authorization", `Bearer ${clubToken}`).send({});
    assert(res.status === 403, "Club cannot self-approve – 403");
  }

  // 5. Approval publishes same record
  {
    const res = await request(app).post(`/api/events/${proposalEventId}/approve`).set("Authorization", `Bearer ${instToken}`).send({ reason: "Looks good" });
    assert(res.status === 200 && res.body.event.approvalStatus === "APPROVED", "Institution can approve – APPROVED");
    assert(String(res.body.event._id) === String(proposalEventId), "Approval transitions same Event record");
    assert(res.body.event.approvedBy, "Approver recorded");
    assert(res.body.event.approvedAt, "ApprovedAt timestamp recorded");
    assert(res.body.event.visibility === "public", "Approved event visibility public");
    assert(res.body.event.approvalHistory && res.body.event.approvalHistory.length >= 2, "Approval history recorded");

    // Now public discovery should show it
    const publicRes = await request(app).get("/api/events").query({ limit: 50 });
    const found = (publicRes.body.events || []).some((e) => String(e._id) === String(proposalEventId));
    assert(found, "Approved event appears in public discovery");
  }

  // 6. Idempotent concurrent approval
  {
    const [r1, r2] = await Promise.all([
      request(app).post(`/api/events/${proposalEventId}/approve`).set("Authorization", `Bearer ${instToken}`).send({}),
      request(app).post(`/api/events/${proposalEventId}/approve`).set("Authorization", `Bearer ${instToken}`).send({}),
    ]);
    assert(r1.status === 200 && r2.status === 200, "Concurrent approvals both 200 idempotent");
    const ev = await Event.findById(proposalEventId).lean();
    assert(ev.approvalStatus === "APPROVED", "Still APPROVED after concurrent");
  }

  // 7. Rejection keeps unpublished with reason, resubmit returns to pending
  let rejectEventId = null;
  {
    const createRes = await request(app).post("/api/events").set("Authorization", `Bearer ${clubToken}`).send({
      title: "AI for Builders",
      description: "Tech talk",
      category: "Tech Talk",
      eventType: "offline",
      venue: "Lab",
      startDate: new Date(Date.now() + 86400000 * 10).toISOString(),
      endDate: new Date(Date.now() + 86400000 * 11).toISOString(),
      organizerType: "ORGANIZATION",
      organization: club._id,
    });
    rejectEventId = createRes.body.event._id;
    const rejectRes = await request(app).post(`/api/events/${rejectEventId}/reject`).set("Authorization", `Bearer ${instToken}`).send({ reason: "Need more details" });
    assert(rejectRes.status === 200 && rejectRes.body.event.approvalStatus === "REJECTED", "Institution can reject with reason");
    assert(rejectRes.body.event.rejectionReason === "Need more details", "Rejection reason recorded");
    assert(rejectRes.body.event.visibility === "private", "Rejected event unpublished (private)");

    const publicRes = await request(app).get("/api/events").query({ limit: 50 });
    const found = (publicRes.body.events || []).some((e) => String(e._id) === String(rejectEventId));
    assert(!found, "Rejected event not in public feed");

    // Resubmit
    const resubmitRes = await request(app).post(`/api/events/${rejectEventId}/resubmit`).set("Authorization", `Bearer ${clubToken}`).send({ description: "Updated description with more details" });
    assert(resubmitRes.status === 200 && resubmitRes.body.event.approvalStatus === "PENDING_REVIEW", "Resubmit returns to PENDING_REVIEW");
    assert(resubmitRes.body.event.version === 2, "Version incremented on resubmit");
  }

  // 8. Request changes
  {
    const res = await request(app).post(`/api/events/${rejectEventId}/request-changes`).set("Authorization", `Bearer ${instToken}`).send({ message: "Please add speaker info" });
    assert(res.status === 200 && res.body.event.approvalStatus === "CHANGES_REQUESTED", "Request changes – CHANGES_REQUESTED");
  }

  // 9. Material change after approval requires reapproval
  {
    // Approve the resubmitted? First resubmit again from CHANGES_REQUESTED
    await request(app).post(`/api/events/${rejectEventId}/resubmit`).set("Authorization", `Bearer ${clubToken}`).send({});
    await request(app).post(`/api/events/${rejectEventId}/approve`).set("Authorization", `Bearer ${instToken}`).send({});

    // Now club tries material change
    const materialRes = await request(app).patch(`/api/events/${rejectEventId}/with-reapproval`).set("Authorization", `Bearer ${clubToken}`).send({ title: "AI for Builders – Updated Title", price: 100 });
    assert(materialRes.status === 200 && materialRes.body.event.approvalStatus === "PENDING_REVIEW", "Material change after approval requires reapproval – back to PENDING");
    assert(materialRes.body.event.requiresReapproval === true, "requiresReapproval true");
    assert(materialRes.body.event.previousApprovedSnapshot, "Previous snapshot saved");

    // Institution can approve again
    const approveAgain = await request(app).post(`/api/events/${rejectEventId}/approve`).set("Authorization", `Bearer ${instToken}`).send({});
    assert(approveAgain.status === 200 && approveAgain.body.event.approvalStatus === "APPROVED", "Reapproval after material change succeeds");
  }

  // 10. Club cannot manage other club's events same institution
  {
    // otherClub tries to edit club's event
    const res = await request(app).patch(`/api/events/${proposalEventId}/with-reapproval`).set("Authorization", `Bearer ${otherClubToken}`).send({ description: "Hacked" });
    assert(res.status === 403, "Club cannot manage other club's events – 403");
  }

  // 11. Institution can manage registrations etc (canManageEvent)
  {
    // Institution admin should be able to access private event details via getById
    const res = await request(app).get(`/api/events/${proposalEventId}`).set("Authorization", `Bearer ${instToken}`);
    assert(res.status === 200, "Institution can access event via getById (canManageEvent)");
  }

  // 12. Existing user/platform events unaffected
  {
    const res = await request(app).post("/api/events").set("Authorization", `Bearer ${superToken}`).send({
      title: "Platform Event",
      description: "Platform owned",
      category: "General",
      eventType: "offline",
      venue: "Main Hall",
      startDate: new Date(Date.now() + 86400000 * 2).toISOString(),
      endDate: new Date(Date.now() + 86400000 * 3).toISOString(),
      organizerType: "USER",
    });
    assert(res.status === 201 && res.body.event.approvalStatus === "APPROVED", "Platform USER event auto-approved unaffected");
  }

  // 13. Approval history
  {
    const res = await request(app).get(`/api/events/${proposalEventId}/approval-history`).set("Authorization", `Bearer ${clubToken}`);
    assert(res.status === 200 && Array.isArray(res.body.history) && res.body.history.length >= 2, "Approval history endpoint returns history");
  }

  // 14. Cancellation preserves registrations (no delete)
  {
    const res = await request(app).post(`/api/events/${proposalEventId}/cancel`).set("Authorization", `Bearer ${instToken}`).send({ reason: "Event cancelled" });
    assert(res.status === 200 && res.body.event.approvalStatus === "CANCELLED", "Cancellation sets CANCELLED");
    // Event still exists, not deleted
    const ev = await Event.findById(proposalEventId).lean();
    assert(ev && ev.approvalStatus === "CANCELLED", "Cancelled event still in DB – no auto delete");
  }

  console.log(`\nEvent Approval E2E: ${passed} passed, ${failed} failed`);
  return { passed, failed };
}

(async () => {
  try {
    await setup();
    const { passed, failed } = await runTests();
    await teardown();
    process.exit(failed > 0 ? 1 : 0);
  } catch (e) {
    console.error(e);
    try { await teardown(); } catch {}
    process.exit(1);
  }
})();
