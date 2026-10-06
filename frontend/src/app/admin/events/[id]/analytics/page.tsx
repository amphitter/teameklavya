"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { api } from "@/utils/api";
import { PageLoader, ErrorState, EmptyState } from "@/components/states";
import { EventTabs } from "@/components/admin/event-tabs";
import { TrendChart } from "@/components/admin/analytics-charts";
import { cn } from "@/lib/utils";
import {
  BarChart3,
  ChevronLeft,
  Clock3,
  ExternalLink,
  MailCheck,
  ScanLine,
  TrendingUp,
  UserCheck,
  Users,
} from "lucide-react";

export default function EventAnalyticsPage() {
  const { id } = useParams<{ id: string }>();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [event, setEvent] = useState<any>(null);
  const [regStats, setRegStats] = useState<any>(null);
  const [scanStats, setScanStats] = useState<any>(null);
  const [rsvp, setRsvp] = useState<any>(null);
  const [recent, setRecent] = useState<any[]>([]);
  const [engagement, setEngagement] = useState<any>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.get(`/events/${id}`).catch(() => null),
      api.get(`/registration/responses/${id}/stats`).catch(() => null),
      api.get(`/tickets/event/${id}/stats`).catch(() => null),
      api.get(`/events/${id}/rsvp-analytics`).catch(() => null),
      api.get(`/tickets/event/${id}/recent-scans`).catch(() => null),
      api.get(`/events/${id}/analytics`).catch(() => null),
    ]).then(([ev, reg, scan, rsv, rec, eng]) => {
      if (cancelled) return;
      if (ev?.data?.event) setEvent(ev.data.event);
      if (reg?.data?.stats) setRegStats(reg.data.stats);
      if (scan?.data?.stats) setScanStats(scan.data.stats);
      if (rsv?.data?.analytics) setRsvp(rsv.data.analytics);
      if (rec?.data?.scans) setRecent(rec.data.scans);
      if (eng?.data?.analytics) setEngagement(eng.data.analytics);
      if (!ev) setError("Failed to load event");
    }).finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loading) return <PageLoader label="Loading analytics…" />;
  if (error)
    return (
      <div className="space-y-4">
        <BackLink />
        <ErrorState title="Couldn't load analytics" description={error} />
      </div>
    );

  const hasAnyData = regStats || scanStats || rsvp;
  const daily: { date: string; count: number }[] = regStats?.dailyRegistrations || [];
  const maxDaily = Math.max(1, ...daily.map((d) => d.count));
  const sources = regStats?.sourceBreakdown || {};
  const totalSource = Object.values(sources).reduce((a: number, b: any) => a + Number(b || 0), 0);

  const userName = (u: any) => `${u?.firstName ?? ""} ${u?.lastName ?? ""}`.trim() || "Unknown";

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <BackLink />
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground">Analytics</h1>
          <p className="text-sm text-muted-foreground">{event?.title || "Event"}</p>
        </div>
        {event?.slug && (
          <Link href={`/events/${event.slug}`} target="_blank">
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3.5 py-2 text-xs font-semibold text-foreground hover:bg-muted">
              <ExternalLink className="h-3.5 w-3.5" /> Public page
            </span>
          </Link>
        )}
      </div>

      {!hasAnyData ? (
        <EmptyState
          icon={BarChart3}
          title="No analytics yet"
          description="Analytics appear once this event has registrations, tickets or RSVPs. Nothing to show right now — no made-up numbers here."
        />
      ) : (
        <>
          <EventTabs active="analytics" />

      {/* Registration overview */}
          <section className="rounded-xl border border-border bg-card p-5">
            <h2 className="flex items-center gap-2 text-base font-bold text-foreground">
              <Users className="h-4 w-4 text-primary" /> Registrations
            </h2>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { label: "Total", value: regStats?.totalRegistrations ?? 0 },
                { label: "Confirmed", value: regStats?.confirmedRegistrations ?? 0 },
                { label: "Pending", value: regStats?.pendingRegistrations ?? 0 },
                {
                  label: "Confirmation rate",
                  value: `${Math.round(regStats?.registrationRate ?? 0)}%`,
                },
              ].map((s) => (
                <div key={s.label} className="rounded-lg border border-border bg-background p-3.5">
                  <div className="text-xl font-bold text-foreground">{s.value}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">{s.label}</div>
                </div>
              ))}
            </div>

            {/* Source breakdown — real counts from the DB */}
            {totalSource > 0 && (
              <div className="mt-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Registered via</p>
                <div className="mt-2 flex h-2.5 overflow-hidden rounded-full bg-muted">
                  {Object.entries(sources)
                    .filter(([, v]: any) => Number(v) > 0)
                    .map(([k, v]: any, i, arr) => (
                      <div
                        key={k}
                        title={`${k}: ${v}`}
                        style={{ width: `${(Number(v) / totalSource) * 100}%` }}
                        className={cn(i === 0 && arr.length === 1 ? "bg-primary" : ["bg-primary", "bg-purple", "bg-cyan"][i % 3])}
                      />
                    ))}
                </div>
                <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
                  {Object.entries(sources)
                    .filter(([, v]: any) => Number(v) > 0)
                    .map(([k, v]: any) => (
                      <span key={k} className="capitalize">
                        <strong className="font-bold text-foreground">{v}</strong> {k}
                      </span>
                    ))}
                </div>
              </div>
            )}
          </section>

          {/* Daily registrations chart */}
          <section className="rounded-xl border border-border bg-card p-5">
            <h2 className="flex items-center gap-2 text-base font-bold text-foreground">
              <TrendingUp className="h-4 w-4 text-primary" /> Registrations per day
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">Last 30 days</p>
            {daily.length === 0 ? (
              <p className="mt-4 rounded-lg border border-dashed border-border bg-muted/40 px-4 py-6 text-center text-sm text-muted-foreground">
                No registrations in the last 30 days.
              </p>
            ) : (
              <div className="mt-5 flex h-44 items-end gap-1.5 overflow-x-auto pb-1">
                {daily.map((d) => (
                  <div key={d.date} className="group flex h-full min-w-[26px] flex-1 flex-col items-center justify-end gap-1.5">
                    <span className="text-[10px] font-bold text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
                      {d.count}
                    </span>
                    <div
                      className="w-full rounded-t-md bg-gradient-to-t from-primary to-cyan transition-all group-hover:from-primary/80"
                      style={{ height: `${(d.count / maxDaily) * 100}%`, minHeight: 4 }}
                    />
                    <span className="text-[9px] text-muted-foreground">{d.date.slice(5).replace("-", "/")}</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Attendance / tickets */}
          {scanStats && (
            <section className="rounded-xl border border-border bg-card p-5">
              <h2 className="flex items-center gap-2 text-base font-bold text-foreground">
                <ScanLine className="h-4 w-4 text-primary" /> Attendance
              </h2>
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  { label: "Tickets issued", value: scanStats.totalTickets ?? 0 },
                  { label: "Checked in", value: scanStats.checkedInTickets ?? 0 },
                  { label: "Checked out", value: scanStats.checkedOutTickets ?? 0 },
                  {
                    label: "Attendance rate",
                    value:
                      scanStats.attendanceRate != null
                        ? `${Math.round(scanStats.attendanceRate)}%`
                        : "0%",
                  },
                ].map((s) => (
                  <div key={s.label} className="rounded-lg border border-border bg-background p-3.5">
                    <div className="text-xl font-bold text-foreground">{s.value}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">{s.label}</div>
                  </div>
                ))}
              </div>
              {Array.isArray(scanStats.peakHours) && scanStats.peakHours.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Peak check-in hours:</span>
                  {scanStats.peakHours.map((p: any, i: number) => (
                    <span key={i} className="rounded-full bg-purple-light px-2.5 py-1 text-[11px] font-bold text-purple">
                      {String(p.hour).padStart(2, "0")}:00 · {p.count}
                    </span>
                  ))}
                </div>
              )}
            </section>
          )}

          {/* RSVP verification */}
          {rsvp?.rsvp && (rsvp.rsvp.sent > 0 || rsvp.rsvp.verified > 0) && (
            <section className="rounded-xl border border-border bg-card p-5">
              <h2 className="flex items-center gap-2 text-base font-bold text-foreground">
                <MailCheck className="h-4 w-4 text-primary" /> RSVP verification
              </h2>
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  { label: "Sent", value: rsvp.rsvp.sent },
                  { label: "Verified", value: rsvp.rsvp.verified },
                  { label: "Pending", value: rsvp.rsvp.pending },
                  { label: "Expired", value: rsvp.rsvp.expired },
                ].map((s) => (
                  <div key={s.label} className="rounded-lg border border-border bg-background p-3.5">
                    <div className="text-xl font-bold text-foreground">{s.value ?? 0}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">{s.label}</div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Community engagement (Phase 11: interest + top posts) */}
          {engagement && (
            <section className="rounded-xl border border-border bg-card p-5">
              <h2 className="flex items-center gap-2 text-base font-bold text-foreground">
                <TrendingUp className="h-4 w-4 text-primary" /> Community engagement
              </h2>
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  { label: "Interested", value: engagement.summary?.interested ?? 0 },
                  { label: "Registrations", value: engagement.summary?.registrations ?? 0 },
                  { label: "Checked in", value: engagement.summary?.checkedIn ?? 0 },
                  { label: "Check-in rate", value: `${engagement.summary?.checkInRate ?? 0}%` },
                ].map((s2) => (
                  <div key={s2.label} className="rounded-lg border border-border bg-background p-3.5">
                    <div className="text-xl font-bold text-foreground">{s2.value}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">{s2.label}</div>
                  </div>
                ))}
              </div>

              {(engagement.timeline?.length ?? 0) > 1 && (
                <div className="mt-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Registrations — last 30 days
                  </p>
                  <div className="mt-2">
                    <TrendChart data={engagement.timeline} color="#0058c9" />
                  </div>
                </div>
              )}

              {engagement.topPosts?.length > 0 && (
                <div className="mt-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Top posts about this event
                  </p>
                  <ul className="mt-2 space-y-2">
                    {engagement.topPosts.map((tp: any) => (
                      <li key={tp._id} className="rounded-lg border border-border bg-background px-3.5 py-2.5">
                        <p className="truncate text-sm text-foreground">{tp.content}</p>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          {userName(tp.author)} · {tp.likes} likes · {tp.comments} comments
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          )}

          {/* Recent check-ins */}
          <section className="rounded-xl border border-border bg-card p-5">
            <h2 className="flex items-center gap-2 text-base font-bold text-foreground">
              <Clock3 className="h-4 w-4 text-primary" /> Recent check-ins
            </h2>
            {recent.length === 0 ? (
              <p className="mt-4 rounded-lg border border-dashed border-border bg-muted/40 px-4 py-6 text-center text-sm text-muted-foreground">
                No check-ins yet — scans appear here as tickets are scanned at the venue.
              </p>
            ) : (
              <div className="mt-4 space-y-2">
                {recent.slice(0, 6).map((s) => (
                  <div key={s._id} className="flex items-center gap-3 rounded-lg border border-border bg-background px-3.5 py-2.5">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-light text-primary">
                      <UserCheck className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-foreground">{userName(s.userId)}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {s.checkInTime
                          ? new Date(s.checkInTime).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
                          : "Not checked in"}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function BackLink() {
  return (
    <Link href="/admin/events" className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground">
      <ChevronLeft className="h-3.5 w-3.5" /> All events
    </Link>
  );
}
