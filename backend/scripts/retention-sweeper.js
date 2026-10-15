#!/usr/bin/env node
/**
 * Data retention sweeper (Part 5, Phase 8 — spec §53, §54)
 * ───────────────────────────────────────────────────────────
 * Applies the retention policy documented in docs/DATA-RETENTION.md.
 *
 *   node scripts/retention-sweeper.js                    # dry run (default)
 *   node scripts/retention-sweeper.js --apply            # actually change data
 *   node scripts/retention-sweeper.js --section=tokens   # one section only
 *   node scripts/retention-sweeper.js --section=communications # 90-day mail history
 *   node scripts/retention-sweeper.js --json             # machine-readable
 *
 * ══ WHY THIS IS A SCRIPT AND NOT TTL INDEXES ══════════════════════════════
 *
 * A MongoDB TTL index deletes the WHOLE DOCUMENT when the indexed date
 * passes. That is only safe on a collection whose every document is
 * disposable. In this schema it is not:
 *
 *   • `users` holds emailVerifyExpires / resetOtpExpires /
 *     passwordResetTokenExpires. A TTL index on any of those would DELETE
 *     THE USER ACCOUNT when their one-time code expired. Catastrophic, and
 *     the kind of thing that only shows up in production weeks later.
 *     Expiry here must clear the FIELDS, never the document.
 *
 *   • `mediaassets` records point at a file in Cloudinary or R2. A TTL index
 *     would remove the record and leave the remote object behind — an
 *     orphan that keeps costing storage and credits with nothing left to
 *     reference it. Reclamation has to delete record AND object, which is
 *     exactly what scripts/media-sweeper.js does.
 *
 * Communication history is swept explicitly after 90 days so its parent
 * campaign and per-recipient delivery rows are removed together. These paired
 * records do not use TTL; the only TTL elsewhere is the partial `seen`
 * post-impression index documented in docs/DATA-RETENTION.md.
 *
 * ══ SAFETY PROPERTIES ════════════════════════════════════════════════════
 *   • DRY RUN BY DEFAULT. Writes require --apply.
 *   • Never deletes a user, an event, a post, a registration, a result or a
 *     certificate. Those are PERMANENT (§53) and are not touched at all.
 *   • Archival (live chat / Q&A) is OPT-IN via RETENTION_LIVE_ARCHIVE_DAYS.
 *     Left unset, nothing is archived — ever. Silence means keep.
 *   • Bounded per run (--max) so a bad window cannot mass-delete.
 *   • Standalone process, never a request side effect (§68).
 */

require("dotenv").config();

const mongoose = require("mongoose");

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const value = (flag, fallback) => {
  const hit = args.find((a) => a.startsWith(`${flag}=`));
  return hit ? hit.split("=")[1] : fallback;
};

const APPLY = has("--apply");
const JSON_OUT = has("--json");
const ONLY = value("--section", null);
const MAX = Math.max(1, Number(value("--max", 5_000)) || 5_000);

/** 0 = disabled. Archival only happens if an operator asks for it. */
const LIVE_ARCHIVE_DAYS = Math.max(0, Number(process.env.RETENTION_LIVE_ARCHIVE_DAYS) || 0);

const log = (msg) => {
  if (!JSON_OUT) console.log(msg);
};

/* ══ Section 1 — expired auth token fields ════════════════════════════════
 * Clears one-time codes that have expired but were never redeemed. The user
 * document survives; only the credential material is unset. This bounds how
 * long a stale reset code stays valid-adjacent in the database and keeps
 * abandoned verification rows from lingering indefinitely.
 *
 * SAFE BY CONSTRUCTION: $unset on three field pairs. $unset cannot remove a
 * document, so there is no code path here that deletes an account. */
async function sweepAuthTokens(User) {
  const now = new Date();

  // A token is stale once its own expiry has passed. Each is independent —
  // a user can hold a live reset OTP and an expired verify token at once.
  const match = {
    $or: [
      { emailVerifyExpires: { $ne: null, $lt: now } },
      { resetOtpExpires: { $ne: null, $lt: now } },
      { passwordResetTokenExpires: { $ne: null, $lt: now } },
    ],
  };

  const candidates = await User.find(match).select("_id emailVerifyExpires resetOtpExpires passwordResetTokenExpires").lean();
  if (!candidates.length) return { examined: 0, cleared: 0, skipped: true };

  const batch = candidates.slice(0, MAX);
  const ops = batch.map((u) => {
    const unset = {};
    if (u.emailVerifyExpires && u.emailVerifyExpires < now) {
      unset.emailVerifyToken = "";
      unset.emailVerifyExpires = "";
    }
    if (u.resetOtpExpires && u.resetOtpExpires < now) {
      unset.resetOtp = "";
      unset.resetOtpExpires = "";
    }
    if (u.passwordResetTokenExpires && u.passwordResetTokenExpires < now) {
      unset.passwordResetToken = "";
      unset.passwordResetTokenExpires = "";
    }
    return Object.keys(unset).length
      ? { updateOne: { filter: { _id: u._id }, update: { $unset: unset } } }
      : null;
  }).filter(Boolean);

  let cleared = 0;
  if (APPLY && ops.length) {
    const res = await User.bulkWrite(ops, { ordered: false });
    cleared = (res.modifiedCount || 0);
  } else {
    cleared = ops.length; // dry run reports what WOULD be cleared
  }

  return { examined: candidates.length, cleared };
}

