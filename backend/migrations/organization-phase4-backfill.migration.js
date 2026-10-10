"use strict";

const Organization = require("../models/organization.model");
const OrganizationMembership = require("../models/organizationMembership.model");

/**
 * Compatibility backfill for Organization Phase 4.
 *
 * Safe by default: `apply: false` performs no writes. Applying is idempotent,
 * fills only missing lifecycle fields, maps createdBy → OWNER and legacy
 * managers[] → MANAGER, and never overwrites an explicit non-creator role.
 */
async function runOrganizationPhase4Backfill({ apply = false } = {}) {
  const summary = {
    mode: apply ? "apply" : "dry-run",
    organizationsScanned: 0,
    lifecycleRecordsNeedingDefaults: 0,
    overallStatusesMissing: 0,
    verificationStatusesMissing: 0,
    ownershipStatusesMissing: 0,
    ownerMembershipsConsidered: 0,
    legacyManagerMembershipsConsidered: 0,
    lifecycleRecordsUpdated: 0,
    ownerMembershipsUpserted: 0,
    legacyManagerMembershipsInserted: 0,
  };

  const cursor = Organization.find({})
    .select("_id createdBy managers isVerified status verificationStatus ownershipStatus createdAt")
    .lean()
    .cursor();

  for await (const organization of cursor) {
    summary.organizationsScanned += 1;
    const lifecycle = {};

    if (organization.status == null) {
      lifecycle.status = "APPROVED";
      summary.overallStatusesMissing += 1;
    }
    if (organization.verificationStatus == null) {
      lifecycle.verificationStatus = organization.isVerified === true ? "VERIFIED" : "UNVERIFIED";
      summary.verificationStatusesMissing += 1;
    }
    if (organization.ownershipStatus == null) {
      lifecycle.ownershipStatus = "PERSONAL";
      summary.ownershipStatusesMissing += 1;
    }

    if (Object.keys(lifecycle).length) {
      summary.lifecycleRecordsNeedingDefaults += 1;
      if (apply) {
        await Organization.collection.updateOne(
          { _id: organization._id },
          { $set: lifecycle }
        );
        summary.lifecycleRecordsUpdated += 1;
      }
    }

    if (organization.createdBy) {
      summary.ownerMembershipsConsidered += 1;
      if (apply) {
        await OrganizationMembership.updateOne(
          { organizationId: organization._id, userId: organization.createdBy },
          {
            $set: { role: "OWNER", status: "ACTIVE" },
            $setOnInsert: { joinedAt: organization.createdAt || new Date() },
          },
          { upsert: true, runValidators: true }
        );
        summary.ownerMembershipsUpserted += 1;
      }
    }

    const managerIds = new Map();
    for (const userId of organization.managers || []) {
      if (!userId || String(userId) === String(organization.createdBy)) continue;
      managerIds.set(String(userId), userId);
    }
    for (const userId of managerIds.values()) {
      summary.legacyManagerMembershipsConsidered += 1;
      if (apply) {
        const result = await OrganizationMembership.updateOne(
          { organizationId: organization._id, userId },
          {
            $setOnInsert: {
              role: "MANAGER",
              status: "ACTIVE",
              joinedAt: organization.createdAt || new Date(),
            },
          },
          { upsert: true, runValidators: true }
        );
        if (result.upsertedCount) summary.legacyManagerMembershipsInserted += 1;
      }
    }
  }

  return summary;
}

module.exports = { runOrganizationPhase4Backfill };
