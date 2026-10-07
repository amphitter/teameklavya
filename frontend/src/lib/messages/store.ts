"use client";

/**
 * Messages store (Part 10 §7, §12, §23, §34)
 * ───────────────────────────────────────────
 * One external store, subscribed to through `useSyncExternalStore` with
 * per-slice selectors, so an incoming message re-renders the components that
 * display it and nothing else.
 *
 * ── WHY NOT TANSTACK QUERY (which lib/query.ts already mirrors) ─────────
 * `lib/query.ts` is a request cache: it models "fetch a URL, hold the
 * result". A chat is not that. It needs appends that do not refetch,
 * optimistic rows that reconcile on an id the server has not seen yet,
 * prepends that must not disturb read state, and event-driven updates that
 * arrive without a request. Modelling those as query invalidations is
 * exactly the "blindly invalidate and refetch the entire message system"
 * that §23 forbids, and it is what made the previous implementation feel
 * slow. `lib/query.ts` stays the cache for everything else and is NOT
 * forked — this store is used only for messages, and it reuses the shared
 * `api` client and retry policy rather than introducing its own transport.
 *
 * ── SURGICAL UPDATE CONTRACT ────────────────────────────────────────────
 * Append one message  → `thread:{id}` slice is replaced; nothing else.
 * Incoming for another conversation → that conversation's ROW slice and the
 *   unread slice are replaced; the open thread's slice is untouched, so the
 *   open thread does not re-render at all (§12).
 * Typing → never touches the store; it lives in the composer/indicator.
 */

import type { ChatMessage } from "@/hooks/use-social";

/* ── Types ──────────────────────────────────────────────────────────────── */

/**
 * Presence (Part 11 §4) — active now, or last seen at a moment.
 *
 * `online` is live socket state on the server; `lastSeenAt` is the durable
 * half and survives a restart. Both arrive from the API on load and are then
 * kept current by `dm:presence` events.
 */
export interface Presence {
  online: boolean;
  lastSeenAt: string | null;
}

/** One member of a team, as returned by the roster endpoints. */
export interface TeamMember {
  _id: string;
  firstName?: string;
  lastName?: string;
  username?: string;
  profile?: { avatar?: string };
  role?: "owner" | "admin" | "member";
}

export interface ConversationRow {
  _id: string;
  /* `direct` or `team`. Optional because rows cached on this device before
     teams existed have neither field, and an old cache must not break the
     list. A missing type is treated as a direct chat, which is what it was. */
  type?: "direct" | "team";
  /* Shape mirrors `SessionUser` so the row can be handed straight to
     `<UserAvatar>` without a cast. The API may omit `profile` entirely for a
     user who has never set one, which is what the optional marker says. */
  other: {
    _id: string;
    firstName?: string;
    lastName?: string;
    username?: string;
    profile?: { avatar?: string; institution?: string; course?: string; year?: string };
  } | null;
  /* Team identity. Null/absent for direct rows. */
  name?: string | null;
  avatar?: string | null;
  memberCount?: number | null;
  /** Direct rows only — a team has no single presence (§4). */
  presence?: Presence | null;
  lastMessage: { text: string; at: string; mine: boolean; senderName?: string | null } | null;
  updatedAt: string;
  unreadCount: number;
  muted?: boolean;
  archived?: boolean;
}

export interface ThreadState {
  messages: ChatMessage[];
  /** For `before=` — the oldest message currently held. */
  oldestId: string | null;
  /** Are there older messages on the server we have not fetched? */
  hasMore: boolean;
  /** First paint still waiting on the network (cached content may show). */
  loading: boolean;
  /** An older page is in flight (drives the top spinner, never a blank). */
  fetchingOlder: boolean;
  other: ConversationRow["other"];
  muted: boolean;
  archived: boolean;
  /** Set when the very first load failed with nothing cached to show. */
  error: boolean;
  /* ── Part 11 — team identity on the open thread ── */
  /** "direct" for a pair, "team" for a named roster. */
  type: "direct" | "team";
  /** Team name; null for a direct chat. */
  name: string | null;
  avatar: string | null;
  /** The roster, for sender labels inside a team. Empty for direct chats. */
  members: TeamMember[];
  myRole: "owner" | "admin" | "member" | null;
  /**
   * userId → epoch ms until which that user counts as typing.
   *
   * A MAP, not a flag: in a team several people type at once, and one peer
   * withdrawing their indicator must not cancel another's (§3).
   */
  typing: Record<string, number>;
  /** True once the server has confirmed the latest page for this session. */
  synced: boolean;
}

export interface UnreadState {
  inbox: number;
  archived: number;
}

/* ── Slice keys ─────────────────────────────────────────────────────────── */

