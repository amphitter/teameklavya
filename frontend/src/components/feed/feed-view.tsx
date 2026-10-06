"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { CalendarSearch, Sparkles, UserPlus, Users } from "lucide-react";
import { api } from "@/utils/api";
import { Button } from "@/components/ui/button";
import { CreatePost } from "@/components/feed/create-post";
import { FeedPost } from "@/components/feed/feed-post";
import { PostSkeleton } from "@/components/feed/post-skeleton";
import { StoryRail } from "@/components/feed/story-rail";
import { HomeGreeting } from "@/components/feed/home-greeting";
import { LiveEventHero } from "@/components/feed/live-event-hero";
import type { LiveEventData } from "@/components/feed/live-event-hero";
import { LivePulseStrip } from "@/components/feed/live-pulse-strip";
import { RightRail } from "@/components/feed/right-rail";
import { useSessionUser } from "@/components/shell/use-session-user";
import type { FeedPostData } from "@/components/feed/types";
import { cn } from "@/lib/utils";
import { useInfiniteQuery, useQuery } from "@/lib/query";

type Tab = "for-you" | "following";
const PAGE_SIZE = 10;

/** The user's live-quiz on an ongoing event (drives leaderboard widgets). */
interface LiveQuizRef {
  quizId: string;
  title?: string;
  eventTitle?: string;
}

/** Real leaderboard of the live quiz (entries, my score, player count). */
interface LiveBoard {
  entries: { rank: number; score: number; user?: { _id: string; firstName?: string; lastName?: string } | null }[];
  me: { rank: number; score: number } | null;
  total: number;
}

/**
 * EventHub home — the social event feed.
 * Real posts and real registrations only; no fabricated content.
 * Order: greeting + live badge → search (phone) → the user's LIVE events →
 * live leaderboard snapshot → stories → tabs → composer → feed.
 */
