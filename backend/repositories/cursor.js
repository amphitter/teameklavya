/**
 * Cursor pagination primitives (Part 5, Phase 3 — spec §7, §63)
 * ────────────────────────────────────────────────────────────
 * ONE implementation of pagination for the whole API. Every list endpoint
 * shares this vocabulary, so clients get a stable contract:
 *
 *     GET /api/thing?limit=20&cursor=eyJhdCI6…
 *     → { items: [...], nextCursor: "…" | null, hasMore: boolean }
 *
 * Rules enforced here (never re-implemented per controller):
 *   • §7  "limit > 100 must never be accepted" — MAX_LIMIT is a hard ceiling
 *         that no caller can override. A larger requested limit is CLAMPED,
 *         not rejected (clamping is friendlier and still bounded).
 *   • §5  callers pass a projection; repositories never return full docs
 *         from list endpoints.
 *   • Keyset (cursor) pagination, not OFFSET: deep pages stay O(limit)
 *         instead of O(offset) — the difference matters on free-tier DBs.
 *   • Cursors are opaque base64url blobs. Clients must not parse them.
 *
 * Sort contract: descending on `createdAt` with `_id` as the tiebreaker by
 * default. Callers may specify another date field and ascending direction
 * (for example, public Event discovery ordered by `startDate`).
 */

const mongoose = require("mongoose");

/** Hard ceiling (§7). No endpoint may ever return more than this per page. */
const MAX_LIMIT = 100;
/** Sensible default when the client omits `limit`. */
const DEFAULT_LIMIT = 20;

/**
 * Parse and clamp a client-supplied limit.
 * @param {unknown} raw            req.query.limit
 * @param {object} opts
 * @param {number} opts.def        default when absent/invalid
 * @param {number} opts.max        domain ceiling — may LOWER the global max,
 *                                 never raise it (`Math.min` with MAX_LIMIT).
 */
function parseLimit(raw, { def = DEFAULT_LIMIT, max = MAX_LIMIT } = {}) {
  const ceiling = Math.min(Number(max) || MAX_LIMIT, MAX_LIMIT);
  const n = Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(n) || n <= 0) return Math.min(def, ceiling);
  return Math.min(n, ceiling);
}

/** New callers omit `page`; explicit page requests stay on the legacy contract. */
function isCursorRequest(query = {}) {
  return query.cursor !== undefined || query.page === undefined;
}

/** Encode an opaque cursor. Never hand a client a raw Mongo value. */
function encodeCursor(payload) {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

/** Decode a cursor. Malformed/expired cursors return null → caller ignores it. */
function decodeCursor(raw) {
  if (!raw || typeof raw !== "string") return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null; // tampered or truncated cursor — treat as "no cursor"
  }
}

/** Cursor for a (dateField, _id) ordered list; direction is applied when decoding. */
function cursorFor(item, sortField = "createdAt") {
  const value = item?.[sortField];
  const at = value instanceof Date ? value : new Date(value);
  if (!item?._id || Number.isNaN(at.getTime())) return null;
  return encodeCursor({ at: at.toISOString(), id: String(item._id) });
}

/** Default cursor shape for a (createdAt desc, _id desc) ordered list. */
function defaultCursor(item) {
  return cursorFor(item, "createdAt");
}

/**
 * Build the Mongo predicate that resumes a descending list after `cursor`.
 * Returns null when there is no usable cursor (first page, or bad cursor →
 * fall back to page 1 rather than erroring, which would break deep links).
 *
 * @param {string|null} rawCursor
 * @param {object} opts
 * @param {string} opts.sortField  ordering field (default createdAt)
 * @param {string|number} opts.direction `desc`/`-1` by default; `asc`/`1` for ascending lists
 */
function keysetFilter(rawCursor, { sortField = "createdAt", direction = "desc" } = {}) {
  const cursor = decodeCursor(rawCursor);
  if (!cursor) return null;
  const at = cursor.at ? new Date(cursor.at) : null;
  const id = cursor.id;
  if (!at || Number.isNaN(at.getTime()) || typeof id !== "string" || !mongoose.Types.ObjectId.isValid(id)) return null;

  const idValue = new mongoose.Types.ObjectId(id);
  const operator = direction === "asc" || direction === 1 ? "$gt" : "$lt";

  return {
    $or: [{ [sortField]: { [operator]: at } }, { [sortField]: at, _id: { [operator]: idValue } }],
  };
}

/**
 * Wrap a fetched slice into the standard page envelope.
 *
 * Repositories over-fetch by one row (`limit + 1`) to learn whether another
 * page exists — that extra row is dropped here, so `items` never exceeds
 * `limit` and no extra `countDocuments()` round trip is needed (§5).
 *
 * @param {Array} items         rows fetched with limit+1
 * @param {number} limit        the clamped page size actually requested
 * @param {(item:any)=>string} [toCursor]  cursor builder for this ordering
 */
function buildPage(items, limit, toCursor = defaultCursor) {
  const hasMore = items.length > limit;
  const slice = hasMore ? items.slice(0, limit) : items;
  const last = slice[slice.length - 1];
  return {
    items: slice,
    nextCursor: hasMore && last ? toCursor(last) : null,
    hasMore,
  };
}

/**
 * Merge a keyset predicate into an existing Mongo filter without clobbering
 * it. Handles the common case where the filter already uses `$and`.
 */
function withCursor(filter, rawCursor, opts) {
  const keyset = keysetFilter(rawCursor, opts);
  if (!keyset) return filter;
  const next = { ...filter };
  if (Array.isArray(next.$and)) next.$and = [...next.$and, keyset];
  else next.$and = [keyset];
  return next;
}

module.exports = {
  MAX_LIMIT,
  DEFAULT_LIMIT,
  parseLimit,
  isCursorRequest,
  encodeCursor,
  decodeCursor,
  cursorFor,
  defaultCursor,
  keysetFilter,
  buildPage,
  withCursor,
};