/* ══ Section 2 — live chat / Q&A archival ═════════════════════════════════
 * OPT-IN. RETENTION_LIVE_ARCHIVE_DAYS must be set to a positive number or
 * this section does nothing at all.
 *
 * Live chat and Q&A are transient by nature — they exist to serve the room
 * while an event is running. But "transient" is a policy judgement, not a
 * technical one: an organizer may well want the Q&A from a conference. So
 * the default is KEEP FOREVER and archival is a deliberate choice.
 *
 * Event results and certificates are never derived from these collections
 * (EventResult snapshots are immutable and separate), so archiving them
 * cannot invalidate a certificate. */
async function sweepLiveArchives({ LiveMessage, QAQuestion }) {
  if (LIVE_ARCHIVE_DAYS <= 0) {
    return { enabled: false, reason: "RETENTION_LIVE_ARCHIVE_DAYS is unset — live history is retained" };
  }

  const cutoff = new Date(Date.now() - LIVE_ARCHIVE_DAYS * 24 * 60 * 60 * 1000);
  const filter = { createdAt: { $lt: cutoff } };

  const [messages, questions] = await Promise.all([
    LiveMessage.countDocuments(filter).limit(MAX + 1),
    QAQuestion.countDocuments(filter).limit(MAX + 1),
  ]);

  let deletedMessages = 0;
  let deletedQuestions = 0;
  if (APPLY) {
    const a = await LiveMessage.deleteMany({ ...filter, _id: { $in: await LiveMessage.find(filter).select("_id").limit(MAX).lean().then((r) => r.map((d) => d._id)) } });
    const b = await QAQuestion.deleteMany({ ...filter, _id: { $in: await QAQuestion.find(filter).select("_id").limit(MAX).lean().then((r) => r.map((d) => d._id)) } });
    deletedMessages = a.deletedCount || 0;
    deletedQuestions = b.deletedCount || 0;
  } else {
    deletedMessages = Math.min(messages, MAX);
    deletedQuestions = Math.min(questions, MAX);
  }

  return {
    enabled: true,
    windowDays: LIVE_ARCHIVE_DAYS,
    cutoff: cutoff.toISOString(),
    messages,
    questions,
    deletedMessages,
    deletedQuestions,
  };
}

/* ══ Section 3 — communication history (fixed 90-day window) ══════════════
 * Campaign metadata and recipient email/status snapshots are operational
 * history, not permanent user content. Delete delivery rows first, then their
 * campaign rows, in bounded batches. This is deliberately not a TTL index:
 * the parent and its recipient-level history must be cleaned together. */
async function sweepCommunications({ Communication, CommunicationDelivery }) {
  const windowDays = 90;
  const cutoff = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  const filter = { createdAt: { $lt: cutoff } };
  const [eligible, campaignRows] = await Promise.all([
    Communication.countDocuments(filter),
    Communication.find(filter).select("_id").sort({ createdAt: 1 }).limit(MAX).lean(),
  ]);
  const campaignIds = campaignRows.map((row) => row._id);
  if (!campaignIds.length) {
    return { windowDays, cutoff: cutoff.toISOString(), eligible, examined: 0, deliveries: 0, deletedCampaigns: 0, deletedDeliveries: 0 };
  }

  const deliveryFilter = { communicationId: { $in: campaignIds } };
  const deliveryCount = await CommunicationDelivery.countDocuments(deliveryFilter);
  let deletedCampaigns = 0;
  let deletedDeliveries = 0;
  if (APPLY) {
    const deliveryResult = await CommunicationDelivery.deleteMany(deliveryFilter);
    deletedDeliveries = deliveryResult.deletedCount || 0;
    const campaignResult = await Communication.deleteMany({ _id: { $in: campaignIds } });
    deletedCampaigns = campaignResult.deletedCount || 0;
  } else {
    deletedCampaigns = campaignIds.length;
    deletedDeliveries = deliveryCount;
  }

  return {
    windowDays,
    cutoff: cutoff.toISOString(),
    eligible,
    examined: campaignIds.length,
    deliveries: deliveryCount,
    deletedCampaigns,
    deletedDeliveries,
  };
}

