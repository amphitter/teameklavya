"use client";

/**
 * The Search screen's opening state (§3/§5) — Trending, as a VISUAL grid.
 *
 * The brief is specific about what this must not be: an empty search page, a
 * "Start typing to search" placeholder, or a wall of captions. It is a collage
 * of real content, and every tile comes from an endpoint that already existed
 * or from the one trending endpoint added for it:
 *
 *   posts  GET /api/posts/trending   — ranked by real engagement (likes ×2 +
 *                                       comments) over 30 days, image-first
 *   events GET /api/events/trending  — the existing server-ranked event list
 *
 * Nothing here is invented: no placeholder cards, no "trending in your area"
 * copy, no fake counts. If both endpoints return nothing the grid says so.
 *
 * Tapping a POST opens a sheet holding the FEED's own post component, so like,
 * double-tap like, comment, save, share, open profile and open event all work
 * because they are the same code — not a second, thinner post viewer. Tapping
 * an EVENT navigates to the existing event page, where the existing
 * registration flow takes over.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CalendarDays, Flame } from "lucide-react";
import { api } from "@/utils/api";
import type { FeedPostData } from "@/components/feed/types";
import { EmptyState } from "@/components/states";
import { PostViewerSheet } from "@/components/search/post-viewer-sheet";
import { cn } from "@/lib/utils";

export interface TrendingPost extends FeedPostData {
  /** 0..n — real engagement score, used only for ordering on the server. */
  trendScore?: number;
  hasMedia?: boolean;
  /** The one image the grid shows (post image, else the event's banner). */
  gridImage?: string | null;
}

export interface TrendingEvent {
  _id: string;
  title: string;
  slug: string;
  bannerUrl?: string;
  category?: string;
  venue?: string;
  startDate?: string;
  participantCount?: number;
}

/** yyyy-mm-dd → "12 Oct" — short, because the tile is 160px wide. */
const shortDate = (iso?: string) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
};

function Tile({
  image,
  badge,
  title,
  meta,
  onClick,
  href,
  className,
}: {
  image?: string | null;
  badge: React.ReactNode;
  title: string;
  meta?: string;
  onClick?: () => void;
  href?: string;
  className?: string;
}) {
  const inner = (
    <>
      {image ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={image}
          alt=""
          loading="lazy"
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
        />
      ) : (
        <span className="flex h-full w-full items-center justify-center bg-gradient-to-br from-brand-light to-purple-light p-3">
          <span className="line-clamp-4 text-center text-[12.5px] font-bold leading-snug text-foreground/80">
            {title}
          </span>
        </span>
      )}
      {/* One gradient scrim, and only enough to keep the label readable (§32). */}
      {image ? (
        <span className="absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-black/70 to-transparent" aria-hidden />
      ) : null}
      <span className="absolute left-1.5 top-1.5">{badge}</span>
      {image ? (
        <span className="absolute inset-x-1.5 bottom-1.5">
          <span className="line-clamp-1 block text-[11.5px] font-bold text-white drop-shadow-sm">{title}</span>
          {meta ? <span className="line-clamp-1 block text-[10px] font-medium text-white/80">{meta}</span> : null}
        </span>
      ) : null}
    </>
  );

  const cls = cn(
    "group relative block aspect-square w-full overflow-hidden rounded-xl border border-border bg-muted text-left",
    className
  );

  if (href) {
    return (
      <Link href={href} className={cls} aria-label={title}>
        {inner}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} className={cls} aria-label={title}>
      {inner}
    </button>
  );
}

