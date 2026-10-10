"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { CalendarSearch, CheckCheck, Sparkles, UserPlus, Users } from "lucide-react";
import { api } from "@/utils/api";
import { Button } from "@/components/ui/button";
import { CreatePost } from "@/components/feed/create-post";
import { FeedPost } from "@/components/feed/feed-post";
import { PostSkeleton } from "@/components/feed/post-skeleton";
import { StoryRail } from "@/components/stories/story-rail";
import { useComposer } from "@/components/post/composer-provider";
import { StoryViewer } from "@/components/stories/story-viewer";
import { useStories, useStoryCategories, useMarkStoryViewed, type StoryGroup } from "@/hooks/use-social";
import { HomeGreeting } from "@/components/feed/home-greeting";
import { LiveEventHero } from "@/components/feed/live-event-hero";
import type { LiveEventData } from "@/components/feed/live-event-hero";
import { LivePulseStrip } from "@/components/feed/live-pulse-strip";
import { RightRail } from "@/components/feed/right-rail";
import { DiscoveryCard } from "@/components/feed/discovery-card";
import { useFeedDiscovery } from "@/components/feed/use-feed-discovery";
import { useSessionUser } from "@/components/shell/use-session-user";
import type { FeedPostData } from "@/components/feed/types";
import { cn } from "@/lib/utils";
import { useInfiniteQuery, useQuery } from "@/lib/query";
import { resolveFeedSections, needsBoundaryAboveHistory } from "@/lib/feed-sections";

type Tab = "for-you" | "following" | "events";
/** §6 — "Feed should remember the selected filter during navigation." */
const TAB_KEY = "eventhub.feed.tab";
const PAGE_SIZE = 10;
/* §22/§29 — the historical section pages in small batches too; it is a
   fallback, not a second full feed. */
const OLD_PAGE_SIZE = 10;

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
/**
 * The FRESH → OLD boundary (Part 16 §16, §23, §26).
 *
 * Lightweight by design: one strip, one line of copy, one heading. No card, no
 * illustration, no animation — it exists to make the change of nature of the
 * content below it unmistakable.
 */
function OldFeedBoundary() {
  return (
    <div className="pt-3" role="separator" aria-label="End of new posts">
      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-border" />
        <span className="flex items-center gap-1.5 rounded-full bg-muted px-3 py-1.5 text-xs font-semibold text-muted-foreground">
          <CheckCheck className="h-3.5 w-3.5" /> You&apos;re all caught up
        </span>
        <span className="h-px flex-1 bg-border" />
      </div>
      <p className="mt-2 text-center text-xs text-muted-foreground">
        New posts will appear at the top. Everything below is from your history.
      </p>
      <h2 className="mt-4 flex items-center gap-3 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        Old feed
        <span className="h-px flex-1 bg-border" />
      </h2>
    </div>
  );
}

