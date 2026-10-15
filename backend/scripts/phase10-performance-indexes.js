"use strict";

/**
 * Phase 10 additive index migration.
 *
 * Default: connect to MONGO_URI read-only and print a dry-run plan.
 * Apply: requires ALL of:
 *   --apply --confirm=PHASE10_PERFORMANCE_INDEXES_V1
 *   PHASE10_ALLOW_INDEX_APPLY=1
 *
 * No collection data is read beyond index metadata or modified. This script is
 * not imported by server.js and is never run automatically at application boot.
 */
const mongoose = require("mongoose");
const Event = require("../models/event.model");
const Community = require("../models/community.model");
const Notification = require("../models/notification.model");
const Communication = require("../models/communication.model");
const CommunicationDelivery = require("../models/communicationDelivery.model");
const RegistrationResponse = require("../models/registrationResponse.model");
const Message = require("../models/message.model");
const { PERFORMANCE_INDEXES, planPerformanceIndexes } = require("../migrations/performance-indexes.plan");

const CONFIRMATION = "PHASE10_PERFORMANCE_INDEXES_V1";
const MODELS = {
  Event,
  Community,
  Notification,
  Communication,
  CommunicationDelivery,
  RegistrationResponse,
  Message,
};

async function existingIndexes(model) {
  try {
    return await model.collection.indexes();
  } catch (error) {
    if (error?.code === 26 || error?.codeName === "NamespaceNotFound") return [];
    throw error;
  }
}

async function run({ apply = false } = {}) {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is required; no database was contacted");
  if (apply) {
    const confirmed = process.argv.includes(`--confirm=${CONFIRMATION}`);
    if (!confirmed || process.env.PHASE10_ALLOW_INDEX_APPLY !== "1") {
      throw new Error(
        `Apply blocked. Use --confirm=${CONFIRMATION} and set PHASE10_ALLOW_INDEX_APPLY=1 only after separate authorization.`
      );
    }
  }

  await mongoose.connect(process.env.MONGO_URI, {
    autoIndex: false,
    serverSelectionTimeoutMS: 8000,
    maxPoolSize: 2,
  });

  try {
    const existingByModel = {};
    for (const [name, model] of Object.entries(MODELS)) {
      existingByModel[name] = await existingIndexes(model);
    }

    const plan = planPerformanceIndexes(existingByModel);
    let created = 0;
    const failures = [];
    console.log(`Phase 10 performance indexes — ${apply ? "APPLY" : "DRY RUN"} (${plan.length} candidates)`);

    for (const item of plan) {
      if (item.present) {
        console.log(`  PRESENT ${item.model}.${item.existingName}: ${item.purpose}`);
        continue;
      }
      console.log(`  ${apply ? "CREATE" : "WOULD CREATE"} ${item.model}.${item.name} ${JSON.stringify(item.keys)} — ${item.purpose}`);
      if (!apply) continue;

      try {
        await MODELS[item.model].collection.createIndex(item.keys, { name: item.name });
        created += 1;
      } catch (error) {
        failures.push({ model: item.model, name: item.name, error });
        console.error(`  FAILED ${item.model}.${item.name}: ${error.code || ""} ${error.message}`);
      }
    }

    if (apply) console.log(`Created ${created} index(es); failures: ${failures.length}. No collection documents were modified.`);
    else console.log("Dry run complete. No indexes or documents were changed.");

    if (failures.length) process.exitCode = 1;
    return { plan, created, failures };
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  run({ apply: process.argv.includes("--apply") }).catch((error) => {
    console.error(`Phase 10 index migration stopped: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { run, CONFIRMATION, MODELS };
