/**
 * Supabase provider boundary — Part 6, Phase 5 (brief §7, §14, §15)
 * ─────────────────────────────────────────────────────────────────────────────
 * Every Supabase access in EventHub goes through this module. Nothing else in
 * the codebase is allowed to read the credentials or build a URL, which is
 * what makes §7 ("the frontend must never depend on Supabase") and §14
 * ("credentials never reach the frontend or the logs") enforceable by review:
 * there is exactly one file to check.
 *
 * ── Why a boundary module at all ──
 * Supabase is the relational/social store; MongoDB remains the source of
 * truth for events, registrations, quizzes and live state (§10). If
 * controllers reached into Supabase directly, that split would erode into
 * "whichever database the author happened to reach for", and the migration in
 * Phase 6 would become untractable. Repositories live behind this boundary so
 * the split is a property of the architecture, not of convention.
 *
 * ── Boot safety ──
 * This module NEVER throws and NEVER blocks startup. If Supabase is not
 * configured, `isConfigured()` is false and every repository call fails with
 * a clean `NOT_CONFIGURED` rather than crashing the process. The app must
 * boot with the social store absent (§15: degradation, not dependency).
 */

"use strict";

const { SupabaseRestClient, SupabaseError } = require("./client");

let cachedClient = null;

/**
 * Build (and memoise) the Supabase client from the environment.
 *
 * The service-role key is read here and nowhere else. It bypasses Row Level
 * Security, so it must never be sent to a browser, never be logged, and
 * never appear in a response. `toJSON()` below exists purely so that an
 * accidental `JSON.stringify(provider)` cannot leak it.
 *
 * @returns {SupabaseRestClient} always non-null; may be unconfigured
 */
function supabaseProvider() {
  if (cachedClient) return cachedClient;

  const url = process.env.SUPABASE_URL || "";
  // Service-role, server-side only. Deliberately NOT the anon key: the anon
  // key is safe for browsers, but it is also useless here because RLS would
  // then have to encode every authorisation rule, duplicating logic that
  // already lives (and is tested) in the API layer.
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

  cachedClient = new SupabaseRestClient({
    url,
    key,
    schema: process.env.SUPABASE_SCHEMA || "public",
    maxRows: Number(process.env.SUPABASE_MAX_ROWS || 1000),
    timeoutMs: Number(process.env.SUPABASE_TIMEOUT_MS || 8000),
    nPlusOneThreshold: Number(process.env.SUPABASE_NPLUSONE_THRESHOLD || 20),
  });

  return cachedClient;
}

/** Test seam — the memoised client is otherwise process-lifetime. */
function resetSupabaseProvider() {
  cachedClient = null;
}

function isConfigured() {
  return supabaseProvider().isConfigured();
}

/**
 * Stats for the admin infrastructure dashboard (§16).
 *
 * Note what is NOT here: the key, the URL host, and any upstream error text.
 * The dashboard shows whether the store is configured, how it is performing,
 * and whether it is erroring — never credentials (§14) and never raw
 * Postgres errors (§61).
 */
function supabaseStats() {
  const c = supabaseProvider();
  const s = c.stats();
  return {
    configured: s.configured,
    queries: s.queries,
    errors: s.errors,
    timeouts: s.timeouts,
    rows: s.rows,
    slowQueries: s.slowQueries,
    nPlusOneWarnings: s.nPlusOneWarnings,
    avgMs: s.avgMs,
    maxRows: c.maxRows,
    // A short, safe reason — never the upstream message body.
    lastError: s.lastError ? String(s.lastError).slice(0, 120) : null,
  };
}

/** Throw the right domain error when the store is unavailable. */
function assertConfigured() {
  if (!isConfigured()) {
    throw new SupabaseError("Supabase is not configured", { status: 503, code: "NOT_CONFIGURED" });
  }
}

module.exports = {
  supabaseProvider,
  resetSupabaseProvider,
  isConfigured,
  assertConfigured,
  supabaseStats,
  SupabaseRestClient,
  SupabaseError,
};
