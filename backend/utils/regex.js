/**
 * Regex helpers for user-supplied search strings (Part 5, Phase 3 — §39, §63)
 * ─────────────────────────────────────────────────────────────────────────
 * Two problems this file exists to prevent:
 *
 *  1. INJECTION — a raw user string inside `new RegExp()` is a regex-injection
 *     vector (`.*` or `(a+)+$` style input can also burn CPU). escapeRegex()
 *     neutralises metacharacters everywhere user text meets a regex.
 *
 *  2. FULL COLLECTION SCANS — a case-insensitive regex that is NOT anchored
 *     at the start (`/hack/i`) can never use a B-tree index, so every search
 *     keystroke becomes a collection scan. Anchored prefixes (`/^hack/i`) CAN
 *     use an index. prefixRegex() anchors where the product intent is
 *     type-ahead, and we keep the unanchored form only where substring
 *     matching is genuinely required.
 */

/** Escape every regex metacharacter in user input. */
function escapeRegex(input) {
  return String(input).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Anchored, case-insensitive prefix matcher — index-usable.
 * Returns null for an empty query so callers can skip the query entirely.
 */
function prefixRegex(q) {
  const trimmed = String(q || "").trim();
  if (!trimmed) return null;
  return new RegExp(`^${escapeRegex(trimmed)}`, "i");
}

/**
 * Unanchored, case-insensitive substring matcher.
 * Deliberately NOT index-usable — only for small, already-bounded result
 * sets (e.g. filtering one page of rows), never for primary search paths.
 */
function containsRegex(q) {
  const trimmed = String(q || "").trim();
  if (!trimmed) return null;
  return new RegExp(escapeRegex(trimmed), "i");
}

/** Hard cap on search-string length (§63: maximum query length). */
function clampQuery(q, max = 100) {
  return String(q || "").trim().slice(0, max);
}

module.exports = { escapeRegex, prefixRegex, containsRegex, clampQuery };