const K_INBOX = "inbox";
const K_ARCHIVED = "archived";
const K_UNREAD = "unread";
const threadKey = (id: string) => `thread:${id}`;
/* One slice per USER, not one slice for all presence: a peer going online must
 * re-render that peer's row and nothing else (§7 — no whole-list churn). */
const presenceKey = (id: string) => `presence:${id}`;
const searchKey = (q: string, type: string) => `search:${type}:${q}`;

/* ── Store core ─────────────────────────────────────────────────────────── */

type Listener = () => void;

/**
 * One immutable object per slice. A subscriber's `getSnapshot` returns the
 * object by reference, so React skips the re-render unless THAT slice was
 * replaced. This is the whole reason the page does not re-render on every
 * incoming message.
 */
const slices = new Map<string, unknown>();
const listeners = new Map<string, Set<Listener>>();

/** Fallback for a slice that has never been written (stable reference). */
const EMPTY_THREAD: ThreadState = {
  messages: [],
  oldestId: null,
  hasMore: false,
  loading: true,
  fetchingOlder: false,
  other: null,
  muted: false,
  archived: false,
  error: false,
  type: "direct",
  name: null,
  avatar: null,
  members: [],
  myRole: null,
  typing: {},
  synced: false,
};
const EMPTY_ROWS: ConversationRow[] = [];
const EMPTY_UNREAD: UnreadState = { inbox: 0, archived: 0 };
const EMPTY_SEARCH: unknown[] = [];

function getSlice<T>(key: string, fallback: T): T {
  const v = slices.get(key);
  return v === undefined ? fallback : (v as T);
}

function setSlice<T>(key: string, value: T) {
  slices.set(key, value);
  listeners.get(key)?.forEach((fn) => fn());
}

export function subscribeSlice(key: string, fn: Listener): () => void {
  if (!listeners.has(key)) listeners.set(key, new Set());
  listeners.get(key)!.add(fn);
  return () => {
    const s = listeners.get(key);
    if (!s) return;
    s.delete(fn);
    if (!s.size) listeners.delete(key);
  };
}

/* ── Inbox ──────────────────────────────────────────────────────────────── */

export const inbox = {
  get: (archived: boolean) => getSlice<ConversationRow[]>(archived ? K_ARCHIVED : K_INBOX, EMPTY_ROWS),
  key: (archived: boolean) => (archived ? K_ARCHIVED : K_INBOX),
  set(archived: boolean, rows: ConversationRow[]) {
    setSlice(archived ? K_ARCHIVED : K_INBOX, rows);
  },
  /** Patch one row in place — used by a realtime event or a local send. */
  patch(conversationId: string, patch: Partial<ConversationRow>) {
    for (const key of [K_INBOX, K_ARCHIVED]) {
      const rows = slices.get(key) as ConversationRow[] | undefined;
      if (!rows?.some((r) => r._id === conversationId)) continue;
      setSlice(
        key,
        rows.map((r) => (r._id === conversationId ? { ...r, ...patch } : r))
      );
    }
  },
  /** Move a conversation between inbox and archive (or add it). */
  move(conversationId: string, toArchived: boolean, base?: ConversationRow) {
    const fromKey = toArchived ? K_INBOX : K_ARCHIVED;
    const toKey = toArchived ? K_ARCHIVED : K_INBOX;
    const from = (slices.get(fromKey) as ConversationRow[] | undefined) ?? [];
    const found = base ?? from.find((r) => r._id === conversationId);
    if (!found) return;
    setSlice(fromKey, from.filter((r) => r._id !== conversationId));
    const to = (slices.get(toKey) as ConversationRow[] | undefined) ?? [];
    if (!to.some((r) => r._id === conversationId)) {
      setSlice(toKey, [{ ...found, archived: toArchived }, ...to]);
    }
  },
  /** Drop a row we are no longer part of (leaving a team). */
  remove(conversationId: string) {
    for (const key of [K_INBOX, K_ARCHIVED]) {
      const rows = slices.get(key) as ConversationRow[] | undefined;
      if (!rows?.some((r) => r._id === conversationId)) continue;
      setSlice(
        key,
        rows.filter((r) => r._id !== conversationId)
      );
    }
  },

  /** Prepend or refresh a row at the top of the inbox, newest first. */
  upsert(archived: boolean, row: ConversationRow) {
    const key = archived ? K_ARCHIVED : K_INBOX;
    const rows = (slices.get(key) as ConversationRow[] | undefined) ?? [];
    const at = rows.findIndex((r) => r._id === row._id);
    if (at === -1) setSlice(key, [row, ...rows]);
    else {
      const next = rows.slice();
      next[at] = { ...next[at], ...row };
      setSlice(key, next);
    }
  },
  merge(archived: boolean, rows: ConversationRow[], append: boolean) {
    const key = archived ? K_ARCHIVED : K_INBOX;
    const existing = (slices.get(key) as ConversationRow[] | undefined) ?? [];
    if (!append) return setSlice(key, rows);
    const seen = new Set(existing.map((r) => r._id));
    setSlice(key, [...existing, ...rows.filter((r) => !seen.has(r._id))]);
  },
  reset() {
    slices.delete(K_INBOX);
    listeners.get(K_INBOX)?.forEach((f) => f());
    slices.delete(K_ARCHIVED);
    listeners.get(K_ARCHIVED)?.forEach((f) => f());
  },
};

