#!/usr/bin/env node
/**
 * Media orphan sweeper (Part 5, Phase 4 — spec §55)
 * ───────────────────────────────────────────────────
 * Reclaims uploaded assets that were never attached to a domain object.
 *
 * Run manually or from a scheduled job:
 *   node scripts/media-sweeper.js              # dry run (default — safe)
 *   node scripts/media-sweeper.js --apply      # actually delete
 *   node scripts/media-sweeper.js --apply --max=50
 *   node scripts/media-sweeper.js --older-than=48   # hours of grace
 *
 * Safety properties:
 *   • DRY RUN BY DEFAULT. Destructive behaviour is opt-in via --apply.
 *   • Only `pending` / `cleanup_pending` assets past their grace window are
 *     eligible. `active` assets (anything referenced by an event, post or
 *     user) are structurally excluded — user content is permanent (§53).
 *   • Bounded per run (`--max`) so a misconfiguration can't mass-delete.
 *   • Runs as a standalone script, never as a request side effect, so a
 *     storage-provider failure can't break a user action (§68).
 *   • Every action is logged with the request-style fields used elsewhere
 *     (operation, count, duration) for the Phase 7 dashboard.
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
const MAX = Math.max(1, Number(value("--max", 100)) || 100);
const OLDER_THAN_HOURS = Math.max(1, Number(value("--older-than", 24)) || 24);

(async () => {
  if (!process.env.MONGO_URI) {
    console.error("FATAL: MONGO_URI is not set.");
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI, {
    maxPoolSize: 2,
    serverSelectionTimeoutMS: 8000,
  });

  const MediaAsset = require("../models/mediaAsset.model");
  const media = require("../services/media.service");

  const startedAt = Date.now();
  const cutoff = new Date(Date.now() - OLDER_THAN_HOURS * 60 * 60 * 1000);

  // Only assets whose grace window has elapsed AND that are not in use.
  const candidates = await MediaAsset.find({
    status: { $in: ["pending", "cleanup_pending"] },
    cleanupAfter: { $ne: null, $lte: cutoff },
  })
    .select("publicId provider folder url bytes status cleanupReason createdAt")
    .limit(MAX)
    .lean();

  const totalBytes = candidates.reduce((sum, a) => sum + (a.bytes || 0), 0);

  console.log("─".repeat(60));
  console.log(`Media sweeper — ${APPLY ? "APPLY (destructive)" : "DRY RUN (no changes)"}`);
  console.log(`Grace window : ${OLDER_THAN_HOURS}h (only assets older than this)`);
  console.log(`Candidates   : ${candidates.length} (cap ${MAX})`);
  console.log(`Reclaimable  : ${(totalBytes / (1024 * 1024)).toFixed(2)} MB`);
  console.log("─".repeat(60));

  if (!candidates.length) {
    await mongoose.disconnect();
    return;
  }

  let deleted = 0;
  let failed = 0;

  for (const asset of candidates) {
    if (APPLY) {
      const outcome = await media.deleteImage(asset.publicId);
      if (outcome.ok) {
        // deleteImage() already flips the record to `deleted`.
        deleted += 1;
        console.log(`  🗑  ${asset.publicId} (${asset.folder}, ${asset.bytes || 0} B)`);
      } else {
        failed += 1;
        console.warn(`  ⚠️  failed: ${asset.publicId} — ${outcome.error}`);
      }
    } else {
      console.log(
        `  · would delete ${asset.publicId} (${asset.folder}, ${asset.bytes || 0} B, ${asset.status})`
      );
    }
  }

  const durationMs = Date.now() - startedAt;
  console.log("─".repeat(60));
  console.log(
    JSON.stringify({
      op: "media.sweep",
      mode: APPLY ? "apply" : "dry-run",
      candidates: candidates.length,
      deleted,
      failed,
      reclaimedBytes: totalBytes,
      durationMs,
    })
  );
  console.log("─".repeat(60));

  await mongoose.disconnect();
})().catch(async (err) => {
  console.error("💥 media sweeper failed:", err?.message || err);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});
