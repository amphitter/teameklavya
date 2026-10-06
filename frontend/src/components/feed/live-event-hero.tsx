"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { cloudinaryUrl } from "@/utils/image";
import { compactCount } from "@/lib/social";

/** An ongoing event the signed-in user is registered to (real data only). */
export interface LiveEventData {
  _id: string;
  title: string;
  slug: string;
  description?: string;
  bannerUrl?: string;
  startDate: string;
  endDate: string;
  venue?: string;
  eventType?: string;
  participantCount?: number;
  quizPlayers?: number; // real count from the live quiz leaderboard
  liveQuizId?: string; // set when the event has a quiz currently live
}

const GRADIENT_CTA =
  "bg-gradient-to-r from-[#2563FF] via-[#6C35FF] to-[#D946EF] text-white shadow-lg shadow-[#2563FF]/25 hover:opacity-95";

function dateRange(startIso: string, endIso: string): string {
  const s = new Date(startIso);
  const e = new Date(endIso);
  const sameDay = s.toDateString() === e.toDateString();
  const start = s.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  if (sameDay) return `${start}, ${s.getFullYear()}`;
  const end = e.toLocaleDateString("en-US", s.getMonth() === e.getMonth() ? { day: "numeric" } : { month: "short", day: "numeric" });
  return `${start} – ${end}, ${e.getFullYear()}`;
}

/** Real countdown to the event's end date ("Ends in: 14h 22m"). */
function endsIn(endIso: string): string | null {
  const ms = new Date(endIso).getTime() - Date.now();
  if (ms <= 0) return null;
  const d = Math.floor(ms / 86_400_000);
  const h = Math.floor((ms % 86_400_000) / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return d > 0 ? `${d}d ${h}h` : `${h}h ${m}m`;
}

function Banner({ e, className }: { e: LiveEventData; className?: string }) {
  return e.bannerUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={cloudinaryUrl(e.bannerUrl, { w: 1000, h: 560 }) || e.bannerUrl}
      alt=""
      className={className}
    />
  ) : (
    <div className={`${className} bg-gradient-to-br from-[#2563FF] via-[#6C35FF] to-[#D946EF]`} />
  );
}

function LiveBadge() {
  return (
    <span className="flex items-center gap-1.5 rounded-full bg-[#ba1a1a] px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white shadow-md">
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white/80" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-white" />
      </span>
      Live Now
    </span>
  );
}

/* ── Phone layout (per phone home reference): banner + badges + timer on
      top, content (meta, title, description, metric bar, actions) below ── */
function MobileHeroCard({ e }: { e: LiveEventData }) {
  const joinHref = e.liveQuizId ? `/quiz/${e.liveQuizId}` : `/events/${e.slug}`;
  const remaining = endsIn(e.endDate);

  return (
    <article className="overflow-hidden rounded-[20px] bg-card shadow-[0_10px_32px_rgba(24,39,75,0.08)]">
      <Link href={joinHref} className="block" aria-label={`Open ${e.title}`}>
        <div className="relative h-44 w-full">
          <Banner e={e} className="absolute inset-0 h-full w-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-card via-[#000826]/40 to-transparent" />

          <div className="absolute left-3 right-3 top-3 flex items-center justify-between gap-2">
            <LiveBadge />
            <span className="rounded-full bg-card/90 px-2.5 py-1 text-[11px] font-semibold text-primary shadow-sm backdrop-blur-md">
              Featured
            </span>
          </div>

          {remaining && (
            <div className="absolute bottom-3 left-3 flex items-center gap-1.5 rounded-lg bg-[#272e52]/80 px-2.5 py-1 text-white backdrop-blur-md">
              <span className="material-symbols-outlined text-[16px] text-[#b6c4ff]">timer</span>
              <span className="text-[11px]">
                Ends in: <b className="font-bold">{remaining}</b>
              </span>
            </div>
          )}
        </div>
      </Link>

      <div className="flex flex-col gap-3 p-4">
        <div>
          <div className="mb-1 flex items-center gap-2 text-[11px] font-semibold text-primary">
            <span className="material-symbols-outlined text-[16px] leading-none">calendar_month</span>
            <span className="whitespace-nowrap">{dateRange(e.startDate, e.endDate)}</span>
            <span className="h-1 w-1 shrink-0 rounded-full bg-border" />
            <span className="material-symbols-outlined text-[16px] leading-none">location_on</span>
            <span className="truncate">
              {e.venue || `${e.eventType ? e.eventType : "live"} event`}
            </span>
          </div>
          <h2 className="text-xl font-semibold leading-snug text-foreground">{e.title}</h2>
          {e.description && (
            <p className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-muted-foreground">
              {e.description}
            </p>
          )}
        </div>

        <div className="flex items-center justify-between rounded-xl bg-muted px-3 py-2">
          <span className="flex items-center gap-2 text-[11px] font-medium text-foreground">
            <span className="grid h-6 w-6 place-items-center rounded-full bg-gradient-to-br from-[#2563FF] to-[#6C35FF] text-white">
              <span className="material-symbols-outlined text-[14px] leading-none">groups</span>
            </span>
            {typeof e.participantCount === "number"
              ? `${compactCount(e.participantCount)} Registered`
              : "Registered participants"}
          </span>
          {typeof e.quizPlayers === "number" && e.quizPlayers > 0 && (
            <span className="flex items-center gap-1 text-[11px] font-semibold text-primary">
              <span className="material-symbols-outlined text-[16px] leading-none">trophy</span>
              {e.quizPlayers} on the board
            </span>
          )}
        </div>

        <div className="grid grid-cols-5 gap-2 pt-1">
          <Link
            href={joinHref}
            className="col-span-3 flex h-12 items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-[#2563FF] via-[#6C35FF] to-[#D946EF] text-sm font-semibold text-white shadow-[0_6px_20px_rgba(37,99,255,0.3)] transition-transform active:scale-[0.98]"
          >
            Enter Live Hub
            <span className="material-symbols-outlined text-[18px] leading-none">arrow_forward</span>
          </Link>
          <Link
            href={`/events/${e.slug}`}
            className="col-span-2 flex h-12 items-center justify-center gap-1 rounded-xl bg-muted text-sm font-semibold text-foreground transition-colors hover:bg-muted/70"
          >
            <span className="material-symbols-outlined text-[18px] leading-none text-primary">event_note</span>
            Agenda
          </Link>
        </div>
      </div>
    </article>
  );
}

