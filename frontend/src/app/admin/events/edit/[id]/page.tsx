"use client";

import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { api } from "@/utils/api";
import EventForm, { type EventFormValues } from "@/components/admin/event-form";
import { Button } from "@/components/ui/button";
import { PageLoader, ErrorState } from "@/components/states";
import { CheckCircle2, ChevronLeft, ExternalLink } from "lucide-react";

const toInputDate = (iso?: string) => (iso ? new Date(iso).toISOString().split("T")[0] : "");
const toInputTime = (iso?: string, fallback?: string) =>
  fallback || (iso ? new Date(iso).toTimeString().slice(0, 5) : "");

export default function EditEventPage() {
  const { id } = useParams<{ id: string }>();
  const params = useSearchParams();
  const justCreated = params.get("created") === "true";

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [event, setEvent] = useState<any>(null);
  const [slug, setSlug] = useState("");

  const load = () => {
    setLoading(true);
    setError(null);
    api
      .get(`/events/${id}`)
      .then((res) => {
        if (res.data?.success && res.data.event) {
          setEvent(res.data.event);
          setSlug(res.data.event.slug || "");
        } else {
          setError("Event not found");
        }
      })
      .catch((err) => setError(err.response?.data?.message || "Failed to load event"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (loading) return <PageLoader label="Loading event…" />;
  if (error)
    return (
      <div className="space-y-4">
        <Link href="/admin/events" className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-3.5 w-3.5" /> Back to events
        </Link>
        <ErrorState title="Couldn't load event" description={error} onRetry={load} />
      </div>
    );

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
    organization: e.organization || null,
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Link href="/admin/events" className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground">
            <ChevronLeft className="h-3.5 w-3.5" /> Back to events
          </Link>
          <h1 className="mt-1 truncate text-2xl font-bold tracking-tight text-foreground">{e.title || "Edit event"}</h1>
          <p className="text-sm text-muted-foreground">Editing as organizer</p>
        </div>
        {slug && (
          <Link href={`/events/${slug}`} target="_blank">
            <Button variant="outline" className="shrink-0">
              <ExternalLink className="mr-2 h-4 w-4" /> View public page
            </Button>
          </Link>
        )}
      </div>

      {justCreated && (
        <div className="flex items-start gap-2.5 rounded-xl border border-success/30 bg-success-light px-4 py-3.5 text-sm text-success">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            <strong className="font-bold">Event created!</strong> It&apos;s live{e.visibility === "public" ? " and discoverable" : " but " + e.visibility}. Share the
            link, tweak the details below, or manage registrations.
          </span>
        </div>
      )}

      <EventForm mode="edit" eventId={id} initial={initial} />
    </div>
  );
}
