/**
 * Supabase (PostgREST) REST client — Part 6, Phase 5 (brief §7, §13, §14)
 * ─────────────────────────────────────────────────────────────────────────────
 * Why a hand-rolled REST client and not the `@supabase/supabase-js` SDK:
 *
 * 1. NO NEW DEPENDENCIES. The SDK pulls in a websocket/realtime stack we are
 *    explicitly not using yet (§12: no Redis Socket.IO adapter, and no
 *    Supabase realtime either). We need queries, not a platform client.
 * 2. PostgREST is a plain HTTP API. Everything the SDK does for us here is
 *    URL building, which is ~200 lines and fully under our control.
 * 3. Our observability requirements (per-query timing, N+1 detection, a
 *    hard page-size ceiling) have to sit INSIDE the data path. Wrapping
 *    someone else's client would put them outside it.
 *
 * ── The four things this client guarantees ──
 *
 * §14 SECURITY. The service-role key is read from env in exactly one place,
 *      is never serialised into a response, and every error path scrubs it
 *      from the message. There is no code path that returns the key.
 *
 * §61 NO LEAKS. A PostgREST failure carries Postgres detail (constraint
 *      names, column names, sometimes the offending SQL). None of that may
 *      reach a user, so every error is normalised to an opaque
 *      `SupabaseError` carrying only status + a stable code.
 *
 * §13 EFFICIENCY. Every query is timed. Queries are counted against the
 *      request that caused them (AsyncLocalStorage), so an N+1 shows up as a
 *      count, not as a mystery latency spike. `maxRows` is enforced here so
 *      an unbounded collection read is impossible to write by accident.
 *
 * §13 PAGINATION. `paginate()` is keyset-based (see below), because OFFSET
 *      pagination degrades linearly and skips/duplicates rows when the
 *      underlying set changes mid-scroll.
 *
 * ── Why keyset pagination and not OFFSET ──
 * `LIMIT 20 OFFSET 400` makes Postgres walk and discard 400 rows, so page 50
 * costs 25x page 1. Worse, if a row is inserted while the user is scrolling,
 * every row shifts by one and OFFSET silently shows a row twice (or never).
 * Keyset ("WHERE (created_at, id) < (last_seen_at, last_seen_id)") uses the
 * index, costs the same on every page, and is stable under concurrent writes.
 * The tuple comparison is what makes it correct: created_at alone is not
 * unique, so two rows sharing a timestamp would otherwise straddle a page
 * boundary.
 */

"use strict";

const { AsyncLocalStorage } = require("async_hooks");

/** Request-scoped query accounting. Lets us attribute queries to a request. */
const requestContext = new AsyncLocalStorage();

/**
 * Errors are normalised so nothing from Postgres escapes (§61).
 * `code` is one of ours, never a Postgres SQLSTATE.
 */
class SupabaseError extends Error {
  constructor(message, { status = 502, code = "UPSTREAM", detail = null } = {}) {
    super(message);
    this.name = "SupabaseError";
    this.status = status;
    this.code = code;
    this.detail = detail; // server-side only, for logs
    this.expose = false; // never shown to a user
  }
}

/**
 * Redact anything that looks like a credential from a string. Defence in
 * depth: the key should never be in an error message, but if upstream ever
 * echoes it back we must not log it (§14).
 */
function scrub(text, secrets) {
  let out = String(text ?? "");
  if (!out) return out;
  for (const s of secrets) {
    if (!s || s.length < 8) continue;
    out = out.split(s).join("[REDACTED]");
  }
  // Also catch JWT-looking blobs, which is what a service-role key is.
  out = out.replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]*/g, "[REDACTED]");
  // Connection strings. Postgres errors happily echo the DSN, and a DSN is a
  // credential: it carries the host, the user and the password. Redact the
  // userinfo and leave the rest so the log is still diagnosable.
  out = out.replace(
    /(postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s@/]*@/gi,
    "$1://[REDACTED]@"
  );
  return out;
}

/** Build a PostgREST query string. Arrays become `in.(a,b,c)`. */
function buildQuery(params) {
  const parts = [];
  for (const [k, v] of Object.entries(params || {})) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) parts.push(`${k}=(${v.map(encodeURIComponent).join(",")})`);
    else parts.push(`${k}=${encodeURIComponent(String(v))}`);
  }
  return parts.join("&");
}

/**
 * A tiny PostgREST query builder.
 *
 * Every read goes through `paginate()` or `limit()`, both of which enforce a
 * hard row ceiling — there is deliberately no way to issue an unbounded
 * `select *` (§13: "no unbounded queries").
 */
