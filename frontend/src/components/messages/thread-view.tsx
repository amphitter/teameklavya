"use client";

/**
 * Thread view (Part 10 §5, §6, §7, §8, §9, §33)
 * ──────────────────────────────────────────────
 * Renders the conversation. Three things here are load-bearing:
 *
 *  1. WINDOWING (§6). Above `VIRTUALIZE_ABOVE` messages only the visible
 *     slice is in the DOM. Below it, everything renders — windowing a short
 *     conversation adds moving parts and buys nothing.
 *
 *  2. SCROLL ANCHORING (§5). Loading older messages must not move what the
 *     reader is looking at. We measure `scrollHeight` before the prepend and
 *     add the delta to `scrollTop` in a layout effect, so the same message
 *     stays under the same pixel.
 *
 *  3. BOTTOM STICKINESS. Auto-scroll only when the reader is already at the
 *     bottom. Yanking someone down while they read history is the single
 *     most common way a chat feels broken.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Loader2, MessageCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { MessageBubble } from "@/components/messages/message-bubble";
import type { ChatMessage } from "@/hooks/use-social";

const GROUP_WINDOW_MS = 4 * 60 * 1000;
/** Below this, render everything — windowing here would be premature (§6). */
const VIRTUALIZE_ABOVE = 60;
/** Rows kept rendered above and below the viewport while windowing. */
const OVERSCAN = 12;
/** How close to the bottom still counts as "following the conversation". */
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

