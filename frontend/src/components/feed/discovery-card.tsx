"use client";

import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { ArrowRight, CalendarDays, MapPin, Users } from "lucide-react";
import { api } from "@/utils/api";
import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/user-avatar";
import { FollowAuthorButton } from "@/components/feed/follow-author-button";
import { useSessionUser } from "@/components/shell/use-session-user";
import type { DiscoveryCommunity, DiscoveryEvent, DiscoveryPerson } from "@/components/feed/use-feed-discovery";

/**
 * One card in the feed's rhythm — see `docs/PHASE4_FEED_AUDIT.md`.
 *
 * The feed was ten identical post cards in a column. This is the one shape that
 * breaks it: a real, actionable row of things the viewer does not already see,
 * rendered between posts. Three rules it follows, all of them from the brief:
 *
 *   · Real data only. Every row is an object the API returned; a kind with no
 *     rows renders nothing rather than an empty shell.
 *   · No invented numbers. A count is displayed only when the API sent one
 *     (`memberCount` is absent on some community responses — then it is not
 *     shown, not zero).
 *   · Quiet chrome. Border + card, one accent for the action. No gradient
 *     (reserved for primary CTAs and milestones), no metric theatre.
 */

type Kind = "events" | "people" | "communities";

const HEADINGS: Record<Kind, { title: string; sub: string; href: string; Icon: typeof Users }> = {
  events: { title: "Events worth showing up to", sub: "Happening soon", href: "/events", Icon: CalendarDays },
  people: { title: "People you may know", sub: "From your events and institution", href: "/search?tab=people", Icon: Users },
  communities: { title: "Communities to join", sub: "Find your people", href: "/communities", Icon: Users },
};

function Shell({
  kind,
  children,
}: {
  kind: Kind;
  children: React.ReactNode;
}) {
  const h = HEADINGS[kind];
  return (
    <section
      className="overflow-hidden rounded-xl border border-border bg-card"
      aria-label={h.title}
      data-discovery={kind}
    >
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-muted text-primary">
            <h.Icon className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-[13px] font-bold text-foreground">{h.title}</p>
            <p className="truncate text-[11px] text-muted-foreground">{h.sub}</p>
          </div>
        </div>
        <Link
          href={h.href}
          className="shrink-0 text-[12px] font-semibold text-primary hover:underline"
        >
          See all
        </Link>
      </header>
      <div className="divide-y divide-border">{children}</div>
    </section>
  );
}

function EventRow({ event }: { event: DiscoveryEvent }) {
  const when = event.startDate ? formatWhen(event.startDate) : "";
  return (
    <Link
      href={`/events/${event.slug}`}
      className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/50"
    >
      {event.bannerUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={event.bannerUrl}
          alt=""
          loading="lazy"
          className="h-12 w-12 shrink-0 rounded-lg object-cover"
        />
      ) : (
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-brand-light text-primary">
          <CalendarDays className="h-5 w-5" />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold text-foreground">{event.title}</span>
        <span className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
          {when ? <span className="shrink-0">{when}</span> : null}
          {event.venue ? (
            <span className="flex min-w-0 items-center gap-0.5">
              <MapPin className="h-3 w-3 shrink-0" />
              <span className="truncate">{event.venue}</span>
            </span>
          ) : null}
        </span>
      </span>
      <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </Link>
  );
}

function PeopleRow({ person }: { person: DiscoveryPerson }) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <Link href={profileHref(person)} className="shrink-0" aria-label={`View ${nameOf(person)}'s profile`}>
        <UserAvatar user={person} size={40} />
      </Link>
      <div className="min-w-0 flex-1">
        <Link href={profileHref(person)} className="block truncate text-[13px] font-semibold text-foreground hover:underline">
          {nameOf(person)}
        </Link>
        <p className="truncate text-[11px] text-muted-foreground">
          {person.username ? `@${person.username}` : "On EventHub"}
          {person.profile?.institution ? ` · ${person.profile.institution}` : ""}
        </p>
      </div>
      {/* The same follow pill the posts and profiles use — one implementation,
          optimistic, so the label flips before the request resolves. */}
      <FollowAuthorButton userId={person._id} initialFollowing={false} />
    </div>
  );
}

