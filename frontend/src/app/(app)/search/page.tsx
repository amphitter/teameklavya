"use client";

/**
 * Full search page — ?q= deep-linkable, trending-first.
 *
 * Part 14 §5–§8. Three things changed here and nothing else:
 *
 *   1. The screen no longer opens empty. `q < 2 chars` used to print "Type at
 *      least 2 characters" over a blank page — the single worst landing spot in
 *      the app, because Search is a bottom-nav tab a user taps with no query in
 *      mind. It now opens on TRENDING: a visual grid of real posts and real
 *      events (server-ranked, §41 — no invented content).
 *   2. The filter row is All / Events / People. Communities and Posts are gone
 *      as chips because the brief names the filters explicitly; they are not
 *      lost, they appear inside All, which is the union of everything the
 *      existing search endpoint returns.
 *   3. Results are a list of real rows; a POST opens the viewer sheet rather
 *      than navigating, so the query and scroll position survive.
 *
 * Nothing about /explore was touched: Explore is events discovery, Search is
 * people/events/content search, and §29 forbids merging them.
 */
import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { CalendarDays, Search, UserRoundSearch, Users } from "lucide-react";
import { api } from "@/utils/api";
import { EmptyState, ErrorState, Skeleton } from "@/components/states";
import { TrendingSection } from "@/components/search/trending-grid";
import { PostViewerSheet } from "@/components/search/post-viewer-sheet";
import { UserAvatar } from "@/components/user-avatar";
import { PersonRow } from "@/components/people/person-row";
import { FollowAuthorButton } from "@/components/feed/follow-author-button";
import { cn } from "@/lib/utils";

/* §8 — All / Events / People, in that order, three compact pills that fit a
   320px screen without scrolling. `all` is the server's own default group set
   (events + communities + people + posts), so All genuinely is everything the
   search endpoint can return rather than a third curated list. */
type Tab = "all" | "events" | "people";

const TABS: { id: Tab; label: string; icon: any }[] = [
  { id: "all", label: "All", icon: Search },
  { id: "events", label: "Events", icon: CalendarDays },
  { id: "people", label: "People", icon: UserRoundSearch },
];

interface EventR {
  _id: string;
  title: string;
  slug: string;
  description?: string;
  venue?: string;
  startDate?: string;
  category?: string;
  price?: number;
}
interface CommunityR {
  _id: string;
  name: string;
  slug: string;
  description?: string;
  avatarUrl?: string;
  category?: string;
}
interface PersonR {
  _id: string;
  firstName: string;
  lastName: string;
  username?: string;
  profile?: { avatar?: string; avatarVersion?: number; institution?: string; bio?: string };
  verified?: boolean;
  /** Part 13 §26 — mutual connections, computed server-side for signed-in users. */
  mutuals?: number;
}
interface PostR {
  _id: string;
  content: string;
  author?: { _id?: string; firstName: string; lastName: string; username?: string; profile?: any } | null;
  createdAt?: string;
}

export default function SearchPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-3xl px-3 py-10"><Skeleton className="h-24" /></div>}>
      <SearchView />
    </Suspense>
  );
}

