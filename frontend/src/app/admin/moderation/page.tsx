"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Check,
  EyeOff,
  Flag,
  Loader2,
  MessageSquareOff,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  UserX,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/utils/api";
import { useSessionUser } from "@/components/shell/use-session-user";
import { PageLoader, ErrorState, EmptyState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Report {
  _id: string;
  targetType: "post" | "comment" | "event" | "user";
  targetId: string;
  snapshot: string;
  reason: string;
  details: string;
  status: "open" | "dismissed" | "actioned";
  resolution: string;
  createdAt: string;
  reporter?: { _id: string; firstName?: string; lastName?: string; username?: string } | null;
  targetUser?: { _id: string; firstName?: string; lastName?: string; username?: string } | null;
}

interface Stats {
  open: number;
  dismissed: number;
  actioned: number;
  suspended: number;
}

const REASON_LABEL: Record<string, string> = {
  spam: "Spam",
  harassment: "Harassment",
  inappropriate: "Inappropriate",
  misinformation: "Misinformation",
  other: "Other",
};

const TARGET_META: Record<Report["targetType"], { label: string; action: string; icon: any; actionLabel: string }> = {
  post: { label: "Post", action: "hide_post", icon: Trash2, actionLabel: "Hide post" },
  comment: { label: "Comment", action: "remove_comment", icon: MessageSquareOff, actionLabel: "Remove comment" },
  event: { label: "Event", action: "takedown_event", icon: EyeOff, actionLabel: "Take down event" },
  user: { label: "Person", action: "suspend_user", icon: UserX, actionLabel: "Suspend user" },
};

/**
 * Moderation queue (Part 3, Phase 10) — reports inbox for admins.
 * The backend enforces admin rights on every endpoint (server-side);
 * this page is only the surface.
 */
export default function AdminModerationPage() {
  const { user, ready } = useSessionUser();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [reports, setReports] = useState<Report[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [tab, setTab] = useState<"open" | "actioned" | "dismissed">("open");
  const [busyId, setBusyId] = useState("");
  const [suspendReasons, setSuspendReasons] = useState<Record<string, string>>({});

  const load = useCallback((status: string) => {
    setLoading(true);
    setError(false);
    api
      .get("/moderation/reports", { params: { status } })
      .then((r) => setReports(r.data?.reports || []))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
    api
      .get("/moderation/stats")
      .then((r) => setStats(r.data?.stats || null))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (ready && user) load(tab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, user?._id, tab]);

  const resolve = (report: Report, action: string, extra?: Record<string, string>) => {
    setBusyId(report._id);
    api
      .post(`/moderation/reports/${report._id}/resolve`, { action, ...extra })
      .then((r) => {
        if (r.data?.success) {
          toast.success(
            action === "dismiss"
              ? "Report dismissed"
              : action === "suspend_user"
                ? "User suspended — their access is blocked server-side"
                : "Action taken"
          );
          load(tab);
        } else toast.error(r.data?.message || "Action failed");
      })
      .catch((e: any) => toast.error(e.response?.data?.message || "Action failed"))
      .finally(() => setBusyId(""));
  };

  if (!ready || (loading && reports.length === 0 && !error)) return <PageLoader label="Checking access…" />;
  if (!user)
    return (
      <div className="mx-auto max-w-2xl px-4 py-10">
        <EmptyState icon={ShieldCheck} title="Admin only" description="Sign in with an admin account to review reports." />
      </div>
    );

  const nameOf = (u?: Report["reporter"]) =>
    u ? (u.firstName ? `${u.firstName} ${u.lastName || ""}`.trim() : `@${u.username || "user"}`) : "Unknown";

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5 px-3 py-5 sm:px-6 sm:py-7">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-extrabold tracking-tight text-foreground sm:text-2xl">
          <ShieldAlert className="h-6 w-6 text-primary" /> Moderation
        </h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Reports from the community. Every action is audited; removed content keeps a record.
        </p>
        {stats && (
          <p className="mt-1 text-xs text-muted-foreground">
            {stats.open} open · {stats.actioned} actioned · {stats.dismissed} dismissed ·{" "}
            <span className={stats.suspended > 0 ? "font-bold text-[#ba1a1a]" : ""}>{stats.suspended} suspended users</span>
          </p>
        )}
      </div>

      <div className="flex gap-2">
        {(["open", "actioned", "dismissed"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "rounded-full px-3.5 py-1.5 text-xs font-bold capitalize transition-colors",
              tab === t ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/70"
            )}
          >
            {t}
            {stats ? ` (${stats[t]})` : ""}
          </button>
        ))}
      </div>

      {error ? (
        <ErrorState title="Couldn't load reports" description="Give it another try." onRetry={() => load(tab)} />
      ) : reports.length === 0 ? (
        <EmptyState
          icon={Flag}
          title={`No ${tab} reports`}
          description={tab === "open" ? "Reports from the community will appear here for review." : undefined}
        />
      ) : (
        <ul className="space-y-4">
          {reports.map((r) => {
            const meta = TARGET_META[r.targetType];
            const ActionIcon = meta.icon;
            return (
              <li key={r._id} className="rounded-2xl border border-border bg-card p-4">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="rounded-full bg-brand-light px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary">
                    {meta.label}
                  </span>
                  <span className="rounded-full bg-[#ba1a1a]/10 px-2.5 py-0.5 text-[10px] font-bold text-[#ba1a1a]">
                    {REASON_LABEL[r.reason] || r.reason}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    reported by <span className="font-semibold text-foreground">{nameOf(r.reporter)}</span> ·{" "}
                    {new Date(r.createdAt).toLocaleDateString()}
                  </span>
                </div>

                {r.snapshot ? (
                  <p className="mt-2 rounded-lg bg-muted/50 px-3 py-2 text-xs leading-relaxed text-foreground">
                    &ldquo;{r.snapshot}
                    {r.snapshot.length >= 280 ? "…" : ""}&rdquo;
                  </p>
                ) : null}
                {r.details ? <p className="mt-1.5 text-xs text-muted-foreground">Reporter note: {r.details}</p> : null}

                <p className="mt-1.5 text-xs text-muted-foreground">
                  Content by{" "}
                  {r.targetUser?._id ? (
                    <Link href={`/profile/${r.targetUser._id}`} className="font-semibold text-foreground hover:text-primary">
                      {nameOf(r.targetUser)}
                    </Link>
                  ) : (
                    <span className="font-semibold text-foreground">unknown</span>
                  )}
                </p>

                {r.status !== "open" ? (
                  <p className="mt-2 border-t border-border pt-2 text-xs text-muted-foreground">
                    Resolution: <span className="font-semibold text-foreground">{r.resolution || "—"}</span>
                  </p>
                ) : (
                  <div className="mt-3 space-y-2 border-t border-border pt-3">
                    {r.targetType === "user" && (
                      <input
                        value={suspendReasons[r._id] || ""}
                        onChange={(e) => setSuspendReasons((p) => ({ ...p, [r._id]: e.target.value }))}
                        placeholder="Suspension reason (shown to the user at login)…"
                        maxLength={300}
                        className="w-full rounded-xl border border-input bg-background px-3 py-2 text-xs outline-none placeholder:text-muted-foreground focus:border-primary/50"
                      />
                    )}
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        disabled={busyId === r._id}
                        onClick={() =>
                          resolve(
                            r,
                            meta.action,
                            r.targetType === "user" ? { suspendReason: suspendReasons[r._id] || "Policy violation" } : undefined
                          )
                        }
                        className={cn("gap-1.5", r.targetType !== "user" && "bg-[#ba1a1a] text-white hover:bg-[#9e1616]")}
                      >
                        {busyId === r._id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <ActionIcon className="h-3.5 w-3.5" />
                        )}
                        {meta.actionLabel}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busyId === r._id}
                        onClick={() => resolve(r, "dismiss")}
                        className="gap-1.5"
                      >
                        <Check className="h-3.5 w-3.5" /> Dismiss
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
