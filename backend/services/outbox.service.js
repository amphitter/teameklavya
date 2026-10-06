/**
 * Outbox service — enqueue, claim, apply, retry (Part 6, Phase 6 — §11)
 * ─────────────────────────────────────────────────────────────────────────────
 * ── Claiming is atomic; enqueueing is not (and that is documented) ──
 *
 * CLAIM uses `findOneAndUpdate` with a status guard, which MongoDB executes
 * as a single atomic document update. Two workers scanning the queue cannot
 * take the same entry: one transitions pending→processing and the other's
 * guarded update matches nothing. This is the part of the outbox that MUST be
 * atomic for correctness, and single-document atomicity is enough.
 *
 * ENQUEUE is a separate write from the business change. See
 * models/outbox.model.js for why we accept that and why reconciliation is the
 * backstop rather than an optimisation.
 *
 * ── Every consumer here is retry-safe ──
 * `apply()` upserts on the canonical id, so applying the same entry twice is
 * indistinguishable from applying it once. `delete` is likewise idempotent.
 * A crash mid-apply leaves the entry in `processing`; the requeue sweep picks
 * it up after its lease expires and it is applied again. There is no partial
 * state to unwind, because the target write is a single upsert.
 *
 * ── Backoff ──
 * Exponential with jitter. Jitter matters more than it looks: without it,
 * every entry that failed during a Supabase outage becomes retryable at the
 * same instant and the recovering database is hit by a synchronised thundering
 * herd — the classic way a brief upstream blip turns into a sustained one.
 */

"use strict";

const Outbox = require("../models/outbox.model");

/** Lease duration: a claimed entry not finished in time is retried. */
const LEASE_MS = Number(process.env.OUTBOX_LEASE_MS || 60_000);
const DEFAULT_MAX_ATTEMPTS = 8;
const BASE_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 15 * 60 * 1000;

/* ══ Enqueue ══════════════════════════════════════════════════════════════ */

/**
 * Record that something changed.
 *
 * Dedupe: if an identical PENDING entry already exists, this is a no-op. That
 * is not merely an efficiency — it is what stops a hot entity from generating
 * thousands of queue entries that all do the same thing, and it is safe
 * precisely because the consumer re-reads current state rather than replaying
 * a captured payload.
 *
 * Never throws: a failed enqueue must not fail the user's write. The change
 * will still reach Supabase via reconciliation.
 */
