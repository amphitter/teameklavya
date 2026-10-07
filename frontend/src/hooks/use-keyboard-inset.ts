"use client";

/**
 * Mobile keyboard inset (Part 11 — mobile polish)
 * ──────────────────────────────────────────────
 * iOS does not resize the layout viewport when the keyboard opens, so a
 * full-height panel keeps its footer at the bottom of the SCREEN — which the
 * keyboard is now covering. The composer solved this for itself in Part 10
 * with `visualViewport`; sheets need the same treatment, so the maths lives
 * here and the element owns its own CSS variable (`--kb-inset`), never a
 * document-wide one.
 *
 * Usage:
 *   const panelRef = useKeyboardInset<HTMLDivElement>();
 *   <div ref={panelRef}>
 *     <div style={{ paddingBottom: "max(var(--kb-inset, 0px), env(safe-area-inset-bottom, 0px))" }}>
 *
 * The `max()` matters on both counts: with the keyboard closed the home
 * indicator still needs its inset, and with the keyboard open the keyboard's
 * height wins because it is the larger of the two.
 */

import { useEffect, useRef } from "react";

export function useKeyboardInset<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    if (!vv) return;

    const apply = () => {
      const el = ref.current;
      if (!el) return;
      /* How much of the layout viewport the keyboard (or any other overlay
       * chrome) is hiding. offsetTop covers the case where the browser has
       * scrolled the visual viewport instead of resizing it — without it the
       * footer jumps by the scroll amount on some Android builds. */
      const hidden = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      if (hidden > 8) el.style.setProperty("--kb-inset", `${Math.round(hidden)}px`);
      else el.style.removeProperty("--kb-inset");
    };

    apply();
    vv.addEventListener("resize", apply);
    vv.addEventListener("scroll", apply);
    return () => {
      vv.removeEventListener("resize", apply);
      vv.removeEventListener("scroll", apply);
    };
  }, []);

  return ref;
}

/** The padding every sheet footer should carry. */
export const SHEET_FOOTER_PADDING = "max(var(--kb-inset, 0px), env(safe-area-inset-bottom, 0px))";
