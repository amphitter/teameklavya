"use client";

import Link from "next/link";
import { CalendarDays, Clock, MapPin, Users, Video, Wifi, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { getImageUrl } from "@/utils/image";
import { OptimizedImage } from "@/components/ui/optimized-image";
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
  endDate?: string;
  startTime?: string;
  bannerUrl?: string;
  logoUrl?: string | null;
  organization?: { name?: string; logoUrl?: string; slug?: string };
  organizer?: string;
  price?: number;
  isFeatured?: boolean;
  maxAttendees?: number;
  participantCount?: number;
  registrationCount?: number;
  status?: "upcoming" | "ongoing" | "past" | "ended";
}

function formatDate(date?: string) {
  if (!date) return null;
  const d = new Date(date);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
}

function formatDateRange(start?: string, end?: string) {
  if (!start) return "";
  const s = new Date(start);
  const e = end ? new Date(end) : null;
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  if (!e) return s.toLocaleDateString("en-IN", opts);
  const sStr = s.toLocaleDateString("en-IN", opts);
  const eStr = e.toLocaleDateString("en-IN", opts);
  return sStr === eStr ? sStr : `${sStr} - ${eStr}`;
}

function Poster({ event }: { event: EventCardData }) {
  const url = getImageUrl(event.bannerUrl);
  return (
    <div className="relative aspect-[16/9] w-full shrink-0 overflow-hidden bg-[#EFF6FF] dark:bg-[#0a0a0a]">
      {url ? (
        <OptimizedImage
          src={url}
          alt={event.title}
          preset="poster"
          size="small"
          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          style={{ height: "100%" }}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[#EFF6FF] to-[#EDE9FE] dark:from-[#0a0a0a] dark:to-[#171717]">
          <CalendarDays className="h-10 w-10 text-[#2563FF]/30" />
        </div>
      )}

      <div className="absolute left-3 top-3 flex flex-wrap gap-1.5">
        {event.category && (
          <span className="rounded-full bg-white/95 px-3 py-1 text-[11px] font-semibold tracking-[0.02em] text-[#0B1235] shadow-[0px_4px_16px_rgba(24,39,75,0.04)] backdrop-blur">
            {event.category.replace(/_/g, " ")}
          </span>
        )}
      </div>

      {event.isFeatured && (
        <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-[#6C35FF] px-3 py-1 text-[11px] font-semibold text-white shadow-[0px_8px_24px_rgba(37,99,255,0.25)]">
          <Star className="h-3 w-3 fill-white" /> Featured
        </span>
      )}

      {event.status === "ongoing" && (
        <span className="absolute bottom-3 left-3 flex items-center gap-1.5 rounded-full bg-[#BA1A1A] px-3 py-1 text-[11px] font-semibold text-white shadow-sm">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" /> Live
        </span>
      )}
    </div>
  );
}

function usePrefetchOnHookSafe(slug?: string) {
  const handlers = usePrefetchOnHover<unknown>(["event", slug || "none"], slug ? `/events/slug/${slug}` : "");
  return slug ? handlers : {};
}

export function EventCard({ event, className }: { event: EventCardData; className?: string }) {
  const prefetch = usePrefetchOnHookSafe(event.slug);
  const date = formatDate(event.startDate);
  const isOnline = event.eventType === "online";
  const isFree = !event.price || event.price === 0;
  const isPast = event.status === "past" || event.status === "ended";
  const participants = event.registrationCount ?? event.participantCount ?? 0;
  const spotsLeft =
    typeof event.maxAttendees === "number" && typeof participants === "number" ? event.maxAttendees - participants : null;

  return (
    <Link
      href={`/events/${event.slug}`}
      {...prefetch}
      className={cn(
        "group flex flex-col overflow-hidden rounded-[1.125rem] border bg-white transition-all duration-200",
        "border-[#E4E9F4] shadow-[0px_4px_16px_rgba(24,39,75,0.04),0px_1px_2px_rgba(24,39,75,0.02)]",
        "hover:-translate-y-0.5 hover:border-[#2563FF]/40 hover:shadow-[0px_10px_40px_rgba(24,39,75,0.08),0px_2px_6px_rgba(24,39,75,0.03)]",
        "dark:bg-[#0a0a0a] dark:border-[#262626] dark:hover:border-[#3b82f6]/40 dark:hover:shadow-[0px_10px_40px_rgba(0,0,0,0.6)]",
        isPast && "opacity-80",
        className
      )}
    >
      <Poster event={event} />

      <div className="flex flex-1 flex-col gap-2.5 p-4">
        <div className="flex items-center gap-3 text-[12px] font-semibold tracking-[0.02em] text-[#64709A] dark:text-[#a1a1aa]">
          {date ? (
            <span className="inline-flex items-center gap-1 text-[#2563FF] dark:text-[#3b82f6]">
              <CalendarDays className="h-3.5 w-3.5" /> {date}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1">
              <CalendarDays className="h-3.5 w-3.5" /> {formatDateRange(event.startDate, event.endDate)}
            </span>
          )}
          {event.startTime && (
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" /> {event.startTime}
            </span>
          )}
        </div>

        <h3 className="line-clamp-2 text-[16px] font-semibold leading-[1.4] tracking-[-0.01em] text-[#0B1235] dark:text-[#ededed] group-hover:text-[#2563FF] dark:group-hover:text-[#3b82f6] transition-colors" style={{ fontFamily: "Inter, sans-serif" }}>
          {event.title}
        </h3>

        {event.description && (
          <p className="line-clamp-2 text-[13px] leading-[1.5] text-[#64709A] dark:text-[#a1a1aa]" style={{ fontFamily: "Inter, sans-serif" }}>
            {event.description}
          </p>
        )}

        <div className="flex items-center gap-1.5 text-[13px] text-[#64709A] dark:text-[#a1a1aa]">
          {isOnline ? (
            <>
              <Video className="h-3.5 w-3.5 shrink-0 text-[#7C3AED]" />
              <span className="truncate">Online{event.platform ? ` · ${event.platform}` : ""}</span>
            </>
          ) : (
            <>
              <MapPin className="h-3.5 w-3.5 shrink-0 text-[#7C3AED]" />
              <span className="line-clamp-1 truncate">{event.venue || "Venue TBA"}</span>
            </>
          )}
          {event.eventType === "hybrid" && (
            <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-[#EDE9FE] dark:bg-[#1e1b2e] border border-[#DDD6FE] dark:border-[#2a2a3a] px-2 py-0.5 text-[10px] font-semibold text-[#7C3AED] dark:text-[#8b5cf6]">
              <Wifi className="h-3 w-3" /> Hybrid
            </span>
          )}
        </div>

        <div className="mt-auto flex items-center justify-between gap-2 border-t border-[#E4E9F4] dark:border-[#262626] pt-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            {event.organizer && <span className="truncate text-[11px] font-semibold tracking-[0.02em] text-[#64709A] dark:text-[#a1a1aa]">by {event.organizer}</span>}
            {event.organization?.name && !event.organizer && (
              <span className="truncate text-[11px] font-semibold tracking-[0.02em] text-[#64709A] dark:text-[#a1a1aa]">by {event.organization.name}</span>
            )}
            {participants > 0 && (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[#64709A] dark:text-[#a1a1aa]">
                <Users className="h-3 w-3" /> {participants} registered
              </span>
            )}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <span className={cn("rounded-full px-3 py-1 text-[11px] font-semibold tracking-[0.02em]", isFree ? "bg-[#E8F9EE] text-[#16a34a] border border-[#86EFAC]/30 dark:bg-[#052e16] dark:text-[#22c55e] dark:border-[#14532d]/50" : "bg-[#EFF6FF] text-[#2563FF] border border-[#BFDBFE] dark:bg-[#0f172a] dark:text-[#3b82f6] dark:border-[#1e3a5f]/50")}>
              {isFree ? "Free" : `₹${event.price}`}
            </span>
            {spotsLeft !== null && spotsLeft <= 10 && spotsLeft > 0 && <span className="text-[10px] font-semibold text-[#D97706]">{spotsLeft} spots left</span>}
            {spotsLeft !== null && spotsLeft <= 0 && <span className="text-[10px] font-semibold text-[#BA1A1A] dark:text-[#ef4444]">Full</span>}
          </div>
        </div>
      </div>
    </Link>
  );
}