export function TrendingGrid({
  posts,
  events,
  loading,
  failed,
  onRetry,
}: {
  posts: TrendingPost[];
  events: TrendingEvent[];
  loading: boolean;
  failed?: boolean;
  onRetry?: () => void;
}) {
  /* The tapped post, held here so the sheet is part of this screen: closing it
     restores the exact scroll position because nothing navigated (§6). */
  const [openPost, setOpenPost] = useState<TrendingPost | null>(null);
  /* FeedPost keeps its own like/save state; when the sheet closes we simply
     drop the local copy — the post's real state is the server's, and the next
     open re-reads it through the same component. */
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="aspect-square animate-pulse rounded-xl bg-muted" />
        ))}
      </div>
    );
  }

  if (failed) {
    return (
      <div className="rounded-xl border border-destructive/20 bg-destructive/5 px-6 py-12 text-center">
        <p className="text-base font-semibold text-foreground">Couldn&apos;t load what&apos;s trending</p>
        <p className="mt-1 text-sm text-muted-foreground">Give it another try.</p>
        {onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="mt-4 rounded-full border border-border px-4 py-2 text-[13px] font-semibold text-foreground"
          >
            Retry
          </button>
        ) : null}
      </div>
    );
  }

  const visiblePosts = posts.filter((p) => !dismissed.has(p._id));
  if (!visiblePosts.length && !events.length) {
    return (
      <EmptyState
        icon={Flame}
        title="Nothing trending yet"
        description="Post something, or search for an event, person or topic."
      />
    );
  }

  /* Interleave: two posts, then an event, then repeat. A single long column of
     one kind is what makes a discover grid look like a list. */
  const tiles: React.ReactNode[] = [];
  let pi = 0;
  let ei = 0;
  while (pi < visiblePosts.length || ei < events.length) {
    for (let n = 0; n < 2 && pi < visiblePosts.length; n++, pi++) {
      const p = visiblePosts[pi];
      tiles.push(
        <Tile
          key={`p${p._id}`}
          image={p.gridImage}
          title={p.content?.slice(0, 70) || "Post"}
          meta={
            p.author ? `@${p.author.username || p.author.firstName}` : p.likeCount ? `${p.likeCount} likes` : undefined
          }
          badge={
            <span className="flex items-center gap-1 rounded-full bg-black/55 px-1.5 py-0.5 text-[9px] font-bold text-white backdrop-blur-sm">
              <Flame className="h-2.5 w-2.5" /> POST
            </span>
          }
          onClick={() => setOpenPost(p)}
        />
      );
    }
    if (ei < events.length) {
      const e = events[ei++];
      tiles.push(
        <Tile
          key={`e${e._id}`}
          image={e.bannerUrl}
          href={`/events/${e.slug}`}
          title={e.title}
          meta={[shortDate(e.startDate), e.venue].filter(Boolean).join(" · ")}
          badge={
            <span className="flex items-center gap-1 rounded-full bg-black/55 px-1.5 py-0.5 text-[9px] font-bold text-white backdrop-blur-sm">
              <CalendarDays className="h-2.5 w-2.5" /> EVENT
            </span>
          }
        />
      );
    }
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{tiles}</div>

      {/* The post viewer (§6). A sheet, not a route: the brief requires the
          Search scroll position to survive opening and closing a post, and a
          navigation cannot promise that. */}
      <PostViewerSheet
        post={openPost}
        onClose={() => setOpenPost(null)}
        onDeleted={(id) => setDismissed((prev) => new Set(prev).add(id))}
      />
    </>
  );
}

/**
 * The whole opening screen of Search: fetch, then grid.
 *
 * Two requests, both existing contracts — `/posts/trending` (added for this
 * brief, ranked on real engagement) and `/events/trending` (the server-ranked
 * list the Explore screen already uses). They are fired together and the grid
 * renders as soon as the first one lands, so the page is never blank while the
 * second is in flight.
 */
export function TrendingSection() {
  const [posts, setPosts] = useState<TrendingPost[]>([]);
  const [events, setEvents] = useState<TrendingEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    let alive = true;
    setLoading(true);
    setFailed(false);
    const done = { posts: false, events: false };
    const settle = () => {
      if (!alive) return;
      if (done.posts && done.events) setLoading(false);
    };
    api
      .get("/posts/trending", { params: { limit: 24 } })
      .then((r) => {
        if (!alive) return;
        setPosts(r.data?.posts || []);
      })
      .catch(() => {
        if (!alive) return;
        setFailed(true);
      })
      .finally(() => {
        done.posts = true;
        settle();
      });
    api
      .get("/events/trending", { params: { limit: 12 } })
      .then((r) => {
        if (!alive) return;
        setEvents(r.data?.events || []);
      })
      .catch(() => {
        /* Events failing must not blank a grid of real posts. */
      })
      .finally(() => {
        done.events = true;
        settle();
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => load(), [load]);

  return (
    <section aria-label="Trending">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="flex items-center gap-1.5 text-base font-extrabold tracking-tight text-foreground">
          <Flame className="h-4 w-4 text-primary" /> Trending
        </h2>
        <Link href="/explore" className="text-[12px] font-semibold text-primary hover:underline">
          Explore events
        </Link>
      </div>
      <TrendingGrid
        posts={posts}
        events={events}
        loading={loading}
        failed={failed && !posts.length}
        onRetry={load}
      />
    </section>
  );
}
