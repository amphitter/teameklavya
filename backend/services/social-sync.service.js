/**
 * Social sync — the outbox consumer (Part 6, Phase 6 — §10, §11)
 * ─────────────────────────────────────────────────────────────────────────────
 * Takes an outbox entry, re-reads the entity from MongoDB, and upserts it into
 * Supabase.
 *
 * ── Why it RE-READS instead of trusting the entry ──
 * The entry carries only `{entityType, entityId, op}`. Every apply re-reads
 * the source document. That single choice buys three things:
 *
 *   1. ORDERING DOES NOT MATTER. Two queued changes to one entity can be
 *      applied in any order and land on the same final state. With a copied
 *      payload, out-of-order delivery silently resurrects stale fields — a bug
 *      that only appears under load and is near-impossible to reproduce.
 *   2. RETRY IS ALWAYS CORRECT. Re-processing re-reads reality.
 *   3. A DELETED SOURCE IS HANDLED. If the Mongo row is gone by apply time,
 *      the correct action is to remove it from Supabase, not to write
 *      something remembered from before the delete.
 *
 * ── Idempotence, concretely ──
 * Every target write is an upsert on the canonical id (Supabase
 * `on_conflict=id`), so applying an entry N times has the same effect as
 * applying it once. That is what turns at-least-once delivery into
 * exactly-once effect, and it is why §11's "no distributed transactions"
 * is survivable.
 *
 * ── Cutover is a flag, not a rewrite (§10) ──
 * `SYNC_ENABLED` gates whether entries are APPLIED. While it is off, entries
 * still accumulate (and are still counted), so turning the flag on does not
 * lose anything written beforehand — the backlog replays in order of age.
 * Enqueueing is always safe; only applying is gated.
 */

"use strict";

const mongoose = require("mongoose");

const OutboxService = require("./outbox.service");
const { supabaseProvider } = require("../providers/supabase");

/* ══ Source-of-truth readers ═══════════════════════════════════════════════
 * Each entry says HOW to read the current Mongo document. Deliberately
 * defined as data: backfill and live sync then share one code path, which
 * means the backfill cannot drift from what the live path would have done.
 * That equivalence is exactly what makes dual-read verification meaningful.
 * ═══════════════════════════════════════════════════════════════════════════ */

const COLLECTIONS = {
  profile: "users",
  follow: "follows",
  block: "blocks",
  organization: "organizations",
  org_follow: "orgfollows",
  community: "communities",
  community_member: "communitymembers",
  community_claim: "communityclaims",
  post: "posts",
  comment: "comments",
  reaction: "reactions",
  saved_post: "saves",
  conversation: "conversations",
  message: "messages",
  notification: "notifications",
  report: "reports",
  achievement: "userachievements",
  event_interest: "eventinterests",
};

/** Where each entity lands in Supabase. */
const TARGET_TABLE = {
  profile: "profiles",
  follow: "follows",
  block: "blocks",
  organization: "organizations",
  org_follow: "org_follows",
  community: "communities",
  community_member: "community_members",
  community_claim: "community_claims",
  post: "posts",
  comment: "comments",
  reaction: "reactions",
  saved_post: "saved_posts",
  conversation: "conversations",
  message: "messages",
  notification: "notifications",
  report: "reports",
  achievement: "user_achievements",
  event_interest: "event_interests",
};

/** The conflict target for the upsert — the natural key in each table. */
const CONFLICT_TARGET = {
  profiles: "id",
  follows: "follower_id,followee_id",
  blocks: "blocker_id,blocked_id",
  organizations: "id",
  org_follows: "user_id,organization_id",
  communities: "id",
  community_members: "community_id,user_id",
  community_claims: "community_id,organization_id",
  posts: "id",
  comments: "id",
  reactions: "post_id,user_id",
  saved_posts: "post_id,user_id",
  conversations: "id",
  messages: "id",
  notifications: "id",
  reports: "target_type,target_id,reporter_id",
  user_achievements: "user_id,code",
  event_interests: "event_id,user_id",
};

