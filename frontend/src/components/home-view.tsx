"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, CalendarSearch, Search, Sparkles, Ticket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EventCard, type EventCardData } from "@/components/event-card";
import { EmptyState, ErrorState, EventCardSkeleton } from "@/components/states";
import { fetchEventsWithCounts } from "@/lib/events";
import { cn } from "@/lib/utils";

export default function HomeView() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [featured, setFeatured] = useState<EventCardData[]>([]);
  const [upcoming, setUpcoming] = useState<EventCardData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(false);
    try {
      const [featuredRes, upcomingRes] = await Promise.all([
        fetchEventsWithCounts({ featured: "true", limit: 3, type: "upcoming" }),
        fetchEventsWithCounts({ limit: 6, type: "upcoming" }),
      ]);
      setFeatured(featuredRes.events);
      setUpcoming(upcomingRes.events);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const categories = useMemo(() => {
    const set = new Set<string>();
    [...featured, ...upcoming].forEach((e) => e.category && set.add(e.category));
    return Array.from(set).slice(0, 8);
  }, [featured, upcoming]);

  const onSearch = (e: React.FormEvent) => {
    e.preventDefault();
    router.push(query.trim() ? `/events?q=${encodeURIComponent(query.trim())}` : "/events");
  };

  const hasEvents = featured.length > 0 || upcoming.length > 0;

  return (
    <div className="flex flex-col">
      {/* ── Hero ─────────────────────────────────────────── */}
      <section className="relative overflow-hidden border-b border-border bg-gradient-to-b from-brand-light/60 to-background">
        <div className="bg-dots absolute inset-0 opacity-60" aria-hidden />
        <div className="relative mx-auto flex max-w-3xl flex-col items-center px-4 py-16 text-center sm:px-6 sm:py-24">
          <span className="mb-5 inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-1.5 text-xs font-semibold tracking-wide text-muted-foreground shadow-sm">
            <Sparkles className="h-3.5 w-3.5 text-purple" />
            DISCOVER · PARTICIPATE · CREATE · CONNECT · GROW
          </span>

          <h1 className="text-4xl font-extrabold leading-[1.1] tracking-tight text-foreground sm:text-5xl md:text-6xl">
            Discover <span className="text-gradient">events</span> you&apos;ll love
          </h1>
          <p className="mt-4 max-w-xl text-base text-muted-foreground sm:text-lg">
            Find what&apos;s happening around you, register in seconds, get your QR ticket — and
            build your event identity.
          </p>

          {/* Search */}
          <form onSubmit={onSearch} className="mt-8 flex w-full max-w-xl items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search hackathons, workshops, meetups…"
                className="h-12 w-full rounded-full border border-input bg-card pl-11 pr-4 text-sm text-foreground shadow-sm outline-none transition-all placeholder:text-muted-foreground focus:border-primary/50 focus:ring-4 focus:ring-primary/10"
              />
            </div>
            <Button type="submit" className="h-12 rounded-full px-6 font-semibold">
              Search
            </Button>
          </form>

          {/* Category quick links */}
          {categories.length > 0 && (
            <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
              {categories.map((cat) => (
                <Link
                  key={cat}
                  href={`/events?category=${encodeURIComponent(cat)}`}
                  className="rounded-full border border-border bg-card px-3.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
                >
                  {cat}
                </Link>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ── Content ──────────────────────────────────────── */}
      <div className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6">
        {error ? (
          <ErrorState
            title="Couldn't load events"
            description="Please check your connection and try again."
            onRetry={load}
          />
        ) : loading ? (
          <div className="space-y-10">
            <div>
              <div className="mb-4 h-6 w-40 animate-pulse rounded bg-muted" />
              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                <EventCardSkeleton />
                <EventCardSkeleton />
                <EventCardSkeleton />
              </div>
            </div>
          </div>
        ) : !hasEvents ? (
          <EmptyState
            icon={CalendarSearch}
            title="No events yet"
            description="Events will appear here as soon as organizers publish them. Check back soon!"
          />
        ) : (
          <div className="space-y-12">
            {/* Featured */}
            {featured.length > 0 && (
              <section>
                <div className="mb-5 flex items-end justify-between">
                  <div>
                    <h2 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
                      Featured events
                    </h2>
                    <p className="mt-0.5 text-sm text-muted-foreground">Handpicked by organizers</p>
                  </div>
                  <Link
                    href="/events?featured=true"
                    className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline"
                  >
                    View all <ArrowRight className="h-4 w-4" />
                  </Link>
                </div>
                <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                  {featured.map((event) => (
                    <EventCard key={event._id} event={event} />
                  ))}
                </div>
              </section>
            )}

            {/* Upcoming */}
            {upcoming.length > 0 && (
              <section>
                <div className="mb-5 flex items-end justify-between">
                  <div>
                    <h2 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
                      Upcoming events
                    </h2>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      Register now — spots fill fast
                    </p>
                  </div>
                  <Link
                    href="/events"
                    className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline"
                  >
                    View all <ArrowRight className="h-4 w-4" />
                  </Link>
                </div>
                <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                  {upcoming.map((event) => (
                    <EventCard key={event._id} event={event} />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}

        {/* ── Host CTA band ──────────────────────────────── */}
        <section className="mt-16 overflow-hidden rounded-2xl border border-border bg-navy px-6 py-12 text-center sm:px-12">
          <h2 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
            Hosting an event?
          </h2>
          <p className="mx-auto mt-2 max-w-lg text-sm text-white/70 sm:text-base">
            Publish it on EventHub — registrations, QR tickets, check-in scanning and attendee
            management, all in one place.
          </p>
          <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button
              size="lg"
              className="bg-white font-semibold text-navy hover:bg-white/90"
              onClick={() => router.push("/login")}
            >
              <Ticket className="mr-2 h-4 w-4" /> Create your event
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="border-white/25 bg-transparent text-white hover:bg-white/10 hover:text-white"
              onClick={() => router.push("/events")}
            >
              Browse events first
            </Button>
          </div>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[11px] font-semibold uppercase tracking-widest text-white/50">
            <span className={cn("flex items-center gap-1.5")}>Discover</span>
            <span>·</span>
            <span>Participate</span>
            <span>·</span>
            <span>Create</span>
            <span>·</span>
            <span>Connect</span>
            <span>·</span>
            <span>Grow</span>
          </div>
        </section>
      </div>
    </div>
  );
}
