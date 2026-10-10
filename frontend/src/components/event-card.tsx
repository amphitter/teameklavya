"use client";

import Link from "next/link";
import { CalendarDays, MapPin, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { getImageUrl } from "@/utils/image";
import { usePrefetchOnHover } from "@/lib/query";

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
  logoUrl?: string | null;
  organizer?: string;
  price?: number;
  isFeatured?: boolean;
  maxAttendees?: number;
  participantCount?: number;
  status?: "upcoming" | "ongoing" | "past";
}

function formatDayMonth(date?: string) {
  if (!date) return null;
  const d = new Date(date);
  if (isNaN(d.getTime())) return null;
  const day = d.getDate().toString().padStart(2, "0");
  const month = d.toLocaleDateString("en-US", { month: "short" }).toUpperCase();
  return { day, month, full: d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) };
}

function usePrefetchSafe(slug?: string) {
  const handlers = usePrefetchOnHover<unknown>(["event", slug || "none"], slug ? `/events/slug/${slug}` : "");
  return slug ? handlers : {};
}

export function EventCard({ event, className }: { event: EventCardData; className?: string }) {
  const prefetch = usePrefetchSafe(event.slug);
  const date = formatDayMonth(event.startDate);

  return (
    <Link
      href={`/events/${event.slug}`}
      {...prefetch}
      className={cn(
        "group flex flex-col overflow-hidden rounded-[12px] border bg-card transition-all duration-200",
        "border-border hover:border-border-strong hover:shadow-sm",
        "dark:border-[#232326] dark:bg-[#141417] dark:hover:border-[#2a2a30] dark:hover:bg-[#1a1a1e]",
        className
      )}
    >
      {/* Banner */}
      <div className="relative aspect-[16/9] w-full overflow-hidden bg-muted dark:bg-[#1f1f23]">
        {getImageUrl(event.bannerUrl) ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={getImageUrl(event.bannerUrl)!}
            alt={event.title}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-muted dark:bg-[#1f1f23]">
            <CalendarDays className="h-8 w-8 text-muted-foreground/50 dark:text-[#3a3a42]" />
          </div>
        )}

        {date && (
          <div className="absolute left-3 top-3 flex flex-col items-center rounded-[8px] bg-black/80 px-2.5 py-1.5 backdrop-blur-md border border-white/10">
            <span className="text-[14px] font-bold leading-none text-white">{date.day}</span>
            <span className="mt-0.5 text-[10px] font-medium leading-none text-white/80">{date.month}</span>
          </div>
        )}

        <div className="absolute right-3 top-3">
          {event.status === "ongoing" ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/90 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur dark:border-[#065f46]/30 dark:bg-[#052e1f]/90 dark:text-[#6ee7b7]">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white dark:bg-[#10b981]" /> Live
            </span>
          ) : (
            <span className="inline-flex rounded-full border border-emerald-500/20 bg-emerald-500/90 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur dark:border-[#065f46]/20 dark:bg-[#052e1f]/80 dark:text-[#6ee7b7]">
              Open
            </span>
          )}
        </div>

        <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/40 to-transparent pointer-events-none" />
      </div>

      {/* Content */}
      <div className="flex flex-1 flex-col p-3.5">
        {event.category && (
          <div className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground dark:text-[#71717a]">
            {event.category.replace(/_/g, " ")}
          </div>
        )}
        <h3 className="mt-1 line-clamp-2 text-[14px] font-semibold leading-5 text-foreground group-hover:text-foreground/80 dark:text-white dark:group-hover:text-[#e4e4e7]">
          {event.title}
        </h3>
        {event.description && (
          <p className="mt-1 line-clamp-2 text-[12px] leading-4 text-muted-foreground dark:text-[#a1a1aa]">
            {event.description}
          </p>
        )}

        <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-3 dark:border-[#1f1f23]">
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground dark:text-[#71717a]">
            <MapPin className="h-3 w-3 shrink-0" />
            <span className="line-clamp-1">{event.venue || "Venue TBA"}</span>
          </div>
          {typeof event.participantCount === "number" && (
            <div className="flex items-center gap-1 text-[11px] text-muted-foreground dark:text-[#71717a]">
              <Users className="h-3 w-3" />
              <span>{event.participantCount}</span>
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}

export function FeaturedEventCard({ event }: { event: EventCardData }) {
  const prefetch = usePrefetchSafe(event.slug);
  const date = formatDayMonth(event.startDate);

  return (
    <Link
      href={`/events/${event.slug}`}
      {...prefetch}
      className="group flex flex-col overflow-hidden rounded-[12px] border bg-card transition-all hover:shadow-sm dark:border-[#232326] dark:bg-[#141417] dark:hover:border-[#2a2a30] dark:hover:bg-[#1a1a1e]"
    >
      <div className="relative aspect-[16/10] w-full overflow-hidden bg-muted dark:bg-[#1f1f23]">
        {getImageUrl(event.bannerUrl) ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={getImageUrl(event.bannerUrl)!}
            alt={event.title}
            className="h-full w-full object-cover group-hover:scale-[1.02] transition-transform duration-300"
          />
        ) : (
          <div className="h-full w-full bg-muted dark:bg-[#1f1f23]" />
        )}
        {date && (
          <div className="absolute left-3 top-3 rounded-[8px] bg-black/80 px-2.5 py-1.5 border border-white/10 backdrop-blur">
            <div className="text-center">
              <div className="text-[13px] font-bold leading-none text-white">{date.day}</div>
              <div className="text-[10px] font-medium text-white/70">{date.month}</div>
            </div>
          </div>
        )}
        <div className="absolute right-3 top-3 rounded-full bg-emerald-500/90 border border-emerald-500/20 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur dark:bg-[#052e1f]/90 dark:border-[#065f46]/30 dark:text-[#6ee7b7]">
          Registration Open
        </div>
      </div>
      <div className="p-3.5">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground dark:text-[#71717a]">{event.category || "Event"}</div>
        <h3 className="mt-1 text-[14px] font-semibold text-foreground line-clamp-1 dark:text-white">{event.title}</h3>
        <p className="mt-1 text-[12px] text-muted-foreground line-clamp-2 dark:text-[#a1a1aa]">{event.description || "Join us for an amazing experience."}</p>
        <div className="mt-3 flex items-center gap-3 text-[11px] text-muted-foreground dark:text-[#71717a]">
          <span className="flex items-center gap-1"><MapPin className="h-3 w-3" /> {event.venue || "GITM, Gurugram"}</span>
          <span className="flex items-center gap-1"><Users className="h-3 w-3" /> {event.participantCount || 324}</span>
        </div>
      </div>
    </Link>
  );
}
