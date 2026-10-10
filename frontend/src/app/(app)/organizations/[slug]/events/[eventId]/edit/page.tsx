"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { api } from "@/utils/api";
import EventForm, { type EventFormValues } from "@/components/admin/event-form";
import { Button } from "@/components/ui/button";
import { ErrorState, PageLoader } from "@/components/states";

const toInputDate = (iso?: string) => (iso ? new Date(iso).toISOString().split("T")[0] : "");
const toInputTime = (iso?: string, fallback?: string) => fallback || (iso ? new Date(iso).toTimeString().slice(0, 5) : "");

export default function OrganizationEditEventPage() {
  const { slug, eventId } = useParams<{ slug: string; eventId: string }>();
  const [organization, setOrganization] = useState<any>(null);
  const [event, setEvent] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [orgResponse, eventResponse] = await Promise.all([
        api.get(`/organizations/${encodeURIComponent(slug)}`),
        api.get(`/events/${eventId}`),
      ]);
      const org = orgResponse.data?.organization;
      const ev = eventResponse.data?.event;
      if (!org?._id || !ev?._id) throw new Error("Organization or event not found");
      if (!org.canManageEvents) throw new Error("You can't manage this organization's events");
      if (ev.organizerType !== "ORGANIZATION" || String(ev.organizerId) !== String(org._id)) {
        throw new Error("This event is not owned by the selected organization");
      }
      setOrganization(org);
      setEvent(ev);
    } catch (err: any) {
      setError(err.response?.data?.message || err.message || "Failed to load event");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, eventId]);

  if (loading) return <PageLoader label="Loading event…" />;
  if (error || !organization || !event) return <ErrorState title="Couldn't load event" description={error || "Event not found"} onRetry={load} />;

  const handle = organization.handle || organization.slug;
  const returnTo = `/organizations/${encodeURIComponent(handle)}/events/manage`;
  const e = event;
  const initial: Partial<EventFormValues> & Record<string, any> = {
    title: e.title || "",
    description: e.description || "",
    category: e.category || "General",
    eventType: e.eventType || "offline",
    venue: e.venue || "",
    venueIframeLink: e.venueIframeLink || "",
    onlineEventLink: e.onlineEventLink || "",
    platform: e.platform || "",
    meetingId: e.meetingId || "",
    passcode: e.passcode || "",
    organizer: e.organizer || "",
    maxAttendees: e.maxAttendees ?? 100,
    minAttendees: e.minAttendees ?? 1,
    price: e.price ?? 0,
    theme: e.theme || "Fire",
    startDate: toInputDate(e.startDate),
    startTime: toInputTime(e.startDate, e.startTime),
    endDate: toInputDate(e.endDate),
    endTime: toInputTime(e.endDate, e.endTime),
    registrationLink: e.registrationLink || "",
    whatsappGroup: e.whatsappGroup || "",
    isFeatured: Boolean(e.isFeatured),
    visibility: e.visibility || "public",
    ticketSettings: e.ticketSettings,
    speakers: e.speakers,
    schedule: e.schedule,
    benefits: e.benefits,
    partners: e.partners,
    registrationForm: e.registrationForm,
    requiredProfileFields: e.requiredProfileFields,
    bannerUrl: e.bannerUrl || "",
    logoUrl: e.logoUrl || "",
    organization: e.organization?._id || e.organization || null,
    community: e.community?._id || e.community || null,
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 pb-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Link href={returnTo} className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-3.5 w-3.5" /> Back to event management
          </Link>
          <h1 className="mt-2 truncate text-2xl font-extrabold tracking-tight text-foreground">Edit {e.title}</h1>
          <p className="text-sm text-muted-foreground">Owner: {organization.name} · Event ID and public URL are unchanged by ownership.</p>
        </div>
        {e.slug && (
          <Button asChild variant="outline" className="shrink-0">
            <Link href={`/events/${e.slug}`} target="_blank"><ExternalLink className="mr-2 h-4 w-4" /> Public page</Link>
          </Button>
        )}
      </div>
      <EventForm
        mode="edit"
        eventId={eventId}
        initial={initial}
        ownerOrganization={{ _id: organization._id, name: organization.name, slug: handle }}
      />
    </div>
  );
}
