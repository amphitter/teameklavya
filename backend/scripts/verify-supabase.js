#!/usr/bin/env node
/**
 * Independent verification of the Supabase migration (Part 6, Phase 6 — §10)
 * ─────────────────────────────────────────────────────────────────────────────
 * The rule this script exists to enforce:
 *
 *   NEVER delete MongoDB data until it has been independently verified.
 *
 * "Verified" here does not mean "the backfill reported success". A backfill
 * reporting success is that same program grading its own homework. This script
 * is a SECOND, independent comparison: it reads both stores separately,
 * compares counts and field-level content, and reports drift.
 *
 *   node scripts/verify-supabase.js                  # count + sample compare
 *   node scripts/verify-supabase.js --sample=500     # larger sample
 *   node scripts/verify-supabase.js --repair         # re-enqueue divergent rows
 *   node scripts/verify-supabase.js --json           # machine-readable
 *
 * ══ SAFETY PROPERTIES ══════════════════════════════════════════════════════
 *   • READ-ONLY against MongoDB. There is no delete path in this file at all.
 *     Deleting Mongo data is a manual, deliberate act that happens only after
 *     this script exits 0.
 *   • --repair writes to SUPABASE only (via the outbox), never to Mongo.
 *   • Exits non-zero when drift is found, so it can gate a deploy step.
 *   • Bounded: samples, never full scans of both stores.
 *
 * ══ WHAT IT COMPARES ═══════════════════════════════════════════════════════
 *   1. COUNT per entity type. Cheap, catches whole-entity loss.
 *   2. FIELD-LEVEL sample. N recent ids from Mongo, re-read from Supabase,
 *      compared column by column using the SAME mappers the live sync uses —
 *      so a mapper bug shows up as drift rather than as a silent difference
 *      between backfill and live behaviour.
 *
 * Counter columns are EXCLUDED from comparison on purpose: they are maintained
 * by trigger in Postgres and by application code in Mongo, so they are
 * expected to converge only after all rows land. Comparing them mid-migration
 * would produce noise that hides real drift.
 */

require("dotenv").config();

const mongoose = require("mongoose");

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=")[1] : fallback;
};

const REPAIR = flag("repair");
const JSON_OUT = flag("json");
const ONLY = value("entity", null);
const SAMPLE = Number(value("sample", 200));

/** Columns owned by Postgres triggers, not by the source document. */
const TRIGGER_OWNED = new Set([
  "followers_count", "following_count", "posts_count",
  "likes_count", "comments_count", "updated_at",
]);

const log = (...a) => { if (!JSON_OUT) console.log(...a); };

