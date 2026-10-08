/**
 * The decision rule behind the conversation-index repair — pure, no I/O and no
 * requires, so it can be exercised on its own (`node migrations/conversation-index.plan.js`).
 *
 * Kept separate from the migration that uses it because "which index is the
 * broken one" is the part worth being able to read and test in isolation: the
 * migration around it does nothing more than apply this answer to a live
 * collection.
 */

/** Index name for a single-key `{ participants: 1 }` index — MongoDB's own
 *  `<field>_<direction>` convention, which is how it appears in production. */
const LEGACY_INDEX_NAME = "participants_1";

/**
 * Given the index specs `collection.indexes()` reports, decide what to repair.
 *
 * Matches on the KEY rather than the name: the broken constraint is known to
 * exist as `participants_1`, but the same constraint rebuilt under another name
 * is still the same constraint and must still be dropped. Scoped to
 * single-key `participants` on purpose — the compound
 * `{ participants: 1, updatedAt: -1 }` index that serves the inbox read is
 * legitimate and must be left alone.
 */
function planConversationIndexRepair(indexes = []) {
  const legacy = indexes.find(
    (i) => i.key && Object.keys(i.key).length === 1 && i.key.participants === 1
  );
  const hasPairKeyIndex = indexes.some((i) => i.key && i.key.participantsKey === 1);
  return {
    drop: legacy ? legacy.name : null,
    droppedUnique: Boolean(legacy && legacy.unique),
    hasPairKeyIndex,
  };
}

module.exports = { planConversationIndexRepair, LEGACY_INDEX_NAME };

/* Run directly: prints the decision for each shape the field has, or could have. */
if (require.main === module) {
  const cases = {
    "fresh DB (schema indexes only)": [
      { name: "_id_", key: { _id: 1 } },
      { name: "participantsKey_1", key: { participantsKey: 1 }, unique: true },
      { name: "participants_1_updatedAt_-1", key: { participants: 1, updatedAt: -1 } },
    ],
    "PRODUCTION TODAY (legacy unique index still there)": [
      { name: "_id_", key: { _id: 1 } },
      { name: "participants_1", key: { participants: 1 }, unique: true },
      { name: "participants_1_updatedAt_-1", key: { participants: 1, updatedAt: -1 } },
    ],
    "half-repaired (dropped, replacement missing)": [
      { name: "_id_", key: { _id: 1 } },
      { name: "participants_1_updatedAt_-1", key: { participants: 1, updatedAt: -1 } },
    ],
    "legacy constraint under a rebuilt name": [
      { name: "_id_", key: { _id: 1 } },
      { name: "participants_1_v2", key: { participants: 1 }, unique: true },
    ],
  };
  let failures = 0;
  for (const [label, specs] of Object.entries(cases)) {
    const plan = planConversationIndexRepair(specs);
    const wantDrop = label.includes("PRODUCTION") || label.includes("rebuilt name");
    const good = Boolean(plan.drop) === wantDrop && (plan.drop === null || plan.drop !== "participants_1_updatedAt_-1");
    if (!good) failures += 1;
    console.log(
      `${good ? "ok  " : "FAIL"} ${label}\n     drop=${plan.drop} unique=${plan.droppedUnique} hasPairKey=${plan.hasPairKeyIndex}`
    );
  }
  console.log(failures ? `\n${failures} case(s) wrong` : "\nall cases decided correctly");
  process.exit(failures ? 1 : 0);
}
