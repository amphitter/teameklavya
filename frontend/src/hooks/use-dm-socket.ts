"use client";

/**
 * DM realtime (Part 10 §12, §13, §14, §28)
 * ────────────────────────────────────────
 * Subscribes the app to `dm:*` events on the ONE existing Socket.IO
 * connection. There is no second socket and no polling fallback loop
 * competing with it — the store is updated from events, and the REST calls
 * remain the source of truth for anything the events leave open.
 *
 * ── ROUTING RULE (§12) ──────────────────────────────────────────────────
 * Every event carries `conversationId`. The handler asks the store:
 *   • is this the conversation currently open?  → update that thread
 *   • otherwise                                  → update the inbox row and
 *                                                  the unread badge, and
 *                                                  DO NOT touch the thread
 *
 * That last clause is the whole point: a message arriving in conversation B
 * while the user reads conversation A must not re-render A. Because the
 * thread slice is keyed per conversation, simply not writing it is enough.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { getSocket } from "@/lib/socket";
import { inbox, threads, unread, type ConversationRow } from "@/lib/messages/store";
import type { ChatMessage } from "@/hooks/use-social";
import { refreshUnread } from "@/hooks/use-messages";

/** Mirrors the server's TYPING_TTL_MS so the client expires first (§13). */
const TYPING_TTL_MS = 6000;
/** How long the composer waits before re-announcing "still typing". */
const TYPING_REFRESH_MS = 2500;
/** Idle time after the last keystroke before "typing" is withdrawn. */
const TYPING_IDLE_MS = 1800;

interface WireMessage {
  _id: string;
  conversationId: string;
  senderId: string;
  content: string;
  image?: string;
  attachment?: { url: string; name: string; size: number; mime: string };
  replyTo?: string | null;
  clientMessageId?: string | null;
  createdAt: string;
  deletedAt?: string | null;
}

interface MessageEvent {
  conversationId: string;
  message: WireMessage;
  self?: boolean;
  preview?: { text: string; at: string; senderId: string };
  recipientArchived?: boolean;
  senderArchived?: boolean;
}

/** Connection state for the "Reconnecting…" banner (§28). */
export type DmConnection = "connecting" | "online" | "offline";

/**
 * Cross-component bus for the active conversation id.
 *
 * The socket module is a singleton, but which conversation is "open" is
 * per-page state. Publishing it here means the single socket handler can
 * route without the hook needing to re-subscribe on every navigation.
 */
let activeConversationId: string | null = null;
const activeSubs = new Set<(id: string | null) => void>();

export function setActiveConversation(id: string | null) {
  if (activeConversationId === id) return;
  activeConversationId = id;
  activeSubs.forEach((fn) => fn(id));
}

export function getActiveConversation(): string | null {
  return activeConversationId;
}

let attached = false;
const listenerCount = { n: 0 };

/**
 * Attach once per app, not once per component. Multiple components want the
 * same events (the inbox, the badge, the open thread); attaching per
 * component would register N handlers for the same event and run the routing
 * logic N times per message.
 */
function attachSocketHandlers() {
  if (attached) return;
  attached = true;
  const socket = getSocket();

  socket.on("dm:message", (payload: MessageEvent) => {
    const { conversationId } = payload;
    if (!conversationId) return;
    const msg = payload.message;
    if (!msg) return;

    /* A message for the OPEN conversation: reconcile into that thread only.
     * `self` events are the sender's own other devices — they reconcile the
     * same way, so a send from a laptop appears on a phone. */
    const open = activeConversationId;
    const serverMessage: ChatMessage = {
      _id: msg._id,
      sender: { _id: msg.senderId },
      content: msg.content,
      image: msg.image,
      attachment: msg.attachment,
      replyTo: msg.replyTo ?? null,
      createdAt: msg.createdAt,
      deletedAt: msg.deletedAt ?? null,
    };

    const holder = { ...serverMessage } as ChatMessage & { clientMessageId?: string };
    if (msg.clientMessageId) holder.clientMessageId = msg.clientMessageId;

    if (open && conversationId === open) {
      threads.append(conversationId, holder);
      // Reading it right now ⇒ it is already read. No write until the
      // reader's own batch fires, which the page triggers (§14).
      threads.update(conversationId, { synced: true });
    } else {
      // Another conversation: bump its row + the badge, leave the open
      // thread completely untouched.
      const archivedForMe = payload.recipientArchived ?? false;
      inbox.patch(conversationId, {
        lastMessage: {
          text: payload.preview?.text ?? msg.content ?? "",
          at: payload.preview?.at ?? msg.createdAt,
          mine: Boolean(payload.self),
        },
        updatedAt: payload.preview?.at ?? msg.createdAt,
        unreadCount: payload.self
          ? undefined
          : (inbox.get(archivedForMe).find((r) => r._id === conversationId)?.unreadCount ?? 0) + 1,
      });
      if (!payload.self) unread.bump(archivedForMe, 1);
    }
  });

  socket.on("dm:typing", (payload: { conversationId: string; userId: string; typing: boolean }) => {
    if (!payload?.conversationId) return;
    // Typing only ever matters for the thread on screen. Writing another
    // key would wake a component that cannot display it.
    if (activeConversationId !== payload.conversationId) return;
    threads.typing(payload.conversationId, payload.typing ? Date.now() + TYPING_TTL_MS : 0);
  });

  socket.on("dm:read", (payload: { conversationId: string; readerId: string; at: string }) => {
    if (!payload?.conversationId) return;
    const id = payload.conversationId;
    // Blue ticks apply to messages I sent. Applied in place so only this
    // thread re-renders — and only if it is mounted.
    const state = threads.get(id);
    if (!state.messages.length) return;
    let changed = false;
    const next = state.messages.map((m) => {
      if (m.sender?._id === payload.readerId && m.readAt !== payload.at) {
        changed = true;
        return { ...m, readAt: payload.at };
      }
      return m;
    });
    if (changed) threads.update(id, { messages: next });
  });

  socket.on("dm:deleted", (payload: { conversationId: string; messageId: string }) => {
    if (!payload?.conversationId) return;
    threads.patchMessage(payload.conversationId, payload.messageId, {
      deletedAt: new Date().toISOString(),
      content: "",
      image: "",
    });
  });
}

