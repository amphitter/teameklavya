"use client";

/**
 * Inline-SVG analytics charts (Part 3, Phase 11) — no external libs.
 *  - TrendChart: line + area chart for daily counts
 *  - BarList: horizontal labelled bars
 *  - AnalyticsCharts: the admin platform analytics section
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { BarChart3, Loader2 } from "lucide-react";
import { api } from "@/utils/api";

/* ── Line + area chart (pure SVG, responsive via viewBox) ── */
export function TrendChart({
  data,
  color = "#0058c9",
  height = 120,
}: {
  data: { day: string; count: number }[];
  color?: string;
  height?: number;
}) {
  if (!data.length) {
    return <p className="py-6 text-center text-xs text-muted-foreground">No data in this window yet</p>;
  }
  const W = 600;
  const H = height;
  const pad = 8;
  const max = Math.max(1, ...data.map((d) => d.count));
  const stepX = data.length > 1 ? (W - pad * 2) / (data.length - 1) : 0;
  const pts = data.map((d, i) => {
    const x = pad + i * stepX;
    const y = H - pad - (d.count / max) * (H - pad * 2);
    return { x, y, ...d };
  });
  const line = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const area = `${line} L${pts[pts.length - 1].x.toFixed(1)},${H - pad} L${pts[0].x.toFixed(1)},${H - pad} Z`;
  const last = pts[pts.length - 1];

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Trend chart">
        <path d={area} fill={color} opacity="0.1" />
        <path d={line} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={last.x} cy={last.y} r="4" fill={color} />
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
        <span>{data[0].day.slice(5)}</span>
        <span>
          peak {max} · latest {data[data.length - 1].count}
        </span>
        <span>{data[data.length - 1].day.slice(5)}</span>
      </div>
    </div>
  );
}

/* ── Horizontal labelled bars ── */
export function BarList({
  items,
  color = "bg-primary",
}: {
  items: { label: string; value: number; sub?: string; href?: string }[];
  color?: string;
}) {
  if (!items.length) return <p className="py-6 text-center text-xs text-muted-foreground">No data yet</p>;
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className="space-y-2.5">
      {items.map((it) => {
        const bar = (
          <>
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <span className="min-w-0 truncate font-semibold text-foreground">{it.label}</span>
              <span className="shrink-0 font-bold text-muted-foreground">{it.value}</span>
            </div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
              <div className={`h-full rounded-full ${color}`} style={{ width: `${(it.value / max) * 100}%` }} />
            </div>
            {it.sub ? <p className="mt-0.5 truncate text-[10px] text-muted-foreground">{it.sub}</p> : null}
          </>
        );
        return (
          <li key={it.label}>
            {it.href ? (
              <Link href={it.href} className="block rounded-lg transition-opacity hover:opacity-80">
                {bar}
              </Link>
            ) : (
              bar
            )}
          </li>
        );
      })}
    </ul>
  );
}

/* ── Admin platform analytics section ── */
interface Analytics {
  windowDays: number;
  registrationTrend: { day: string; count: number }[];
  userGrowth: { day: string; newUsers: number; total: number }[];
  topEvents: { _id: string; title: string; slug: string; registrations: number; category?: string }[];
  categoryBreakdown: { category: string; count: number }[];
}

export function AnalyticsCharts() {
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    api
      .get("/admin/analytics")
      .then((r) => setAnalytics(r.data?.analytics || null))
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <section className="mt-10">
        <h2 className="flex items-center gap-2 text-lg font-bold text-foreground">
          <BarChart3 className="h-5 w-5 text-primary" /> Platform analytics
        </h2>
        <div className="mt-4 flex items-center justify-center rounded-xl border border-border bg-card p-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      </section>
    );
  }
  if (failed || !analytics) return null;

  return (
    <section className="mt-10">
      <h2 className="flex items-center gap-2 text-lg font-bold text-foreground">
        <BarChart3 className="h-5 w-5 text-primary" /> Platform analytics
        <span className="text-xs font-normal text-muted-foreground">(last {analytics.windowDays} days)</span>
      </h2>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Registrations per day</p>
          <div className="mt-2">
            <TrendChart data={analytics.registrationTrend} color="#0058c9" />
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">New users per day</p>
          <div className="mt-2">
            <TrendChart data={analytics.userGrowth.map((d) => ({ day: d.day, count: d.newUsers }))} color="#006C4C" />
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Top events by registrations</p>
          <div className="mt-3">
            <BarList
              items={analytics.topEvents.map((e) => ({
                label: e.title,
                value: e.registrations,
                sub: e.category,
                href: e.slug ? `/events/${e.slug}` : undefined,
              }))}
            />
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Events by category</p>
          <div className="mt-3">
            <BarList
              items={analytics.categoryBreakdown.map((c) => ({ label: c.category, value: c.count }))}
              color="bg-purple"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
