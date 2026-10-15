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

  const { data: meta } = useQuery<{ categories?: string[] }>(["event-categories"], "/events/meta/categories", {
    staleTime: 5 * 60_000,
  });
  useEffect(() => {
    if (meta?.categories) setCategories(meta.categories);
  }, [meta]);

  useEffect(() => {
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
    <div className="min-h-screen bg-[#F8FAFF] dark:bg-black">
      <div className="mx-auto max-w-[1280px] px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-2">
          <h1 className="text-[26px] font-bold tracking-[-0.015em] text-[#0B1235] dark:text-[#ededed] sm:text-[32px] sm:leading-[40px] sm:tracking-[-0.02em]" style={{ fontFamily: "Inter, sans-serif" }}>
            Discover events
          </h1>
          <p className="text-[14px] leading-5 text-[#64709A] dark:text-[#a1a1aa]" style={{ fontFamily: "Inter, sans-serif" }}>
            Find hackathons, workshops, meetups and more — curated for builders
          </p>
        </div>

        <div className="mt-6 flex gap-2">
          <form
            className="relative flex-1"
            onSubmit={(e) => {
              e.preventDefault();
              setPage(1);
              load();
            }}
          >
            <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[#64709A]" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search events…"
              className="h-12 w-full rounded-[12px] border border-[#E4E9F4] bg-white pl-12 pr-10 text-[15px] leading-6 text-[#0B1235] outline-none transition-all placeholder:text-[#64709A] focus:border-[#2563FF] focus:ring-[3px] focus:ring-[rgba(37,99,255,0.12)] dark:border-[#262626] dark:bg-[#0a0a0a] dark:text-[#ededed] dark:placeholder:text-[#a1a1aa]"
              style={{ fontFamily: "Inter, sans-serif" }}
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="absolute right-3 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-[#64709A] hover:bg-[#F8FAFF] hover:text-[#0B1235] dark:hover:bg-[#171717] dark:hover:text-[#ededed]"
                aria-label="Clear search"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </form>
          <Button
            variant="outline"
            className="h-12 shrink-0 rounded-[12px] border-[#E4E9F4] bg-white px-5 text-[14px] font-semibold text-[#0B1235] hover:border-[#2563FF] hover:bg-[#EFF6FF] dark:border-[#262626] dark:bg-[#0a0a0a] dark:text-[#ededed] dark:hover:bg-[#171717] dark:hover:border-[#3b82f6]"
            onClick={() => setShowFilters((s) => !s)}
            style={{ fontFamily: "Inter, sans-serif" }}
          >
            <SlidersHorizontal className="mr-2 h-4 w-4" />
            Filters
          </Button>
        </div>

        {showFilters && (
          <div className="mt-4 grid gap-5 rounded-[1rem] border border-[#E4E9F4] bg-white p-5 shadow-[0px_4px_16px_rgba(24,39,75,0.04)] dark:border-[#262626] dark:bg-[#0a0a0a] sm:grid-cols-3 animate-fade-in">
            <div>
              <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.03em] text-[#64709A] dark:text-[#a1a1aa]">Format</label>
              <div className="flex flex-wrap gap-2">
                {EVENT_TYPES.map((t) => (
                  <button
                    key={t.value}
                    onClick={() => setEventType(t.value)}
                    className={cn(
                      "inline-flex h-9 items-center rounded-full border px-4 text-[12px] font-semibold tracking-[0.02em] transition-all",
                      eventType === t.value
                        ? "border-[#2563FF] bg-[#2563FF] text-white shadow-[0px_8px_24px_rgba(37,99,255,0.25)]"
                        : "border-[#E4E9F4] bg-white text-[#64709A] hover:border-[#2563FF]/40 hover:bg-[#EFF6FF] hover:text-[#2563FF] dark:border-[#262626] dark:bg-black dark:text-[#a1a1aa] dark:hover:bg-[#171717] dark:hover:border-[#3b82f6]/40 dark:hover:text-[#ededed]"
                    )}
                    style={{ fontFamily: "Inter, sans-serif" }}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.03em] text-[#64709A] dark:text-[#a1a1aa]">When</label>
              <div className="flex flex-wrap gap-2">
                {WHEN.map((t) => (
                  <button
                    key={t.value}
                    onClick={() => setWhen(t.value)}
                    className={cn(
                      "inline-flex h-9 items-center rounded-full border px-4 text-[12px] font-semibold tracking-[0.02em] transition-all",
                      when === t.value
                        ? "border-[#2563FF] bg-[#2563FF] text-white shadow-[0px_8px_24px_rgba(37,99,255,0.25)]"
                        : "border-[#E4E9F4] bg-white text-[#64709A] hover:border-[#2563FF]/40 hover:bg-[#EFF6FF] hover:text-[#2563FF] dark:border-[#262626] dark:bg-black dark:text-[#a1a1aa] dark:hover:bg-[#171717] dark:hover:border-[#3b82f6]/40 dark:hover:text-[#ededed]"
                    )}
                    style={{ fontFamily: "Inter, sans-serif" }}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.03em] text-[#64709A] dark:text-[#a1a1aa]">Category</label>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setCategory("all")}
                  className={cn(
                    "inline-flex h-9 items-center rounded-full border px-4 text-[12px] font-semibold tracking-[0.02em] transition-all",
                    category === "all"
                      ? "border-[#2563FF] bg-[#2563FF] text-white shadow-[0px_8px_24px_rgba(37,99,255,0.25)]"
                      : "border-[#E4E9F4] bg-white text-[#64709A] hover:border-[#2563FF]/40 hover:bg-[#EFF6FF] hover:text-[#2563FF] dark:border-[#262626] dark:bg-black dark:text-[#a1a1aa]"
                  )}
                  style={{ fontFamily: "Inter, sans-serif" }}
                >
                  All
                </button>
                {categories.map((c) => (
                  <button
                    key={c}
                    onClick={() => setCategory(c)}
                    className={cn(
                      "inline-flex h-9 items-center rounded-full border px-4 text-[12px] font-semibold tracking-[0.02em] transition-all",
                      category === c
                        ? "border-[#2563FF] bg-[#2563FF] text-white shadow-[0px_8px_24px_rgba(37,99,255,0.25)]"
                        : "border-[#E4E9F4] bg-white text-[#64709A] hover:border-[#2563FF]/40 hover:bg-[#EFF6FF] hover:text-[#2563FF] dark:border-[#262626] dark:bg-black dark:text-[#a1a1aa]"
                    )}
                    style={{ fontFamily: "Inter, sans-serif" }}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>
            {hasActiveFilters && (
              <button onClick={clearFilters} className="text-[12px] font-semibold tracking-[0.02em] text-[#2563FF] hover:text-[#1677FF] hover:underline sm:col-span-3 sm:justify-self-end" style={{ fontFamily: "Inter, sans-serif" }}>
                Clear all filters
              </button>
            )}
          </div>
        )}

        <div className="mt-8">
          {error ? (
            <ErrorState title="Couldn't load events" description="Please check your connection and try again." onRetry={load} />
          ) : loading ? (
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <EventCardSkeleton key={i} />
              ))}
            </div>
          ) : events.length === 0 ? (
            <EmptyState
              icon={Compass}
              title="No events found"
              description={hasActiveFilters ? "Try adjusting or clearing your filters to see more events." : "New events are added regularly — check back soon!"}
              actionLabel={hasActiveFilters ? "Clear filters" : "Explore all events"}
              onAction={hasActiveFilters ? clearFilters : undefined}
              action={!hasActiveFilters ? <Button size="sm" asChild className="h-9 rounded-full bg-[#2563FF] text-white hover:bg-[#1677FF]"><Link href="/events">Browse</Link></Button> : undefined}
            />
          ) : (
            <>
              <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {events.map((event) => (
                  <EventCard key={event._id} event={event} />
                ))}
              </div>

              {pagination.pages > 1 && (
                <div className="mt-10 flex items-center justify-center gap-3">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-10 rounded-[10px] border-[#E4E9F4] bg-white text-[#0B1235] hover:border-[#2563FF] hover:bg-[#EFF6FF] dark:border-[#262626] dark:bg-[#0a0a0a] dark:text-[#ededed] dark:hover:border-[#3b82f6]"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    <ChevronLeft className="h-4 w-4" /> Prev
                  </Button>
                  <span className="text-[13px] font-medium text-[#64709A] dark:text-[#a1a1aa]" style={{ fontFamily: "Inter, sans-serif" }}>
                    Page {pagination.page} of {pagination.pages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-10 rounded-[10px] border-[#E4E9F4] bg-white text-[#0B1235] hover:border-[#2563FF] hover:bg-[#EFF6FF] dark:border-[#262626] dark:bg-[#0a0a0a] dark:text-[#ededed] dark:hover:border-[#3b82f6]"
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
