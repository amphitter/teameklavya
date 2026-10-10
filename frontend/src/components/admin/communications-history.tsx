"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Mail, Users } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/utils/api";
import { cn } from "@/lib/utils";

export interface CommunicationRow {
  _id: string;
  scope: "PLATFORM" | "EVENT";
  eventId?: string | { _id?: string; title?: string } | null;
  kind: string;
  subject: string;
  status: "pending" | "sending" | "sent" | "partial" | "failed";
  recipientCount: number;
  sentCount: number;
  failedCount: number;
  startedAt?: string | null;
  completedAt?: string | null;
  createdAt: string;
  sender?: { firstName?: string; lastName?: string } | null;
}

interface DeliveryRow {
  _id: string;
  recipientEmail: string;
  status: "pending" | "sent" | "failed";
  sentAt?: string | null;
  createdAt?: string;
}

interface DeliveryState {
  items: DeliveryRow[];
  nextCursor: string | null;
  hasMore: boolean;
  loading: boolean;
  error: boolean;
}

interface Props {
  rows: CommunicationRow[];
  loading?: boolean;
  error?: boolean;
  hasMore?: boolean;
  onLoadMore?: () => void;
  loadingMore?: boolean;
  deliveryUrlFor: (communicationId: string) => string;
}

const STATUS_CLASS: Record<string, string> = {
  sent: "bg-success-light text-success",
  partial: "bg-warning-light text-warning",
  failed: "bg-destructive/10 text-destructive",
  sending: "bg-brand-light text-primary",
  pending: "bg-muted text-muted-foreground",
};

function niceDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

function StatusPill({ status }: { status: string }) {
  return (
    <span className={cn("inline-flex shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold capitalize", STATUS_CLASS[status] || STATUS_CLASS.pending)}>
      {status}
    </span>
  );
}

