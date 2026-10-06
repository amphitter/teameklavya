#!/usr/bin/env node
/**
 * Supabase backfill (Part 6, Phase 6 — brief §10)
 * ─────────────────────────────────────────────────────────────────────────────
 * Copies the social domain from MongoDB into Supabase.
 *
 *   node scripts/backfill-supabase.js                    # dry run (default)
 *   node scripts/backfill-supabase.js --apply            # actually enqueue
 *   node scripts/backfill-supabase.js --entity=profile   # one entity type
 *   node scripts/backfill-supabase.js --max=1000         # cap per entity
 *   node scripts/backfill-supabase.js --json             # machine-readable
 *
 * ══ SAFETY PROPERTIES (§10) ════════════════════════════════════════════════
 *   • DRY RUN BY DEFAULT. Nothing is written without --apply.
 *   • NEVER modifies or deletes MongoDB. This script only READS Mongo. There
 *     is no code path here that writes to it other than the outbox queue
 *     itself, and the outbox is a queue, not the data.
 *   • IDEMPOTENT AND RESUMABLE. Re-running enqueues the same entity ids; the
 *     outbox collapses duplicate pending work, and every apply is an upsert on
 *     the canonical id. Interrupt it and run it again.
 *   • BOUNDED (--max) so a mistake cannot enqueue millions of entries.
 *   • ORDERED so foreign keys resolve: profiles → organizations → communities
 *     → posts → everything else. PostgREST rejects a row whose FK target is
 *     absent, so order is correctness, not tidiness.
 *
 * ══ WHY IT ENQUEUES INSTEAD OF WRITING DIRECTLY ═════════════════════════════
 * The backfill enqueues outbox entries (`source: "backfill"`) that the normal
 * consumer applies. It would be simpler to write rows straight to Supabase
 * here — and that simplicity is exactly the trap: a separate write path means
 * the data you VERIFIED is not the data the LIVE path produces. They could
 * differ in one mapper and nobody would know until a user noticed.
 *
 * One code path for backfill and live sync is what makes the dual-read
 * comparison in verify-supabase.js mean anything.
 */

require("dotenv").config();

const mongoose = require("mongoose");

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=")[1] : fallback;
};

const APPLY = flag("apply");
const JSON_OUT = flag("json");
const ONLY = value("entity", null);
const MAX = Number(value("max", 100000));

/** FK-safe order. See the header — this is a correctness constraint. */
const BACKFILL_ORDER = [
  "profile",
  "organization",
  "community",
  "post",
  "comment",
  "reaction",
  "saved_post",
  "follow",
  "block",
  "org_follow",
  "community_member",
  "community_claim",
  "conversation",
  "message",
  "notification",
  "report",
  "achievement",
  "event_interest",
];

const log = (...a) => { if (!JSON_OUT) console.log(...a); };

(async () => {
  if (!process.env.MONGO_URI) {
    console.error("FATAL: MONGO_URI is not set.");
    process.exit(1);
  }
  const { supabaseProvider } = require("../providers/supabase");
  if (!supabaseProvider().isConfigured()) {
    console.error("FATAL: Supabase is not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).");
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI, {
    maxPoolSize: 2,
    serverSelectionTimeoutMS: 8000,
  });

  const Outbox = require("../models/outbox.model");
  const { COLLECTIONS } = require("../services/social-sync.service");

  const startedAt = Date.now();
  const results = [];
  let totalQueued = 0;

  const targets = ONLY ? [ONLY] : BACKFILL_ORDER;

  log("─".repeat(60));
  log(`Supabase backfill — ${APPLY ? "APPLY" : "DRY RUN (no writes)"}`);
  log(`Entities: ${targets.length}${ONLY ? ` (${ONLY})` : ""}   Cap per entity: ${MAX}`);
  log("─".repeat(60));

  for (const entityType of targets) {
    const collName = COLLECTIONS[entityType];
    if (!collName) {
      log(`  ⚠️  unknown entity type "${entityType}" — skipped`);
      continue;
    }
    const coll = mongoose.connection.db.collection(collName);

    const total = await coll.countDocuments({});
    const capped = Math.min(total, MAX);

    // Resume: skip entities already queued (pending or processing) so an
    // interrupted run does not re-queue completed work.
    const alreadyQueued = APPLY
      ? await Outbox.countDocuments({ entityType, status: { $in: ["pending", "processing"] } })
      : 0;

    const toQueue = Math.max(0, capped - alreadyQueued);

    if (APPLY && toQueue > 0) {
      // Stream with a cursor and a lean projection: we only need the id, and
      // loading whole documents would blow memory on the free tier (§40).
      const cursor = coll.find({}, { projection: { _id: 1 } }).sort({ _id: 1 }).limit(capped);
      const ops = [];
      let seen = 0;
      for await (const doc of cursor) {
        seen += 1;
        if (seen <= alreadyQueued) continue; // crude but correct: ids are sorted
        ops.push({
          updateOne: {
            filter: {
              entityType,
              entityId: String(doc._id),
              op: "upsert",
              status: "pending",
            },
            update: {
              $setOnInsert: {
                entityType,
                entityId: String(doc._id),
                op: "upsert",
                status: "pending",
                source: "backfill",
                dedupeKey: `${entityType}:${doc._id}:upsert`,
                attempts: 0,
                maxAttempts: 8,
                availableAt: new Date(),
              },
            },
            upsert: true,
          },
        });
        if (ops.length >= 500) {
          await Outbox.bulkWrite(ops, { ordered: false });
          ops.length = 0;
        }
      }
      if (ops.length) await Outbox.bulkWrite(ops, { ordered: false });
    }

    const row = {
      entityType,
      collection: collName,
      inMongo: total,
      considered: capped,
      alreadyQueued,
      queued: APPLY ? toQueue : 0,
    };
    results.push(row);
    totalQueued += APPLY ? toQueue : 0;
    log(
      `  ${entityType.padEnd(18)} ${String(row.inMongo).padStart(7)} in Mongo` +
      `   ${String(row.queued).padStart(7)} queued` +
      (row.alreadyQueued ? `   (${row.alreadyQueued} already queued)` : "")
    );
  }

  const durationMs = Date.now() - startedAt;

  if (JSON_OUT) {
    console.log(JSON.stringify({
      op: "supabase.backfill",
      mode: APPLY ? "apply" : "dry-run",
      entities: results.length,
      queued: totalQueued,
      durationMs,
      results,
    }));
  } else {
    log("─".repeat(60));
    log(`Total queued: ${totalQueued}${APPLY ? "" : " (dry run — nothing was written)"}`);
    log(`Duration: ${(durationMs / 1000).toFixed(1)}s`);
    log("─".repeat(60));
    if (!APPLY) {
      log("Next: re-run with --apply to enqueue, then drain with the outbox consumer.");
    } else {
      log("Next: run scripts/verify-supabase.js to verify BEFORE enabling reads.");
    }
  }

  await mongoose.disconnect();
})().catch(async (err) => {
  console.error("💥 backfill failed:", err?.message || err);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});
