"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Camera } from "lucide-react";
import { api } from "@/utils/api";
import { PageLoader, ErrorState } from "@/components/states";
import { Memories } from "@/components/events/memories";
import { cloudinaryUrl } from "@/utils/image";

/** Full-page memory wall for an event. */
export default function EventMemoriesPage() {
  const { slug } = useParams<{ slug: string }>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [event, setEvent] = useState<any>(null);

  useEffect(() => {
    setLoading(true);
    api
      .get(`/events/slug/${slug}`)
      .then((res) => {
        if (res.data?.event) setEvent(res.data.event);
        else setError(res.data?.message || "Event not found");
      })
      .catch((err) => setError(err.response?.data?.message || "Failed to load event"))
      .finally(() => setLoading(false));
  }, [slug]);

  if (loading) return <PageLoader label="Loading memories…" />;
  if (error || !event)
    return (
      <div className="mx-auto max-w-2xl px-3 py-8">
        <ErrorState title="Couldn't load memories" description={error || undefined} onRetry={() => window.location.reload()} />
      </div>
    );

  const status =
    new Date(event.endDate) < new Date() ? "past" : new Date(event.startDate) <= new Date() ? "ongoing" : "upcoming";

  return (
    <div className="mx-auto max-w-5xl px-3 py-5 sm:px-6">
      {/* Header */}
      <div className="relative overflow-hidden rounded-2xl border border-border">
        <div className="absolute inset-0">
          {event.bannerUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={cloudinaryUrl(event.bannerUrl, { w: 1200, h: 300 })} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="h-full w-full bg-gradient-to-br from-navy to-brand-dark" />
          )}
          <div className="absolute inset-0 bg-black/55" />
        </div>
        <div className="relative p-5 sm:p-7">
          <Link
            href={`/events/${slug}`}
            className="inline-flex items-center gap-1 text-xs font-semibold text-white/80 hover:text-white"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back to event
          </Link>
          <h1 className="mt-2 flex items-center gap-2.5 text-2xl font-extrabold tracking-tight text-white sm:text-3xl">
            <Camera className="h-6 w-6 text-white/90" /> Memories
          </h1>
          <p className="mt-1 text-sm text-white/80">{event.title}</p>
        </div>
      </div>

      <Memories
        eventId={event._id}
        eventSlug={slug}
        eventTitle={event.title}
        status={status}
        pageSize={20}
      />
    </div>
  );
}
