"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, BarChart3, CalendarDays, CalendarPlus, ExternalLink, Pencil, RotateCcw, Archive, Users } from "lucide-react";
import { api } from "@/utils/api";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, PageLoader } from "@/components/states";

interface ManagedEvent {
  _id: string;
  slug: string;
  title: string;
  category?: string;
  venue?: string;
  eventType?: string;
  startDate?: string;
  endDate?: string;
  bannerUrl?: string;
  archivedAt?: string | null;
  visibility?: string;
}

interface OrgSummary {
  _id: string;
  name: string;
  slug: string;
  canManageEvents?: boolean;
}

function eventDate(event: ManagedEvent) {
  if (!event.startDate) return "Date not set";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(event.startDate));
}

export default function OrganizationEventsManagePage() {
  const { slug } = useParams<{ slug: string }>();
  const [organization, setOrganization] = useState<OrgSummary | null>(null);
  const [events, setEvents] = useState<ManagedEvent[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const organizationRef = useRef<{ slug: string; id: string } | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async (cursor: string | null = null, append = false) => {
    if (append && !cursor) return;
    if (append) setLoadingMore(true);
    else {
      setLoading(true);
      setError(null);
      setNextCursor(null);
      setHasMore(false);
    }
    try {
      let organizationId = organizationRef.current?.slug === slug ? organizationRef.current.id : null;
      if (!organizationId) {
        const orgResponse = await api.get(`/organizations/${encodeURIComponent(slug)}`);
        const org = orgResponse.data?.organization;
        if (!org?._id) throw new Error("Organization not found");
        setOrganization(org);
        organizationId = org._id;
        organizationRef.current = { slug, id: org._id };
      }
      const eventResponse = await api.get(`/events/organization/${organizationId}/manage`, {
        params: { archived: showArchived ? "true" : undefined, limit: 50, cursor: cursor || undefined },
      });
      const incoming: ManagedEvent[] = eventResponse.data?.events || [];
      setEvents((previous) => append ? [...previous, ...incoming] : incoming);
      setNextCursor(eventResponse.data?.nextCursor || null);
      setHasMore(Boolean(eventResponse.data?.hasMore));
    } catch (err: any) {
      if (!append) setError(err.response?.data?.message || err.message || "Failed to load organization events");
      else toast.error("Couldn't load more organization events");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [slug, showArchived]);

  useEffect(() => {
    load();
  }, [load]);

  const toggleArchive = async (event: ManagedEvent) => {
    const archived = !event.archivedAt;
    const prompt = archived
      ? `Archive “${event.title}”? It will leave public discovery, but registrations, tickets, posts, and the event URL will be preserved.`
      : `Restore “${event.title}” to public discovery according to its current visibility setting?`;
    if (!window.confirm(prompt)) return;
    setBusyId(event._id);
    try {
      await api.patch(`/events/${event._id}/archive`, { archived });
      toast.success(archived ? "Event archived" : "Event restored");
      await load();
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Couldn't update archive status");
    } finally {
      setBusyId(null);
    }
  };

  if (loading) return <PageLoader label="Loading organization events…" />;
  if (error || !organization) {
    return <ErrorState title="Couldn't load event management" description={error || "Organization not found"} onRetry={load} />;
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 pb-8">
      <div className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div>
          <Link href={`/organizations/${encodeURIComponent(slug)}`} className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-3.5 w-3.5" /> {organization.name}
          </Link>
          <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-foreground">Event management</h1>
          <p className="mt-1 text-sm text-muted-foreground">Only Events explicitly owned by this organization appear here.</p>
        </div>
        <Button asChild className="min-h-11 gap-2 rounded-xl">
          <Link href={`/organizations/${encodeURIComponent(slug)}/events/new`}>
            <CalendarPlus className="h-4 w-4" /> Create event
          </Link>
        </Button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-foreground">{showArchived ? "Archived events" : "Active events"}</h2>
          <p className="text-xs text-muted-foreground">Showing {events.length} event{events.length === 1 ? "" : "s"}</p>
        </div>
        <Button variant="outline" className="min-h-10 gap-2 rounded-xl" onClick={() => setShowArchived((value) => !value)}>
          {showArchived ? <RotateCcw className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
          {showArchived ? "Show active" : "Show archived"}
        </Button>
      </div>

      {events.length === 0 ? (
        <EmptyState
          icon={CalendarDays}
          title={showArchived ? "No archived events" : "No organization-owned events yet"}
          description={showArchived ? "Archived Events remain recoverable here." : "Create an event here to make this organization its explicit owner. Existing organization links alone do not transfer ownership."}
        />
      ) : (
        <div className="grid gap-3">
          {events.map((event) => (
            <article key={event._id} className="rounded-2xl border border-border bg-card p-4 sm:p-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                {event.bannerUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={event.bannerUrl} alt="" className="h-24 w-full rounded-xl object-cover sm:h-20 sm:w-32" />
                ) : (
                  <div className="grid h-20 w-32 shrink-0 place-items-center rounded-xl bg-brand-light text-primary"><CalendarDays className="h-7 w-7" /></div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-base font-bold text-foreground">{event.title}</h3>
                    {event.archivedAt && <span className="rounded-full bg-muted px-2.5 py-1 text-[10px] font-bold text-muted-foreground">Archived</span>}
                    {!event.archivedAt && event.visibility !== "public" && <span className="rounded-full bg-warning-light px-2.5 py-1 text-[10px] font-bold text-warning">{event.visibility}</span>}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{eventDate(event)}{event.venue ? ` · ${event.venue}` : ""}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">{event.category || "Event"} · {event.eventType || "offline"}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button asChild size="sm" variant="outline" className="min-h-9 gap-1.5 rounded-lg">
                      <Link href={`/organizations/${encodeURIComponent(slug)}/events/${event._id}/edit`}><Pencil className="h-3.5 w-3.5" /> Edit details</Link>
                    </Button>
                    <Button asChild size="sm" variant="outline" className="min-h-9 gap-1.5 rounded-lg">
                      <Link href={`/admin/events/${event._id}`}><Users className="h-3.5 w-3.5" /> Operations</Link>
                    </Button>
                    <Button asChild size="sm" variant="outline" className="min-h-9 gap-1.5 rounded-lg">
                      <Link href={`/admin/events/${event._id}/analytics`}><BarChart3 className="h-3.5 w-3.5" /> Analytics</Link>
                    </Button>
                    {!event.archivedAt && event.slug && (
                      <Button asChild size="sm" variant="ghost" className="min-h-9 gap-1.5 rounded-lg">
                        <Link href={`/events/${event.slug}`} target="_blank"><ExternalLink className="h-3.5 w-3.5" /> Public page</Link>
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" className="min-h-9 gap-1.5 rounded-lg" disabled={busyId === event._id} onClick={() => toggleArchive(event)}>
                      {event.archivedAt ? <RotateCcw className="h-3.5 w-3.5" /> : <Archive className="h-3.5 w-3.5" />}
                      {busyId === event._id ? "Saving…" : event.archivedAt ? "Restore" : "Archive"}
                    </Button>
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
      {hasMore && (
        <div className="pt-2 text-center">
          <Button variant="outline" disabled={loadingMore || !nextCursor} onClick={() => void load(nextCursor, true)}>
            {loadingMore ? "Loading…" : "Load more events"}
          </Button>
        </div>
      )}
    </div>
  );
}
