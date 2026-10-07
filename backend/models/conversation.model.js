const mongoose = require("mongoose");

/** 1:1 direct-message conversation between exactly two users. */
const conversationSchema = new mongoose.Schema(
  {
    /* Part 11 — a conversation is either a 1:1 direct chat or a TEAM.
     *
     * The product calls these "teams", not "groups": a team is something you
     * assemble from your followers, the people you follow, or anyone else on
     * the app, and it is a named, persistent set of people. The wire format
     * stays `type` so nothing downstream has to learn a new word for an old
     * concept, but every label a user reads says "team". */
    type: { type: String, enum: ["direct", "team"], default: "direct", required: true },

    participants: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
      validate: [
        {
          // A direct chat is exactly two people — the invariant the pair key
          // and every "other participant" lookup depends on.
          validator(v) {
            return this.type !== "direct" || v.length === 2;
          },
          message: "A direct conversation needs exactly 2 participants",
        },
        {
          // A team needs at least its owner plus one other member; otherwise
          // it is not a conversation, it is a note to self.
          validator(v) {
            return this.type !== "team" || v.length >= 2;
          },
          message: "A team needs at least 2 members",
        },
      ],
      required: true,
    },

    /* ── Team-only fields ───────────────────────────────────────────────
     * Undefined on direct conversations, which keeps every existing query
     * and every existing document valid. */
    name: { type: String, default: "", maxlength: 80 },
    avatar: { type: String, default: "" },
    /** Sole owner. Only the owner may delete or transfer; admins may manage members. */
    owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    /** Members who can add/remove others without being the owner. */
    admins: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }], default: [] },
    lastMessage: {
      text: { type: String, maxlength: 1000 },
      sender: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      at: { type: Date },
    },

    /* ── Pair identity (Part 10) ────────────────────────────────────────
     * Canonical "smallerId:largerId" for the two participants.
     *
     * WHY THIS FIELD EXISTS
     *   A unique index cannot express "this pair is unique" when the pair is
     *   an ARRAY. `Conversation` was indexed `{ participants: 1 }` with
     *   `unique: true`, which in MongoDB is a MULTIKEY unique index: it
     *   forbids any two documents from sharing *any single element*. The
     *   practical effect was that a user could be in exactly ONE
     *   conversation ever — starting a second chat failed with E11000
     *   `dup key: { participants: ObjectId(<the user's own id>) }`.
     *
     *   Sorting the array does not help; the constraint is per-element, not
     *   per-array. A single scalar derived from the pair restores the
     *   intended guarantee ("one conversation per pair") without the
     *   accidental one ("one conversation per person").
     */
    participantsKey: { type: String, default: undefined },
  },
  { timestamps: true }
);

/** Canonical, order-independent key for a participant pair. */
function pairKeyOf(a, b) {
  return [String(a), String(b)].sort().join(":");
}

// Always store participants sorted so the pair is deterministic
conversationSchema.pre("save", function (next) {
  if (this.isModified("participants")) {
    this.participants = this.participants.sort();
  }
  // Recomputed (not just set on insert) so a document written before this
  // field existed gains its key the first time it is saved through mongoose.
  // The documented backfill is scripts/backfill-conversation-keys.js.
  /* Only DIRECT conversations get a pair key. A team's identity is its
   * document, not its membership — a team's roster changes over time, and
   * deriving a key from it would make the unique index fight every
   * membership change. Leaving it undefined also keeps the partial unique
   * index (which filters on a string value) from applying to teams at all. */
  if (this.type === "direct" && this.participants?.length === 2) {
    this.participantsKey = pairKeyOf(this.participants[0], this.participants[1]);
  } else {
    this.participantsKey = undefined;
  }
  next();
});

// Messaging v2: per-participant mute (no notifications) and hide
// (list-hidden until a new message arrives, which un-hides for both)
conversationSchema.add({
  mutedBy: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }], default: [] },
  hiddenBy: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }], default: [] },
  /* Archive (Part 8 §32-33), per participant — archiving is a personal view
     change, so it must never affect the other participant's inbox.
     Distinct from `hiddenBy`: hiding auto-reverses on the next message,
     archiving does not. See the behaviour note in the message controller. */
  archivedBy: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }], default: [] },
  /** When each participant last opened the thread — drives unread counts
   *  without scanning messages (§34). */
  lastReadAt: { type: Map, of: Date, default: {} },
});

/* ── Indexes ──────────────────────────────────────────────────────────
 * { participants } unique — the 1:1 pair constraint (pre-existing).
 *
 * { participants, updatedAt } — the inbox read (Part 10 §4, §15).
 *   The list is `find({participants: me, …}).sort({updatedAt: -1})` with a
 *   (updatedAt,_id) cursor. On `{participants}` alone every page load sorts
 *   the user's whole conversation set in memory; with the compound index the
 *   sort comes from the index and the cursor is a seek.
 *
 * Deliberately NOT indexing archivedBy / hiddenBy: those are per-user array
 * membership filters applied after the participant seek, and a user's
 * conversation count is small (tens). An index per flag would multiply write
 * cost on every single message sent, since sending touches `updatedAt`,
 * `lastMessage` and `hiddenBy` on this document. */
/* The pair constraint, expressed as a scalar so it actually means what it
 * says. Partial so that legacy rows which have not been backfilled yet are
 * excluded from the constraint instead of colliding with each other on
 * `undefined`. After scripts/backfill-conversation-keys.js every row has a
 * key and the filter is a no-op. */
conversationSchema.index(
  { participantsKey: 1 },
  { unique: true, partialFilterExpression: { participantsKey: { $type: "string" } } }
);
/* Membership + inbox ordering. The old standalone unique { participants: 1 }
 * is gone: this compound index has `participants` as its prefix, so it
 * serves the same membership lookups while also carrying the sort key. */
conversationSchema.index({ participants: 1, updatedAt: -1 });
/* Team chat search matches on the team name (§25 extends to teams). */
conversationSchema.index({ name: 1 });

const Conversation = mongoose.model("Conversation", conversationSchema);
Conversation.pairKeyOf = pairKeyOf;

module.exports = Conversation;
