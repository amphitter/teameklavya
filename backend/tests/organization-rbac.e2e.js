"use strict";

/** Focused Phase 4 tests: lifecycle backfill, organization role capabilities,
 * invitations, member management, and unchanged Super Admin verification gates.
 * All requests use MongoMemoryServer; no production database is touched. */
process.env.NODE_ENV = "test";
process.env.PORT = "5076";
process.env.JWT_SECRET = "organization-rbac-test-secret";

const assert = require("node:assert/strict");
const express = require("express");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const User = require("../models/user.model");
const Organization = require("../models/organization.model");
const OrganizationMembership = require("../models/organizationMembership.model");
const Notification = require("../models/notification.model");
const { SUPER_ADMIN_EMAIL } = require("../services/ownership.service");
const { runOrganizationPhase4Backfill } = require("../migrations/organization-phase4-backfill.migration");

function tokenFor(user) {
  return jwt.sign(
    { id: String(user._id), role: user.role || "user", purpose: "auth" },
    process.env.JWT_SECRET,
    { expiresIn: "1h" }
  );
}

async function request(base, path, { user, token, method = "GET", body } = {}) {
  const bearer = token || (user ? tokenFor(user) : null);
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  let data = {};
  try { data = await response.json(); } catch {}
  return { status: response.status, data };
}

async function makeUser(username, role = "user", email = `${username}@example.test`) {
  return User.create({
    firstName: username[0].toUpperCase() + username.slice(1),
    lastName: "Tester",
    username,
    email,
    role,
    passwordHash: "test-password",
    emailVerified: true,
  });
}

