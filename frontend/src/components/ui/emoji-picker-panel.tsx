"use client";

/**
 * Emoji picker PANEL — split out of emoji-picker.tsx in Part 10 (§19).
 *
 * "Do not load a massive emoji library on initial page load. Lazy-load emoji
 * picker only when it is opened."
 *
 * The trigger button renders in the composer on every screen of every
 * conversation, but the panel is only ever seen after a deliberate tap. In
 * one module, the panel's grid, its positioning maths and its portal all
 * shipped in the initial bundle for every message the user never opened it
 * for. Moving it here lets `EmojiButton` pull it in with `next/dynamic` on
 * first open — so the cost is paid by people who use the picker, when they
 * use it, and never at all by people who do not.
 */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

const GROUPS: { label: string; emojis: string[] }[] = [
  {
    label: "Frequent",
    emojis: ["❤️", "🔥", "🎉", "👏", "😂", "🙌", "🚀", "💡", "✅", "⭐", "💯", "🤝"],
  },
  {
    label: "Reactions",
    emojis: ["👍", "👎", "😍", "😮", "😢", "😅", "🤔", "😴", "🤯", "😎", "🥳", "😇"],
  },
  {
    label: "Builders",
    emojis: ["💻", "⌨️", "🛠️", "⚙️", "🧠", "🤖", "📱", "🔧", "🧪", "📊", "🗂️", "🔍"],
  },
  {
    label: "Events",
    emojis: ["🎪", "🎤", "🏆", "🥇", "🎯", "📅", "⏰", "🎓", "🏅", "🎖️", "🎊", "🎈"],
  },
  {
    label: "Expressions",
    emojis: ["😀", "😃", "😄", "😁", "😆", "😊", "🙂", "😉", "😋", "😜", "🤩", "🥰"],
  },
  {
    label: "Objects",
    emojis: ["📚", "✏️", "📝", "🎨", "🎵", "🎸", "📷", "🎬", "🍕", "☕", "🌟", "⚡"],
  },
];

const RECENTS_KEY = "eventhub.recent-emojis";
const RECENTS_MAX = 12;

function readRecents(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENTS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((e) => typeof e === "string").slice(0, RECENTS_MAX) : [];
  } catch {
    return [];
  }
}

function pushRecent(emoji: string) {
  try {
    const next = [emoji, ...readRecents().filter((e) => e !== emoji)].slice(0, RECENTS_MAX);
    window.localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  } catch {
    /* storage disabled — recents are a convenience, not a feature */
  }
}

export interface EmojiPickerProps {
  open: boolean;
  onClose: () => void;
  onSelect: (emoji: string) => void;
  /** Element the picker anchors to. Flips above it when space below is short. */
  anchorRef: React.RefObject<HTMLElement | null>;
  className?: string;
  /** §14 — "open above keyboard on mobile": bias placement upward. */
  preferAbove?: boolean;
}

export function EmojiPicker({ open, onClose, onSelect, anchorRef, className, preferAbove = false }: EmojiPickerProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [recents, setRecents] = useState<string[]>([]);
  const [pos, setPos] = useState<{ top: number; left: number; placement: "top" | "bottom" } | null>(null);

  useEffect(() => {
    if (open) setRecents(readRecents());
  }, [open]);

  /* Position — recomputed on open, scroll and resize so the panel never
     hangs off-screen or sits under the mobile keyboard. */
  useEffect(() => {
    if (!open) return;
    const place = () => {
      const anchor = anchorRef.current;
      const panel = panelRef.current;
      if (!anchor || !panel) return;
      const a = anchor.getBoundingClientRect();
      const h = panel.offsetHeight || 300;
      const w = panel.offsetWidth || 320;
      const margin = 8;

      const spaceBelow = window.innerHeight - a.bottom;
      const spaceAbove = a.top;
      const placement: "top" | "bottom" =
        preferAbove || (spaceBelow < h + margin && spaceAbove > spaceBelow) ? "top" : "bottom";

      const top = placement === "top" ? Math.max(margin, a.top - h - margin) : Math.min(a.bottom + margin, window.innerHeight - h - margin);
      const left = Math.min(Math.max(margin, a.left), Math.max(margin, window.innerWidth - w - margin));
      setPos({ top, left, placement });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    window.visualViewport?.addEventListener("resize", place);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      window.visualViewport?.removeEventListener("resize", place);
    };
  }, [open, anchorRef, preferAbove]);

  // Outside click + Escape
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t)) return;
      if (anchorRef.current?.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown, { passive: true });
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose, anchorRef]);

  if (!open) return null;

  /* Deliberately NOT a `useMemo`. This used to be one, and it sat BELOW the
   * `if (!open) return null` above — a conditional hook. The first render
   * (closed) called fewer hooks than the second (open), which is exactly the
   * "Rendered more hooks than during the previous render" crash. Building a
   * seven-entry array is cheaper than the memo bookkeeping anyway, so the
   * hazard is removed rather than reordered. */
  const groups = [...GROUPS];
  if (recents.length) groups.unshift({ label: "Recent", emojis: recents });

  const pick = (emoji: string) => {
    pushRecent(emoji);
    setRecents(readRecents());
    onSelect(emoji);
  };

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Emoji picker"
      className={cn(
        "fixed z-[100] w-[19rem] max-w-[calc(100vw-1rem)] overflow-hidden rounded-xl border border-outline-variant bg-surface-container-lowest elevation-float",
        className
      )}
      style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}
    >
      <div className="max-h-[16rem] overflow-y-auto overscroll-contain p-2">
        {groups.map((g) => (
          <div key={g.label} className="mb-1.5">
            <p className="px-1 pb-1 text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">{g.label}</p>
            <div role="grid" aria-label={g.label} className="grid grid-cols-8 gap-0.5">
              {g.emojis.map((e) => (
                <button
                  key={`${g.label}-${e}`}
                  type="button"
                  onClick={() => pick(e)}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-lg transition-transform hover:bg-surface-container hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  aria-label={`Insert ${e}`}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>,
    document.body
  );
}

