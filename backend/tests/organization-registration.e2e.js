"use strict";

/**
 * Organization Registration Requests E2E
 * Covers applicant, super admin, approval atomicity, duplicate, IDOR, state machine
 * Uses MongoMemoryServer + stubbed email
 */
process.env.NODE_ENV = "test";
process.env.PORT = "5088";
process.env.FRONTEND_URL = "http://localhost:3100";
process.env.JWT_SECRET = "org-registration-example-secret-placeholder";
process.env.GOOGLE_CLIENT_ID = "example-client";
process.env.GOOGLE_CLIENT_SECRET = "example-client-secret-placeholder";
process.env.GOOGLE_CALLBACK_URL = "http://localhost/callback";
process.env.REDIS_ENABLED = "false";
process.env.RATE_LIMIT_DISABLED = "1";

const assert = require("node:assert/strict");
const express = require("express");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

const User = require("../models/user.model");
const Organization = require("../models/organization.model");
const OrganizationMembership = require("../models/organizationMembership.model");
const { OrganizationRegistrationRequest } = require("../models/organizationRegistrationRequest.model");
const orgRegistrationRoutes = require("../routes/organization-registration.routes");
const orgRoutes = require("../routes/organization.routes");
const emailService = require("../services/email.service");

function tokenFor(user) {
  return jwt.sign(
    { id: String(user._id), role: user.role || "user", email: user.email, purpose: "auth" },
    process.env.JWT_SECRET,
    { expiresIn: "1h" }
  );
}

