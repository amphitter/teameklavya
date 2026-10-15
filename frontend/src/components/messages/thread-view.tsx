"use client";

/**
 * Thread view — fixed for mobile keyboard + performance
 * ──────────────────────────────────────────────────────
 * 1. No custom virtualization — uses CSS content-visibility: auto (msg-row)
 *    which is the cheapest fix and avoids ResizeObserver leak.
 * 2. Scroll anchoring preserved for older loads.
 * 3. Bottom stickiness + ResizeObserver for keyboard resize (Fix 2).
 * 4. Scroll handler throttled via rAF.
 * 5. Only new messages animate, not initial load.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Loader2, MessageCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { MessageBubble } from "@/components/messages/message-bubble";
import type { ChatMessage } from "@/hooks/use-social";

const GROUP_WINDOW_MS = 4 * 60 * 1000;
const STICK_THRESHOLD_PX = 140;

function dayKey(d: string) {
  const date = new Date(d);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function dayLabel(d: string) {
  const date = new Date(d);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (dayKey(d) === dayKey(today.toISOString())) return "Today";
  if (dayKey(d) === dayKey(yesterday.toISOString())) return "Yesterday";
  return date.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
}

function timeOf(d: string) {
  return new Date(d).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

export interface ThreadRow {
  message: ChatMessage;
  mine: boolean;
  showHeader: boolean;
  showDay: boolean;
  dayLabel?: string;
  quoted: { authorName?: string; content?: string; image?: string } | null;
}

export function buildRows(messages: ChatMessage[], currentUserId?: string): ThreadRow[] {
  return messages.map((m, i) => {
    const prev = messages[i - 1];
    const mine = Boolean(currentUserId) && String(m.sender?._id) === String(currentUserId);
    const sameAuthor =
      prev && String(prev.sender?._id) === String(m.sender?._id) && !prev.deletedAt && !m.deletedAt;
    const withinWindow =
      prev && new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() < GROUP_WINDOW_MS;
    const showHeader = !sameAuthor || !withinWindow;
    const showDay = !prev || dayKey(prev.createdAt) !== dayKey(m.createdAt);

    let quoted: ThreadRow["quoted"] = null;
    if (m.replyTo) {
      const target = messages.find((x) => x._id === m.replyTo);
      if (target) {
        quoted = {
          authorName:
            `${target.sender?.firstName || ""} ${target.sender?.lastName || ""}`.trim() || "Message",
          content: target.deletedAt ? undefined : target.content,
          image: target.image,
        };
      }
    }

    return {
      message: m,
      mine,
      showHeader,
      showDay,
      dayLabel: showDay ? dayLabel(m.createdAt) : undefined,
      quoted,
    };
  });
}

export interface ThreadViewProps {
  messages: ChatMessage[];
  currentUserId?: string;
  otherName?: string;
  hasMore: boolean;
  fetchingOlder: boolean;
  loading: boolean;
  error?: boolean;
  typing?: boolean;
  typingLabel?: string;
  showSenderNames?: boolean;
  onLoadOlder: () => void;
  onRetryLoad?: () => void;
  onReact?: (messageId: string, emoji: string) => void;
  onReply?: (message: ChatMessage) => void;
  onUnsend?: (messageId: string) => void;
  onRetrySend?: (message: ChatMessage) => void;
  conversationId: string;
}

export function ThreadView({
  messages,
  currentUserId,
  otherName,
  hasMore,
  fetchingOlder,
  loading,
  error,
  typing,
  typingLabel,
  showSenderNames = false,
  onLoadOlder,
  onRetryLoad,
  onReact,
  onReply,
  onUnsend,
  onRetrySend,
  conversationId,
}: ThreadViewProps) {
  // All refs at top — hooks order must never change (React #310)
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const anchorRef = useRef<{ height: number; top: number } | null>(null);
  const prevFirstIdRef = useRef<string | null>(null);
  const seenIdsRef = useRef<Set<string>>(new Set());
  const jumpedFor = useRef<string | null>(null);
  const [newIds, setNewIds] = useState<Set<string>>(new Set());

  const rows = useMemo(() => buildRows(messages, currentUserId), [messages, currentUserId]);

  // Track which ids are truly new for animation (not initial load)
  useEffect(() => {
    const currentIds = new Set(messages.map((m) => m._id));
    const newlySeen: string[] = [];
    for (const id of currentIds) {
      if (!seenIdsRef.current.has(id)) {
        if (seenIdsRef.current.size > 0) newlySeen.push(id);
      }
    }
    // Always update seen set — previously only updated when no new ids, causing loop
    seenIdsRef.current = currentIds;
    if (newlySeen.length) {
      setNewIds(new Set(newlySeen));
      const t = setTimeout(() => setNewIds(new Set()), 500);
      return () => clearTimeout(t);
    }
  }, [messages]);

  // Reset seen when conversation changes
  useEffect(() => {
    seenIdsRef.current = new Set();
    setNewIds(new Set());
    jumpedFor.current = null;
  }, [conversationId]);

  /* ── Track scroll + pinning — throttled via rAF ── */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let raf = 0;
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      raf = requestAnimationFrame(() => {
        pinnedRef.current =
          el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD_PX;
        if (el.scrollTop < 400 && hasMore && !fetchingOlder) onLoadOlder();
        ticking = false;
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, [hasMore, fetchingOlder, onLoadOlder]);

  /* ── Fix 2: keyboard resize keeps pinned at bottom ── */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (pinnedRef.current) {
        el.scrollTop = el.scrollHeight;
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* ── Preserve position across prepend ── */
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const firstId = rows[0]?.message._id ?? null;
    const anchor = anchorRef.current;

    if (anchor && prevFirstIdRef.current !== firstId) {
      const grew = el.scrollHeight - anchor.height;
      if (grew > 0) el.scrollTop = anchor.top + grew;
      anchorRef.current = null;
    }
    prevFirstIdRef.current = firstId;
  }, [rows]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (fetchingOlder) {
      anchorRef.current = { height: el.scrollHeight, top: el.scrollTop };
    }
  }, [fetchingOlder]);

  /* ── Stick to bottom for new messages ── */
  const lastId = rows[rows.length - 1]?.message._id;
  useEffect(() => {
    if (!pinnedRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "auto" });
  }, [lastId, typing]);

  /* Jump once per conversation */
  useEffect(() => {
    if (loading) return;
    const el = scrollRef.current;
    if (!el || !rows.length) return;
    if (jumpedFor.current === conversationId) return;
    jumpedFor.current = conversationId;
    el.scrollTop = el.scrollHeight;
    pinnedRef.current = true;
    seenIdsRef.current = new Set(messages.map((m) => m._id));
  }, [loading, rows.length, conversationId, messages]);

  if (loading && !messages.length) {
    return <ThreadSkeleton />;
  }

  if (error && !messages.length) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
        <p className="text-sm font-semibold text-on-surface">Couldn&apos;t load messages</p>
        <p className="text-xs text-on-surface-variant">Check your connection and try again.</p>
        {onRetryLoad ? (
          <button
            type="button"
            onClick={onRetryLoad}
            className="mt-1 min-h-11 rounded-full bg-primary px-4 py-2 text-xs font-semibold text-white"
          >
            Try again
          </button>
        ) : null}
      </div>
    );
  }

  if (!messages.length) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-1 px-6 text-center">
        <MessageCircle className="h-8 w-8 text-on-surface-variant/50" aria-hidden />
        <p className="text-sm font-bold text-on-surface">Start the conversation</p>
        <p className="max-w-[16rem] text-xs text-on-surface-variant">
          {otherName ? `Say hi to ${otherName} — messages are private between you two.` : "Say hi."}
        </p>
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-2"
      style={{ WebkitOverflowScrolling: "touch" } as React.CSSProperties}
      data-testid="thread-scroll"
    >
      <div className="mx-auto flex w-full max-w-3xl flex-col">
        <div className="flex justify-center py-2">
          {fetchingOlder ? (
            <span className="flex items-center gap-1.5 text-[11px] text-on-surface-variant">
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> Loading older messages…
            </span>
          ) : hasMore ? (
            <button
              type="button"
              onClick={onLoadOlder}
              className="min-h-11 touch-manipulation rounded-full px-3 py-1 text-[11px] font-semibold text-primary hover:bg-surface-container"
            >
              Load older messages
            </button>
          ) : (
            <span className="text-[11px] text-on-surface-variant/70">Start of the conversation</span>
          )}
        </div>

        {rows.map((row) => {
          const isNew = newIds.has(row.message._id);
          return (
            <div
              key={row.message._id}
              className={cn("msg-row", row.showHeader && "mt-2.5", isNew && "animate-msg-in-new")}
            >
              <MessageBubble
                message={row.message}
                mine={row.mine}
                showHeader={row.showHeader}
                showDay={row.showDay}
                dayLabel={row.dayLabel}
                quoted={row.quoted}
                showSenderName={showSenderNames}
                timeLabel={timeOf(row.message.createdAt)}
                onReact={onReact ? (e) => onReact(row.message._id, e) : undefined}
                onReply={onReply ? () => onReply(row.message) : undefined}
                onUnsend={
                  onUnsend && row.mine && !row.message.pending && !row.message.failed
                    ? () => onUnsend(row.message._id)
                    : undefined
                }
                onRetry={row.message.failed && onRetrySend ? () => onRetrySend(row.message) : undefined}
              />
            </div>
          );
        })}

        {typing ? <TypingBubble name={typingLabel || otherName} /> : null}
      </div>
    </div>
  );
}

export function TypingBubble({ name }: { name?: string }) {
  return (
    <div className="mt-1 flex items-center gap-1.5 pl-9" aria-live="polite" aria-label={`${name || "They"} is typing`}>
      <span className="flex items-center gap-1 rounded-2xl rounded-bl-md border border-outline-variant bg-surface-container-lowest px-3 py-2">
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-on-surface-variant/60 [animation-delay:-0.3s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-on-surface-variant/60 [animation-delay:-0.15s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-on-surface-variant/60" />
      </span>
    </div>
  );
}

export function ThreadSkeleton() {
  return (
    <div className="flex-1 space-y-3 overflow-hidden px-3 py-4 sm:px-4" aria-busy="true" aria-label="Loading messages">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className={cn("flex items-end gap-1.5", i % 3 === 0 ? "justify-end" : "justify-start")}>
          {i % 3 !== 0 ? <div className="h-7 w-7 shrink-0 animate-pulse rounded-full bg-surface-container" /> : null}
          <div
            className={cn(
              "h-11 animate-pulse rounded-2xl bg-surface-container",
              i % 3 === 0 ? "w-40 rounded-br-md" : "w-52 rounded-bl-md"
            )}
          />
        </div>
      ))}
    </div>
  );
}
