"use client";

/**
 * Admin → Infrastructure (Part 5, Phase 7 — spec §59, §60, §61)
 * ─────────────────────────────────────────────────────────────────────────
 * A single read of GET /api/admin/infrastructure, which is admin-gated
 * server-side. Everything shown here is deliberately admin-only: provider
 * budgets and storage figures must never reach a normal user (§61), so this
 * page lives behind the /admin shell and the endpoint re-checks the role.
 *
 * Read through the Phase 5 data layer so a refresh does not double-fetch and
 * navigating away and back paints from cache.
 */
import { useEffect, useMemo } from "react";
import {
  Activity,
  AlertTriangle,
  Cpu,
  Database,
  Gauge as GaugeIcon,
  HardDrive,
  RefreshCw,
  Server,
  ShieldCheck,
  Upload,
  Zap,
} from "lucide-react";
import { useQuery } from "@/lib/query";
import { Button } from "@/components/ui/button";
import { PageLoader, ErrorState } from "@/components/states";
import { cn } from "@/lib/utils";

type Level = "OK" | "WARNING" | "HIGH" | "CRITICAL" | null;

interface InfraReport {
  generatedAt: string;
  status: "OK" | "WARNING" | "HIGH" | "CRITICAL";
  thresholds: { WARNING: number; HIGH: number; CRITICAL: number };
  budgets: Record<string, number>;
  alerts: { section: string; level: string; percent: number | null; message: string }[];
  sections: {
    database: any;
    cache: any;
    api: any;
    rateLimits: any;
    sockets: any;
    providers: any;
    uploads: any;
    process: any;
  };
}

/* ── formatting ────────────────────────────────────────────────────────── */

