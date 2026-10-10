"use client";

/**
 * Full search page — ?q= deep-linkable, trending-first.
 *
 * Part 14 §5–§8 baseline with the Phase 3 Organization-search extension:
 *
 *   1. The screen no longer opens empty. `q < 2 chars` used to print "Type at
 *      least 2 characters" over a blank page — the single worst landing spot in
 *      the app, because Search is a bottom-nav tab a user taps with no query in
 *      mind. It now opens on TRENDING: a visual grid of real posts and real
 *      events (server-ranked, §41 — no invented content).
 *   2. The filter row is All / Events / People / Organizations. Communities
 *      and Posts remain in All; Organizations also gets a focused global-search
 *      surface while the dedicated directory retains its richer filters.
 *   3. Results are a list of real rows; a POST opens the viewer sheet rather
 *      than navigating, so the query and scroll position survive.
 *   4. Organizations are searchable as a dedicated, cursor-paginated tab and
 *      are also included in All; the Organization directory keeps its richer filters.
 *
 * Nothing about /explore was touched: Explore is events discovery, Search is
 * people/events/content search, and §29 forbids merging them.
 */
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { BadgeCheck, Building2, CalendarDays, Search, UserRoundSearch, Users } from "lucide-react";
import { api } from "@/utils/api";
import { EmptyState, ErrorState, Skeleton } from "@/components/states";
import { TrendingSection } from "@/components/search/trending-grid";
import { PostViewerSheet } from "@/components/search/post-viewer-sheet";
import { UserAvatar } from "@/components/user-avatar";
import { PersonRow } from "@/components/people/person-row";
import { FollowAuthorButton } from "@/components/feed/follow-author-button";
import { cn } from "@/lib/utils";

/* Search tabs remain shareable URL state. All includes every entity; the
   dedicated Organizations tab complements the separately-filterable directory. */
type Tab = "all" | "events" | "people" | "organizations";