function SearchView() {
  const params = useSearchParams();
  const router = useRouter();
  const q = (params.get("q") || "").trim();

  const [input, setInput] = useState(q);

  /* Part 13 §23/§28 — THE people-search bug.
   *
   * The tab used to live in component state only, seeded to "events". The URL
   * wrote `q` but ignored `tab`, so any link that pointed at a tab — the feed's
   * own "People you may know" discovery card links to `/search?tab=people` —
   * arrived on the EVENTS tab with the query dropped in a different place:
   * tapping "People you may know" showed "Type at least 2 characters" and
   * typing then searched events. On a phone that card is the main route to
   * finding people (the tab strip has to be scrolled horizontally to reach
   * People), which is why it read as "people search is broken on mobile".
   *
   * It was never CSS. The tab is now read from the URL and written back to it,
   * so the URL is the single source of truth and a deep link means what it says.
   */
  /* Communities/Posts are no longer tabs. An old link such as ?tab=posts still
     resolves — to All, which contains posts — instead of to an empty panel. */
  const urlTab = params.get("tab");
  const tab: Tab = urlTab && TABS.some((t) => t.id === urlTab) ? (urlTab as Tab) : "all";

  const [events, setEvents] = useState<EventR[]>([]);
  const [communities, setCommunities] = useState<CommunityR[]>([]);
  const [people, setPeople] = useState<PersonR[]>([]);
  const [posts, setPosts] = useState<PostR[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => setInput(q), [q]);

  /* §39 — debounce typing into the URL. Previously every submit did a full
   * document reload; now it is a soft navigation, and pausing for 350ms means
   * a 12-character query costs one request instead of twelve. */
  useEffect(() => {
    if (input === q) return;
    const t = setTimeout(() => {
      const next = input.trim();
      /* Build the new URL from the CURRENT params instead of writing a bare
         `/search?q=…`. The old line dropped every other parameter, so typing one
         character on the People tab silently threw the tab away and dropped the
         user back on Events — the same class of bug as the deep link that never
         selected a tab, one effect further down. Query and tab are one URL. */
      const sp = new URLSearchParams(params.toString());
      if (next) sp.set("q", next);
      else sp.delete("q");
      const qs = sp.toString();
      router.replace(qs ? `/search?${qs}` : "/search", { scroll: false });
    }, 350);
    return () => clearTimeout(t);
  }, [input, q, router, params]);

  /** Selecting a tab is a navigation: it updates the URL, which is what the
   *  panel above reads. One source of truth, and the link can be shared. */
  const selectTab = (next: Tab) => {
    const sp = new URLSearchParams(params.toString());
    if (next === "all") sp.delete("tab");
    else sp.set("tab", next);
    const qs = sp.toString();
    router.replace(qs ? `/search?${qs}` : "/search", { scroll: false });
  };

  const run = useCallback(() => {
    if (q.length < 2) {
      setEvents([]);
      setCommunities([]);
      setPeople([]);
      setPosts([]);
      return;
    }
    setLoading(true);
    setError(false);
    // §39 — abort the previous search when the query or tab changes so a slow
    // response can never overwrite a newer one.
    const controller = new AbortController();
    api
      .get("/search", { params: { q, type: tab }, signal: controller.signal })
      .then((r) => {
        setEvents(r.data?.events || []);
        setCommunities(r.data?.communities || []);
        setPeople(r.data?.people || []);
        setPosts(r.data?.posts || []);
      })
      .catch((e: any) => {
        if (e?.name === "CanceledError" || e?.code === "ERR_CANCELED") return;
        setError(true);
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [q, tab]);

  useEffect(() => run(), [run]);

  const counts: Record<Tab, number> = {
    all: events.length + communities.length + people.length + posts.length,
    events: events.length,
    people: people.length,
  };
  const emptyForTab = q.length >= 2 && !loading && !error && counts[tab] === 0;
  /* Results open in the same viewer sheet the Trending grid uses, so tapping a
     post does not throw the query away. The row carries only an id; the sheet
     hydrates the real post, which is why like/save state is correct here and
     not a guess from the search projection. */
  const [openPostId, setOpenPostId] = useState<string | null>(null);

  return (
    <div className="mx-auto w-full max-w-3xl px-3 py-5 sm:px-6 sm:py-7">
      <h1 className="flex items-center gap-2 text-xl font-extrabold tracking-tight text-foreground sm:text-2xl">
        <Search className="h-6 w-6 text-primary" /> Search
      </h1>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          const value = input.trim();
          router.push(value ? `/search?q=${encodeURIComponent(value)}` : "/search");
        }}
        className="mt-4"
      >
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Search people, events, posts…"
            aria-label="Search"
            className="h-11 w-full rounded-full border border-input bg-muted/60 pl-10 pr-4 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary/50 focus:bg-background focus:ring-4 focus:ring-primary/10"
          />
        </div>
      </form>

      <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => selectTab(t.id)}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-bold transition-colors",
              tab === t.id ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/70"
            )}
          >
            <t.icon className="h-3.5 w-3.5" /> {t.label}
          </button>
        ))}
      </div>

      <div className="mt-5 space-y-3">
        {q.length < 2 ? (
          tab === "people" ? (
            /* §5 says Search must never open on a blank page. The default tab
               is All (→ Trending), but if someone deliberately taps the People
               chip before typing, the useful answer is real accounts to look
               at, not an instruction to type. */
            <SuggestedPeople />
          ) : (
            <TrendingSection />
          )
        ) : error ? (
          <ErrorState title="Search failed" description="Give it another try." onRetry={run} />
        ) : loading ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16" />)
        ) : emptyForTab ? (
          <EmptyState
            icon={Search}
            title={tab === "all" ? `No results for “${q}”` : `No ${tab} found`}
            description={
              tab === "all"
                ? "Try different words, or browse what's trending for inspiration."
                : `Nothing matches “${q}”. Try another tab or different words.`
            }
          />
        ) : tab === "all" ? (
          /* All = every group the endpoint can return, each capped by the
             server, so the union never becomes an unbounded wall. */
          <>
            <ResultGroup label="Events" count={events.length}>
              {events.map((e) => (
                <EventRow key={e._id} event={e} />
              ))}
            </ResultGroup>
            <ResultGroup label="People" count={people.length}>
              {people.map((p) => (
                <PersonResultRow key={p._id} person={p} />
              ))}
            </ResultGroup>
            <ResultGroup label="Communities" count={communities.length}>
              {communities.map((c) => (
                <CommunityRow key={c._id} community={c} />
              ))}
            </ResultGroup>
            <ResultGroup label="Posts" count={posts.length}>
              {posts.map((p) => (
                <PostResultRow key={p._id} post={p} onOpen={() => setOpenPostId(p._id)} />
              ))}
            </ResultGroup>
          </>
        ) : (
          <>
            {tab === "events" && events.map((e) => <EventRow key={e._id} event={e} />)}
            {tab === "people" && people.map((p) => <PersonResultRow key={p._id} person={p} />)}
          </>
        )}
      </div>

      <PostViewerSheet postId={openPostId} onClose={() => setOpenPostId(null)} />

    </div>
  );
}