/* ── Desktop layout (per desktop reference): meta + title over the poster,
      action strip below the image ── */
function DesktopHeroCard({ e }: { e: LiveEventData }) {
  const joinHref = e.liveQuizId ? `/quiz/${e.liveQuizId}` : `/events/${e.slug}`;
  return (
    <article className="overflow-hidden rounded-2xl border border-border bg-card shadow-[0_10px_40px_rgba(24,39,75,0.08)]">
      <Link href={joinHref} className="block" aria-label={`Open ${e.title}`}>
        <div className="relative h-56 sm:h-64">
          <Banner e={e} className="absolute inset-0 h-full w-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-[#0B1235] via-[#0B1235]/35 to-transparent" />

          <div className="absolute left-4 top-4 flex items-center gap-2">
            <LiveBadge />
            <span className="rounded-full border border-white/25 bg-white/10 px-3 py-1 text-[11px] font-semibold text-white backdrop-blur-sm">
              Featured
            </span>
          </div>

          <div className="absolute inset-x-0 bottom-0 p-4 sm:p-5">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] font-medium text-white/90">
              <span className="flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[16px] leading-none">event</span>
                {dateRange(e.startDate, e.endDate)}
              </span>
              {e.venue ? (
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="material-symbols-outlined text-[16px] leading-none">location_on</span>
                  <span className="truncate">{e.venue}</span>
                </span>
              ) : (
                e.eventType && (
                  <span className="flex items-center gap-1.5 capitalize">
                    <span className="material-symbols-outlined text-[16px] leading-none">videocam</span>
                    {e.eventType} event
                  </span>
                )
              )}
            </div>
            <h2 className="mt-1.5 line-clamp-2 text-xl font-extrabold leading-snug text-white sm:text-2xl">
              {e.title}
            </h2>
          </div>
        </div>
      </Link>

      <div className="flex flex-wrap items-center gap-3 border-t border-border px-4 py-3.5 sm:px-5">
        <span className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#2563FF] to-[#6C35FF] text-white">
            <span className="material-symbols-outlined text-[18px] leading-none">groups</span>
          </span>
          {typeof e.participantCount === "number" ? (
            <>
              <b className="font-semibold text-foreground">{compactCount(e.participantCount)}</b> registered
            </>
          ) : (
            "Registered participants"
          )}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Button asChild size="sm" variant="outline">
            <Link href={`/events/${e.slug}`}>Agenda</Link>
          </Button>
          <Button asChild size="sm" className={GRADIENT_CTA}>
            <Link href={joinHref}>
              Enter Live Hub
              <span className="material-symbols-outlined ml-1 text-[16px] leading-none">arrow_forward</span>
            </Link>
          </Button>
        </div>
      </div>
    </article>
  );
}

/**
 * Live-event hero cards — the user's ongoing events come first on the home
 * feed. "Enter Live Hub" deep-links to the live quiz when one is running,
 * otherwise to the event page. Counts are real (registration counts/batch).
 */
export function LiveEventHero({ events }: { events: LiveEventData[] }) {
  if (!events.length) return null;

  return (
    <div className="space-y-5">
      {events.slice(0, 2).map((e) => (
        <div key={e._id}>
          <div className="lg:hidden">
            <MobileHeroCard e={e} />
          </div>
          <div className="hidden lg:block">
            <DesktopHeroCard e={e} />
          </div>
        </div>
      ))}
    </div>
  );
}