(async () => {
  if (!process.env.MONGO_URI) {
    console.error("FATAL: MONGO_URI is not set.");
    process.exit(1);
  }
  const { supabaseProvider } = require("../providers/supabase");
  const sb = supabaseProvider();
  if (!sb.isConfigured()) {
    console.error("FATAL: Supabase is not configured.");
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI, {
    maxPoolSize: 2,
    serverSelectionTimeoutMS: 8000,
  });

  const Outbox = require("../models/outbox.model");
  const sync = require("../services/social-sync.service");
  const { COLLECTIONS, TARGET_TABLE, MAPPERS } = sync;

  const startedAt = Date.now();
  const report = [];
  let totalDrift = 0;
  let repaired = 0;

  const targets = ONLY
    ? [ONLY]
    : Object.keys(COLLECTIONS);

  log("─".repeat(60));
  log(`Supabase verification — ${REPAIR ? "COMPARE + REPAIR" : "COMPARE ONLY"}`);
  log(`Sample size: ${SAMPLE}   Entities: ${targets.length}`);
  log("─".repeat(60));

  for (const entityType of targets) {
    const collName = COLLECTIONS[entityType];
    const table = TARGET_TABLE[entityType];
    const mapper = MAPPERS[entityType];
    if (!collName || !table || !mapper) continue;

    const coll = mongoose.connection.db.collection(collName);

    /* ── 1. Counts ──────────────────────────────────────────────────── */
    const mongoCount = await coll.countDocuments({});

    let supaCount = 0;
    try {
      // Count via a bounded read of ids: PostgREST's exact count needs a
      // Range header and returns only the total, so this is one round trip.
      const res = await sb._request("HEAD", `/${table}`, {
        query: "select=id",
        countMode: "exact",
      });
      supaCount = Number(res?.count ?? 0);
    } catch (err) {
      log(`  ❌ ${entityType.padEnd(18)} count query failed: ${err.message}`);
      report.push({ entityType, error: err.message, drift: mongoCount });
      totalDrift += mongoCount;
      continue;
    }

    const countDelta = mongoCount - supaCount;

    /* ── 2. Field-level sample ──────────────────────────────────────── */
    // Newest first: fresh data is what users are looking at, and it is where a
    // broken live-sync path would show up first.
    const sampleDocs = await coll
      .find({})
      .sort({ _id: -1 })
      .limit(SAMPLE)
      .toArray();

    const fieldDrift = [];
    const missing = [];

    if (sampleDocs.length) {
      const ids = sampleDocs.map((d) => String(d._id));
      const idColumn = entityType === "profile" ? "id" : "id";

      let supaRows = [];
      try {
        // One query for the whole sample — comparing row-by-row would be an
        // N+1 against the very store we are trying to certify.
        supaRows = await sb.from(table).select(["*"]).in(idColumn, ids).limit(ids.length).many();
      } catch (err) {
        log(`  ⚠️  ${entityType} sample read failed: ${err.message}`);
      }

      const byId = new Map(supaRows.map((r) => [String(r.id), r]));

      for (const doc of sampleDocs) {
        const expected = mapper(doc);
        const actual = byId.get(String(doc._id));
        if (!actual) {
          missing.push(String(doc._id));
          continue;
        }
        for (const [col, want] of Object.entries(expected)) {
          if (TRIGGER_OWNED.has(col)) continue;
          if (want === undefined || want === null) continue;
          // Compare loosely: Postgres returns ISO strings for timestamptz and
          // may normalise numeric/array shapes, so compare stringified forms.
          const a = typeof want === "object" ? JSON.stringify(want) : String(want);
          const b = typeof actual[col] === "object"
            ? JSON.stringify(actual[col])
            : String(actual[col] ?? "");
          if (a !== b) {
            fieldDrift.push({ id: String(doc._id), column: col, mongo: a, supabase: b });
            break; // one reported difference per row is enough to trigger repair
          }
        }
      }
    }

    const drift = Math.abs(countDelta) + missing.length + fieldDrift.length;
    totalDrift += drift;

    /* ── 3. Repair (Supabase side only) ─────────────────────────────── */
    let queued = 0;
    if (REPAIR && drift > 0) {
      const toRepair = [...new Set([...missing, ...fieldDrift.map((f) => f.id)])];
      if (toRepair.length) {
        const ops = toRepair.map((id) => ({
          updateOne: {
            filter: { entityType, entityId: id, op: "upsert", status: "pending" },
            update: {
              $setOnInsert: {
                entityType,
                entityId: id,
                op: "upsert",
                status: "pending",
                source: "reconcile",
                dedupeKey: `${entityType}:${id}:upsert`,
                attempts: 0,
                maxAttempts: 8,
                availableAt: new Date(),
              },
            },
            upsert: true,
          },
        }));
        const res = await Outbox.bulkWrite(ops, { ordered: false });
        queued = (res.upsertedCount || 0) + (res.modifiedCount || 0);
        repaired += queued;
      }
      // A COUNT shortfall we could not attribute to a sampled row means rows
      // outside the sample window are missing. Re-queue the whole entity from
      // the backfill rather than guess which ones.
      if (countDelta > 0 && queued < countDelta) {
        log(`  ↳ count shortfall ${countDelta} exceeds sampled drift; re-run backfill for ${entityType}`);
      }
    }

    const row = {
      entityType,
      table,
      mongoCount,
      supabaseCount: supaCount,
      countDelta,
      sampled: sampleDocs.length,
      missingInSupabase: missing.length,
      fieldMismatches: fieldDrift.length,
      repaired: queued,
      drift,
    };
    report.push(row);

    const icon = drift === 0 ? "✅" : "❌";
    log(
      `  ${icon} ${entityType.padEnd(18)} mongo=${String(mongoCount).padStart(6)}` +
      ` supabase=${String(supaCount).padStart(6)}` +
      ` missing=${String(missing.length).padStart(4)}` +
      ` fieldMismatch=${String(fieldDrift.length).padStart(4)}` +
      (queued ? ` repaired=${queued}` : "")
    );
    for (const f of fieldDrift.slice(0, 3)) {
      log(`       · ${f.column}: mongo=${String(f.mongo).slice(0, 40)} supabase=${String(f.supabase).slice(0, 40)}`);
    }
  }

  const durationMs = Date.now() - startedAt;
  const clean = totalDrift === 0;

  if (JSON_OUT) {
    console.log(JSON.stringify({
      op: "supabase.verify",
      mode: REPAIR ? "compare+repair" : "compare",
      clean,
      totalDrift,
      repaired,
      durationMs,
      report,
    }, null, 2));
  } else {
    log("─".repeat(60));
    log(clean
      ? `✅ VERIFIED — no drift detected across ${report.length} entity types`
      : `❌ DRIFT DETECTED — ${totalDrift} discrepancies${REPAIR ? `, ${repaired} re-queued` : " (run --repair to re-queue)"}`);
    log(`Duration: ${(durationMs / 1000).toFixed(1)}s`);
    log("─".repeat(60));
    if (!clean && !REPAIR) {
      log("Do NOT delete MongoDB data until this script reports VERIFIED.");
    }
  }

  await mongoose.disconnect();
  // Exit non-zero on drift so CI can gate on it.
  process.exit(clean ? 0 : 1);
})().catch(async (err) => {
  console.error("💥 verification failed:", err?.message || err);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});