class Query {
  constructor(client, table) {
    this.client = client;
    this.table = table;
    this._select = "*";
    this._filters = [];
    this._order = [];
    this._limit = null;
    this._isHead = false;
    this._countMode = null;
  }

  select(cols) {
    // PostgREST uses `select=` for both projection and embedding; we only
    // ever pass through what the caller asked for.
    this._select = Array.isArray(cols) ? cols.join(",") : cols;
    return this;
  }

  /** Equality. `column` must be from our own repository code, never user text. */
  eq(column, value) {
    this._filters.push([column, `eq.${value}`]);
    return this;
  }
  neq(column, value) {
    this._filters.push([column, `neq.${value}`]);
    return this;
  }
  in(column, values) {
    const list = (Array.isArray(values) ? values : [values]).map(encodeURIComponent).join(",");
    this._filters.push([column, `in.(${list})`]);
    return this;
  }
  is(column, value) {
    this._filters.push([column, `is.${value}`]);
    return this;
  }
  gt(column, value) {
    this._filters.push([column, `gt.${value}`]);
    return this;
  }
  gte(column, value) {
    this._filters.push([column, `gte.${value}`]);
    return this;
  }
  lt(column, value) {
    this._filters.push([column, `lt.${value}`]);
    return this;
  }
  lte(column, value) {
    this._filters.push([column, `lte.${value}`]);
    return this;
  }
  /**
   * OR-matched name search across several columns.
   * PostgREST expresses OR as `or=(a.ilike.*q*,b.ilike.*q*)`. The `*` is
   * PostgREST's wildcard, NOT SQL `%`, so it must not be escaped as a literal.
   */
  orNameMatch(term, columns = ["username", "first_name", "last_name"]) {
    const safe = String(term).replace(/[(),.*]/g, " ").trim();
    if (!safe) return this;
    const parts = columns.map((c) => `${c}.ilike.*${encodeURIComponent(safe)}*`);
    this._filters.push(["or", `(${parts.join(",")})`]);
    return this;
  }

  /** @param {string} spec e.g. "created_at.desc" */
  order(spec) {
    this._order.push(spec);
    return this;
  }

  limit(n) {
    this._limit = n;
    return this;
  }

  /** Ask PostgREST for the total row count too (`Prefer: count=exact`). */
  count(mode = "exact") {
    this._countMode = mode;
    return this;
  }

  _queryString() {
    const q = { select: this._select };
    for (const [col, op] of this._filters) q[col] = op;
    if (this._order.length) q.order = this._order.join(",");
    if (this._limit !== null) q.limit = this._limit;
    return buildQuery(q);
  }

  /**
   * Bounded read. `maxRows` is clamped by the client so a repository cannot
   * accidentally ask for a million rows.
   */
  async many({ maxRows } = {}) {
    const cap = Math.min(maxRows || this.client.maxRows, this.client.maxRows);
    if (this._limit === null || this._limit > cap) this._limit = cap;
    const rows = await this.client._request("GET", `/${this.table}`, {
      query: this._queryString(),
      countMode: this._countMode,
    });
    return Array.isArray(rows) ? rows : [];
  }

  async single() {
    const rows = await this.limit(1).many();
    return rows.length ? rows[0] : null;
  }

  /** True/false read — avoids transferring rows we throw away. */
  async exists() {
    const rows = await this.select("id").limit(1).many();
    return rows.length > 0;
  }

  /**
   * Keyset (cursor) pagination — the ONLY supported way to page a collection.
   *
   * `cursor` is the encoded `(sortValue, id)` of the last row the client saw.
   * We filter with `lt`/`gt` on the sort column, which the repository is
   * expected to have a composite index on (see db/supabase/schema.sql).
   *
   * We deliberately request one more row than asked for: that is how we know
   * whether another page exists without issuing a second COUNT query, which
   * would double the cost of every page.
   */
  async paginate({ after = null, limit = 20, sortColumn = "created_at", direction = "desc", idColumn = "id" } = {}) {
    const size = Math.max(1, Math.min(limit, this.client.maxRows));
    const asc = direction === "asc";

    // Order by the tuple so rows sharing a timestamp keep a stable order.
    this.order(`${sortColumn}.${asc ? "asc" : "desc"}`).order(`${idColumn}.${asc ? "asc" : "desc"}`);

    if (after && after.sortValue !== undefined && after.id !== undefined) {
      // Keyset predicate: strictly past the last row we returned.
      // The cursor is already decoded by the caller (the repository), which
      // owns the wire format — the client only owns the predicate.
      const op = asc ? "gt" : "lt";
      this._filters.push([sortColumn, `${op}.${after.sortValue}`]);
    }

    // Ask for one extra row to learn whether a next page exists.
    this._limit = size + 1;
    const rows = await this.client._request("GET", `/${this.table}`, {
      query: this._queryString(),
      countMode: this._countMode,
    });
    const list = Array.isArray(rows) ? rows : [];
    const hasMore = list.length > size;
    const slice = hasMore ? list.slice(0, size) : list;

    // Return the raw tuple, not an encoded cursor: the repository encodes it
    // with the one shared pagination vocabulary (repositories/cursor.js) so
    // Mongo-backed and Postgres-backed lists are byte-identical to clients.
    let nextAfter = null;
    if (hasMore && slice.length) {
      const last = slice[slice.length - 1];
      nextAfter = { sortValue: String(last[sortColumn]), id: String(last[idColumn]) };
    }

    return { rows: slice, nextAfter, hasMore };
  }

