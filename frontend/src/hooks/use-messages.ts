"use client";

/**
 * Messages hooks (Part 10 §7, §10, §11, §12, §22, §23)
 * ───────────────────────────────────────────────────
 * The only way components touch the messages store. Every hook subscribes to
 * ONE slice, so its component re-renders only when that slice changes — the
 * contract described at the top of lib/messages/store.ts.
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { api } from "@/utils/api";
import { useSessionUser } from "@/components/shell/use-session-user";
import type { ChatMessage } from "@/hooks/use-social";
import {
  cacheInbox,
  cacheThread,
  readCachedInbox,
  readCachedThread,
} from "@/lib/messages/cache";
import {
  inbox,
  presence as presenceSlice,
  search as searchSlice,
  subscribeSlice,
  threads,
  unread,
  type ConversationRow,
  type Presence,
  type ThreadState,
  type UnreadState,
} from "@/lib/messages/store";

const PAGE = 30;

function useSlice<T>(key: string, read: () => T): T {
  return useSyncExternalStore(
    useCallback((fn) => subscribeSlice(key, fn), [key]),
    read,
    read // server snapshot — SSR renders the empty slice, hydration reconciles
  );
}

/* ── Presence (Part 11 §4) ──────────────────────────────────────────────── */

/**
 * Presence for one user, from its own slice.
 *
 * Deliberately NOT read off the conversation row: rows are replaced when a
 * message arrives, and reading presence from them would re-render the whole
 * list on every tick of a peer's online state. This subscribes to exactly
 * one user's presence, so only the tiny component showing it re-renders.
 */
export function usePresence(userId?: string | null): Presence | null {
  const key = userId ? presenceSlice.key(userId) : "presence:none";
  return useSlice<Presence | null>(key, () => (userId ? presenceSlice.get(userId) : null));
}

/**
 * "Active now" / "Last seen 5m ago" / "Offline".
 *
 * Relative and coarse on purpose: an exact timestamp is a privacy leak the
 * user did not agree to, and a minute-level label is what every chat app
 * shows. Returns null when nothing is known yet, so the caller renders
 * nothing rather than a wrong claim.
 */
