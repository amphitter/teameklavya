"use client";

/**
 * Emoji trigger (§19).
 *
 * The panel it opens lives in a separate module and is fetched on first use
 * (see emoji-picker-panel.tsx for why). This file stays deliberately tiny:
 * it is mounted in the composer of every conversation.
 */

import { useRef, useState } from "react";
import dynamic from "next/dynamic";
import { cn } from "@/lib/utils";

const EmojiPicker = dynamic(
  () => import("@/components/ui/emoji-picker-panel").then((m) => m.EmojiPicker),
  { ssr: false }
);

/** Trigger button that owns the open state — keeps callers tidy. */
export function EmojiButton({
  onSelect,
  preferAbove = false,
  className,
}: {
  onSelect: (emoji: string) => void;
  preferAbove?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        ref={ref}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex h-11 w-11 shrink-0 touch-manipulation items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
          className
        )}
        aria-label="Insert emoji"
        aria-expanded={open}
      >
        <span className="material-symbols-outlined text-[20px] leading-none">sentiment_satisfied</span>
      </button>
      <EmojiPicker
        open={open}
        anchorRef={ref}
        preferAbove={preferAbove}
        onClose={() => setOpen(false)}
        onSelect={(e) => {
          onSelect(e);
          setOpen(false);
        }}
      />
    </>
  );
}
