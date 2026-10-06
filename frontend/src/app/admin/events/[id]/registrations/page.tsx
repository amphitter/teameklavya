"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { api } from "@/utils/api";
import { PageLoader, ErrorState, EmptyState } from "@/components/states";
import { EventTabs } from "@/components/admin/event-tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  ChevronDown,
  ChevronLeft,
  Clock3,
  Download,
  Search,
  UserCheck,
  Users,
} from "lucide-react";

interface Answer {
  fieldLabel: string;
  fieldType: string;
  value: any;
}
interface ResponseItem {
  _id: string;
  userId?: { firstName?: string; lastName?: string; email?: string; profile?: any };
  answers: Answer[];
  status: "confirmed" | "pending";
  createdAt: string;
}

export default function EventRegistrationsPage() {
  const { id } = useParams<{ id: string }>();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [event, setEvent] = useState<any>(null);
  const [responses, setResponses] = useState<ResponseItem[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "confirmed" | "pending">("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const load = () => {
    setLoading(true);
    setError(null);
    Promise.all([
      api.get(`/events/${id}`).catch(() => null),
      api.get(`/registration/responses/${id}`).catch(() => null),
      api.get(`/registration/responses/${id}/stats`).catch(() => null),
    ]).then(([evRes, resRes, statRes]) => {
      if (evRes?.data?.event) setEvent(evRes.data.event);
      if (resRes?.data?.responses) setResponses(resRes.data.responses);
      if (statRes?.data?.stats) setStats(statRes.data.stats);
      if (!resRes || resRes.data?.success === false) {
        setError(resRes?.data?.message || "Failed to load registrations");
      }
    }).finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return responses.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (!q) return true;
      const name = `${r.userId?.firstName ?? ""} ${r.userId?.lastName ?? ""}`.toLowerCase();
      const email = (r.userId?.email ?? "").toLowerCase();
      const answers = (r.answers || []).map((a) => String(a.value ?? "")).join(" ").toLowerCase();
      return name.includes(q) || email.includes(q) || answers.includes(q);
    });
  }, [responses, query, statusFilter]);

  const exportCsv = async () => {
    setExporting(true);
    try {
      const res = await api.get(`/registration/responses/${id}/export`, { responseType: "blob" });
      const url = URL.createObjectURL(
        res.data instanceof Blob ? res.data : new Blob([res.data], { type: "text/csv" })
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = `registrations-${event?.slug || id}-${new Date().toISOString().split("T")[0]}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("CSV downloaded");
    } catch {
      toast.error("Export failed");
    } finally {
      setExporting(false);
    }
  };

  if (loading) return <PageLoader label="Loading registrations…" />;
  if (error)
    return (
      <div className="space-y-4">
        <BackLink />
        <ErrorState title="Couldn't load registrations" description={error} onRetry={load} />
      </div>
    );

  const total = stats?.totalRegistrations ?? responses.length;
  const confirmed = stats?.confirmedRegistrations ?? responses.filter((r) => r.status === "confirmed").length;
  const pending = stats?.pendingRegistrations ?? responses.filter((r) => r.status === "pending").length;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Link href={`/admin/events`} className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground">
            <ChevronLeft className="h-3.5 w-3.5" /> All events
          </Link>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground">Registrations</h1>
          <p className="text-sm text-muted-foreground">{event?.title || "Event"}</p>
        </div>
        <div className="flex gap-2">
          <Link href={`/admin/events/${id}/scan`}>
            <Button variant="outline">Scan tickets</Button>
          </Link>
          <Button onClick={exportCsv} disabled={exporting || responses.length === 0}>
            <Download className="mr-2 h-4 w-4" /> {exporting ? "Exporting…" : "Export CSV"}
          </Button>
        </div>
      </div>

      <EventTabs active="registrations" />

      {/* Stats chips */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Total", value: total, icon: Users, cls: "text-primary bg-brand-light" },
          { label: "Confirmed", value: confirmed, icon: UserCheck, cls: "text-success bg-success-light" },
          { label: "Pending", value: pending, icon: Clock3, cls: "text-warning bg-warning-light" },
        ].map((s) => (
          <div key={s.label} className="flex items-center gap-3 rounded-xl border border-border bg-card p-4">
            <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg", s.cls)}>
              <s.icon className="h-5 w-5" />
            </div>
            <div>
              <div className="text-xl font-bold text-foreground">{s.value}</div>
              <div className="text-xs text-muted-foreground">{s.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Search + filter */}
      <div className="flex flex-col gap-2.5 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, email or answers…"
            className="pl-9"
          />
        </div>
        <div className="flex gap-1.5">
          {(["all", "confirmed", "pending"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setStatusFilter(f)}
              className={cn(
                "rounded-lg border px-3.5 py-2 text-xs font-semibold capitalize transition-colors",
                statusFilter === f
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border text-muted-foreground hover:border-primary/40"
              )}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      {responses.length === 0 ? (
        <EmptyState
          title="No registrations yet"
          description="When people register for this event, they'll appear here with their answers."
        />
      ) : filtered.length === 0 ? (
        <EmptyState title="No matches" description={`No registrations match "${query}".`} />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="hidden grid-cols-[1.5fr_1fr_1.2fr_0.8fr_2rem] gap-3 border-b border-border bg-muted/50 px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-muted-foreground sm:grid">
            <span>Participant</span>
            <span>Status</span>
            <span>Registered</span>
            <span>Answers</span>
            <span />
          </div>
          {filtered.map((r) => {
            const name = `${r.userId?.firstName ?? ""} ${r.userId?.lastName ?? ""}`.trim() || "Unknown";
            const isOpen = expanded === r._id;
            return (
              <div key={r._id} className="border-b border-border last:border-0">
                <button
                  onClick={() => setExpanded(isOpen ? null : r._id)}
                  className="grid w-full grid-cols-[1fr_2rem] items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40 sm:grid-cols-[1.5fr_1fr_1.2fr_0.8fr_2rem]"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-foreground">{name}</div>
                    <div className="truncate text-xs text-muted-foreground">{r.userId?.email}</div>
                  </div>
                  <span
                    className={cn(
                      "inline-flex w-fit items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold",
                      r.status === "confirmed"
                        ? "border-success/30 bg-success-light text-success"
                        : "border-warning/30 bg-warning-light text-warning"
                    )}
                  >
                    {r.status === "confirmed" ? <UserCheck className="h-3 w-3" /> : <Clock3 className="h-3 w-3" />}
                    {r.status}
                  </span>
                  <span className="hidden text-xs text-muted-foreground sm:block">
                    {new Date(r.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })} ·{" "}
                    {new Date(r.createdAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                  <span className="hidden text-xs text-muted-foreground sm:block">{r.answers?.length || 0} fields</span>
                  <ChevronDown
                    className={cn("hidden h-4 w-4 text-muted-foreground transition-transform sm:block", isOpen && "rotate-180")}
                  />
                </button>
                {isOpen && (
                  <div className="border-t border-border bg-muted/30 px-4 py-3.5">
                    {r.answers?.length ? (
                      <dl className="grid gap-2.5 sm:grid-cols-2">
                        {r.answers.map((a, i) => (
                          <div key={i} className="rounded-lg border border-border bg-background px-3 py-2.5">
                            <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                              {a.fieldLabel}
                            </dt>
                            <dd className="mt-0.5 break-words text-sm text-foreground">
                              {a.fieldType === "checkbox"
                                ? a.value
                                  ? "Yes"
                                  : "No"
                                : String(a.value ?? "—")}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    ) : (
                      <p className="text-sm text-muted-foreground">No custom answers — registered with name & email only.</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
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
