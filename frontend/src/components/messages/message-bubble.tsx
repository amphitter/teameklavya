"use client";

import { memo, useRef, useState } from "react";
import { Check, CheckCheck, Clock, Copy, Reply, RotateCw, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";
import type { ChatMessage } from "@/hooks/use-social";
import { cloudinaryUrl, getImageUrl } from "@/utils/image";
import { SharedPostCard } from "@/components/post/shared-post-card";

export const MESSAGE_REACTIONS = ["❤️", "😂", "🔥", "👍", "🎉"];

export interface MessageBubbleProps {
  message: ChatMessage;
  mine: boolean;
  showHeader: boolean;
  showSenderName?: boolean;
  showDay: boolean;
  dayLabel?: string;
  onReact?: (emoji: string) => void;
  onReply?: () => void;
  onUnsend?: () => void;
  onRetry?: () => void;
  timeLabel?: string;
  quoted?: { authorName?: string; content?: string; image?: string } | null;
}

function timeOf(d: string) {
  return new Date(d).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

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
  const [sheetOpen, setSheetOpen] = useState(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchStartPos = useRef<{ x: number; y: number } | null>(null);
  const deleted = Boolean(message.deletedAt);
  const pending = Boolean(message.pending);
  const failed = Boolean(message.failed);
  const reactions = message.reactions || [];

  const startLongPress = (x: number, y: number) => {
    touchStartPos.current = { x, y };
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    longPressTimer.current = setTimeout(() => {
      // Haptics if available
      if (typeof navigator !== "undefined" && "vibrate" in navigator) {
        try { (navigator as { vibrate: (n: number) => void }).vibrate(20); } catch {}
      }
      setSheetOpen(true);
    }, 480);
  };

  const cancelLongPress = (endX?: number, endY?: number) => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    // If finger moved >10px, cancel (it's a scroll, not long-press)
    if (endX != null && endY != null && touchStartPos.current) {
      const dx = endX - touchStartPos.current.x;
      const dy = endY - touchStartPos.current.y;
      if (Math.sqrt(dx * dx + dy * dy) > 12) {
        touchStartPos.current = null;
        return true; // moved
      }
    }
    touchStartPos.current = null;
    return false;
  };

  const handleCopy = async () => {
    const text = message.content || "";
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // fallback
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setSheetOpen(false);
  };

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
        {!mine && (
          <div className="w-7 shrink-0">
            {showHeader ? <AvatarBubble name={nameOf(message)} /> : null}
          </div>
        )}

        <div className={cn("flex min-w-0 max-w-[78%] flex-col", mine ? "items-end" : "items-start")}>
          {showHeader && !mine && showSenderName ? (
            <span className="mb-0.5 px-1 text-[11px] font-semibold text-on-surface-variant">{nameOf(message)}</span>
          ) : null}

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
                "relative overflow-hidden rounded-2xl px-3 py-2 text-[15px] leading-snug border",
                mine
                  ? "bg-primary text-white border-primary/20"
                  : "bg-surface-container-lowest text-on-surface border-outline-variant",
                mine ? "rounded-br-md" : "rounded-bl-md",
                deleted && "italic opacity-70",
                failed && "ring-1 ring-destructive/50",
                pending && "opacity-70"
              )}
              tabIndex={0}
              role="article"
              aria-label={`${mine ? "You" : nameOf(message)} at ${timeOf(message.createdAt)}: ${deleted ? "message deleted" : message.content || "photo"}`}
              // Long-press for mobile bottom sheet
              onTouchStart={(e) => {
                if (deleted) return;
                const t = e.touches[0];
                startLongPress(t.clientX, t.clientY);
              }}
              onTouchMove={(e) => {
                const t = e.touches[0];
                if (cancelLongPress(t.clientX, t.clientY)) {
                  if (longPressTimer.current) {
                    clearTimeout(longPressTimer.current);
                    longPressTimer.current = null;
                  }
                }
              }}
              onTouchEnd={(e) => {
                const t = e.changedTouches[0];
                cancelLongPress(t?.clientX, t?.clientY);
              }}
              onTouchCancel={() => cancelLongPress()}
              // Desktop: click opens sheet as well for accessibility, right-click still allows copy
              onClick={() => {
                // On touch devices, single tap should not open sheet (only long-press)
                if (typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches) return;
                // On desktop, click opens quick actions if available
                if (onReply || onReact || onUnsend) {
                  // Only open on desktop if not already selecting text
                  const sel = window.getSelection();
                  if (sel && sel.toString().length > 0) return;
                }
              }}
              onContextMenu={(e) => {
                // Allow native copy on desktop, but on mobile show our sheet
                if (typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches) {
                  e.preventDefault();
                  setSheetOpen(true);
                }
              }}
            >
              {deleted ? (
                <span className="flex items-center gap-1.5 text-[13px]">
                  <Icon name="block" size={14} /> Message deleted
                </span>
              ) : message.sharedPost ? (
                <>
                  {message.content && message.content !== "Shared a post" ? (
                    <p className="mb-1 whitespace-pre-wrap break-words">{message.content}</p>
                  ) : null}
                  <SharedPostCard postId={String(message.sharedPost)} mine={mine} />
                </>
              ) : message.image ? (
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
                <p className="whitespace-pre-wrap break-words select-text">{message.content}</p>
              )}

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
                      <Clock className="h-3 w-3 animate-pulse" aria-label="Sending" />
                    ) : failed ? (
                      <span className="text-white" aria-label="Failed to send">!</span>
                    ) : (
                      (() => {
                        const delivery = (message as unknown as { _delivery?: string; deliveredAt?: string })._delivery as string | undefined;
                        const hasRead = Boolean(message.readAt);
                        const hasDelivered = Boolean((message as unknown as { deliveredAt?: string }).deliveredAt) || delivery === "delivered";
                        if (hasRead) {
                          return <CheckCheck className="h-3 w-3 text-white" aria-label="Read" />;
                        }
                        if (hasDelivered) {
                          return <CheckCheck className="h-3 w-3 text-white/85" aria-label="Delivered" />;
                        }
                        return <Check className="h-3 w-3 text-white/60" aria-label="Sent" />;
                      })()
                    )
                  ) : null}
                </span>
              ) : null}
            </div>

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

          {failed && onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="mt-1 flex items-center gap-1 rounded-full bg-destructive/10 px-2.5 py-1 text-[11px] font-semibold text-destructive"
            >
              <RotateCw className="h-3 w-3" aria-hidden /> Couldn&apos;t send — tap to retry
            </button>
          ) : null}

          {/* Desktop hover toolbar — hidden on touch devices */}
          {!deleted && (onReact || onReply) ? (
            <div
              className={cn(
                "pointer-events-none absolute z-10 hidden gap-0.5 rounded-full border border-outline-variant bg-surface-container-lowest p-1 shadow-md group-hover/msg:pointer-events-auto lg:group-hover/msg:flex",
                "max-lg:hidden",
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

        {mine ? <div className="hidden w-7 shrink-0 lg:block" /> : null}
      </div>

      {/* Mobile bottom sheet — long-press actions */}
      {sheetOpen ? (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 bg-black/20"
            aria-label="Close actions"
            onClick={() => setSheetOpen(false)}
          />
          <div className="fixed bottom-0 left-0 right-0 z-50 animate-fade-in-up rounded-t-2xl border-t border-outline-variant bg-surface-container-lowest p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-2xl lg:hidden">
            <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-outline-variant" />
            <div className="flex gap-2 overflow-x-auto px-1 py-2">
              {MESSAGE_REACTIONS.map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => {
                    onReact?.(e);
                    setSheetOpen(false);
                  }}
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-surface-container text-xl active:scale-95"
                  aria-label={`React ${e}`}
                >
                  {e}
                </button>
              ))}
            </div>
            <div className="flex flex-col gap-1">
              {onReply ? (
                <button
                  type="button"
                  onClick={() => {
                    onReply();
                    setSheetOpen(false);
                  }}
                  className="flex items-center gap-3 rounded-xl px-4 py-3 text-left text-[14px] hover:bg-surface-container"
                >
                  <Reply className="h-5 w-5" /> Reply
                </button>
              ) : null}
              <button
                type="button"
                onClick={handleCopy}
                className="flex items-center gap-3 rounded-xl px-4 py-3 text-left text-[14px] hover:bg-surface-container"
              >
                <Copy className="h-5 w-5" /> Copy text
              </button>
              {mine && onUnsend ? (
                <button
                  type="button"
                  onClick={() => {
                    onUnsend();
                    setSheetOpen(false);
                  }}
                  className="flex items-center gap-3 rounded-xl px-4 py-3 text-left text-[14px] text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="h-5 w-5" /> Unsend
                </button>
              ) : null}
            </div>
          </div>
        </>
      ) : null}
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
