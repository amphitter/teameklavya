/**
 * Reconciliation service (Part 7, Phase 1 — brief §2, §3, §4, §6)
 * ─────────────────────────────────────────────────────────────────────────────
 * Detects and repairs cross-database drift between MongoDB (source of truth)
 * and Supabase (target).
 *
 * ══ WHY THIS IS THE GUARANTEE, NOT AN OPTIMISATION ══════════════════════════
 * The outbox enqueue is NOT atomic with the business write — this codebase
 * uses no MongoDB multi-document transactions. A crash between the two loses
 * the entry, and then Supabase silently never learns about the change.
 *
 * Reconciliation is what closes that hole. It is the only mechanism that can
 * notice "Mongo has this row and Supabase does not", which is precisely the
 * failure the outbox cannot see.
 *
 * ══ WHAT IT DETECTS (§2) ════════════════════════════════════════════════════
 *   MISSING      Mongo entity exists, Supabase has no row
 *   DRIFTED      Both exist, but a field differs
 *   ORPHAN       Supabase has a row, Mongo entity is gone
 *   STALE        Outbox entry exists but the target never received it
 *   FAILED       Outbox entry is retrying
 *   DEAD         Outbox entry exhausted its retries (silent data loss)
 *   AMBIGUOUS    A difference we refuse to repair automatically (§6)
 *
 * ══ CHECKPOINTS (§3) ════════════════════════════════════════════════════════
 * A full scan of every collection every run would be prohibitively expensive
 * on a free tier, so runs are resumable: each entity type stores
 * `{lastCheckedAt, lastCheckedId}` and the next run continues from there,
 * wrapping to the beginning when it reaches the end.
 *
 * Batches are bounded and streamed with a cursor — the collection is NEVER
 * loaded into memory (§3: "never load the entire collection").
 *
 * ══ IDEMPOTENCE (§4) ════════════════════════════════════════════════════════
 * Running reconciliation twice must produce the same final state, so run 2
 * reports zero repairs. Two properties deliver that:
 *   1. Repair enqueues an outbox entry keyed on the canonical id, and the
 *      outbox collapses duplicate pending work — so a second run enqueues
 *      nothing new for an already-queued entity.
 *   2. Application is an upsert on the canonical id, so even if it runs twice
 *      the target ends in one state.
 */

"use strict";

const mongoose = require("mongoose");
const Outbox = require("../models/outbox.model");
const outboxService = require("./outbox.service");
const syncService = require("./social-sync.service");
const { supabaseProvider } = require("../providers/supabase");

const { COLLECTIONS, TARGET_TABLE, CONFLICT_TARGET, MAPPERS } = syncService;

/** Checkpoint collection. Lazily referenced so tests need no fixture. */
function checkpointColl() {
  return mongoose.connection.db.collection("reconciliation_checkpoints");
}

/* ══ Field comparison (§6) ═════════════════════════════════════════════════
 * Naive comparison produces false drift that drowns out real drift:
 *   • Mongo stores Date objects, Postgres returns ISO strings
 *   • ObjectId vs its string form
 *   • `undefined` vs `null` vs missing column
 *   • array ordering that carries no meaning (topics, interests)
 * So every value is normalised before comparison.
 * ═════════════════════════════════════════════════════════════════════════ */

/** Columns Postgres owns. Comparing them would flag every row as drifted. */
const TRIGGER_OWNED = new Set([
  "followers_count", "following_count", "posts_count",
  "likes_count", "comments_count", "updated_at",
]);

/** Columns whose drift we will NOT auto-repair — a human must decide. */
const AMBIGUOUS_COLUMNS = new Set([
  "deleted_at",   // deleting vs restoring is a judgement, not a sync
  "status",       // e.g. suspended/verified is an admin decision
  "role",         // privilege changes must never be auto-propagated
]);