export function FeedView() {
  const { user, ready } = useSessionUser();
  const { openStory } = useComposer();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("for-you");
  // Restore the last filter, and write it back on change.
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(TAB_KEY) as Tab | null;
      if (saved && ["for-you", "following", "events"].includes(saved)) setTab(saved);
    } catch { /* storage disabled — default is fine */ }
  }, []);
  const selectTab = (t: Tab) => {
    setTab(t);
    try { sessionStorage.setItem(TAB_KEY, t); } catch { /* ignore */ }
  };
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

  /* ── The rhythm ──────────────────────────────────────────────────────────
   *
   * Phase 4. Ten identical post cards in a column is what "static" looks like,
   * and every piece of real discovery content in this app was `hidden
   * xl:block` inside the desktop rail — invisible on every phone
   * (docs/PHASE4_FEED_AUDIT.md F1/F2).
   *
   * One card after every third post, cycling events → people → communities,
   * skipping any kind with no rows. `for-you` only: Following's contract is
   * "posts from people you follow, in order", and a suggestion in there would
   * be a lie about what that tab is.
   *
   * The list is built from `posts` AFTER the created/removed overlays, so
   * composing a post or archiving one shifts the cards with it instead of
   * leaving a stale gap.
   */
  const discovery = useFeedDiscovery();
  const stream = useMemo(() => {
    type Item =
      | { key: string; kind: "post"; post: FeedPostData }
      | { key: string; kind: "events" | "people" | "communities" };

    const items: Item[] = posts.map((p) => ({ key: `post-${p._id}`, kind: "post" as const, post: p }));
    if (tab !== "for-you") return items;

    const available = (["events", "people", "communities"] as const).filter((k) => discovery[k].length > 0);
    if (available.length === 0) return items;

    const out: Item[] = [];
    let sinceCard = 0;
    let cardIndex = 0;
    for (const item of items) {
      out.push(item);
      if (item.kind !== "post") continue;
      sinceCard += 1;
      /* Never on the last post of the list: a card that lands after the final
         card has nothing to break up and reads as a stray. */
      const isLast = item === items[items.length - 1];
      if (sinceCard >= 3 && !isLast && out.length > 3) {
        const kind = available[cardIndex % available.length];
        out.push({ key: `card-${kind}-${cardIndex}`, kind });
        cardIndex += 1;
        sinceCard = 0;
      }
    }
    return out;
  }, [posts, tab, discovery]);

  /* ── OLD FEED (Part 16 §15–§33) ─────────────────────────────────────────
   * Two rules decide this block, and both are structural rather than cosmetic:
   *
   *  1. it exists ONLY once the fresh stream is spent (`enabled` below), so old
   *     content can never be interleaved with new content (§18), and
   *  2. it is a SEPARATE query mode (`mode=old`) — the fresh query keeps its
   *     exclusions untouched (§33), so this cannot degrade the ranking by
   *     simply letting seen posts back in.
   *
   * The server decides what "old" means (seen or liked, minus dismissed, minus
   * anything the viewer may no longer see) and paginates it with a cursor.
   */
  /* Where the fresh stream stops being new, and whether "old" needs to be
     fetched at all. `boundaryIndex` is the first card the server demoted; if
     every card is still new, the boundary only exists once the stream is
     exhausted (and then it is drawn after the last card). */
  const boundaryIndex = useMemo(() => {
    if (tab !== "for-you") return -1;
    return stream.findIndex((item) => item.kind === "post" && (item.post as FeedPostData & { seenByMe?: boolean }).seenByMe);
  }, [stream, tab]);
  const freshExhausted = !feed.isLoading && !feed.error && !feed.hasMore;
  /* ── WHEN HISTORY LOADS (Part 16 §B, updated) ───────────────────────────
   * History used to need a demoted card to draw its boundary at
   * (`boundaryIndex >= 0`). That silently locked it out of the case it is most
   * needed in: a pool with nothing new left. Everything seen or liked, nothing
   * fresh to rank — `boundaryIndex` stayed -1, the query never ran, and the
   * viewer got the onboarding panel with their own history unreachable.
   *
   * Now the gate is "the fresh stream is spent AND (there is a boundary to draw
   * OR there is nothing fresh at all)". Both roads lead to the same place:
   * seen and liked posts stay out of the fresh query (they always did — this
   * changes WHEN `mode=old` is asked for, never what `mode=fresh` returns). */
  const freshEmpty = posts.length === 0;
  const oldEnabled = tab === "for-you" && freshExhausted && (boundaryIndex >= 0 || freshEmpty);
  const oldFeed = useInfiniteQuery<FeedPostData>(
    ["feed", "old"],
    (cursor) => {
      const p = new URLSearchParams({ mode: "old", limit: String(OLD_PAGE_SIZE) });
      if (cursor) p.set("cursor", cursor);
      return `/posts/feed?${p.toString()}`;
    },
    {
      enabled: oldEnabled,
      mapPage: (raw) => ({
        items: (raw?.posts ?? []) as FeedPostData[],
        nextCursor: raw?.nextCursor ?? null,
        hasMore: Boolean(raw?.hasMore),
      }),
    }
  );
  const oldPosts = useMemo(() => {
    const gone = new Set(removed);
    return oldFeed.items.filter((p) => !gone.has(p._id));
  }, [oldFeed.items, removed]);

  /* The boundary is drawn INSIDE the stream, at the first demoted card: the
     demoted cards below it *are* the old feed, so nothing is listed twice.
     `mode=old` only adds history older than the current pool (§22), and it is
     filtered against everything already on screen for the same reason.
     It waits for `freshExhausted` because its own words are "you're all caught
     up" — showing that while pages are still loading would be a lie. */
  const boundaryAt = useMemo(
    () => (tab === "for-you" && freshExhausted ? boundaryIndex : -1),
    [tab, freshExhausted, boundaryIndex]
  );
  const extraOldPosts = useMemo(() => {
    const shown = new Set(stream.filter((i) => i.kind === "post").map((i) => (i as { post: FeedPostData }).post._id));
    return oldPosts.filter((p) => !shown.has(p._id));
  }, [oldPosts, stream]);

  /* Which of the feed's five states we are in — one decision, in lib/feed-sections,
     so the render below is a switch rather than a chain of negations. */
  const section = resolveFeedSections({
    freshLoading: feed.isLoading,
    freshError: Boolean(feed.error),
    freshCount: posts.length,
    historyEnabled: oldEnabled,
    historyLoading: oldFeed.isLoading,
    historyCount: extraOldPosts.length,
  });
  /* In the history-only view there is no demoted card to hang the boundary on,
     so it is drawn above the section instead. */
  const boundaryAboveHistory = needsBoundaryAboveHistory({
    section,
    boundaryIndex,
    historyCount: extraOldPosts.length,
  });

  const onCreated = (post: FeedPostData) => {
    setCreated((c) => [post, ...c]);
    window.scrollTo({ top: topOfFeed.current, behavior: "smooth" });
  };

  const onDeleted = (id: string) => setRemoved((r) => [...r, id]);
  /* §24 — a dismissed post leaves the list at once, exactly like a deleted one.
     The server has already recorded the dismissal, so it also stays gone after a
     refresh; this line is only about not making the user look at it for the
     round-trip. Same for pages already fetched further down the cursor. */
  const onDismissed = (id: string) => setRemoved((r) => [...r, id]);

  /* Archiving removes a post from every public list — including the one it was
     archived from. The server stops returning it on the next fetch, but the
     card is already rendered, so it has to leave now; otherwise the toast
     ("only you can see it") is contradicted by the post still sitting in the
     feed. The same overlay that hides a deleted post hides an archived one,
     and restoring (or Undo) puts it back without a refetch. */
  const onArchived = (id: string, archived: boolean) =>
    setRemoved((r) => (archived ? (r.includes(id) ? r : [...r, id]) : r.filter((x) => x !== id)));

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
    <>
      {/* The feed's phone-only top bar is mounted one level up, in the route
          itself (`app/(app)/page.tsx`), so it is a direct child of the shell's
          content column and sticks to the viewport edge instead of inheriting
          this container's padding. Mounting it in both places put two bars and
          two bells on the screen, which is exactly the kind of duplicate chrome
          §60 warns about. */}

      <div className="mx-auto flex w-full max-w-6xl justify-center gap-6 px-3 py-4 sm:px-6 sm:py-5 xl:gap-8">
        {/* Main column */}
        <div className="w-full min-w-0 max-w-[620px] lg:min-w-[440px]">
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

          {/* Greeting with live badge (real event + real quiz score).
              §9 — REMOVED FROM PHONES. On a 390px screen the greeting, the
              search field and the filter chips filled the entire first
              screenful before a single post appeared, and the brief is explicit
              that the feed should start with content. It stays on desktop,
              where there is room for it and no separate bar duplicating it. */}
          <div className="hidden lg:block">
            <HomeGreeting firstName={user?.firstName} liveBadge={liveBadge} />
          </div>

          {/* §9 — the phone search field is gone. Search is a destination now
              (bottom nav → /search, which opens on real trending content), so a
              second input here was both a duplicate entry point and the largest
              block of chrome above the first post. Desktop keeps its own search
              in the top bar; this form is hidden from lg up either way. */}
          <form
            onSubmit={submitHomeSearch}
            className="mt-3 hidden h-12 items-center rounded-xl bg-card px-3.5 shadow-[0_2px_12px_rgba(24,39,75,0.04)] transition-shadow focus-within:shadow-[0_4px_16px_rgba(37,99,255,0.15)]"
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

          {/* §15 — real stories: people you follow + category rings. The rail
              collapses itself when there is nothing to show, so an empty state
              never renders as a bare top edge. */}
          <StoryRailSection
            canCreate={Boolean(user)}
            /* §15 — the ring opens the same creator as the "+" menu: ONE
               editor, reachable from the rail and from anywhere else. */
            onCompose={openStory}
            autoOpenComposer={searchParams.get("story") === "1"}
          />

          <div className="mt-4 space-y-5">
            {/* Tabs — pill style per reference.

                P0 fix. These were `py-2 text-[13px]`: roughly 36px tall, under
                the 44px minimum (§30/§44), which is why the filter read as
                "fails to open on some phones" — the tap landed on the gap
                between pills rather than the pill.

                §29 asks for a real audit rather than a z-index bump, so:
                  · no z-index is touched. Nothing overlaps this row: the header
                    is sticky at z-30 but sits above it in normal flow.
                  · the scroller keeps overflow-x-auto and gains
                    overscroll-x-contain, so a horizontal flick no longer
                    fights the page or triggers browser back-swipe.
                  · touch-action:manipulation removes the 300ms delay and
                    double-tap-zoom suppression that swallow fast taps.
                  · the row is a group with role=tablist semantics via
                    aria-pressed, already present. */}
            {/* The strip WRAPS instead of scrolling.
                It used to be `overflow-x-auto` with the scrollbar hidden, which
                meant "Communities" — the fourth tab — was cut off mid-word with no
                affordance that anything was there: measured 80px outside the
                viewport at 360 and still clipped at 390. A hidden scrollbar on a
                four-item control is not a scroll area, it is a missing button.
                On a phone the four tabs sit in a 2x2 grid — equal cells, no ragged
              half-row — and from sm up they are the single flex line they always
              were. Nothing is clipped at any width. */}
            {/* Feed tabs — reference-matched: dark charcoal, electric blue active, moderate radii */}
            <div
              role="tablist"
              aria-label="Feed filters"
              className="flex flex-wrap gap-2"
            >
              {(
                [
                  { id: "for-you", label: "For You" },
                  { id: "following", label: "Following" },
                  { id: "events", label: "Events" },
                ] as const
              ).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.id}
                  onClick={() => selectTab(t.id)}
                  className={
                    tab === t.id
                      ? "inline-flex h-9 items-center justify-center rounded-full bg-[#3b82f6] px-5 text-[13px] font-medium text-white shadow-[0_2px_8px_rgba(59,130,246,0.3)] transition-all dark:shadow-[0_0_20px_rgba(59,130,246,0.15)]"
                      : "inline-flex h-9 items-center justify-center rounded-full border border-border bg-card px-5 text-[13px] font-medium text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground dark:border-[#232326] dark:bg-[#121214] dark:text-[#a1a1aa] dark:hover:border-[#2a2a30] dark:hover:text-white"
                  }
                >
                  {t.label}
                </button>
              ))}
            </div>

            <CreatePost
              onCreated={onCreated}
              composerRef={composerRef}
              /* Exactly one welcome card on a signed-out screen. */
              showGuestCard={!(ready && !user)}
            />

            {/* Feed */}
            {section === "fresh-loading" || section === "history-loading" ? (
              /* Same skeletons for both: the second one is the moment a viewer
                 with a full history would otherwise be told, wrongly, that
                 their feed is empty. */
              <div className="space-y-5">
                <PostSkeleton />
                <PostSkeleton />
              </div>
            ) : section === "fresh-error" ? (
              <div className="rounded-xl border border-destructive/20 bg-destructive/5 px-6 py-12 text-center">
                <p className="text-base font-semibold text-foreground">Something went wrong</p>
                <p className="mt-1 text-sm text-muted-foreground">The feed couldn&apos;t load. Give it another try.</p>
                <Button size="sm" variant="outline" className="mt-4" onClick={() => feed.refetch()}>
                  Retry
                </Button>
              </div>
            ) : section === "empty" ? (
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
                {stream.map((item, i) => (
                  <Fragment key={item.key}>
                    {boundaryAt === i ? <OldFeedBoundary /> : null}
                    {item.kind === "post" ? (
                      <FeedPost
                        post={item.post}
                        onDeleted={onDeleted}
                        onArchived={onArchived}
                        onDismissed={onDismissed}
                      />
                    ) : (
                      <DiscoveryCard
                        kind={item.kind}
                        events={discovery.events}
                        people={discovery.people}
                        communities={discovery.communities}
                      />
                    )}
                  </Fragment>
                ))}
                {feed.hasMore && (
                  <div className="pt-1 text-center">
                    <Button variant="outline" onClick={() => feed.fetchNextPage()} disabled={feed.isFetchingMore}>
                      {feed.isFetchingMore ? "Loading…" : "Load more posts"}
                    </Button>
                  </div>
                )}
                {!feed.hasMore && !oldEnabled && (
                  <p className="flex items-center justify-center gap-1.5 pt-2 pb-4 text-xs text-muted-foreground">
                    <Users className="h-3.5 w-3.5" /> You&apos;re all caught up
                  </p>
                )}

                {/* ── The fetched history, when there is any (Part 16 §22) ──
                    Only reachable once the fresh stream is exhausted; the
                    cards the demotion already put on screen are filtered out
                    above, so this can never repeat the feed.

                    When the stream above is EMPTY, this is the whole feed, so
                    the fresh → old boundary is drawn here: the viewer is
                    looking at their history, and the strip says so. It is the
                    same strip, in the same words — §89 keeps the title no
                    heavier than the feed it introduces. */}
                {boundaryAboveHistory ? <OldFeedBoundary /> : null}
                {oldEnabled && extraOldPosts.length > 0 && (
                  <section aria-label="More from your history" className="pt-3">
                    {/* No second heading and no second strip: this is the same
                        section continuing older than the pool the ranking held,
                        and repeating the sign would read as a new section. */}
                    {extraOldPosts.map((post) => (
                      <div key={`old-more-${post._id}`} className="pt-4">
                        <FeedPost post={post} onDeleted={onDeleted} onArchived={onArchived} onDismissed={onDismissed} />
                      </div>
                    ))}
                    {oldFeed.hasMore ? (
                      <div className="pt-1 text-center">
                        <Button variant="outline" onClick={() => oldFeed.fetchNextPage()} disabled={oldFeed.isFetchingMore}>
                          {oldFeed.isFetchingMore ? "Loading…" : "Load more from Old feed"}
                        </Button>
                      </div>
                    ) : (
                      <p className="pt-3 pb-4 text-center text-xs text-muted-foreground">
                        That&apos;s everything you&apos;ve seen so far.
                      </p>
                    )}
                  </section>
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
    </>
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


/**
 * Story rail + composer + viewer, self-contained.
 *
 * State lives here rather than in FeedView so a story interaction never
 * re-renders the feed (§7: do not reload the feed for an unrelated action)
 * and so the feed component does not grow a fourth concern.
 */
function StoryRailSection({
  canCreate,
  onCompose,
  autoOpenComposer,
}: {
  canCreate: boolean;
  onCompose: () => void;
  /** §41 — the Create menu routes here with /?story=1. */
  autoOpenComposer?: boolean;
}) {
  const { groups, categories, isLoading, refetch } = useStoriesSafe();
  const markViewed = useMarkStoryViewed();
  /* `?story=1` is still honoured — it is a real deep link, used by links and by
     browser history — but it opens the shared creator instead of a second,
     feed-only implementation. */
  useEffect(() => {
    if (autoOpenComposer && canCreate) onCompose();
  }, [autoOpenComposer, canCreate, onCompose]);
  const [openGroup, setOpenGroup] = useState<number | null>(null);
  const [startIndex, setStartIndex] = useState(0);
  const [categoryStories, setCategoryStories] = useState<StoryGroup[]>([]);
  const [categoryLabel, setCategoryLabel] = useState("");
  const [categoryView, setCategoryView] = useState<number | null>(null);

  const openCategory = async (key: string, label: string) => {
    try {
      const r = await api.get(`/stories/category/${encodeURIComponent(key)}`);
      const list = (r.data?.stories || []) as any[];
      if (!list.length) return;
      setCategoryStories([{ author: list[0].author || { _id: "category" }, stories: list, isMe: false, hasUnseen: true }]);
      setCategoryLabel(label);
      setCategoryView(0);
    } catch {
      /* a failed rail tap must not take the feed down */
    }
  };

  const activeGroups = categoryView !== null ? categoryStories : groups;
  const myGroupIndex = groups.findIndex((g) => g.isMe && g.stories.length > 0);

  return (
    <>
      <div className="mt-4">
        <StoryRail
          groups={groups}
          categories={categories}
          loading={isLoading}
          canCreate={canCreate}
          onYourStory={onCompose}
          /* §23/§45 — with an active story the ring opens the viewer on it, so
             "Your story" means the same thing it means for everyone else. */
          hasStory={myGroupIndex >= 0}
          onViewYourStory={() => {
            setStartIndex(0);
            setOpenGroup(myGroupIndex);
          }}
          onOpenGroup={(i) => {
            setStartIndex(0);
            setOpenGroup(i);
          }}
          onOpenCategory={(key) => {
            const c = categories.find((x) => x.key === key);
            openCategory(key, c?.label || key);
          }}
        />
      </div>

      {openGroup !== null && groups[openGroup] ? (
        <StoryViewer
          stories={groups[openGroup].stories}
          author={groups[openGroup].author}
          startIndex={startIndex}
          canDelete={groups[openGroup].isMe}
          onClose={() => setOpenGroup(null)}
          onViewed={(id) => markViewed.mutate(id)}
          onDelete={async (id) => {
            const r = await api.delete(`/stories/${id}`);
            if (r.data?.success) {
              setOpenGroup(null);
              refetch();
            }
          }}
        />
      ) : null}

      {categoryView !== null && activeGroups[0] ? (
        <StoryViewer
          stories={activeGroups[0].stories}
          startIndex={startIndex}
          contextLabel={categoryLabel}
          onClose={() => {
            setCategoryView(null);
            setCategoryStories([]);
          }}
          onViewed={(id) => markViewed.mutate(id)}
        />
      ) : null}
    </>
  );
}

/** Stories are optional infra: a failure must degrade to "no stories",
 *  never to a feed that cannot render. */
function useStoriesSafe() {
  const stories = useStories();
  const cats = useStoryCategories();
  return {
    groups: stories.error ? [] : stories.groups,
    categories: cats.error ? [] : cats.categories,
    isLoading: stories.isLoading,
    refetch: stories.refetch,
  };
}
