"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowLeft,
  BellOff,
  BellRing,
  EyeOff,
  ImagePlus,
  Loader2,
  MessageCircle,
  Search,
  SendHorizontal,
  X,
} from "lucide-react";
import { api } from "@/utils/api";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, Skeleton } from "@/components/states";
import { UserAvatar } from "@/components/user-avatar";
import { useSessionUser } from "@/components/shell/use-session-user";
import { handleOf, timeAgo } from "@/lib/social";
import { cloudinaryUrl } from "@/utils/image";
import { cn } from "@/lib/utils";

interface Conversation {
  _id: string;
  other: { _id: string; firstName: string; lastName: string; username?: string; profile?: any } | null;
  lastMessage: { text: string; at: string; mine: boolean } | null;
  updatedAt: string;
  unreadCount: number;
  muted?: boolean;
}

interface ChatMessage {
  _id: string;
  sender: { _id: string; firstName: string; lastName: string } | null;
  content: string;
  image?: string;
  deletedAt?: string | null;
  readAt?: string | null;
  createdAt: string;
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
  const params = useSearchParams();
  const withUser = params.get("with");
  const openConv = params.get("c"); // from a "sent you a message" notification

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState(false);
  const [search, setSearch] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [other, setOther] = useState<Conversation["other"]>(null);
  const [muted, setMuted] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [pendingImage, setPendingImage] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  /* ── conversations list (poll every 12s) ── */
  const loadList = useCallback((silent = false) => {
    if (!silent) setListLoading(true);
    api
      .get("/messages/conversations")
      .then((r) => setConversations(r.data?.conversations || []))
      .catch(() => !silent && setListError(true))
      .finally(() => setListLoading(false));
  }, []);

  useEffect(() => {
    if (!user) return;
    loadList();
    const t = setInterval(() => loadList(true), 12_000);
    return () => clearInterval(t);
  }, [user, loadList]);