(async () => {
  let mongod;
  let server;
  try {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
    await Promise.all([Organization.init(), OrganizationMembership.init(), Notification.init()]);

    const app = express();
    app.use(express.json());
    app.use("/api/organizations", require("../routes/organization.routes"));
    await new Promise((resolve, reject) => {
      server = app.listen(0, "127.0.0.1", resolve);
      server.once("error", reject);
    });
    const base = `http://127.0.0.1:${server.address().port}/api`;

    const owner = await makeUser("orgowner");
    const admin = await makeUser("orgadmin");
    const manager = await makeUser("orgmanager");
    const editor = await makeUser("orgeditor");
    const eventManager = await makeUser("orgeventmanager");
    const member = await makeUser("orgmember");
    const invitedAdmin = await makeUser("invitedadmin");
    const invitedMember = await makeUser("invitedmember");
    const superAssignedManager = await makeUser("superassigned");
    const platformAdmin = await makeUser("platformadmin", "admin");
    const superAdmin = await makeUser("permanentowner", "user", SUPER_ADMIN_EMAIL);

    const organization = await Organization.create({
      name: "Phase Four Organization",
      slug: "phase-four-organization",
      category: "TECH_COMMUNITY",
      createdBy: owner._id,
      managers: [manager._id],
      isVerified: true,
    });
    await OrganizationMembership.create([
      { organizationId: organization._id, userId: owner._id, role: "OWNER", status: "ACTIVE" },
      { organizationId: organization._id, userId: admin._id, role: "ADMIN", status: "ACTIVE" },
      { organizationId: organization._id, userId: manager._id, role: "MANAGER", status: "ACTIVE" },
      { organizationId: organization._id, userId: editor._id, role: "EDITOR", status: "ACTIVE" },
      { organizationId: organization._id, userId: eventManager._id, role: "EVENT_MANAGER", status: "ACTIVE" },
      { organizationId: organization._id, userId: member._id, role: "MEMBER", status: "ACTIVE" },
    ]);

    // Existing records still authorize by legacy fields before migration.
    const legacyManagerOrg = await Organization.create({
      name: "Legacy Manager Organization",
      slug: "legacy-manager-organization",
      createdBy: owner._id,
      managers: [manager._id],
    });
    const legacyManagerProfile = await request(base, `/organizations/${legacyManagerOrg.slug}`, { user: manager });
    assert.equal(legacyManagerProfile.status, 200, JSON.stringify(legacyManagerProfile.data));
    assert.equal(legacyManagerProfile.data.organization.canManage, true);
    assert.equal((await request(base, `/organizations/${legacyManagerOrg._id}/parent-options`, { user: manager })).status, 200);
    const legacyRoster = await request(base, `/organizations/${legacyManagerOrg._id}/members`, { user: owner });
    assert.deepEqual(legacyRoster.data.members.map((item) => item.role).sort(), ["MANAGER", "OWNER"]);
    const staleManagerOrg = await Organization.create({
      name: "Revoked Legacy Manager Organization",
      slug: "revoked-legacy-manager-organization",
      createdBy: owner._id,
      managers: [superAssignedManager._id],
    });
    await OrganizationMembership.create({
      organizationId: staleManagerOrg._id,
      userId: superAssignedManager._id,
      role: "MANAGER",
      status: "REVOKED",
    });
    const revokedManagerProfile = await request(base, `/organizations/${staleManagerOrg.slug}`, { user: superAssignedManager });
    assert.equal(revokedManagerProfile.data.organization.canManage, false, "explicit revocation must override stale managers[] data");
    assert.equal((await request(base, `/organizations/${staleManagerOrg._id}`, {
      user: superAssignedManager, method: "PUT", body: { description: "should be denied" },
    })).status, 403);

    // Capability matrix: owner/admin/manager edit profiles, while only
    // owner/admin manage membership. Editor/event-manager/member stay read-only.
    for (const user of [owner, admin, manager]) {
      const profile = await request(base, `/organizations/${organization.slug}`, { user });
      assert.equal(profile.status, 200);
      assert.equal(profile.data.organization.canManage, true);
      assert.equal(profile.data.organization.canManageMembers, user === owner || user === admin);
      const update = await request(base, `/organizations/${organization._id}`, {
        user,
        method: "PUT",
        body: { description: `${user.username} profile edit` },
      });
      assert.equal(update.status, 200);
    }
    for (const user of [editor, eventManager, member]) {
      const profile = await request(base, `/organizations/${organization.slug}`, { user });
      assert.equal(profile.status, 200);
      assert.equal(profile.data.organization.canManage, false);
      assert.equal(profile.data.organization.canManageMembers, false);
      const update = await request(base, `/organizations/${organization._id}`, {
        user,
        method: "PUT",
        body: { description: "should be denied" },
      });
      assert.equal(update.status, 403);
    }

    // /mine remains scoped to roles that can attach to the existing event flow.
    assert.ok((await request(base, "/organizations/mine", { user: manager })).data.organizations.some((item) => item._id === String(organization._id)));
    assert.ok(!(await request(base, "/organizations/mine", { user: editor })).data.organizations.some((item) => item._id === String(organization._id)));

    // Membership roster is backend-protected, and invites are capability- and
    // role-limited. Owners may assign ADMIN; admins may not assign ADMIN.
    assert.equal((await request(base, `/organizations/${organization._id}/members`, { user: owner })).status, 200);
    assert.equal((await request(base, `/organizations/${organization._id}/members`, { user: manager })).status, 403);
    assert.equal((await request(base, `/organizations/${organization._id}/members`, { user: platformAdmin })).status, 403);

    const adminInvite = await request(base, `/organizations/${organization._id}/members`, {
      user: owner,
      method: "POST",
      body: { username: invitedAdmin.username, role: "ADMIN" },
    });
    assert.equal(adminInvite.status, 201);
    assert.equal(adminInvite.data.membership.role, "ADMIN");
    assert.equal(adminInvite.data.membership.status, "INVITED");
    assert.ok(await Notification.exists({ user: invitedAdmin._id, type: "organization_invite", organization: organization._id }));
    const invitedProfile = await request(base, `/organizations/${organization.slug}`, { user: invitedAdmin });
    assert.equal(invitedProfile.data.organization.myMembership.status, "INVITED");
    assert.equal(invitedProfile.data.organization.canManage, false);
    assert.equal((await request(base, `/organizations/${organization._id}/members/invitations/accept`, {
      user: member, method: "POST",
    })).status, 404, "a different user must not accept the invitation");

    assert.equal((await request(base, `/organizations/${organization._id}/members/invitations/accept`, {
      user: invitedAdmin, method: "POST",
    })).status, 200);
    const acceptedAdminProfile = await request(base, `/organizations/${organization.slug}`, { user: invitedAdmin });
    assert.equal(acceptedAdminProfile.data.organization.myMembership.status, "ACTIVE");
    assert.equal(acceptedAdminProfile.data.organization.canManage, true);
    assert.equal(acceptedAdminProfile.data.organization.canManageMembers, true);

    assert.equal((await request(base, `/organizations/${organization._id}/members`, {
      user: admin, method: "POST", body: { username: invitedMember.username, role: "MEMBER" },
    })).status, 201);
    assert.equal((await request(base, `/organizations/${organization._id}/members`, {
      user: admin, method: "POST", body: { username: "orgmanager", role: "ADMIN" },
    })).status, 403);
    assert.equal((await request(base, `/organizations/${organization._id}/members`, {
      user: manager, method: "POST", body: { username: invitedMember.username, role: "MEMBER" },
    })).status, 403);
    assert.equal((await request(base, `/organizations/${organization._id}/members`, {
      user: owner, method: "POST", body: { username: "orgmanager", role: "MANAGER" },
    })).status, 400);

    const invitedMembership = await OrganizationMembership.findOne({ organizationId: organization._id, userId: invitedMember._id });
    assert.equal(invitedMembership.status, "INVITED");
    assert.equal((await request(base, `/organizations/${organization._id}/members/invitations/accept`, {
      user: invitedMember, method: "POST",
    })).data.status, "ACTIVE");

    assert.equal((await request(base, `/organizations/${organization._id}/members/${invitedMember._id}`, {
      user: admin, method: "PATCH", body: { role: "ADMIN" },
    })).status, 403);
    assert.equal((await request(base, `/organizations/${organization._id}/members/${invitedMember._id}`, {
      user: owner, method: "PATCH", body: { role: "EDITOR" },
    })).status, 200);
    assert.equal((await request(base, `/organizations/${organization._id}/members/${invitedMember._id}`, {
      user: owner, method: "PATCH", body: { role: "OWNER" },
    })).status, 400);
    assert.equal((await request(base, `/organizations/${organization._id}/members/${owner._id}`, {
      user: admin, method: "DELETE",
    })).status, 403);
    assert.equal((await request(base, `/organizations/${organization._id}/members/${invitedMember._id}`, {
      user: admin, method: "DELETE",
    })).status, 200);
    assert.equal((await OrganizationMembership.findOne({ organizationId: organization._id, userId: invitedMember._id })).status, "REVOKED");
    assert.equal((await request(base, `/organizations/${organization.slug}`, { user: invitedMember })).data.organization.canManage, false);

    // Super Admin remains the only caller who can verify or manage legacy
    // MANAGER assignments; a normal platform admin is deliberately insufficient.
    assert.equal((await request(base, `/organizations/${organization._id}/unverify`, { user: platformAdmin, method: "POST" })).status, 403);
    assert.equal((await request(base, `/organizations/${organization._id}/unverify`, { user: owner, method: "POST" })).status, 403);
    assert.equal((await request(base, `/organizations/${organization._id}/unverify`, { user: superAdmin, method: "POST" })).status, 200);
    assert.equal((await Organization.findById(organization._id).select("isVerified verificationStatus status").lean()).verificationStatus, "UNVERIFIED");
    assert.equal((await request(base, `/organizations/${organization._id}/verify`, { user: superAdmin, method: "POST" })).status, 200);
    const verifiedAgain = await Organization.findById(organization._id).select("isVerified verificationStatus status").lean();
    assert.deepEqual([verifiedAgain.isVerified, verifiedAgain.verificationStatus, verifiedAgain.status], [true, "VERIFIED", "APPROVED"]);
    assert.equal((await request(base, `/organizations/${organization._id}/managers`, {
      user: platformAdmin, method: "POST", body: { userId: superAssignedManager._id },
    })).status, 403);
    assert.equal((await request(base, `/organizations/${organization._id}/managers`, {
      user: superAdmin, method: "POST", body: { userId: superAssignedManager._id },
    })).status, 200);
    assert.deepEqual(
      await OrganizationMembership.findOne({ organizationId: organization._id, userId: superAssignedManager._id }).then((row) => [row.role, row.status]),
      ["MANAGER", "ACTIVE"]
    );
    assert.equal((await request(base, `/organizations/${organization.slug}`, { user: superAssignedManager })).data.organization.canManage, true);
    assert.equal((await request(base, `/organizations/${organization._id}/managers/remove`, {
      user: superAdmin, method: "POST", body: { userId: superAssignedManager._id },
    })).status, 200);
    assert.equal((await OrganizationMembership.findOne({ organizationId: organization._id, userId: superAssignedManager._id })).status, "REVOKED");
    assert.equal((await request(base, `/organizations/${organization.slug}`, { user: superAssignedManager })).data.organization.canManage, false);

    // Dry-run writes nothing. Apply fills only missing lifecycle values, maps
    // legacy roles, preserves explicit lower roles, and can safely be repeated.
    const oldVerified = new mongoose.Types.ObjectId();
    const oldUnverified = new mongoose.Types.ObjectId();
    const legacyCreatedAt = new Date("2020-01-02T03:04:05.000Z");
    await Organization.collection.insertMany([
      {
        _id: oldVerified,
        name: "Raw Verified Legacy Org",
        slug: "raw-verified-legacy-org",
        createdBy: owner._id,
        managers: [manager._id, editor._id],
        isVerified: true,
        createdAt: legacyCreatedAt,
        updatedAt: legacyCreatedAt,
      },
      {
        _id: oldUnverified,
        name: "Raw Unverified Legacy Org",
        slug: "raw-unverified-legacy-org",
        createdBy: owner._id,
        managers: [],
        isVerified: false,
        status: "SUSPENDED",
        verificationStatus: "REVOKED",
        ownershipStatus: "DISPUTED",
        createdAt: legacyCreatedAt,
        updatedAt: legacyCreatedAt,
      },
    ]);
    await OrganizationMembership.create({
      organizationId: oldVerified,
      userId: editor._id,
      role: "MEMBER",
      status: "ACTIVE",
    });
    const beforeDryRun = await Organization.collection.findOne({ _id: oldVerified });
    const dryRun = await runOrganizationPhase4Backfill({ apply: false });
    assert.ok(dryRun.organizationsScanned >= 3);
    assert.ok(dryRun.lifecycleRecordsNeedingDefaults >= 1);
    assert.equal((await Organization.collection.findOne({ _id: oldVerified })).status, beforeDryRun.status);
    assert.equal(await OrganizationMembership.countDocuments({ organizationId: oldVerified, userId: owner._id }), 0);

    const applied = await runOrganizationPhase4Backfill({ apply: true });
    assert.ok(applied.lifecycleRecordsUpdated >= 1);
    const oldVerifiedAfter = await Organization.collection.findOne({ _id: oldVerified });
    assert.equal(oldVerifiedAfter.status, "APPROVED");
    assert.equal(oldVerifiedAfter.verificationStatus, "VERIFIED");
    assert.equal(oldVerifiedAfter.ownershipStatus, "PERSONAL");
    const ownerMembership = await OrganizationMembership.findOne({ organizationId: oldVerified, userId: owner._id }).lean();
    const managerMembership = await OrganizationMembership.findOne({ organizationId: oldVerified, userId: manager._id }).lean();
    const explicitEditorMembership = await OrganizationMembership.findOne({ organizationId: oldVerified, userId: editor._id }).lean();
    assert.deepEqual([ownerMembership.role, ownerMembership.status], ["OWNER", "ACTIVE"]);
    assert.deepEqual([managerMembership.role, managerMembership.status], ["MANAGER", "ACTIVE"]);
    assert.deepEqual([explicitEditorMembership.role, explicitEditorMembership.status], ["MEMBER", "ACTIVE"]);
    const oldUnverifiedAfter = await Organization.collection.findOne({ _id: oldUnverified });
    assert.equal(oldUnverifiedAfter.status, "SUSPENDED");
    assert.equal(oldUnverifiedAfter.verificationStatus, "REVOKED");
    assert.equal(oldUnverifiedAfter.ownershipStatus, "DISPUTED");
    await runOrganizationPhase4Backfill({ apply: true });
    assert.equal(await OrganizationMembership.countDocuments({ organizationId: oldVerified, userId: owner._id }), 1);

    console.log("Organization Phase 4 lifecycle/RBAC checks passed.");
  } catch (error) {
    console.error("Organization Phase 4 tests failed:", error);
    process.exitCode = 1;
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    if (mongod) await mongod.stop();
  }
})();
