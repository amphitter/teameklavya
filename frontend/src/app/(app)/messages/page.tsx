"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowLeft,
  Archive,
  ArchiveRestore,
  BellOff,
  BellRing,
  Loader2,
  MessageCircle,
  Search,
} from "lucide-react";
import { api } from "@/utils/api";
import { usePolling } from "@/lib/query";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, Skeleton } from "@/components/states";
import { UserAvatar } from "@/components/user-avatar";
import { useSessionUser } from "@/components/shell/use-session-user";
import { handleOf, timeAgo } from "@/lib/social";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";
import { compressFor } from "@/utils/compress-image";
import { MessageList, MessageListSkeleton } from "@/components/messages/message-list";
import type { ChatMessage as SharedChatMessage } from "@/hooks/use-social";
import { MessageComposer } from "@/components/messages/message-composer";

interface Conversation {
  _id: string;
  other: { _id: string; firstName: string; lastName: string; username?: string; profile?: any } | null;
  lastMessage: { text: string; at: string; mine: boolean } | null;
  updatedAt: string;
  unreadCount: number;
  muted?: boolean;
  archived?: boolean;
}

interface ChatMessage {
  _id: string;
  sender: { _id: string; firstName?: string; lastName?: string; username?: string; profile?: any } | null;
  content: string;
  image?: string;
  attachment?: { url?: string; name?: string; size?: number; mime?: string };
  replyTo?: string | null;
  reactions?: { emoji: string; count: number; mine: boolean }[];
  deletedAt?: string | null;
  readAt?: string | null;
  createdAt: string;
  pending?: boolean;
  failed?: boolean;
}

export default function MessagesPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-4xl px-3 py-10"><Skeleton className="h-16" /></div>}>
      <MessagesView />
    </Suspense>
  );
}

