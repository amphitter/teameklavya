"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, CalendarDays, Radio } from "lucide-react";
import { fetchEventsWithCounts, eventStatus } from "@/lib/events";
import type { EventCardData } from "@/components/event-card";
import { cloudinaryUrl } from "@/utils/image";
import { compactCount } from "@/lib/social";

/**
 * Feed right sidebar (desktop) — REAL data only:
 * live-now events (if any) + upcoming events with register CTA.
 */
export function UpcomingPanel() {
  const [upcoming, setUpcoming] = useState<EventCardData[]>([]);
  const [live, setLive] = useState<EventCardData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetchEventsWithCounts({ status: "upcoming", limit: 4 }).catch(() => ({ events: [] })),
      fetchEventsWithCounts({ status: "ongoing", limit: 3 }).catch(() => ({ events: [] })),
    ]).then(([u, l]) => {
      setUpcoming(u.events || []);
      setLive(l.events || []);
      setLoading(false);
    });
  }, []);

  return (
    <aside className="sticky top-[4.5rem] hidden w-80 shrink-0 space-y-5 self-start xl:block">
      {/* Live now — only when real live events exist */}
      {live.length > 0 && (
        <section className="rounded-xl border border-destructive/25 bg-card p-4">
          <h3 className="flex items-center gap-2 text-sm font-bold text-foreground">
            <span className="relative flex h-2 w-2">
              <span className="absolute h-2 w-2 animate-live-pulse rounded-full bg-destructive" />
            </span>
            Live right now
          </h3>
          <div className="mt-3 space-y-2.5">
            {live.map((e) => (
              <Link key={e._id} href={`/events/${e.slug}`} className="group flex items-center gap-2.5">
                <Radio className="h-4 w-4 shrink-0 text-destructive" />
                <span className="truncate text-sm font-semibold text-foreground group-hover:text-primary">{e.title}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Upcoming events */}
      <section className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-foreground">Upcoming events</h3>
          <Link href="/explore" className="inline-flex items-center gap-0.5 text-xs font-semibold text-primary hover:underline">
            View all <ArrowRight className="h-3 w-3" />
          </Link>
        </div>

        {loading && (
          <div className="mt-3 space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex gap-2.5">
                <div className="h-12 w-12 animate-pulse rounded-lg bg-muted" />
                <div className="flex-1 space-y-1.5 py-1">
                  <div className="h-3 w-3/4 animate-pulse rounded bg-muted" />
                  <div className="h-2.5 w-1/2 animate-pulse rounded bg-muted" />
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && upcoming.length === 0 && (
          <p className="mt-3 rounded-lg border border-dashed border-border bg-muted/40 px-3 py-5 text-center text-xs text-muted-foreground">
            No upcoming events yet — check back soon.
          </p>
        )}

        <div className="mt-3 space-y-3">
          {upcoming.map((e) => (
            <Link key={e._id} href={`/events/${e.slug}`} className="group flex items-center gap-3">
              <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-muted">
                {e.bannerUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={cloudinaryUrl(e.bannerUrl, { w: 96, h: 96 })}
                    alt=""
                    className="h-full w-full object-cover transition-transform group-hover:scale-105"
                    loading="lazy"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-brand-light text-primary">
                    <CalendarDays className="h-5 w-5" />
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-foreground group-hover:text-primary">{e.title}</p>
                <p className="text-xs text-muted-foreground">
                  {e.startDate
                    ? new Date(e.startDate).toLocaleDateString("en-IN", { day: "numeric", month: "short" })
                    : "Date TBA"}
                  {e.participantCount != null && ` · ${compactCount(e.participantCount)} registered`}
                </p>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </aside>
  );
}