export function FeedView() {
  const { user, ready } = useSessionUser();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("for-you");
  const [homeQuery, setHomeQuery] = useState("");

  /* Local overlay: a post the user just composed, and posts they deleted.
   * Kept separate from the server list so the hook stays the source of truth
   * and a refetch can never resurrect a deleted post or drop a new one. */
  const [created, setCreated] = useState<FeedPostData[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);
  useEffect(() => {
    setCreated([]);
    setRemoved([]);
  }, [tab]);

  // My (registered) events — ongoing ones become live heroes, next ones feed the rail
  const [liveEvents, setLiveEvents] = useState<LiveEventData[]>([]);
  const [myUpcoming, setMyUpcoming] = useState<LiveEventData[]>([]);
  const [liveQuiz, setLiveQuiz] = useState<LiveQuizRef | null>(null);
  const [liveBoard, setLiveBoard] = useState<LiveBoard | null>(null);

  const composerRef = useRef<HTMLDivElement>(null);
  const topOfFeed = useRef<number>(0);
  const searchParams = useSearchParams();

  // Deep link from the Create menu: /?compose=1 focuses the composer
  useEffect(() => {
    if (searchParams.get("compose") === "1") {
      const t = setTimeout(() => {
        composerRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
        composerRef.current?.querySelector("textarea")?.focus();
      }, 350);
      return () => clearTimeout(t);
    }
  }, [searchParams]);

  // Load the signed-in user's registered events: ongoing → live heroes,
  // upcoming → right rail; detect a live quiz for "Enter Live Hub" + leaderboard.
  //
  // §15 — cached and deduped. Navigating to a post and back used to refetch
  // this plus the counts batch plus a quiz lookup per ongoing event; now the
  // whole tree renders instantly from cache and revalidates in the background.
  const { data: registered } = useQuery<{ events?: any[] }>(
    ["my-registered-events"],
    ready && user?._id ? "/registration/user/events" : null,
    { staleTime: 60_000 }
  );

  useEffect(() => {
    if (!registered) return;
    let cancelled = false;

    void (async () => {
        // Dedupe (a user can register through multiple flows) and keep real docs only
        const seen = new Set<string>();
        const events: any[] = (registered.events || []).filter(
          (e: any) => e && e._id && !seen.has(e._id) && seen.add(e._id)
        );
        const now = Date.now();
        const ongoing = events.filter((e) => {
          const start = new Date(e.startDate).getTime();
          const end = new Date(e.endDate).getTime();
          return start <= now && now <= end;
        });
        const upcoming = events
          .filter((e) => new Date(e.startDate).getTime() > now)
          .sort((a, b) => +new Date(a.startDate) - +new Date(b.startDate))
          .slice(0, 3);

        const all = [...ongoing, ...upcoming];
        if (!all.length) {
          setLiveEvents([]);
          setMyUpcoming([]);
          return;
        }

        // Registration counts (one batched call) + live-quiz lookup for ongoing events
        const [countsRes, ...quizResults] = await Promise.all([
          api.post("/registration/responses/counts/batch", { eventIds: all.map((e) => e._id) }).catch(() => null),
          ...ongoing.map((e) => api.get(`/quizzes/event/${e._id}`).catch(() => null)),
        ]);
        if (cancelled) return;

        const counts: Record<string, number> = countsRes?.data?.counts || {};
        const base = (e: any): LiveEventData => ({
          _id: e._id,
          title: e.title,
          slug: e.slug,
          description: e.description,
          bannerUrl: e.bannerUrl,
          startDate: e.startDate,
          endDate: e.endDate,
          venue: e.venue,
          eventType: e.eventType,
          participantCount: counts[e._id],
        });

        const live: LiveEventData[] = ongoing.map((e, i) => {
          const quizzes = quizResults[i]?.data?.quizzes || [];
          const active = quizzes.find((q: any) => q.status === "live");
          return { ...base(e), liveQuizId: active?._id };
        });
        // The event with a live quiz leads (greeting badge + leaderboard tie-in)
        live.sort((a, b) => Number(Boolean(b.liveQuizId)) - Number(Boolean(a.liveQuizId)));

        setLiveEvents(live);
        setMyUpcoming(upcoming.map(base));

        const firstLive = live.find((e) => e.liveQuizId);
        if (firstLive?.liveQuizId) {
          const idx = live.indexOf(firstLive);
          const quizzes = quizResults[idx]?.data?.quizzes || [];
          const active = quizzes.find((q: any) => q.status === "live");
          const quizId = firstLive.liveQuizId;
          setLiveQuiz({ quizId, title: active?.title, eventTitle: firstLive.title });

          // Real leaderboard of the live quiz (entries + my score + player count)
          api
            .get(`/quizzes/${quizId}/leaderboard`)
            .then((lb) => {
              if (cancelled) return;
              const total = Number(lb.data?.total) || 0;
              setLiveBoard({
                entries: lb.data?.entries || [],
                me: lb.data?.me || null,
                total,
              });
              setLiveEvents((prev) =>
                prev.map((ev) => (ev.liveQuizId === quizId ? { ...ev, quizPlayers: total } : ev))
              );
            })
            .catch(() => {});
        }
    })().catch(() => {
      // Registrations are a nice-to-have here; the feed itself still loads
    });

    return () => {
      cancelled = true;
    };
  }, [registered]);

  /* §7 cursor pagination + §39 request cancellation + §15 dedup.
   * Switching tabs changes the query key, which restarts pagination — the
   * manual `nextCursor` reset this replaced is now structural. */
  const feed = useInfiniteQuery<FeedPostData>(
    ["feed", tab],
    (cursor) => {
      const p = new URLSearchParams({ tab, limit: String(PAGE_SIZE) });
      if (cursor) p.set("cursor", cursor);
      return `/posts/feed?${p.toString()}`;
    },
    {
      // The feed speaks `{ posts, hasMore, nextCursor }`, not `{ items }`.
      mapPage: (raw) => ({
        items: (raw?.posts ?? []) as FeedPostData[],
        nextCursor: raw?.nextCursor ?? null,
        hasMore: Boolean(raw?.hasMore),
      }),
    }
  );

  const posts = useMemo(() => {
    const gone = new Set(removed);
    return [...created, ...feed.items.filter((p) => !gone.has(p._id))];
  }, [created, removed, feed.items]);

  const onCreated = (post: FeedPostData) => {
    setCreated((c) => [post, ...c]);
    window.scrollTo({ top: topOfFeed.current, behavior: "smooth" });
  };

  const onDeleted = (id: string) => setRemoved((r) => [...r, id]);

  // Real search — routes to event discovery with the query
  const submitHomeSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const q = homeQuery.trim();
    router.push(q ? `/explore?q=${encodeURIComponent(q)}` : "/explore");
  };

  // Live badge next to the greeting: first ongoing event + my real quiz score
  const leadLive = liveEvents[0];
  const liveBadge = leadLive
    ? {
        title: leadLive.title,
        href: leadLive.liveQuizId ? `/quiz/${leadLive.liveQuizId}` : `/events/${leadLive.slug}`,
        score: liveBoard?.me && leadLive.liveQuizId ? liveBoard.me.score : undefined,
      }
    : null;

  return (
    <div className="mx-auto flex w-full max-w-6xl justify-center gap-8 px-3 py-5 sm:px-6">
      {/* Main column */}
      <div className="w-full min-w-0 max-w-[620px]">
        {/* Welcome strip for logged-out visitors */}
        {ready && !user && (
          <div className="mb-5 flex flex-col gap-3 rounded-xl border border-border bg-gradient-to-br from-brand-light/80 to-purple-light/60 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="flex items-center gap-2 text-base font-bold text-foreground">
                <Sparkles className="h-4 w-4 text-primary" /> Welcome to EventHub
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Discover events, participate, and build your event journey — all in one place.
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button asChild size="sm">
                <Link href="/signup">Join EventHub</Link>
              </Button>
              <Button asChild size="sm" variant="outline">
                <Link href="/login">Sign in</Link>
              </Button>
            </div>
          </div>
        )}

        {/* Greeting with live badge (real event + real quiz score) */}
        <HomeGreeting firstName={user?.firstName} liveBadge={liveBadge} />

        {/* Quick search (phone layout; desktop search lives in the top bar) */}
        <form
          onSubmit={submitHomeSearch}
          className="mt-3 flex h-12 items-center rounded-xl bg-card px-3.5 shadow-[0_2px_12px_rgba(24,39,75,0.04)] transition-shadow focus-within:shadow-[0_4px_16px_rgba(37,99,255,0.15)] sm:hidden"
        >
          <span className="material-symbols-outlined mr-2.5 text-[20px] text-muted-foreground">search</span>
          <input
            value={homeQuery}
            onChange={(e) => setHomeQuery(e.target.value)}
            placeholder="Search events, people, hackathons..."
            aria-label="Search events"
            className="h-full w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
        </form>

        {/* The user's LIVE (ongoing) registered events come first */}
        {liveEvents.length > 0 && (
          <div className="mt-4">
            <LiveEventHero events={liveEvents} />
          </div>
        )}

        {/* Live leaderboard snapshot (phone; full widget in the desktop rail) */}
        {liveQuiz && liveBoard && liveBoard.entries.length > 0 && (
          <div className="mt-4 xl:hidden">
            <LivePulseStrip quizId={liveQuiz.quizId} entries={liveBoard.entries} />
          </div>
        )}

        <div className="mt-4">
          <StoryRail onYourStory={() => composerRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })} />
        </div>

        <div className="mt-4 space-y-5">
          {/* Tabs — pill style per reference */}
          <div className="no-scrollbar flex items-center gap-2 overflow-x-auto pb-1">
            {(
              [
                { id: "for-you", label: "For You" },
                { id: "following", label: "Following" },
              ] as const
            ).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                aria-pressed={tab === t.id}
                className={cn(
                  "shrink-0 rounded-full px-4 py-2 text-xs font-semibold transition-colors",
                  tab === t.id
                    ? "bg-gradient-to-r from-[#2563FF] to-[#6C35FF] text-white shadow-[0_4px_12px_rgba(37,99,255,0.25)]"
                    : "bg-card text-muted-foreground shadow-sm hover:text-foreground"
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          <CreatePost onCreated={onCreated} composerRef={composerRef} />

          {/* Feed */}
          {feed.isLoading ? (
            <div className="space-y-5">
              <PostSkeleton />
              <PostSkeleton />
            </div>
          ) : feed.error ? (
            <div className="rounded-xl border border-destructive/20 bg-destructive/5 px-6 py-12 text-center">
              <p className="text-base font-semibold text-foreground">Something went wrong</p>
              <p className="mt-1 text-sm text-muted-foreground">The feed couldn&apos;t load. Give it another try.</p>
              <Button size="sm" variant="outline" className="mt-4" onClick={() => feed.refetch()}>
                Retry
              </Button>
            </div>
          ) : posts.length === 0 ? (
            tab === "following" ? (
              <EmptyBlock
                icon={UserPlus}
                title="Not following anyone yet"
                body="Follow people you meet at events and their posts will show up here."
                action={
                  <Button asChild size="sm" variant="outline">
                    <Link href="/events">Explore events</Link>
                  </Button>
                }
              />
            ) : (
              <EmptyBlock
                icon={CalendarSearch}
                title="Your event story starts here"
                body="Be the first to post — share an update, a photo, or an event you're excited about."
                action={
                  <Button asChild size="sm">
                    <Link href="/events">Explore events</Link>
                  </Button>
                }
              />
            )
          ) : (
            <>
              {posts.map((p) => (
                <FeedPost key={p._id} post={p} onDeleted={onDeleted} />
              ))}
              {feed.hasMore && (
                <div className="pt-1 text-center">
                  <Button variant="outline" onClick={() => feed.fetchNextPage()} disabled={feed.isFetchingMore}>
                    {feed.isFetchingMore ? "Loading…" : "Load more posts"}
                  </Button>
                </div>
              )}
              {!feed.hasMore && (
                <p className="flex items-center justify-center gap-1.5 pt-2 pb-4 text-xs text-muted-foreground">
                  <Users className="h-3.5 w-3.5" /> You&apos;re all caught up
                </p>
              )}
            </>
          )}
        </div>
      </div>

      {/* Right sidebar (desktop) — upcoming, live leaderboard, builders to follow */}
      <RightRail
        user={user}
        registeredUpcoming={myUpcoming}
        liveQuiz={liveQuiz}
        entries={liveBoard?.entries || []}
        posts={posts}
      />
    </div>
  );
}

function EmptyBlock({
  icon: Icon,
  title,
  body,
  action,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/40 px-6 py-14 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-light text-primary">
        <Icon className="h-7 w-7" />
      </div>
      <h3 className="mt-4 text-base font-semibold text-foreground">{title}</h3>
      <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">{body}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
