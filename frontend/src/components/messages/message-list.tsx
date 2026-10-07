"use client";

import { Fragment, useEffect, useMemo, useRef } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { MessageBubble } from "@/components/messages/message-bubble";
import type { ChatMessage } from "@/hooks/use-social";
import { Skeleton } from "@/components/ui/skeleton";

/** Two messages group when the same author sends within this window (§29). */
const GROUP_WINDOW_MS = 4 * 60 * 1000;

function dayKey(d: string) {
  return new Date(d).toDateString();
}

function dayLabel(d: string) {
  const date = new Date(d);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
}

export interface MessageListProps {
  messages: ChatMessage[];
  /** Session user id. When absent every message would render as received —
   *  this is exactly the failure mode §28 describes. */
  currentUserId?: string;
  loading?: boolean;
  onReact?: (messageId: string, emoji: string) => void;
  onReply?: (message: ChatMessage) => void;
  onUnsend?: (messageId: string) => void;
  emptyState?: React.ReactNode;
}

/**
 * Grouped, day-separated message list (§29).
 *
 * Consecutive messages from one sender share a single avatar and name, and
 * only the last in a run shows a timestamp. Without grouping, a five-message
 * exchange renders five avatars and five timestamps — visual noise that makes
 * a conversation harder to read, not easier.
 */
export function MessageList({
  messages,
  currentUserId,
  loading,
  onReact,
  onReply,
  onUnsend,
  emptyState,
}: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);

  const rows = useMemo(() => {
    return messages.map((m, i) => {
      const prev = messages[i - 1];
      const mine = Boolean(currentUserId) && String(m.sender?._id) === String(currentUserId);
      const sameAuthor =
        prev && String(prev.sender?._id) === String(m.sender?._id) && !prev.deletedAt && !m.deletedAt;
      const withinWindow = prev && new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() < GROUP_WINDOW_MS;
      const showHeader = !sameAuthor || !withinWindow;
      const showDay = !prev || dayKey(prev.createdAt) !== dayKey(m.createdAt);

      let quoted: { authorName?: string; content?: string; image?: string } | null = null;
      if (m.replyTo) {
        const target = messages.find((x) => x._id === m.replyTo);
        if (target) {
          quoted = {
            authorName: `${target.sender?.firstName || ""} ${target.sender?.lastName || ""}`.trim() || "Message",
            content: target.deletedAt ? undefined : target.content,
            image: target.image,
          };
        }
      }

      return { message: m, mine, showHeader, showDay, dayLabel: showDay ? dayLabel(m.createdAt) : undefined, quoted };
    });
  }, [messages, currentUserId]);

  /* Stick to the bottom — but only if the reader is already there.
     Yanking a reader back down while they are reading history is the most
     common way a chat feels broken. */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (pinnedRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [messages.length]);

  // Jump to the newest message on first load.
  useEffect(() => {
    if (!loading && messages.length) {
      bottomRef.current?.scrollIntoView({ block: "end" });
      pinnedRef.current = true;
    }
  }, [loading, messages.length]);

  if (loading && !messages.length) {
    return <MessageListSkeleton />;
  }

  if (!messages.length && emptyState) {
    return <>{emptyState}</>;
  }

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto overscroll-contain px-3 py-3 sm:px-4">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-0.5">
        {rows.map((row) => (
          <Fragment key={row.message._id}>
            <div className={cn("animate-msg-in", row.showHeader && "mt-2.5")}>
              <MessageBubble
                message={row.message}
                mine={row.mine}
                showHeader={row.showHeader}
                showDay={row.showDay}
                dayLabel={row.dayLabel}
                quoted={row.quoted}
                onReact={onReact ? (e) => onReact(row.message._id, e) : undefined}
                onReply={onReply ? () => onReply(row.message) : undefined}
                onUnsend={onUnsend && row.mine && !row.message.pending ? () => onUnsend(row.message._id) : undefined}
              />
            </div>
          </Fragment>
        ))}
        <div ref={bottomRef} className="h-1" />
      </div>
    </div>
  );
}

export function MessageListSkeleton() {
  // §43 — the skeleton mirrors the real layout: alternating widths, grouped.
  return (
    <div className="flex-1 space-y-3 overflow-hidden px-3 py-4 sm:px-4" aria-busy="true" aria-label="Loading messages">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className={cn("flex items-end gap-1.5", i % 3 === 0 ? "justify-end" : "justify-start")}>
          {i % 3 !== 0 ? <Skeleton className="h-7 w-7 shrink-0 rounded-full" /> : null}
          <Skeleton className={cn("h-12 rounded-2xl", i % 3 === 0 ? "w-40 rounded-br-md" : "w-52 rounded-bl-md")} />
        </div>
      ))}
    </div>
  );
}

export function TypingIndicator({ name }: { name?: string }) {
  return (
    <div className="flex items-center gap-1.5 px-4 pb-1 text-[11px] text-on-surface-variant" aria-live="polite">
      <Loader2 className="h-3 w-3 animate-spin" />
      {name ? `${name} is typing…` : "Typing…"}
    </div>
  );
}
