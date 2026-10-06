"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import {
  BarChart3,
  CalendarDays,
  CheckCircle2,
  Clock3,
  ExternalLink,
  Megaphone,
  Pencil,
  QrCode,
  Radio,
  ScanLine,
  Ticket,
  UserCheck,
  Users,
  Target,
} from "lucide-react";
import { api } from "@/utils/api";
import { Button } from "@/components/ui/button";
import { PageLoader, ErrorState } from "@/components/states";
import { EventTabs } from "@/components/admin/event-tabs";
import { useSessionUser } from "@/components/shell/use-session-user";
import { cloudinaryUrl } from "@/utils/image";
import { cn } from "@/lib/utils";

/**
 * Event management — the organizer's command page.
 * Overview tab (this page) + Registrations + Analytics sub-pages.
 * When the event is LIVE, an announcement control becomes available.
 */
export default function EventManagementPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useSessionUser();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [event, setEvent] = useState<any>(null);
  const [regStats, setRegStats] = useState<any>(null);
  const [scanStats, setScanStats] = useState<any>(null);
  const [recent, setRecent] = useState<any[]>([]);
  const [announcing, setAnnouncing] = useState(false);

  const load = () => {
    setLoading(true);
    setError(null);
    Promise.all([
      api.get(`/events/${id}`).catch(() => null),
      api.get(`/registration/responses/${id}/stats`).catch(() => null),
      api.get(`/tickets/event/${id}/stats`).catch(() => null),
      api.get(`/registration/responses/${id}`).catch(() => null),
    ]).then(([evRes, regRes, scanRes, recRes]) => {
      if (evRes?.data?.event) {
        setEvent(evRes.data.event);
        if (regRes?.data?.stats) setRegStats(regRes.data.stats);
        if (scanRes?.data?.stats) setScanStats(scanRes.data.stats);
        if (recRes?.data?.responses) setRecent(recRes.data.responses.slice(0, 5));
      } else {
        setError(evRes?.data?.message || "Event not found");
      }
    }).finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const status = event
    ? new Date(event.endDate) < new Date()
      ? "past"
      : new Date(event.startDate) <= new Date()
        ? "ongoing"
        : "upcoming"
    : null;

  const sendAnnouncement = async () => {
    if (announcing) return;
    setAnnouncing(true);
    try {
      const res = await api.post(`/events/${id}/notify-all`);
      if (res.data?.success) {
        toast.success(`Announcement sent to ${res.data.sentCount} users`);
      } else {
        toast.error(res.data?.message || "Couldn't send announcement");
      }
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Couldn't send announcement");
    } finally {
      setAnnouncing(false);
    }
  };

  const copyLink = async () => {
    if (!event?.slug) return;
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/events/${event.slug}`);
      toast.success("Event link copied");
    } catch {
      toast.info(`${window.location.origin}/events/${event.slug}`);
    }
  };

  if (loading) return <PageLoader label="Loading event…" />;
  if (error || !event)
    return (
      <ErrorState
        title="Couldn't load event"
        description={error || "Unknown error"}
        onRetry={load}
      />
    );

  // Next session from the schedule
  const now = Date.now();
  const nextSession = (event.schedule || [])
    .filter((s: any) => (s.day ? new Date(`${s.day}T${s.time || "00:00"}`).getTime() >= now - 3600e3 : false))
    .sort((a: any, b: any) => new Date(`${a.day}T${a.time || "00:00"}`).getTime() - new Date(`${b.day}T${b.time || "00:00"}`).getTime())[0];

  const stats = [
    {
      label: "Registrations",
      value: regStats?.totalRegistrations ?? "—",
      sub: `${regStats?.confirmedRegistrations ?? 0} confirmed · ${regStats?.pendingRegistrations ?? 0} pending`,
      icon: Users,
      cls: "bg-brand-light text-primary",
    },
    {
      label: "Checked in",
      value: scanStats?.checkedInTickets ?? 0,
      sub: `of ${scanStats?.totalTickets ?? 0} tickets`,
      icon: UserCheck,
      cls: "bg-success-light text-success",
    },
    {
      label: "Attendance",
      value: scanStats?.attendanceRate != null ? `${Math.round(scanStats.attendanceRate)}%` : "—",
      sub: "scanned at venue",
      icon: ScanLine,
      cls: "bg-purple-light text-purple",
    },
    {
      label: "Capacity",
      value: `${regStats?.totalRegistrations ?? 0}/${event.maxAttendees ?? "∞"}`,
      sub: "spots taken",
      icon: Ticket,
      cls: "bg-muted text-muted-foreground",
    },
  ];

  return (
    <div className="space-y-5">
      {/* ── Header with poster backdrop ─────────────────── */}
      <div className="relative overflow-hidden rounded-xl border border-border">
        <div className="absolute inset-0">
          {event.bannerUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={cloudinaryUrl(event.bannerUrl, { w: 1200, h: 300 })} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="h-full w-full bg-gradient-to-br from-navy to-brand-dark" />
          )}
          <div className="absolute inset-0 bg-black/55" />
        </div>

        <div className="relative p-5 sm:p-7">
          <div className="flex flex-wrap items-center gap-2">
            {status === "ongoing" ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-destructive px-3 py-1 text-[11px] font-bold text-white">
                <span className="h-1.5 w-1.5 animate-live-pulse rounded-full bg-white" /> LIVE NOW
              </span>
            ) : status === "upcoming" ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1 text-[11px] font-bold text-white">
                <CalendarDays className="h-3 w-3" /> UPCOMING
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-[11px] font-bold text-muted-foreground">
                <Clock3 className="h-3 w-3" /> ENDED
              </span>
            )}
            {event.isFeatured && (
              <span className="rounded-full bg-purple px-3 py-1 text-[11px] font-bold text-white">FEATURED</span>
            )}
            {event.visibility !== "public" && (
              <span className="rounded-full bg-white/20 px-3 py-1 text-[11px] font-bold text-white uppercase backdrop-blur">
                {event.visibility}
              </span>
            )}
          </div>

          <h1 className="mt-3 text-2xl font-bold tracking-tight text-white sm:text-3xl">{event.title}</h1>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-white/80">
            <span className="inline-flex items-center gap-1.5">
              <CalendarDays className="h-4 w-4" />
              {new Date(event.startDate).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
            </span>
            <span className="inline-flex items-center gap-1.5">
              {event.eventType === "online" ? <Radio className="h-4 w-4" /> : <ScanLine className="h-4 w-4" />}
              {event.eventType === "online" ? "Online" : event.venue || "In person"}
            </span>
            {event.organization?.name && <span className="inline-flex items-center gap-1.5"><Users className="h-4 w-4" /> {event.organization.name}</span>}
          </p>

          <div className="mt-5 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => router.push(`/admin/events/edit/${id}`)} className="gap-1.5">
              <Pencil className="h-3.5 w-3.5" /> Edit event
            </Button>
            {event.slug && (
              <Link href={`/events/${event.slug}`} target="_blank">
                <Button size="sm" variant="outline" className="gap-1.5 border-white/30 bg-white/10 text-white hover:bg-white/20 hover:text-white">
                  <ExternalLink className="h-3.5 w-3.5" /> Public page
                </Button>
              </Link>
            )}
            <Button size="sm" variant="outline" onClick={copyLink} className="gap-1.5 border-white/30 bg-white/10 text-white hover:bg-white/20 hover:text-white">
              Copy link
            </Button>
            <Link href={`/admin/events/${id}/scan`}>
              <Button size="sm" variant="outline" className="gap-1.5 border-white/30 bg-white/10 text-white hover:bg-white/20 hover:text-white">
                <QrCode className="h-3.5 w-3.5" /> Scan tickets
              </Button>
            </Link>
          </div>
        </div>
      </div>

      {/* ── LIVE command strip ──────────────────────────── */}
      {status === "ongoing" && (
        <div className="flex flex-col gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2.5 text-sm font-semibold text-destructive">
            <span className="h-2 w-2 animate-live-pulse rounded-full bg-destructive" />
            Live command center — your event is happening right now
          </div>
          <div className="flex shrink-0 gap-2">
            <Button size="sm" onClick={sendAnnouncement} disabled={announcing} className="gap-1.5">
              <Megaphone className="h-3.5 w-3.5" /> {announcing ? "Sending…" : "Send announcement"}
            </Button>
            <Link href={`/admin/events/${id}/scan`}>
              <Button size="sm" variant="outline" className="gap-1.5">
                <ScanLine className="h-3.5 w-3.5" /> Check-in scanner
              </Button>
            </Link>
            <Link href={`/admin/events/${id}/quiz`}>
              <Button size="sm" variant="outline" className="gap-1.5">
                <Target className="h-3.5 w-3.5" /> Run a live quiz
              </Button>
            </Link>
          </div>
        </div>
      )}

      {/* ── Tabs ────────────────────────────────────────── */}
      <EventTabs active="" />

      {/* ── Stats ───────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center gap-2.5">
              <span className={cn("flex h-9 w-9 items-center justify-center rounded-lg", s.cls)}>
                <s.icon className="h-4.5 w-4.5" />
              </span>
              <span className="text-2xl font-bold text-foreground">{s.value}</span>
            </div>
            <p className="mt-2 text-xs font-bold text-foreground">{s.label}</p>
            <p className="text-[11px] text-muted-foreground">{s.sub}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* ── Recent registrations ─────────────────────── */}
        <section className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-foreground">Recent registrations</h2>
            <Link href={`/admin/events/${id}/registrations`} className="text-xs font-semibold text-primary hover:underline">
              View all
            </Link>
          </div>
          <div className="mt-4 space-y-2">
            {recent.length === 0 && (
              <p className="rounded-lg border border-dashed border-border bg-muted/40 px-4 py-6 text-center text-sm text-muted-foreground">
                No registrations yet — share your event link to get the word out.
              </p>
            )}
            {recent.map((r) => (
              <div key={r._id} className="flex items-center gap-3 rounded-lg border border-border bg-background px-3.5 py-2.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-light text-xs font-bold text-primary">
                  {(r.userId?.firstName?.[0] || "?") + (r.userId?.lastName?.[0] || "")}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-foreground">
                    {r.userId?.firstName} {r.userId?.lastName}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {new Date(r.createdAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </p>
                </div>
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[10px] font-bold",
                    r.status === "confirmed" ? "bg-success-light text-success" : "bg-warning-light text-warning"
                  )}
                >
                  {r.status}
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* ── Next up ──────────────────────────────────── */}
        <section className="space-y-5">
          {nextSession && (
            <div className="rounded-xl border border-border bg-card p-5">
              <h2 className="flex items-center gap-2 text-base font-bold text-foreground">
                <Clock3 className="h-4 w-4 text-primary" /> Next up
              </h2>
              <div className="mt-3 rounded-lg border border-primary/30 bg-brand-light p-4">
                <p className="text-sm font-bold text-foreground">{nextSession.title}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {[nextSession.day && new Date(nextSession.day).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" }), nextSession.time]
                    .filter(Boolean)
                    .join(" · ")}
                  {nextSession.speakers?.length ? ` · ${nextSession.speakers.join(", ")}` : ""}
                </p>
                {nextSession.description && <p className="mt-2 text-xs text-muted-foreground">{nextSession.description}</p>}
              </div>
            </div>
          )}

          <div className="rounded-xl border border-border bg-card p-5">
            <h2 className="text-base font-bold text-foreground">Quick links</h2>
            <div className="mt-3 grid grid-cols-2 gap-2.5">
              {[
                { href: `/admin/events/${id}/registrations`, label: "Registrations", icon: Users },
                { href: `/admin/events/${id}/analytics`, label: "Analytics", icon: BarChart3 },
                { href: `/admin/events/${id}/scan`, label: "Scanner", icon: QrCode },
                { href: `/admin/events/${id}/quiz`, label: "Live quiz", icon: Target },
                { href: `/admin/events/${id}/edit`, label: "Edit event", icon: Pencil },
              ].map((q) => (
                <Link
                  key={q.label}
                  href={q.href}
                  className="flex items-center gap-2.5 rounded-lg border border-border bg-background px-3.5 py-3 text-sm font-semibold text-foreground transition-colors hover:border-primary/40 hover:text-primary"
                >
                  <q.icon className="h-4 w-4 text-primary" /> {q.label}
                </Link>
              ))}
            </div>
            {status === "upcoming" && (
              <Button size="sm" variant="outline" onClick={sendAnnouncement} disabled={announcing} className="mt-3 w-full gap-1.5">
                <Megaphone className="h-3.5 w-3.5" /> {announcing ? "Sending…" : "Email everyone about this event"}
              </Button>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
