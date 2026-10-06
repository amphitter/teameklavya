"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { CalendarSearch, Compass, Radio, Search, TrendingUp, X } from "lucide-react";
import { EventCard, type EventCardData } from "@/components/event-card";
import { EmptyState, ErrorState, EventCardSkeleton } from "@/components/states";
import { fetchEventsWithCounts } from "@/lib/events";
import { FeedPost } from "@/components/feed/feed-post";
import type { FeedPostData } from "@/components/feed/types";
import { api } from "@/utils/api";
import { useSessionUser } from "@/components/shell/use-session-user";
import { cloudinaryUrl } from "@/utils/image";
import { cn } from "@/lib/utils";

/**
 * Explore — dedicated event discovery experience.
 * Tabs and filters only activate what the backend really supports
 * (For You = soonest upcoming · Trending = real registration counts ·
 * Live Now = actually ongoing). URL-synced, shareable.
 */

type Tab = "for-you" | "trending" | "live";
type Format = "all" | "online" | "offline" | "hybrid";
type Price = "any" | "free" | "paid";

const DEFAULT_CATEGORIES = [
  "Hackathons",
  "Coding",
  "Quizzes",
  "Workshops",
  "Conferences",
  "Meetups",
  "Cultural",
  "Sports",
  "Career",
];

const TABS: { id: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "for-you", label: "For you", icon: Compass },
  { id: "trending", label: "Trending", icon: TrendingUp },
  { id: "live", label: "Live now", icon: Radio },
];

const FORMATS: { value: Format; label: string }[] = [
  { value: "all", label: "Any format" },
  { value: "online", label: "Online" },
  { value: "offline", label: "In person" },
  { value: "hybrid", label: "Hybrid" },
];

const PRICES: { value: Price; label: string }[] = [
  { value: "any", label: "Any price" },
  { value: "free", label: "Free" },
  { value: "paid", label: "Paid" },
];

const PAGE_SIZE = 12;

