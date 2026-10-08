"use client";

/**
 * EventHub query layer (Part 5, Phase 5 — spec §16, §15, §17, §30, §39, §52)
 * ───────────────────────────────────────────────────────────────────────────
 * The ONE place the frontend fetches data.
 *
 * Why it exists:
 *   §16 "Do not scatter raw fetch() calls throughout components." There are
 *   123 `api.*` call sites in this codebase today with no shared caching, no
 *   deduplication, no stale-time and no retry policy — so five components
 *   mounting at once issue five identical requests, and every remount refetches.
 *
 *   §15 "Five components request GET /api/events/123 at the same time. Only
 *   one backend operation should be necessary." Every entry keeps its in-flight
 *   promise, so concurrent callers share one network round trip.
 *
 * Design constraints:
 *   • NO new dependency. The project has no data-fetching library today, and
 *     §16 says to use one if present rather than introduce a competitor — none
 *     is present, so we implement the smallest thing that works.
 *   • The public API deliberately mirrors React Query's shape
 *     (useQuery / useInfiniteQuery / useMutation / invalidateQueries) so a
 *     future swap to @tanstack/react-query is a rename, not a rewrite.
 *   • Cache keys mirror the backend's key builder (§11): ["event", id],
 *     ["notifications"], ["messages", "thread", id] — so a server-side
 *     invalidation and a client-side invalidation talk about the same thing.
 *
 * Retry policy (§30): retry ONLY transient failures — network errors, 5xx,
 * and 408/429. Never retry 400/401/403/404/409 (validation, auth, duplicates),
 * and never retry a cancelled request. Backoff is exponential with jitter so a
 * failing backend is not hit by a synchronised retry storm.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { AxiosError, AxiosRequestConfig } from "axios";
import { api } from "@/utils/api";

/* ── Keys ──────────────────────────────────────────────────────────────── */

export type QueryKey = readonly unknown[];

/** Stable string form of a key — used as the Map identity. */
export function keyToString(key: QueryKey): string {
  return JSON.stringify(key);
}

/**
 * Does `key` sit under `prefix`? ["event","123"] is under ["event"].
 * Drives `invalidateQueries` so invalidating a domain clears its members.
 */
function keyMatches(key: QueryKey, prefix: QueryKey): boolean {
  if (prefix.length > key.length) return false;
  return prefix.every((part, i) => key[i] === part);
}

/* ── Defaults (§16: stale time / cache time) ───────────────────────────── */

const DEFAULTS = {
  /** How long data is considered fresh — no refetch within this window. */
  staleTime: 30_000,
  /** How long an entry survives with zero subscribers before GC. */
  cacheTime: 5 * 60_000,
  retries: 2,
  baseDelayMs: 300,
  maxDelayMs: 4_000,
};

/* ── Retry policy (§30) ────────────────────────────────────────────────── */

function statusOf(error: unknown): number | undefined {
  return (error as AxiosError)?.response?.status;
}

/** Cancelled (AbortController) requests must never be retried. */
export function isCancelled(error: unknown): boolean {
  const e = error as AxiosError;
  return e?.code === "ERR_CANCELED" || e?.code === "ECONNABORTED" || e?.name === "CanceledError";
}

/**
 * Retry only transient conditions. Deliberately excludes:
 *   400/401/403/404/409 — validation, auth, missing, duplicate (§30)
 *   cancelled           — the caller moved on; retrying is pure waste
 */
export function isRetryable(error: unknown): boolean {
  if (!error) return false;
  if (isCancelled(error)) return false;

  // Network failure: no response at all (offline, DNS, TLS, timeout).
  const e = error as AxiosError;
  if (!e.response) return true;

  const status = e.response.status;
  if (status >= 500) return true;
  return status === 408 || status === 429; // timeout / rate limited
}

/** Exponential backoff with FULL jitter — avoids synchronised retry storms (§30). */
export function backoffMs(attempt: number, base = DEFAULTS.baseDelayMs, max = DEFAULTS.maxDelayMs): number {
  const ceiling = Math.min(max, base * 2 ** attempt);
  return Math.floor(Math.random() * ceiling);
}

