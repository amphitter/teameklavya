"use client";

/**
 * Thread panel (Part 10 §2, §9, §18, §27, §28, §29)
 * ──────────────────────────────────────────────────
 * Header + message area + composer, in a column that fills exactly the space
 * it is given. It never sets its own viewport height: the PAGE owns the
 * viewport maths, because a `100vh` here would fight the mobile keyboard and
 * the safe area (§2, §32).
 *
 * The composer is a sibling of the scroll area, not a child of it, so the
 * message list scrolls under a composer that stays put — and the composer can
 * never be scrolled off screen or covered by the keyboard.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Archive, ArchiveRestore, BellOff, BellRing, Info, Loader2, WifiOff } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { api } from "@/utils/api";
import { UserAvatar } from "@/components/user-avatar";
import { MessageComposer } from "@/components/messages/message-composer";
import { ThreadView } from "@/components/messages/thread-view";
import { cn } from "@/lib/utils";
import { handleOf } from "@/lib/social";
import { inbox, threads, type ConversationRow } from "@/lib/messages/store";
import { useSessionUser } from "@/components/shell/use-session-user";
import { refreshUnread, useThread } from "@/hooks/use-messages";
import { dropCachedThread } from "@/lib/messages/cache";
import { useTypingEmitter, type DmConnection } from "@/hooks/use-dm-socket";
import { compressFor } from "@/utils/compress-image";
import type { ChatMessage } from "@/hooks/use-social";

export interface ThreadPanelProps {
  conversationId: string | null;
  /** Called when the back affordance is used (mobile). */
  onBack?: () => void;
  /** Row used to paint the header before the thread meta arrives. */
  fallback?: ConversationRow | null;
  connection: DmConnection;
  /** Desktop renders the "choose a conversation" placeholder instead. */
  emptyState?: React.ReactNode;
}