/* ── Result rows ─────────────────────────────────────────────────────────
 * The same rows Search already rendered, lifted into named components so the
 * All tab can compose them under headings without copy-pasting the markup four
 * times. Their appearance is unchanged. */

/** A heading + count, rendered only when the group actually has results. */
function ResultGroup({
  label,
  count,
  children,
}: {
  label: string;
  count: number;
  children: React.ReactNode;
}) {
  if (!count) return null;
  return (
    <section className="space-y-3 pt-1">
      <h2 className="px-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
        {label} <span className="font-semibold text-muted-foreground/70">{count}</span>
      </h2>
      {children}
    </section>
  );
}

function EventRow({ event: e }: { event: EventR }) {
  return (
    <Link
      href={`/events/${e.slug}`}
      className="flex items-start gap-3 rounded-2xl border border-border bg-card p-4 transition-colors hover:border-primary/40"
    >
      <span className="rounded-xl bg-brand-light p-2 text-primary">
        <CalendarDays className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-bold text-foreground">{e.title}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {[e.venue, e.category, e.startDate ? new Date(e.startDate).toLocaleDateString("en-IN") : null]
            .filter(Boolean)
            .join(" · ")}
        </span>
        {e.description ? (
          <span className="mt-1 block truncate text-xs text-muted-foreground">{e.description}</span>
        ) : null}
      </span>
    </Link>
  );
}

function CommunityRow({ community: c }: { community: CommunityR }) {
  return (
    <Link
      href={`/communities/${c.slug}`}
      className="flex items-start gap-3 rounded-2xl border border-border bg-card p-4 transition-colors hover:border-primary/40"
    >
      <span className="rounded-xl bg-purple-light p-2 text-purple">
        <Users className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-bold text-foreground">{c.name}</span>
        {c.description ? (
          <span className="mt-0.5 block line-clamp-2 text-xs text-muted-foreground">{c.description}</span>
        ) : null}
      </span>
    </Link>
  );
}

function PersonResultRow({ person: p }: { person: PersonR }) {
  return (
    /* The row is the link and the follow control sits outside it: on a phone,
       aiming at a name is easier than aiming at a pill, and tapping Follow must
       not navigate away. */
    <div className="flex items-center gap-1 rounded-2xl border border-border bg-card pl-3 pr-2 transition-colors hover:border-primary/40">
      <PersonRow person={p} href={`/profile/${p.username || p._id}`} className="flex-1 px-0" />
      <FollowAuthorButton userId={p._id} initialFollowing={false} withStatus />
    </div>
  );
}

function PostResultRow({ post: p, onOpen }: { post: PostR; onOpen: () => void }) {
  /* A post opens the viewer sheet rather than navigating to /post/:id — the
     §6 requirement that closing a post returns to the exact scroll position. */
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-start gap-3 rounded-2xl border border-border bg-card p-4 text-left transition-colors hover:border-primary/40"
    >
      <UserAvatar user={p.author} size={38} />
      <span className="min-w-0 flex-1">
        <span className="block text-sm text-foreground">{p.content}</span>
        <span className="mt-1 block text-xs text-muted-foreground">
          {p.author ? `${p.author.firstName} ${p.author.lastName}` : "Unknown"}
          {p.createdAt ? ` · ${new Date(p.createdAt).toLocaleDateString("en-IN")}` : ""}
        </span>
      </span>
    </button>
  );
}

/* ── People surface: who to look at before you type ─────────────────────
 * Uses the existing suggestion endpoint (the one the feed's right rail already
 * calls) rather than a second ranking. Rows are the same compact rows as the
 * search results, with the follow button reachable without opening a profile. */
function SuggestedPeople() {
  const [people, setPeople] = useState<PersonR[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .get("/users/suggested", { params: { limit: 12 } })
      .then((r) => {
        if (!cancelled) setPeople(r.data?.users || []);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <>
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-16" />
        ))}
      </>
    );
  }
  if (failed) {
    return <EmptyState icon={Users} title="Couldn't load people" description="Check your connection and try again." />;
  }
  if (!people.length) {
    return (
      <EmptyState
        icon={Users}
        title="No people found"
        description="Search for someone by name or username."
      />
    );
  }

  return (
    <>
      <p className="px-1 pt-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
        People you may know
      </p>
      {people.map((p) => (
        <div
          key={p._id}
          className="flex items-center gap-1 rounded-2xl border border-border bg-card pl-3 pr-2 transition-colors hover:border-primary/40"
        >
          <PersonRow person={p} href={`/profile/${p.username || p._id}`} className="flex-1 px-0" />
          <FollowAuthorButton userId={p._id} initialFollowing={false} withStatus />
        </div>
      ))}
    </>
  );
}
