/**
 * PostImpression — what a viewer has already seen, and what they said no to.
 *
 * WHY THIS EXISTS
 *   Part 14 §23: a post the viewer has already liked, consumed or dismissed
 *   must not come back to their feed, and that has to survive a refresh, a new
 *   session and a different device. Frontend state cannot do that, so the fact
 *   is stored server-side — one row per (viewer, post, kind).
 *
 * TWO KINDS, ON PURPOSE
 *   `seen`      — the post was genuinely on screen for long enough to count
 *                 (§24: a mount is not a view; the client sends this only after
 *                 an IntersectionObserver threshold). "Seen" is a soft signal:
 *                 the feed demotes these rather than deleting them, so a small
 *                 corpus never turns into an empty feed (§23 "unnecessarily",
 *                 §25 "do not return partially empty pages").
 *   `dismissed` — the viewer explicitly said "not interested". That is a hard
 *                 exclusion, and it has no expiry: an explicit choice is not a
 *                 guess.
 *
 * The unique index makes the batched upsert idempotent, so a retried impression
 * batch can never double-count, and `seen` rows expire on their own (TTL) —
 * a post read a year ago is allowed to surface again.
 */
const mongoose = require("mongoose");

const SEEN_TTL_DAYS = Number(process.env.POST_SEEN_TTL_DAYS || 30);

const postImpressionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    post: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Post",
      required: true,
      index: true,
    },
    kind: {
      type: String,
      enum: ["seen", "dismissed"],
      required: true,
    },
    /* When the impression was first recorded, and the most recent time the
       post was seen again. `at` drives the TTL and "least recently seen"
       ordering when the feed has to fall back to already-seen content. */
    at: { type: Date, default: Date.now },
    lastAt: { type: Date, default: Date.now },
    /* How many times it has been counted. Bounded in the controller; it exists
       so "seen 1×" and "seen 12×" can be told apart without a second row. */
    count: { type: Number, default: 1, min: 0 },
  },
  { timestamps: true }
);

/* One row per viewer+post+kind: the batch upsert is keyed on this, so retries
   are free and the collection cannot grow without bound per user. */
postImpressionSchema.index({ user: 1, post: 1, kind: 1 }, { unique: true });

/* The feed's read path is "this viewer's recent impressions, newest first". */
postImpressionSchema.index({ user: 1, kind: 1, at: -1 });

/* §24 — a `seen` row is a soft signal and expires. `dismissed` rows must not
   expire, so the TTL is scoped to `seen` via a partial index expression. */
postImpressionSchema.index(
  { at: 1 },
  { expireAfterSeconds: SEEN_TTL_DAYS * 24 * 60 * 60, partialFilterExpression: { kind: "seen" } }
);

module.exports = mongoose.model("PostImpression", postImpressionSchema);
module.exports.SEEN_TTL_DAYS = SEEN_TTL_DAYS;