/* ══ Section 4 — retention inventory (read-only) ══════════════════════════
 * Sizes of the collections the policy classifies, so the doc's claims can be
 * checked against reality and growth can be spotted early. Purely a COUNT —
 * it never mutates, even with --apply. */
async function inventory(db, collections) {
  const out = {};
  for (const name of collections) {
    try {
      out[name] = await db.collection(name).countDocuments();
    } catch {
      out[name] = null;
    }
  }
  return out;
}

(async () => {
  if (!process.env.MONGO_URI) {
    console.error("FATAL: MONGO_URI is not set.");
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI, {
    maxPoolSize: 2,
    serverSelectionTimeoutMS: 8000,
  });

  const User = require("../models/user.model");
  const LiveMessage = require("../models/liveMessage.model");
  const QAQuestion = require("../models/qaQuestion.model");
  const MediaAsset = require("../models/mediaAsset.model");
  const Communication = require("../models/communication.model");
  const CommunicationDelivery = require("../models/communicationDelivery.model");

  const startedAt = Date.now();
  const db = mongoose.connection.db;

  const results = {};

  if (!ONLY || ONLY === "tokens") {
    log("\n── Expired auth token fields ──────────────────");
    results.tokens = await sweepAuthTokens(User);
    log(`   users with an expired code : ${results.tokens.examined}`);
    log(`   field sets cleared         : ${results.tokens.cleared}`);
    log("   (fields only — no user document is ever removed)");
  }

  if (!ONLY || ONLY === "live") {
    log("\n── Live chat / Q&A archival ───────────────────");
    results.live = await sweepLiveArchives({ LiveMessage, QAQuestion });
    if (!results.live.enabled) log(`   skipped: ${results.live.reason}`);
    else {
      log(`   older than ${results.live.windowDays}d — messages: ${results.live.messages}, questions: ${results.live.questions}`);
      log(`   would archive: ${results.live.deletedMessages} messages, ${results.live.deletedQuestions} questions`);
    }
  }

  if (!ONLY || ONLY === "media") {
    log("\n── Media orphan pressure (report only) ────────");
    const pending = await MediaAsset.countDocuments({ status: { $in: ["pending", "cleanup_pending"] } });
    const reclaimable = await MediaAsset.countDocuments({
      status: { $in: ["pending", "cleanup_pending"] },
      cleanupAfter: { $ne: null, $lte: new Date() },
    });
    results.media = { pending, reclaimable };
    log(`   pending/cleanup_pending    : ${pending}`);
    log(`   past grace (reclaimable)   : ${reclaimable}`);
    log("   → reclaim with: npm run media:sweep -- --apply");
  }

  if (!ONLY || ONLY === "communications") {
    log("\n── Communication history (90-day retention) ───");
    results.communications = await sweepCommunications({ Communication, CommunicationDelivery });
    log(`   older than ${results.communications.windowDays}d : ${results.communications.eligible} campaigns`);
    log(`   selected for this run        : ${results.communications.examined} campaigns`);
    log(`   associated delivery rows     : ${results.communications.deliveries}`);
    log(`   would remove                 : ${results.communications.deletedCampaigns} campaigns, ${results.communications.deletedDeliveries} deliveries`);
  }

  if (!ONLY || ONLY === "inventory") {
    results.inventory = await inventory(db, [
      "users", "events", "posts", "comments", "registrationresponses",
      "tickets", "eventresults", "certificates", "notifications",
      "livemessages", "qaquestions", "mediaassets", "auditlogs",
      "communications", "communicationdeliveries",
    ]);
    if (!JSON_OUT) {
      log("\n── Retention inventory ────────────────────────");
      for (const [k, v] of Object.entries(results.inventory)) {
        log(`   ${k.padEnd(24)} ${v}`);
      }
    }
  }

  const summary = {
    op: "retention.sweep",
    mode: APPLY ? "apply" : "dry-run",
    section: ONLY || "all",
    durationMs: Date.now() - startedAt,
    results,
  };

  if (!APPLY) {
    summary.note = "Dry run — no data was changed. Re-run with --apply to commit.";
  }

  if (JSON_OUT) {
    console.log(JSON.stringify(summary));
  } else {
    log(`\n${APPLY ? "✅ committed" : "🔍 dry run"} in ${summary.durationMs}ms`);
    if (!APPLY) log("   Re-run with --apply to commit.");
  }

  await mongoose.disconnect();
  process.exit(0);
})().catch((error) => {
  console.error("FATAL:", error.message);
  process.exit(1);
});