export function ExploreView() {
  const router = useRouter();
  const params = useSearchParams();
  const { user } = useSessionUser();

  const q = params.get("q") || "";
  // #topic deep link (/explore?topic=hackathon) — shows related posts + events
  const topic = (params.get("topic") || "").toLowerCase();
  const tab: Tab = params.get("tab") === "trending" || params.get("tab") === "live" ? (params.get("tab") as Tab) : "for-you";
  const category = params.get("category") || "";
  const format: Format = (["all", "online", "offline", "hybrid"] as const).includes(params.get("format") as Format)
    ? (params.get("format") as Format)
    : "all";
  const price: Price = params.get("price") === "free" || params.get("price") === "paid" ? (params.get("price") as Price) : "any";

  const [searchText, setSearchText] = useState(q);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => setSearchText(q), [q]);

  const [events, setEvents] = useState<EventCardData[]>([]);
  const [topicPosts, setTopicPosts] = useState<FeedPostData[]>([]);
  const [topicLoading, setTopicLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);
  const [categories, setCategories] = useState<string[]>(DEFAULT_CATEGORIES);

  // Category list from the backend (merged with defaults)
  useEffect(() => {
    api
      .get("/events/meta/categories")
      .then((res) => {
        const cats: string[] = res.data?.categories || [];
        if (cats.length) setCategories(Array.from(new Set([...cats, ...DEFAULT_CATEGORIES])).slice(0, 12));
      })
      .catch(() => {});
  }, []);

  const setParam = useCallback(
    (updates: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString());
      Object.entries(updates).forEach(([k, v]) => {
        if (v === null || v === "" || v === "all" || v === "any" || (k === "tab" && v === "for-you")) next.delete(k);
        else next.set(k, v);
      });
      router.replace(`/explore${next.toString() ? `?${next}` : ""}`, { scroll: false });
    },
    [params, router]
  );

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setParam({ q: searchText.trim() || null });
  };

  // Fetch on any filter change
  const queryKey = `${tab}|${q}|${topic}|${category}|${format}|${price}`;
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);

    const baseParams: Record<string, string | number | undefined> = {
      limit: tab === "trending" ? 24 : PAGE_SIZE,
      eventType: format,
      price: price === "any" ? undefined : price,
      category: category || undefined,
      // A topic deep-link also narrows the event list to matches
      q: topic || q || undefined,
      type: tab === "live" ? "ongoing" : "upcoming",
    };

    const personalized =
      tab === "for-you" && user && !q && !topic && !category && format === "all" && price === "any";
    if (personalized) {
      // Deterministic for-you (§61): followed orgs + my registrations' orgs + interests
      api
        .get("/events/for-you", { params: { limit: PAGE_SIZE } })
        .then((res) => {
          if (cancelled) return;
          const out = res.data?.events || [];
          setEvents(out);
          setTotal(out.length);
        })
        .catch(() => !cancelled && setError(true))
        .finally(() => !cancelled && setLoading(false));
    } else if (tab === "trending") {
      // Server-ranked trending (§34): 2× registrations + recent post engagement
      api
        .get("/events/trending", { params: { limit: PAGE_SIZE } })
        .then((res) => {
          if (cancelled) return;
          const out = res.data?.events || [];
          setEvents(out);
          setTotal(out.length);
        })
        .catch(() => !cancelled && setError(true))
        .finally(() => !cancelled && setLoading(false));
    } else {
      fetchEventsWithCounts(baseParams)
        .then(({ events: list, pagination }) => {
          if (cancelled) return;
          setEvents(list);
          setTotal(pagination?.total ?? list.length);
        })
        .catch(() => !cancelled && setError(true))
        .finally(() => !cancelled && setLoading(false));
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryKey, user?._id]);

  // Topic deep-link: real posts tagged with this topic
  useEffect(() => {
    if (!topic) {
      setTopicPosts([]);
      return;
    }
    let cancelled = false;
    setTopicLoading(true);
    api
      .get(`/posts/topics/${encodeURIComponent(topic)}`, { params: { limit: 10 } })
      .then((res) => {
        if (!cancelled) setTopicPosts(res.data?.posts || []);
      })
      .catch(() => {})
      .finally(() => !cancelled && setTopicLoading(false));
    return () => {
      cancelled = true;
    };
  }, [topic]);

  const removeTopicPost = (id: string) => setTopicPosts((p) => p.filter((x) => x._id !== id));

  const loadMore = () => {
    setLoadingMore(true);
    fetchEventsWithCounts({
      limit: PAGE_SIZE,
      page: Math.ceil(events.length / PAGE_SIZE) + 1,
      eventType: format,
      price: price === "any" ? undefined : price,
      category: category || undefined,
      q: q || undefined,
      type: tab === "live" ? "ongoing" : "upcoming",
    })
      .then(({ events: list }) => setEvents((p) => [...p, ...list]))
      .catch(() => {})
      .finally(() => setLoadingMore(false));
  };

  const activeFilters = Boolean(q || category || format !== "all" || price !== "any");
  const clearFilters = () => router.replace("/explore", { scroll: false });

  return (
    <div className="mx-auto w-full max-w-6xl px-3 py-5 sm:px-6 sm:py-7">
      {/* ── Search header ─────────────────────────────── */}
      <h1 className="text-2xl font-bold tracking-tight text-foreground">Explore</h1>
      <p className="mt-0.5 text-sm text-muted-foreground">Find your next event — hackathons, workshops, meetups and more.</p>

      <form onSubmit={submitSearch} className="relative mt-4">
        <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
        <input
          ref={inputRef}
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          placeholder="Search events, tags, or locations..."
          aria-label="Search events"
          className="h-12 w-full rounded-full border border-input bg-card pl-12 pr-11 text-[15px] text-foreground shadow-sm outline-none transition-all placeholder:text-muted-foreground focus:border-primary/50 focus:ring-4 focus:ring-primary/10"
        />
        {searchText && (
          <button
            type="button"
            onClick={() => {
              setSearchText("");
              setParam({ q: null });
              inputRef.current?.focus();
            }}
            aria-label="Clear search"
            className="absolute right-3.5 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </form>

      {/* ── Category chips ────────────────────────────── */}
      <div className="no-scrollbar -mx-1 mt-4 flex gap-2 overflow-x-auto px-1 pb-1">
        <Chip active={!category} onClick={() => setParam({ category: null })}>
          All
        </Chip>
        {categories.map((c) => (
          <Chip key={c} active={category === c} onClick={() => setParam({ category: category === c ? null : c })}>
            {c}
          </Chip>
        ))}
      </div>

      {/* ── Tabs + filters ────────────────────────────── */}
      <div className="mt-4 flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-1.5 rounded-full border border-border bg-card p-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setParam({ tab: t.id })}
              aria-pressed={tab === t.id}
              className={cn(
                "flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors sm:text-sm",
                tab === t.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <t.icon className="h-3.5 w-3.5" />
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex gap-2">
          <SelectPill options={FORMATS} value={format} onChange={(v) => setParam({ format: v })} />
          <SelectPill options={PRICES} value={price} onChange={(v) => setParam({ price: v })} />
          {activeFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground"
            >
              <X className="h-3 w-3" /> Clear
            </button>
          )}
        </div>
      </div>

      {/* ── Topic deep-link (#hashtag) ───────────────── */}
      {topic && (
        <section className="mt-6 rounded-xl border border-border bg-card p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-lg font-extrabold tracking-tight text-foreground">
                <span className="text-primary">#{topic}</span>
              </h2>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Posts tagged #{topic} — plus matching events below.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setParam({ topic: null })}
              className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground"
            >
              Clear topic
            </button>
          </div>

          <div className="mt-4 space-y-4">
            {topicLoading ? (
              <p className="py-4 text-center text-sm text-muted-foreground">Loading posts…</p>
            ) : topicPosts.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                No posts tagged #{topic} yet — be the first to use it.
              </p>
            ) : (
              topicPosts.map((p) => <FeedPost key={p._id} post={p} onDeleted={removeTopicPost} />)
            )}
          </div>
        </section>
      )}

      {/* ── Results ───────────────────────────────────── */}
      <div className="mt-6">
        {q && (
          <p className="mb-4 text-sm text-muted-foreground">
            {loading ? "Searching…" : <><span className="font-semibold text-foreground">{total}</span> event{total === 1 ? "" : "s"} for <span className="font-semibold text-foreground">“{q}”</span></>}
          </p>
        )}

        {loading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <EventCardSkeleton key={i} />
            ))}
          </div>
        ) : error ? (
          <ErrorState description="Events couldn't load right now." onRetry={() => setParam({})} />
        ) : events.length === 0 ? (
          tab === "live" ? (
            <EmptyState
              icon={Radio}
              title="Nothing live right now"
              description="Events that are happening at this exact moment appear here. Check For you for what's coming up."
              actionLabel="Browse upcoming"
              onAction={() => setParam({ tab: "for-you" })}
            />
          ) : activeFilters ? (
            <EmptyState
              title="Nothing here yet"
              description="No events match these filters. Try clearing them or explore a different category."
              actionLabel="Clear filters"
              onAction={clearFilters}
            />
          ) : (
            <EmptyState
              icon={CalendarSearch}
              title="No events yet"
              description="When organizers publish events, they'll appear here. Check back soon!"
            />
          )
        ) : (
          <>
            {/* Desktop/tablet: large cards */}
            <div className="hidden gap-4 sm:grid sm:grid-cols-2 lg:grid-cols-3">
              {events.map((e) => (
                <EventCard key={e._id} event={e} />
              ))}
            </div>

            {/* Mobile: compact list cards */}
            <div className="space-y-3 sm:hidden">
              {events.map((e) => (
                <CompactEventRow key={e._id} event={e} />
              ))}
            </div>

            {events.length < total && (
              <div className="mt-7 text-center">
                <button
                  type="button"
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="rounded-full border border-border bg-card px-6 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-muted disabled:opacity-60"
                >
                  {loadingMore ? "Loading…" : "Load more"}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* ── Compact mobile card ─────────────────────────────────── */
function CompactEventRow({ event }: { event: EventCardData }) {
  const live = event.status === "ongoing";
  return (
    <Link
      href={`/events/${event.slug}`}
      className="flex gap-3 rounded-xl border border-border bg-card p-2.5 transition-colors hover:border-primary/40"
    >
      <div className="relative h-[86px] w-[86px] shrink-0 overflow-hidden rounded-lg bg-muted">
        {event.bannerUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={cloudinaryUrl(event.bannerUrl, { w: 180, h: 180 })} alt="" className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-brand-light text-primary">
            <CalendarSearch className="h-6 w-6" />
          </div>
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-1.5">
          {live && (
            <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-1.5 py-0.5 text-[10px] font-bold text-destructive">
              <span className="h-1 w-1 animate-live-pulse rounded-full bg-destructive" /> LIVE
            </span>
          )}
          {event.category && (
            <span className="truncate text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{event.category}</span>
          )}
        </div>
        <h3 className="mt-0.5 line-clamp-2 text-sm font-bold leading-snug text-foreground">{event.title}</h3>
        <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">
          {event.startDate ? new Date(event.startDate).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "Date TBA"}
          {" · "}
          {event.eventType === "online" ? "Online" : event.venue || "In person"}
        </p>
        <div className="mt-auto flex items-center justify-between pt-1">
          <span className="text-[11px] text-muted-foreground">
            {typeof event.participantCount === "number" ? `${event.participantCount} registered` : (event.organizer || "")}
          </span>
          <span className="rounded-full bg-brand-light px-2.5 py-1 text-[10px] font-bold text-primary">
            {event.price && event.price > 0 ? `₹${event.price}` : "Free"}
          </span>
        </div>
      </div>
    </Link>
  );
}

/* ── UI atoms ────────────────────────────────────────────── */
function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}

function SelectPill({
  options,
  value,
  onChange,
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={options[0]?.label}
        className="h-9 appearance-none rounded-full border border-border bg-card pl-3.5 pr-8 text-xs font-semibold text-foreground outline-none transition-colors hover:border-primary/40 focus:border-primary/50"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <svg
        className="pointer-events-none absolute right-3 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground"
        viewBox="0 0 12 12"
        fill="none"
      >
        <path d="M3 4.5 6 7.5 9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}
