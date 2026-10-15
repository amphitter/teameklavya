"use strict";

const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const {
  ORGANIZATION_CATEGORIES,
  ORGANIZATION_STATUSES,
  ORGANIZATION_VERIFICATION_STATUSES,
  ORGANIZATION_OWNERSHIP_STATUSES,
  ORGANIZATION_ROLES,
  ORGANIZATION_MEMBERSHIP_STATUSES,
  ORGANIZATION_PARENT_CATEGORIES,
  parentCategoriesForOrganization,
  childCategoriesForOrganization,
} = require("../config/organization");
const Organization = require("../models/organization.model");
const OrganizationMembership = require("../models/organizationMembership.model");
const OrgFollow = require("../models/orgFollow.model");

function indexFor(schema, expectedKeys) {
  return schema
    .indexes()
    .find(([keys]) => JSON.stringify(keys) === JSON.stringify(expectedKeys));
}

async function main() {
  assert.equal(ORGANIZATION_CATEGORIES.length, 16);
  assert.ok(ORGANIZATION_CATEGORIES.includes("COLLEGE_COMMUNITY"));
  assert.ok(ORGANIZATION_CATEGORIES.includes("UNIVERSITY_COMMUNITY"));
  assert.deepEqual(ORGANIZATION_PARENT_CATEGORIES, ["COLLEGE", "UNIVERSITY", "SCHOOL", "INSTITUTE"]);
  assert.deepEqual(parentCategoriesForOrganization("COLLEGE_CLUB"), ["COLLEGE", "UNIVERSITY"]);
  assert.deepEqual(parentCategoriesForOrganization("UNIVERSITY_COMMUNITY"), ["UNIVERSITY"]);
  assert.deepEqual(parentCategoriesForOrganization("COMPANY"), []);
  assert.deepEqual(childCategoriesForOrganization("SCHOOL"), ["STUDENT_CLUB", "CULTURAL_CLUB", "SPORTS_CLUB"]);
  assert.deepEqual(ORGANIZATION_STATUSES, [
    "DRAFT",
    "PENDING_REVIEW",
    "APPROVED",
    "REJECTED",
    "SUSPENDED",
    "REVOKED",
  ]);
  assert.deepEqual(ORGANIZATION_VERIFICATION_STATUSES, [
    "UNVERIFIED",
    "PENDING",
    "VERIFIED",
    "SUSPENDED",
    "REVOKED",
  ]);
  assert.deepEqual(ORGANIZATION_OWNERSHIP_STATUSES, [
    "PERSONAL",
    "CLAIM_PENDING",
    "ORGANIZATION_VERIFIED",
    "TRANSFER_PENDING",
    "DISPUTED",
    "REVOKED",
  ]);
  assert.deepEqual(ORGANIZATION_ROLES, [
    "OWNER",
    "ADMIN",
    "MANAGER",
    "EDITOR",
    "EVENT_MANAGER",
    "MEMBER",
  ]);
  assert.deepEqual(ORGANIZATION_MEMBERSHIP_STATUSES, [
    "ACTIVE",
    "PENDING",
    "INVITED",
    "SUSPENDED",
    "REVOKED",
  ]);

  const createdBy = new mongoose.Types.ObjectId();
  const organization = new Organization({
    name: "Example Organization",
    slug: "example-org",
    category: "COLLEGE_COMMUNITY",
    logoUrl: "https://example.test/logo.png",
    coverUrl: "https://example.test/cover.png",
    createdBy,
  });
  await organization.validate();
  assert.equal(organization.handle, "example-org");
  assert.equal(organization.slug, "example-org");
  assert.equal(organization.logo, organization.logoUrl);
  assert.equal(organization.cover, organization.coverUrl);
  assert.equal(organization.status, "APPROVED");
  assert.equal(organization.verificationStatus, "UNVERIFIED");
  assert.equal(organization.ownershipStatus, "PERSONAL");

  const newHandle = new Organization({
    name: "Handle-led Organization",
    handle: "handle-led",
    slug: "legacy-slug",
    createdBy,
    verificationStatus: "VERIFIED",
  });
  await newHandle.validate();
  assert.equal(newHandle.slug, "handle-led");
  assert.equal(newHandle.isVerified, true);
  assert.ok(newHandle.verifiedAt instanceof Date);

  // Existing admin controllers write `slug`, logoUrl/coverUrl, and the legacy
  // verification boolean. Confirm those edits still populate the new aliases.
  const legacyRecord = Organization.hydrate({
    _id: new mongoose.Types.ObjectId(),
    name: "Legacy Organization",
    slug: "legacy-org",
    description: "",
    logoUrl: "https://example.test/old-logo.png",
    coverUrl: "https://example.test/old-cover.png",
    website: "https://example.test",
    createdBy,
    isVerified: false,
    verifiedAt: null,
    managers: [],
  });
  legacyRecord.slug = "legacy-org-renamed";
  legacyRecord.logoUrl = "https://example.test/new-logo.png";
  legacyRecord.isVerified = true;
  await legacyRecord.validate();
  assert.equal(legacyRecord.handle, "legacy-org-renamed");
  assert.equal(legacyRecord.logo, legacyRecord.logoUrl);
  assert.equal(legacyRecord.isVerified, true);
  assert.equal(legacyRecord.verificationStatus, "VERIFIED");

  const invalidCategory = new Organization({
    name: "Invalid Category",
    slug: "invalid-category",
    category: "NOT_A_CATEGORY",
    createdBy,
  });
  await assert.rejects(invalidCategory.validate(), (error) => error.name === "ValidationError");

  const membership = new OrganizationMembership({
    organizationId: new mongoose.Types.ObjectId(),
    userId: new mongoose.Types.ObjectId(),
  });
  await membership.validate();
  assert.equal(membership.role, "MEMBER");
  assert.equal(membership.status, "ACTIVE");
  assert.ok(membership.joinedAt instanceof Date);

  const invalidMembership = new OrganizationMembership({
    organizationId: new mongoose.Types.ObjectId(),
    userId: new mongoose.Types.ObjectId(),
    role: "SUPERADMIN",
    status: "REMOVED",
  });
  await assert.rejects(invalidMembership.validate(), (error) => error.name === "ValidationError");

  const handleIndex = indexFor(Organization.schema, { handle: 1 });
  assert.ok(handleIndex, "Organization handle index must be declared");
  assert.equal(handleIndex[1].unique, true);
  assert.equal(handleIndex[1].sparse, true);
  assert.ok(indexFor(Organization.schema, { category: 1 }));
  assert.ok(indexFor(Organization.schema, { city: 1 }));
  assert.ok(indexFor(Organization.schema, { parentOrganizationId: 1 }));
  assert.ok(indexFor(Organization.schema, { verificationStatus: 1 }));
  assert.ok(indexFor(Organization.schema, { status: 1 }));
  assert.ok(indexFor(Organization.schema, { createdAt: -1, _id: -1 }));

  const membershipUniqueIndex = indexFor(OrganizationMembership.schema, {
    organizationId: 1,
    userId: 1,
  });
  assert.ok(membershipUniqueIndex);
  assert.equal(membershipUniqueIndex[1].unique, true);
  assert.ok(indexFor(OrganizationMembership.schema, { userId: 1, organizationId: 1 }));

  const followUniqueIndex = indexFor(OrgFollow.schema, { user: 1, organization: 1 });
  assert.ok(followUniqueIndex);
  assert.equal(followUniqueIndex[1].unique, true);
  assert.ok(indexFor(OrgFollow.schema, { organization: 1, user: 1 }));

  console.log("Organization foundation schema checks passed (no database connection used).");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