function MessagesView() {
  const { user, ready } = useSessionUser();
  const router = useRouter();
  const params = useSearchParams();
  const withUser = params.get("with");
  const openConv = params.get("c");
  const initialArchive = params.get("view") === "archived";

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState(false);
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(initialArchive);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [other, setOther] = useState<Conversation["other"]>(null);
  const [muted, setMuted] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [replyTo, setReplyTo] = useState<SharedChatMessage | null>(null);
  const [mobilePane, setMobilePane] = useState<"list" | "thread">("list");
  const fileRef = useRef<HTMLInputElement>(null);

  /* ── conversations list ───────────────────────────────────────────────
   * Adaptive polling: paused while the tab is hidden, and stretched toward
   * 60s when consecutive polls return an identical list — so an idle tab
   * costs a trickle instead of ~300 requests/hour. Preserved from the
   * previous implementation. */
  const listSigRef = useRef("");
  const reportListRef = useRef<(changed: boolean) => void>(() => {});

  const loadList = useCallback(
    async (silent = false) => {
      if (!silent) setListLoading(true);
      try {
        const url = showArchived ? "/messages/conversations?view=archived" : "/messages/conversations";
        const r = await api.get(url);
        const convs: Conversation[] = r.data?.conversations || [];
        const sig = convs.map((c) => `${c._id}:${c.unreadCount || 0}`).join(",");
        reportListRef.current(sig !== listSigRef.current);
        listSigRef.current = sig;
        setConversations(convs);
        setListError(false);
      } catch {
        if (!silent) setListError(true);
      } finally {
        setListLoading(false);
      }
    },
    [showArchived]
  );

  const { reportResult: reportList } = usePolling(loadList, {
    intervalMs: 12_000,
    maxIntervalMs: 60_000,
    enabled: Boolean(user),
  });
  reportListRef.current = reportList;

  /* ?with=userId → open (or create) that conversation */
  useEffect(() => {
    if (!user || !withUser || withUser === user._id) return;
    api
      .post("/messages/conversations", { userId: withUser })
      .then((r) => {
        if (r.data?.conversationId) {
          setActiveId(r.data.conversationId);
          setOther(r.data.other);
          setMobilePane("thread");
        }
      })
      .catch((e) => toast.error(e.response?.data?.message || "Couldn't open conversation"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, withUser]);

  /* ?c=conversationId → notification deep-link */
  useEffect(() => {
    if (!user || !openConv || activeId === openConv) return;
    const found = conversations.find((c) => c._id === openConv);
    setActiveId(openConv);
    setMobilePane("thread");
    if (found?.other) setOther(found.other);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, openConv, conversations.length]);

  /* ── active thread (adaptive polling, preserved) ── */
  const threadSigRef = useRef("");
  const reportThreadRef = useRef<(changed: boolean) => void>(() => {});

  const loadThread = useCallback(async (silent = false) => {
    if (!activeId) return;
    if (!silent) setThreadLoading(true);
    try {
      const r = await api.get(`/messages/conversations/${activeId}`);
      const msgs: ChatMessage[] = r.data?.messages || [];
      const last = msgs[msgs.length - 1];
      const sig = `${msgs.length}:${last?._id || ""}`;
      reportThreadRef.current(sig !== threadSigRef.current);
      threadSigRef.current = sig;
      setMessages(msgs);
      if (r.data?.other) setOther(r.data.other);
      if (typeof r.data?.muted === "boolean") setMuted(r.data.muted);
    } catch {
      /* silent: a dropped background poll must not blank the thread */
    } finally {
      setThreadLoading(false);
    }
  }, [activeId]);

  const { reportResult: reportThread } = usePolling(loadThread, {
    intervalMs: 6_000,
    maxIntervalMs: 30_000,
    enabled: Boolean(activeId),
  });
  reportThreadRef.current = reportThread;

  const openThread = useCallback((c: Conversation) => {
    setActiveId(c._id);
    setOther(c.other);
    setMobilePane("thread");
  }, []);

  /* ── send (optimistic, §45 / §58) ── */
  const send = useCallback(
    async (content: string) => {
      if (!activeId || sending) return;
      const optimistic: ChatMessage = {
        _id: `tmp-${Date.now()}`,
        sender: user ? { _id: user._id ?? "", firstName: user.firstName ?? "", lastName: user.lastName ?? "" } : null,
        content,
        replyTo: replyTo?._id ?? null,
        createdAt: new Date().toISOString(),
        pending: true,
      };
      setMessages((p) => [...p, optimistic]);
      setReplyTo(null);
      setSending(true);
      try {
        const res = await api.post(`/messages/conversations/${activeId}`, {
          content,
          ...(optimistic.replyTo ? { replyTo: optimistic.replyTo } : {}),
        });
        if (res.data?.success) {
          setMessages((p) => p.map((m) => (m._id === optimistic._id ? res.data.message : m)));
          loadList(true);
        } else throw new Error();
      } catch {
        // §45 — roll the optimistic bubble back, but mark rather than vanish it
        // so the user can see the send failed instead of wondering where it went.
        setMessages((p) => p.map((m) => (m._id === optimistic._id ? { ...m, pending: false, failed: true } : m)));
        toast.error("Message didn't send — tap to retry");
      } finally {
        setSending(false);
      }
    },
    [activeId, sending, user, replyTo, loadList]
  );

  const retrySend = useCallback(
    (m: ChatMessage) => {
      setMessages((p) => p.filter((x) => x._id !== m._id));
      send(m.content);
    },
    [send]
  );

  const sendImage = useCallback(
    async (file: File) => {
      if (!activeId) return;
      setUploading(true);
      try {
        const { file: compressed } = await compressFor(file, "post");
        const fd = new FormData();
        fd.append("file", compressed, file.name || "photo.jpg");
        const up = await api.post("/upload/image?folder=messages", fd, {
          headers: { "Content-Type": "multipart/form-data" },
        });
        const url = up.data?.url;
        if (!url) throw new Error("Upload failed");
        const res = await api.post(`/messages/conversations/${activeId}`, { image: url });
        if (res.data?.success) {
          setMessages((p) => [...p, res.data.message]);
          loadList(true);
        }
      } catch {
        toast.error("Couldn't send that photo");
      } finally {
        setUploading(false);
      }
    },
    [activeId, loadList]
  );

  const sendFile = useCallback(
    async (file: File) => {
      if (!activeId) return;
      setUploading(true);
      try {
        const fd = new FormData();
        fd.append("file", file);
        const up = await api.post("/upload/image?folder=messages", fd, {
          headers: { "Content-Type": "multipart/form-data" },
        });
        const url = up.data?.url;
        if (!url) throw new Error("Upload failed");
        const res = await api.post(`/messages/conversations/${activeId}`, {
          attachment: { url, name: file.name, size: file.size, mime: file.type },
        });
        if (res.data?.success) {
          setMessages((p) => [...p, res.data.message]);
          loadList(true);
        }
      } catch {
        toast.error("Couldn't send that file");
      } finally {
        setUploading(false);
      }
    },
    [activeId, loadList]
  );

  /* ── reactions (§31) ── */
  const react = useCallback(async (messageId: string, emoji: string) => {
    // Optimistic: toggle locally, reconcile with the server summary.
    setMessages((p) =>
      p.map((m) => {
        if (m._id !== messageId) return m;
        const list = [...(m.reactions || [])];
        const existing = list.find((r) => r.emoji === emoji);
        if (existing?.mine) {
          const next = list.map((r) => (r.emoji === emoji ? { ...r, count: r.count - 1, mine: false } : r)).filter((r) => r.count > 0);
          return { ...m, reactions: next };
        }
        // Switching emoji replaces the previous pick (server behaviour).
        const cleared = list.map((r) => (r.mine ? { ...r, count: r.count - 1, mine: false } : r)).filter((r) => r.count > 0);
        const target = cleared.find((r) => r.emoji === emoji);
        if (target) target.count += 1, (target.mine = true);
        else cleared.push({ emoji, count: 1, mine: true });
        return { ...m, reactions: cleared };
      })
    );
    try {
      const res = await api.post(`/messages/${messageId}/react`, { emoji });
      if (res.data?.success) {
        setMessages((p) => p.map((m) => (m._id === messageId ? { ...m, reactions: res.data.reactions } : m)));
      }
    } catch {
      toast.error("Couldn't add that reaction");
      loadThread(true);
    }
  }, [loadThread]);

  const unsend = useCallback(async (messageId: string) => {
    try {
      await api.delete(`/messages/${messageId}`);
      setMessages((p) => p.map((m) => (m._id === messageId ? { ...m, deletedAt: new Date().toISOString(), content: "" } : m)));
    } catch {
      toast.error("Couldn't unsend that message");
    }
  }, []);

  /* ── archive (§32-33) ── */
  const toggleArchive = useCallback(async () => {
    if (!activeId) return;
    const isArchived = conversations.find((c) => c._id === activeId)?.archived || showArchived;
    try {
      await api.post(`/messages/conversations/${activeId}/archive`, { archived: !isArchived });
      toast.success(isArchived ? "Moved back to inbox" : "Conversation archived");
      await loadList();
      if (!isArchived) {
        setActiveId(null);
        setMessages([]);
        setMobilePane("list");
      }
    } catch {
      toast.error("Couldn't update that conversation");
    }
  }, [activeId, conversations, showArchived, loadList]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter((c) => {
      const n = `${c.other?.firstName || ""} ${c.other?.lastName || ""} ${c.other?.username || ""}`.toLowerCase();
      return n.includes(q) || (c.lastMessage?.text || "").toLowerCase().includes(q);
    });
  }, [conversations, search]);

  if (!ready) {
    return (
      <div className="mx-auto max-w-5xl px-3 py-6">
        <Skeleton className="h-[70vh] w-full rounded-2xl" />
      </div>
    );
  }

  const activeConv = conversations.find((c) => c._id === activeId);
  const isArchivedView = showArchived;

  return (
    <div className="mx-auto flex h-[calc(100vh-4rem)] w-full max-w-5xl flex-col overflow-hidden sm:h-[calc(100vh-5rem)]">
      <div className="flex min-h-0 flex-1 overflow-hidden rounded-none border border-outline-variant bg-surface-container-lowest sm:my-3 sm:rounded-2xl sm:elevation-card">
        {/* ── Conversation list ───────────────────────────────────────── */}
        <aside
          className={cn(
            "flex w-full shrink-0 flex-col border-r border-outline-variant bg-surface-container-lowest md:flex md:w-[21rem]",
            mobilePane === "thread" ? "hidden" : "flex"
          )}
        >
          <div className="shrink-0 space-y-2 border-b border-outline-variant px-3 py-3">
            <div className="flex items-center justify-between gap-2">
              <h1 className="text-headline-sm font-bold tracking-tight text-on-surface">
                {isArchivedView ? "Archived" : "Messages"}
              </h1>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setShowArchived((v) => !v);
                  setActiveId(null);
                  setMessages([]);
                  loadList();
                }}
                className="gap-1.5 text-[12px]"
                aria-label={isArchivedView ? "Back to inbox" : "View archived chats"}
              >
                {isArchivedView ? (
                  <>
                    <ArchiveRestore className="h-4 w-4" /> Inbox
                  </>
                ) : (
                  <>
                    <Archive className="h-4 w-4" /> Archive
                  </>
                )}
              </Button>
            </div>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-on-surface-variant" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={isArchivedView ? "Search archived chats" : "Search messages"}
                aria-label="Search conversations"
                className="w-full rounded-xl border border-outline-variant bg-surface py-2 pl-9 pr-3 text-[14px] outline-none placeholder:text-on-surface-variant/70 focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/12"
              />
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {listLoading ? (
              <div className="space-y-1 p-2">
                {[0, 1, 2, 3, 4].map((i) => (
                  <div key={i} className="flex items-center gap-3 px-2 py-2">
                    <Skeleton className="h-11 w-11 rounded-full" />
                    <div className="flex-1 space-y-1.5">
                      <Skeleton className="h-3.5 w-28" />
                      <Skeleton className="h-3 w-40" />
                    </div>
                  </div>
                ))}
              </div>
            ) : listError ? (
              <ErrorState title="Could not load conversations." onRetry={() => loadList()} />
            ) : filtered.length === 0 ? (
              <EmptyState
                icon={MessageCircle}
                title={isArchivedView ? "No archived conversations." : "No conversations yet"}
                description={
                  isArchivedView
                    ? "Conversations you archive will be kept here — they're never deleted."
                    : "Message someone from their profile to start a conversation."
                }
              />
            ) : (
              <ul className="divide-y divide-outline-variant/60">
                {filtered.map((c) => {
                  const isActive = c._id === activeId;
                  const unread = c.unreadCount > 0;
                  return (
                    <li key={c._id}>
                      <button
                        type="button"
                        onClick={() => openThread(c)}
                        aria-current={isActive ? "true" : undefined}
                        className={cn(
                          "flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors",
                          isActive ? "bg-purple-light" : "hover:bg-surface-container"
                        )}
                      >
                        <div className="relative shrink-0">
                          <UserAvatar user={c.other} size={44} />
                          {/* Archived marker — visually separate from the inbox (§34) */}
                          {c.archived ? (
                            <span className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full border-2 border-surface-container-lowest bg-on-surface-variant">
                              <Archive className="h-2 w-2 text-white" />
                            </span>
                          ) : null}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline justify-between gap-2">
                            {/* §34 — unread chats get stronger typography */}
                            <span className={cn("truncate text-[14px] text-on-surface", unread ? "font-bold" : "font-semibold")}>
                              {`${c.other?.firstName || ""} ${c.other?.lastName || ""}`.trim() || "Unknown"}
                            </span>
                            <span className="shrink-0 text-[11px] text-on-surface-variant">
                              {c.lastMessage?.at ? timeAgo(c.lastMessage.at) : ""}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className={cn("min-w-0 flex-1 truncate text-[13px]", unread ? "font-semibold text-on-surface" : "text-on-surface-variant")}>
                              {c.lastMessage ? `${c.lastMessage.mine ? "You: " : ""}${c.lastMessage.text}` : `@${handleOf(c.other)} — say hi`}
                            </span>
                            {unread ? (
                              <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-bold text-white">
                                {c.unreadCount > 9 ? "9+" : c.unreadCount}
                              </span>
                            ) : null}
                            {c.muted ? <BellOff className="h-3 w-3 shrink-0 text-on-surface-variant" /> : null}
                          </div>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </aside>

        {/* ── Thread ──────────────────────────────────────────────────── */}
        <section
          className={cn(
            "min-w-0 flex-1 flex-col bg-surface md:flex",
            mobilePane === "thread" ? "flex" : "hidden"
          )}
        >
          {!activeId ? (
            <div className="hidden flex-1 items-center justify-center md:flex">
              <EmptyState
                icon={MessageCircle}
                title="Select a conversation"
                description="Pick a chat on the left, or message someone from their profile."
              />
            </div>
          ) : (
            <>
              {/* Thread header */}
              <header className="flex shrink-0 items-center gap-2 border-b border-outline-variant bg-surface-container-lowest px-2 py-2 sm:px-3">
                <button
                  type="button"
                  onClick={() => setMobilePane("list")}
                  className="-ml-1 rounded-lg p-1.5 text-on-surface-variant hover:bg-surface-container md:hidden"
                  aria-label="Back to conversations"
                >
                  <ArrowLeft className="h-5 w-5" />
                </button>
                {other ? (
                  <Link href={`/profile/${other.username || other._id}`} className="flex min-w-0 items-center gap-2.5">
                    <UserAvatar user={other} size={38} />
                    <div className="min-w-0">
                      <p className="truncate text-[14px] font-bold text-on-surface">
                        {`${other.firstName || ""} ${other.lastName || ""}`.trim()}
                      </p>
                      <p className="truncate text-[11px] text-on-surface-variant">@{handleOf(other)}</p>
                    </div>
                  </Link>
                ) : (
                  <div className="h-9 w-40" />
                )}
                <div className="ml-auto flex items-center gap-0.5">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={async () => {
                      try {
                        const r = await api.post(`/messages/conversations/${activeId}/mute`);
                        setMuted(Boolean(r.data?.muted));
                      } catch {
                        toast.error("Couldn't update notifications");
                      }
                    }}
                    className="h-9 w-9 p-0"
                    aria-label={muted ? "Unmute conversation" : "Mute conversation"}
                  >
                    {muted ? <BellOff className="h-4 w-4" /> : <BellRing className="h-4 w-4" />}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={toggleArchive}
                    className="h-9 gap-1.5 px-2 text-[12px]"
                    aria-label={isArchivedView ? "Unarchive conversation" : "Archive conversation"}
                  >
                    {isArchivedView ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
                    <span className="hidden lg:inline">{isArchivedView ? "Unarchive" : "Archive"}</span>
                  </Button>
                </div>
              </header>

              {threadLoading && !messages.length ? (
                <MessageListSkeleton />
              ) : !other ? null : (
                <MessageList
                  messages={messages}
                  currentUserId={user?._id}
                  loading={threadLoading}
                  onReact={react}
                  onReply={(m) => setReplyTo(m)}
                  onUnsend={unsend}
                  emptyState={
                    <div className="flex flex-1 flex-col items-center justify-center gap-1 px-6 text-center">
                      <MessageCircle className="h-8 w-8 text-on-surface-variant/50" />
                      <p className="text-[14px] font-bold text-on-surface">Start the conversation</p>
                      <p className="max-w-[16rem] text-[12px] text-on-surface-variant">
                        Say hi to {other.firstName} — messages are private between you two.
                      </p>
                    </div>
                  }
                />
              )}

              {messages.some((m) => m.failed) ? (
                <button
                  type="button"
                  onClick={() => {
                    const failed = messages.find((m) => m.failed);
                    if (failed) retrySend(failed);
                  }}
                  className="mx-auto mb-1 rounded-full bg-destructive/10 px-3 py-1 text-[11px] font-semibold text-destructive"
                >
                  A message failed to send — tap to retry
                </button>
              ) : null}

              <MessageComposer
                onSend={send}
                onSendImage={sendImage}
                onSendFile={sendFile}
                sending={sending || uploading}
                disabled={!other}
                replyingTo={
                  replyTo
                    ? {
                        authorName: `${replyTo.sender?.firstName || ""} ${replyTo.sender?.lastName || ""}`.trim() || "Message",
                        content: replyTo.content,
                        image: replyTo.image,
                      }
                    : null
                }
                onCancelReply={() => setReplyTo(null)}
                placeholder={other ? `Message ${other.firstName || ""}…`.trim() : "Message…"}
              />
            </>
          )}
        </section>
      </div>
    </div>
  );
}
