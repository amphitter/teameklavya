/**
 * What the feed shows — decided in ONE place, as a pure function.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 *
 * Part 16 built the fresh → old boundary: the fresh stream first, then history
 * below it once the fresh stream is spent. The gate for "history may load" was
 * `boundaryIndex >= 0` — i.e. history was only fetched when the fresh stream
 * actually CONTAINED a demoted (already-seen) card to draw the boundary at.
 *
 * That left the empty case unhandled. When nothing new came back at all —
 * every candidate seen or liked, the pool spent, a tab with no fresh rows —
 * `boundaryIndex` stayed -1, history was never fetched, and the viewer got the
 * onboarding panel ("Your event story starts here") with their own history
 * sitting one query away and no way to reach it. The worse the case (an active
 * user who has seen everything), the more reliably it happened.
 *
 * The rule now: **nothing new to show means show what there is.** History is
 * the fallback, not a reward for scrolling to the bottom.
 *
 * ── THE BRANCHES ────────────────────────────────────────────────────────────
 *
 *   the fresh stream is loading          → skeletons (it owns the first paint)
 *   the fresh stream failed              → the retry panel. The only error that
 *                                          blocks: history is a fallback, and
 *                                          a fallback that cannot load must not
 *                                          take the screen down with it
 *   there are fresh posts                → content
 *   nothing fresh, history in flight     → skeletons, not the empty panel —
 *                                          otherwise a viewer with a full
 *                                          history sees "Your event story
 *                                          starts here" flash before it
 *   nothing fresh, history has rows      → content (the history-only view)
 *   nothing fresh, nothing in history    → the empty panel, which is now truly
 *                                          empty: a brand-new account
 *
 * Kept pure and dependency-free so the branches can be exercised directly,
 * without a browser — a rendering decision like this is worth being able to
 * check in a second rather than only by scrolling a phone.
 */
export type FeedSection = "fresh-loading" | "fresh-error" | "history-loading" | "empty" | "content";

export function resolveFeedSections(input: {
  /** The fresh query's first page is in flight. */
  freshLoading: boolean;
  /** The fresh query failed (network/5xx); history is not a substitute. */
  freshError: boolean;
  /** Fresh posts actually on screen (after removed/archived filtering). */
  freshCount: number;
  /** Whether the old-feed query is allowed to run at all (for-you only). */
  historyEnabled: boolean;
  /** The old-feed query's first page is in flight. */
  historyLoading: boolean;
  /** History rows it has returned that are not already on screen. */
  historyCount: number;
}): FeedSection {
  if (input.freshLoading) return "fresh-loading";
  if (input.freshError) return "fresh-error";
  if (input.freshCount > 0) return "content";

  /* Nothing new. What is behind it? */
  if (input.historyEnabled && input.historyCount > 0) return "content";
  if (input.historyEnabled && input.historyLoading) return "history-loading";
  return "empty";
}

/**
 * Whether the empty stream has to be told that history is coming.
 *
 * The boundary strip ("✓ You're all caught up / Old feed") is normally drawn
 * INSIDE the stream, at the first demoted card. In the history-only view there
 * is no such card — the fresh stream is empty — so the strip has to be drawn
 * above the history section instead. Without it the viewer sees posts with no
 * explanation of why the feed suddenly repeats things they have read.
 */
export function needsBoundaryAboveHistory(input: {
  section: FeedSection;
  /** Index of the first demoted card in the stream; -1 when there is none. */
  boundaryIndex: number;
  historyCount: number;
}): boolean {
  return input.section === "content" && input.boundaryIndex < 0 && input.historyCount > 0;
}
