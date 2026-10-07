/**
 * Part 10 migration — repair the conversation pair index, backfill keys.
 *
 *   node scripts/fix-conversation-index.js            # dry run (default)
 *   node scripts/fix-conversation-index.js --apply    # perform the change
 *
 * ── WHY THIS IS NEEDED ──────────────────────────────────────────────────
 * `Conversation` was indexed `{ participants: 1 }` with `unique: true`.
 * `participants` is an ARRAY, so that is a MongoDB MULTIKEY unique index:
 * it forbids two documents from sharing any single element.
 *
 * The consequence in production is that a user could be in exactly ONE
 * conversation. Starting a second chat with anyone else fails with
 *
 *   E11000 duplicate key error ... index: participants_1
 *   dup key: { participants: ObjectId(<the requesting user's own id>) }
 *
 * — and `getOrCreateConversation` swallowed that error, re-fetched, found
 * nothing, and returned null, so the API answered 500 "Failed to start
 * conversation". Every user who already had a chat was unable to message
 * anyone new.
 *
 * ── WHAT THIS DOES ──────────────────────────────────────────────────────
 *  1. Drops the broken `participants_1` index.
 *  2. Backfills `participantsKey` ("smallerId:largerId") on every existing
 *     conversation, so the pair constraint covers historical rows too.
 *  3. Builds the replacement unique index on `participantsKey` (partial, so
 *     it is safe to create before the backfill completes) and the
 *     { participants, updatedAt } index that serves the inbox read.
 *
 * Idempotent: safe to run more than once. Dry-run by default per the
 * project's standing rule that destructive/structural operations are
 * opt-in (§2).
 */
require("dotenv").config();
const mongoose = require("mongoose");

const APPLY = process.argv.includes("--apply");

(async () => {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) {
    console.error("✗ MONGO_URI is not set — nothing to connect to.");
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log(`✅ connected (${APPLY ? "APPLY" : "DRY RUN"})\n`);

  const Conversation = require("../models/conversation.model");
  const coll = Conversation.collection;

  /* ── 1. inspect ── */
  const before = await coll.indexes();
  const broken = before.find((i) => i.key && i.key.participants === 1 && Object.keys(i.key).length === 1);
  const hasKeyIdx = before.find((i) => i.key && i.key.participantsKey === 1);

  console.log("existing indexes:");
  for (const i of before) console.log(`  • ${i.name}  ${JSON.stringify(i.key)}${i.unique ? "  [unique]" : ""}`);

  const total = await coll.countDocuments({});
  const missingKey = await coll.countDocuments({
    $or: [{ participantsKey: { $exists: false } }, { participantsKey: null }, { participantsKey: "" }],
  });

  console.log(`\nconversations:        ${total}`);
  console.log(`missing participantsKey: ${missingKey}`);

  if (broken) {
    console.log(
      `\n⚠️  ${broken.name} is UNIQUE on the array field \`participants\`.\n` +
        `    This is the bug: it allows each user to appear in only one conversation.`
    );
  } else {
    console.log("\n✓ the broken unique participants index is not present.");
  }

  /* ── 2. backfill ── */
  if (missingKey) {
    console.log(`\nbackfilling ${missingKey} conversation(s)…`);
    const cursor = coll.find({
      $or: [{ participantsKey: { $exists: false } }, { participantsKey: null }, { participantsKey: "" }],
    });
    let fixed = 0;
    let unkeyable = 0;
    for await (const doc of cursor) {
      const p = doc.participants || [];
      if (p.length !== 2) {
        // A malformed conversation (not 2 participants) cannot have a pair
        // key. Reported, never guessed at — repairing ambiguous data
        // automatically is explicitly out of bounds (§6).
        unkeyable++;
        continue;
      }
      const key = Conversation.pairKeyOf(p[0], p[1]);
      if (APPLY) await coll.updateOne({ _id: doc._id }, { $set: { participantsKey: key } });
      fixed++;
    }
    if (unkeyable) console.log(`  ⚠️  ${unkeyable} conversation(s) do not have exactly 2 participants — skipped, review these manually.`);
    console.log(APPLY ? `  ✅ backfilled ${fixed}` : `  (dry run) would backfill ${fixed}`);
  } else {
    console.log("\n✓ every conversation already has a participantsKey.");
  }

  /* ── 3. drop the broken index ── */
  if (broken) {
    if (APPLY) {
      await coll.dropIndex(broken.name);
      console.log(`\n✅ dropped ${broken.name}`);
    } else {
      console.log(`\n(dry run) would drop ${broken.name}`);
    }
  }

  /* ── 4. build the replacement indexes ── */
  if (APPLY) {
    await Conversation.syncIndexes();
    const after = await coll.indexes();
    console.log("\nresulting indexes:");
    for (const i of after) console.log(`  • ${i.name}  ${JSON.stringify(i.key)}${i.unique ? "  [unique]" : ""}`);
    if (after.some((i) => i.key?.participants === 1 && Object.keys(i.key).length === 1)) {
      console.error("\n✗ the broken index is still present — check for a duplicate name in another schema.");
      process.exit(1);
    }
    console.log("\n✅ index repair complete. Each user may now hold many conversations;");
    console.log("   the constraint is now on the participant PAIR, as intended.");
  } else {
    console.log("\n(dry run) re-run with --apply to make these changes.");
  }

  await mongoose.disconnect();
  process.exit(0);
})().catch(async (e) => {
  console.error("migration failed:", e);
  process.exit(1);
});
