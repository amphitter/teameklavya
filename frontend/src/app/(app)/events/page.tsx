"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, Search, SlidersHorizontal, X, CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EventCard, type EventCardData } from "@/components/event-card";
import { EmptyState, ErrorState, EventCardSkeleton, PageLoader } from "@/components/states";
import { fetchEventsWithCounts } from "@/lib/events";
import { useQuery } from "@/lib/query";
import { cn } from "@/lib/utils";

const EVENT_TYPES = [
  { value: "all", label: "All formats" },
  { value: "online", label: "Online" },
  { value: "offline", label: "In person" },
  { value: "hybrid", label: "Hybrid" },
];

const WHEN = [
  { value: "upcoming", label: "Upcoming" },
  { value: "all", label: "Any time" },
  { value: "past", label: "Past" },
];

function DiscoverContent() {
  const searchParams = useSearchParams();

  const [query, setQuery] = useState(searchParams.get("q") || "");
  const [category, setCategory] = useState(searchParams.get("category") || "all");
  const [eventType, setEventType] = useState(searchParams.get("type") || "all");
  const [when, setWhen] = useState(searchParams.get("when") || "upcoming");
  const [featuredOnly, setFeaturedOnly] = useState(searchParams.get("featured") === "true");

  const [events, setEvents] = useState<EventCardData[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [pagination, setPagination] = useState<{ page: number; hasMore: boolean }>({ page: 1, hasMore: false });
  const [page, setPage] = useState(1);
  const pageCursors = useRef<Record<number, string | null>>({ 1: null });
  const requestId = useRef(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [showFilters, setShowFilters] = useState(false);

  const load = useCallback(async () => {
    const currentRequest = ++requestId.current;
    setLoading(true);
    setError(false);
    try {
      const cursor = page === 1 ? undefined : pageCursors.current[page] || undefined;
      if (page > 1 && !cursor) return;
      const result = await fetchEventsWithCounts({
        q: query,
        category,
        eventType: eventType === "all" ? undefined : eventType,
        type: when,
        ...(featuredOnly ? { featured: "true" } : {}),
        limit: 12,
        cursor,
      });
      if (currentRequest !== requestId.current) return;
      setEvents(result.events);
      setPagination({ page, hasMore: result.hasMore });
      if (result.nextCursor) pageCursors.current[page + 1] = result.nextCursor;
      else delete pageCursors.current[page + 1];
    } catch {
      if (currentRequest === requestId.current) setError(true);
    } finally {
      if (currentRequest === requestId.current) setLoading(false);
    }
  }, [query, category, eventType, when, featuredOnly, page]);

  useEffect(() => {
    load();
  }, [load]);

  const { data: meta } = useQuery<{ categories?: string[] }>(["event-categories"], "/events/meta/categories", {
    staleTime: 5 * 60_000,
  });
  useEffect(() => {
    if (meta?.categories) setCategories(meta.categories);
  }, [meta]);

  useEffect(() => {
    pageCursors.current = { 1: null };
    setPage(1);
  }, [query, category, eventType, when, featuredOnly]);

  const hasActiveFilters = query !== "" || category !== "all" || eventType !== "all" || when !== "upcoming" || featuredOnly;

  const clearFilters = () => {
    setQuery("");
    setCategory("all");
    setEventType("all");
    setWhen("upcoming");
    setFeaturedOnly(false);
  };

  return (
    <div className="min-h-screen bg-background dark:bg-[#0a0a0c]">
      <div className="mx-auto max-w-[1280px] px-4 py-6 sm:px-6">
        {/* Header */}
        <div className="flex flex-col gap-1">
          <h1 className="text-[24px] font-semibold tracking-tight text-foreground dark:text-white">Discover events</h1>
          <p className="text-[13px] text-muted-foreground dark:text-[#a1a1aa]">Find hackathons, workshops, meetups and more</p>
        </div>

        {/* Search + filter */}
        <div className="mt-6 flex gap-2">
          <form
            className="relative flex-1"
            onSubmit={(e) => {
              e.preventDefault();
              pageCursors.current = { 1: null };
              setPage(1);
            }}
          >
            <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground dark:text-[#71717a]" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search events…"
              className="h-10 w-full rounded-[12px] border border-border dark:border-[#232326] bg-card dark:bg-[#121214] pl-10 pr-10 text-[13px] text-foreground dark:text-white placeholder:text-muted-foreground dark:text-[#71717a] focus:border-[#3b82f6]/50 focus:outline-none"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="absolute right-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-[8px] text-muted-foreground dark:text-[#71717a] hover:bg-secondary dark:bg-[#1f1f23] hover:text-foreground dark:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </form>
          <Button
            variant="outline"
            className="h-10 shrink-0 rounded-[10px] border-border dark:border-[#232326] bg-card dark:bg-[#121214] px-4 text-[13px] text-foreground dark:text-[#e4e4e7] hover:bg-secondary dark:bg-[#1f1f23]"
            onClick={() => setShowFilters((s) => !s)}
          >
            <SlidersHorizontal className="mr-1.5 h-4 w-4" />
            Filters
          </Button>
        </div>

        {/* Filters panel */}
        {showFilters && (
          <div className="mt-4 grid gap-5 rounded-[12px] border border-border dark:border-[#1f1f23] bg-card dark:bg-[#121214] p-5 sm:grid-cols-3">
            <div>
              <label className="mb-2 block text-[11px] font-medium uppercase tracking-widest text-muted-foreground dark:text-[#71717a]">Format</label>
              <div className="flex flex-wrap gap-1.5">
                {EVENT_TYPES.map((t) => (
                  <button
                    key={t.value}
                    onClick={() => setEventType(t.value)}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors",
                      eventType === t.value
                        ? "border-[#3b82f6] bg-[#3b82f6] text-foreground dark:text-white"
                        : "border-border dark:border-[#232326] bg-muted dark:bg-[#18181b] text-muted-foreground dark:text-[#a1a1aa] hover:border-[#2a2a30] hover:text-foreground dark:text-white"
                    )}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="mb-2 block text-[11px] font-medium uppercase tracking-widest text-muted-foreground dark:text-[#71717a]">When</label>
              <div className="flex flex-wrap gap-1.5">
                {WHEN.map((t) => (
                  <button
                    key={t.value}
                    onClick={() => setWhen(t.value)}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors",
                      when === t.value
                        ? "border-[#3b82f6] bg-[#3b82f6] text-foreground dark:text-white"
                        : "border-border dark:border-[#232326] bg-muted dark:bg-[#18181b] text-muted-foreground dark:text-[#a1a1aa] hover:border-[#2a2a30] hover:text-foreground dark:text-white"
                    )}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="mb-2 block text-[11px] font-medium uppercase tracking-widest text-muted-foreground dark:text-[#71717a]">Category</label>
              <div className="flex flex-wrap gap-1.5">
                <button
                  onClick={() => setCategory("all")}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors",
                    category === "all"
                      ? "border-[#3b82f6] bg-[#3b82f6] text-foreground dark:text-white"
                      : "border-border dark:border-[#232326] bg-muted dark:bg-[#18181b] text-muted-foreground dark:text-[#a1a1aa] hover:border-[#2a2a30] hover:text-foreground dark:text-white"
                  )}
                >
                  All
                </button>
                {categories.map((c) => (
                  <button
                    key={c}
                    onClick={() => setCategory(c)}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors",
                      category === c
                        ? "border-[#3b82f6] bg-[#3b82f6] text-foreground dark:text-white"
                        : "border-border dark:border-[#232326] bg-muted dark:bg-[#18181b] text-muted-foreground dark:text-[#a1a1aa] hover:border-[#2a2a30] hover:text-foreground dark:text-white"
                    )}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>
            {hasActiveFilters && (
              <button
                onClick={clearFilters}
                className="text-[12px] font-medium text-[#3b82f6] hover:text-[#60a5fa] sm:col-span-3 sm:justify-self-end"
              >
                Clear all filters
              </button>
            )}
          </div>
        )}

        {/* Results */}
        <div className="mt-8">
          {error ? (
            <ErrorState title="Couldn't load events" description="Please check your connection and try again." onRetry={load} />
          ) : loading ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <EventCardSkeleton key={i} />
              ))}
            </div>
          ) : events.length === 0 ? (
            <EmptyState
              icon={CalendarDays}
              title="No events found"
              description={hasActiveFilters ? "Try adjusting filters." : "New events are added regularly — check back soon!"}
              actionLabel={hasActiveFilters ? "Clear filters" : "Explore all"}
              onAction={hasActiveFilters ? clearFilters : undefined}
            />
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {events.map((event) => (
                  <EventCard key={event._id} event={event} />
                ))}
              </div>

              {(page > 1 || pagination.hasMore) && (
                <div className="mt-10 flex items-center justify-center gap-3">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9 rounded-[10px] border-border dark:border-[#232326] bg-card dark:bg-[#121214]"
                    disabled={page <= 1 || loading}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    <ChevronLeft className="h-4 w-4" /> Prev
                  </Button>
                  <span className="text-[12px] text-muted-foreground dark:text-[#71717a]">Page {pagination.page}</span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9 rounded-[10px] border-border dark:border-[#232326] bg-card dark:bg-[#121214]"
                    disabled={!pagination.hasMore || loading}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Next <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function EventsPage() {
  return (
    <Suspense fallback={<PageLoader label="Loading events…" />}>
      <DiscoverContent />
    </Suspense>
  );
}