const oid = (v) => (v == null ? null : String(v));

/**
 * Translate a Mongo document into a Supabase row for one entity type.
 *
 * §9: `profiles.id` is the EventHub user id, so the Mongo `_id` becomes the
 * Supabase primary key directly — no mapping, no second identity.
 *
 * Timestamps are preserved from the source so ordering and "created_at" are
 * identical in both stores; a backfill that stamped everything `now()` would
 * destroy every feed's chronology and make dual-read comparison useless.
 */
const MAPPERS = {
  profile: (d) => ({
    id: oid(d._id),
    email: d.email ?? null,
    username: d.username ?? null,
    first_name: d.firstName ?? "",
    last_name: d.lastName ?? "",
    avatar_url: d.avatarUrl ?? d.profile?.avatarUrl ?? null,
    bio: d.bio ?? d.profile?.bio ?? null,
    institution: d.profile?.institution ?? null,
    course: d.profile?.course ?? null,
    year: d.profile?.year ?? null,
    location: d.profile?.location ?? null,
    interests: Array.isArray(d.profile?.interests) ? d.profile.interests : [],
    role: d.role ?? "user",
    profile_visibility: d.privacy?.profileVisibility ?? "public",
    allow_messages_from: d.privacy?.allowMessagesFrom ?? "everyone",
    // Counts are NOT copied: they are maintained by trigger in Postgres from
    // the rows themselves, so copying Mongo's counters would seed a value that
    // could disagree with the rows actually present.
    created_at: d.createdAt ?? undefined,
    deleted_at: d.deletedAt ?? null,
  }),
  follow: (d) => ({
    id: oid(d._id),
    follower_id: oid(d.follower),
    followee_id: oid(d.followee),
    status: d.status ?? "accepted",
    created_at: d.createdAt ?? undefined,
  }),
  block: (d) => ({
    id: oid(d._id),
    blocker_id: oid(d.blocker),
    blocked_id: oid(d.blocked),
    created_at: d.createdAt ?? undefined,
  }),
  organization: (d) => ({
    id: oid(d._id),
    name: d.name ?? null,
    slug: d.slug ?? null,
    description: d.description ?? null,
    logo_url: d.logoUrl ?? null,
    cover_url: d.coverUrl ?? null,
    website: d.website ?? null,
    created_by: oid(d.createdBy),
    verified_at: d.verifiedAt ?? null,
    created_at: d.createdAt ?? undefined,
    deleted_at: d.deletedAt ?? null,
  }),
  org_follow: (d) => ({
    id: oid(d._id),
    user_id: oid(d.user),
    organization_id: oid(d.organization),
    created_at: d.createdAt ?? undefined,
  }),
  community: (d) => ({
    id: oid(d._id),
    name: d.name ?? null,
    description: d.description ?? null,
    avatar_url: d.avatarUrl ?? null,
    join_policy: d.joinPolicy ?? "open",
    status: d.status ?? "unverified",
    affiliation_domain: d.affiliationDomain ?? null,
    official_organization: oid(d.organization),
    suspended_from: d.suspendedFrom ?? null,
    created_by: oid(d.createdBy),
    created_at: d.createdAt ?? undefined,
    deleted_at: d.deletedAt ?? null,
  }),
  community_member: (d) => ({
    id: oid(d._id),
    community_id: oid(d.community),
    user_id: oid(d.user),
    role: d.role ?? "member",
    status: d.status ?? "active",
    invited_by: oid(d.invitedBy),
    created_at: d.createdAt ?? undefined,
  }),
  community_claim: (d) => ({
    id: oid(d._id),
    community_id: oid(d.community),
    organization_id: oid(d.organization),
    claimant_id: oid(d.claimant),
    proof: d.proof ?? null,
    status: d.status ?? "pending",
    resolution: d.resolution ?? null,
    review_note: d.reviewNote ?? null,
    reviewed_by: oid(d.reviewedBy),
    reviewed_at: d.reviewedAt ?? null,
    created_at: d.createdAt ?? undefined,
  }),
  post: (d) => ({
    id: oid(d._id),
    author_id: oid(d.author),
    content: d.content ?? "",
    status: d.status ?? "published",
    visibility: d.visibility ?? "public",
    topics: Array.isArray(d.topics) ? d.topics : [],
    event_id: oid(d.event),
    organization_id: oid(d.organization),
    community_id: oid(d.community),
    created_at: d.createdAt ?? undefined,
    deleted_at: d.deletedAt ?? null,
  }),
  comment: (d) => ({
    id: oid(d._id),
    post_id: oid(d.post),
    author_id: oid(d.author),
    content: d.content ?? "",
    removed_by: oid(d.removedBy),
    created_at: d.createdAt ?? undefined,
    deleted_at: d.deletedAt ?? null,
  }),
  reaction: (d) => ({
    id: oid(d._id),
    post_id: oid(d.post),
    user_id: oid(d.user),
    type: d.type ?? "like",
    created_at: d.createdAt ?? undefined,
  }),
  saved_post: (d) => ({
    id: oid(d._id),
    post_id: oid(d.post),
    user_id: oid(d.user),
    created_at: d.createdAt ?? undefined,
  }),
  conversation: (d) => ({
    id: oid(d._id),
    // Conversations are exactly two participants (validated in the Mongo model).
    participant_a: oid(d.participants?.[0]),
    participant_b: oid(d.participants?.[1]),
    created_at: d.createdAt ?? undefined,
  }),
  message: (d) => ({
    id: oid(d._id),
    conversation_id: oid(d.conversation),
    sender_id: oid(d.sender),
    content: d.content ?? "",
    read_at: d.readAt ?? null,
    created_at: d.createdAt ?? undefined,
  }),
  notification: (d) => ({
    id: oid(d._id),
    user_id: oid(d.user),
    actor_id: oid(d.actor),
    type: d.type ?? null,
    read: Boolean(d.read),
    post_id: oid(d.post),
    event_id: oid(d.event),
    organization_id: oid(d.organization),
    community_id: oid(d.community),
    conversation_id: oid(d.conversation),
    created_at: d.createdAt ?? undefined,
  }),
  report: (d) => ({
    id: oid(d._id),
    reporter_id: oid(d.reporter),
    target_type: d.targetType ?? null,
    target_id: oid(d.targetId),
    reason: d.reason ?? null,
    details: d.details ?? null,
    snapshot: d.snapshot ?? null,
    status: d.status ?? "open",
    resolution: d.resolution ?? null,
    resolved_by: oid(d.resolvedBy),
    resolved_at: d.resolvedAt ?? null,
    created_at: d.createdAt ?? undefined,
  }),
  achievement: (d) => ({
    id: oid(d._id),
    user_id: oid(d.user),
    code: d.code ?? null,
    unlocked_at: d.unlockedAt ?? d.createdAt ?? undefined,
  }),
  event_interest: (d) => ({
    id: oid(d._id),
    event_id: oid(d.event),
    user_id: oid(d.user),
    created_at: d.createdAt ?? undefined,
  }),
};