/* ── Hook ───────────────────────────────────────────────────────────────── */

/**
 * Subscribe the current page to DM events and expose the connection state.
 * Safe to call from several components — the handlers attach once.
 */
export function useDmSocket(): { connection: DmConnection } {
  const [connection, setConnection] = useState<DmConnection>("connecting");
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    listenerCount.n += 1;
    attachSocketHandlers();
    const socket = getSocket();

    const onConnect = () => mounted.current && setConnection("online");
    const onDisconnect = () => mounted.current && setConnection("offline");
    const onReconnectAttempt = () => mounted.current && setConnection("connecting");

    setConnection(socket.connected ? "online" : "connecting");
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.io.on("reconnect_attempt", onReconnectAttempt);

    /* Reconnecting loses nothing: the user room is joined server-side from
     * the authenticated socket, so a fresh connection is already subscribed.
     * We DO resync the badge, because events missed while offline are not
     * replayed — a count is cheap to re-read and is the only thing that can
     * be wrong after a gap (§28: never blank the conversation). */
    const onReconnected = () => {
      if (!mounted.current) return;
      setConnection("online");
      void refreshUnread();
      const open = activeConversationId;
      if (open) {
        const state = threads.get(open);
        if (state.synced) {
          // Catch up on anything sent while the socket was down, using the
          // `after=` cursor so only the gap is fetched.
          const newest = state.messages[state.messages.length - 1];
          if (newest && !newest.pending && !newest._id.startsWith("tmp:")) {
            void import("@/utils/api").then(({ api }) =>
              api
                .get(`/messages/conversations/${open}?after=${newest._id}`)
                .then((r) => {
                  const missed: ChatMessage[] = r.data?.messages || [];
                  missed.forEach((m) => threads.append(open, m));
                })
                .catch(() => {})
            );
          }
        }
      }
    };
    socket.on("connect", onReconnected);

    return () => {
      mounted.current = false;
      listenerCount.n -= 1;
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.io.off("reconnect_attempt", onReconnectAttempt);
      socket.off("connect", onReconnected);
      // The singleton socket stays connected on purpose: the header badge
      // and the inbox must keep receiving while the user is on another page.
      // Disconnecting on unmount is what would make the badge go stale.
    };
  }, []);

  return { connection };
}

/* ── Typing emitter (§13) ───────────────────────────────────────────────── */

/**
 * Debounced typing emitter.
 *
 * Emits `typing:true` at most once per TYPING_REFRESH_MS, refreshes it while
 * the user keeps typing, and emits `typing:false` TYPING_IDLE_MS after the
 * last keystroke — so a burst of typing produces a handful of events rather
 * than one per character, and there is no database write at any point.
 */
export function useTypingEmitter(conversationId: string | null) {
  const stateRef = useRef({ lastSent: 0, idleTimer: 0 as unknown as ReturnType<typeof setTimeout>, active: false });

  const stop = useCallback(() => {
    const s = stateRef.current;
    if (s.idleTimer) clearTimeout(s.idleTimer);
    if (s.active && conversationId) {
      getSocket().emit("dm:typing", { conversationId, typing: false });
      s.active = false;
    }
    s.lastSent = 0;
  }, [conversationId]);

  const onInput = useCallback(() => {
    if (!conversationId) return;
    const s = stateRef.current;
    const now = Date.now();

    if (!s.active || now - s.lastSent > TYPING_REFRESH_MS) {
      getSocket().emit("dm:typing", { conversationId, typing: true });
      s.active = true;
      s.lastSent = now;
    }

    if (s.idleTimer) clearTimeout(s.idleTimer);
    s.idleTimer = setTimeout(() => {
      getSocket().emit("dm:typing", { conversationId, typing: false });
      stateRef.current.active = false;
      stateRef.current.lastSent = 0;
    }, TYPING_IDLE_MS);
  }, [conversationId]);

  // Leaving the thread must withdraw the indicator immediately — otherwise
  // the peer sees "typing…" for someone who has navigated away.
  useEffect(() => stop, [stop]);

  return { onInput, stop };
}

/** Announce that a set of messages was read, without an HTTP round trip. */
export function emitRead(conversationId: string) {
  const socket = getSocket();
  if (!socket.connected) return;
  socket.emit("dm:read", { conversationId });
}

/** Seed the inbox from an initial REST read (used by the page). */
export function seedInbox(archived: boolean, rows: ConversationRow[]) {
  inbox.merge(archived, rows, false);
}
