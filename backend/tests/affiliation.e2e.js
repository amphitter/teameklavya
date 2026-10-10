"use strict";

/**
 * Affiliation Lifecycle E2E
 * Tests institution vs club, parent validation, affiliation pending/approved/suspended/revoked, transfer audited, cross-institution prevention, public profile shows affiliation state.
 */

const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const jwt = require("jsonwebtoken");
const express = require("express");
const request = require("supertest");

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret-affiliation";
process.env.SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL || "superadmin@eventhub.test";

const User = require("../models/user.model");
const Organization = require("../models/organization.model");
const OrganizationMembership = require("../models/organizationMembership.model");

let replSet, app, server;
let superAdmin, instAdmin, clubAdmin, otherInstAdmin;
let superToken, instToken, clubToken, otherInstToken;
let institution, otherInstitution, club;

async function createUser({ email, role = "user", firstName = "Test", lastName = "User" }) {
  const user = await User.create({ firstName, lastName, email, password: "password123", role, username: email.split("@")[0] + Math.random().toString(36).slice(2, 6) });
  const token = jwt.sign({ id: user._id, role: user.role, email: user.email }, process.env.JWT_SECRET, { expiresIn: "1h" });
  return { user, token };
}

async function setup() {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const uri = replSet.getUri();
  await mongoose.connect(uri);

  // Minimal app with org routes
  const orgRoutes = require("../routes/organization.routes");
  const authMiddleware = require("../middleware/auth.middleware");
  app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.requestId = "test"; next(); });
  app.use("/api/organizations", orgRoutes);
  // error handler
  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(err.status || 500).json({ success: false, message: err.message });
  });

  superAdmin = await createUser({ email: process.env.SUPER_ADMIN_EMAIL, role: "admin", firstName: "Super", lastName: "Admin" });
  instAdmin = await createUser({ email: "instadmin@test.com", role: "user", firstName: "Inst", lastName: "Admin" });
  clubAdmin = await createUser({ email: "clubadmin@test.com", role: "user", firstName: "Club", lastName: "Admin" });
  otherInstAdmin = await createUser({ email: "otherinst@test.com", role: "user", firstName: "Other", lastName: "Inst" });

  superToken = superAdmin.token;
  instToken = instAdmin.token;
  clubToken = clubAdmin.token;
  otherInstToken = otherInstAdmin.token;

  // Create institutions
  institution = await Organization.create({
    name: "Global Institute of Technology",
    slug: "global-institute-tech",
    handle: "global-institute-tech",
    category: "COLLEGE",
    description: "A college",
    createdBy: instAdmin.user._id,
    status: "APPROVED",
    affiliationStatus: "NONE",
    managers: [instAdmin.user._id],
  });
  await OrganizationMembership.create({ organizationId: institution._id, userId: instAdmin.user._id, role: "OWNER", status: "ACTIVE" });

  otherInstitution = await Organization.create({
    name: "Other University",
    slug: "other-university",
    handle: "other-university",
    category: "UNIVERSITY",
    description: "Another uni",
    createdBy: otherInstAdmin.user._id,
    status: "APPROVED",
    affiliationStatus: "NONE",
    managers: [otherInstAdmin.user._id],
  });
  await OrganizationMembership.create({ organizationId: otherInstitution._id, userId: otherInstAdmin.user._id, role: "OWNER", status: "ACTIVE" });

  // Create club without parent initially
  club = await Organization.create({
    name: "Coding Club",
    slug: "coding-club",
    handle: "coding-club",
    category: "STUDENT_CLUB",
    description: "Coding club",
    createdBy: clubAdmin.user._id,
    status: "APPROVED",
    affiliationStatus: "NONE",
    managers: [clubAdmin.user._id],
  });
  await OrganizationMembership.create({ organizationId: club._id, userId: clubAdmin.user._id, role: "OWNER", status: "ACTIVE" });
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

  console.log("\n═══ Affiliation Lifecycle Tests ═══");

  // 1. Club requests affiliation to institution
  {
    const res = await request(app).post(`/api/organizations/${club._id}/affiliation/request`).set("Authorization", `Bearer ${clubToken}`).send({ parentOrganizationId: institution._id, reason: "We are part of GITM" });
    assert(res.status === 200 && res.body.success && res.body.organization.affiliationStatus === "PENDING", "Club can request affiliation – status PENDING");
    const fresh = await Organization.findById(club._id).lean();
    assert(fresh.parentOrganizationId && String(fresh.parentOrganizationId) === String(institution._id), "ParentOrganizationId set after request");
    assert(fresh.affiliationHistory && fresh.affiliationHistory.length >= 1, "Affiliation history recorded");
  }

  // 2. Institution approves affiliation
  {
    const res = await request(app).post(`/api/organizations/${club._id}/affiliation/approve`).set("Authorization", `Bearer ${instToken}`).send({ reason: "Verified" });
    assert(res.status === 200 && res.body.organization.affiliationStatus === "APPROVED", "Institution can approve affiliation – APPROVED");
    const fresh = await Organization.findById(club._id).lean();
    assert(fresh.affiliationApprovedBy && String(fresh.affiliationApprovedBy) === String(instAdmin.user._id), "ApprovedBy recorded");
  }

  // 3. Idempotent approve
  {
    const res = await request(app).post(`/api/organizations/${club._id}/affiliation/approve`).set("Authorization", `Bearer ${instToken}`).send({});
    assert(res.status === 200 && res.body.organization.affiliationStatus === "APPROVED", "Approve idempotent – still APPROVED");
  }

  // 4. Other institution cannot approve (cross-institution prevention)
  {
    const res = await request(app).post(`/api/organizations/${club._id}/affiliation/approve`).set("Authorization", `Bearer ${otherInstToken}`).send({});
    // Should fail because otherInst is not manager of current parent institution (GITM)
    // But if club is already APPROVED, it returns idempotent earlier? We need to test with pending club
    // Create another club pending to other institution
    const club2 = await Organization.create({
      name: "Robotics Club",
      slug: "robotics-club",
      handle: "robotics-club",
      category: "STUDENT_CLUB",
      description: "Robotics",
      createdBy: clubAdmin.user._id,
      status: "APPROVED",
      affiliationStatus: "NONE",
    });
    await OrganizationMembership.create({ organizationId: club2._id, userId: clubAdmin.user._id, role: "OWNER", status: "ACTIVE" });
    await request(app).post(`/api/organizations/${club2._id}/affiliation/request`).set("Authorization", `Bearer ${clubToken}`).send({ parentOrganizationId: institution._id });
    const res2 = await request(app).post(`/api/organizations/${club2._id}/affiliation/approve`).set("Authorization", `Bearer ${otherInstToken}`).send({});
    assert(res2.status === 403, "Other institution cannot approve – 403 cross-institution prevention");
    await Organization.deleteOne({ _id: club2._id });
    await OrganizationMembership.deleteMany({ organizationId: club2._id });
  }

  // 5. Club cannot self-approve – club admin trying to approve own affiliation should fail
  {
    // Create pending club
    const club3 = await Organization.create({
      name: "Drama Club",
      slug: "drama-club",
      handle: "drama-club",
      category: "CULTURAL_CLUB",
      description: "Drama",
      createdBy: clubAdmin.user._id,
      status: "APPROVED",
      affiliationStatus: "NONE",
    });
    await OrganizationMembership.create({ organizationId: club3._id, userId: clubAdmin.user._id, role: "OWNER", status: "ACTIVE" });
    await request(app).post(`/api/organizations/${club3._id}/affiliation/request`).set("Authorization", `Bearer ${clubToken}`).send({ parentOrganizationId: institution._id });
    const res = await request(app).post(`/api/organizations/${club3._id}/affiliation/approve`).set("Authorization", `Bearer ${clubToken}`).send({});
    assert(res.status === 403, "Club cannot self-approve affiliation – 403");
    await Organization.deleteOne({ _id: club3._id });
    await OrganizationMembership.deleteMany({ organizationId: club3._id });
  }

  // 6. Transfer workflow audited
  {
    const res = await request(app).post(`/api/organizations/${club._id}/affiliation/transfer`).set("Authorization", `Bearer ${clubToken}`).send({ newParentOrganizationId: otherInstitution._id, reason: "Moving to other uni" });
    assert(res.status === 200 && res.body.organization.affiliationStatus === "PENDING" && String(res.body.organization.parentOrganizationId) === String(otherInstitution._id), "Transfer sets PENDING to new parent");
    const fresh = await Organization.findById(club._id).lean();
    const hasTransfer = fresh.affiliationHistory.some((h) => h.action === "TRANSFERRED");
    assert(hasTransfer, "Transfer audited in history");
    // Other institution now approves
    const res2 = await request(app).post(`/api/organizations/${club._id}/affiliation/approve`).set("Authorization", `Bearer ${otherInstToken}`).send({});
    assert(res2.status === 200 && res2.body.organization.affiliationStatus === "APPROVED", "New parent can approve after transfer");
  }

  // 7. Suspend and revoke
  {
    const res = await request(app).post(`/api/organizations/${club._id}/affiliation/suspend`).set("Authorization", `Bearer ${otherInstToken}`).send({ reason: "Policy violation" });
    assert(res.status === 200 && res.body.organization.affiliationStatus === "SUSPENDED", "Institution can suspend affiliation");
    const res2 = await request(app).post(`/api/organizations/${club._id}/affiliation/revoke`).set("Authorization", `Bearer ${superToken}`).send({ reason: "Revoked by super admin" });
    assert(res2.status === 200 && res2.body.organization.affiliationStatus === "REVOKED", "Super Admin can revoke affiliation");
  }

  // 8. Public profile shows affiliation state
  {
    const res = await request(app).get(`/api/organizations/${club.slug}`).set("Authorization", `Bearer ${clubToken}`);
    assert(res.status === 200 && res.body.organization.affiliationStatus === "REVOKED", "Public profile shows affiliation state REVOKED");
  }

  // 9. Institution category cannot have parent (validation)
  {
    const res = await request(app).post(`/api/organizations/${institution._id}/affiliation/request`).set("Authorization", `Bearer ${instToken}`).send({ parentOrganizationId: otherInstitution._id });
    assert(res.status === 400, "Institution category cannot request parent – 400");
  }

  // 10. Affiliation history endpoint
  {
    const res = await request(app).get(`/api/organizations/${club._id}/affiliation/history`).set("Authorization", `Bearer ${clubToken}`);
    assert(res.status === 200 && Array.isArray(res.body.history) && res.body.history.length >= 3, "Affiliation history endpoint returns history");
  }

  console.log(`\nAffiliation E2E: ${passed} passed, ${failed} failed`);
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
