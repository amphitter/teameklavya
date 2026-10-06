"use client";

import Link from "next/link";
import { CalendarDays, MapPin, Video } from "lucide-react";
import type { FeedEventData } from "@/components/feed/types";
import { cloudinaryUrl } from "@/utils/image";
import { eventStatus } from "@/lib/events";

/**
 * Compact event card used inside event-native feed posts.
 * Register CTA links to the public event page.
 */
export function EventPostCard({ event }: { event: FeedEventData }) {
  const status = eventStatus(event.startDate, event.endDate);
  const dateStr = new Date(event.startDate).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
  });

  return (
    <Link
      href={`/events/${event.slug}`}
      className="group mt-3 flex gap-3.5 overflow-hidden rounded-xl border border-border bg-muted/40 p-3 transition-colors hover:border-primary/40"
    >
      {/* Poster */}
      <div className="relative h-[84px] w-[84px] shrink-0 overflow-hidden rounded-lg bg-muted sm:h-[100px] sm:w-[100px]">
        {event.bannerUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={cloudinaryUrl(event.bannerUrl, { w: 240, h: 240 })}
            alt={event.title}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-brand-light to-purple-light text-primary">
            <CalendarDays className="h-6 w-6" />
          </div>
        )}
      </div>

      {/* Meta */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-1.5">
          {status === "ongoing" && (
            <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-bold text-destructive">
              <span className="h-1.5 w-1.5 animate-live-pulse rounded-full bg-destructive" /> LIVE
            </span>
          )}
          <span className="truncate text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">
            {event.category || "Event"}
          </span>
        </div>
        <h4 className="mt-0.5 truncate text-sm font-bold text-foreground sm:text-[15px]">{event.title}</h4>
        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <CalendarDays className="h-3.5 w-3.5" /> {dateStr}
          </span>
          <span className="inline-flex items-center gap-1">
            {event.eventType === "online" ? <Video className="h-3.5 w-3.5" /> : <MapPin className="h-3.5 w-3.5" />}
            {event.eventType === "online" ? "Online" : event.venue || "Venue TBA"}
          </span>
        </p>
        <span className="mt-auto inline-flex w-fit items-center rounded-full bg-primary px-3 py-1 text-[11px] font-bold text-primary-foreground transition-transform group-hover:scale-[1.03]">
          {event.price && event.price > 0 ? `Register · ₹${event.price}` : "Register · Free"}
        </span>
      </div>
    </Link>
  );
}
