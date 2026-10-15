#!/usr/bin/env node
"use strict";

/**
 * Organization lifecycle + legacy membership compatibility backfill.
 *
 *   node scripts/backfill-organization-phase4.js          # dry run; no data writes
 *   node scripts/backfill-organization-phase4.js --apply  # idempotent backfill
 *
 * Apply only after reviewing the dry-run counts and confirming a current DB
 * backup. The script does not run automatically at application startup.
 */
require("dotenv").config();

const mongoose = require("mongoose");
const { runOrganizationPhase4Backfill } = require("../migrations/organization-phase4-backfill.migration");

const apply = process.argv.slice(2).includes("--apply");

(async () => {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is required");
  await mongoose.connect(process.env.MONGO_URI, {
    maxPoolSize: 2,
    serverSelectionTimeoutMS: 8000,
    autoIndex: false,
  });

  if (apply) {
    const { ensureOrganizationIndexes } = require("../migrations/organization-indexes.migration");
    const indexes = await ensureOrganizationIndexes({ reason: "phase4-backfill" });
    if (!indexes.ok) throw new Error("Organization indexes could not be verified; no backfill was applied");
  }

  const summary = await runOrganizationPhase4Backfill({ apply });
  console.log(JSON.stringify(summary, null, 2));
  if (!apply) {
    console.log("Dry run only. Review these counts, then rerun with --apply to write changes.");
  }
})()
  .catch((error) => {
    console.error("Organization Phase 4 backfill failed:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  });