async function enqueue({ entityType, entityId, op = "upsert", source = "live" }) {
  if (!entityType || !entityId) return null;
  const dedupeKey = `${entityType}:${entityId}:${op}`;

  try {
    return await Outbox.findOneAndUpdate(
      { dedupeKey, status: "pending" },
      {
        $setOnInsert: {
          entityType,
          entityId: String(entityId),
          op,
          source,
          dedupeKey,
          status: "pending",
          attempts: 0,
          maxAttempts: DEFAULT_MAX_ATTEMPTS,
          availableAt: new Date(),
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  } catch (err) {
    // Duplicate-key race on the partial unique index: another writer inserted
    // the same pending entry between our check and our insert. Not an error.
    if (Number(err?.code) === 11000) return null;
    console.error(`[outbox] enqueue failed for ${dedupeKey}:`, err?.message);
    return null;
  }
}

/** Enqueue several changes. Order is irrelevant (see the model doc). */
async function enqueueMany(entries) {
  if (!Array.isArray(entries) || !entries.length) return 0;
  const results = await Promise.all(entries.map((e) => enqueue(e)));
  return results.filter(Boolean).length;
}

/* ══ Claim ════════════════════════════════════════════════════════════════ */

/**
 * Atomically claim up to `limit` entries.
 *
 * The status guard `status: "pending"` is inside the update filter, so the
 * transition pending→processing happens as one atomic document update. Two
 * concurrent claimers cannot take the same row — the loser's update matches
 * nothing. This is why the queue needs no lock (Phase 4 deliberately did not
 * add one here: a guarded update is atomic, free, and cannot deadlock).
 */
async function claimBatch(limit = 25, { leaseMs = LEASE_MS } = {}) {
  const now = new Date();
  const claimed = [];
  const size = Math.max(1, Math.min(Number(limit) || 25, 200));

  for (let i = 0; i < size; i++) {
    const entry = await Outbox.findOneAndUpdate(
      {
        status: "pending",
        availableAt: { $lte: now },
      },
      {
        $set: { status: "processing", lastAttemptAt: now },
        $inc: { attempts: 1 },
      },
      { new: true, sort: { availableAt: 1, createdAt: 1 } }
    );
    if (!entry) break;
    claimed.push(entry);
  }
  return claimed;
}

/** Recover entries whose processing lease has expired (worker died mid-apply). */
async function requeueStalled({ leaseMs = LEASE_MS } = {}) {
  const cutoff = new Date(Date.now() - leaseMs);
  const res = await Outbox.updateMany(
    { status: "processing", lastAttemptAt: { $lte: cutoff } },
    { $set: { status: "pending" } }
  );
  return res.modifiedCount || 0;
}

/* ══ Completion & failure ═════════════════════════════════════════════════ */

async function complete(entry) {
  await Outbox.updateOne(
    { _id: entry._id },
    {
      $set: {
        status: "done",
        processedAt: new Date(),
        lastError: null,
        // Clear the dedupe key so a FUTURE change to the same entity is not
        // blocked by this completed entry (the partial unique index applies
        // only while status is "pending", but clearing is belt-and-braces and
        // keeps the index small).
        dedupeKey: null,
      },
    }
  );
}

/**
 * Record a failure with exponential backoff + jitter.
 * After `maxAttempts` the entry is dead-lettered: kept, visible, and never
 * retried silently. Silent loss is the one outcome we refuse.
 */
async function fail(entry, err) {
  const attempts = entry.attempts || 1;
  const exhausted = attempts >= (entry.maxAttempts || DEFAULT_MAX_ATTEMPTS);

  const expo = Math.min(BASE_BACKOFF_MS * 2 ** (attempts - 1), MAX_BACKOFF_MS);
  // Full jitter: spread retries across the whole window rather than letting
  // them synchronise into a herd when the upstream recovers.
  const delay = Math.round(expo / 2 + Math.random() * (expo / 2));

  await Outbox.updateOne(
    { _id: entry._id },
    {
      $set: {
        status: exhausted ? "dead" : "pending",
        lastError: String(err?.message || err).slice(0, 400),
        lastAttemptAt: new Date(),
        ...(exhausted
          ? { processedAt: new Date() }
          : { availableAt: new Date(Date.now() + delay) }),
      },
    }
  );
  return { exhausted, retryInMs: exhausted ? null : delay };
}

/* ══ Backoff (exported for tests) ═════════════════════════════════════════ */

function backoffFor(attempts) {
  const expo = Math.min(BASE_BACKOFF_MS * 2 ** Math.max(0, attempts - 1), MAX_BACKOFF_MS);
  return Math.round(expo / 2 + Math.random() * (expo / 2));
}

/* ══ Stats (§16 dashboard) ════════════════════════════════════════════════ */

async function stats() {
  const [byStatus, oldestPending] = await Promise.all([
    Outbox.aggregate([
      { $group: { _id: "$status", n: { $sum: 1 } } },
    ]).catch(() => []),
    Outbox.findOne({ status: "pending" })
      .sort({ createdAt: 1 })
      .select("createdAt")
      .lean()
      .catch(() => null),
  ]);

  const counts = { pending: 0, processing: 0, done: 0, failed: 0, dead: 0 };
  for (const row of byStatus) counts[row._id] = row.n;

  return {
    ...counts,
    // Age of the oldest undelivered entry — the number that actually matters.
    // A large backlog is fine if it is draining; a small one is alarming if it
    // has been sitting for an hour.
    oldestPendingMs: oldestPending
      ? Date.now() - new Date(oldestPending.createdAt).getTime()
      : 0,
    leaseMs: LEASE_MS,
  };
}

module.exports = {
  Outbox,
  enqueue,
  enqueueMany,
  claimBatch,
  requeueStalled,
  complete,
  fail,
  backoffFor,
  stats,
  LEASE_MS,
  DEFAULT_MAX_ATTEMPTS,
};