export function ThreadPanel({ conversationId, onBack, fallback, connection, emptyState }: ThreadPanelProps) {
  const thread = useThread(conversationId);
  const { onInput, stop } = useTypingEmitter(conversationId);
  const { user } = useSessionUser();
  const myId = user?._id

  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [uploading, setUploading] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const markedRef = useRef<string | null>(null);

  const other = thread.other || fallback?.other || null;
  const name = `${other?.firstName || ""} ${other?.lastName || ""}`.trim() || "Conversation";

  /* Clear the unread badge for this thread as soon as it is on screen, and
     once more whenever a newer incoming message lands. One batched call each
     time, never one per message (§14). */
  const newestIncomingId = (() => {
    for (let i = thread.messages.length - 1; i >= 0; i--) {
      const m = thread.messages[i];
      if (m.pending || m.failed) continue;
      // Only the PEER's messages become read. Scanning for "the newest
      // message" would re-fire the batch every time the user sent one.
      if (myId && String(m.sender?._id) === String(myId)) continue;
      return m._id;
    }
    return null;
  })();

  useEffect(() => {
    if (!conversationId || !newestIncomingId || !thread.synced) return;
    if (markedRef.current === `${conversationId}:${newestIncomingId}`) return;
    markedRef.current = `${conversationId}:${newestIncomingId}`;
    api
      .post(`/messages/conversations/${conversationId}/read`, {})
      .then(() => {
        inbox.patch(conversationId, { unreadCount: 0 });
        void refreshUnread();
      })
      .catch(() => {
        markedRef.current = null;
      });
  }, [conversationId, newestIncomingId, thread.synced, myId]);

  const onOpenMenu = useCallback(() => setMenuOpen((v) => !v), []);

  const toggleArchive = useCallback(async () => {
    if (!conversationId) return;
    const nowArchived = Boolean(thread.archived);
    // Optimistic: the row moves between tabs immediately (§12 — never make
    // a cheap local change wait for the network).
    inbox.move(conversationId, !nowArchived, fallback ?? undefined);
    setMenuOpen(false);
    try {
      await api.post(`/messages/conversations/${conversationId}/archive`, { archived: !nowArchived });
      toast.success(nowArchived ? "Moved back to inbox" : "Conversation archived");
      void refreshUnread();
      if (!nowArchived) onBack?.();
    } catch {
      inbox.move(conversationId, nowArchived); // put it back
      toast.error("Couldn't update that conversation");
    }
  }, [conversationId, thread.archived, onBack]);

  const toggleMute = useCallback(async () => {
    if (!conversationId) return;
    try {
      const r = await api.post(`/messages/conversations/${conversationId}/mute`);
      const next = Boolean(r.data?.muted);
      // The hook owns thread meta; the row is patched directly so the inbox
      // reflects the mute without a refetch.
      inbox.patch(conversationId, { muted: next });
      toast.success(next ? "Notifications muted" : "Notifications on");
      setMenuOpen(false);
    } catch {
      toast.error("Couldn't update notifications");
    }
  }, [conversationId]);

  const sendImage = useCallback(
    async (file: File) => {
      if (!conversationId) return;
      setUploading(true);
      // §20 — upload in the background, never freeze the composer, and never
      // block the shell. A failure is reported with a retry, not a dead UI.
      const t = toast.loading("Uploading photo…");
      try {
        const { file: compressed } = await compressFor(file, "post");
        const fd = new FormData();
        fd.append("file", compressed, file.name || "photo.jpg");
        const up = await api.post("/upload/image?folder=messages", fd, {
          headers: { "Content-Type": "multipart/form-data" },
        });
        const url = up.data?.url;
        if (!url) throw new Error("upload");
        const res = await api.post(`/messages/conversations/${conversationId}`, { image: url });
        if (res.data?.success) {
          toast.success("Photo sent", { id: t });
        } else throw new Error("send");
      } catch {
        toast.error("Couldn't send that photo", { id: t });
      } finally {
        setUploading(false);
      }
    },
    [conversationId]
  );

  const sendFile = useCallback(
    async (file: File) => {
      if (!conversationId) return;
      setUploading(true);
      const t = toast.loading(`Uploading ${file.name}…`);
      try {
        const fd = new FormData();
        fd.append("file", file);
        const up = await api.post("/upload/image?folder=messages", fd, {
          headers: { "Content-Type": "multipart/form-data" },
        });
        const url = up.data?.url;
        if (!url) throw new Error("upload");
        const res = await api.post(`/messages/conversations/${conversationId}`, {
          attachment: { url, name: file.name, size: file.size, mime: file.type },
        });
        if (res.data?.success) toast.success("Attachment sent", { id: t });
        else throw new Error("send");
      } catch {
        toast.error("Couldn't send that file", { id: t });
      } finally {
        setUploading(false);
      }
    },
    [conversationId]
  );

  const unsend = useCallback(
    async (messageId: string) => {
      if (!conversationId) return;
      try {
        await api.delete(`/messages/${messageId}`);
        // Optimistic local edit; the socket event covers the peer.
        threads.patchMessage(conversationId, messageId, {
          deletedAt: new Date().toISOString(),
          content: "",
          image: "",
        });
      } catch {
        toast.error("Couldn't unsend that message");
      }
    },
    [conversationId]
  );

  if (!conversationId) {
    return <>{emptyState}</>;
  }

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-surface" aria-label={`Conversation with ${name}`}>
      {/* ── Header (§2) ───────────────────────────────────────────────── */}
      <header className="flex shrink-0 items-center gap-2 border-b border-outline-variant bg-surface-container-lowest px-2 py-1.5 sm:px-3">
        <button
          type="button"
          onClick={onBack}
          className="-ml-0.5 flex h-11 w-11 shrink-0 touch-manipulation items-center justify-center rounded-lg text-on-surface-variant active:bg-surface-container md:hidden"
          aria-label="Back to conversations"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>

        <Link
          href={other?.username ? `/profile/${other.username}` : "#"}
          className="flex min-w-0 flex-1 items-center gap-2.5"
        >
          <UserAvatar user={other} size={38} />
          <div className="min-w-0">
            <p className="truncate text-[15px] font-bold leading-tight text-on-surface">{name}</p>
            <p className="truncate text-[11px] leading-tight text-on-surface-variant">
              {thread.isPeerTyping ? (
                <span className="text-primary">typing…</span>
              ) : (
                `@${handleOf(other)}`
              )}
            </p>
          </div>
        </Link>

        <div className="relative flex items-center">
          <button
            type="button"
            onClick={onOpenMenu}
            className="flex h-11 w-11 touch-manipulation items-center justify-center rounded-lg text-on-surface-variant active:bg-surface-container sm:h-9 sm:w-9"
            aria-label="Conversation options"
            aria-expanded={menuOpen}
          >
            <Info className="h-5 w-5" />
          </button>

          {menuOpen ? (
            <>
              {/* Click-away. A backdrop rather than a document listener, so
                  it works identically for touch and mouse. */}
              <button
                type="button"
                className="fixed inset-0 z-40 cursor-default"
                aria-label="Close menu"
                onClick={() => setMenuOpen(false)}
              />
              <div className="absolute right-0 top-11 z-50 w-52 overflow-hidden rounded-xl border border-outline-variant bg-surface-container-lowest py-1 shadow-lg">
                <button
                  type="button"
                  onClick={toggleMute}
                  className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-[13px] text-on-surface hover:bg-surface-container"
                >
                  {(thread.muted ?? fallback?.muted) ? <BellRing className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
                  {(thread.muted ?? fallback?.muted) ? "Unmute notifications" : "Mute notifications"}
                </button>
                <button
                  type="button"
                  onClick={toggleArchive}
                  className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-[13px] text-on-surface hover:bg-surface-container"
                >
                  {thread.archived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
                  {thread.archived ? "Move to inbox" : "Archive"}
                </button>
                <Link
                  href={other?.username ? `/profile/${other.username}` : "#"}
                  className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-[13px] text-on-surface hover:bg-surface-container"
                >
                  <Info className="h-4 w-4" /> View profile
                </Link>
              </div>
            </>
          ) : null}
        </div>
      </header>

      {/* ── Connection banner (§27, §28) ──────────────────────────────── */}
      {connection !== "online" ? (
        <div
          className={cn(
            "flex shrink-0 items-center justify-center gap-1.5 py-1 text-[11px] font-semibold",
            connection === "offline" ? "bg-destructive/10 text-destructive" : "bg-surface-container text-on-surface-variant"
          )}
          role="status"
        >
          {connection === "offline" ? (
            <>
              <WifiOff className="h-3 w-3" aria-hidden /> Connection lost — messages stay visible. Reconnecting…
            </>
          ) : (
            <>
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> Connecting…
            </>
          )}
        </div>
      ) : null}

      {/* ── Messages ───────────────────────────────────────────────────── */}
      <ThreadView
        conversationId={conversationId}
        messages={thread.messages}
        currentUserId={myId}
        otherName={other?.firstName || undefined}
        hasMore={thread.hasMore}
        fetchingOlder={thread.fetchingOlder}
        loading={thread.loading}
        error={thread.error}
        typing={thread.isPeerTyping}
        onLoadOlder={thread.loadOlder}
        onRetryLoad={() => {
          // Drop the cached copy so the retry is a true first load, not a
          // re-render of the same failure.
          threads.reset(conversationId);
          void dropCachedThread(conversationId);
        }}
        onReply={(m) => setReplyTo(m)}
        onUnsend={unsend}
        onRetrySend={(m) => void thread.retry(m)}
      />

      {/* ── Composer (§18, §20) ───────────────────────────────────────── */}
      <MessageComposer
        onSend={(text) => {
          stop(); // withdraw the typing signal the moment the message goes
          void thread.sendMessage(text, (replyTo?._id as string) ?? null);
          setReplyTo(null);
        }}
        onTyping={onInput}
        onSendImage={sendImage}
        onSendFile={sendFile}
        sending={uploading}
        replyingTo={
          replyTo
            ? {
                authorName:
                  `${replyTo.sender?.firstName || ""} ${replyTo.sender?.lastName || ""}`.trim() || "Message",
                content: replyTo.content,
                image: replyTo.image,
              }
            : null
        }
        onCancelReply={() => setReplyTo(null)}
        placeholder={`Message ${other?.firstName || ""}…`.trim()}
      />
    </section>
  );
}