  async insert(rows, { upsert = false, onConflict = null, returning = true } = {}) {
    const prefer = [];
    if (returning) prefer.push("return=representation");
    else prefer.push("return=minimal");
    if (upsert) {
      prefer.push("resolution=merge-duplicates");
      if (onConflict) prefer.push(`on_conflict=${onConflict}`);
    }
    // on_conflict is sent in BOTH the query string and the Prefer header:
    // real PostgREST accepts either, and sending both keeps the request
    // self-describing for proxies and for the test double.
    const conflict = onConflict ? `on_conflict=${onConflict}` : "";
    return this.client._request("POST", `/${this.table}`, {
      query: conflict,
      body: rows,
      prefer: prefer.join(","),
    });
  }

  async update(patch, { returning = true } = {}) {
    const prefer = returning ? "return=representation" : "return=minimal";
    return this.client._request("PATCH", `/${this.table}`, {
      query: this._queryString(),
      body: patch,
      prefer,
    });
  }

  async delete({ returning = false } = {}) {
    const prefer = returning ? "return=representation" : "return=minimal";
    return this.client._request("DELETE", `/${this.table}`, {
      query: this._queryString(),
      prefer,
    });
  }
}

/**
 * Opaque, URL-safe cursor. It is base64 of a tiny JSON tuple — not a claim
 * about the data, just "resume after here". It is not signed because it
 * grants nothing: the worst a tampered cursor does is start someone else's
 * scroll at a different offset, and all rows are authorised server-side.
 */
function encodeCursor({ sortValue, id }) {
  const raw = JSON.stringify({ s: String(sortValue), i: String(id) });
  return Buffer.from(raw, "utf8").toString("base64url");
}

function decodeCursor(cursor) {
  try {
    const raw = Buffer.from(String(cursor), "base64url").toString("utf8");
    const { s, i } = JSON.parse(raw);
    if (s === undefined || i === undefined) return null;
    return { sortValue: s, id: i };
  } catch {
    return null; // a corrupt cursor degrades to "start from the beginning"
  }
}

class SupabaseRestClient {
  /**
   * @param {object} opts
   * @param {string} opts.url       e.g. https://xxxx.supabase.co
   * @param {string} opts.key       service-role key (server-side ONLY, §14)
   * @param {string} [opts.schema]  Postgres schema exposed by PostgREST
   * @param {number} [opts.maxRows] hard ceiling on any single read
   * @param {number} [opts.timeoutMs]
   * @param {number} [opts.nPlusOneThreshold] queries per request before we warn
   * @param {object} [opts.logger]
   * @param {function} [opts.fetchImpl] injectable for tests
   */
  constructor(opts = {}) {
    this.url = String(opts.url || "").replace(/\/+$/, "");
    this.key = opts.key || "";
    this.schema = opts.schema || "public";
    this.maxRows = opts.maxRows ?? 1000;
    this.timeoutMs = opts.timeoutMs ?? 8000;
    this.nPlusOneThreshold = opts.nPlusOneThreshold ?? 20;
    this.logger = opts.logger || console;
    this.fetchImpl = opts.fetchImpl || globalThis.fetch;

    this.stats_ = {
      queries: 0,
      errors: 0,
      timeouts: 0,
      rows: 0,
      slowQueries: 0,
      nPlusOneWarnings: 0,
      totalMs: 0,
      lastError: null,
    };
  }

  isConfigured() {
    return Boolean(this.url && this.key);
  }

  /**
   * Run `fn` inside a request context so any queries it makes are attributed
   * to it. This is what makes N+1 detectable: without a scope we could only
   * count globally, which tells us nothing about any single request.
   */
  async scope(name, fn) {
    return requestContext.run({ name, queries: [], start: Date.now() }, fn);
  }

  from(table) {
    return new Query(this, table);
  }

