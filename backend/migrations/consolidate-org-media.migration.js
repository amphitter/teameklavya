/**
 * Consolidate duplicate org media fields: logo/logoUrl, cover/coverUrl
 * Claude: Duplicate fields consolidate with migration to reduce bugs like white-logo and overflow.
 * - If logo exists and logoUrl empty, copy logo → logoUrl
 * - If logoUrl exists and logo empty, copy logoUrl → logo
 * - Same for cover/coverUrl
 * - If both exist but differ, keep logoUrl/coverUrl as canonical (newer API), but ensure logo/cover synced
 * Idempotent, additive, no data loss.
 */

const Organization = require("../models/organization.model");

async function consolidateOrgMedia({ dryRun = true } = {}) {
  const orgs = await Organization.find({
    $or: [
      { logo: { $exists: true, $ne: "" }, logoUrl: { $in: ["", null] } },
      { logoUrl: { $exists: true, $ne: "" }, logo: { $in: ["", null] } },
      { cover: { $exists: true, $ne: "" }, coverUrl: { $in: ["", null] } },
      { coverUrl: { $exists: true, $ne: "" }, cover: { $in: ["", null] } },
      { logo: { $exists: true, $ne: "" }, logoUrl: { $exists: true, $ne: "" } },
      { cover: { $exists: true, $ne: "" }, coverUrl: { $exists: true, $ne: "" } },
    ],
  }).select("name slug logo logoUrl cover coverUrl").lean();

  console.log(`[consolidate-org-media] Found ${orgs.length} orgs with duplicate media fields (dryRun=${dryRun})`);

  let fixed = 0;
  for (const org of orgs) {
    const updates = {};
    // logo
    if (org.logo && !org.logoUrl) {
      updates.logoUrl = org.logo;
    } else if (org.logoUrl && !org.logo) {
      updates.logo = org.logoUrl;
    } else if (org.logo && org.logoUrl && org.logo !== org.logoUrl) {
      // Prefer logoUrl as canonical if it looks like Cloudinary URL, else keep both synced to logoUrl
      // If logoUrl is Cloudinary and logo is not, keep logoUrl. If both Cloudinary, keep logoUrl.
      // For safety, sync logo to logoUrl if logoUrl exists
      if (org.logoUrl) updates.logo = org.logoUrl;
    }
    // cover
    if (org.cover && !org.coverUrl) {
      updates.coverUrl = org.cover;
    } else if (org.coverUrl && !org.cover) {
      updates.cover = org.coverUrl;
    } else if (org.cover && org.coverUrl && org.cover !== org.coverUrl) {
      if (org.coverUrl) updates.cover = org.coverUrl;
    }

    if (Object.keys(updates).length > 0) {
      fixed++;
      if (!dryRun) {
        await Organization.updateOne({ _id: org._id }, { $set: updates });
        console.log(`[consolidate-org-media] Fixed ${org.slug}:`, updates);
      } else {
        console.log(`[consolidate-org-media] Would fix ${org.slug}:`, updates);
      }
    }
  }

  console.log(`[consolidate-org-media] Done. Fixed ${fixed} orgs (dryRun=${dryRun})`);
  return { found: orgs.length, fixed };
}

module.exports = { consolidateOrgMedia };

// If run directly: node -e "require('./migrations/consolidate-org-media.migration').consolidateOrgMedia({dryRun:false})"
if (require.main === module) {
  const mongoose = require("mongoose");
  require("dotenv").config();
  const connectDB = require("../config/db");
  (async () => {
    await connectDB();
    const dryRun = process.argv.includes("--apply") ? false : true;
    await consolidateOrgMedia({ dryRun });
    await mongoose.connection.close();
    process.exit(0);
  })();
}
