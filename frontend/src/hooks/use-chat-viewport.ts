"use client";

/**
 * useChatViewport — keeps a full-screen chat glued to the VISIBLE viewport.
 *
 * Why this exists
 * ───────────────
 * On a phone the on-screen keyboard does NOT shrink `100dvh` (iOS Safari never
 * does, Chrome Android only does with `interactive-widget=resizes-content`).
 * Instead the browser either:
 *   - pans the page so the focused input is visible (iOS) -> header scrolls off
 *     the top and the layout "jumps", or
 *   - leaves the layout alone and draws the keyboard over it (Android) -> the
 *     composer sits behind the keyboard.
 *
 * The fix is to size the chat from `window.visualViewport` (the part of the
 * screen the user can actually see) and to cancel the browser's page-pan.
 *
 * Usage (conversation page):
 *   const ref = useChatViewport();
 *   <div ref={ref} className="chat-viewport flex flex-col overflow-hidden"> ... </div>
 *
 * Add to globals.css:
 *   .chat-viewport { position: fixed; left: 0; right: 0; top: 0;
 *                    height: var(--vvh, 100dvh);
 *                    transform: translateY(var(--vvt, 0px)); }
 *   @media (min-width: 1024px) { .chat-viewport { position: static; height: auto; transform: none; } }
 */

import { useEffect, useRef } from "react";

export function useChatViewport<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T>(null);

  useEffect(() => {
    const vv = window.visualViewport;
    const el = ref.current;
    if (!vv || !el) return;

    let raf = 0;
    const apply = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        // Undo any page-pan the browser did to reveal the focused input.
        if (window.scrollY !== 0) window.scrollTo(0, 0);
        el.style.setProperty("--vvh", `${vv.height}px`);
        el.style.setProperty("--vvt", `${vv.offsetTop}px`);
        // Tell children (e.g. the composer) how much keyboard is showing.
        const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
        document.documentElement.style.setProperty("--keyboard-inset", `${kb}px`);
      });
    };

    apply();
    vv.addEventListener("resize", apply);
    vv.addEventListener("scroll", apply);

    // The page itself must never scroll behind a chat.
    const { overflow, overscrollBehavior } = document.documentElement.style;
    document.documentElement.style.overflow = "hidden";
    document.documentElement.style.overscrollBehavior = "none";

    return () => {
      cancelAnimationFrame(raf);
      vv.removeEventListener("resize", apply);
      vv.removeEventListener("scroll", apply);
      document.documentElement.style.overflow = overflow;
      document.documentElement.style.overscrollBehavior = overscrollBehavior;
      document.documentElement.style.removeProperty("--keyboard-inset");
    };
  }, []);

  return ref;
}
