"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  BarChart3,
  CalendarDays,
  CalendarPlus,
  MapPin,
  Pencil,
  QrCode,
  Search,
  Trash2,
  Users,
  Video,
  Settings2,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/utils/api";
import { getImageUrl } from "@/utils/image";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, Skeleton } from "@/components/states";
import { cn } from "@/lib/utils";

interface AdminEvent {
  _id: string;
  slug?: string;
  title: string;
  category?: string;
  eventType?: string;
  venue?: string;
  bannerUrl?: string;
  startDate?: string;
  endDate?: string;
  price?: number;
  visibility?: string;
  isFeatured?: boolean;
  organizer?: string;
}

const STATUS_OPTIONS = [
  { value: "all", label: "All" },
  { value: "upcoming", label: "Upcoming" },
  { value: "ongoing", label: "Ongoing" },
  { value: "past", label: "Past" },
  { value: "featured", label: "Featured" },
];

export default function AdminEventsPage() {
  const router = useRouter();
  const [events, setEvents] = useState<AdminEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = useCallback(async (cursor: string | null = null, append = false) => {
    if (append && !cursor) return;
    if (append) setLoadingMore(true);
    else {
      setLoading(true);
      setError(false);
    }
    try {
      const res = await api.get("/events/admin/list", {
        params: {
          search: search || undefined,
          status: status !== "all" ? status : undefined,
          limit: 50,
          cursor: cursor || undefined,
        },
      });
      const incoming: AdminEvent[] = res.data?.events ?? res.data ?? [];
      setEvents((previous) => append ? [...previous, ...incoming] : incoming);
      setNextCursor(res.data?.nextCursor || null);
      setHasMore(Boolean(res.data?.hasMore));
    } catch {
      if (!append) setError(true);
      else toast.error("Couldn't load more events");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [search, status]);

  useEffect(() => {
    const t = setTimeout(load, 300); // debounce search
    return () => clearTimeout(t);
  }, [load]);

  const handleDelete = async (event: AdminEvent) => {
    if (!window.confirm(`Delete "${event.title}"? This cannot be undone.`)) return;
    setDeleting(event._id);
    try {
      await api.delete(`/events/${event._id}`);
      toast.success("Event deleted");
      setEvents((prev) => prev.filter((e) => e._id !== event._id));
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Failed to delete event");
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div className="mx-auto max-w-6xl">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-foreground">Events</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {loading ? "Loading…" : `${events.length} event${events.length === 1 ? "" : "s"}`}
          </p>
        </div>
        <Button asChild className="min-h-11 font-semibold">
          <Link href="/admin/events/create">
            <CalendarPlus className="mr-2 h-4 w-4" /> Create Event
          </Link>
        </Button>
      </div>

      {/* Filters */}
      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by title, venue or organizer…"
            className="h-11 w-full rounded-lg border border-input bg-card pl-10 pr-4 text-base outline-none transition-all placeholder:text-muted-foreground focus:border-primary/50 focus:ring-4 focus:ring-primary/10 sm:text-sm"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {STATUS_OPTIONS.map((s) => (
            <button
              key={s.value}
              onClick={() => setStatus(s.value)}
              className={cn(
                "min-h-11 touch-manipulation rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors",
                status === s.value
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border text-muted-foreground hover:border-primary/40 hover:text-primary"
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      <div className="mt-6">
        {error ? (
          <ErrorState title="Couldn't load events" onRetry={load} />
        ) : loading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-24" />
            ))}
          </div>
        ) : events.length === 0 ? (
          <EmptyState
            icon={CalendarDays}
            title="No events found"
            description={search ? "Try a different search term." : "Create your first event to get started."}
            actionLabel="Create Event"
            onAction={() => router.push("/admin/events/create")}
          />
        ) : (
          <div className="space-y-3">
            {events.map((event) => {
              const now = new Date();
              const isPast = event.endDate ? now > new Date(event.endDate) : false;
              const isOngoing =
                event.startDate && event.endDate
                  ? now >= new Date(event.startDate) && now <= new Date(event.endDate)
                  : false;
              return (
                <div
                  key={event._id}
                  className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-center"
                >
                  {/* Thumb */}
                  <div className="h-20 w-full shrink-0 overflow-hidden rounded-lg bg-muted sm:h-16 sm:w-24">
                    {event.bannerUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={getImageUrl(event.bannerUrl)}
                        alt={event.title}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-brand-light">
                        <CalendarDays className="h-6 w-6 text-primary/50" />
                      </div>
                    )}
                  </div>

                  {/* Info */}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/admin/events/edit/${event._id}`}
                        className="line-clamp-1 font-semibold text-foreground hover:text-primary"
                      >
                        {event.title}
                      </Link>
                      {isOngoing && (
                        <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-bold text-destructive">
                          LIVE
                        </span>
                      )}
                      {isPast && (
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold text-muted-foreground">
                          PAST
                        </span>
                      )}
                      {event.isFeatured && (
                        <span className="rounded-full bg-purple-light px-2 py-0.5 text-[10px] font-bold text-purple">
                          FEATURED
                        </span>
                      )}
                      {event.visibility && event.visibility !== "public" && (
                        <span className="rounded-full bg-warning-light px-2 py-0.5 text-[10px] font-bold text-warning">
                          {event.visibility.toUpperCase()}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      {event.startDate && (
                        <span className="inline-flex items-center gap-1">
                          <CalendarDays className="h-3 w-3" />
                          {new Date(event.startDate).toLocaleDateString("en-IN", {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                          })}
                        </span>
                      )}
                      <span className="inline-flex items-center gap-1">
                        {event.eventType === "online" ? (
                          <>
                            <Video className="h-3 w-3" /> Online
                          </>
                        ) : (
                          <>
                            <MapPin className="h-3 w-3" /> {event.venue || "TBA"}
                          </>
                        )}
                      </span>
                      {event.category && <span>· {event.category}</span>}
                    </p>
                  </div>

                  {/* Actions */}
                  <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                    <Button size="sm" asChild>
                      <Link href={`/admin/events/${event._id}`}>
                        <Settings2 className="mr-1 h-3.5 w-3.5" /> Manage
                      </Link>
                    </Button>
                    <Button size="sm" variant="outline" asChild>
                      <Link href={`/admin/events/edit/${event._id}`}>
                        <Pencil className="mr-1 h-3.5 w-3.5" /> Edit
                      </Link>
                    </Button>
                    <Button size="sm" variant="outline" asChild>
                      <Link href={`/admin/events/${event._id}/scan`}>
                        <QrCode className="mr-1 h-3.5 w-3.5" /> Scan
                      </Link>
                    </Button>
                    <Button size="sm" variant="outline" asChild>
                      <Link href={`/admin/events/${event._id}/analytics`}>
                        <BarChart3 className="mr-1 h-3.5 w-3.5" />
                      </Link>
                    </Button>
                    {event.slug && (
                      <Button size="sm" variant="ghost" asChild title="View public page">
                        <Link href={`/events/${event.slug}`}>↗</Link>
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:bg-destructive/5 hover:text-destructive"
                      onClick={() => handleDelete(event)}
                      disabled={deleting === event._id}
                      title="Delete event"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {!loading && !error && hasMore && (
          <div className="mt-5 text-center">
            <Button variant="outline" onClick={() => void load(nextCursor, true)} disabled={loadingMore || !nextCursor}>
              {loadingMore ? "Loading…" : "Load more events"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