  /* ── ?with=userId → open (or create) that conversation ── */
  useEffect(() => {
    if (!user || !withUser || withUser === user._id) return;
    api
      .post("/messages/conversations", { userId: withUser })
      .then((r) => {
        if (r.data?.conversationId) {
          setActiveId(r.data.conversationId);
          setOther(r.data.other);
        }
      })
      .catch((e) => toast.error(e.response?.data?.message || "Couldn't open conversation"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, withUser]);

  /* ── ?c=conversationId → open that thread (notification deep-link) ── */
  useEffect(() => {
    if (!user || !openConv || activeId === openConv) return;
    const found = conversations.find((c) => c._id === openConv);
    setActiveId(openConv);
    if (found?.other) setOther(found.other);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, openConv, conversations.length]);

  /* ── active thread (poll every 6s) ── */
  const loadThread = useCallback(
    (silent = false) => {
      if (!activeId) return;
      if (!silent) setThreadLoading(true);
      api
        .get(`/messages/conversations/${activeId}`)
        .then((r) => {
          setMessages(r.data?.messages || []);
          if (r.data?.other) setOther(r.data.other);
          if (typeof r.data?.muted === "boolean") setMuted(r.data.muted);
        })
        .catch(() => {})
        .finally(() => setThreadLoading(false));
    },
    [activeId]
  );

  useEffect(() => {
    if (!activeId) return;
    loadThread();
    const t = setInterval(() => loadThread(true), 6_000);
    return () => clearInterval(t);
  }, [activeId, loadThread]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: messages.length > 20 ? "auto" : "smooth" });
  }, [messages.length]);

  const send = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const content = text.trim();
    const image = pendingImage;
    if ((!content && !image) || !activeId || sending) return;
    if (content && image) return; // one or the other (backend-enforced)
    setSending(true);
    const optimistic: ChatMessage = {
      _id: `tmp-${Date.now()}`,
      sender: user ? { _id: user._id ?? "", firstName: user.firstName ?? "", lastName: user.lastName ?? "" } : null,
      content,
      image,
      createdAt: new Date().toISOString(),
    };
    setMessages((p) => [...p, optimistic]);
    setText("");
    setPendingImage("");
    try {
      const res = await api.post(`/messages/conversations/${activeId}`, { content, image: image || undefined });
      if (res.data?.success) {
        setMessages((p) => p.map((m) => (m._id === optimistic._id ? res.data.message : m)));
        loadList(true);
      } else throw new Error();
    } catch (err: any) {
      setMessages((p) => p.filter((m) => m._id !== optimistic._id));
      setText(content);
      setPendingImage(image);
      toast.error(err.response?.data?.message || "Couldn't send message");
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const uploadImage = async (file: File) => {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await api.post("/upload/image?folder=messages", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      if (res.data?.success && res.data.url) setPendingImage(res.data.url);
      else throw new Error();
    } catch {
      toast.error("Photo upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const deleteMessage = (id: string) => {
    api
      .delete(`/messages/${id}`)
      .then((r) => {
        if (r.data?.success) {
          setMessages((p) => p.map((m) => (m._id === id ? { ...m, content: "", image: "", deletedAt: new Date().toISOString() } : m)));
          loadList(true);
        } else toast.error(r.data?.message || "Couldn't delete");
      })
      .catch(() => toast.error("Couldn't delete"));
  };

  const toggleMute = () => {
    if (!activeId) return;
    api
      .post(`/messages/conversations/${activeId}/mute`)
      .then((r) => {
        if (r.data?.success) {
          setMuted(Boolean(r.data.muted));
          toast.success(r.data.muted ? "Chat muted — no more notifications" : "Chat unmuted");
          setConversations((p) => p.map((c) => (c._id === activeId ? { ...c, muted: Boolean(r.data.muted) } : c)));
        }
      })
      .catch(() => toast.error("Couldn't update mute"));
  };

  const hideConversation = () => {
    if (!activeId) return;
    api
      .post(`/messages/conversations/${activeId}/hide`)
      .then((r) => {
        if (r.data?.success) {
          toast.success("Chat hidden — it returns when a new message arrives");
          setConversations((p) => p.filter((c) => c._id !== activeId));
          setActiveId(null);
          setOther(null);
        }
      })
      .catch(() => toast.error("Couldn't hide chat"));
  };

  /* ── auth gate ── */
  if (ready && !user) {
    return (
      <div className="mx-auto max-w-xl px-3 py-16">
        <EmptyState
          icon={MessageCircle}
          title="Sign in to see your messages"
          description="Chat with people you meet at events — speakers, teammates and organizers."
        />
        <div className="mt-4 flex justify-center gap-2">
          <Button asChild>
            <Link href="/login">Sign in</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/signup">Create account</Link>
          </Button>
        </div>
      </div>
    );
  }

  const q = search.trim().toLowerCase();
  const visible = q
    ? conversations.filter(
        (c) =>
          `${c.other?.firstName || ""} ${c.other?.lastName || ""}`.toLowerCase().includes(q) ||
          (c.other?.username || "").toLowerCase().includes(q)
      )
    : conversations;
  const active = visible.find((c) => c._id === activeId);
  const lastMine = [...messages].reverse().find((m) => m.sender?._id === user?._id && !m.deletedAt);

  return (
    <div className="mx-auto flex h-[calc(100dvh-9.5rem)] max-w-5xl gap-0 px-0 py-0 sm:h-[calc(100dvh-10rem)] sm:gap-5 sm:px-6 sm:py-5 lg:h-[calc(100dvh-7rem)]">
      {/* ── Conversation list ── */}
      <div
        className={cn(
          "flex w-full flex-col border-border sm:w-[330px] sm:shrink-0 sm:rounded-2xl sm:border sm:bg-card",
          activeId && "hidden sm:flex"
        )}
      >
        <div className="border-b border-border px-4 py-3.5">
          <h1 className="text-lg font-extrabold tracking-tight text-foreground">Messages</h1>
          <p className="text-xs text-muted-foreground">Direct chats with people from EventHub</p>
          <div className="relative mt-2.5">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search chats by name or username…"
              className="w-full rounded-xl border border-border bg-background py-2 pl-8 pr-3 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-primary/50"
            />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {listLoading && conversations.length === 0 ? (
            Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="mb-2 h-16" />)
          ) : listError ? (
            <div className="p-3">
              <ErrorState title="Couldn't load chats" onRetry={() => loadList()} />
            </div>
          ) : visible.length === 0 ? (
            <div className="p-3">
              <EmptyState
                icon={MessageCircle}
                title={q ? "No matching chats" : "No conversations yet"}
                description={q ? "Try a different name." : "Visit someone's profile and tap Message to start a chat."}
              />
            </div>
          ) : (
            visible.map((c) => (
              <button
                key={c._id}
                type="button"
                onClick={() => {
                  setActiveId(c._id);
                  setOther(c.other);
                  setMuted(Boolean(c.muted));
                }}
                className={cn(
                  "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors",
                  c._id === activeId ? "bg-brand-light" : "hover:bg-muted"
                )}
              >
                <UserAvatar user={c.other} size={42} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="truncate text-sm font-bold text-foreground">
                      {c.other?.firstName} {c.other?.lastName}
                    </p>
                    {c.lastMessage?.at && (
                      <span className="shrink-0 text-[10px] text-muted-foreground">{timeAgo(c.lastMessage.at)}</span>
                    )}
                  </div>
                  <p className={cn("truncate text-xs", c.unreadCount > 0 ? "font-bold text-foreground" : "text-muted-foreground")}>
                    {c.lastMessage ? `${c.lastMessage.mine ? "You: " : ""}${c.lastMessage.text}` : `@${handleOf(c.other)} — say hi`}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {c.muted && <BellOff className="h-3.5 w-3.5 text-muted-foreground" aria-label="Muted" />}
                  {c.unreadCount > 0 && (
                    <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-bold text-primary-foreground">
                      {c.unreadCount}
                    </span>
                  )}
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* ── Chat thread ── */}
      <div
        className={cn(
          "flex min-w-0 flex-1 flex-col overflow-hidden sm:rounded-2xl sm:border sm:border-border sm:bg-card",
          !activeId && "hidden sm:flex"
        )}
      >
        {activeId ? (
          <>
            <div className="flex items-center gap-3 border-b border-border px-4 py-3">
              <button
                type="button"
                onClick={() => setActiveId(null)}
                className="-ml-1 rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground sm:hidden"
                aria-label="Back to conversations"
              >
                <ArrowLeft className="h-5 w-5" />
              </button>
              {other && (
                <>
                  <UserAvatar user={other} size={36} />
                  <div className="min-w-0 flex-1">
                    <Link href={`/profile/${other._id}`} className="block truncate text-sm font-bold text-foreground hover:underline">
                      {other.firstName} {other.lastName}
                    </Link>
                    <p className="truncate text-xs text-muted-foreground">@{handleOf(other)}</p>
                  </div>
                </>
              )}
              <button
                type="button"
                onClick={toggleMute}
                title={muted ? "Unmute chat" : "Mute chat notifications"}
                className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                {muted ? <BellOff className="h-4 w-4" /> : <BellRing className="h-4 w-4" />}
              </button>
              <button
                type="button"
                onClick={hideConversation}
                title="Hide chat (returns when a new message arrives)"
                className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <EyeOff className="h-4 w-4" />
              </button>
            </div>

            <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto p-4">
              {threadLoading && messages.length === 0 && (
                <p className="py-8 text-center text-sm text-muted-foreground">Loading messages…</p>
              )}
              {!threadLoading && messages.length === 0 && (
                <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
                  <MessageCircle className="h-8 w-8 text-muted-foreground/50" />
                  <p className="text-sm font-semibold text-foreground">Start the conversation</p>
                  <p className="max-w-60 text-xs text-muted-foreground">Say hi to {other?.firstName} — messages are private between you two.</p>
                </div>
              )}
              {messages.map((m) => {
                const mine = user && m.sender?._id === user._id;
                const deleted = Boolean(m.deletedAt);
                return (
                  <div key={m._id} className={cn("group/msg flex", mine ? "justify-end" : "justify-start")}>
                    <div
                      className={cn(
                        "max-w-[78%] rounded-2xl px-3.5 py-2 text-sm",
                        mine
                          ? "rounded-br-md bg-primary text-primary-foreground"
                          : "rounded-bl-md bg-muted text-foreground",
                        deleted && "italic opacity-60"
                      )}
                    >
                      {deleted ? (
                        <p className="text-xs">Message deleted</p>
                      ) : m.image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={cloudinaryUrl(m.image, { w: 560, h: 560 }) || m.image}
                          alt="Photo message"
                          className="max-h-72 rounded-xl object-cover"
                        />
                      ) : (
                        <p className="whitespace-pre-wrap break-words">{m.content}</p>
                      )}
                      {!deleted && m.content ? (
                        <p className={cn("mt-0.5 text-right text-[10px]", mine ? "text-primary-foreground/70" : "text-muted-foreground")}>
                          {new Date(m.createdAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                        </p>
                      ) : null}
                    </div>
                    {mine && !deleted && !m._id.startsWith("tmp-") && (
                      <button
                        type="button"
                        onClick={() => deleteMessage(m._id)}
                        title="Unsend"
                        className="ml-1 self-center rounded-lg p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-[#ba1a1a] group-hover/msg:opacity-100"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                );
              })}
              {lastMine?.readAt && (
                <p className="pr-1 text-right text-[10px] font-semibold text-muted-foreground">Seen</p>
              )}
              <div ref={bottomRef} />
            </div>

            {/* Pending image preview */}
            {pendingImage && (
              <div className="flex items-center gap-2 border-t border-border px-3 py-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={cloudinaryUrl(pendingImage, { w: 120, h: 120 })} alt="" className="h-12 w-12 rounded-lg object-cover" />
                <p className="flex-1 text-xs text-muted-foreground">Photo ready to send</p>
                <button type="button" onClick={() => setPendingImage("")} className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted" aria-label="Remove photo">
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}

            <form onSubmit={send} className="flex items-end gap-2 border-t border-border p-3">
              <label className="cursor-pointer">
                <span
                  className={cn(
                    "flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                    uploading && "opacity-60"
                  )}
                  title="Send a photo"
                >
                  {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
                </span>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={(e) => e.target.files?.[0] && uploadImage(e.target.files[0])}
                />
              </label>
              <textarea
                ref={inputRef}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                rows={1}
                maxLength={2000}
                disabled={Boolean(pendingImage)}
                placeholder={pendingImage ? "Sending photo…" : `Message ${other?.firstName || ""}…`}
                aria-label="Message"
                className="max-h-28 min-h-[40px] flex-1 resize-none rounded-2xl border border-input bg-background px-4 py-2.5 text-sm outline-none placeholder:text-muted-foreground focus:border-primary/50 focus:ring-4 focus:ring-primary/10 disabled:opacity-60"
              />
              <Button
                type="submit"
                size="icon"
                className="h-10 w-10 shrink-0 rounded-full"
                disabled={sending || uploading || (!text.trim() && !pendingImage)}
                aria-label="Send message"
              >
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <SendHorizontal className="h-4 w-4" />}
              </Button>
            </form>
          </>
        ) : (
          <div className="hidden h-full flex-col items-center justify-center gap-2 p-8 text-center sm:flex">
            <MessageCircle className="h-10 w-10 text-muted-foreground/40" />
            <p className="text-sm font-semibold text-foreground">Your messages</p>
            <p className="max-w-64 text-xs text-muted-foreground">
              Select a conversation, or open someone&apos;s profile and tap Message.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
