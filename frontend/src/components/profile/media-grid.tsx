"use client";

/**
 * MediaGrid — the profile's Media tab (§5).
 *
 * What this replaces: `posts.flatMap(p => p.images).slice(0, 12)` — the first
 * twelve images of whichever twenty-four posts happened to be loaded. It was
 * not the profile's media, it was a window onto one page of it, rendered as
 * `<img>` tags that linked nowhere, with no way to reach the rest.
 *
 * Now it reads `GET /api/users/:id/media`, which returns image posts,
 * paginated, in the same visible set as the Posts tab (published, not
 * archived, visibility-respecting). Every tile links to its post, because a
 * photo you cannot open is a decoration.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ImageOff, Loader2 } from "lucide-react";
import { api } from "@/utils/api";
import { OptimizedImage } from "@/components/ui/optimized-image";
import { EmptyState, ErrorState } from "@/components/states";

interface MediaPost {
  _id: string;
  images: string[];
  content?: string;
  createdAt?: string;
  event?: { _id: string; title?: string; slug?: string } | null;
}

export function MediaGrid({
  userId,
  emptyTitle = "No media yet",
  emptyDescription = "Photos shared in posts will show up here.",
  onStateChange,
  limit = 18,
}: {
  userId: string;
  emptyTitle?: string;
  emptyDescription?: string;
  /** Reports the grid's real size so a tab count can never overstate it. */
  onStateChange?: (state: { count: number; complete: boolean }) => void;
  limit?: number;
}) {
  const [posts, setPosts] = useState<MediaPost[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);
  const runRef = useRef(0);

  const load = useCallback(
    async (nextPage: number) => {
      const run = ++runRef.current;
      if (nextPage === 1) {
        setLoading(true);
        setError(false);
      } else {
        setLoadingMore(true);
      }
      try {
        const res = await api.get(`/users/${userId}/media?page=${nextPage}&limit=${limit}`);
        if (run !== runRef.current) return;
        const incoming: MediaPost[] = res.data?.posts || [];
        setPosts((prev) => (nextPage === 1 ? incoming : [...prev, ...incoming]));
        setHasMore(Boolean(res.data?.hasMore));
        setPage(nextPage);
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
    [userId, limit]
  );

  useEffect(() => {
    void load(1);
  }, [load]);

  /* A private profile answers with an empty list and `canView: false`; the
     caller renders the lock screen instead, so an empty grid here is real. */
  useEffect(() => {
    onStateChange?.({ count: posts.length, complete: !hasMore && !loading && !loadingMore });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [posts, hasMore, loading, loadingMore]);

  if (loading) {
    return (
      <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 sm:gap-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="aspect-square animate-pulse rounded-lg bg-muted" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <ErrorState
        title="Couldn't load media"
        description="The grid didn't come back. Try again."
        onRetry={() => load(1)}
      />
    );
  }

  if (posts.length === 0) {
    return <EmptyState icon={ImageOff} title={emptyTitle} description={emptyDescription} />;
  }

  return (
    <div>
      <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 sm:gap-2">
        {posts.flatMap((p) =>
          (p.images || []).map((src, i) => (
            <Link
              key={`${p._id}-${i}`}
              /* Opens the post the photo belongs to — the same destination the
                 Posts tab would give you, with its likes and comments intact. */
              href={`/post/${p._id}`}
              className="group relative aspect-square overflow-hidden rounded-lg border border-border"
              aria-label={p.content ? `Post: ${p.content.slice(0, 60)}` : "Open post"}
            >
              <OptimizedImage
                src={src}
                alt=""
                preset="post"
                size="small"
                aspectRatio="1 / 1"
                sizes="(max-width: 640px) 33vw, 240px"
                className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
              />
              {p.event?.title ? (
                <span className="pointer-events-none absolute inset-x-0 bottom-0 line-clamp-1 bg-gradient-to-t from-black/70 to-transparent px-2 py-1.5 text-[10px] font-semibold text-white">
                  {p.event.title}
                </span>
              ) : null}
            </Link>
          ))
        )}
      </div>

      {hasMore && (
        <div className="mt-4 flex justify-center">
          <button
            type="button"
            onClick={() => load(page + 1)}
            disabled={loadingMore}
            className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-5 py-2.5 text-sm font-semibold text-foreground transition-colors hover:border-primary hover:text-primary disabled:opacity-60"
          >
            {loadingMore ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {loadingMore ? "Loading…" : "Load more"}
          </button>
        </div>
      )}
    </div>
  );
}
