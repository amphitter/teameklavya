#!/usr/bin/env node
"use strict";

/**
 * Phase 5 Event owner transition. Safe by default: reports cohorts + related
 * records without writes. Applying is a separate, explicitly confirmed step.
 *
 *   npm run event:phase5:dry-run
 *   npm run event:phase5:apply -- --confirm=EVENT_OWNER_BACKFILL_V1
 *
 * Review the dry-run report and confirm a current backup before applying to
 * any persistent environment. The migration is additive and only sets the new
 * organizerType/organizerId fields.
 */
require("dotenv").config();

const mongoose = require("mongoose");
const { runEventOwnerPhase5Backfill } = require("../migrations/event-owner-phase5-backfill.migration");

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const hasConfirmation = args.includes("--confirm=EVENT_OWNER_BACKFILL_V1");

(async () => {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is required");
  if (apply && !hasConfirmation) {
    throw new Error("Applying requires --confirm=EVENT_OWNER_BACKFILL_V1 after reviewing the dry-run report and confirming a backup");
  }
  await mongoose.connect(process.env.MONGO_URI, {
    maxPoolSize: 2,
    serverSelectionTimeoutMS: 8000,
    autoIndex: false,
  });

  const summary = await runEventOwnerPhase5Backfill({ apply });
  console.log(JSON.stringify(summary, null, 2));
  if (!apply) {
    console.log("Dry run only. Review the report and confirm a current backup before an explicitly confirmed apply.");
  }
})()
  .catch((error) => {
    console.error("Event owner Phase 5 backfill failed:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  });