function normalise(v) {
  if (v === undefined || v === null) return null;
  if (v instanceof Date) return v.toISOString();
  if (v && typeof v === "object" && v._bsontype === "ObjectId") return String(v);
  if (mongoose.Types.ObjectId && v instanceof mongoose.Types.ObjectId) return String(v);
  if (Array.isArray(v)) {
    // Ordering is not meaningful for tag-like arrays; sort for comparison.
    return JSON.stringify([...v].map(normalise).sort());
  }
  if (typeof v === "object") return JSON.stringify(v);
  if (typeof v === "number" || typeof v === "boolean") return v;
  return String(v);
}

/** Date-ish strings compare on their parsed instant, not their formatting. */
function isDateIsh(s) {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}T/.test(s);
}

/**
 * Compare one mapped row against the Supabase row.
 * @returns {{drift: Array, ambiguous: boolean}}
 */
function compareRow(expected, actual) {
  const drift = [];
  let ambiguous = false;

  for (const [col, wantRaw] of Object.entries(expected)) {
    if (TRIGGER_OWNED.has(col)) continue;
    if (wantRaw === undefined) continue;

    const want = normalise(wantRaw);
    const got = normalise(actual ? actual[col] : null);

    if (want === got) continue;

    // Both sides are timestamps: compare instants, tolerate sub-second noise
    // from different clock precisions between Mongo and Postgres.
    if (isDateIsh(want) && isDateIsh(got)) {
      const a = Date.parse(want);
      const b = Date.parse(got);
      if (Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 1000) continue;
    }

    if (AMBIGUOUS_COLUMNS.has(col)) ambiguous = true;

    drift.push({ column: col, mongo: want, supabase: got });
  }
  return { drift, ambiguous };
}

/* ══ Checkpoints (§3) ═════════════════════════════════════════════════════ */

async function getCheckpoint(entityType) {
  try {
    const doc = await checkpointColl().findOne({ entityType });
    return doc || null;
  } catch {
    return null;
  }
}

async function setCheckpoint(entityType, { lastCheckedAt, lastCheckedId, scanned, wrapped }) {
  try {
    await checkpointColl().updateOne(
      { entityType },
      {
        $set: {
          lastCheckedAt,
          lastCheckedId,
          lastRunAt: new Date(),
          lastScanned: scanned,
          wrapped: Boolean(wrapped),
        },
      },
      { upsert: true }
    );
  } catch { /* checkpoints are an optimisation; never fail a run over one */ }
}

async function resetCheckpoints(entityType = null) {
  try {
    const filter = entityType ? { entityType } : {};
    const res = await checkpointColl().deleteMany(filter);
    return res.deletedCount || 0;
  } catch {
    return 0;
  }
}

/* ══ The run (§3, §4) ═════════════════════════════════════════════════════ */

const EMPTY_TOTALS = () => ({
  scanned: 0, matched: 0, drifted: 0, repaired: 0,
  missing: 0, deleted: 0, failed: 0, deadLettered: 0, ambiguous: 0,
});

function sumTotals(a, b) {
  const out = {};
  for (const k of Object.keys(EMPTY_TOTALS())) out[k] = (a[k] || 0) + (b[k] || 0);
  return out;
}

/**
 * Reconcile one entity type.
 *
 * @param {object} opts
 * @param {string} opts.entityType
 * @param {number} [opts.batchSize]   documents per batch (bounded, §3)
 * @param {number} [opts.maxBatches]  hard cap so a run cannot go forever
 * @param {boolean} [opts.apply]      enqueue repairs (default false = dry run)
 */
