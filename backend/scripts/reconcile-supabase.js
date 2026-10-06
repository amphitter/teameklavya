#!/usr/bin/env node
/**
 * Reconciliation CLI (Part 7, Phase 1 — brief §2, §3, §4)
 * ─────────────────────────────────────────────────────────────────────────────
 * Detects and repairs MongoDB → Supabase drift.
 *
 *   node scripts/reconcile-supabase.js                    # DRY RUN (default)
 *   node scripts/reconcile-supabase.js --apply            # enqueue repairs
 *   node scripts/reconcile-supabase.js --entity=profile   # one entity type
 *   node scripts/reconcile-supabase.js --limit=500        # cap documents scanned
 *   node scripts/reconcile-supabase.js --json             # machine-readable
 *   node scripts/reconcile-supabase.js --reset-checkpoint # start from scratch
 *
 * ══ SAFETY PROPERTIES ══════════════════════════════════════════════════════
 *   • DRY RUN BY DEFAULT. Repairs require --apply.
 *   • REPAIR MEANS ENQUEUE, NEVER A DIRECT WRITE. The outbox consumer applies
 *     it, using the same code path as live sync — so what reconciliation
 *     fixes is exactly what the live path would have produced.
 *   • NO SOURCE DELETION. This script never deletes MongoDB data. There is no
 *     flag for it and no code path to it (§7).
 *   • AMBIGUOUS DRIFT IS REPORTED, NEVER REPAIRED (§6). Status/role/deleted_at
 *     differences are decisions, not synchronisation.
 *   • CHECKPOINTED AND BOUNDED (§3). Resumable; never loads a whole collection.
 *   • IDEMPOTENT (§4). A second run reports zero repairs.
 */

require("dotenv").config();

const mongoose = require("mongoose");

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const APPLY = flag("apply");
const JSON_OUT = flag("json");
const RESET = flag("reset-checkpoint");
const ONLY = value("entity", null);
const LIMIT = Number(value("limit", 2000));

const log = (...a) => { if (!JSON_OUT) console.log(...a); };

(async () => {
  if (!process.env.MONGO_URI) {
    console.error("FATAL: MONGO_URI is not set.");
    process.exit(1);
  }
  const { supabaseProvider } = require("../providers/supabase");
  if (!supabaseProvider().isConfigured()) {
    console.error("FATAL: Supabase is not configured.");
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI, {
    maxPoolSize: 2,
    serverSelectionTimeoutMS: 8000,
  });

  const recon = require("../services/reconciliation.service");
  const outboxService = require("../services/outbox.service");
  const { COLLECTIONS } = require("../services/social-sync.service");

  if (RESET) {
    const n = await recon.resetCheckpoints(ONLY);
    log(`Reset ${n} checkpoint(s)${ONLY ? ` for ${ONLY}` : ""}.`);
    if (!ONLY) {
      await mongoose.disconnect();
      return;
    }
  }

  const startedAt = Date.now();
  const targets = ONLY ? [ONLY] : Object.keys(COLLECTIONS);

  const perEntityLimit = Math.max(1, Math.floor(LIMIT / targets.length));
  const batchSize = Math.min(200, perEntityLimit);
  const maxBatches = Math.max(1, Math.ceil(perEntityLimit / batchSize));

  log("─".repeat(64));
  log(`Reconciliation — ${APPLY ? "APPLY (enqueue repairs)" : "DRY RUN (no writes)"}`);
  log(`Entities: ${targets.length}${ONLY ? ` (${ONLY})` : ""}   Cap: ${LIMIT} docs total`);
  log(`Batch: ${batchSize} × up to ${maxBatches} batches per entity`);
  log("─".repeat(64));

  const totals = recon.EMPTY_TOTALS();
  const results = [];

  for (const entityType of targets) {
    const r = await recon.reconcileEntity({
      entityType,
      batchSize,
      maxBatches,
      apply: APPLY,
    });
    results.push(r);
    Object.assign(totals, recon.sumTotals(totals, r));

    if (r.error) {
      log(`  ⚠️  ${entityType.padEnd(18)} ${r.error}`);
      continue;
    }

    const flagged = r.drifted + r.missing + r.deleted + r.ambiguous;
    const icon = flagged === 0 ? "✅" : "❌";
    log(
      `  ${icon} ${entityType.padEnd(18)}` +
      ` scanned=${String(r.scanned).padStart(5)}` +
      ` matched=${String(r.matched).padStart(5)}` +
      ` drifted=${String(r.drifted).padStart(4)}` +
      ` missing=${String(r.missing).padStart(4)}` +
      ` orphan=${String(r.deleted).padStart(4)}` +
      (r.ambiguous ? ` ambiguous=${r.ambiguous}` : "") +
      (APPLY ? ` repaired=${r.repaired}` : "")
    );
    for (const s of (r.samples || []).slice(0, 3)) {
      log(
        `       · [${s.kind}] ${s.column || "row"}  mongo=${trunc(s.mongo)}  supabase=${trunc(s.supabase)}`
      );
    }
  }

  /* ── Queue health (§5, §2) ─────────────────────────────────────────── */
  const q = await recon.queueHealth();

  const durationMs = Date.now() - startedAt;
  const clean = totals.drifted + totals.missing + totals.deleted === 0;

  if (JSON_OUT) {
    console.log(JSON.stringify({
      op: "supabase.reconcile",
      mode: APPLY ? "apply" : "dry-run",
      clean,
      durationMs,
      totals,
      queue: q,
      results,
    }, null, 2));
  } else {
    log("─".repeat(64));
    log("Outbox queue");
    log(`  backlog=${q.backlog}  processing=${q.processing}  retrying(>=3)=${q.retrying}  dead=${q.deadLettered}`);
    log(`  oldest pending: ${humanMs(q.oldestPendingMs)}   oldest dead-letter: ${humanMs(q.oldestDeadLetterMs)}`);
    log("─".repeat(64));
    log(
      `TOTAL  scanned=${totals.scanned}  matched=${totals.matched}  ` +
      `drifted=${totals.drifted}  missing=${totals.missing}  ` +
      `orphan=${totals.deleted}  ambiguous=${totals.ambiguous}` +
      (APPLY ? `  repaired=${totals.repaired}` : "")
    );
    log(
      clean
        ? "✅ NO DRIFT across the scanned window"
        : `❌ DRIFT DETECTED${APPLY ? ` — ${totals.repaired} repair(s) enqueued` : " — run with --apply to repair"}`
    );
    if (!APPLY && !clean) {
      log("   Repairs are ENQUEUED, not written directly — drain the outbox after --apply.");
    }
    log(`Duration: ${(durationMs / 1000).toFixed(1)}s`);
    log("─".repeat(64));
  }

  await mongoose.disconnect();
  // Non-zero on drift so this can gate a scheduled job or CI step.
  process.exit(clean ? 0 : 1);
})().catch(async (err) => {
  console.error("💥 reconciliation failed:", err?.message || err);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});

function trunc(v) {
  return String(v === null || v === undefined ? "null" : v).slice(0, 40);
}

function humanMs(ms) {
  if (!ms) return "none";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  return `${(s / 3600).toFixed(1)}h`;
}
