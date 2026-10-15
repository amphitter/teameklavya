"use strict";

const mongoose = require("mongoose");
const Organization = require("../models/organization.model");
const OrganizationMembership = require("../models/organizationMembership.model");
const OrgFollow = require("../models/orgFollow.model");

const INDEXED_MODELS = [Organization, OrganizationMembership, OrgFollow];

/** `connectDB()` is intentionally non-blocking in server.js; wait for the
 * connection before issuing collection-level index operations. */
async function waitForConnection(timeoutMs = 30_000) {
  const startedAt = Date.now();
  while (mongoose.connection.readyState !== 1) {
    if (Date.now() - startedAt >= timeoutMs) return false;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return true;
}

/**
 * Add any indexes declared by the Organization foundation schemas.
 *
 * This is deliberately additive and idempotent: it uses createIndex only,
 * never syncIndexes/dropIndex, and never modifies Organization/Event records.
 * If a unique index cannot be built because existing data conflicts, report it
 * clearly and leave the API running; do not guess which records to repair.
 */
async function ensureOrganizationIndexes({ reason = "boot", quiet = false } = {}) {
  try {
    if (!(await waitForConnection())) {
      console.warn("[migration] organization indexes: DB not connected — skipped");
      return { ok: false, reason: "db-not-connected" };
    }

    const failures = [];
    for (const model of INDEXED_MODELS) {
      for (const [keys, options] of model.schema.indexes()) {
        try {
          await model.collection.createIndex(keys, options);
        } catch (error) {
          const keysLabel = JSON.stringify(keys);
          failures.push({ model: model.modelName, keys, error });
          console.error(
            `[migration] ${model.modelName} index ${keysLabel} failed (${error.code || ""} ${error.message}). ` +
              "No records were changed; resolve conflicting index/data manually."
          );
        }
      }
    }

    if (failures.length === 0) {
      if (!quiet) {
        console.log(`[migration] organization indexes ensured (${reason}; ${INDEXED_MODELS.length} models)`);
      }
      return { ok: true, failures: [] };
    }

    return { ok: false, reason: "index-build-failed", failures };
  } catch (error) {
    console.error(
      `[migration] organization index ensure failed (${reason}): ${error.code || ""} ${error.message}`
    );
    return { ok: false, reason: "error", error };
  }
}

module.exports = { ensureOrganizationIndexes, waitForConnection };