/**
 * Group and annotate messages (§8).
 *
 * Consecutive messages from one sender within GROUP_WINDOW_MS collapse into a
 * group: one avatar, one name, and a timestamp only on the group's last row.
 * Computed once per message-list identity so an unrelated state change cannot
 * re-derive it.
 */
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
  /** What the typing bubble says (a team names the person typing). */
  typingLabel?: string;
  /**
   * Show the sender's name above a group of received messages. On in a team
   * (who said it is the point); off in a direct chat, where there are only
   * ever two possible authors and the name is noise.
   */
  showSenderNames?: boolean;
  onLoadOlder: () => void;
  onRetryLoad?: () => void;
  onReact?: (messageId: string, emoji: string) => void;
  onReply?: (message: ChatMessage) => void;
  onUnsend?: (messageId: string) => void;
  onRetrySend?: (message: ChatMessage) => void;
  /** Identifies the conversation, so the initial scroll-jump happens once
   *  per conversation instead of on every change to the list. */
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
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  /** Set right before a prepend so the layout effect can restore position. */
  const anchorRef = useRef<{ height: number; top: number } | null>(null);
  const prevFirstIdRef = useRef<string | null>(null);
  const [, forceRender] = useState(0);

  const rows = useMemo(() => buildRows(messages, currentUserId), [messages, currentUserId]);

  const virtual = rows.length > VIRTUALIZE_ABOVE;

  /* ── Measured window (only when virtualising) ── */
  const heights = useRef(new Map<string, number>());
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(600);

  const { startIndex, endIndex, padTop, padBottom } = useMemo(() => {
    if (!virtual) return { startIndex: 0, endIndex: rows.length, padTop: 0, padBottom: 0 };

    // Average measured height, falling back to a bubble-sized estimate —
    // measured heights converge within a screen or two of scrolling.
    let sum = 0;
    let n = 0;
    for (const r of rows) {
      const h = heights.current.get(r.message._id);
      if (h) {
        sum += h;
        n++;
      }
    }
    const avg = n ? sum / n : 68;

    const start = Math.max(0, Math.floor(scrollTop / avg) - OVERSCAN);
    const end = Math.min(rows.length, Math.ceil((scrollTop + viewportH) / avg) + OVERSCAN);
    return {
      startIndex: start,
      endIndex: end,
      padTop: start * avg,
      padBottom: (rows.length - end) * avg,
    };
  }, [virtual, rows, scrollTop, viewportH]);

  const visible = virtual ? rows.slice(startIndex, endIndex) : rows;

  /* ── Track scroll + pinning ── */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      pinnedRef.current =
        el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD_PX;
      if (virtual) setScrollTop(el.scrollTop);
      if (el.scrollTop < 400 && hasMore && !fetchingOlder) onLoadOlder();
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [virtual, hasMore, fetchingOlder, onLoadOlder]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !virtual) return;
    setViewportH(el.clientHeight);
    const ro = new ResizeObserver(() => setViewportH(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [virtual]);

  /* ── §5 — preserve position across a prepend ── */
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const firstId = rows[0]?.message._id ?? null;
    const anchor = anchorRef.current;

    if (anchor && prevFirstIdRef.current !== firstId) {
      // Older messages were inserted above. Restore the exact pixel the
      // reader was on by adding however much the content grew.
      const grew = el.scrollHeight - anchor.height;
      if (grew > 0) el.scrollTop = anchor.top + grew;
      anchorRef.current = null;
      if (virtual) setScrollTop(el.scrollTop);
    }
    prevFirstIdRef.current = firstId;
  }, [rows, virtual]);

  /* Capture the measurement BEFORE the prepend lands. The hook that fetches
     older pages calls `onLoadOlder`; the fetch resolves later, so we record
     geometry now and compare it once the new rows are in the DOM. */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (fetchingOlder) {
      anchorRef.current = { height: el.scrollHeight, top: el.scrollTop };
    }
  }, [fetchingOlder]);

  /* ── Stick to the bottom for new messages ── */
  const lastId = rows[rows.length - 1]?.message._id;
  useEffect(() => {
    if (!pinnedRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "auto" });
    if (virtual) setScrollTop(el.scrollTop);
  }, [lastId, typing, virtual]);

  /* Jump to the newest message ONCE per conversation. `auto` not `smooth`:
     animating a long jump is slower and looks broken.
   *
   * This previously depended on `rows.length`, so it ran again for every
   * message that arrived — which meant that a reader who had scrolled up to
   * read history was yanked back to the bottom the moment anyone sent
   * anything, and it fired an extra HTTP request each time. Scoping the
   * jump to the conversation fixes both: arriving in a thread still lands
   * you at the newest message, and staying there is the reader's choice. */
  const jumpedFor = useRef<string | null>(null);
  useEffect(() => {
    if (loading) return;
    const el = scrollRef.current;
    if (!el || !rows.length) return;
    if (jumpedFor.current === conversationId) return;
    jumpedFor.current = conversationId;
    el.scrollTop = el.scrollHeight;
    if (virtual) setScrollTop(el.scrollTop);
    pinnedRef.current = true;
  }, [loading, rows.length, virtual, conversationId]);

  /**
   * Cache each rendered row's height for the offset estimate.
   *
   * `forceRender` only fires when the measured height actually CHANGED —
   * an unguarded re-render inside a ResizeObserver callback is a layout
   * loop waiting to happen, and it would run on every scroll tick.
   */
  const measure = useCallback((id: string) => {
    return (node: HTMLDivElement | null) => {
      if (!node) return;
      const ro = new ResizeObserver(() => {
        const h = node.offsetHeight;
        if (heights.current.get(id) === h) return;
        heights.current.set(id, h);
        forceRender((n) => n + 1);
      });
      ro.observe(node);
    };
  }, []);

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
            className="mt-1 rounded-full bg-primary px-4 py-2 text-xs font-semibold text-white"
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
      /* THE SAFE PADDING OF THE MESSAGE COLUMN (Part 15 §5).
       *
       * One value, 16px, on every width — it is the canonical EventHub
       * spacing step and it is what the desktop column already used, so the
       * desktop (lg+) column's output is unchanged.
       *
       * What it means per side (the row structure is [rail][gap][bubble], with
       * a 28px rail and a 6px gap):
       *   • sent   — the rail is gone on phones (see message-bubble.tsx), so
       *              the bubble's right edge is exactly the safe padding, 16px
       *              from the viewport edge, on every phone width.
       *   • received — the rail holds the avatar, so the avatar starts at the
       *              16px padding and the bubble 34px further in.
       * The previous 9px phone value (chosen when both gutters were meant to
       * measure 43px) put the sent bubble 43px from the edge, which is the
       * dead strip this part removes. */
      className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-2"
      style={{ WebkitOverflowScrolling: "touch" }}
      data-testid="thread-scroll"
    >
      <div className="mx-auto flex w-full max-w-3xl flex-col">
        {/* Top affordance: fetching older pages, or the end of history. */}
        <div className="flex justify-center py-2">
          {fetchingOlder ? (
            <span className="flex items-center gap-1.5 text-[11px] text-on-surface-variant">
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> Loading older messages…
            </span>
          ) : hasMore ? (
            <button
              type="button"
              onClick={onLoadOlder}
              className="rounded-full px-3 py-1 text-[11px] font-semibold text-primary hover:bg-surface-container"
            >
              Load older messages
            </button>
          ) : (
            <span className="text-[11px] text-on-surface-variant/70">Start of the conversation</span>
          )}
        </div>

        {virtual ? <div style={{ height: padTop }} aria-hidden /> : null}

        {visible.map((row) => (
          <div
            key={row.message._id}
            ref={virtual ? measure(row.message._id) : undefined}
            className={cn("animate-msg-in", row.showHeader && "mt-2.5")}
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
        ))}

        {virtual ? <div style={{ height: padBottom }} aria-hidden /> : null}

        {typing ? <TypingBubble name={typingLabel || otherName} /> : null}
      </div>
    </div>
  );
}

/**
 * Typing indicator (§13).
 * Three dots that pulse — a single CSS animation, no layout thrash, and no
 * re-render per frame.
 */
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