function CommunityRow({ community }: { community: DiscoveryCommunity }) {
  const { user } = useSessionUser();
  const [joined, setJoined] = useState(false);
  const [busy, setBusy] = useState(false);

  const icon = community.iconUrl || community.logoUrl;

  const join = async () => {
    if (busy) return;
    if (!user) {
      toast.info("Sign in to join communities");
      return;
    }
    setBusy(true);
    /* Optimistic, like every other action in this feed: the label changes on
       tap and rolls back only if the server says no. */
    setJoined(true);
    try {
      const res = await api.post(`/communities/${community.slug}/join`);
      if (res.data?.success === false) throw new Error(res.data?.message);
      toast.success(`Joined ${community.name}`);
    } catch {
      setJoined(false);
      toast.error("Couldn't join that community");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <Link href={`/communities/${community.slug}`} className="shrink-0" aria-label={`Open ${community.name}`}>
        {icon ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={icon} alt="" loading="lazy" className="h-10 w-10 rounded-lg object-cover" />
        ) : (
          <span className="grid h-10 w-10 place-items-center rounded-lg bg-purple-light text-purple">
            <Users className="h-4 w-4" />
          </span>
        )}
      </Link>
      <div className="min-w-0 flex-1">
        <Link href={`/communities/${community.slug}`} className="block truncate text-[13px] font-semibold text-foreground hover:underline">
          {community.name}
        </Link>
        {/* Only shown when the API actually sent a count. */}
        <p className="truncate text-[11px] text-muted-foreground">
          {typeof community.memberCount === "number"
            ? `${community.memberCount} ${community.memberCount === 1 ? "member" : "members"}`
            : community.description || "Community"}
        </p>
      </div>
      <button
        type="button"
        onClick={join}
        disabled={busy || joined}
        className={cn(
          "shrink-0 rounded-full px-3 py-1 text-[11px] font-bold transition-colors active:scale-[0.97]",
          joined
            ? "border border-border bg-muted text-muted-foreground"
            : "bg-primary text-primary-foreground hover:opacity-90"
        )}
      >
        {joined ? "Joined" : "Join"}
      </button>
    </div>
  );
}

/**
 * The card. Renders `null` when the kind has no rows — the stream then simply
 * does not place a gap there.
 */
export function DiscoveryCard({
  kind,
  events = [],
  people = [],
  communities = [],
}: {
  kind: Kind;
  events?: DiscoveryEvent[];
  people?: DiscoveryPerson[];
  communities?: DiscoveryCommunity[];
}) {
  const rows =
    kind === "events" ? events.slice(0, 3) : kind === "people" ? people.slice(0, 3) : communities.slice(0, 3);
  if (rows.length === 0) return null;

  return (
    <Shell kind={kind}>
      {kind === "events"
        ? events.slice(0, 3).map((e) => <EventRow key={e._id} event={e} />)
        : kind === "people"
          ? people.slice(0, 3).map((p) => <PeopleRow key={p._id} person={p} />)
          : communities.slice(0, 3).map((c) => <CommunityRow key={c._id} community={c} />)}
    </Shell>
  );
}

/* ── helpers ─────────────────────────────────────────────── */

function nameOf(p: DiscoveryPerson) {
  return `${p.firstName || ""} ${p.lastName || ""}`.trim() || p.username || "Someone";
}

function profileHref(p: DiscoveryPerson) {
  return p.username ? `/profile/${p.username}` : `/profile/${p._id}`;
}

/**
 * "Sat, 12 Oct · 6:30 pm" — but never relative, because a discovery card is
 * about *when to show up*, and "in 3 days" is worse at that than a date.
 * Rendered with `toLocaleDateString` in the viewer's own locale, not a
 * hardcoded English month list.
 */
function formatWhen(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  try {
    return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
  } catch {
    return d.toDateString().slice(0, 10);
  }
}
