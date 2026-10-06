"use client";

import Link from "next/link";
import { CalendarDays, Clock, MapPin, Users, Video, Wifi } from "lucide-react";
import { cn } from "@/lib/utils";
import { getImageUrl } from "@/utils/image";

export interface EventCardData {
  _id: string;
  slug: string;
  title: string;
  description?: string;
  category?: string;
  eventType?: "online" | "offline" | "hybrid";
  venue?: string;
  platform?: string;
  startDate?: string;
  startTime?: string;
  bannerUrl?: string;
  organizer?: string;
  price?: number;
  isFeatured?: boolean;
  maxAttendees?: number;
  participantCount?: number;
  status?: "upcoming" | "ongoing" | "past";
}

function formatDate(date?: string) {
  if (!date) return null;
  const d = new Date(date);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
}

function Poster({ event }: { event: EventCardData }) {
  const url = getImageUrl(event.bannerUrl);
  return (
    <div className="relative h-44 w-full shrink-0 overflow-hidden bg-muted">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={event.title}
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          loading="lazy"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-dots bg-brand-light">
          <CalendarDays className="h-10 w-10 text-primary/40" />
        </div>
      )}

      {/* Category + type chips */}
      <div className="absolute left-3 top-3 flex flex-wrap gap-1.5">
        {event.category && (
          <span className="rounded-full bg-white/95 px-2.5 py-1 text-[11px] font-semibold text-navy shadow-sm backdrop-blur">
            {event.category}
          </span>
        )}
      </div>
      {event.isFeatured && (
        <span className="absolute right-3 top-3 rounded-full bg-purple px-2.5 py-1 text-[11px] font-semibold text-white shadow-sm">
          Featured
        </span>
      )}

      {/* Status chip */}
      {event.status === "ongoing" && (
        <span className="absolute bottom-3 left-3 flex items-center gap-1.5 rounded-full bg-destructive px-2.5 py-1 text-[11px] font-semibold text-white shadow-sm">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" /> Live
        </span>
      )}
    </div>
  );
}

/**
 * EventCard — the core visual primitive of EventHub.
 * Used across Home, Discover, related events and organization surfaces.
 */
export function EventCard({ event, className }: { event: EventCardData; className?: string }) {
  const date = formatDate(event.startDate);
  const isOnline = event.eventType === "online";
  const isFree = !event.price || event.price === 0;
  const isPast = event.status === "past";
  const spotsLeft =
    typeof event.maxAttendees === "number" && typeof event.participantCount === "number"
      ? event.maxAttendees - event.participantCount
      : null;

  return (
    <Link
      href={`/events/${event.slug}`}
      className={cn(
        "group flex flex-col overflow-hidden rounded-xl border border-border bg-card transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-[0_8px_24px_-8px_rgba(16,32,48,0.12)]",
        isPast && "opacity-80",
        className
      )}
    >
      <Poster event={event} />

      <div className="flex flex-1 flex-col gap-2.5 p-4">
        {/* Date + time */}
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {date && (
            <span className="inline-flex items-center gap-1 font-medium text-primary">
              <CalendarDays className="h-3.5 w-3.5" /> {date}
            </span>
          )}
          {event.startTime && (
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" /> {event.startTime}
              {event.status === "ongoing" ? "" : ""}
            </span>
          )}
        </div>

        {/* Title */}
        <h3 className="line-clamp-2 text-[15px] font-semibold leading-snug text-foreground">
          {event.title}
        </h3>

        {/* Location / type */}
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {isOnline ? (
            <>
              <Video className="h-3.5 w-3.5 text-cyan" />
              <span>Online{event.platform ? ` · ${event.platform}` : ""}</span>
            </>
          ) : (
            <>
              <MapPin className="h-3.5 w-3.5 shrink-0 text-cyan" />
              <span className="line-clamp-1">{event.venue || "Venue TBA"}</span>
            </>
          )}
          {event.eventType === "hybrid" && (
            <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-[10px] font-medium">
              <Wifi className="h-3 w-3" /> Hybrid
            </span>
          )}
        </div>

        {/* Footer: organizer · price · CTA */}
        <div className="mt-auto flex items-center justify-between gap-2 border-t border-border pt-3">
          <div className="flex min-w-0 flex-col">
            {event.organizer && (
              <span className="truncate text-[11px] font-medium text-muted-foreground">
                by {event.organizer}
              </span>
            )}
            {typeof event.participantCount === "number" && (
              <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                <Users className="h-3 w-3" /> {event.participantCount} registered
              </span>
            )}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <span
              className={cn(
                "rounded-full px-2.5 py-1 text-[11px] font-semibold",
                isFree ? "bg-success-light text-success" : "bg-brand-light text-primary"
              )}
            >
              {isFree ? "Free" : `₹${event.price}`}
            </span>
            {spotsLeft !== null && spotsLeft <= 10 && spotsLeft > 0 && (
              <span className="text-[10px] font-medium text-warning">{spotsLeft} spots left</span>
            )}
            {spotsLeft !== null && spotsLeft <= 0 && (
              <span className="text-[10px] font-medium text-destructive">Full</span>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}
