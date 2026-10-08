"use client";

import { useEffect, useRef, useState } from "react";
import { ImagePlus, Paperclip, SendHorizontal, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";
import { EmojiButton } from "@/components/ui/emoji-picker";

export interface MessageComposerProps {
  onSend: (text: string) => void;
  /** Called on every keystroke — the debounce lives in the emitter (§13). */
  onTyping?: () => void;
  onSendImage?: (file: File) => void;
  onSendFile?: (file: File) => void;
  disabled?: boolean;
  /**
   * True while an upload is in flight. NOTE: an in-flight TEXT send does NOT
   * disable the composer (§10) — the optimistic bubble is the feedback, and
   * blocking input behind a network round trip is the exact "stare at a
   * spinner after sending" behaviour the spec forbids.
   */
  sending?: boolean;
  /** Message being replied to — renders a dismissable quote above the input. */
  replyingTo?: { authorName?: string; content?: string; image?: string } | null;
  onCancelReply?: () => void;
  placeholder?: string;
}

const MAX_LEN = 2000;

/**
 * Composer (§30).
 *
 * Enter sends, Shift+Enter inserts a newline — the convention every chat the
 * user has used already follows, so deviating would feel broken.
 *
 * The mobile keyboard is the hard part: iOS does not fire a resize when the
 * keyboard opens, so a `position: sticky` composer gets covered by it. We
 * track `visualViewport` and lift the composer by the keyboard's height via a
 * CSS variable, which keeps it pinned directly above the keyboard rather than
 * merely on-screen.
 */
export function MessageComposer({
  onSend,
  onTyping,
  onSendImage,
  onSendFile,
  disabled,
  sending,
  replyingTo,
  onCancelReply,
  placeholder = "Message…",
}: MessageComposerProps) {
  const [text, setText] = useState("");
  const taRef = useRef<HTMLTextAreaElement>(null);
  const imageRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  /* Keep the composer above the mobile keyboard (§30: "Mobile keyboard must
     not break layout"). */
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const apply = () => {
      const offset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      document.documentElement.style.setProperty("--keyboard-inset", `${offset}px`);
    };
    apply();
    vv.addEventListener("resize", apply);
    vv.addEventListener("scroll", apply);
    return () => {
      vv.removeEventListener("resize", apply);
      vv.removeEventListener("scroll", apply);
      document.documentElement.style.removeProperty("--keyboard-inset");
    };
  }, []);

  // Grow with content up to a cap, then scroll internally.
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
  }, [text]);

  const submit = () => {
    const value = text.trim();
    if (!value || disabled) return;
    onSend(value);
    setText("");
    /* Keep the keyboard up on desktop, where focus is expected to persist.
     * On a touch device the field already holds focus while typing, so
     * re-focusing is unnecessary — and on Android it can round-trip through
     * a keyboard close/open that visibly jolts the composer (§18: "Pressing
     * send should NOT close the keyboard"). */
    if (typeof window !== "undefined" && window.matchMedia?.("(pointer: fine)").matches) {
      requestAnimationFrame(() => taRef.current?.focus());
    }
  };

  // Nothing network-bound gates this: with optimisic sends the next message
  // must be typeable and sendable immediately (§10).
  const canSend = text.trim().length > 0 && !disabled;

  return (
    <div
      /* Part 10 §2, §18, §33.
       *
       * `background` is a flat surface, NOT a backdrop-blur: §33 asks us to
       * avoid expensive backdrop-filter on a surface that is on screen for
       * every frame of a scroll, and this is the hottest surface in the app.
       *
       * The bottom padding is the KEYBOARD inset when the keyboard is up and
       * the SAFE-AREA inset when it is not. The max() matters: on an iPhone
       * the home indicator needs ~34px, but a keyboard needs ~300px, and
       * adding them would float the composer a home-bar's height above the
       * keyboard. Whichever is larger wins. */
      className="shrink-0 border-t border-outline-variant bg-surface-container-lowest"
      style={{
        paddingBottom: "max(var(--keyboard-inset, 0px), env(safe-area-inset-bottom, 0px))",
      }}
    >
      {/* Reply quote (§30) */}
      {replyingTo ? (
        <div className="flex items-center gap-2 border-b border-outline-variant/60 bg-purple-light/50 px-3 py-1.5 text-[12px]">
          <Icon name="reply" size={14} className="shrink-0 text-purple" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-purple">{replyingTo.authorName || "Message"}</p>
            <p className="truncate text-on-surface-variant">{replyingTo.content || (replyingTo.image ? "Photo" : "")}</p>
          </div>
          <button
            type="button"
            onClick={onCancelReply}
            className="rounded-full p-1 text-on-surface-variant hover:bg-surface-container hover:text-on-surface"
            aria-label="Cancel reply"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : null}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="flex items-end gap-1.5 px-2 py-2 sm:gap-2 sm:px-3"
      >
        {onSendImage ? (
          <>
            <input
              ref={imageRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onSendImage(f);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              onClick={() => imageRef.current?.click()}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container hover:text-primary"
              aria-label="Send a photo"
            >
              <ImagePlus className="h-5 w-5" />
            </button>
          </>
        ) : null}

        {onSendFile ? (
          <>
            <input ref={fileRef} type="file" className="hidden" disabled={sending} onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onSendFile(f);
              e.target.value = "";
            }} />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container hover:text-primary sm:flex"
              aria-label="Attach a file"
            >
              <Paperclip className="h-5 w-5" />
            </button>
          </>
        ) : null}

        <EmojiButton
          preferAbove
          onSelect={(emoji) => {
            setText((t) => (t + emoji).slice(0, MAX_LEN));
            taRef.current?.focus();
          }}
        />

        <label className="sr-only" htmlFor="message-input">
          Message
        </label>
        <textarea
          id="message-input"
          ref={taRef}
          rows={1}
          value={text}
          maxLength={MAX_LEN}
          placeholder={placeholder}
          disabled={disabled}
          onChange={(e) => {
            setText(e.target.value);
            onTyping?.();
          }}
          onKeyDown={(e) => {
            // Enter sends; Shift+Enter (and the IME composition guard) newline.
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          /* The textarea grows to 8.25rem and then scrolls internally. With
             the default `overflow: auto`, once the text passes that cap the
             browser draws the app's global 10px webkit scrollbar INSIDE the
             pill — a scrollbar sitting in the message box. Hidden here via the
             project's own `.no-scrollbar` utility plus `scrollbar-width` for
             Firefox; wheel, drag and arrow-key scrolling all still work. */
          /* §84 — the 16px floor for focus, on phones only.
               iOS zooms the page when a focused input's font-size is under
               16px; the composer was 15px, so tapping it magnified the whole
               thread. From `sm` it returns to its designed 15px. */
          className="no-scrollbar max-h-[8.25rem] min-h-[2.5rem] flex-1 resize-none overflow-y-auto [scrollbar-width:none] rounded-2xl border border-outline-variant bg-surface px-3.5 py-2.5 text-base leading-snug outline-none placeholder:text-on-surface-variant/70 focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/12 disabled:opacity-60 sm:text-[15px]"
        />

        <button
          type="submit"
          disabled={!canSend}
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-all",
            canSend
              ? "brand-gradient text-white elevation-glow hover:brightness-105"
              : "bg-surface-container text-on-surface-variant"
          )}
          aria-label="Send message"
        >
          {/* §10 — no spinner. The optimistic bubble IS the feedback, and a
              spinner here would imply the user must wait for it. */}
          <SendHorizontal className="h-5 w-5" />
        </button>
      </form>
    </div>
  );
}
