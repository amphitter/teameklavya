"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, Compass, Search, SlidersHorizontal, X } from "lucide-react";
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
  const [pagination, setPagination] = useState<{ page: number; pages: number }>({ page: 1, pages: 1 });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [showFilters, setShowFilters] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const { events, pagination } = await fetchEventsWithCounts({
        q: query,
        category,
        eventType: eventType === "all" ? undefined : eventType,
        type: when,
        ...(featuredOnly ? { featured: "true" } : {}),
        limit: 12,
        page,
      });
      setEvents(events);
      setPagination({ page: pagination?.page ?? 1, pages: pagination?.pages ?? 1 });
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [query, category, eventType, when, featuredOnly, page]);

  useEffect(() => {
    load();
  }, [load]);

  // Real categories from the backend (no hard-coded lists).
  // §15 — this barely ever changes, so it is cached for 5 minutes and shared
  // with any other surface that asks for the same key.
  const { data: meta } = useQuery<{ categories?: string[] }>(
    ["event-categories"],
    "/events/meta/categories",
    { staleTime: 5 * 60_000 }
  );
  useEffect(() => {
    if (meta?.categories) setCategories(meta.categories);
  }, [meta]);

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [query, category, eventType, when, featuredOnly]);

  const hasActiveFilters =
    query !== "" || category !== "all" || eventType !== "all" || when !== "upcoming" || featuredOnly;

  const clearFilters = () => {
    setQuery("");
    setCategory("all");
    setEventType("all");
    setWhen("upcoming");
    setFeaturedOnly(false);
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          Discover events
        </h1>
        <p className="text-sm text-muted-foreground">
          Find hackathons, workshops, meetups and more
        </p>
      </div>

      {/* Search + filter toggle */}
      <div className="mt-6 flex gap-2">
        <form
          className="relative flex-1"
          onSubmit={(e) => {
            e.preventDefault();
            setPage(1);
            load();
          }}
        >
          <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search events…"
            className="h-11 w-full rounded-full border border-input bg-card pl-11 pr-10 text-sm outline-none transition-all placeholder:text-muted-foreground focus:border-primary/50 focus:ring-4 focus:ring-primary/10"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </form>
        <Button
          variant="outline"
          className="h-11 shrink-0 rounded-full px-4"
          onClick={() => setShowFilters((s) => !s)}
        >
          <SlidersHorizontal className="mr-1.5 h-4 w-4" />
          Filters
        </Button>
      </div>

      {/* Filters */}
      {showFilters && (
        <div className="mt-4 grid gap-4 rounded-xl border border-border bg-card p-4 sm:grid-cols-3">
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-muted-foreground">
              Format
            </label>
            <div className="flex flex-wrap gap-1.5">
              {EVENT_TYPES.map((t) => (
                <button
                  key={t.value}
                  onClick={() => setEventType(t.value)}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                    eventType === t.value
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border text-muted-foreground hover:border-primary/40 hover:text-primary"
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-muted-foreground">
              When
            </label>
            <div className="flex flex-wrap gap-1.5">
              {WHEN.map((t) => (
                <button
                  key={t.value}
                  onClick={() => setWhen(t.value)}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                    when === t.value
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border text-muted-foreground hover:border-primary/40 hover:text-primary"
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-muted-foreground">
              Category
            </label>
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={() => setCategory("all")}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                  category === "all"
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border text-muted-foreground hover:border-primary/40 hover:text-primary"
                )}
              >
                All
              </button>
              {categories.map((c) => (
                <button
                  key={c}
                  onClick={() => setCategory(c)}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                    category === c
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border text-muted-foreground hover:border-primary/40 hover:text-primary"
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
              className="text-xs font-semibold text-primary hover:underline sm:col-span-3 sm:justify-self-end"
            >
              Clear all filters
            </button>
          )}
        </div>
      )}

      {/* Results */}
      <div className="mt-8">
        {error ? (
          <ErrorState
            title="Couldn't load events"
            description="Please check your connection and try again."
            onRetry={load}
          />
        ) : loading ? (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <EventCardSkeleton key={i} />
            ))}
          </div>
        ) : events.length === 0 ? (
          <EmptyState
            icon={Compass}
            title="No events found"
            description={
              hasActiveFilters
                ? "Try adjusting or clearing your filters to see more events."
                : "New events are added regularly — check back soon!"
            }
            actionLabel={hasActiveFilters ? "Clear filters" : "Explore all events"}
            onAction={hasActiveFilters ? clearFilters : undefined}
            action={!hasActiveFilters ? <Button size="sm" asChild><Link href="/events">Browse</Link></Button> : undefined}
          />
        ) : (
          <>
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {events.map((event) => (
                <EventCard key={event._id} event={event} />
              ))}
            </div>

            {/* Pagination */}
            {pagination.pages > 1 && (
              <div className="mt-10 flex items-center justify-center gap-3">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  <ChevronLeft className="h-4 w-4" /> Prev
                </Button>
                <span className="text-sm text-muted-foreground">
                  Page {pagination.page} of {pagination.pages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= pagination.pages}
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
  );
}

export default function EventsPage() {
  return (
    <Suspense fallback={<PageLoader label="Loading events…" />}>
      <DiscoverContent />
    </Suspense>
  );
}