/* ── Unread ─────────────────────────────────────────────────────────────── */

export const unread = {
  get: () => getSlice<UnreadState>(K_UNREAD, EMPTY_UNREAD),
  set(next: UnreadState) {
    setSlice(K_UNREAD, next);
  },
  bump(archived: boolean, by: number) {
    const cur = getSlice<UnreadState>(K_UNREAD, EMPTY_UNREAD);
    setSlice(K_UNREAD, {
      inbox: Math.max(0, cur.inbox + (archived ? 0 : by)),
      archived: Math.max(0, cur.archived + (archived ? by : 0)),
    });
  },
  clear(archived: boolean) {
    const cur = getSlice<UnreadState>(K_UNREAD, EMPTY_UNREAD);
    setSlice(K_UNREAD, { inbox: archived ? cur.inbox : 0, archived: archived ? 0 : cur.archived });
  },
};

/* ── Threads ────────────────────────────────────────────────────────────── */

export const threads = {
  key: threadKey,
  get: (id: string) => getSlice<ThreadState>(threadKey(id), EMPTY_THREAD),

  set(id: string, next: ThreadState) {
    setSlice(threadKey(id), next);
  },

  update(id: string, patch: Partial<ThreadState> | ((t: ThreadState) => Partial<ThreadState>)) {
    const cur = getSlice<ThreadState>(threadKey(id), EMPTY_THREAD);
    const delta = typeof patch === "function" ? patch(cur) : patch;
    setSlice(threadKey(id), { ...cur, ...delta });
  },

  /**
   * Append one message, ignoring a duplicate (§11).
   *
   * Deduped on server id AND clientMessageId: the same message can arrive
   * from the REST response, the socket echo, or a reconnect replay, and all
   * three must collapse to one row.
   */
  append(id: string, message: ChatMessage): boolean {
    const cur = getSlice<ThreadState>(threadKey(id), EMPTY_THREAD);
    const serverId = message._id;
    const cmid = (message as ChatMessage & { clientMessageId?: string }).clientMessageId;

    const existing = cur.messages.findIndex(
      (m) =>
        m._id === serverId ||
        (cmid && (m as ChatMessage & { clientMessageId?: string }).clientMessageId === cmid) ||
        (m.pending && cmid && (m as ChatMessage & { clientMessageId?: string }).clientMessageId === cmid)
    );

    if (existing !== -1) {
      // Reconcile in place — this is the optimistic row becoming real.
      const next = cur.messages.slice();
      next[existing] = { ...next[existing], ...message, pending: false, failed: false };
      setSlice(threadKey(id), { ...cur, messages: next });
      return false;
    }

    /* Insert in timestamp order rather than blindly appending.
     *
     * The previous version DROPPED anything older than the newest held row.
     * That is wrong, and wrong in a way that loses real messages: if the peer
     * sends at T and I send at T+0.5, my optimistic row is newest; the peer's
     * socket event for T then arrives and would be discarded, so their
     * message silently never appears. Clock skew and any out-of-order
     * delivery do the same thing.
     *
     * Scanning from the end is O(1) in the overwhelmingly common case (the
     * new message really is newest) and only walks further when it is not. */
    const ts = new Date(message.createdAt).getTime();
    const msgs = cur.messages;
    let at = msgs.length;
    while (at > 0 && new Date(msgs[at - 1].createdAt).getTime() > ts) at--;

    const next = msgs.slice();
    next.splice(at, 0, message);
    setSlice(threadKey(id), { ...cur, messages: next });
    return true;
  },

  /** Insert at the front when paging upward (`before=`). */
  prepend(id: string, older: ChatMessage[]) {
    const cur = getSlice<ThreadState>(threadKey(id), EMPTY_THREAD);
    const seen = new Set(cur.messages.map((m) => m._id));
    const fresh = older.filter((m) => !seen.has(m._id));
    if (!fresh.length) return;
    setSlice(threadKey(id), { ...cur, messages: [...fresh, ...cur.messages] });
  },

  /** Replace the whole list — the initial fetch, or a catch-up refetch. */
  replace(id: string, messages: ChatMessage[], meta: Partial<ThreadState> = {}) {
    const cur = getSlice<ThreadState>(threadKey(id), EMPTY_THREAD);
    /* Pending/failed rows the user can still see must survive a refetch —
     * dropping them here is what made the old implementation lose an
     * in-flight message every time the poll returned. */
    const unsent = cur.messages.filter((m) => m.pending || m.failed);
    const known = new Set(messages.map((m) => m._id));
    const carriers = unsent.filter((m) => {
      const cmid = (m as ChatMessage & { clientMessageId?: string }).clientMessageId;
      if (cmid && messages.some((x) => (x as ChatMessage & { clientMessageId?: string }).clientMessageId === cmid)) return false;
      return !known.has(m._id);
    });
    setSlice(threadKey(id), { ...cur, ...meta, messages: [...messages, ...carriers] });
  },

  patchMessage(id: string, messageId: string, patch: Partial<ChatMessage>) {
    const cur = getSlice<ThreadState>(threadKey(id), EMPTY_THREAD);
    const at = cur.messages.findIndex((m) => m._id === messageId);
    if (at === -1) return;
    const next = cur.messages.slice();
    next[at] = { ...next[at], ...patch };
    setSlice(threadKey(id), { ...cur, messages: next });
  },

  removeMessage(id: string, messageId: string) {
    const cur = getSlice<ThreadState>(threadKey(id), EMPTY_THREAD);
    setSlice(threadKey(id), { ...cur, messages: cur.messages.filter((m) => m._id !== messageId) });
  },

  /**
   * Record that `userId` is (or is no longer) typing in this thread.
   *
   * Keyed per user so a team can show "Ana and Ben are typing" and so one
   * person stopping cannot clear someone else's indicator. `until = 0`
   * removes that user's entry; the map itself is only replaced when the
   * value actually changes, which keeps the slice reference stable and
   * stops a repeated `typing:false` from re-rendering the thread.
   */
  typing(id: string, userId: string, until: number) {
    const cur = getSlice<ThreadState>(threadKey(id), EMPTY_THREAD);
    const had = cur.typing[userId] ?? 0;
    if (until === 0 && !had) return;
    const next = { ...cur.typing };
    if (until > 0) next[userId] = until;
    else delete next[userId];
    setSlice(threadKey(id), { ...cur, typing: next });
  },

  /** Do we already hold this message? Used to skip a redundant append. */
  has(id: string, messageId: string): boolean {
    return getSlice<ThreadState>(threadKey(id), EMPTY_THREAD).messages.some((m) => m._id === messageId);
  },

  reset(id: string) {
    slices.delete(threadKey(id));
    listeners.get(threadKey(id))?.forEach((f) => f());
  },
};

