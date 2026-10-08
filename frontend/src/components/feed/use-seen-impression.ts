"use client";

/**
 * Feed impressions (§23–§25) — "seen" that is decided by the server, not by a
 * component mounting.
 *
 * The brief is precise about the shape of this, and each clause rules out the
 * obvious lazy version:
 *
 *   "not frontend-state-only"          → impressions go to the database
 *   "only after meaningful visibility" → ≥50% of the card on screen for ≥1.2s
 *   "no marking every mounted component" → a mount alone records nothing
 *   "batch impression updates"         → one request per ~4s window, at most
 *   "never one request per scroll event" → a Set, flushed on a timer
 *
 * Ordering matters too: the two seconds between a card appearing and its
 * impression being queued are spent entirely in the browser. A user who scrolls
 * past twenty posts in three seconds sends one small request, or none at all.
 *
 * The flush also runs on `pagehide`, so a reader who closes the tab mid-scroll
 * still contributes what they actually read. That one uses `fetch` with
 * `keepalive`, which is the only way a request survives the document going
 * away without putting the session token into a URL where it would end up in
 * logs (`sendBeacon` cannot set headers, and rewriting an endpoint to accept
 * `?token=` is worse than losing an impression).
 */

import { useEffect, useRef } from "react";
import { API_ORIGIN, api } from "@/utils/api";

/** How much of the card must be visible, and for how long. */
const MIN_RATIO = 0.5;
const MIN_VISIBLE_MS = 1200;
/** Queue discipline. The cap mirrors the server's MAX_BATCH (60). */
const FLUSH_EVERY_MS = 4000;
const MAX_QUEUE = 40;

const queue = new Set<string>();
let timer: ReturnType<typeof setTimeout> | null = null;

/** One request for everything queued — never one per card. */
function flush(useUnloadSafe = false) {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (!queue.size) return;
  const postIds = Array.from(queue).slice(0, MAX_QUEUE);
  queue.clear();

  if (useUnloadSafe && typeof window !== "undefined" && typeof fetch === "function") {
    try {
      const token = window.localStorage.getItem("token");
      fetch(`${API_ORIGIN}/api/posts/impressions`, {
        method: "POST",
        keepalive: true,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ postIds }),
      }).catch(() => {});
      return;
    } catch {
      /* fall through to the normal path */
    }
  }

  api.post("/posts/impressions", { postIds }).catch(() => {
    /* Impressions are telemetry, not a user action: a failure is silent by
       design. Nothing is retried, because a retry queue that survives a few
       failures eventually floods the endpoint it was meant to protect. */
  });
}

function enqueue(postId: string) {
  if (queue.has(postId)) return;
  queue.add(postId);
  if (queue.size >= MAX_QUEUE) {
    flush();
    return;
  }
  if (!timer) timer = setTimeout(() => flush(), FLUSH_EVERY_MS);
}

/** Flush on the way out, and whenever the tab is hidden. */
if (typeof window !== "undefined") {
  if (!(window as any).__part14ImpressionsBound) {
    (window as any).__part14ImpressionsBound = true;
    window.addEventListener("pagehide", () => flush(true));
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flush(true);
    });
  }
}

/**
 * Marks `ref` as seen once it has been genuinely on screen — but only when the
 * viewer is signed in and is not the author. Your own post appearing on your own
 * screen is not an impression; recording it would only teach the feed to hide
 * your own content from you.
 */
export function useSeenImpression(
  ref: React.RefObject<HTMLElement | null>,
  postId: string | undefined,
  eligible: boolean
) {
  const marked = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || !postId || !eligible || marked.current) return;
    if (typeof IntersectionObserver === "undefined") return;

    let timerId: ReturnType<typeof setTimeout> | null = null;

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio >= MIN_RATIO) {
            if (timerId) continue;
            timerId = setTimeout(() => {
              timerId = null;
              if (marked.current) return;
              /* A card can be "intersecting" in a background tab; a reader who
                 is not looking at the page has not seen anything. */
              if (document.visibilityState !== "visible") return;
              marked.current = true;
              enqueue(postId);
              io.disconnect();
            }, MIN_VISIBLE_MS);
          } else if (timerId) {
            /* Scrolled away before the threshold was met: cancel. This is the
               clause that stops a fast scroll from marking the whole feed. */
            clearTimeout(timerId);
            timerId = null;
          }
        }
      },
      { threshold: [MIN_RATIO] }
    );

    io.observe(el);
    return () => {
      if (timerId) clearTimeout(timerId);
      io.disconnect();
    };
  }, [ref, postId, eligible]);
}