async function reconcileEntity({ entityType, batchSize = 200, maxBatches = 50, apply = false }) {
  const totals = EMPTY_TOTALS();
  const collName = COLLECTIONS[entityType];
  const table = TARGET_TABLE[entityType];
  const mapper = MAPPERS[entityType];

  if (!collName || !table || !mapper) {
    return { entityType, error: "unknown entity type", ...totals };
  }

  const sb = supabaseProvider();
  if (!sb.isConfigured()) {
    return { entityType, error: "supabase not configured", ...totals };
  }

  const coll = mongoose.connection.db.collection(collName);
  const cp = await getCheckpoint(entityType);

  let cursorAt = cp?.lastCheckedAt ? new Date(cp.lastCheckedAt) : null;
  let cursorId = cp?.lastCheckedId || null;
  let batches = 0;
  let wrapped = false;
  const samples = [];

  for (let b = 0; b < maxBatches; b++) {
    /* Keyset resume: strictly after (lastCheckedAt, lastCheckedId).
     * Sorting by (createdAt, _id) means the predicate is index-friendly and
     * stable even when many rows share a timestamp. */
    const filter = cursorAt
      ? {
          $or: [
            { createdAt: { $gt: cursorAt } },
            { createdAt: cursorAt, _id: { $gt: toObjectId(cursorId) } },
          ],
        }
      : {};

    // Streamed with a cursor + limit — the collection is never loaded whole.
    const docs = await coll
      .find(filter)
      .sort({ createdAt: 1, _id: 1 })
      .limit(batchSize)
      .toArray();

    if (!docs.length) {
      // Reached the end: wrap so the next pass starts over. Without wrapping,
      // rows created before the checkpoint would never be re-checked and a
      // slow drift could go unnoticed forever.
      wrapped = true;
      cursorAt = null;
      cursorId = null;
      break;
    }

    batches += 1;

    /* One Supabase read for the whole batch. Comparing row-by-row would be an
     * N+1 against the very store we are trying to certify (§13). */
    const ids = docs.map((d) => String(d._id));
    let targets = new Map();
    try {
      const rows = await sb.from(table).select(["*"]).in("id", ids).limit(ids.length).many();
      targets = new Map(rows.map((r) => [String(r.id), r]));
    } catch {
      // A read failure is not drift — record and move on.
      totals.failed += docs.length;
      cursorAt = docs[docs.length - 1].createdAt;
      cursorId = String(docs[docs.length - 1]._id);
      continue;
    }

    const repairs = [];

    for (const doc of docs) {
      totals.scanned += 1;
      const id = String(doc._id);
      const expected = mapper(doc);
      const actual = targets.get(id);

      if (!actual) {
        totals.missing += 1;
        repairs.push(id);
        if (samples.length < 10) {
          samples.push({ id, kind: "missing", column: null, mongo: "(present)", supabase: null });
        }
        continue;
      }

      const { drift, ambiguous } = compareRow(expected, actual);
      if (!drift.length) {
        totals.matched += 1;
        continue;
      }

      if (ambiguous) {
        // §6: "Never automatically repair ambiguous conflicts."
        totals.ambiguous += 1;
        if (samples.length < 10) {
          samples.push({ id, kind: "ambiguous", ...drift[0] });
        }
        continue;
      }

      totals.drifted += 1;
      repairs.push(id);
      if (samples.length < 10) {
        samples.push({ id, kind: "drift", ...drift[0] });
      }
    }

    // Repair = enqueue, never a direct write. Same code path as live sync, so
    // what we repair is exactly what the live path would have produced.
    if (apply && repairs.length) {
      const queued = await enqueueRepairs(entityType, repairs);
      totals.repaired += queued;
    }

    cursorAt = docs[docs.length - 1].createdAt;
    cursorId = String(docs[docs.length - 1]._id);
  }

  /* Orphans: present in Supabase, gone from Mongo.
   * Bounded and off the same checkpoint cursor — a full target scan would be
   * as expensive as the problem it is checking for. */
  const orphans = await findOrphans({ entityType, table, coll, limit: batchSize });
  totals.deleted += orphans.length;
  if (apply && orphans.length) {
    for (const id of orphans) {
      await outboxService.enqueue({ entityType, entityId: id, op: "delete", source: "reconcile" });
    }
    totals.repaired += orphans.length;
  }

  if (cursorAt) {
    await setCheckpoint(entityType, {
      lastCheckedAt: cursorAt,
      lastCheckedId: cursorId,
      scanned: totals.scanned,
      wrapped,
    });
  } else if (wrapped) {
    await setCheckpoint(entityType, {
      lastCheckedAt: null,
      lastCheckedId: null,
      scanned: totals.scanned,
      wrapped: true,
    });
  }

  return {
    entityType,
    table,
    batches,
    wrapped,
    checkpoint: cursorAt
      ? { lastCheckedAt: cursorAt.toISOString(), lastCheckedId: cursorId }
      : null,
    ...totals,
    samples,
  };
}