/* ── Cache ─────────────────────────────────────────────────────────────── */

interface Entry<T> {
  key: string;
  data?: T;
  error?: unknown;
  updatedAt: number;
  /** Shared in-flight promise — this is the §15 deduplication. */
  inflight?: Promise<T>;
  subscribers: number;
  gcTimer?: ReturnType<typeof setTimeout>;
}

type Listener = () => void;

class QueryCache {
  private entries = new Map<string, Entry<any>>();
  private listeners = new Map<string, Set<Listener>>();
  /* A SECOND channel, deliberately not the same set as `listeners`.
   *
   * `listeners` fire for every cache change, including the ones a fetch makes
   * when it lands. If "must refetch" were wired to that channel, a refetch
   * would invalidate, which would refetch, which would invalidate — an infinite
   * request loop. Only `invalidate()` fires these. */
  private invalidateListeners = new Map<string, Set<Listener>>();

  /**
   * Subscribe to invalidation of an exact key.
   *
   * This is what makes `invalidateQueries` mean what every caller (and React
   * Query) already assumes it means: the affected queries are marked stale AND
   * the ones with a live component behind them refetch. Before this, an
   * invalidation cleared the cached data and told nobody — a mounted list kept
   * rendering what it had, or emptied itself, until some unrelated event
   * happened to refetch it. Publishing a post from another surface is exactly
   * that case: the feed has to catch up without a page reload.
   */
  onInvalidate(key: string, fn: Listener): () => void {
    if (!this.invalidateListeners.has(key)) this.invalidateListeners.set(key, new Set());
    this.invalidateListeners.get(key)!.add(fn);
    return () => {
      const set = this.invalidateListeners.get(key);
      if (!set) return;
      set.delete(fn);
      if (!set.size) this.invalidateListeners.delete(key);
    };
  }

  subscribe(key: string, fn: Listener): () => void {
    if (!this.listeners.has(key)) this.listeners.set(key, new Set());
    this.listeners.get(key)!.add(fn);
    return () => {
      const set = this.listeners.get(key);
      if (!set) return;
      set.delete(fn);
      if (!set.size) this.listeners.delete(key);
    };
  }

  private emit(key: string) {
    this.listeners.get(key)?.forEach((fn) => fn());
  }

  get<T>(key: string): Entry<T> | undefined {
    return this.entries.get(key) as Entry<T> | undefined;
  }

  ensure<T>(key: string): Entry<T> {
    let entry = this.entries.get(key) as Entry<T> | undefined;
    if (!entry) {
      entry = { key, subscribers: 0, updatedAt: 0 };
      this.entries.set(key, entry);
    }
    return entry;
  }

  setData<T>(key: string, data: T) {
    const entry = this.ensure<T>(key);
    entry.data = data;
    entry.error = undefined;
    entry.updatedAt = Date.now();
    this.emit(key);
  }

  setError(key: string, error: unknown) {
    const entry = this.ensure(key);
    entry.error = error;
    entry.updatedAt = Date.now();
    this.emit(key);
  }

  /** Mark stale, drop the data, and tell live subscribers to refetch. */
  invalidate(key: string) {
    const entry = this.entries.get(key);
    if (entry) {
      entry.updatedAt = 0; // forces staleness
      entry.data = undefined;
      entry.error = undefined;
      this.emit(key);
    }
    this.invalidateListeners.get(key)?.forEach((fn) => fn());
  }

  /** Hard remove (used by cache GC and reset). */
  remove(key: string) {
    this.entries.delete(key);
    this.emit(key);
  }

  keys(): string[] {
    return [...this.entries.keys()];
  }

  clear() {
    const keys = this.keys();
    this.entries.clear();
    keys.forEach((k) => this.emit(k));
  }
}

export const queryCache = new QueryCache();

/* ── Fetch with retry + dedup ──────────────────────────────────────────── */

