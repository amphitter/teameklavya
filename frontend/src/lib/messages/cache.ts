"use client";

/**
 * Messages cache (Part 10 §23, §22)
 * ──────────────────────────────────
 * "Opening a conversation should feel instant … render cached conversation
 * if available, then fetch."
 *
 * A warm in-memory cache alone cannot deliver that: the tab was just opened,
 * so memory is empty, and the user stares at a skeleton while the API
 * answers. IndexedDB survives the tab — so a thread the user has opened
 * before paints its last known state on the first frame.
 *
 * ── WHY HAND-ROLLED INDEXEDDB ───────────────────────────────────────────
 * For two object stores and a handful of reads this is ~120 lines. Pulling
 * in an idb wrapper (or a full offline library) to save them would add a
 * dependency, a bundle and an API to learn, for no capability we lack here.
 * §"Do NOT blindly add libraries".
 *
 * ── WHAT IS CACHED, AND WHAT IS NOT ─────────────────────────────────────
 * Cached:   the last N messages per thread, and the inbox rows.
 * Not cached: anything a stale copy could make WRONG — read receipts are
 *            re-fetched, and a cached message is only ever a starting point
 *            that the first fetch reconciles against.
 *
 * IndexedDB is unavailable in private-mode Safari and in SSR. Every path
 * degrades to "no cache" rather than throwing.
 */

const DB_NAME = "eventhub-messages";
const DB_VERSION = 1;
const STORE_THREADS = "threads";
const STORE_META = "meta";

/** Cap per thread, so the cache cannot grow without bound (§23 controlled). */
const MAX_CACHED_MESSAGES = 60;
/** Cap on cached threads — the ones most recently opened. */
const MAX_CACHED_THREADS = 12;

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve) => {
    let settled = false;
    const done = (v: IDBDatabase | null) => {
      if (!settled) {
        settled = true;
        resolve(v);
      }
    };
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_THREADS)) {
          db.createObjectStore(STORE_THREADS, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(STORE_META)) {
          db.createObjectStore(STORE_META, { keyPath: "key" });
        }
      };
      req.onsuccess = () => done(req.result);
      req.onerror = () => done(null);
      // A blocked upgrade (another tab on an older version) must not hang
      // the app forever — resolve without a cache.
      setTimeout(() => done(null), 2000);
    } catch {
      done(null);
    }
  });
  return dbPromise;
}

function tx<T>(
  store: string,
  mode: IDBTransactionMode,
  run: (s: IDBObjectStore) => IDBRequest<T>
): Promise<T | null> {
  return openDb().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) return resolve(null);
        try {
          const t = db.transaction(store, mode);
          const req = run(t.objectStore(store));
          req.onsuccess = () => resolve(req.result as T);
          req.onerror = () => resolve(null);
          t.onabort = () => resolve(null);
        } catch {
          resolve(null);
        }
      })
  );
}

export interface CachedThread {
  id: string;
  /** Newest messages only — enough to paint a screenful instantly. */
  messages: unknown[];
  oldestId: string | null;
  hasMore: boolean;
  at: number;
}

export async function cacheThread(thread: {
  id: string;
  messages: unknown[];
  oldestId: string | null;
  hasMore: boolean;
}): Promise<void> {
  const payload: CachedThread = {
    id: thread.id,
    messages: thread.messages.slice(-MAX_CACHED_MESSAGES),
    oldestId: thread.oldestId,
    hasMore: thread.hasMore,
    at: Date.now(),
  };
  await tx(STORE_THREADS, "readwrite", (s) => s.put(payload));
  void evictOldThreads();
}

export async function readCachedThread(id: string): Promise<CachedThread | null> {
  const row = await tx<CachedThread | undefined>(STORE_THREADS, "readonly", (s) => s.get(id));
  return row ?? null;
}

export async function dropCachedThread(id: string): Promise<void> {
  await tx(STORE_THREADS, "readwrite", (s) => s.delete(id));
}

/** Keep only the most recently used threads (§23 bounded cache). */
async function evictOldThreads(): Promise<void> {
  const keys = await tx<IDBValidKey[]>(STORE_THREADS, "readonly", (s) => s.getAllKeys());
  if (!keys || keys.length <= MAX_CACHED_THREADS) return;
  const all = await tx<CachedThread[]>(STORE_THREADS, "readonly", (s) => s.getAll());
  if (!all) return;
  const stale = all
    .sort((a, b) => b.at - a.at)
    .slice(MAX_CACHED_THREADS)
    .map((t) => t.id);
  const db = await openDb();
  if (!db) return;
  try {
    const t = db.transaction(STORE_THREADS, "readwrite");
    const store = t.objectStore(STORE_THREADS);
    stale.forEach((id) => store.delete(id));
  } catch {
    /* eviction is best-effort */
  }
}

/* ── Inbox rows ─────────────────────────────────────────────────────────── */

export interface CachedInbox {
  key: "inbox" | "archived";
  rows: unknown[];
  at: number;
}

export async function cacheInbox(key: "inbox" | "archived", rows: unknown[]): Promise<void> {
  await tx(STORE_META, "readwrite", (s) => s.put({ key, rows, at: Date.now() }));
}

export async function readCachedInbox(key: "inbox" | "archived"): Promise<CachedInbox | null> {
  const row = await tx<CachedInbox | undefined>(STORE_META, "readonly", (s) => s.get(key));
  return row ?? null;
}

/* ── Account-scoped wipe ────────────────────────────────────────────────── */

/**
 * Called on logout. Without this, the next account to sign in on the same
 * device would flash the previous user's conversations before its own
 * loaded — a privacy leak, not just a glitch.
 */
export async function clearMessagesCache(): Promise<void> {
  await tx(STORE_THREADS, "readwrite", (s) => s.clear());
  await tx(STORE_META, "readwrite", (s) => s.clear());
}