const TABS: { id: Tab; label: string; icon: any }[] = [
  { id: "all", label: "All", icon: Search },
  { id: "events", label: "Events", icon: CalendarDays },
  { id: "people", label: "People", icon: UserRoundSearch },
  { id: "organizations", label: "Organizations", icon: Building2 },
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
interface OrganizationR {
  _id: string;
  name: string;
  handle?: string;
  slug: string;
  category?: string;
  description?: string;
  logo?: string;
  city?: string;
  state?: string;
  country?: string;
  isVerified?: boolean;
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
  const [organizations, setOrganizations] = useState<OrganizationR[]>([]);
  const [organizationCursor, setOrganizationCursor] = useState<string | null>(null);
  const [organizationHasMore, setOrganizationHasMore] = useState(false);
  const [organizationMoreLoading, setOrganizationMoreLoading] = useState(false);
  const [organizationMoreError, setOrganizationMoreError] = useState(false);
  const searchVersion = useRef(0);
  const organizationMoreVersion = useRef(0);
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
    const version = ++searchVersion.current;
    organizationMoreVersion.current += 1;
    setOrganizationCursor(null);
    setOrganizationHasMore(false);
    setOrganizationMoreLoading(false);
    setOrganizationMoreError(false);
    if (q.length < 2) {
      setEvents([]);
      setCommunities([]);
      setOrganizations([]);
      setPeople([]);
      setPosts([]);
      setLoading(false);
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
        if (version !== searchVersion.current) return;
        setEvents(r.data?.events || []);
        setCommunities(r.data?.communities || []);
        setOrganizations(r.data?.organizations || []);
        setPeople(r.data?.people || []);
        setPosts(r.data?.posts || []);
        setOrganizationCursor(tab === "organizations" ? r.data?.nextCursor || null : null);
        setOrganizationHasMore(tab === "organizations" && Boolean(r.data?.hasMore));
      })
      .catch((e: any) => {
        if (version !== searchVersion.current || e?.name === "CanceledError" || e?.code === "ERR_CANCELED") return;
        setError(true);
      })
      .finally(() => {
        if (version === searchVersion.current) setLoading(false);
      });
    return () => {
      controller.abort();
      if (version === searchVersion.current) {
        searchVersion.current += 1;
        organizationMoreVersion.current += 1;
      }
    };
  }, [q, tab]);

  useEffect(() => run(), [run]);

  const loadMoreOrganizations = useCallback(async () => {
    if (!organizationCursor || !organizationHasMore || organizationMoreLoading || tab !== "organizations") return;
    const searchRequestVersion = searchVersion.current;
    const pageRequestVersion = ++organizationMoreVersion.current;
    setOrganizationMoreLoading(true);
    setOrganizationMoreError(false);
    try {
      const response = await api.get("/search", {
        params: { q, type: "organizations", limit: 20, cursor: organizationCursor },
      });
      if (searchRequestVersion !== searchVersion.current || pageRequestVersion !== organizationMoreVersion.current) return;
      const nextOrganizations: OrganizationR[] = response.data?.organizations || [];
      setOrganizations((current) => {
        const ids = new Set(current.map((organization) => organization._id));
        return [...current, ...nextOrganizations.filter((organization) => !ids.has(organization._id))];
      });
      setOrganizationCursor(response.data?.nextCursor || null);
      setOrganizationHasMore(Boolean(response.data?.hasMore));
    } catch {
      if (searchRequestVersion === searchVersion.current && pageRequestVersion === organizationMoreVersion.current) {
        setOrganizationMoreError(true);
      }
    } finally {
      if (searchRequestVersion === searchVersion.current && pageRequestVersion === organizationMoreVersion.current) {
        setOrganizationMoreLoading(false);
      }
    }
  }, [q, tab, organizationCursor, organizationHasMore, organizationMoreLoading]);

  const counts: Record<Tab, number> = {
    all: events.length + communities.length + organizations.length + people.length + posts.length,
    events: events.length,
    people: people.length,
    organizations: organizations.length,
  };
  const emptyForTab = q.length >= 2 && !loading && !error && counts[tab] === 0;
  /* Results open in the same viewer sheet the Trending grid uses, so tapping a
     post does not throw the query away. The row carries only an id; the sheet
     hydrates the real post, which is why like/save state is correct here and
     not a guess from the search projection. */
  const [openPostId, setOpenPostId] = useState<string | null>(null);

  return (
    <div className="min-h-screen bg-[#0a0a0c]">
      <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
        <h1 className="flex items-center gap-2 text-[20px] font-semibold tracking-tight text-white">
          <Search className="h-5 w-5 text-[#3b82f6]" /> Search
        </h1>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            const value = input.trim();
            const nextParams = new URLSearchParams(params.toString());
            if (value) nextParams.set("q", value);
            else nextParams.delete("q");
            const queryString = nextParams.toString();
            router.push(queryString ? `/search?${queryString}` : "/search");
          }}
          className="mt-4"
        >
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#71717a]" />
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Search people, events, organizations, posts…"
              aria-label="Search"
              className="h-11 w-full rounded-[12px] border border-[#232326] bg-[#121214] pl-10 pr-4 text-[13px] text-white placeholder:text-[#71717a] outline-none focus:border-[#3b82f6]/50"
            />
          </div>
        </form>

      <div className="mt-4 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => selectTab(t.id)}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[12px] font-medium transition-colors",
              tab === t.id ? "border-[#3b82f6] bg-[#3b82f6] text-white" : "border-[#232326] bg-[#121214] text-[#a1a1aa] hover:border-[#2a2a30] hover:text-white"
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
               is All (→ Trending), but if someone deliberately taps People
               before typing, show real suggested accounts instead. */
            <SuggestedPeople />
          ) : tab === "organizations" ? (
            <section className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
              <div className="flex items-start gap-3">
                <span className="rounded-xl bg-brand-light p-2 text-primary"><Building2 className="h-5 w-5" /></span>
                <div>
                  <h2 className="text-sm font-bold text-foreground">Search organizations</h2>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">Type at least two characters, or browse the directory and its filters.</p>
                </div>
              </div>
              <Link href="/organizations" className="inline-flex min-h-10 items-center justify-center rounded-full bg-primary px-4 text-xs font-bold text-primary-foreground">
                Browse organizations
              </Link>
            </section>
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
            <ResultGroup label="Organizations" count={organizations.length}>
              {organizations.map((organization) => (
                <OrganizationRow key={organization._id} organization={organization} />
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
            {tab === "organizations" && organizations.map((organization) => (
              <OrganizationRow key={organization._id} organization={organization} />
            ))}
          </>
        )}
      </div>

      {tab === "organizations" && (organizationHasMore || organizationMoreError) && (
        <div className="mt-4 flex flex-col items-center gap-2">
          {organizationMoreError && <p className="text-xs text-destructive" role="alert">Couldn't load the next organization page.</p>}
          <button
            type="button"
            onClick={loadMoreOrganizations}
            disabled={organizationMoreLoading || loading}
            className="min-h-11 rounded-full border border-border bg-card px-5 text-sm font-semibold text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
          >
            {organizationMoreLoading ? "Loading organizations…" : organizationMoreError ? "Retry" : "Load more organizations"}
          </button>
        </div>
      )}

      <PostViewerSheet postId={openPostId} onClose={() => setOpenPostId(null)} />
      </div>
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

function OrganizationRow({ organization }: { organization: OrganizationR }) {
  const location = [organization.city, organization.state, organization.country].filter(Boolean).join(", ");
  const category = organization.category?.toLowerCase().replaceAll("_", " ");
  const identifier = organization.handle || organization.slug;
  return (
    <Link
      href={`/organizations/${encodeURIComponent(identifier)}`}
      className="flex items-start gap-3 rounded-2xl border border-border bg-card p-4 transition-colors hover:border-primary/40"
    >
      <span className="rounded-xl bg-brand-light p-2 text-primary"><Building2 className="h-5 w-5" /></span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 truncate font-bold text-foreground">
          {organization.name}
          {organization.isVerified && <BadgeCheck className="h-4 w-4 shrink-0 text-success" />}
        </span>
        <span className="mt-0.5 block truncate text-xs capitalize text-muted-foreground">
          {[category, location].filter(Boolean).join(" · ")}
        </span>
        {organization.description ? <span className="mt-1 block truncate text-xs text-muted-foreground">{organization.description}</span> : null}
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
