"use client";

import Link from "next/link";
import { Ticket, Clock, MapPin } from "lucide-react";
import { cloudinaryUrl } from "@/utils/image";
import { Button } from "@/components/ui/button";

interface NextUpEvent {
  _id: string;
  title: string;
  slug: string;
  bannerUrl?: string;
  startDate: string;
  venue?: string;
  eventType?: string;
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

export function NextUpTicketCard({ event }: { event: NextUpEvent }) {
  return (
    <div className="relative overflow-hidden rounded-[16px] border border-border bg-card shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
      {/* Subtle raised treatment only on interactive card */}
      <div className="flex gap-3 p-3 sm:p-4">
        {event.bannerUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={cloudinaryUrl(event.bannerUrl, { w: 160, h: 160 }) || event.bannerUrl}
            alt=""
            className="h-16 w-16 shrink-0 rounded-[12px] object-cover sm:h-20 sm:w-20"
            loading="lazy"
          />
        ) : (
          <div className="grid h-16 w-16 shrink-0 place-items-center rounded-[12px] bg-gradient-to-br from-primary/15 to-violet-500/15 sm:h-20 sm:w-20">
            <Ticket className="h-6 w-6 text-primary" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="inline-flex items-center gap-1 rounded-full bg-success/10 border border-success/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-success">
              <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
              Next up
            </span>
            <span className="text-[11px] text-muted-foreground hidden sm:inline">Ticket ready</span>
          </div>
          <h3 className="mt-1.5 line-clamp-1 text-[14px] font-bold leading-tight text-foreground sm:text-[15px]">
            {event.title}
          </h3>
          <div className="mt-1 flex flex-col gap-0.5 text-[12px] text-muted-foreground">
            <span className="flex items-center gap-1 truncate">
              <Clock className="h-3 w-3 shrink-0" />
              {fmtDate(event.startDate)}
            </span>
            {event.venue && (
              <span className="flex items-center gap-1 truncate">
                <MapPin className="h-3 w-3 shrink-0" />
                {event.eventType === "online" ? "Online" : event.venue}
              </span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 flex-col justify-center gap-2">
          <Button asChild size="sm" className="h-8 rounded-full px-4 text-[12px] font-semibold shadow-[0_1px_2px_rgba(0,0,0,0.08),0_1px_0_1px_rgba(255,255,255,0.6)_inset]">
            <Link href={`/events/${event.slug}`}>View ticket</Link>
          </Button>
          <Button asChild size="sm" variant="outline" className="h-8 rounded-full px-4 text-[12px]">
            <Link href={`/user/registrations`}>All tickets</Link>
          </Button>
        </div>
      </div>
      {/* Offline hint */}
      <div className="border-t border-border/60 bg-muted/30 px-3 py-1.5 text-[10px] text-muted-foreground sm:px-4">
        QR cached for offline • Opens in 1 tap at venue
      </div>
    </div>
  );
}