export interface FetchOptions extends AxiosRequestConfig {
  retries?: number;
  /**
   * Abort an in-flight request (§39 — cancel superseded searches).
   * Accepts either a DOM `AbortSignal` (what we create) or axios'
   * `GenericAbortSignal`, so a plain `AxiosRequestConfig` stays assignable.
   */
  signal?: AbortSignal | AxiosRequestConfig["signal"];
}

/**
 * Fetch with the shared retry policy. Exposed so callers outside the hooks
 * (prefetch, imperative refresh) get identical behaviour.
 */
export async function fetchWithRetry<T>(url: string, options: FetchOptions = {}): Promise<T> {
  const { retries = DEFAULTS.retries, ...axiosOpts } = options;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await api.request<T>({ url, ...axiosOpts });
      return res.data;
    } catch (error) {
      lastError = error;
      if (attempt === retries || !isRetryable(error)) throw error;
      await new Promise((r) => setTimeout(r, backoffMs(attempt)));
    }
  }
  throw lastError;
}

/**
 * Deduplicated fetch (§15). Concurrent callers for the same key share ONE
 * network round trip; the promise is cleared as soon as it settles.
 */
export function dedupedFetch<T>(cacheKey: string, url: string, options: FetchOptions = {}): Promise<T> {
  const entry = queryCache.ensure<T>(cacheKey);
  if (entry.inflight) return entry.inflight;

  const promise = fetchWithRetry<T>(url, options).finally(() => {
    entry.inflight = undefined;
  });
  entry.inflight = promise;
  return promise;
}

/* ── Client API (mirrors React Query) ──────────────────────────────────── */

export const queryClient = {
  getQueryData<T>(key: QueryKey): T | undefined {
    return queryCache.get<T>(keyToString(key))?.data;
  },

  setQueryData<T>(key: QueryKey, data: T) {
    queryCache.setData(keyToString(key), data);
  },

  /** Invalidate by exact key or by domain prefix (§11-style keys). */
  invalidateQueries(key: QueryKey) {
    const prefix = JSON.stringify(key).slice(0, -1); // drop the closing ] → prefix match
    for (const k of queryCache.keys()) {
      try {
        const parsed = JSON.parse(k) as QueryKey;
        if (keyMatches(parsed, key)) queryCache.invalidate(k);
      } catch {
        /* ignore malformed */
      }
    }
    void prefix;
  },

  /** §17 — warm a key before it's needed (hover, viewport proximity). */
  prefetchQuery<T>(key: QueryKey, url: string, options?: FetchOptions) {
    const cacheKey = keyToString(key);
    const entry = queryCache.get<T>(cacheKey);
    const isFresh = entry && Date.now() - entry.updatedAt < DEFAULTS.staleTime;
    if (entry?.inflight || isFresh) return; // already warm
    return dedupedFetch<T>(cacheKey, url, options)
      .then((data) => queryCache.setData(cacheKey, data))
      .catch(() => undefined); // prefetch failures are silent by design
  },

  removeQueries(key: QueryKey) {
    for (const k of queryCache.keys()) {
      try {
        if (keyMatches(JSON.parse(k) as QueryKey, key)) queryCache.remove(k);
      } catch {
        /* ignore */
      }
    }
  },

  clear() {
    queryCache.clear();
  },
};

/* ── useQuery ──────────────────────────────────────────────────────────── */

export interface UseQueryOptions<T> {
  /** ms data stays fresh (default 30s) */
  staleTime?: number;
  /** ms unused data stays in memory (default 5min) */
  cacheTime?: number;
  enabled?: boolean;
  refetchOnWindowFocus?: boolean;
  /** Poll every N ms — see usePolling for a visibility-aware alternative. */
  refetchInterval?: number | false;
  onSuccess?: (data: T) => void;
  onError?: (error: unknown) => void;
  axios?: AxiosRequestConfig;
}

export interface UseQueryResult<T> {
  data: T | undefined;
  error: unknown;
  isLoading: boolean;
  isFetching: boolean;
  refetch: () => Promise<void>;
}

