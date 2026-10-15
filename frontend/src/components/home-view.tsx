"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, CalendarSearch, Search, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EventCard, type EventCardData } from "@/components/event-card";
import { EmptyState, ErrorState, EventCardSkeleton } from "@/components/states";
import { fetchEventsWithCounts } from "@/lib/events";

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
    <div className="flex flex-col bg-background dark:bg-[#0a0a0c]">
      {/* Hero – premium dark */}
      <section className="relative overflow-hidden border-b border-border dark:border-[#1f1f23]">
        <div className="absolute inset-0 bg-gradient-to-b from-[#121214] to-[#0a0a0c]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(59,130,246,0.08),transparent_60%)]" />
        
        <div className="relative mx-auto flex max-w-[1280px] flex-col items-center px-4 py-16 text-center sm:px-6 sm:py-24">
          <span className="mb-5 inline-flex items-center gap-2 rounded-full border border-border dark:border-[#232326] bg-card dark:bg-[#121214] px-3.5 py-1.5 text-[11px] font-medium tracking-wide text-muted-foreground dark:text-[#a1a1aa]">
            <Sparkles className="h-3 w-3 text-[#3b82f6]" />
            DISCOVER · PARTICIPATE · CREATE · CONNECT · GROW
          </span>

          <h1 className="max-w-3xl text-[32px] font-semibold leading-[1.1] tracking-tight text-foreground dark:text-white sm:text-[44px] md:text-[52px]">
            Discover <span className="text-[#3b82f6]">events</span> you&apos;ll love
          </h1>
          <p className="mt-4 max-w-xl text-[14px] leading-6 text-muted-foreground dark:text-[#a1a1aa] sm:text-[15px]">
            Find what&apos;s happening around you, register in seconds, get your QR ticket — and build your event identity.
          </p>

          <form onSubmit={onSearch} className="mt-8 flex w-full max-w-[520px] items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground dark:text-[#71717a]" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search hackathons, workshops, meetups…"
                className="h-11 w-full rounded-[12px] border border-border dark:border-[#232326] bg-muted dark:bg-[#18181b] pl-10 pr-4 text-[13.5px] text-foreground dark:text-white placeholder:text-muted-foreground dark:text-[#71717a] focus:border-[#3b82f6]/50 focus:outline-none"
              />
            </div>
            <Button type="submit" className="h-11 rounded-[12px] bg-[#3b82f6] px-6 text-[13px] font-medium text-foreground dark:text-white hover:bg-[#2563eb]">
              Search
            </Button>
          </form>

          {categories.length > 0 && (
            <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
              {categories.map((cat) => (
                <Link
                  key={cat}
                  href={`/events?category=${encodeURIComponent(cat)}`}
                  className="rounded-full border border-border dark:border-[#232326] bg-card dark:bg-[#121214] px-3 py-1.5 text-[12px] font-medium text-muted-foreground dark:text-[#a1a1aa] hover:border-[#2a2a30] hover:text-foreground dark:text-white transition-colors"
                >
                  {cat}
                </Link>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Content */}
      <div className="mx-auto w-full max-w-[1280px] px-4 py-10 sm:px-6">
        {error ? (
          <ErrorState title="Couldn't load events" description="Please check your connection and try again." onRetry={load} />
        ) : loading ? (
          <div className="space-y-10">
            <div className="mb-4 h-5 w-32 animate-pulse rounded bg-secondary dark:bg-[#1f1f23]" />
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <EventCardSkeleton />
              <EventCardSkeleton />
              <EventCardSkeleton />
            </div>
          </div>
        ) : !hasEvents ? (
          <EmptyState icon={CalendarSearch} title="No events yet" description="Events will appear here as soon as organizers publish them." />
        ) : (
          <div className="space-y-12">
            {featured.length > 0 && (
              <section>
                <div className="mb-5 flex items-end justify-between">
                  <div>
                    <h2 className="text-[18px] font-semibold tracking-tight text-foreground dark:text-white">Featured events</h2>
                    <p className="mt-1 text-[12px] text-muted-foreground dark:text-[#71717a]">Handpicked by organizers</p>
                  </div>
                  <Link href="/events?featured=true" className="inline-flex items-center gap-1 text-[12px] font-medium text-[#3b82f6] hover:text-[#60a5fa]">
                    View all <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {featured.map((event) => (
                    <EventCard key={event._id} event={event} />
                  ))}
                </div>
              </section>
            )}

            {upcoming.length > 0 && (
              <section>
                <div className="mb-5 flex items-end justify-between">
                  <div>
                    <h2 className="text-[18px] font-semibold tracking-tight text-foreground dark:text-white">Upcoming events</h2>
                    <p className="mt-1 text-[12px] text-muted-foreground dark:text-[#71717a]">Register now — spots fill fast</p>
                  </div>
                  <Link href="/events" className="inline-flex items-center gap-1 text-[12px] font-medium text-[#3b82f6] hover:text-[#60a5fa]">
                    View all <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {upcoming.map((event) => (
                    <EventCard key={event._id} event={event} />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}

        {/* Host CTA – premium dark */}
        <section className="mt-16 rounded-[16px] border border-border dark:border-[#1f1f23] bg-card dark:bg-[#121214] px-6 py-12 text-center sm:px-12">
          <h2 className="text-[20px] font-semibold tracking-tight text-foreground dark:text-white sm:text-[22px]">Hosting an event?</h2>
          <p className="mx-auto mt-2 max-w-lg text-[13px] leading-5 text-muted-foreground dark:text-[#a1a1aa]">
            Publish it on EventHub — registrations, QR tickets, check-in scanning and attendee management, all in one place.
          </p>
          <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button onClick={() => router.push("/organizations/register")} className="h-10 rounded-[10px] bg-white px-6 text-[13px] font-medium text-black hover:bg-[#e4e4e7]">
              Register organization
            </Button>
            <Button
              variant="outline"
              onClick={() => router.push("/events")}
              className="h-10 rounded-[10px] border-border dark:border-[#232326] bg-transparent text-foreground dark:text-white hover:bg-secondary dark:bg-[#1f1f23]"
            >
              Browse events
            </Button>
          </div>
        </section>
      </div>
    </div>
  );
}