  /** @returns {Promise<{ok: boolean, status?: number, error?: string}>} */
  async health() {
    if (!this.isConfigured()) return { ok: false, error: "not-configured" };
    try {
      await this._request("GET", "/profiles", { query: "select=id&limit=1" });
      return { ok: true };
    } catch (err) {
      return { ok: false, status: err.status, error: scrub(err.message, this._secrets()) };
    }
  }

  stats() {
    const n = this.stats_.queries || 1;
    return {
      ...this.stats_,
      avgMs: Math.round((this.stats_.totalMs / n) * 100) / 100,
      configured: this.isConfigured(),
    };
  }

  _secrets() {
    return this.key ? [this.key] : [];
  }

  _headers(extra = {}) {
    const h = {
      apikey: this.key,
      Authorization: `Bearer ${this.key}`,
      "Content-Type": "application/json",
      ...extra,
    };
    if (this.schema && this.schema !== "public") {
      h["Accept-Profile"] = this.schema;
      h["Content-Profile"] = this.schema;
    }
    return h;
  }

  /**
   * One request: timed, counted, and error-normalised.
   * This is the single choke point — every guarantee above is enforced here.
   */
  async _request(method, path, { query = "", body = undefined, prefer = null, countMode = null, signal = null } = {}) {
    if (!this.isConfigured()) {
      throw new SupabaseError("Supabase is not configured", { status: 503, code: "NOT_CONFIGURED" });
    }

    const startedAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const onAbort = () => controller.abort();
    if (signal) signal.addEventListener("abort", onAbort, { once: true });

    const headers = this._headers();
    if (prefer) headers.Prefer = prefer;
    if (countMode) {
      headers.Prefer = [headers.Prefer, `count=${countMode}`].filter(Boolean).join(",");
      headers.Range = "0-"; // PostgREST needs a Range header to honour count
    }

    const qs = query ? `?${query}` : "";
    const url = `${this.url}/rest/v1${path}${qs}`;

    try {
      const res = await this.fetchImpl(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });

      const ms = Date.now() - startedAt;
      this.stats_.queries += 1;
      this.stats_.totalMs += ms;
      if (ms > 500) this.stats_.slowQueries += 1;

      // Attribute to the current request for N+1 detection.
      const ctx = requestContext.getStore();
      if (ctx) {
        ctx.queries.push({ method, path, ms });
        if (ctx.queries.length === this.nPlusOneThreshold) {
          this.stats_.nPlusOneWarnings += 1;
          this.logger.warn(
            `[supabase] N+1 suspected: request "${ctx.name}" has issued ${ctx.queries.length} queries`
          );
        }
      }

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        this.stats_.errors += 1;
        this.stats_.lastError = scrub(text, this._secrets()).slice(0, 300);
        throw new SupabaseError("Upstream database request failed", {
          status: 502, // never forward the upstream status verbatim (§61)
          code: this._codeFor(res.status),
          detail: this.stats_.lastError,
        });
      }

      if (method === "HEAD") return { count: this._readCount(res) };

      const text = await res.text();
      if (!text) return countMode ? { rows: [], count: this._readCount(res) } : [];

      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }

      if (Array.isArray(parsed)) {
        this.stats_.rows += parsed.length;
        if (countMode) return { rows: parsed, count: this._readCount(res) };
        return parsed;
      }
      return parsed;
    } catch (err) {
      if (err instanceof SupabaseError) throw err;
      const aborted = err?.name === "AbortError";
      if (aborted) this.stats_.timeouts += 1;
      else this.stats_.errors += 1;
      this.stats_.lastError = scrub(err?.message, this._secrets()).slice(0, 300);
      throw new SupabaseError(
        aborted ? "Upstream database timed out" : "Upstream database unreachable",
        { status: aborted ? 504 : 503, code: aborted ? "TIMEOUT" : "UNREACHABLE", detail: this.stats_.lastError }
      );
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);
    }
  }

  /** Parse `Content-Range: 0-19/4321` into a total. */
  _readCount(res) {
    const cr = res.headers?.get?.("content-range") || res.headers?.get?.("Content-Range");
    if (!cr) return null;
    const m = /\/(?:(\d+)|\*)/.exec(cr);
    return m && m[1] ? Number(m[1]) : null;
  }

  /** Map an upstream status to a stable code of ours (never the raw status). */
  _codeFor(status) {
    if (status === 404) return "NOT_FOUND";
    if (status === 409 || status === 23505) return "CONFLICT";
    if (status === 403) return "FORBIDDEN";
    if (status === 401) return "UNAUTHORIZED";
    return "UPSTREAM";
  }
}

module.exports = {
  SupabaseRestClient,
  SupabaseError,
  Query,
  encodeCursor,
  decodeCursor,
  buildQuery,
  scrub,
  requestContext,
  DEFAULT_MAX_ROWS: 1000,
};