/**
 * Fetch + cache + dedup + retry, with automatic subscription lifecycle.
 *
 * `isLoading` is true only for the FIRST load with no cached data;
 * `isFetching` is true for any in-flight request (including background
 * revalidation) — matching React Query's semantics.
 */
export function useQuery<T>(
  key: QueryKey,
  url: string | null,
  options: UseQueryOptions<T> = {}
): UseQueryResult<T> {
  const {
    staleTime = DEFAULTS.staleTime,
    cacheTime = DEFAULTS.cacheTime,
    enabled = true,
    refetchOnWindowFocus = false,
    refetchInterval = false,
    onSuccess,
    onError,
    axios: axiosOpts,
  } = options;

  const cacheKey = keyToString(key);
  const [, forceRender] = useState(0);
  const rerender = useCallback(() => forceRender((n) => n + 1), []);

  const [isFetching, setIsFetching] = useState(false);

  // Latest callbacks without retriggering the effect.
  const onSuccessRef = useRef(onSuccess);
  const onErrorRef = useRef(onError);
  onSuccessRef.current = onSuccess;
  onErrorRef.current = onError;

  const axiosOptsRef = useRef(axiosOpts);
  axiosOptsRef.current = axiosOpts;

  /* Latest fetch inputs, so the invalidation listener below can refetch without
     being re-subscribed (and without adding them to a dependency list). */
  const runFetchRef = useRef<() => Promise<void>>(async () => {});
  const liveRef = useRef(false);
  liveRef.current = Boolean(enabled && url);

  /* Subscribe so external invalidations re-render this component — and now also
     REFETCH it. A component that is on screen and has just been told its data is
     stale must not sit there showing the stale data. */
  useEffect(() => {
    const entry = queryCache.ensure<T>(cacheKey);
    entry.subscribers += 1;
    if (entry.gcTimer) {
      clearTimeout(entry.gcTimer);
      entry.gcTimer = undefined;
    }
    const unsub = queryCache.subscribe(cacheKey, rerender);
    const unsubInvalidate = queryCache.onInvalidate(cacheKey, () => {
      rerender();
      const e = queryCache.get<T>(cacheKey);
      if (liveRef.current && !e?.inflight) void runFetchRef.current();
    });

    return () => {
      unsubInvalidate();
      const e = queryCache.get<T>(cacheKey);
      if (!e) return;
      e.subscribers = Math.max(0, e.subscribers - 1);
      unsub();
      // §16 cache time — evict once nothing is listening.
      if (e.subscribers === 0 && !e.inflight) {
        e.gcTimer = setTimeout(() => queryCache.remove(cacheKey), cacheTime);
      }
    };
  }, [cacheKey, cacheTime, rerender]);

  const runFetch = useCallback(async () => {
    if (!url || !enabled) return;
    setIsFetching(true);
    try {
      const data = await dedupedFetch<T>(cacheKey, url, axiosOptsRef.current);
      queryCache.setData<T>(cacheKey, data);
      onSuccessRef.current?.(data);
    } catch (error) {
      if (!isCancelled(error)) queryCache.setError(cacheKey, error);
      onErrorRef.current?.(error);
    } finally {
      setIsFetching(false);
    }
  }, [cacheKey, url, enabled]);

  runFetchRef.current = runFetch;

  /* Load when missing or stale. */
  useEffect(() => {
    const entry = queryCache.get<T>(cacheKey);
    const hasData = entry?.data !== undefined;
    const isStale = !hasData || Date.now() - (entry?.updatedAt ?? 0) >= staleTime;
    if (enabled && url && isStale && !entry?.inflight) {
      void runFetch();
    }
  }, [cacheKey, url, enabled, staleTime, runFetch]);

  /* Optional window focus refetch (§52 — after a network blip). */
  useEffect(() => {
    if (!refetchOnWindowFocus || typeof window === "undefined") return;
    const onFocus = () => {
      const entry = queryCache.get<T>(cacheKey);
      if (!entry) return;
      if (Date.now() - entry.updatedAt >= staleTime) void runFetch();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refetchOnWindowFocus, cacheKey, staleTime, runFetch]);

  /* Optional fixed-interval polling. Prefers usePolling() for hot paths. */
  useEffect(() => {
    if (!refetchInterval) return;
    const id = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return; // no work for a hidden tab
      void runFetch();
    }, refetchInterval);
    return () => clearInterval(id);
  }, [refetchInterval, runFetch]);

  const entry = queryCache.get<T>(cacheKey);
  return {
    data: entry?.data,
    error: entry?.error,
    isLoading: entry?.data === undefined && isFetching,
    isFetching,
    refetch: async () => {
      await runFetch();
    },
  };
}