/* ── Presence (Part 11 §4) ──────────────────────────────────────────────── */

export const presence = {
  key: presenceKey,
  get: (userId: string) => getSlice<Presence | null>(presenceKey(userId), null),

  set(userId: string, next: Presence | null) {
    const cur = getSlice<Presence | null>(presenceKey(userId), null);
    // Identity check first: an unchanged state must not replace the slice,
    // or every presence event from a chatty peer re-renders their row.
    if (cur && next && cur.online === next.online && cur.lastSeenAt === next.lastSeenAt) return;
    if (!cur && !next) return;
    setSlice(presenceKey(userId), next);
  },

  /**
   * Seed from a REST payload. Called with every conversation list and thread
   * load so a cold start paints "Active now" on the first frame instead of
   * waiting for the first presence event.
   */
  seed(rows: ConversationRow[]) {
    for (const row of rows) {
      if (row.type === "team") continue;
      const id = row.other?._id;
      if (id && row.presence) presence.set(id, row.presence);
    }
  },

  reset() {
    for (const key of [...listeners.keys()]) {
      if (!key.startsWith("presence:")) continue;
      slices.delete(key);
      listeners.get(key)?.forEach((fn) => fn());
    }
  },
};

/* ── Search ─────────────────────────────────────────────────────────────── */

export const search = {
  key: searchKey,
  get: <T>(q: string, type: string) => getSlice<T[]>(searchKey(q, type), EMPTY_SEARCH as T[]),
  set<T>(q: string, type: string, results: T[]) {
    setSlice(searchKey(q, type), results);
  },
};

/* ── Whole-store reset (logout) ─────────────────────────────────────────── */

export function resetMessagesStore() {
  const keys = [...listeners.keys()];
  slices.clear();
  keys.forEach((k) => listeners.get(k)?.forEach((fn) => fn()));
}