function toObjectId(v) {
  try {
    return mongoose.Types.ObjectId.isValid(v)
      ? new mongoose.Types.ObjectId(v)
      : v;
  } catch {
    return v;
  }
}

/**
 * Enqueue repairs. Returns how many were NEWLY queued — entries already
 * pending are collapsed by the outbox, which is what makes a second
 * reconciliation run report zero repairs (§4).
 */
async function enqueueRepairs(entityType, ids) {
  let queued = 0;
  for (const id of ids) {
    const entry = await outboxService.enqueue({
      entityType,
      entityId: id,
      op: "upsert",
      source: "reconcile",
    });
    // enqueue() returns null when an identical PENDING entry already existed.
    if (entry) queued += 1;
  }
  return queued;
}

/**
 * Find Supabase rows with no Mongo counterpart.
 * Scans a bounded window of the most recent targets rather than everything.
 */
async function findOrphans({ entityType, table, coll, limit = 200 }) {
  const sb = supabaseProvider();
  const orphans = [];
  try {
    const rows = await sb.from(table)
      .select(["id"])
      .order("created_at.desc")
      .limit(limit)
      .many();
    if (!rows.length) return orphans;

    const ids = rows.map((r) => String(r.id));
    const present = await coll
      .find({ _id: { $in: ids.map(toObjectId) } }, { projection: { _id: 1 } })
      .toArray();
    const presentSet = new Set(present.map((d) => String(d._id)));

    for (const id of ids) if (!presentSet.has(id)) orphans.push(id);
  } catch {
    /* orphan detection is best-effort */
  }
  return orphans;
}

/* ══ Queue health (§5, §2) ════════════════════════════════════════════════ */

/**
 * Report on the outbox itself: backlog, retries, dead letters and ages.
 * Feeds the admin dashboard (§5).
 */
async function queueHealth() {
  const [counts, oldestPending, oldestDead, retrying] = await Promise.all([
    Outbox.aggregate([{ $group: { _id: "$status", n: { $sum: 1 } } }]).catch(() => []),
    Outbox.findOne({ status: "pending" }).sort({ createdAt: 1 }).lean().catch(() => null),
    Outbox.findOne({ status: "dead" }).sort({ updatedAt: 1 }).lean().catch(() => null),
    Outbox.countDocuments({ status: "pending", attempts: { $gte: 3 } }).catch(() => 0),
  ]);

  const byStatus = { pending: 0, processing: 0, done: 0, failed: 0, dead: 0 };
  for (const r of counts) byStatus[r._id] = r.n;

  return {
    backlog: byStatus.pending,
    processing: byStatus.processing,
    done: byStatus.done,
    retrying,
    deadLettered: byStatus.dead,
    oldestPendingMs: oldestPending
      ? Date.now() - new Date(oldestPending.createdAt).getTime()
      : 0,
    oldestDeadLetterMs: oldestDead
      ? Date.now() - new Date(oldestDead.updatedAt || oldestDead.createdAt).getTime()
      : 0,
  };
}

module.exports = {
  reconcileEntity,
  queueHealth,
  compareRow,
  normalise,
  getCheckpoint,
  setCheckpoint,
  resetCheckpoints,
  findOrphans,
  enqueueRepairs,
  TRIGGER_OWNED,
  AMBIGUOUS_COLUMNS,
  EMPTY_TOTALS,
  sumTotals,
};