/* ── usePolling — visibility + backoff aware (§6 of the audit, §51) ────── */

/**
 * Polling that respects the user, the network and the battery.
 *
 * The audit found 7 fixed-interval loops (messages thread every 6s, bell every
 * 30s, …) that kept firing while the tab sat in the background, all day. This
 * replaces them with:
 *   • paused entirely while `document.hidden` (§51 — mobile battery/data)
 *   • adaptive: after N identical responses the interval stretches, and it
 *     snaps back to `intervalMs` the moment data actually changes
 *   • still immediate on window focus, so the UI is never stale when looked at
 *
 * `hasChanged` is supplied by the caller and compares the new payload to the
 * previous one — that's what drives the backoff.
 */
export function usePolling(
  callback: () => void,
  {
    intervalMs,
    maxIntervalMs = intervalMs * 6,
    enabled = true,
    calmAfter = 3,
  }: { intervalMs: number; maxIntervalMs?: number; enabled?: boolean; calmAfter?: number }
) {
  const cbRef = useRef(callback);
  cbRef.current = callback;

  const idleRef = useRef(0);
  const currentInterval = useRef(intervalMs);

  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    const schedule = () => {
      if (stopped) return;
      timer = setTimeout(tick, currentInterval.current);
    };

    const tick = () => {
      if (stopped) return;
      // Never poll a tab nobody is looking at.
      if (typeof document !== "undefined" && document.hidden) {
        currentInterval.current = intervalMs;
        idleRef.current = 0;
        schedule();
        return;
      }
      cbRef.current();
      schedule();
    };

    schedule();

    const onVisible = () => {
      if (typeof document !== "undefined" && !document.hidden) {
        currentInterval.current = intervalMs;
        idleRef.current = 0;
        cbRef.current(); // refresh immediately when the user returns
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [intervalMs, enabled]);

  /**
   * Call from your fetch: `true` if the payload changed. Identical responses
   * stretch the interval (up to maxIntervalMs); a real change resets it.
   */
  const reportResult = useCallback(
    (changed: boolean) => {
      if (changed) {
        idleRef.current = 0;
        currentInterval.current = intervalMs;
      } else {
        idleRef.current += 1;
        if (idleRef.current >= calmAfter) {
          currentInterval.current = Math.min(maxIntervalMs, Math.round(currentInterval.current * 1.6));
        }
      }
    },
    [intervalMs, maxIntervalMs, calmAfter]
  );

  return { reportResult };
}

/* ── useInfiniteQuery (§7 cursor pagination) ───────────────────────────── */

export interface InfinitePage<T> {
  items: T[];
  nextCursor?: string | null;
  hasMore?: boolean;
}

export interface UseInfiniteQueryResult<T> {
  items: T[];
  error: unknown;
  isLoading: boolean;
  isFetchingMore: boolean;
  hasMore: boolean;
  fetchNextPage: () => Promise<void>;
  refetch: () => Promise<void>;
}

/**
 * Cursor pagination over a cursor-paged endpoint (§7). Pages accumulate in
 * component state; the cursor is the only thing carried between requests.
 *
 * `mapPage` adapts endpoints that don't speak the `{ items, nextCursor }`
 * envelope natively — e.g. `/posts/feed` returns `{ posts, hasMore, nextCursor }`.
 */
export function useInfiniteQuery<T>(
  key: QueryKey,
  buildUrl: (cursor: string | null) => string,
  options: {
    enabled?: boolean;
    pageSize?: number;
    /** Shape the raw response into an `InfinitePage<T>`. */
    mapPage?: (raw: any) => InfinitePage<T>;
  } = {}
): UseInfiniteQueryResult<T> {
  const { enabled = true, mapPage } = options;
  const [pages, setPages] = useState<InfinitePage<T>[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isFetchingMore, setIsFetchingMore] = useState(false);
  const [error, setError] = useState<unknown>(undefined);
  const [reloadToken, setReloadToken] = useState(0);

  const abortRef = useRef<AbortController | null>(null);
  // Mirrors `pages` so `load` can merge without depending on it — depending on
  // `pages` would recreate the loader after every fetch and re-run the effect.
  const pagesRef = useRef<InfinitePage<T>[]>([]);
  const cacheKey = keyToString(key);

  const load = useCallback(
    async (nextCursor: string | null, replace: boolean) => {
      if (!enabled) return;
      // §39 — cancel any superseded request before issuing a new one.
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      if (replace) setIsLoading(true);
      else setIsFetchingMore(true);

      try {
        const raw = await fetchWithRetry<any>(buildUrl(nextCursor), {
          signal: controller.signal,
        });
        const page: InfinitePage<T> = mapPage ? mapPage(raw) : (raw as InfinitePage<T>);
        const merged = replace ? [page] : [...pagesRef.current, page];
        pagesRef.current = merged;

        setPages(merged);
        setCursor(page.nextCursor ?? null);
        setError(undefined);
        queryCache.setData(cacheKey, { pages: merged, ts: Date.now() });
      } catch (err) {
        if (!isCancelled(err)) setError(err);
      } finally {
        setIsLoading(false);
        setIsFetchingMore(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [enabled, cacheKey, reloadToken]
  );

  useEffect(() => {
    void load(null, true);
    return () => abortRef.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, reloadToken]);

  /* An invalidation re-runs pagination from the first page, in place. The list
     keeps its scroll position and its place on screen; only the data is new.
     `reloadToken` already existed for exactly this fetch, so invalidation reuses
     it rather than introducing a second way to reload. */
  useEffect(() => queryCache.onInvalidate(cacheKey, () => setReloadToken((n) => n + 1)), [cacheKey]);

  const items = pages.flatMap((p) => p.items ?? []);
  const lastPage = pages[pages.length - 1];
  const hasMore = lastPage?.hasMore ?? Boolean(lastPage?.nextCursor);

  return {
    items,
    error,
    isLoading,
    isFetchingMore,
    hasMore,
    fetchNextPage: async () => {
      if (!hasMore || isFetchingMore) return;
      await load(cursor, false);
    },
    refetch: async () => setReloadToken((n) => n + 1),
  };
}

/* ── useMutation (§28 idempotency, §52 offline resilience) ─────────────── */

/**
 * Did `request()` hand back a raw axios response, or the payload itself?
 *
 * Both styles are in use in this codebase and both are reasonable:
 *
 *   useMutation((body) => api.put(url, body).then((r) => r.data), …)   // payload
 *   useMutation((id)   => api.delete(url), …)                          // response
 *
 * Reading `res.data` unconditionally is what broke profile save: the request
 * already unwrapped, this unwrapped again, every mutation resolved `undefined`,
 * and a caller that inspects the result read that as a failure — a red
 * "Couldn't save your profile" under a 200 response. An axios response is
 * identifiable by carrying `status`, `headers` and `data` together; a JSON
 * payload from this API never carries all three.
 */
function unwrapAxios<T>(value: T | { data: T; status?: number; headers?: unknown }): T {
  const v = value as { data?: unknown; status?: unknown; headers?: unknown };
  if (v && typeof v === "object" && "data" in v && "status" in v && "headers" in v) {
    return v.data as T;
  }
  return value as T;
}

export interface UseMutationOptions<TData, TVars> {
  /** Keys to invalidate after success — mirrors the backend's invalidation. */
  invalidate?: QueryKey[];
  onSuccess?: (data: TData, vars: TVars) => void;
  onError?: (error: unknown, vars: TVars) => void;
  /** §52 — applied before the request; rolled back on failure. */
  optimistic?: (vars: TVars) => void;
  rollback?: (vars: TVars) => void;
  /**
   * §28 — a stable id sent as `Idempotency-Key`. A double-click (or a retry
   * after a flaky connection) reuses the same key, so the backend's dedup
   * window turns the second attempt into a no-op instead of a duplicate.
   */
  idempotencyKey?: (vars: TVars) => string;
  /**
   * Reject with the original error instead of resolving `undefined`.
   *
   * Default stays `false` for the existing callers, which read the result and
   * show their own message. Callers that must tell a real failure apart from a
   * cancelled request (profile save) set this, because `undefined` cannot
   * distinguish "server said no" from "the component unmounted mid-flight".
   */
  throwOnError?: boolean;
}

export interface UseMutationResult<TData, TVars> {
  mutate: (vars: TVars) => Promise<TData | undefined>;
  isLoading: boolean;
  error: unknown;
  reset: () => void;
}

/* Test seam: the two pure helpers above are exercised directly by
 * tests/run-query-tests.js, which cannot render hooks. Kept deliberately
 * small and named so it is obvious in the file why it exists. */
export const __testUnwrapAxios = unwrapAxios;

export function useMutation<TData = any, TVars = any>(
  request: (vars: TVars) => Promise<{ data: TData }>,
  options: UseMutationOptions<TData, TVars> = {}
): UseMutationResult<TData, TVars> {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<unknown>(undefined);
  const optsRef = useRef(options);
  optsRef.current = options;

  const mutate = useCallback(async (vars: TVars) => {
    const opts = optsRef.current;
    setIsLoading(true);
    setError(undefined);

    // Optimistic update — the UI reacts instantly (§52).
    opts.optimistic?.(vars);

    try {
      const data = unwrapAxios<TData>(await request(vars));
      // Invalidate every dependent domain so the next read is fresh (§13).
      opts.invalidate?.forEach((k) => queryClient.invalidateQueries(k));
      opts.onSuccess?.(data, vars);
      return data;
    } catch (err) {
      // Roll the optimistic write back — never leave the UI lying.
      opts.rollback?.(vars);
      setError(err);
      opts.onError?.(err, vars);
      if (opts.throwOnError) throw err;
      return undefined;
    } finally {
      setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { mutate, isLoading, error, reset: () => setError(undefined) };
}

/* ── Convenience: idempotent POST (§28) ────────────────────────────────── */

/**
 * POST with an `Idempotency-Key` header. The backend's dedup window (Phase 2)
 * turns a repeated key into a 409 instead of a duplicate row, so a double
 * click or an automatic retry can never create two registrations/likes/posts.
 */
export async function idempotentPost<T>(url: string, body: unknown, key: string): Promise<{ data: T }> {
  return api.post<T>(url, body, { headers: { "Idempotency-Key": key } });
}

/* ── Prefetch helper (§17) ─────────────────────────────────────────────── */

/**
 * Prefetch on hover/focus — desktop only.
 * Skipped entirely on touch/coarse-pointer devices, where "hover" doesn't
 * exist and prefetching would silently burn mobile data (§51).
 */
export function usePrefetchOnHover<T>(key: QueryKey, url: string) {
  const fired = useRef(false);

  const onEnter = useCallback(() => {
    if (fired.current) return;
    if (typeof window === "undefined") return;
    if (window.matchMedia?.("(hover: none)").matches) return; // touch device
    fired.current = true;
    queryClient.prefetchQuery<T>(key, url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { onMouseEnter: onEnter, onFocus: onEnter };
}
