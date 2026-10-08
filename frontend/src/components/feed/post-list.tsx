"use client";

/**
 * PostList — the feed's post, in a list, with pagination.
 *
 * One component serves four screens: the profile's Posts tab, and the owner's
 * Saved / Liked / Archive tabs (plus their standalone routes). They differ only
 * in the endpoint they read and what their empty state says, so a second
 * implementation would mean the same post behaving differently depending on
 * where you found it — exactly what the brief forbids ("profile posts use the
 * feed's post component… no second-class profile-only post").
 *
 * Pagination: the endpoints are not identical twins. `/users/:id/posts` is
 * page-based; `/posts/saved|liked|archived` are cursor-based. Both are
 * first-class here — the loader passes `cursor=` when the response carries
 * `nextCursor`, and `page=` otherwise, so a new endpoint only has to tell the
 * truth about which it is.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { api } from "@/utils/api";
import { FeedPost } from "@/components/feed/feed-post";
import { PostSkeleton } from "@/components/feed/post-skeleton";
import { ErrorState, EmptyState } from "@/components/states";
import type { FeedPostData } from "@/components/feed/types";

export interface PostListHandle {
  /** Remove a post from the list (deleted, or archived out of this view). */
  remove: (id: string) => void;
  /** How many are loaded — the caller decides whether a count is meaningful. */
  count: number;
  /** False while a page is still available: a count is only shown when true. */
  complete: boolean;
}

interface PostListProps {
  /**
   * Endpoint that returns `{ posts, hasMore, nextCursor? , page? }`.
   * A function of the cursor/page so the caller can interpolate ids.
   */
  endpoint: (params: { page: number; cursor: string | null }) => string;
  emptyIcon?: React.ComponentType<{ className?: string }>;
  emptyTitle: string;
  emptyDescription?: string;
  emptyAction?: React.ReactNode;
  /** §96 — compact empty state for a tab inside a page with its own header. */
  emptyCompact?: boolean;
  /** Page size hint. */
  limit?: number;
  /** Extra line above the list (e.g. "private to you"). */
  notice?: React.ReactNode;
  /**
   * Called after every load with the list state, so a parent can show an
   * honest count or a tab badge.
   */
  onStateChange?: (state: PostListHandle & { posts: FeedPostData[] }) => void;
  /** Where a post was archived FROM decides what happens to it. */
  onArchivedBehavior?: "remove" | "keep";
  /** Render the post compactly (used by saved/liked where chrome is noise). */
  className?: string;
  /** Externally controlled posts (the profile page already has them). */
  initialPosts?: FeedPostData[];
}

export function PostList({
  endpoint,
  emptyIcon: EmptyIcon,
  emptyTitle,
  emptyDescription,
  emptyAction,
  emptyCompact = false,
  limit = 12,
  notice,
  onStateChange,
  onArchivedBehavior = "remove",
  className,
  initialPosts,
}: PostListProps) {
  const seeded = Boolean(initialPosts?.length);
  const [posts, setPosts] = useState<FeedPostData[]>(initialPosts || []);
  const [loading, setLoading] = useState(!seeded);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const pageRef = useRef(1);
  const cursorRef = useRef<string | null>(null);
  /** Guards against a late response from a previous mount overwriting state. */
  const runRef = useRef(0);

  const load = useCallback(
    async (mode: "first" | "more") => {
      const run = ++runRef.current;
      if (mode === "first") {
        setLoading(true);
        setError(false);
        pageRef.current = 1;
        cursorRef.current = null;
      } else {
        setLoadingMore(true);
      }
      try {
        const res = await api.get(
          endpoint({
            page: mode === "more" ? pageRef.current + 1 : 1,
            cursor: mode === "more" ? cursorRef.current : null,
          })
        );
        if (run !== runRef.current) return; // superseded — say nothing
        const incoming: FeedPostData[] = res.data?.posts || [];
        setPosts((prev) => (mode === "more" ? [...prev, ...incoming] : incoming));
        setHasMore(Boolean(res.data?.hasMore));
        cursorRef.current = res.data?.nextCursor ?? null;
        pageRef.current = mode === "more" ? pageRef.current + 1 : 1;
      } catch {
        if (run !== runRef.current) return;
        setError(true);
      } finally {
        if (run === runRef.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [endpoint]
  );

  /* `endpoint` is normally an inline arrow, so it is a new function every
     render. Keying the effect on it would loop; the caller's intent is
     expressed by the screen, which remounts this list when the tab changes. */
  const firstEndpoint = useRef(endpoint);
  useEffect(() => {
    if (seeded) return; // the caller already supplied the first page
    void load("first");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const remove = useCallback((id: string) => {
    setPosts((prev) => prev.filter((p) => p._id !== id));
  }, []);

  /* Report upward for honest counts. Fires on every change, including after a
     removal, so a badge can never disagree with the list under it. */
  useEffect(() => {
    onStateChange?.({
      posts,
      remove,
      count: posts.length,
      complete: !hasMore && !loading && !loadingMore,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [posts, hasMore, loading, loadingMore]);

  if (loading) {
    return (
      <div className={className}>
        <PostSkeleton />
        <PostSkeleton />
      </div>
    );
  }

  if (error) {
    return (
      <ErrorState
        title="Couldn't load these posts"
        description="The list didn't come back. Try again."
        onRetry={() => load("first")}
      />
    );
  }

  if (posts.length === 0) {
    return (
      <EmptyState
        compact={emptyCompact}
        icon={EmptyIcon ?? (({ className }) => <span className={className} />)}
        title={emptyTitle}
        description={emptyDescription}
        action={emptyAction}
      />
    );
  }

  return (
    <div className={className}>
      {notice}
      <div className="space-y-4">
        {posts.map((p) => (
          <FeedPost
            key={p._id}
            post={p}
            onDeleted={remove}
            onArchived={(id, archived) => {
              /* Archiving takes a post out of every public list; restoring
                 puts it back where you are. In the Archive tab it is the
                 reverse — a restored post belongs on the profile, not here. */
              if (onArchivedBehavior === "keep") return;
              void archived;
              remove(id);
            }}
          />
        ))}
      </div>

      {hasMore && (
        <div className="mt-5 flex justify-center">
          <button
            type="button"
            onClick={() => load("more")}
            disabled={loadingMore}
            className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-5 py-2.5 text-sm font-semibold text-foreground transition-colors hover:border-primary hover:text-primary disabled:opacity-60"
          >
            {loadingMore ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {loadingMore ? "Loading…" : "Load more"}
          </button>
        </div>
      )}
      {!hasMore && posts.length >= limit && (
        <p className="mt-5 text-center text-xs text-muted-foreground">That's everything.</p>
      )}
    </div>
  );
}
