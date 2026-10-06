"use client";

/**
 * Live chat panel (Part 4, Phase 6 — spec §41).
 *
 * Event-scoped, persisted, rate-limited server-side. Moderation is
 * organizer-only: soft delete, single pinned message, mute sender. The
 * pinned message floats at the top as a banner. Muted participants see a
 * clear "you're muted" state instead of a broken input.
 */
import { useEffect, useRef, useState } from "react";
import { Loader2, MessageSquare, Pin, Send, VolumeOff, Volume2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/user-avatar";
import type { ChatState } from "@/lib/live-protocol";
import { cn } from "@/lib/utils";

export function ChatPanel({
  chat,
  eventId,
  meUserId,
  variant,
  onSend,
  onDelete,
  onPin,
  onMute,
  className,
}: {
  chat: ChatState;
  eventId: string;
  meUserId?: string;
  variant: "participant" | "organizer";
  onSend?: (eventId: string, text: string) => Promise<any>;
  onDelete?: (messageId: string) => Promise<any>;
  onPin?: (messageId: string) => Promise<any>;
  onMute?: (eventId: string, userId: string, muted: boolean) => Promise<any>;
  className?: string;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLUListElement | null>(null);
  const isOrganizer = variant === "organizer";
  const pinned = chat.messages.find((m) => m.pinned) || null;
  const canSend = chat.enabled && !chat.muted && !isOrganizer && Boolean(onSend);

  /* Keep the list pinned to the newest message */
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.messages.length]);

  const doSend = async () => {
    if (!onSend || sending || !text.trim()) return;
    setSending(true);
    try {
      const ack = await onSend(eventId, text.trim());
      if (ack?.ok) setText("");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">
        <MessageSquare className="h-3.5 w-3.5" /> Live chat
      </p>

      {!chat.enabled ? (
        <p className="mt-2 rounded-xl border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          Chat is turned off for this event.
        </p>
      ) : null}

      {/* Pinned banner */}
      {pinned ? (
        <div className="mt-2 flex items-start gap-2 rounded-xl border border-primary/40 bg-brand-light px-3 py-2">
          <Pin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
          <p className="min-w-0 flex-1 text-xs leading-snug text-foreground">
            <span className="font-extrabold">{pinned.displayName}: </span>
            {pinned.text}
          </p>
          {isOrganizer && onPin ? (
            <button type="button" onClick={() => onPin(pinned.id)} aria-label="Unpin message" className="shrink-0 rounded text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50">
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          ) : null}
        </div>
      ) : null}

      {/* Messages */}
      <ul ref={listRef} className="mt-2 min-h-0 flex-1 space-y-1.5 overflow-y-auto" aria-label="Chat messages">
        {chat.messages.length === 0 ? (
          <li className="py-4 text-center text-xs text-muted-foreground">No messages yet — say hello.</li>
        ) : (
          chat.messages.map((m) => {
            const mine = meUserId && m.senderId === meUserId;
            const organizerMsg = isOrganizer && !mine;
            return (
              <li key={m.id} className={cn("group flex items-start gap-2 rounded-xl px-2.5 py-1.5", mine ? "bg-brand-light" : "bg-muted/40")}>
                <UserAvatar user={{ firstName: m.displayName, profile: { avatar: m.avatar || "" } } as any} size={24} className="mt-0.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] leading-tight">
                    <span className="font-extrabold text-foreground">{mine ? "You" : m.displayName}</span>
                  </p>
                  <p className="break-words text-sm leading-snug text-foreground">{m.text}</p>
                </div>
                {/* Moderation (organizer, hover-revealed) */}
                {organizerMsg ? (
                  <div className="flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                    {onPin ? (
                      <button type="button" onClick={() => onPin(m.id)} aria-label={m.pinned ? "Unpin message" : "Pin message"} className="rounded p-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 text-muted-foreground hover:bg-muted hover:text-foreground">
                        <Pin className="h-3 w-3" aria-hidden="true" />
                      </button>
                    ) : null}
                    {onDelete ? (
                      <button type="button" onClick={() => onDelete(m.id)} aria-label="Delete message" className="rounded p-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 text-muted-foreground hover:bg-[#ba1a1a]/10 hover:text-[#ba1a1a]">
                        <Trash2 className="h-3 w-3" aria-hidden="true" />
                      </button>
                    ) : null}
                    {onMute ? (
                      <button type="button" onClick={() => onMute(eventId, m.senderId, true)} aria-label="Mute sender" className="rounded p-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 text-muted-foreground hover:bg-[#ba1a1a]/10 hover:text-[#ba1a1a]">
                        <VolumeOff className="h-3 w-3" aria-hidden="true" />
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })
        )}
      </ul>

      {/* Composer */}
      {canSend ? (
        <div className="mt-2 flex gap-1.5">
          <input
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, 500))}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                doSend();
              }
            }}
            placeholder="Message everyone…"
            aria-label="Chat message"
            className="h-9 min-w-0 flex-1 rounded-xl border border-input bg-background px-3 text-sm outline-none focus:border-primary/50"
          />
          <Button size="sm" onClick={doSend} disabled={sending || !text.trim()} className="gap-1">
            {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            Send
          </Button>
        </div>
      ) : chat.enabled && chat.muted ? (
        <p className="mt-2 flex items-center gap-1.5 rounded-xl border border-warning/40 bg-warning-light px-3 py-2 text-xs font-semibold text-warning">
          <VolumeOff className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          You&apos;re muted — organizers silenced your messages.
        </p>
      ) : isOrganizer ? (
        <p className="mt-2 flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <Volume2 className="h-3 w-3" aria-hidden="true" /> Hover a message to pin, delete or mute its sender.
        </p>
      ) : null}
    </div>
  );
}
