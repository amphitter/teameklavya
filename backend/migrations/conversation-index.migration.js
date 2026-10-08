/**
 * Conversations index repair (Part 10) — idempotent, runs on boot after the DB
 * connects, alongside social.migration.
 *
 * ── THE BUG THIS EXISTS TO FIX ──────────────────────────────────────────────
 *
 * `Conversation` was once indexed `{ participants: 1 }` with `unique: true`.
 * `participants` is an ARRAY, so that is a MongoDB MULTIKEY unique index: it
 * forbids two documents from sharing any single element — which is not "one
 * conversation per pair", it is "one conversation per PERSON".
 *
 * In production that surfaces as
 *
 *   E11000 duplicate key error ... index: participants_1
 *   dup key: { participants: ObjectId(<the requesting user's own id>) }
 *
 * on every attempt to start a chat with someone new, which the API can only
 * answer with 500 "Failed to start conversation". Any user who already had one
 * conversation could not message anyone else.
 *
 * The schema no longer declares that index, and scripts/fix-conversation-index.js
 * can drop it — but a manual, dry-run-by-default script is not a deployment:
 * it was never applied to the live database, so production kept the broken
 * index and kept failing. Mongoose helps only in the direction that hurts here:
 * it CREATES indexes a schema declares, and never drops the ones it does not.
 *
 * So the repair runs itself, on every boot, and is safe to run repeatedly.
 *
 * ── WHAT IT DOES ────────────────────────────────────────────────────────────
 *   1. Drops the legacy single-key `{ participants: 1 }` index if present.
 *   2. Makes sure the replacement unique index on `participantsKey` — the
 *      scalar "smallerId:largerId" pair identity — exists.
 *   3. Reports what it found and what it changed, so the deploy log answers
 *      the question "did production get repaired?" without a shell session.
 *
 * Deliberately NOT a bulk backfill of `participantsKey` on historical rows:
 * the read path already falls back to the array lookup for a row without a key
 * and writes the key back opportunistically, so correctness does not depend on
 * touching every document at boot. Keeps boot light and read-only where it can
 * be. The full backfill stays available in scripts/fix-conversation-index.js.
 */
const mongoose = require("mongoose");
const Conversation = require("../models/conversation.model");
const { planConversationIndexRepair } = require("./conversation-index.plan");

/** The replacement constraint, exactly as conversation.model.js declares it.
 *  Same name and same options on purpose: a second, differently-shaped index
 *  on the same key would be a conflict rather than a no-op. */
const PAIR_KEY_INDEX = {
  key: { participantsKey: 1 },
  name: "participantsKey_1",
  unique: true,
  partialFilterExpression: { participantsKey: { $type: "string" } },
};

/** `connectDB()` is fired without await in server.js, so a boot migration can
 *  arrive before the connection is usable. Poll briefly instead of failing. */
async function waitForConnection(timeoutMs = 30_000) {
  const started = Date.now();
  while (mongoose.connection.readyState !== 1) {
    if (Date.now() - started > timeoutMs) return false;
    await new Promise((r) => setTimeout(r, 500));
  }
  return true;
}

let alreadyReported = false;

/**
 * Drop the legacy pair index and guarantee the replacement exists.
 * Never throws: a boot migration must not take the server down with it. A
 * failure is logged loudly and re-attempted on the next boot.
 */
async function runEnsureConversationIndexes({ reason = "boot", quiet = false } = {}) {
  try {
    if (!(await waitForConnection())) {
      console.warn("[migration] conversation indexes: DB not connected — skipped");
      return { ok: false, reason: "db-not-connected" };
    }

    const coll = Conversation.collection;
    const before = await coll.indexes();
    const plan = planConversationIndexRepair(before);

    if (!plan.drop) {
      if (!quiet && !alreadyReported) {
        alreadyReported = true;
        console.log(
          `[migration] conversation indexes already correct (${before.length} indexes, no legacy participants index)`
        );
      }
      return { ok: true, dropped: false, plan };
    }

    await coll.dropIndex(plan.drop);
    console.log(
      `[migration] dropped legacy index ${plan.drop}${plan.droppedUnique ? " [unique]" : ""} — ` +
        `it allowed only one conversation per person (${reason}). ` +
        `Existing chats are untouched; new ones can now be created.`
    );

    /* Guarantee the replacement constraint. Mongoose would also build it from
       the schema, but relying on that alone is what left production in the
       half-repaired state to begin with: drop without build would allow
       duplicate pairs (Part 16 §74). */
    if (!plan.hasPairKeyIndex) {
      try {
        await coll.createIndex(PAIR_KEY_INDEX.key, {
          name: PAIR_KEY_INDEX.name,
          unique: PAIR_KEY_INDEX.unique,
          partialFilterExpression: PAIR_KEY_INDEX.partialFilterExpression,
        });
        console.log("[migration] created unique index participantsKey_1 (one conversation per pair)");
      } catch (error) {
        /* Almost always pre-existing duplicate pairs. Surfaced, not hidden:
           the app stays up and messaging works, but §74's guarantee is not in
           force until the duplicates are resolved via
           scripts/fix-conversation-index.js. */
        console.error(
          `[migration] could NOT create participantsKey_1 (${error.code || ""} ${error.message}). ` +
            "Run scripts/fix-conversation-index.js --apply to resolve."
        );
      }
    }

    return { ok: true, dropped: true, plan };
  } catch (error) {
    console.error(
      `[migration] conversation index repair failed (${reason}): ${error.code || ""} ${error.message}`
    );
    return { ok: false, reason: "error", error };
  }
}

module.exports = { ensureConversationIndexes: runEnsureConversationIndexes, planConversationIndexRepair };
