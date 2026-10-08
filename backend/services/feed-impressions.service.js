/**
 * Feed impressions — the server side of "do not show me that again" (§23–§25).
 *
 * THE MODEL
 *   liked      a Reaction row the viewer already made. Engagement, so it is
 *              read straight from the reaction table rather than copied here —
 *              one source of truth, and un-liking restores the post.
 *   dismissed  an explicit "not interested". Hard exclusion, no expiry.
 *   seen       the post was really on screen (client threshold), soft signal:
 *              demoted so fresh content wins, returned when nothing fresh is
 *              left.
 *
 * BOUNDED BY DESIGN (§42/§24)
 *   Every set below is capped. A viewer with 20 000 impressions must not turn
 *   the feed query into an unbounded `$nin`, so the exclusion window is the
 *   most recent N — which is exactly the window that matters, because the feed
 *   pool itself is capped at the latest FEED_POOL posts.
 */
const PostImpression = require("../models/post-impression.model");
const Reaction = require("../models/reaction.model");
const mongoose = require("mongoose");

/* How many ids we are willing to put in a query. 400 matches FEED_POOL: any
   post older than the window cannot appear in the feed anyway. */
const EXCLUSION_WINDOW = 400;
const MAX_BATCH = 60; // one impression request carries at most this many ids

const toIds = (rows, key = "post") =>
  rows.map((r) => String(r[key])).filter((id) => mongoose.Types.ObjectId.isValid(id));

/**
 * The viewer's exclusions, in three sets, from two bounded reads.
 * Returns empty sets for a signed-out viewer (there is nothing to exclude).
 */
async function loadImpressions(viewerId) {
  const empty = { liked: new Set(), dismissed: new Set(), seen: new Set() };
  if (!viewerId) return empty;

  const [reactions, impressions] = await Promise.all([
    Reaction.find({ user: viewerId, type: "like" })
      .sort({ createdAt: -1 })
      .limit(EXCLUSION_WINDOW)
      .select("post")
      .lean(),
    PostImpression.find({ user: viewerId })
      .sort({ at: -1 })
      .limit(EXCLUSION_WINDOW)
      .select("post kind")
      .lean(),
  ]);

  const liked = new Set(toIds(reactions));
  const dismissed = new Set();
  const seen = new Set();
  for (const row of impressions) {
    const id = String(row.post);
    if (row.kind === "dismissed") dismissed.add(id);
    else seen.add(id);
  }
  /* Already-liked posts are not also "unseen": the two sets overlap in the
     data, but the feed only ever asks "is this eligible at all". */
  return { liked, dismissed, seen };
}

/**
 * Record a batch of impressions. One `bulkWrite`, no per-item round trip
 * (§24: never one database request per scroll event).
 *
 * Upsert on the unique (user, post, kind) index, so a retried batch is free and
 * the same post seen forty times stays one row with `count: 40`.
 */
async function recordImpressions(viewerId, postIds, kind = "seen") {
  if (!viewerId) return { recorded: 0 };
  const ids = [...new Set(postIds)]
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .slice(0, MAX_BATCH);
  if (!ids.length) return { recorded: 0 };

  const now = new Date();
  const ops = ids.map((id) => ({
    updateOne: {
      filter: { user: viewerId, post: id, kind },
      update: {
        $set: { lastAt: now },
        $setOnInsert: { at: now, user: viewerId, post: id, kind },
        $inc: { count: 1 },
      },
      upsert: true,
    },
  }));

  try {
    const res = await PostImpression.bulkWrite(ops, { ordered: false });
    return { recorded: ids.length, upserted: res.upsertedCount || 0 };
  } catch (e) {
    /* A duplicate-key race between two concurrent batches is a success, not a
       failure: the row exists, which is all we wanted. */
    if (e && e.code === 11000) return { recorded: ids.length, race: true };
    throw e;
  }
}