async function request(base, path, { user, method = "GET", body, headers = {} } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(user ? { Authorization: `Bearer ${tokenFor(user)}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try {
    data = await res.json();
  } catch {}
  return { status: res.status, data };
}

async function makeUser(email, role = "user") {
  const name = email.split("@")[0];
  return User.create({
    firstName: name,
    lastName: "Tester",
    username: name.toLowerCase().replace(/[^a-z0-9_]/g, "") + Math.random().toString(36).slice(2, 6),
    email,
    role,
    passwordHash: "test-hash",
    emailVerified: true,
  });
}

(async () => {
  let mongod, server;
  const originalEmailSend = emailService.send;
  emailService.send = async () => ({ messageId: "test" });

  try {
    mongod = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
    await mongoose.connect(mongod.getUri());
    await Promise.all([User.init(), Organization.init(), OrganizationMembership.init(), OrganizationRegistrationRequest.init()]);

    const app = express();
    app.use(express.json());
    app.use("/api/organization-registration-requests", orgRegistrationRoutes);
    app.use("/api/organizations", orgRoutes);
    await new Promise((resolve, reject) => {
      server = app.listen(0, "127.0.0.1", resolve);
      server.once("error", reject);
    });
    const base = `http://127.0.0.1:${server.address().port}/api`;

    const superAdmin = await makeUser("devanshsinghr00@gmail.com", "admin");
    const applicant = await makeUser("applicant@college.test");
    const otherUser = await makeUser("other@college.test");
    const normalUser = await makeUser("normal@user.test");

    console.log("\n═══ Applicant tests ═══");

    // Unauthenticated cannot submit
    let r = await request(base, "/organization-registration-requests", {
      method: "POST",
      body: { category: "COLLEGE", proposedName: "Test College", declarationAccepted: true },
    });
    assert.equal(r.status, 401, "unauthenticated cannot submit");

    // Missing fields rejected
    r = await request(base, "/organization-registration-requests", {
      user: applicant,
      method: "POST",
      body: { category: "COLLEGE", declarationAccepted: true },
    });
    assert.equal(r.status, 400, "missing proposedName rejected");

    // Invalid category rejected
    r = await request(base, "/organization-registration-requests", {
      user: applicant,
      method: "POST",
      body: { category: "INVALID", proposedName: "Test", declarationAccepted: true },
    });
    assert.equal(r.status, 400, "invalid category rejected");

    // Declaration must be accepted
    r = await request(base, "/organization-registration-requests", {
      user: applicant,
      method: "POST",
      body: { category: "COLLEGE", proposedName: "Test College", declarationAccepted: false },
    });
    assert.equal(r.status, 400, "declaration must be accepted");

    // Applicant identity from auth, not body
    r = await request(base, "/organization-registration-requests", {
      user: applicant,
      method: "POST",
      body: {
        category: "COLLEGE",
        proposedName: "Delhi Institute of Technology",
        description: "A premier institute",
        website: "https://dit.example.test",
        email: "contact@dit.example.test",
        city: "Delhi",
        country: "India",
        applicant: otherUser._id, // attempt to spoof
        declarationAccepted: true,
      },
    });
    assert.equal(r.status, 201, "valid college request created");
    const collegeRequestId = r.data.request._id;
    assert.equal(String(r.data.request.applicant), String(applicant._id), "applicant identity from auth, not body");
    assert.equal(r.data.request.status, "PENDING_REVIEW");

    // Duplicate prevention - same applicant same name pending
    r = await request(base, "/organization-registration-requests", {
      user: applicant,
      method: "POST",
      body: {
        category: "COLLEGE",
        proposedName: "Delhi Institute of Technology",
        description: "Duplicate",
        declarationAccepted: true,
      },
    });
    assert.equal(r.status, 409, "duplicate same applicant same name prevented");

    // Different applicant can request same name (allowed, reviewer judgment)
    r = await request(base, "/organization-registration-requests", {
      user: otherUser,
      method: "POST",
      body: {
        category: "COLLEGE",
        proposedName: "Delhi Institute of Technology",
        description: "Different applicant same name - allowed",
        declarationAccepted: true,
      },
    });
    assert.equal(r.status, 201, "different applicant same name allowed");

    // University request
    r = await request(base, "/organization-registration-requests", {
      user: applicant,
      method: "POST",
      body: {
        category: "UNIVERSITY",
        proposedName: "Global University",
        description: "A global university",
        city: "Mumbai",
        declarationAccepted: true,
      },
    });
    assert.equal(r.status, 201, "university request created");
    const universityRequestId = r.data.request._id;

    // Affiliated club without parent should fail
    r = await request(base, "/organization-registration-requests", {
      user: applicant,
      method: "POST",
      body: {
        category: "AFFILIATED_CLUB",
        proposedName: "Tech Club",
        description: "Tech club",
        declarationAccepted: true,
      },
    });
    assert.equal(r.status, 400, "affiliated club without parent rejected");

    // Create a parent org for club testing - need approved org
    const parentOrg = await Organization.create({
      name: "Approved College",
      slug: "approved-college",
      handle: "approved-college",
      category: "COLLEGE",
      description: "Parent",
      createdBy: superAdmin._id,
      status: "APPROVED",
      verificationStatus: "UNVERIFIED",
    });
    await OrganizationMembership.create({
      organizationId: parentOrg._id,
      userId: superAdmin._id,
      role: "OWNER",
      status: "ACTIVE",
    });

    // Affiliated club with existing parent
    r = await request(base, "/organization-registration-requests", {
      user: applicant,
      method: "POST",
      body: {
        category: "AFFILIATED_CLUB",
        proposedName: "Approved College Tech Club",
        description: "Official tech club",
        parentOrganizationId: parentOrg._id,
        declarationAccepted: true,
      },
    });
    assert.equal(r.status, 201, "affiliated club with existing parent created");
    const clubRequestId = r.data.request._id;

    // Affiliated club with proposed parent (new institution)
    r = await request(base, "/organization-registration-requests", {
      user: otherUser,
      method: "POST",
      body: {
        category: "AFFILIATED_CLUB",
        proposedName: "New College Dance Club",
        description: "Dance club",
        proposedParent: {
          name: "New College of Arts",
          website: "https://newcollege.example.test",
          city: "Delhi",
          description: "New college",
        },
        declarationAccepted: true,
      },
    });
    assert.equal(r.status, 201, "affiliated club with proposed parent created");
    const clubWithProposedParentId = r.data.request._id;

    // Applicant can see own requests
    r = await request(base, "/organization-registration-requests/mine", { user: applicant });
    assert.equal(r.status, 200, "applicant can list own requests");
    assert.ok(r.data.requests.length >= 3, "applicant has at least 3 requests");
    assert.ok(r.data.requests.every((req) => String(req.applicant) === String(applicant._id)), "only own requests");

    // IDOR: other user cannot see applicant's request
    r = await request(base, `/organization-registration-requests/${collegeRequestId}`, { user: otherUser });
    assert.equal(r.status, 403, "IDOR prevented - other user cannot view");

    // Applicant can view own request detail
    r = await request(base, `/organization-registration-requests/${collegeRequestId}`, { user: applicant });
    assert.equal(r.status, 200, "applicant can view own request");
    assert.equal(String(r.data.request._id), String(collegeRequestId));

    // Applicant cannot modify reviewer fields
    r = await request(base, `/organization-registration-requests/${collegeRequestId}`, {
      user: applicant,
      method: "PATCH",
      body: { status: "APPROVED", reviewer: superAdmin._id },
    });
    // Should fail because status is PENDING_REVIEW, not DRAFT/NEEDS_INFO, or forbidden fields ignored
    assert.equal(r.status, 400, "cannot directly change status to APPROVED");

    // Create draft and test draft flow
    r = await request(base, "/organization-registration-requests", {
      user: applicant,
      method: "POST",
      body: {
        category: "COLLEGE",
        proposedName: "Draft College",
        description: "Draft",
        status: "DRAFT",
        draft: true,
        declarationAccepted: true,
      },
    });
    assert.equal(r.status, 201, "draft created");
    const draftId = r.data.request._id;
    assert.equal(r.data.request.status, "DRAFT");

    // Edit draft
    r = await request(base, `/organization-registration-requests/${draftId}`, {
      user: applicant,
      method: "PATCH",
      body: { description: "Updated draft description" },
    });
    assert.equal(r.status, 200, "draft edited");
    assert.equal(r.data.request.description, "Updated draft description");

    // Submit draft
    r = await request(base, `/organization-registration-requests/${draftId}/submit`, {
      user: applicant,
      method: "POST",
    });
    assert.equal(r.status, 200, "draft submitted");
    assert.equal(r.data.request.status, "PENDING_REVIEW");

    // Withdraw pending
    r = await request(base, `/organization-registration-requests/${draftId}/withdraw`, {
      user: applicant,
      method: "POST",
    });
    assert.equal(r.status, 200, "pending withdrawn");
    assert.equal(r.data.request.status, "WITHDRAWN");

    console.log("  ✅ Applicant tests passed");

    console.log("\n═══ Super Admin tests ═══");

    // Ordinary user cannot list all requests
    r = await request(base, "/organization-registration-requests/admin/list", { user: normalUser });
    assert.equal(r.status, 403, "ordinary user cannot list all");

    // Ordinary user cannot approve
    r = await request(base, `/organization-registration-requests/admin/${collegeRequestId}/approve`, {
      user: normalUser,
      method: "POST",
    });
    assert.equal(r.status, 403, "ordinary user cannot approve");

    // Super Admin can list
    r = await request(base, "/organization-registration-requests/admin/list", { user: superAdmin });
    assert.equal(r.status, 200, "super admin can list");
    assert.ok(r.data.requests.length >= 5, "super admin sees all requests");
    assert.ok(r.data.counts, "counts provided");

    // Super Admin can view detail
    r = await request(base, `/organization-registration-requests/admin/${collegeRequestId}`, { user: superAdmin });
    assert.equal(r.status, 200, "super admin can view detail");
    assert.ok(r.data.request.proposedName, "has proposedName");
    assert.ok(Array.isArray(r.data.potentialDuplicates), "has potentialDuplicates");

    // Invalid state transition rejected
    r = await request(base, `/organization-registration-requests/admin/${draftId}/approve`, {
      user: superAdmin,
      method: "POST",
    });
    assert.equal(r.status, 400, "cannot approve withdrawn request");

    // Request more info
    r = await request(base, `/organization-registration-requests/admin/${collegeRequestId}/request-info`, {
      user: superAdmin,
      method: "POST",
      body: { message: "Please provide authorization letter" },
    });
    assert.equal(r.status, 200, "request info success");
    assert.equal(r.data.request.status, "NEEDS_INFORMATION");
    assert.equal(r.data.request.infoRequestMessage, "Please provide authorization letter");

    // Applicant can resubmit after needs_info
    r = await request(base, `/organization-registration-requests/${collegeRequestId}/resubmit`, {
      user: applicant,
      method: "POST",
      body: { evidence: { authorizationLetterUrl: "https://example.test/letter.pdf" } },
    });
    assert.equal(r.status, 200, "resubmit after needs_info");
    assert.equal(r.data.request.status, "PENDING_REVIEW");
    assert.equal(r.data.request.resubmissionCount, 1);

    // Rejection requires reason
    r = await request(base, `/organization-registration-requests/admin/${universityRequestId}/reject`, {
      user: superAdmin,
      method: "POST",
      body: { reason: "" },
    });
    assert.equal(r.status, 400, "rejection requires reason");

    r = await request(base, `/organization-registration-requests/admin/${universityRequestId}/reject`, {
      user: superAdmin,
      method: "POST",
      body: { reason: "Insufficient evidence, please provide more documents" },
    });
    assert.equal(r.status, 200, "reject with reason");
    assert.equal(r.data.request.status, "REJECTED");

    // Rejected does not create org
    const rejectedOrg = await Organization.findOne({ name: "Global University" });
    assert.equal(rejectedOrg, null, "rejected does not create org");

    console.log("  ✅ Super Admin tests passed");

    console.log("\n═══ Approval tests ═══");

    // Approve college request
    r = await request(base, `/organization-registration-requests/admin/${collegeRequestId}/approve`, {
      user: superAdmin,
      method: "POST",
    });
    assert.equal(r.status, 200, "approve success");
    const createdOrgId = r.data.organization._id;
    assert.ok(createdOrgId, "organization created");
    assert.equal(r.data.request.status, "APPROVED");
    assert.equal(String(r.data.request.resultingOrganizationId), String(createdOrgId));

    // Check org is unverified by default (approval != verification)
    const createdOrg = await Organization.findById(createdOrgId).lean();
    assert.equal(createdOrg.verificationStatus, "UNVERIFIED", "org unverified by default");
    assert.equal(createdOrg.isVerified, false, "isVerified false by default");
    assert.equal(createdOrg.status, "APPROVED", "org status approved");

    // Applicant becomes OWNER
    const membership = await OrganizationMembership.findOne({
      organizationId: createdOrgId,
      userId: applicant._id,
    }).lean();
    assert.ok(membership, "OWNER membership created");
    assert.equal(membership.role, "OWNER", "role is OWNER");
    assert.equal(membership.status, "ACTIVE", "status ACTIVE");

    // No platform-wide admin granted
    const applicantAfter = await User.findById(applicant._id).lean();
    assert.equal(applicantAfter.role, "user", "no platform admin granted");

    // Repeated approval does not create duplicates (idempotent)
    const orgCountBefore = await Organization.countDocuments({ name: "Delhi Institute of Technology" });
    r = await request(base, `/organization-registration-requests/admin/${collegeRequestId}/approve`, {
      user: superAdmin,
      method: "POST",
    });
    assert.equal(r.status, 200, "repeated approval returns existing");
    const orgCountAfter = await Organization.countDocuments({ name: "Delhi Institute of Technology" });
    assert.equal(orgCountBefore, orgCountAfter, "no duplicate org on repeated approval");
    assert.equal(String(r.data.organization._id), String(createdOrgId), "same org id on retry");

    // Concurrent approval attempts - simulate by calling approve twice quickly
    // (In real test, transaction ensures atomicity; here we just verify no duplicate via unique slug logic)
    const clubApprove1 = request(base, `/organization-registration-requests/admin/${clubRequestId}/approve`, {
      user: superAdmin,
      method: "POST",
    });
    const clubApprove2 = request(base, `/organization-registration-requests/admin/${clubRequestId}/approve`, {
      user: superAdmin,
      method: "POST",
    });
    const [res1, res2] = await Promise.all([clubApprove1, clubApprove2]);
    assert.ok([200, 409].includes(res1.status) || res1.status === 200, "concurrent approve handled");
    assert.ok([200, 409].includes(res2.status) || res2.status === 200, "concurrent approve handled");
    const clubOrgs = await Organization.find({ name: "Approved College Tech Club" });
    assert.equal(clubOrgs.length, 1, "concurrent approval does not create duplicates");

    // Approve club with proposed parent - should create parent org too
    r = await request(base, `/organization-registration-requests/admin/${clubWithProposedParentId}/approve`, {
      user: superAdmin,
      method: "POST",
    });
    assert.equal(r.status, 200, "approve club with proposed parent");
    const clubOrg = await Organization.findById(r.data.organization._id).lean();
    assert.ok(clubOrg.parentOrganizationId, "club has parentOrganizationId set");
    const parentCreated = await Organization.findById(clubOrg.parentOrganizationId).lean();
    assert.ok(parentCreated, "proposed parent org created");
    assert.equal(parentCreated.name, "New College of Arts", "parent name correct");

    // Existing orgs not silently reassigned
    const otherOrgMembership = await OrganizationMembership.findOne({
      organizationId: parentOrg._id,
      userId: applicant._id,
    });
    assert.equal(otherOrgMembership, null, "existing org not reassigned to new applicant");

    console.log("  ✅ Approval tests passed");

    console.log("\n═══ Security & Edge tests ═══");

    // IDOR via URL manipulation
    r = await request(base, `/organization-registration-requests/${clubRequestId}`, { user: normalUser });
    assert.equal(r.status, 403, "IDOR prevented for normal user");

    // Mass assignment - applicant cannot set resultingOrganizationId
    r = await request(base, "/organization-registration-requests", {
      user: applicant,
      method: "POST",
      body: {
        category: "COLLEGE",
        proposedName: "Mass Assignment College",
        resultingOrganizationId: parentOrg._id,
        status: "APPROVED",
        declarationAccepted: true,
      },
    });
    assert.equal(r.status, 201, "mass assignment attempt creates but ignores privileged fields");
    assert.notEqual(String(r.data.request.resultingOrganizationId || ""), String(parentOrg._id), "resulting org not set by client");
    assert.notEqual(r.data.request.status, "APPROVED", "status not set to APPROVED by client");

    // Idempotency - same key returns same request
    const idemKey = "test-idempotency-key-123";
    r = await request(base, "/organization-registration-requests", {
      user: applicant,
      method: "POST",
      body: {
        category: "COLLEGE",
        proposedName: "Idempotent College",
        declarationAccepted: true,
        idempotencyKey: idemKey,
      },
    });
    assert.equal(r.status, 201, "first idempotent request");
    const firstId = r.data.request._id;
    r = await request(base, "/organization-registration-requests", {
      user: applicant,
      method: "POST",
      headers: { "idempotency-key": idemKey },
      body: {
        category: "COLLEGE",
        proposedName: "Idempotent College Different Name Should Be Ignored",
        declarationAccepted: true,
      },
    });
    assert.equal(r.status, 200, "second idempotent returns existing");
    assert.equal(String(r.data.request._id), String(firstId), "same id on idempotent retry");
    assert.equal(r.data.deduped, true, "deduped flag");

    console.log("  ✅ Security & Edge tests passed");

    console.log("\n✅ Organization Registration E2E: all checks passed\n");
  } catch (error) {
    console.error("❌ Organization Registration E2E failed:", error);
    console.error(error.stack);
    process.exitCode = 1;
  } finally {
    emailService.send = originalEmailSend;
    if (server) await new Promise((resolve) => server.close(resolve));
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    if (mongod) await mongod.stop();
  }
})();
