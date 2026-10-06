/**
 * Outbox (Part 6, Phase 6 — brief §11)
 * ─────────────────────────────────────────────────────────────────────────────
 * The transactional outbox is how EventHub propagates a write from MongoDB to
 * Supabase WITHOUT a distributed transaction.
 *
 * §11 forbids distributed transactions between MongoDB and Supabase, and it is
 * right to: there is no commit protocol spanning the two, so a "transaction"
 * across them would be a fiction. The outbox replaces it with something that
 * actually holds:
 *
 *   AT-MOST-ONCE becomes AT-LEAST-ONCE  → a change is published at least once
 *   AT-LEAST-ONCE + IDEMPOTENCE = EXACTLY-ONCE EFFECT  → replaying it is a
 *   no-op, because every consumer upserts on the canonical id.
 *
 * ── The design decision that matters: the entry holds a REFERENCE, not a COPY ──
 * A textbook outbox serialises the changed row into the outbox entry. We do
 * not. An entry stores only `{ entityType, entityId, op }` and the consumer
 * re-reads the current document from MongoDB before writing.
 *
 * Why:
 *   1. A copied payload goes stale. If entry A (rename) and entry B (avatar
 *      change) are queued and B is applied first, a payload-carrying A would
 *      overwrite the new avatar with its snapshot of the old one. Re-reading
 *      makes ordering irrelevant — arguably the single most valuable property
 *      here, because we cannot guarantee ordering across workers.
 *   2. It makes retry trivially correct. Re-processing an entry re-reads
 *      reality rather than re-applying a remembered past.
 *   3. Entries stay tiny, which matters on a 512 MB MongoDB free tier.
 *
 * The cost is one extra read per entry at apply time. That is a good trade.
 *
 * ── Honest limitation: we do NOT have atomic enqueue ──
 * Writing the business document and the outbox entry are two separate writes.
 * This codebase uses no MongoDB multi-document transactions anywhere (they
 * need a replica set and add operational weight we do not carry), so a crash
 * between the two writes can lose an entry.
 *
 * We do not pretend otherwise. Reconciliation (`scripts/verify-supabase.js
 * --repair`) is therefore a CORRECTNESS REQUIREMENT, not a nice-to-have: it
 * scans for entities present in MongoDB but missing or divergent in Supabase
 * and re-enqueues them. The outbox provides prompt propagation; reconciliation
 * provides the guarantee.
 */

"use strict";

const mongoose = require("mongoose");

const ENTITY_TYPES = [
  "profile", "follow", "block",
  "organization", "org_member", "org_follow",
  "post", "post_media", "comment", "reaction", "saved_post",
  "community", "community_member", "community_claim",
  "conversation", "message",
  "notification", "report", "achievement", "event_interest",
];

const OPS = ["upsert", "delete"];

const STATUSES = ["pending", "processing", "done", "failed", "dead"];

const outboxSchema = new mongoose.Schema(
  {
    /** What changed. */
    entityType: {
      type: String,
      required: true,
      enum: ENTITY_TYPES,
    },
    /**
     * The canonical id — the EventHub id (§9). For a profile this is the user
     * id; for everything else it is the Mongo `_id` of the source document,
     * which is what Phase 6's backfill uses as the Supabase key too.
     */
    entityId: {
      type: String,
      required: true,
    },
    op: {
      type: String,
      required: true,
      enum: OPS,
      default: "upsert",
    },

    status: {
      type: String,
      required: true,
      enum: STATUSES,
      default: "pending",
    },

    /** Delivery bookkeeping. */
    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 8 },
    availableAt: { type: Date, default: () => new Date() }, // backoff: not before
    lastError: { type: String, default: null },
    lastAttemptAt: { type: Date, default: null },
    processedAt: { type: Date, default: null },

    /**
     * Where this entry came from. Recorded so reconciliation can tell a
     * backfill entry from a live write when reading the queue.
     */
    source: {
      type: String,
      enum: ["live", "backfill", "reconcile"],
      default: "live",
    },

    /**
     * Optional dedupe key. Two live writes to the same entity in quick
     * succession would otherwise queue two entries that do the same thing.
     * Not unique — see the partial index below, which only dedupes PENDING
     * work, so a completed entry never blocks a genuinely new change.
     */
    dedupeKey: { type: String, default: null },
  },
  { timestamps: true }
);

/* ── Indexes ─────────────────────────────────────────────────────────────── */

// The consumer's queue scan: oldest claimable work first.
outboxSchema.index({ status: 1, availableAt: 1, createdAt: 1 });

// Operational visibility: what is stuck.
outboxSchema.index({ status: 1, attempts: -1, updatedAt: -1 });

// Lookup by entity (used by tests, ops and debugging).
outboxSchema.index({ entityType: 1, entityId: 1 });

// Collapse duplicate pending work for the same entity+op. Partial so that
// only live PENDING entries participate — a processed entry must never block
// a later, genuine change to the same entity.
outboxSchema.index(
  { dedupeKey: 1 },
  {
    unique: true,
    partialFilterExpression: {
      dedupeKey: { $ne: null },
      status: "pending",
    },
  }
);

// Housekeeping: completed entries are swept by the retention policy, and the
// sweep needs to find old terminal rows without scanning the live queue.
outboxSchema.index({ status: 1, processedAt: 1 });

const Outbox =
  mongoose.models.Outbox || mongoose.model("Outbox", outboxSchema);

module.exports = Outbox;
module.exports.ENTITY_TYPES = ENTITY_TYPES;
module.exports.OPS = OPS;
module.exports.STATUSES = STATUSES;
