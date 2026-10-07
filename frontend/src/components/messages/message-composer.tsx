"use client";

import { useEffect, useRef, useState } from "react";
import { ImagePlus, Loader2, Paperclip, SendHorizontal, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";
import { EmojiButton } from "@/components/ui/emoji-picker";

export interface MessageComposerProps {
  onSend: (text: string) => void;
  onSendImage?: (file: File) => void;
  onSendFile?: (file: File) => void;
  disabled?: boolean;
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
    if (!value || disabled || sending) return;
    onSend(value);
    setText("");
    requestAnimationFrame(() => taRef.current?.focus());
  };

  const canSend = text.trim().length > 0 && !disabled && !sending;

  return (
    <div
      className="sticky bottom-0 z-10 border-t border-outline-variant bg-surface-container-lowest/95 backdrop-blur supports-[backdrop-filter]:bg-surface-container-lowest/80"
      style={{ paddingBottom: "var(--keyboard-inset, 0px)" }}
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
            <input ref={fileRef} type="file" className="hidden" onChange={(e) => {
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
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends; Shift+Enter (and the IME composition guard) newline.
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          className="max-h-[8.25rem] min-h-[2.5rem] flex-1 resize-none rounded-2xl border border-outline-variant bg-surface px-3.5 py-2.5 text-[15px] leading-snug outline-none placeholder:text-on-surface-variant/70 focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/12 disabled:opacity-60"
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
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <SendHorizontal className="h-5 w-5" />}
        </button>
      </form>
    </div>
  );
}