function bytes(n?: number | null) {
  if (!Number.isFinite(n as number) || (n as number) <= 0) return "0 B";
  const v = n as number;
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(v) / Math.log(1024)));
  return `${(v / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function num(n?: number | null) {
  return typeof n === "number" ? n.toLocaleString("en-IN") : "—";
}

/* ── severity presentation ─────────────────────────────────────────────── */

const LEVEL_STYLE: Record<string, string> = {
  OK: "bg-success-light text-success",
  WARNING: "bg-warning-light text-warning",
  HIGH: "bg-warning-light text-warning",
  CRITICAL: "bg-destructive/10 text-destructive",
};

const BAR_STYLE: Record<string, string> = {
  OK: "bg-success",
  WARNING: "bg-warning",
  HIGH: "bg-warning",
  CRITICAL: "bg-destructive",
};

function LevelBadge({ level }: { level: Level }) {
  if (!level) return <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">N/A</span>;
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide", LEVEL_STYLE[level])}>
      {level}
    </span>
  );
}

function Gauge({ percent, level }: { percent: number | null; level: Level }) {
  if (percent === null) {
    return <div className="mt-2 h-1.5 w-full rounded-full bg-muted" />;
  }
  return (
    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <div
        className={cn("h-full rounded-full transition-all", BAR_STYLE[level || "OK"])}
        style={{ width: `${Math.max(2, Math.min(100, percent))}%` }}
      />
    </div>
  );
}

function Section({
  title,
  icon: Icon,
  level,
  percent,
  children,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  level: Level;
  percent?: number | null;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-light text-primary">
            <Icon className="h-4 w-4" />
          </div>
          <h2 className="text-sm font-bold text-foreground">{title}</h2>
        </div>
        <LevelBadge level={level ?? null} />
      </div>
      {percent !== undefined && <Gauge percent={percent ?? null} level={level} />}
      <div className="mt-4">{children}</div>
    </div>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border py-1.5 last:border-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-right text-xs font-semibold text-foreground">
        {value}
        {hint && <span className="ml-1 font-normal text-muted-foreground">{hint}</span>}
      </span>
    </div>
  );
}

/* ── page ──────────────────────────────────────────────────────────────── */

const STATUS_STYLE: Record<string, string> = {
  OK: "bg-success-light text-success",
  WARNING: "bg-warning-light text-warning",
  HIGH: "bg-warning-light text-warning",
  CRITICAL: "bg-destructive/10 text-destructive",
};

export default function AdminInfrastructurePage() {
  const { data, isLoading, error, refetch } = useQuery<InfraReport>(
    ["admin", "infrastructure"],
    "/admin/infrastructure",
    { staleTime: 15_000, refetchOnWindowFocus: true }
  );

  const s = data?.sections;
  const generatedAt = useMemo(
    () => (data?.generatedAt ? new Date(data.generatedAt).toLocaleTimeString("en-IN") : null),
    [data?.generatedAt]
  );

  // Keep the tab title honest about the current severity.
  useEffect(() => {
    if (data?.status) {
      document.title =
        data.status === "OK" ? "Infrastructure · EventHub" : `Infrastructure · ${data.status} · EventHub`;
    }
    return () => {
      document.title = "EventHub";
    };
  }, [data?.status]);

  if (isLoading) return <PageLoader label="Reading infrastructure…" />;
  if (error || !data) {
    return <ErrorState title="Couldn't load the infrastructure report" onRetry={() => refetch()} />;
  }

  return (
    <div className="mx-auto max-w-6xl">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-foreground">Infrastructure</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Live health against this deployment&apos;s budgets
            {generatedAt ? ` · read at ${generatedAt}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide",
              STATUS_STYLE[data.status] || STATUS_STYLE.OK
            )}
          >
            {data.status === "OK" ? "Healthy" : data.status}
          </span>
          <Button variant="outline" size="sm" onClick={() => refetch()} className="font-semibold">
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Refresh
          </Button>
        </div>
      </div>

      {/* Alerts lead the page — an admin should not have to scan for trouble */}
      {data.alerts.length > 0 && (
        <div className="mt-6 rounded-xl border border-warning/30 bg-warning-light/40 p-4">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-warning" />
            <h2 className="text-sm font-bold text-foreground">
              {data.alerts.length} thing{data.alerts.length === 1 ? "" : "s"} need attention
            </h2>
          </div>
          <ul className="mt-2.5 space-y-1.5">
            {data.alerts.map((a) => (
              <li key={a.section} className="flex items-center gap-2 text-xs">
                <LevelBadge level={a.level as Level} />
                <span className="text-foreground">{a.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {/* Database */}
        <Section title="Database" icon={Database} level={s?.database?.level} percent={s?.database?.percent}>
          {s?.database?.available === false ? (
            <p className="text-xs text-muted-foreground">{s.database.message || "Database not connected"}</p>
          ) : (
            <>
              <Metric label="Data size" value={bytes(s?.database?.dataSize)} hint={`of ${bytes(s?.database?.budgetBytes)}`} />
              <Metric label="On-disk size" value={bytes(s?.database?.storageSize)} />
              <Metric label="Index size" value={bytes(s?.database?.indexSize)} />
              <Metric label="Documents" value={num(s?.database?.objects)} />
              <Metric label="Collections" value={num(s?.database?.collections)} />
              <Metric label="Indexes" value={num(s?.database?.indexes)} />
              {(s?.database?.topCollections?.length ?? 0) > 0 && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-[11px] font-semibold text-primary">
                    Largest collections
                  </summary>
                  <div className="mt-1.5">
                    {(s?.database?.topCollections ?? []).map((c: any) => (
                      <Metric key={c.name} label={c.name} value={num(c.count)} />
                    ))}
                  </div>
                </details>
              )}
            </>
          )}
        </Section>

        {/* Cache */}
        <Section title="Cache" icon={Zap} level={s?.cache?.level} percent={s?.cache?.percent}>
          {s?.cache?.disabled ? (
            <p className="text-xs text-muted-foreground">Caching is disabled (CACHE_DISABLED=1)</p>
          ) : (
            <>
              <Metric label="Entries" value={num(s?.cache?.size)} hint={`/ ${num(s?.cache?.maxEntries)}`} />
              <Metric label="Hit rate" value={s?.cache?.hitRate === null ? "—" : `${s?.cache?.hitRate}%`} />
              <Metric label="Hits / misses" value={`${num(s?.cache?.hits)} / ${num(s?.cache?.misses)}`} />
              <Metric label="Evictions" value={num(s?.cache?.evictions)} />
              <Metric label="Stale served" value={num(s?.cache?.staleServed)} />
              <Metric label="Deduped" value={num(s?.cache?.dedupServed)} />
            </>
          )}
        </Section>

        {/* API */}
        <Section title="API latency" icon={Activity} level={s?.api?.level} percent={s?.api?.percent}>
          <Metric label="p50" value={s?.api?.p50 === null ? "—" : `${s?.api?.p50} ms`} />
          <Metric label="p95" value={s?.api?.p95 === null ? "—" : `${s?.api?.p95} ms`} hint={`/ ${s?.api?.targetP95Ms} ms`} />
          <Metric label="p99" value={s?.api?.p99 === null ? "—" : `${s?.api?.p99} ms`} />
          <Metric label="Samples" value={num(s?.api?.samples)} />
          <Metric label="2xx / 4xx / 5xx" value={`${num(s?.api?.statuses?.ok)} / ${num(s?.api?.statuses?.clientError)} / ${num(s?.api?.statuses?.serverError)}`} />
          <Metric label="Error rate" value={`${s?.api?.errorRate ?? 0}%`} />
        </Section>

        {/* Sockets */}
        <Section title="Realtime" icon={Server} level={s?.sockets?.level} percent={s?.sockets?.percent}>
          <Metric label="Connected" value={num(s?.sockets?.connected)} />
          <Metric label="Peak" value={num(s?.sockets?.peak)} />
          <Metric label="Distinct users / IPs" value={`${num(s?.sockets?.users)} / ${num(s?.sockets?.ips)}`} />
          <Metric label="Per-user / per-IP cap" value={`${num(s?.sockets?.capPerUser)} / ${num(s?.sockets?.capPerIp)}`} />
          <Metric label="Active rooms" value={num(s?.sockets?.rooms)} />
          <Metric label="Socket errors" value={num(s?.sockets?.errors)} />
        </Section>

        {/* Providers */}
        <Section title="Providers" icon={ShieldCheck} level={s?.providers?.email?.level}>
          <Metric
            label="Image storage"
            value={s?.providers?.storage?.provider === "cloudinary" ? "Cloudinary" : "Local disk"}
            hint={s?.providers?.storage?.configured ? undefined : "(fallback)"}
          />
          <Metric label="Email (SMTP)" value={s?.providers?.smtpConfigured ? "Configured" : "Not configured"} />
          <Metric
            label="Email failures"
            value={s?.providers?.email?.failureRate === null ? "no traffic yet" : `${s?.providers?.email?.failureRate}%`}
            hint={s?.providers?.email?.attempts ? `of ${num(s?.providers?.email?.attempts)}` : undefined}
          />
          <Metric
            label="Upload failures"
            value={s?.providers?.cloudinary?.failureRate === null ? "no traffic yet" : `${s?.providers?.cloudinary?.failureRate}%`}
          />
        </Section>

        {/* Uploads + process + rate limits */}
        <Section title="Process" icon={Cpu} level={s?.process?.level} percent={s?.process?.percent}>
          <Metric label="Heap used" value={bytes(s?.process?.heapUsed)} hint={`/ ${bytes(s?.process?.budgetBytes)}`} />
          <Metric label="RSS" value={bytes(s?.process?.rss)} />
          <Metric label="Uptime" value={`${num(Math.floor((s?.process?.uptimeSec || 0) / 3600))}h ${num(Math.floor(((s?.process?.uptimeSec || 0) % 3600) / 60))}m`} />
          <Metric label="Node" value={s?.process?.nodeVersion || "—"} />
        </Section>

        <Section title="Uploads" icon={Upload} level={s?.uploads?.level} percent={s?.uploads?.failureRate}>
          <Metric label="Succeeded" value={num(s?.uploads?.successes)} />
          <Metric label="Failed" value={num(s?.uploads?.failures)} />
          <Metric label="Failure rate" value={`${s?.uploads?.failureRate ?? 0}%`} />
        </Section>

        <Section title="Rate limits" icon={GaugeIcon} level="OK">
          <Metric label="Total blocked" value={num(s?.rateLimits?.total)} />
          <div className="mt-1.5">
            {(s?.rateLimits?.buckets || []).slice(0, 6).map((b: any) => (
              <Metric key={b.bucket} label={b.bucket} value={num(b.count)} />
            ))}
            {(s?.rateLimits?.buckets || []).length === 0 && (
              <p className="text-xs text-muted-foreground">No requests blocked.</p>
            )}
          </div>
        </Section>

        <Section title="Storage" icon={HardDrive} level="OK">
          <Metric label="Database" value={bytes(s?.database?.storageSize)} />
          <Metric label="Indexes" value={bytes(s?.database?.indexSize)} />
          <Metric label="Cache entries" value={num(s?.cache?.size)} />
        </Section>
      </div>

      <p className="mt-6 text-[11px] leading-relaxed text-muted-foreground">
        Thresholds: {data.thresholds.WARNING}% warning · {data.thresholds.HIGH}% high ·{" "}
        {data.thresholds.CRITICAL}% critical. Figures are for this running process and reset on
        restart. Database stats are cached for 30 seconds.
      </p>
    </div>
  );
}
