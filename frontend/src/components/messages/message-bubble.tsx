"use client";

import { memo, useState } from "react";
import { Check, CheckCheck, Clock, Reply, RotateCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";
import type { ChatMessage } from "@/hooks/use-social";
import { cloudinaryUrl, getImageUrl } from "@/utils/image";
import { SharedPostCard } from "@/components/post/shared-post-card";

/** Long-press / hover reaction set (§31) — deliberately short. */
export const MESSAGE_REACTIONS = ["❤️", "😂", "🔥", "👍", "🎉"];

export interface MessageBubbleProps {
  message: ChatMessage;
  /** Resolved from the session user — the whole point of the §28 fix. */
  mine: boolean;
  /** Show the sender's avatar + name (first message of a group only, §29). */
  showHeader: boolean;
  /** Part 11 — names matter inside a team and are noise in a pair. */
  showSenderName?: boolean;
  /** Show a day separator above this message. */
  showDay: boolean;
  dayLabel?: string;
  onReact?: (emoji: string) => void;
  onReply?: () => void;
  onUnsend?: () => void;
  /** Part 10 §10 — retry a send that failed. */
  onRetry?: () => void;
  /** Pre-formatted clock string, computed once by the list, not per render. */
  timeLabel?: string;
  /** The message this one replies to, for the quoted preview (§30). */
  quoted?: { authorName?: string; content?: string; image?: string } | null;
}

function timeOf(d: string) {
  return new Date(d).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

/**
 * A single message bubble.
 *
 * §28 — sent and received must be unmistakable at a glance. Four independent
 * signals, not one:
 *   • alignment   sent right, received left
 *   • fill        sent uses the brand gradient, received a flat surface
 *   • text colour sent is white-on-gradient, received is on-surface
 *   • tail        the corner nearest the sender is squared off
 *
 * Any one of these can fail (a long-press, a forced-colors mode) without the
 * message becoming ambiguous.
 */
export const MessageBubble = memo(function MessageBubble({
  message,
  mine,
  showHeader,
  showSenderName = false,
  showDay,
  dayLabel,
  onReact,
  onReply,
  onUnsend,
  onRetry,
  timeLabel,
  quoted,
}: MessageBubbleProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const deleted = Boolean(message.deletedAt);
  const pending = Boolean(message.pending);
  const failed = Boolean(message.failed);

  const reactions = message.reactions || [];

  return (
    <>
      {showDay && dayLabel ? (
        <div className="my-3 flex items-center gap-3" role="separator">
          <span className="h-px flex-1 bg-outline-variant" />
          <span className="rounded-full bg-surface-container px-2.5 py-1 text-[11px] font-semibold text-on-surface-variant">
            {dayLabel}
          </span>
          <span className="h-px flex-1 bg-outline-variant" />
        </div>
      ) : null}

      <div
        className={cn("group/msg flex w-full items-end gap-1.5", mine ? "justify-end" : "justify-start")}
        data-mine={mine ? "true" : "false"}
      >
        {/* Received avatar — reserved space keeps bubbles aligned even when
            the header is suppressed on a grouped message (§29). */}
        {!mine && (
          <div className="w-7 shrink-0">
            {showHeader ? <AvatarBubble name={nameOf(message)} /> : null}
          </div>
        )}

        <div className={cn("flex min-w-0 max-w-[78%] flex-col", mine ? "items-end" : "items-start")}>
          {showHeader && !mine && showSenderName ? (
            <span className="mb-0.5 px-1 text-[11px] font-semibold text-on-surface-variant">{nameOf(message)}</span>
          ) : null}

          {/* Quoted reply preview (§30) */}
          {quoted ? (
            <div
              className={cn(
                "mb-0.5 max-w-full truncate rounded-lg border-l-2 px-2 py-1 text-[11px]",
                mine ? "border-white/60 bg-white/15 text-white/85" : "border-primary/40 bg-surface-container text-on-surface-variant"
              )}
            >
              <span className="font-semibold">{quoted.authorName || "Message"}</span>
              <span className="mx-1 opacity-60">·</span>
              <span>{quoted.content || (quoted.image ? "Photo" : "")}</span>
            </div>
          ) : null}

          <div className="relative">
            <div
              className={cn(
                "relative overflow-hidden rounded-2xl px-3 py-2 text-[15px] leading-snug",
                mine
                  ? "brand-gradient text-white shadow-[0_2px_10px_rgba(37,99,255,0.22)]"
                  : "border border-outline-variant bg-surface-container-lowest text-on-surface elevation-card",
                // Tail: square the corner on the sender's side.
                mine ? "rounded-br-md" : "rounded-bl-md",
                deleted && "italic opacity-70",
                failed && "ring-1 ring-destructive/50",
                pending && "opacity-70"
              )}
              tabIndex={0}
              role="article"
              aria-label={`${mine ? "You" : nameOf(message)} at ${timeOf(message.createdAt)}: ${deleted ? "message deleted" : message.content || "photo"}`}
              onDoubleClick={() => onReply?.()}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenuOpen((v) => !v);
              }}
            >
              {deleted ? (
                <span className="flex items-center gap-1.5 text-[13px]">
                  <Icon name="block" size={14} /> Message deleted
                </span>
              ) : message.sharedPost ? (
                /* Part 13 §19–§21 — a shared post renders from the canonical
                 * post, not from anything copied into the message. The card
                 * resolves the id, so an edit shows the new text and a deleted
                 * or newly-private post shows “Post unavailable” without
                 * breaking the conversation or the rest of the thread. */
                <>
                  {message.content && message.content !== "Shared a post" ? (
                    <p className="mb-1 whitespace-pre-wrap break-words">{message.content}</p>
                  ) : null}
                  <SharedPostCard postId={String(message.sharedPost)} mine={mine} />
                </>
              ) : message.image ? (
                /* Part 10 §16/§17 — a thumbnail, not the original.
                 *
                 * The old markup asked Cloudinary for the full 560px asset
                 * the moment the row rendered. Thirty photo messages meant
                 * thirty full downloads whether or not they were ever
                 * scrolled to. This renders a 240px-wide variant (≈8 KB
                 * instead of ≈60 KB) inside a container whose aspect ratio
                 * is reserved up front, so neither the download nor the
                 * layout shift happens until the bubble is near the
                 * viewport. Tapping opens the full image. */
                <a
                  href={getImageUrl(message.image) || message.image}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block"
                  aria-label="Open photo"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={cloudinaryUrl(message.image, { w: 240, h: 240 }) || message.image}
                    alt="Photo message"
                    loading="lazy"
                    decoding="async"
                    width={240}
                    height={240}
                    className="h-auto max-h-64 w-full rounded-xl object-cover"
                    style={{ aspectRatio: "1 / 1" }}
                  />
                </a>
              ) : message.attachment?.url ? (
                <a
                  href={message.attachment.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn("flex items-center gap-2 text-[13px] underline-offset-2 hover:underline", mine ? "text-white" : "text-primary")}
                >
                  <Icon name="description" size={16} />
                  <span className="max-w-[10rem] truncate">{message.attachment.name || "Attachment"}</span>
                </a>
              ) : (
                <p className="whitespace-pre-wrap break-words">{message.content}</p>
              )}

              {/* Timestamp + delivery state, inline so it doesn't add height */}
              {!deleted ? (
                <span
                  className={cn(
                    "mt-0.5 flex items-center justify-end gap-1 text-[10px] tabular-nums",
                    mine ? "text-white/75" : "text-on-surface-variant"
                  )}
                >
                  {timeLabel || timeOf(message.createdAt)}
                  {mine ? (
                    pending ? (
                      <Clock className="h-3 w-3" aria-label="Sending" />
                    ) : failed ? (
                      <span className="text-white" aria-label="Failed to send">!</span>
                    ) : (
                      /* Double tick fills in once the peer's batched read
                         lands (§14). One icon, two states — no extra row,
                         no extra height, no ambiguity. */
                      <CheckCheck
                        className={cn("h-3 w-3", message.readAt ? "text-white" : "text-white/60")}
                        aria-label={message.readAt ? "Read" : "Sent"}
                      />
                    )
                  ) : null}
                </span>
              ) : null}
            </div>

            {/* Reactions summary (§31) */}
            {reactions.length ? (
              <div
                className={cn(
                  "absolute -bottom-2 flex gap-0.5 rounded-full border border-outline-variant bg-surface-container-lowest px-1 py-0.5 text-[11px] shadow-sm",
                  mine ? "left-0" : "right-0"
                )}
              >
                {reactions.slice(0, 3).map((r) => (
                  <button
                    key={r.emoji}
                    type="button"
                    onClick={() => onReact?.(r.emoji)}
                    className={cn(
                      "rounded-full px-1 leading-tight transition-transform hover:scale-110",
                      r.mine && "bg-primary/15 ring-1 ring-primary/40"
                    )}
                    aria-label={`${r.emoji} ${r.count} — ${r.mine ? "remove your reaction" : "react"}`}
                  >
                    {r.emoji}
                    {r.count > 1 ? <span className="ml-0.5 tabular-nums">{r.count}</span> : null}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          {/* §10 — a failed send offers the retry, right where it failed. */}
          {failed && onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="mt-1 flex items-center gap-1 rounded-full bg-destructive/10 px-2.5 py-1 text-[11px] font-semibold text-destructive"
            >
              <RotateCw className="h-3 w-3" aria-hidden /> Couldn&apos;t send — tap to retry
            </button>
          ) : null}

          {/* Reactions + reply on hover / long-press (§31) */}
          {!deleted && (onReact || onReply) ? (
            <div
              className={cn(
                "pointer-events-none absolute z-10 hidden gap-0.5 rounded-full border border-outline-variant bg-surface-container-lowest p-1 shadow-md group-hover/msg:pointer-events-auto group-hover/msg:flex",
                mine ? "mr-2" : "ml-2"
              )}
              style={{ bottom: reactions.length ? "-1.4rem" : "0.25rem" }}
            >
              {MESSAGE_REACTIONS.slice(0, 3).map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => onReact?.(e)}
                  className="rounded-full px-1 text-sm transition-transform hover:scale-125"
                  aria-label={`React ${e}`}
                >
                  {e}
                </button>
              ))}
              {onReply ? (
                <button
                  type="button"
                  onClick={onReply}
                  className="rounded-full p-0.5 text-on-surface-variant hover:text-primary"
                  aria-label="Reply to message"
                >
                  <Reply className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* Sent rows and the right edge (Part 15).
         *
         * A row is [rail][gap][bubble], with a 28px rail and a 6px gap. On a
         * RECEIVED row the rail holds the avatar, so the bubble starting 34px
         * in is correct. On a SENT row nothing occupies the rail — it was a
         * phantom spacer — and it was holding every sent bubble 28px away from
         * the edge on top of the scroller's own padding: 9 + 28 + 6 = 43px of
         * dead space at the right of EVERY content type (text, emoji, image,
         * shared post, long text, grouped runs). At 2.2-2.4x device pixel
         * ratio that is the ~95px "huge gap" seen on a phone.
         *
         * Below `lg` the rail is therefore removed entirely. Shrinking it is
         * not enough: the row is a `gap-1.5` flex container, so a spacer of
         * ANY width adds its own width on top of that 6px gap (a 6px spacer
         * measured 21px, not 15px). With the phantom item gone, what is left
         * on the right of a sent bubble is the message column's own safe
         * padding — 16px — which is exactly the value Part 15 asks for, and
         * the same padding the received side and the desktop column use.
         *
         * `lg`, not `sm`: below 1024px the thread is a single full-width
         * column (the shell's inbox pane is `lg:flex`), so 768px or 688px is
         * the same mobile layout with more room — its sent bubble belongs at
         * the safe padding too. From `lg` up the original 28px rail is
         * untouched, so the desktop two-pane layout is byte-for-byte what it
         * was. The bubble's own `max-w-[78%]` is unchanged: it resolves
         * against the row, not the rail, so no bubble changes size or style. */}
        {mine ? <div className="hidden w-7 shrink-0 lg:block" /> : null}
      </div>
    </>
  );
});

function nameOf(m: ChatMessage) {
  const s = m.sender;
  if (!s) return "Unknown";
  return `${s.firstName || ""} ${s.lastName || ""}`.trim() || s.username || "Unknown";
}

export function AvatarBubble({ name, src }: { name: string; src?: string }) {
  const initial = (name || "?").trim().charAt(0).toUpperCase();
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" className="h-7 w-7 rounded-full object-cover" loading="lazy" />
  ) : (
    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-purple-light text-[11px] font-bold text-purple">
      {initial}
    </span>
  );
}

/** Typing / read receipts footer (§34). */
export function MessageStatus({ status }: { status: "sent" | "delivered" | "read" | "failed" }) {
  if (status === "failed") return null;
  return (
    <div className="flex justify-end px-1 pt-1 text-[10px] text-on-surface-variant" aria-live="polite">
      {status === "read" ? (
        <span className="flex items-center gap-1">
          <CheckCheck className="h-3 w-3" /> Read
        </span>
      ) : status === "delivered" ? (
        <span className="flex items-center gap-1">
          <CheckCheck className="h-3 w-3" /> Delivered
        </span>
      ) : (
        <span className="flex items-center gap-1">
          <Check className="h-3 w-3" /> Sent
        </span>
      )}
    </div>
  );
}