export function presenceLabel(p: Presence | null | undefined, now = Date.now()): string | null {
  if (!p) return null;
  if (p.online) return "Active now";
  if (!p.lastSeenAt) return null;
  const ms = now - new Date(p.lastSeenAt).getTime();
  if (Number.isNaN(ms)) return null;
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "Last seen just now";
  if (mins < 60) return `Last seen ${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `Last seen ${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "Last seen yesterday";
  if (days < 7) return `Last seen ${days}d ago`;
  return `Last seen ${new Date(p.lastSeenAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}`;
}

/* ── Unread badge ───────────────────────────────────────────────────────── */

export function useUnread(): UnreadState {
  return useSlice("unread", unread.get);
}

/** Refresh the badge counts from the server (cheap: two indexed counts). */
export async function refreshUnread(): Promise<void> {
  try {
    const r = await api.get("/messages/unread-count");
    if (r.data?.success) {
      unread.set({
        inbox: r.data.unreadCount || 0,
        archived: r.data.archivedUnreadCount || 0,
      });
    }
  } catch {
    /* the badge is not worth an error surface */
  }
}

/* ── Conversation list ──────────────────────────────────────────────────── */

export interface UseInboxResult {
  rows: ConversationRow[];
  loading: boolean;
  error: boolean;
  hasMore: boolean;
  loadMore: () => void;
  refresh: (opts?: { silent?: boolean }) => Promise<void>;
}

export function useInbox(view: "all" | "unread" | "archived"): UseInboxResult {
  const archived = view === "archived";
  const key = inbox.key(archived);
  const rows = useSlice(key, () => inbox.get(archived));

  const [loading, setLoading] = useState(rows.length === 0);
  const [error, setError] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const cursorRef = useRef<string | null>(null);
  const loadingMoreRef = useRef(false);

  const fetchPage = useCallback(
    async (cursor: string | null, append: boolean) => {
      const qs = new URLSearchParams({ limit: "20" });
      if (view !== "all") qs.set("view", view);
      if (cursor) qs.set("cursor", cursor);
      const r = await api.get(`/messages/conversations?${qs.toString()}`);
      const page: ConversationRow[] = r.data?.conversations || [];
      cursorRef.current = r.data?.nextCursor || null;
      setHasMore(Boolean(r.data?.hasMore));
      inbox.merge(archived, page, append);
      // Paint "Active now" on the first frame, not after the first event.
      presenceSlice.seed(page);
      if (!append) {
        setError(false);
        // Warm cache for the next cold start (§22).
        void cacheInbox(archived ? "archived" : "inbox", page);
      }
      return page;
    },
    [archived, view]
  );

  const refresh = useCallback(
    async (opts: { silent?: boolean } = {}) => {
      if (!opts.silent) setLoading(true);
      try {
        await fetchPage(null, false);
      } catch {
        // A silent background refresh must never blank a list the user is
        // reading; only a first load with nothing to show admits failure.
        if (!opts.silent && inbox.get(archived).length === 0) setError(true);
      } finally {
        setLoading(false);
      }
    },
    [fetchPage, archived]
  );

  const loadMore = useCallback(() => {
    if (!cursorRef.current || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    fetchPage(cursorRef.current, true)
      .catch(() => {})
      .finally(() => {
        loadingMoreRef.current = false;
      });
  }, [fetchPage]);

  /* Cold start: paint the cached list immediately, then reconcile (§22).
   * The cached rows are metadata from this device's own last session, so
   * showing them is a warm start, not stale data the user must trust — the
   * fetch that follows replaces them. */
  useEffect(() => {
    let alive = true;

    /* §"messages load slowly" — THE NETWORK REQUEST STARTS FIRST.
     *
     * This used to `await readCachedInbox()` and only then call refresh(),
     * which put an IndexedDB open (a separate origin-scoped database that can
     * take tens of ms cold, and longer on a low-end phone) IN FRONT OF the
     * request that actually has the data. Two waits where one was needed.
     *
     * Now they run concurrently and whichever lands first paints. The cached
     * rows are only merged if the live response has not already replaced
     * them, so a slow disk can never overwrite fresh data with stale. */
    const live = refresh({ silent: inbox.get(archived).length > 0 });
    void live.catch(() => {});

    (async () => {
      const cached = await readCachedInbox(archived ? "archived" : "inbox");
      if (!alive) return;
      // Only seed from disk when the network has not already answered, and
      // only when the store is still empty (a re-mount keeps its rows).
      if (cached?.rows?.length && inbox.get(archived).length === 0) {
        inbox.merge(archived, cached.rows as ConversationRow[], false);
        setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [archived, view]);

  return { rows, loading, error, hasMore, loadMore, refresh };
}

/* ── One thread ─────────────────────────────────────────────────────────── */

export interface UseThreadResult extends ThreadState {
  sendMessage: (text: string, replyTo?: string | null) => Promise<void>;
  retry: (message: ChatMessage) => Promise<void>;
  loadOlder: () => Promise<void>;
  /** True while anyone in this thread is typing. Expires on its own (§13). */
  isPeerTyping: boolean;
  /** Ids of the peers typing right now (Part 11 §3 — teams can have several). */
  typingIds: string[];
  /** Display names for those peers, when the roster is known. */
  typingNames: string[];
}

/**
 * Resolve a conversation id for the thread.
 *
 * `withUser` covers "message this person" from a profile: we need a
 * conversation id before a thread can exist. Resolution happens once, and a
 * failure is surfaced rather than swallowed into a permanent spinner.
 */
export function useResolveConversation(withUser: string | null | undefined, currentUserId?: string) {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(withUser));

  useEffect(() => {
    if (!withUser || withUser === currentUserId) {
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    api
      .post("/messages/conversations", { userId: withUser })
      .then((r) => {
        if (!alive) return;
        if (r.data?.conversationId) {
          setConversationId(r.data.conversationId);
          if (r.data.other) {
            // Seed the row so the header has a name before the thread lands.
            inbox.upsert(false, {
              _id: r.data.conversationId,
              other: r.data.other,
              lastMessage: null,
              updatedAt: new Date().toISOString(),
              unreadCount: 0,
              archived: false,
            });
          }
        } else setError("Couldn't start that conversation");
      })
      .catch((e) => {
        if (alive) setError(e?.response?.data?.message || "Couldn't start that conversation");
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [withUser, currentUserId]);

  return { conversationId, error, loading };
}

export function useThread(conversationId: string | null): UseThreadResult {
  const key = conversationId ? threads.key(conversationId) : "thread:none";
  const state = useSlice<ThreadState>(key, () =>
    conversationId
      ? threads.get(conversationId)
      : {
          messages: [],
          oldestId: null,
          hasMore: false,
          loading: false,
          fetchingOlder: false,
          other: null,
          muted: false,
          archived: false,
          error: false,
          type: "direct" as const,
          name: null,
          avatar: null,
          members: [],
          myRole: null,
          typing: {},
          synced: false,
        }
  );

  const { user } = useSessionUser();
  const loadingOlderRef = useRef(false);
  /* Which peers are typing right now. A list, not a flag — in a team more
     than one person can be typing at once. */
  const [typingIds, setTypingIds] = useState<string[]>([]);

  /* ── First load: cached paint, then the real page (§22) ── */
  useEffect(() => {
    if (!conversationId) return;
    let alive = true;

    /* The fetch and the disk read race. The thread used to wait on IndexedDB
     * before issuing the request, which is exactly the "opening a chat takes a
     * moment" the report describes. */
    (async () => {
      const live = api
        .get(`/messages/conversations/${conversationId}?limit=${PAGE}`)
        .then((r) => ({ ok: true as const, r, at: Date.now() }))
        .catch((e) => ({ ok: false as const, e, at: Date.now() }));

      /* Paint from disk the moment it is readable — it is only ever a
       * starting point, because the live response below REPLACES it. Anything
       * already in memory wins outright: it is newer than disk by definition,
       * since every write goes to both. */
      const cached = await readCachedThread(conversationId);
      if (!alive) return;
      if (cached?.messages?.length && threads.get(conversationId).messages.length === 0) {
        threads.replace(conversationId, cached.messages as ChatMessage[], {
          oldestId: cached.oldestId,
          hasMore: cached.hasMore,
          loading: false,
        });
      }

      threads.update(conversationId, { loading: threads.get(conversationId).messages.length === 0 });

      try {
        const res = await live;
        if (!alive) return;
        if (!res.ok) throw res.e;
        const r = res.r;
        const msgs: ChatMessage[] = r.data?.messages || [];
        threads.replace(conversationId, msgs, {
          other: r.data?.other ?? null,
          // Part 11 — a team thread has no single "other"; the roster and the
          // name are what the header and the sender labels read instead.
          type: r.data?.type === "team" ? "team" : "direct",
          name: r.data?.team?.name ?? null,
          avatar: r.data?.team?.avatar ?? null,
          members: r.data?.team?.members ?? [],
          myRole: r.data?.team?.myRole ?? null,
          muted: Boolean(r.data?.muted),
          archived: Boolean(r.data?.archived),
          oldestId: r.data?.oldestId ?? (msgs.length ? msgs[0]._id : null),
          hasMore: Boolean(r.data?.hasMore),
          loading: false,
          error: false,
          synced: true,
        });
        // The thread response carries the peer's presence — seed it so the
        // header is correct before any `dm:presence` event arrives.
        if (r.data?.presence && r.data?.other?._id) {
          presenceSlice.set(String(r.data.other._id), r.data.presence);
        }
        void cacheThread({
          id: conversationId,
          messages: msgs,
          oldestId: r.data?.oldestId ?? null,
          hasMore: Boolean(r.data?.hasMore),
        });
        // Opening the thread is what clears the unread (§14 — one batch).
        void refreshUnread();
      } catch {
        if (!alive) return;
        const hasCache = threads.get(conversationId).messages.length > 0;
        threads.update(conversationId, { loading: false, error: !hasCache });
      }
    })();

    return () => {
      alive = false;
    };
  }, [conversationId]);

  /* ── Older pages, on demand only (§5) ── */
  const loadOlder = useCallback(async () => {
    if (!conversationId) return;
    const cur = threads.get(conversationId);
    if (!cur.hasMore || cur.fetchingOlder || !cur.oldestId) return;
    if (loadingOlderRef.current) return;
    loadingOlderRef.current = true;
    threads.update(conversationId, { fetchingOlder: true });
    try {
      const r = await api.get(
        `/messages/conversations/${conversationId}?limit=${PAGE}&before=${cur.oldestId}`
      );
      const older: ChatMessage[] = r.data?.messages || [];
      threads.prepend(conversationId, older);
      threads.update(conversationId, {
        oldestId: r.data?.oldestId ?? cur.oldestId,
        hasMore: Boolean(r.data?.hasMore),
        fetchingOlder: false,
      });
    } catch {
      threads.update(conversationId, { fetchingOlder: false });
    } finally {
      loadingOlderRef.current = false;
    }
  }, [conversationId]);

  /**
   * Optimistic send (§10, §11).
   *
   * A temporary row appears on this frame with `pending: true` and a
   * clientMessageId. The server echoes that id back, which is how the
   * response and the socket echo both reconcile onto the SAME row instead of
   * adding a second copy.
   */
  const sendMessage = useCallback(
    async (text: string, replyTo?: string | null) => {
      const id = conversationId;
      if (!id || !text.trim()) return;
      const clientMessageId = makeClientId();

      const optimistic: ChatMessage & { clientMessageId: string } = {
        _id: `tmp:${clientMessageId}`,
        sender: user
          ? {
              _id: user._id ?? "",
              firstName: user.firstName ?? "",
              lastName: user.lastName ?? "",
              username: user.username,
              profile: user.profile,
            }
          : null,
        content: text,
        replyTo: replyTo ?? null,
        createdAt: new Date().toISOString(),
        pending: true,
        clientMessageId,
      };

      threads.append(id, optimistic);
      inbox.patch(id, {
        lastMessage: { text: text.slice(0, 200), at: optimistic.createdAt, mine: true },
        updatedAt: optimistic.createdAt,
      });

      try {
        const res = await api.post(`/messages/conversations/${id}`, {
          content: text,
          ...(replyTo ? { replyTo } : {}),
          clientMessageId,
        });
        const saved: ChatMessage = res.data?.message;
        if (!saved) throw new Error("no message");
        // Reconcile by clientMessageId — NOT by removing the temp row and
        // appending, which would reorder the message if anything else
        // arrived in the meantime.
        threads.append(id, { ...saved, clientMessageId } as ChatMessage);
        if (threads.get(id).messages.some((m) => m._id === `tmp:${clientMessageId}`)) {
          threads.removeMessage(id, `tmp:${clientMessageId}`);
        }
      } catch {
        // §10 — mark it failed and offer a retry. Never silently drop it.
        threads.patchMessage(id, `tmp:${clientMessageId}`, { pending: false, failed: true });
      }
    },
    [conversationId, user]
  );

  const retry = useCallback(
    async (message: ChatMessage) => {
      const id = conversationId;
      if (!id) return;
      threads.removeMessage(id, message._id);
      await sendMessage(message.content, (message.replyTo as string) ?? null);
    },
    [conversationId, sendMessage]
  );

  /* The typing signal carries its own expiry (the server also expires it),
     but a dropped event must not leave the indicator on forever — so the
     client rejects stale entries locally once their deadline passes, and
     schedules one re-check for the earliest deadline remaining. */
  useEffect(() => {
    const now = Date.now();
    const live = Object.entries(state.typing).filter(([, until]) => until > now);
    setTypingIds(live.map(([id]) => id));
    if (!live.length) return;
    const soonest = Math.min(...live.map(([, until]) => until)) - now;
    const t = setTimeout(() => {
      const at = Date.now();
      const next = Object.entries(threads.get(conversationId ?? "").typing).filter(([, until]) => until > at);
      setTypingIds(next.map(([id]) => id));
    }, soonest + 50);
    return () => clearTimeout(t);
  }, [state.typing, conversationId]);

  /* Names of whoever is typing, for a team ("Ana is typing" beats "someone
     is typing" once there is more than one possible sender). */
  const typingNames = typingIds
    .map((id) => {
      const m = state.members.find((x) => String(x._id) === String(id));
      if (!m) return null;
      const n = `${m.firstName || ""} ${m.lastName || ""}`.trim();
      return n || (m.username ? `@${m.username}` : null);
    })
    .filter((n): n is string => Boolean(n));

  return {
    ...state,
    sendMessage,
    retry,
    loadOlder,
    isPeerTyping: typingIds.length > 0,
    typingIds,
    typingNames,
  };
}

/** Server-compatible unique id for one send attempt (§11). */
function makeClientId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Warm the inbox before the user asks for it — the single biggest
 * perceived-speed win available on the home screen.
 *
 * The header renders the Messages link on every page, so this runs once after
 * the app becomes interactive. By the time anyone taps the icon the rows are
 * usually already in the store and the inbox paints on the first frame
 * instead of showing a skeleton for a full round trip.
 *
 * Deliberately idle-scheduled and fire-and-forget: it must never compete with
 * the work the current page is doing, and a failure is silent because the real
 * load will surface any problem properly.
 */
export function prefetchInbox(): void {
  if (typeof window === "undefined") return;
  const run = () => {
    // Already have rows — they are on screen, no point re-fetching.
    if (inbox.get(false).length) return;
    api
      .get("/messages/conversations?limit=20")
      .then((r) => {
        const page: ConversationRow[] = r.data?.conversations || [];
        if (!page.length) return;
        inbox.merge(false, page, false);
        presenceSlice.seed(page);
        void cacheInbox("inbox", page);
      })
      .catch(() => {});
  };
  // requestIdleCallback where available so a slow device is not made slower.
  const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void })
    .requestIdleCallback;
  if (ric) ric(run, { timeout: 2000 });
  else setTimeout(run, 400);
}

/* ── Server-side search (§25) ───────────────────────────────────────────── */

export function useConversationSearch(query: string, type: "conversations" | "messages") {
  const q = query.trim();
  const key = searchSlice.key(q, type);
  const results = useSlice<unknown>(key, () => searchSlice.get(q, type)) as never[];
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    /* The debounce lives here, at the single place the request is issued,
     * so no caller can accidentally fire per keystroke (§25). 300ms sits in
     * the 250–400ms band the spec asks for: long enough to swallow typing
     * bursts, short enough to feel immediate once the user pauses. */
    if (!q) return;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await api.get(
          `/messages/search?q=${encodeURIComponent(q)}&type=${type}&limit=20`
        );
        searchSlice.set(q, type, r.data?.results || []);
      } catch {
        searchSlice.set(q, type, []);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [q, type]);

  return { results, loading, active: q.length > 0 };
}
