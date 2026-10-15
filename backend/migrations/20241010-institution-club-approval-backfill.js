"use strict";

/**
 * Dry-run + reversible migration for institution-club hierarchy and event approval.
 * - Organizations: backfill affiliationStatus
 * - Events: backfill approvalStatus APPROVED for existing events
 * No destructive prod migration without authorization – additive compatible.
 */

const mongoose = require("mongoose");
const Organization = require("../models/organization.model");
const Event = require("../models/event.model");
const { isInstitutionCategory, isClubCategory } = require("../config/organization");

async function dryRun() {
  console.log("=== DRY RUN Institution-Club Backfill ===");
  const orgs = await Organization.find({}).select("_id name category parentOrganizationId affiliationStatus status").lean();
  let institutionCount = 0;
  let clubCount = 0;
  let clubWithParent = 0;
  let clubWithoutParent = 0;
  let ambiguous = [];

  for (const org of orgs) {
    const cat = String(org.category || "").toUpperCase();
    if (isInstitutionCategory(cat)) institutionCount++;
    if (isClubCategory(cat)) {
      clubCount++;
      if (org.parentOrganizationId) clubWithParent++;
      else clubWithoutParent++;
      if (org.parentOrganizationId && !org.affiliationStatus) {
        ambiguous.push({ _id: org._id, name: org.name, category: cat, parent: org.parentOrganizationId });
      }
    }
  }

  console.log(`Institutions: ${institutionCount}, Clubs: ${clubCount} (with parent ${clubWithParent}, without ${clubWithoutParent})`);
  console.log(`Ambiguous club affiliation (parent exists but no affiliationStatus): ${ambiguous.length}`);
  ambiguous.slice(0, 20).forEach((a) => console.log(` - ${a.name} (${a.category}) parent ${a.parent}`));

  const events = await Event.find({}).select("_id title approvalStatus organizerType organizerId organization").lean();
  let withoutApproval = events.filter((e) => !e.approvalStatus).length;
  let pending = events.filter((e) => e.approvalStatus === "PENDING_REVIEW").length;
  let approved = events.filter((e) => e.approvalStatus === "APPROVED").length;
  console.log(`Events: total ${events.length}, without approvalStatus ${withoutApproval}, pending ${pending}, approved ${approved}`);

  return { institutionCount, clubCount, clubWithParent, clubWithoutParent, ambiguousCount: ambiguous.length, eventsTotal: events.length, eventsWithoutApproval: withoutApproval };
}

async function backfill({ dry = true } = {}) {
  console.log(`=== Backfill ${dry ? "DRY" : "LIVE"} ===`);
  const stats = await dryRun();
  if (dry) {
    console.log("Dry run complete – no changes written. Pass dry=false to apply.");
    return stats;
  }

  // Organizations: set affiliationStatus
  const clubs = await Organization.find({ parentOrganizationId: { $ne: null } });
  let updatedClubs = 0;
  for (const club of clubs) {
    if (!club.affiliationStatus || club.affiliationStatus === "NONE") {
      // If parent exists and is approved, set APPROVED else PENDING
      const parent = await Organization.findById(club.parentOrganizationId).select("status").lean();
      const shouldApprove = parent && parent.status === "APPROVED";
      club.affiliationStatus = shouldApprove ? "APPROVED" : "PENDING";
      if (shouldApprove) {
        club.affiliationApprovedAt = club.affiliationApprovedAt || new Date();
        club.lastAffiliationChangeAt = new Date();
      } else {
        club.affiliationRequestedAt = club.affiliationRequestedAt || club.createdAt || new Date();
        club.lastAffiliationChangeAt = new Date();
      }
      await club.save();
      updatedClubs++;
    }
  }
  console.log(`Updated ${updatedClubs} clubs affiliationStatus`);

  // Institutions without parent – ensure affiliationStatus NONE
  const institutions = await Organization.find({ parentOrganizationId: null, affiliationStatus: { $exists: false } });
  let updatedInst = 0;
  for (const inst of institutions) {
    if (!inst.affiliationStatus) {
      inst.affiliationStatus = "NONE";
      await inst.save();
      updatedInst++;
    }
  }
  console.log(`Updated ${updatedInst} institutions to NONE`);

  // Events: backfill approvalStatus APPROVED for existing events without status
  const result = await Event.updateMany({ approvalStatus: { $exists: false } }, { $set: { approvalStatus: "APPROVED", version: 1 } });
  console.log(`Backfilled ${result.modifiedCount} events to APPROVED`);

  // Also ensure events with null approvalStatus set to APPROVED
  const result2 = await Event.updateMany({ approvalStatus: null }, { $set: { approvalStatus: "APPROVED" } });
  console.log(`Backfilled ${result2.modifiedCount} null approvalStatus events`);

  return { ...stats, updatedClubs, updatedInst, backfilledEvents: result.modifiedCount + result2.modifiedCount };
}

module.exports = { dryRun, backfill };

if (require.main === module) {
  (async () => {
    const uri = process.env.MONGODB_URI || "mongodb://localhost:27017/eventhub";
    await mongoose.connect(uri);
    const isDry = process.argv.includes("--dry") || !process.argv.includes("--live");
    if (isDry) await dryRun();
    else await backfill({ dry: false });
    await mongoose.disconnect();
  })();
}