export function CommunicationsHistory({
  rows,
  loading = false,
  error = false,
  hasMore = false,
  onLoadMore,
  loadingMore = false,
  deliveryUrlFor,
}: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [deliveryStates, setDeliveryStates] = useState<Record<string, DeliveryState>>({});

  const fetchDeliveries = async (communicationId: string, cursor: string | null, append: boolean) => {
    if (append && !cursor) return;
    setDeliveryStates((previous) => ({
      ...previous,
      [communicationId]: {
        items: previous[communicationId]?.items || [],
        nextCursor: previous[communicationId]?.nextCursor || null,
        hasMore: previous[communicationId]?.hasMore || false,
        error: false,
        loading: true,
      },
    }));
    try {
      const response = await api.get(deliveryUrlFor(communicationId), { params: { cursor: cursor || undefined, limit: 25 } });
      const incoming: DeliveryRow[] = response.data?.items || [];
      setDeliveryStates((previous) => {
        const old = previous[communicationId];
        return {
          ...previous,
          [communicationId]: {
            items: append ? [...(old?.items || []), ...incoming] : incoming,
            nextCursor: response.data?.nextCursor || null,
            hasMore: Boolean(response.data?.hasMore),
            loading: false,
            error: false,
          },
        };
      });
    } catch {
      setDeliveryStates((previous) => ({
        ...previous,
        [communicationId]: {
          items: previous[communicationId]?.items || [],
          nextCursor: previous[communicationId]?.nextCursor || null,
          hasMore: previous[communicationId]?.hasMore || false,
          loading: false,
          error: true,
        },
      }));
      toast.error("Couldn't load recipient history");
    }
  };

  const toggleDetails = (communicationId: string) => {
    if (expandedId === communicationId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(communicationId);
    if (!deliveryStates[communicationId]?.items.length) {
      void fetchDeliveries(communicationId, null, false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-3" aria-label="Loading communication history">
        {[1, 2, 3].map((item) => <div key={item} className="h-28 animate-pulse rounded-xl border border-border bg-card" />)}
      </div>
    );
  }
  if (error) {
    return <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">Couldn't load communications history. Try refreshing the page.</div>;
  }
  if (!rows.length) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-card px-5 py-10 text-center">
        <Mail className="mx-auto h-8 w-8 text-muted-foreground/60" />
        <p className="mt-3 font-semibold text-foreground">No messages in this history yet</p>
        <p className="mt-1 text-sm text-muted-foreground">Sent messages and recipient delivery statuses will appear here.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {rows.map((row) => {
        const opened = expandedId === row._id;
        const state = deliveryStates[row._id];
        const eventTitle = typeof row.eventId === "object" && row.eventId ? row.eventId.title : null;
        return (
          <article key={row._id} className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between sm:gap-5 sm:p-5">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill status={row.status} />
                  <span className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-semibold text-muted-foreground">
                    {row.scope === "PLATFORM" ? "Platform" : "Event"}
                  </span>
                  {eventTitle && <span className="max-w-full truncate text-xs text-muted-foreground">{eventTitle}</span>}
                </div>
                <h3 className="mt-2 break-words text-sm font-bold text-foreground sm:text-base">{row.subject}</h3>
                <p className="mt-1 break-words text-xs text-muted-foreground">
                  {row.kind.replaceAll("_", " ").toLowerCase()} · {niceDate(row.createdAt)}
                </p>
              </div>
              <div className="grid grid-cols-3 gap-x-4 gap-y-1 text-left sm:min-w-[190px] sm:text-right">
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Users className="h-3.5 w-3.5" /> Recipients</span>
                <span className="text-xs text-success">Sent</span>
                <span className="text-xs text-destructive">Failed</span>
                <span className="font-semibold tabular-nums text-foreground">{row.recipientCount}</span>
                <span className="font-semibold tabular-nums text-success">{row.sentCount}</span>
                <span className="font-semibold tabular-nums text-destructive">{row.failedCount}</span>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-muted/20 px-4 py-2.5 sm:px-5">
              <p className="text-xs text-muted-foreground">
                {row.completedAt ? `Finished ${niceDate(row.completedAt)}` : row.status === "sending" ? "Delivery is still in progress" : "No message body is retained"}
              </p>
              <button
                type="button"
                onClick={() => toggleDetails(row._id)}
                aria-expanded={opened}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-xs font-semibold text-primary hover:bg-brand-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <Mail className="h-3.5 w-3.5" />
                {opened ? "Hide recipients" : "Recipient history"}
                {opened ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </button>
            </div>

            {opened && (
              <div className="border-t border-border p-4 sm:p-5">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h4 className="text-sm font-semibold text-foreground">Per-recipient delivery</h4>
                  <span className="text-xs text-muted-foreground">Email address and status retained for 90 days</span>
                </div>
                {state?.loading && state.items.length === 0 ? (
                  <div className="h-14 animate-pulse rounded-lg bg-muted" />
                ) : state?.error && state.items.length === 0 ? (
                  <button type="button" onClick={() => void fetchDeliveries(row._id, null, false)} className="min-h-11 px-1 text-sm font-semibold text-primary hover:underline">Retry recipient history</button>
                ) : !state?.items.length ? (
                  <p className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">No delivery rows are available.</p>
                ) : (
                  <>
                    <ul className="divide-y divide-border rounded-lg border border-border">
                      {state.items.map((delivery) => (
                        <li key={delivery._id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
                          <span className="min-w-0 break-all text-sm text-foreground">{delivery.recipientEmail}</span>
                          <div className="flex shrink-0 items-center gap-3">
                            <StatusPill status={delivery.status} />
                            <span className="text-xs text-muted-foreground">{niceDate(delivery.sentAt || delivery.createdAt)}</span>
                          </div>
                        </li>
                      ))}
                    </ul>
                    {state.error && <p className="mt-2 text-xs text-destructive">Couldn't load more recipients.</p>}
                    {state.hasMore && (
                      <button
                        type="button"
                        disabled={state.loading}
                        onClick={() => void fetchDeliveries(row._id, state.nextCursor, true)}
                        className="mt-3 min-h-11 rounded-lg px-3 text-sm font-semibold text-primary hover:bg-brand-light disabled:opacity-60"
                      >
                        {state.loading ? "Loading…" : "Load more recipients"}
                      </button>
                    )}
                  </>
                )}
              </div>
            )}
          </article>
        );
      })}
      {hasMore && onLoadMore && (
        <div className="pt-2 text-center">
          <button
            type="button"
            disabled={loadingMore}
            onClick={onLoadMore}
            className="min-h-11 rounded-lg border border-border bg-card px-5 text-sm font-semibold text-foreground hover:bg-muted disabled:opacity-60"
          >
            {loadingMore ? "Loading…" : "Load older communications"}
          </button>
        </div>
      )}
    </div>
  );
}
