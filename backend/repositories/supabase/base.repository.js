/**
 * Shared Supabase repository behaviour (Part 6, Phase 5 — §13, §7, §66)
 * ─────────────────────────────────────────────────────────────────────────────
 * Everything the Supabase repositories have in common lives here so it is
 * implemented once:
 *
 *  • KEYSET PAGINATION that emits the SAME envelope as the MongoDB
 *    repositories. This is the single most important property of this file.
 *    `repositories/cursor.js` is "ONE implementation of pagination for the
 *    whole API", and a client must not be able to tell which store answered.
 *    So we reuse `parseLimit` (with its hard MAX_LIMIT ceiling) and
 *    `encodeCursor` verbatim, and return `{ items, nextCursor, hasMore }`
 *    exactly as `buildPage` does.
 *
 *  • PROJECTION SAFETY (§5). A list endpoint never selects `*`. Repositories
 *    declare the columns they need and we pass them through, so a future
 *    column containing something sensitive is not silently exposed.
 *
 *  • BOUNDED READS (§13). Every read goes through `paginate()` or `first()`,
 *    both of which clamp to `cursor.MAX_LIMIT`. There is deliberately no
 *    exported "findAll".
 *
 *  • FAILURE IS A DOMAIN ERROR, NOT A LEAK (§61). A PostgREST failure is
 *    normalised by the client; here it becomes a thrown `SupabaseError` that
 *    the service layer decides how to degrade. Nothing from Postgres reaches
 *    a response.
 *
 *  • REQUEST SCOPING. Reads run inside `client.scope()` so N+1 is detectable
 *    as a query count rather than as unexplained latency.
 */

"use strict";

const {
  supabaseProvider,
  SupabaseError,
} = require("../../providers/supabase");

// ONE pagination vocabulary for the whole API — shared with MongoDB.
const cursor = require("../cursor");

/**
 * @typedef {object} Page
 * @property {any[]} items
 * @property {string|null} nextCursor
 * @property {boolean} hasMore
 */

class BaseSupabaseRepository {
  /**
   * @param {object} opts
   * @param {string} opts.table       Postgres table name
   * @param {string} [opts.sortColumn] default keyset sort column
   * @param {string} [opts.idColumn]   default tiebreaker column
   */
  constructor({ table, sortColumn = "created_at", idColumn = "id" } = {}) {
    if (!table) throw new Error("BaseSupabaseRepository requires a table name");
    this.table = table;
    this.sortColumn = sortColumn;
    this.idColumn = idColumn;
  }

  /** The shared client. Overridable in tests. */
  get client() {
    return supabaseProvider();
  }

  query() {
    return this.client.from(this.table);
  }

  /**
   * Clamp a client-supplied limit using the GLOBAL ceiling from cursor.js.
   * `max` may lower it (domain-specific), never raise it.
   */
  parseLimit(raw, { def, max } = {}) {
    return cursor.parseLimit(raw, {
      def: def ?? cursor.DEFAULT_LIMIT,
      max: max ?? cursor.MAX_LIMIT,
    });
  }

  /**
   * Keyset-paginated read.
   *
   * @param {object} opts
   * @param {string[]} opts.columns           explicit projection (§5)
   * @param {(q: import("../../providers/supabase/client").Query) => void} [opts.where]
   *        filter builder — receives the Query and applies predicates
   * @param {number} [opts.limit]
   * @param {string|null} [opts.cursor]       opaque client cursor
   * @param {string} [opts.sortColumn]
   * @param {"asc"|"desc"} [opts.direction]
   * @returns {Promise<Page>}
   */
  async paginate({ columns, where, limit, cursor: rawCursor, sortColumn, direction = "desc" } = {}) {
    if (!Array.isArray(columns) || !columns.length) {
      // §5: a list endpoint with no projection is a bug, not a default.
      throw new Error(`paginate() on "${this.table}" requires an explicit column projection`);
    }

    const size = this.parseLimit(limit);
    const q = this.query().select(columns);
    if (typeof where === "function") where(q);

    const sortCol = sortColumn || this.sortColumn;

    // Decode with the SHARED codec so Mongo and Postgres cursors are
    // interchangeable at the API boundary. A tampered cursor decodes to null,
    // which degrades to page 1 rather than erroring (deep links stay valid).
    let after = null;
    const decoded = cursor.decodeCursor(rawCursor);
    if (decoded && decoded.at !== undefined && decoded.id !== undefined) {
      after = { sortValue: decoded.at, id: decoded.id };
    }

    const { rows, nextAfter, hasMore } = await q.paginate({
      after,
      limit: size,
      sortColumn: sortCol,
      direction,
      idColumn: this.idColumn,
    });

    const last = rows.length ? rows[rows.length - 1] : null;
    const nextCursor =
      hasMore && last
        ? cursor.encodeCursor({
            at: String(last[sortCol]),
            id: String(last[this.idColumn]),
          })
        : null;

    return { items: rows, nextCursor, hasMore };
  }

  /**
   * A single bounded read. Used for "does this exist" and detail lookups —
   * never for collections.
   */
  async first({ columns, where } = {}) {
    if (!Array.isArray(columns) || !columns.length) {
      throw new Error(`first() on "${this.table}" requires an explicit column projection`);
    }
    const q = this.query().select(columns);
    if (typeof where === "function") where(q);
    return q.single();
  }

  /** Row existence without transferring the row. */
  async exists({ where } = {}) {
    const q = this.query().select([this.idColumn]);
    if (typeof where === "function") where(q);
    return q.exists();
  }

  async insert(rows, opts = {}) {
    return this.query().insert(rows, opts);
  }

  async update(patch, { where, returning = true } = {}) {
    const q = this.query();
    if (typeof where === "function") where(q);
    return q.update(patch, { returning });
  }

  async deleteWhere({ where, returning = false } = {}) {
    const q = this.query();
    if (typeof where === "function") where(q);
    return q.delete({ returning });
  }

  /**
   * Run a unit of work inside a request scope so its queries are attributed
   * for N+1 detection (§13). Repositories that fan out MUST use this.
   */
  async scoped(name, fn) {
    return this.client.scope(name, fn);
  }
}

/**
 * Convert a Supabase failure into a clean domain error.
 * Upstream text never escapes — the client already scrubbed it, and we
 * deliberately do not re-attach `detail` to anything user-facing.
 */
function toDomainError(err, fallbackMessage = "Social data is temporarily unavailable") {
  if (err instanceof SupabaseError) return err;
  return new SupabaseError(fallbackMessage, { status: 503, code: "UPSTREAM" });
}

module.exports = {
  BaseSupabaseRepository,
  toDomainError,
  cursor,
  SupabaseError,
};
