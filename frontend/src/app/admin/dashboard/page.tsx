"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Activity,
  ArrowRight,
  Megaphone,
  Settings2,
  CalendarDays,
  CalendarPlus,
  CheckCircle2,
  FileDown,
  Ticket,
  UserPlus,
  Users,
} from "lucide-react";
import { api } from "@/utils/api";
import { useSessionUser } from "@/components/shell/use-session-user";
import { cloudinaryUrl } from "@/utils/image";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, Skeleton } from "@/components/states";
import { cn } from "@/lib/utils";
import { AnalyticsCharts } from "@/components/admin/analytics-charts";

interface Stats {
  totalUsers: number;
  totalEvents: number;
  activeParticipants: number;
  totalRegistrations: number;
  upcomingEvents: number;
  recentRegistrations: number;
}

interface ActivityItem {
  _id: string;
  type: string;
  title: string;
  description: string;
  timestamp: string;
}

export default function AdminDashboardPage() {
  const router = useRouter();
  const [stats, setStats] = useState<Stats | null>(null);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [upcomingEvents, setUpcomingEvents] = useState<any[]>([]);
  const { user } = useSessionUser();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(false);
    try {
      const [statsRes, activityRes, upRes] = await Promise.all([
        api.get("/admin/stats").catch(() => null),
        api.get("/admin/activity").catch(() => null),
        api.get("/events/admin/list", { params: { status: "upcoming", limit: 4 } }).catch(() => null),
      ]);
      setStats(statsRes?.data ?? null);
      setActivity(activityRes?.data?.activity ?? []);

      // Upcoming events with real registration counts
      let events: any[] = upRes?.data?.events ?? [];
      const ids = events.map((e: any) => e._id);
      if (ids.length) {
        try {
          const countsRes = await api.post("/registration/responses/counts/batch", { eventIds: ids });
          const counts = countsRes.data?.counts ?? {};
          events = events.map((e: any) => ({ ...e, count: counts[e._id] ?? 0 }));
        } catch {
          events = events.map((e: any) => ({ ...e, count: undefined }));
        }
      }
      setUpcomingEvents(events);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const tiles = stats
    ? [
        { label: "Total users", value: stats.totalUsers, icon: Users, color: "text-primary", bg: "bg-brand-light" },
        { label: "Events", value: stats.totalEvents, icon: CalendarDays, color: "text-purple", bg: "bg-purple-light" },
        { label: "Registrations", value: stats.totalRegistrations, icon: Ticket, color: "text-cyan", bg: "bg-cyan/10" },
        { label: "Checked-in attendees", value: stats.activeParticipants, icon: CheckCircle2, color: "text-success", bg: "bg-success-light" },
        { label: "Upcoming events", value: stats.upcomingEvents, icon: CalendarPlus, color: "text-primary", bg: "bg-brand-light" },
        { label: "Registrations (7 days)", value: stats.recentRegistrations, icon: Activity, color: "text-warning", bg: "bg-warning-light" },
      ]
    : [];

  return (
    <div className="mx-auto max-w-6xl">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-foreground">
            {new Date().getHours() < 12 ? "Good morning" : new Date().getHours() < 17 ? "Good afternoon" : "Good evening"}
            {user?.firstName ? `, ${user.firstName}` : ""}
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })} · your events at a glance
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild className="font-semibold">
            <Link href="/admin/events/create">
              <CalendarPlus className="mr-2 h-4 w-4" /> Create Event
            </Link>
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="mt-8">
        {error ? (
          <ErrorState title="Couldn't load stats" onRetry={load} />
        ) : loading ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-28" />
            ))}
          </div>
        ) : stats ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
            {tiles.map((t) => (
              <div
                key={t.label}
                className="rounded-xl border border-border bg-card p-4 transition-shadow hover:shadow-sm"
              >
                <div className={cn("flex h-9 w-9 items-center justify-center rounded-lg", t.bg)}>
                  <t.icon className={cn("h-[18px] w-[18px]", t.color)} />
                </div>
                <p className="mt-3 text-2xl font-extrabold text-foreground">{t.value}</p>
                <p className="mt-0.5 text-[11px] font-medium leading-tight text-muted-foreground">
                  {t.label}
                </p>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {/* Quick actions */}
      <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { title: "Create a new event", desc: "Publish in minutes with posters, tickets and custom forms", href: "/admin/events/create", icon: CalendarPlus },
          upcomingEvents[0]
            ? { title: "Manage participants", desc: `Registrations for ${upcomingEvents[0].title}`, href: `/admin/events/${upcomingEvents[0]._id}/registrations`, icon: Users }
            : { title: "Manage registrations", desc: "View, export and track participants for your events", href: "/admin/events", icon: Users },
          upcomingEvents[0]
            ? { title: "View analytics", desc: "Attendance and engagement insights", href: `/admin/events/${upcomingEvents[0]._id}/analytics`, icon: Activity }
            : { title: "Scan tickets at entry", desc: "QR check-in and check-out from any phone camera", href: "/admin/events", icon: Ticket },
          upcomingEvents[0]
            ? { title: "Send announcement", desc: "Email everyone about your next event", href: `/admin/events/${upcomingEvents[0]._id}`, icon: Megaphone }
            : { title: "All events", desc: "Browse and manage everything you run", href: "/admin/events", icon: Settings2 },
        ].map((a) => (
          <Link
            key={a.title}
            href={a.href}
            className="group flex items-start gap-4 rounded-xl border border-border bg-card p-5 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-sm"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-light text-primary">
              <a.icon className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="flex items-center gap-1 text-sm font-bold text-foreground">
                {a.title}
                <ArrowRight className="h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
              </p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{a.desc}</p>
            </div>
          </Link>
        ))}
      </div>

      {/* Upcoming events */}
      <section className="mt-10">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-foreground">Upcoming events</h2>
          <Link href="/admin/events" className="text-xs font-semibold text-primary hover:underline">
            View all →
          </Link>
        </div>
        <div className="mt-4 overflow-hidden rounded-xl border border-border bg-card">
          {loading ? (
            <div className="space-y-3 p-5">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-14" />
              ))}
            </div>
          ) : upcomingEvents.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={CalendarDays}
                title="No upcoming events"
                description="Create your next event and it will appear here."
                actionLabel="Create event"
                onAction={() => router.push("/admin/events/create")}
              />
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {upcomingEvents.map((e) => (
                <li key={e._id} className="flex items-center gap-3.5 px-4 py-3.5 sm:px-5">
                  <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-muted">
                    {e.bannerUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={cloudinaryUrl(e.bannerUrl, { w: 96, h: 96 })} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-brand-light text-primary">
                        <CalendarDays className="h-5 w-5" />
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-foreground">{e.title}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {[e.category, e.startDate && new Date(e.startDate).toLocaleDateString("en-IN", { day: "numeric", month: "short" }), e.eventType === "online" ? "Online" : e.venue]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  <span className="hidden shrink-0 text-xs font-semibold text-muted-foreground sm:block">
                    {e.count != null ? `${e.count} registered` : "—"}
                  </span>
                  <Button size="sm" variant="outline" asChild className="shrink-0">
                    <Link href={`/admin/events/${e._id}`}>
                      <Settings2 className="mr-1 h-3.5 w-3.5" /> Manage
                    </Link>
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* Platform analytics (Phase 11) */}
      <AnalyticsCharts />

      {/* Recent activity */}
      <section className="mt-10">
        <h2 className="text-lg font-bold text-foreground">Recent activity</h2>
        <div className="mt-4 overflow-hidden rounded-xl border border-border bg-card">
          {loading ? (
            <div className="space-y-3 p-5">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-12" />
              ))}
            </div>
          ) : activity.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={Activity}
                title="No recent activity"
                description="Registrations and new users will show up here."
              />
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {activity.slice(0, 10).map((item) => (
                <li key={item._id} className="flex items-center gap-3.5 px-5 py-3.5">
                  <span
                    className={cn(
                      "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
                      item.type === "registration" ? "bg-brand-light text-primary" : "bg-success-light text-success"
                    )}
                  >
                    {item.type === "registration" ? (
                      <Ticket className="h-4 w-4" />
                    ) : (
                      <UserPlus className="h-4 w-4" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">{item.title}</p>
                    <p className="truncate text-xs text-muted-foreground">{item.description}</p>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {new Date(item.timestamp).toLocaleDateString("en-IN", {
                      day: "numeric",
                      month: "short",
                    })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