/** Explicit "not interested" on / off. */
async function setDismissed(viewerId, postId, on) {
  if (!mongoose.Types.ObjectId.isValid(postId)) return null;
  if (!on) {
    await PostImpression.deleteOne({ user: viewerId, post: postId, kind: "dismissed" });
    return { dismissed: false };
  }
  await PostImpression.updateOne(
    { user: viewerId, post: postId, kind: "dismissed" },
    { $set: { lastAt: new Date() }, $setOnInsert: { at: new Date() }, $inc: { count: 1 } },
    { upsert: true }
  );
  return { dismissed: true };
}

/**
 * OLD FEED candidates (Part 16 §20, §22, §33).
 *
 * The fresh feed keeps its own policy — this is the *explicit* historical
 * query: the posts this viewer has already SEEN or LIKED, most recently
 * touched first, MINUS anything they explicitly dismissed (§21). Dismissal is
 * read first and applied as a hard exclusion, so a dismissed post can never
 * come back through the side door.
 *
 * "Seen" and "liked" are two different stores, and this has to read both:
 *
 *   PostImpression {user, kind, at}          → what the viewer read
 *   Reaction       {user, type, createdAt}   → what the viewer liked
 *
 * Nothing ever writes a `kind: "liked"` impression row — a like is a Reaction —
 * so reading impressions alone would silently drop every post the viewer liked
 * without opening. Both queries are indexed ranges truncated to the same
 * window the feed itself uses (EXCLUSION_WINDOW), and they are merged in
 * memory over that bounded window rather than sorted unbounded.
 *
 * The ids are returned, not the posts: the controller hydrates them through
 * the repository, which applies every visibility rule (§19).
 */
async function findSeenCandidates({ viewerId, cursor = null, limit = 10 }) {
  if (!viewerId) return { ids: [], hasMore: false, nextCursor: null };

  const [dismissedRows, seenRows, likedRows] = await Promise.all([
    PostImpression.find({ user: viewerId, kind: "dismissed" }).select("post").lean(),
    PostImpression.find({ user: viewerId, kind: { $ne: "dismissed" } })
      .sort({ at: -1 })
      .limit(EXCLUSION_WINDOW)
      .select("post at")
      .lean(),
    Reaction.find({ user: viewerId, type: "like" })
      .sort({ createdAt: -1 })
      .limit(EXCLUSION_WINDOW)
      .select("post createdAt")
      .lean(),
  ]);

  const skip = new Set(dismissedRows.map((r) => String(r.post)));

  /* One entry per post, keeping the NEWEST signal for it: a post that was read
     and then liked belongs at the position of the like, not the read. */
  const merged = new Map();
  const put = (post, when) => {
    const id = String(post);
    const at = new Date(when).getTime();
    const current = merged.get(id);
    if (!current || at > current.at) merged.set(id, { id, at });
  };
  for (const r of likedRows) put(r.post, r.createdAt);
  for (const r of seenRows) put(r.post, r.at);

  let items = [...merged.values()].filter((it) => !skip.has(it.id));
  items.sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : -1));

  /* Cursor = "<ISO at>|<postId>" — the same shape the fresh feed's cursor has,
     so the two paginate alike from the client's point of view. */
  if (cursor) {
    const [at, id] = String(cursor).split("|");
    const when = new Date(at).getTime();
    if (!Number.isNaN(when) && id) {
      items = items.filter((it) => it.at < when || (it.at === when && it.id < id));
    }
  }

  const hasMore = items.length > limit;
  const page = hasMore ? items.slice(0, limit) : items;
  const last = page[page.length - 1];
  return {
    ids: page.map((it) => it.id),
    hasMore,
    nextCursor: hasMore && last ? `${new Date(last.at).toISOString()}|${last.id}` : null,
  };
}

module.exports = {
  EXCLUSION_WINDOW,
  MAX_BATCH,
  loadImpressions,
  recordImpressions,
  setDismissed,
  findSeenCandidates,
};