/* ══ Application ══════════════════════════════════════════════════════════ */

function mongoCollection(entityType) {
  const name = COLLECTIONS[entityType];
  if (!name) return null;
  const db = mongoose.connection.db;
  return db ? db.collection(name) : null;
}

function cleanRow(row) {
  // Drop undefined so we never send a null over a column that has a default.
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/**
 * Apply one outbox entry. NEVER throws — the caller decides retry policy from
 * the returned shape, and a throw inside a drain loop would abort the batch.
 *
 * @returns {Promise<{ok: boolean, skipped?: boolean, reason?: string, error?: string}>}
 */
async function applyEntry(entry) {
  const sb = supabaseProvider();
  if (!sb.isConfigured()) {
    return { ok: false, reason: "not-configured", error: "Supabase is not configured" };
  }

  const table = TARGET_TABLE[entry.entityType];
  const mapper = MAPPERS[entry.entityType];
  const coll = mongoCollection(entry.entityType);

  if (!table || !mapper || !coll) {
    return { ok: false, reason: "unknown-entity", error: `No mapping for ${entry.entityType}` };
  }

  // ── Re-read the CURRENT document. This is the whole point. ──
  let doc = null;
  try {
    const _id = mongoose.Types.ObjectId.isValid(entry.entityId)
      ? new mongoose.Types.ObjectId(entry.entityId)
      : entry.entityId;
    doc = await coll.findOne({ _id });
  } catch (err) {
    return { ok: false, reason: "read-failed", error: String(err?.message || err) };
  }

  try {
    // A delete op, or a source row that has since vanished: remove the target.
    // Both are idempotent — deleting an absent row is a no-op.
    if (entry.op === "delete" || !doc) {
      const q = sb.from(table);
      q.eq("id", String(entry.entityId));
      await q.delete({ returning: false });
      return { ok: true, skipped: !doc && entry.op === "upsert", reason: !doc ? "source-missing" : undefined };
    }

    const row = cleanRow(mapper(doc));
    await sb.from(table).insert(row, {
      upsert: true,
      onConflict: CONFLICT_TARGET[table] || "id",
      returning: false,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: "apply-failed", error: String(err?.message || err) };
  }
}

/**
 * Whether entries are actually APPLIED.
 *
 * Off by default (§10: nothing is cut over without verification). While off,
 * the drain loop still reports what it WOULD have done, and entries stay
 * pending — so enabling the flag replays the backlog rather than losing it.
 */
function isSyncEnabled() {
  return String(process.env.SYNC_ENABLED || "").toLowerCase() === "true";
}

/**
 * Process up to `limit` entries.
 *
 * Bounded by count AND by wall-clock so a drain cannot run forever against a
 * large backlog and starve whatever scheduled it (§68: heavy work is a
 * standalone process, never a request side effect).
 */
async function drain({ limit = 25, maxMs = 5_000 } = {}) {
  const startedAt = Date.now();
  const report = { claimed: 0, applied: 0, skipped: 0, failed: 0, deadLettered: 0, requeued: 0 };

  report.requeued = await OutboxService.requeueStalled().catch(() => 0);

  const entries = await OutboxService.claimBatch(limit).catch(() => []);
  report.claimed = entries.length;

  for (const entry of entries) {
    if (Date.now() - startedAt > maxMs) {
      // Put it back rather than leaving it leased until the lease expires.
      await require("../models/outbox.model").updateOne(
        { _id: entry._id },
        { $set: { status: "pending", lastAttemptAt: null } }
      );
      continue;
    }

    if (!isSyncEnabled()) {
      report.skipped += 1;
      await require("../models/outbox.model").updateOne(
        { _id: entry._id },
        { $set: { status: "pending", lastAttemptAt: null } }
      );
      continue;
    }

    const res = await applyEntry(entry);
    if (res.ok) {
      await OutboxService.complete(entry);
      if (res.skipped) report.skipped += 1;
      else report.applied += 1;
    } else {
      const { exhausted } = await OutboxService.fail(entry, new Error(res.error || "apply failed"));
      if (exhausted) report.deadLettered += 1;
      else report.failed += 1;
    }
  }

  report.durationMs = Date.now() - startedAt;
  return report;
}

module.exports = {
  applyEntry,
  drain,
  isSyncEnabled,
  COLLECTIONS,
  TARGET_TABLE,
  CONFLICT_TARGET,
  MAPPERS,
  ENTITY_TYPES: Object.keys(COLLECTIONS),
};
