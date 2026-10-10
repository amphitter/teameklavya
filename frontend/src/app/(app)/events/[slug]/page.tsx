"use client";

import { safeExternalUrl } from '@/utils/safe-url';
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  BadgeCheck,
  Building2,
  CalendarDays,
  CheckCircle2,
  Clock,
  Download,
  ExternalLink,
  Flag,
  Gift,
  Globe,
  Handshake,
  Info,
  Linkedin,
  MapPin,
  Megaphone,
  Mic,
  QrCode,
  Share2,
  Star,
  Ticket,
  Users,
  Video,
  Target,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/utils/api";
import { getImageUrl } from "@/utils/image";
import RegistrationForm, { type RegistrationField } from "@/components/RegistrationForm";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EventCard, type EventCardData } from "@/components/event-card";
import { EventLogo } from "@/components/events/event-logo";
import { UserAvatar } from "@/components/user-avatar";
import { ReportDialog } from "@/components/moderation/report-dialog";
import { Memories } from "@/components/events/memories";
import { ErrorState, PageLoader } from "@/components/states";
import { cn } from "@/lib/utils";
import { useQuery } from "@/lib/query";

// ─── Types ─────────────────────────────────────────────────
interface Speaker {
  name: string;
  designation?: string;
  company?: string;
  linkedin?: string;
  imageUrl?: string;
}

interface ScheduleItem {
  day?: string;
  time?: string;
  title: string;
  description?: string;
  speakers?: string[];
}

interface Partner {
  name: string;
  role?: string;
  website?: string;
  logoUrl?: string;
}

interface EventData {
  _id: string;
  slug?: string;
  title: string;
  description: string;
  eventType: "online" | "offline" | "hybrid";
  venue?: string;
  venueIframeLink?: string;
  onlineEventLink?: string;
  platform?: string | null;
  startDate: string;
  endDate: string;
  startTime?: string;
  endTime?: string;
  bannerUrl?: string;
  logoUrl?: string | null;
  organizer?: string;
  category?: string;
  maxAttendees?: number;
  price?: number;
  isFeatured?: boolean;
  speakers?: Speaker[];
  schedule?: ScheduleItem[];
  benefits?: string[];
  partners?: Partner[];
  requiredProfileFields?: { institution: boolean; course: boolean; year: boolean };
  registrationForm?: RegistrationField[];
  instructions?: { online?: string; offline?: string; general?: string };
  organization?: { _id: string; name: string; slug: string; logoUrl?: string } | null;
}

interface UserTicket {
  _id: string;
  qrCode: string;
  token: string;
  status?: string;
  checkedIn: boolean;
  checkInTime?: string;
}

// ─── Helpers ───────────────────────────────────────────────
function computeStatus(startDate?: string, endDate?: string): "upcoming" | "ongoing" | "past" {
  const now = new Date();
  if (endDate && now > new Date(endDate)) return "past";
  if (startDate && now < new Date(startDate)) return "upcoming";
  return "ongoing";
}

function fmtDate(d?: string) {
  if (!d) return "TBA";
  return new Date(d).toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function fmtShortDate(d?: string) {
  if (!d) return "";
  return new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

// ─── Page ──────────────────────────────────────────────────
export default function EventDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();

  const [event, setEvent] = useState<EventData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [userRegistered, setUserRegistered] = useState(false);
  const [userTicket, setUserTicket] = useState<UserTicket | null>(null);
  const [registrationCount, setRegistrationCount] = useState<number | null>(null);

  // "Interested" soft-follow (Phase 5): real count + my state + real preview
  const [interest, setInterest] = useState<{ count: number; interested: boolean; preview: any[] } | null>(null);
  const [reporting, setReporting] = useState(false);

  const [showRegistration, setShowRegistration] = useState(false);
  const [showTicketModal, setShowTicketModal] = useState(false);
  const [related, setRelated] = useState<EventCardData[]>([]);
  const [participants, setParticipants] = useState<{ _id: string; firstName: string; lastName: string; avatar: string | null }[]>([]);
  const [liveQuiz, setLiveQuiz] = useState<{ _id: string; title: string } | null>(null);

  // Auth check
  useEffect(() => {
    const token = localStorage.getItem("token");
    setIsAuthenticated(Boolean(token));
  }, []);

  /* Fetch event — §15 dedup + §17 prefetch payoff.
   * This reads the SAME cache key that EventCard warms on hover, so a card
   * hover turns the next navigation into an instant paint instead of a
   * spinner. The 60s staleTime keeps back-and-forth navigation free. */
  const {
    data: eventRes,
    error: eventErr,
    isLoading: eventLoading,
  } = useQuery<{ success?: boolean; event?: any; message?: string }>(
    ["event", slug],
    slug ? `/events/slug/${slug}` : null,
    { staleTime: 60_000 }
  );

  useEffect(() => {
    if (eventRes) {
      if (eventRes.success && eventRes.event) {
        setEvent(eventRes.event);
        setError(null);
      } else {
        setError(eventRes.message || "Event not found");
      }
    } else if (eventErr) {
      // §61 — surface the server's own message, never a stack or provider error
      setError((eventErr as any)?.response?.data?.message || "Failed to load event");
    }
  }, [eventRes, eventErr]);

  // Registration count (public, counts only)
  useEffect(() => {
    if (!event?._id) return;
    api
      .get(`/registration/responses/${event._id}/count`)
      .then((r) => setRegistrationCount(r.data?.count ?? null))
      .catch(() => {});
  }, [event?._id]);

  // Interest state (public counts; "mine" only when signed in)
  useEffect(() => {
    if (!event?._id) return;
    api
      .get(`/events/${event._id}/interest`)
      .then((r) => {
        if (r.data?.success) setInterest({ count: r.data.count ?? 0, interested: Boolean(r.data.interested), preview: r.data.preview || [] });
      })
      .catch(() => {});
  }, [event?._id]);

  const toggleInterest = () => {
    if (!event?._id || !isAuthenticated) return;
    api
      .post(`/events/${event._id}/interest`)
      .then((r) => {
        if (r.data?.success) {
          setInterest((prev) => (prev ? { ...prev, interested: Boolean(r.data.interested), count: r.data.count ?? prev.count } : prev));
          toast.success(r.data.interested ? "Marked as interested" : "Removed interest");
        }
      })
      .catch(() => toast.error("Couldn't update interest"));
  };

  // Registration status + ticket (authenticated)
  useEffect(() => {
    if (!event?._id || !isAuthenticated) return;
    (async () => {
      try {
        const res = await api.get(`/registration/responses/status/${event._id}`);
        setUserRegistered(Boolean(res.data?.registered));
        if (res.data?.registered) {
          const ticketsRes = await api.get("/tickets/user-tickets");
          const t = (ticketsRes.data?.tickets ?? []).find(
            (t: any) => t.eventId?._id === event._id
          );
          if (t) setUserTicket(t);
        }
      } catch {
        // ignore — treated as not registered
      }
    })();
  }, [event?._id, isAuthenticated]);

  // Related events (same category)
  useEffect(() => {
    if (!event?._id || !event?.category) return;
    api
      .get("/events", { params: { category: event.category, limit: 4, type: "upcoming" } })
      .then((r) => {
        const evts = (r.data?.events ?? []).filter((e: any) => e.slug !== slug).slice(0, 3);
        setRelated(evts);
      })
      .catch(() => {});

    // Real participants (confirmed registrations, minimal fields)
    api
      .get(`/events/${event._id}/participants`)
      .then((res) => setParticipants(res.data?.participants || []))
      .catch(() => {});

    // Live activity: is there a live quiz right now?
    api
      .get(`/quizzes/event/${event._id}`)
      .then((res) => {
        const live = (res.data?.quizzes || []).find((q: any) => q.status === "live");
        setLiveQuiz(live ? { _id: live._id, title: live.title } : null);
      })
      .catch(() => {});
  }, [event?._id, event?.category, slug]);

  const status = useMemo(
    () => (event ? computeStatus(event.startDate, event.endDate) : "upcoming"),
    [event]
  );

  const isFull =
    typeof event?.maxAttendees === "number" &&
    registrationCount !== null &&
    registrationCount >= event.maxAttendees;

  const isFree = !event?.price || event.price === 0;
  const capacityPct =
    event?.maxAttendees && registrationCount !== null
      ? Math.min(100, Math.round((registrationCount / event.maxAttendees) * 100))
      : null;

  const shareEvent = async () => {
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({ title: event?.title, text: event?.description?.slice(0, 100), url });
      } catch {
        /* user cancelled */
      }
    } else {
      await navigator.clipboard.writeText(url);
      toast.success("Event link copied!");
    }
  };

  // Post this event to the social feed (event-native post)
  const [sharingToFeed, setSharingToFeed] = useState(false);
  const shareToFeed = async () => {
    if (!isAuthenticated) {
      router.push(`/login?returnUrl=${encodeURIComponent(`/events/${event?.slug || ""}`)}`);
      return;
    }
    if (!event || sharingToFeed) return;
    setSharingToFeed(true);
    try {
      const res = await api.post("/posts", {
        content: `Sharing this event: ${event.title}`,
        eventId: event._id,
      });
      if (res.data?.success) {
        toast.success("Shared to your feed");
      } else {
        toast.error(res.data?.message || "Couldn't share to feed");
      }
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Couldn't share to feed");
    } finally {
      setSharingToFeed(false);
    }
  };

  const handleRegisterClick = () => {
    if (!isAuthenticated) {
      const currentUrl = window.location.pathname + window.location.search;
      router.push(`/login?returnUrl=${encodeURIComponent(currentUrl)}`);
      return;
    }
    setShowRegistration(true);
  };

  const handleRegisterSuccess = () => {
    setShowRegistration(false);
    setUserRegistered(true);
    // refresh count + ticket
    if (event?._id) {
      api
        .get(`/registration/responses/${event._id}/count`)
        .then((r) => setRegistrationCount(r.data?.count ?? null))
        .catch(() => {});
      api
        .get("/tickets/user-tickets")
        .then((r) => {
          const t = (r.data?.tickets ?? []).find((t: any) => t.eventId?._id === event._id);
          if (t) setUserTicket(t);
        })
        .catch(() => {});
    }
  };

  // ─── States ─────────────────────────────────────────────
  if (eventLoading) return <PageLoader label="Loading event…" />;

  if (error || !event) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        <ErrorState
          title={error === "Event not found" ? "Event not found" : "Couldn't load event"}
          description={
            error === "Event not found"
              ? "This event may have been removed, or the link is incorrect."
              : error || undefined
          }
        />
        <div className="mt-6 text-center">
          <Button variant="outline" asChild>
            <Link href="/events">
              <ArrowLeft className="mr-2 h-4 w-4" /> Back to Discover
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  const bannerUrl = getImageUrl(event.bannerUrl);

  const registerCta = () => {
    if (status === "past") return { label: "This event has ended", disabled: true };
    if (userRegistered)
      return {
        label: userTicket ? "View My Ticket" : "Registered ✓",
        disabled: false,
        action: userTicket ? () => setShowTicketModal(true) : undefined,
        registered: true,
      };
    if (isFull) return { label: "Event Full", disabled: true };
    return { label: isFree ? "Register — Free" : `Register — ₹${event.price}`, disabled: false, action: handleRegisterClick };
  };
  const cta = registerCta();

  return (
    <>
    <div className="pb-24 md:pb-10">
      {/* ── Hero ─────────────────────────────────────────── */}
      <div className="relative">
        <div className="relative h-56 w-full overflow-hidden bg-muted sm:h-72 md:h-96">
          {bannerUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={bannerUrl} alt={event.title} className="h-full w-full object-cover" />
          ) : (
            <div className="bg-dots flex h-full w-full items-center justify-center bg-brand-light">
              <CalendarDays className="h-14 w-14 text-primary/40" />
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-navy/80 via-navy/25 to-transparent" />

          {/* Chips over hero */}
          <div className="absolute left-4 top-4 flex flex-wrap gap-2 sm:left-6">
            {event.category && (
              <span className="rounded-full bg-white/95 px-3 py-1 text-xs font-semibold text-navy shadow-sm">
                {event.category}
              </span>
            )}
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/95 px-3 py-1 text-xs font-semibold text-navy shadow-sm">
              {event.eventType === "online" ? (
                <Video className="h-3.5 w-3.5 text-cyan" />
              ) : event.eventType === "hybrid" ? (
                <Globe className="h-3.5 w-3.5 text-cyan" />
              ) : (
                <MapPin className="h-3.5 w-3.5 text-cyan" />
              )}
              {event.eventType === "online"
                ? "Online"
                : event.eventType === "hybrid"
                  ? "Hybrid"
                  : "In person"}
            </span>
            {status === "ongoing" && (
              <span className="flex items-center gap-1.5 rounded-full bg-destructive px-3 py-1 text-xs font-semibold text-white shadow-sm">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" /> LIVE NOW
              </span>
            )}
            {status === "past" && (
              <span className="rounded-full bg-navy/80 px-3 py-1 text-xs font-semibold text-white/90">
                Past event
              </span>
            )}
          </div>
        </div>

        {/* Title block overlapping the banner */}
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="relative -mt-16 rounded-xl border border-border bg-card p-5 shadow-sm sm:-mt-20 sm:p-7">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex min-w-0 flex-1 items-start gap-3 sm:gap-4">
                <EventLogo logoUrl={event.logoUrl} title={event.title} className="mt-0.5 h-12 w-12 rounded-xl sm:h-16 sm:w-16" />
                <div className="min-w-0 flex-1">
                  <h1 className="text-2xl font-extrabold tracking-tight text-foreground sm:text-3xl md:text-4xl">
                    {event.title}
                  </h1>
                  {event.organizer && (
                    <div className="mt-2.5 flex items-center gap-2 text-sm text-muted-foreground">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-purple-light text-[10px] font-bold text-purple">
                        {(event.organizer[0] || "E").toUpperCase()}
                      </span>
                      Hosted by{" "}
                      <span className="font-semibold text-foreground">{event.organizer}</span>
                    </div>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button variant="outline" size="sm" onClick={shareEvent}>
                  <Share2 className="mr-1.5 h-4 w-4" /> Share
                </Button>
                {isAuthenticated && (
                  <Button variant="outline" size="sm" onClick={() => setReporting(true)} aria-label="Report event">
                    <Flag className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>

            {/* Quick meta row (mobile-friendly) */}
            <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <CalendarDays className="h-4 w-4 text-primary" /> {fmtDate(event.startDate)}
              </span>
              {event.startTime && (
                <span className="inline-flex items-center gap-1.5">
                  <Clock className="h-4 w-4 text-primary" /> {event.startTime}
                  {event.endTime ? ` – ${event.endTime}` : ""}
                </span>
              )}
              <span className="inline-flex items-center gap-1.5">
                {event.eventType === "online" ? (
                  <>
                    <Video className="h-4 w-4 text-cyan" /> Online
                    {event.platform ? ` · ${event.platform}` : ""}
                  </>
                ) : (
                  <>
                    <MapPin className="h-4 w-4 text-cyan" /> {event.venue || "Venue TBA"}
                  </>
                )}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Ticket className="h-4 w-4 text-primary" /> {isFree ? "Free" : `₹${event.price}`}
              </span>
              {registrationCount !== null && (
                <span className="inline-flex items-center gap-1.5">
                  <Users className="h-4 w-4 text-primary" /> {registrationCount} registered
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Lifecycle banner ─────────────────────────────── */}
      {status === "ongoing" && (
        <div className="border-b border-destructive/20 bg-destructive/5">
          <div className="mx-auto flex max-w-6xl items-center gap-2.5 px-4 py-2.5 text-sm font-semibold text-destructive sm:px-6">
            <span className="h-2 w-2 animate-live-pulse rounded-full bg-destructive" />
            This event is happening right now — join the action!
          </div>
        </div>
      )}
      {liveQuiz && (
        <div className="border-b border-primary/25 bg-brand-light">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-2.5 sm:px-6">
            <p className="flex items-center gap-2 text-sm font-bold text-primary">
              <Target className="h-4 w-4" />
              Live quiz happening now: {liveQuiz.title}
            </p>
            <Link
              href={`/quiz/${liveQuiz._id}`}
              className="rounded-full bg-primary px-3.5 py-1 text-xs font-bold text-primary-foreground transition-opacity hover:opacity-90"
            >
              Join & play →
            </Link>
          </div>
        </div>
      )}
      {status === "past" && (
        <div className="border-b border-border bg-muted/50">
          <div className="mx-auto flex max-w-6xl items-center gap-2.5 px-4 py-2.5 text-sm font-medium text-muted-foreground sm:px-6">
            <Info className="h-4 w-4" /> This event has ended — relive the highlights below.
          </div>
        </div>
      )}

      {/* ── Body grid ────────────────────────────────────── */}
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:px-6 lg:grid-cols-3">
        {/* Main column */}
        <div className="space-y-10 lg:col-span-2">
          {/* About */}
          <section>
            <h2 className="text-lg font-bold text-foreground">About this event</h2>
            <p className="mt-3 whitespace-pre-line text-[15px] leading-relaxed text-muted-foreground">
              {event.description || "No description provided yet."}
            </p>
          </section>

          {/* Schedule */}
          {event.schedule && event.schedule.length > 0 && (
            <section>
              <h2 className="text-lg font-bold text-foreground">Schedule</h2>
              <div className="mt-4 space-y-0">
                {event.schedule.map((item, i) => (
                  <div key={i} className="relative flex gap-4 pb-6 last:pb-0">
                    {/* timeline line */}
                    {i < (event.schedule?.length ?? 0) - 1 && (
                      <span className="absolute left-[7px] top-5 h-full w-px bg-border" aria-hidden />
                    )}
                    <span className="relative mt-1.5 h-[15px] w-[15px] shrink-0 rounded-full border-[3px] border-primary bg-card" />
                    <div className="min-w-0 flex-1 rounded-lg border border-border bg-card p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h3 className="text-sm font-semibold text-foreground">{item.title}</h3>
                        {(item.day || item.time) && (
                          <span className="rounded-full bg-accent px-2.5 py-1 text-[11px] font-semibold text-primary">
                            {[fmtShortDate(item.day), item.time].filter(Boolean).join(" · ")}
                          </span>
                        )}
                      </div>
                      {item.description && (
                        <p className="mt-1.5 text-sm text-muted-foreground">{item.description}</p>
                      )}
                      {item.speakers && item.speakers.length > 0 && (
                        <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Mic className="h-3.5 w-3.5" /> {item.speakers.join(", ")}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Speakers */}
          {event.speakers && event.speakers.length > 0 && (
            <section>
              <h2 className="text-lg font-bold text-foreground">Speakers</h2>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                {event.speakers.map((s, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-4 rounded-xl border border-border bg-card p-4"
                  >
                    {s.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={getImageUrl(s.imageUrl)}
                        alt={s.name}
                        className="h-14 w-14 shrink-0 rounded-full border border-border object-cover"
                      />
                    ) : (
                      <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-brand-light text-lg font-bold text-primary">
                        {(s.name || "?")[0]}
                      </span>
                    )}
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                        {s.name}
                        {s.linkedin && (
                          <a
                            href={safeExternalUrl(s.linkedin) ?? '#'}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-muted-foreground hover:text-primary"
                            aria-label={`${s.name} on LinkedIn`}
                          >
                            <Linkedin className="h-3.5 w-3.5" />
                          </a>
                        )}
                      </p>
                      {(s.designation || s.company) && (
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {[s.designation, s.company].filter(Boolean).join(" · ")}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Benefits */}
          {event.benefits && event.benefits.length > 0 && (
            <section>
              <h2 className="text-lg font-bold text-foreground">What you&apos;ll get</h2>
              <ul className="mt-4 grid gap-2.5 sm:grid-cols-2">
                {event.benefits.map((b, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-2.5 rounded-lg border border-border bg-card px-4 py-3 text-sm text-foreground"
                  >
                    <Gift className="mt-0.5 h-4 w-4 shrink-0 text-purple" />
                    {b}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Partners */}
          {event.partners && event.partners.length > 0 && (
            <section>
              <h2 className="text-lg font-bold text-foreground">Partners</h2>
              <div className="mt-4 flex flex-wrap gap-3">
                {event.partners.map((p, i) => (
                  <a
                    key={i}
                    href={p.website || undefined}
                    target={p.website ? "_blank" : undefined}
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 transition-colors hover:border-primary/40"
                  >
                    {p.logoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={getImageUrl(p.logoUrl)}
                        alt={p.name}
                        className="h-8 w-8 rounded object-contain"
                      />
                    ) : (
                      <Handshake className="h-6 w-6 text-muted-foreground" />
                    )}
                    <div>
                      <p className="text-sm font-semibold text-foreground">{p.name}</p>
                      {p.role && <p className="text-xs text-muted-foreground">{p.role}</p>}
                    </div>
                  </a>
                ))}
              </div>
            </section>
          )}

          {/* Map */}
          {event.venueIframeLink && event.eventType !== "online" && (
            <section>
              <h2 className="text-lg font-bold text-foreground">Location</h2>
              <div className="mt-4 overflow-hidden rounded-xl border border-border">
                <iframe
                  src={event.venueIframeLink}
                  title={`Map — ${event.venue || event.title}`}
                  className="h-72 w-full"
                  loading="lazy"
                />
              </div>
            </section>
          )}

          {/* Instructions */}
          {event.instructions &&
            [event.instructions.general, event.instructions.online, event.instructions.offline].some(
              Boolean
            ) && (
              <section>
                <h2 className="text-lg font-bold text-foreground">Instructions</h2>
                <div className="mt-4 space-y-3">
                  {[
                    { label: "General", value: event.instructions.general },
                    {
                      label: "For online attendees",
                      value: event.instructions.online,
                    },
                    { label: "For in-person attendees", value: event.instructions.offline },
                  ]
                    .filter((i) => i.value)
                    .map((i) => (
                      <div key={i.label} className="rounded-lg border border-border bg-card p-4">
                        <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
                          <Info className="h-4 w-4 text-primary" /> {i.label}
                        </p>
                        <p className="mt-1.5 whitespace-pre-line text-sm text-muted-foreground">
                          {i.value}
                        </p>
                      </div>
                    ))}
                </div>
              </section>
            )}

                    {/* Participants — real confirmed registrations */}
          {participants.length > 0 && (
            <section>
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-foreground">Participants</h2>
                <span className="text-xs font-semibold text-muted-foreground">
                  {participants.length} confirmed
                </span>
              </div>
              <div className="mt-4 flex flex-wrap gap-2.5">
                {participants.slice(0, 18).map((p) => (
                  <Link
                    key={p._id}
                    href={`/profile/${p._id}`}
                    title={`${p.firstName} ${p.lastName}`}
                    className="group flex items-center gap-2 rounded-full border border-border bg-card py-1 pl-1 pr-3.5 transition-colors hover:border-primary/40"
                  >
                    {p.avatar ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.avatar} alt="" className="h-7 w-7 rounded-full object-cover" />
                    ) : (
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-light text-[11px] font-bold text-primary">
                        {p.firstName[0]}
                        {p.lastName?.[0] || ""}
                      </span>
                    )}
                    <span className="text-xs font-semibold text-foreground group-hover:text-primary">
                      {p.firstName} {p.lastName}
                    </span>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {/* Memories — community posts attached to this event */}
          {event && (
            <Memories
              eventId={event._id}
              eventSlug={event.slug || slug}
              eventTitle={event.title}
              status={status}
              isParticipant={userRegistered}
              pageSize={8}
              showViewAll
            />
          )}

{/* Related events */}
          {related.length > 0 && (
            <section>
              <div className="flex items-end justify-between">
                <h2 className="text-lg font-bold text-foreground">More {event.category} events</h2>
                <Link
                  href={`/events?category=${encodeURIComponent(event.category || "")}`}
                  className="text-sm font-semibold text-primary hover:underline"
                >
                  View all
                </Link>
              </div>
              <div className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {related.map((e) => (
                  <EventCard key={e._id} event={e} />
                ))}
              </div>
            </section>
          )}
        </div>

        {/* Sidebar */}
        <aside className="lg:col-span-1">
          <div className="space-y-4 lg:sticky lg:top-20">
            <Card>
              <CardContent className="p-6">
                {/* Price */}
                <div className="flex items-baseline justify-between">
                  <span className="text-2xl font-extrabold text-foreground">
                    {isFree ? "Free" : `₹${event.price}`}
                  </span>
                  <span className="rounded-full bg-accent px-3 py-1 text-xs font-semibold text-primary">
                    {status === "upcoming" ? "Registration open" : status === "ongoing" ? "Happening now" : "Ended"}
                  </span>
                </div>

                {/* Capacity */}
                {capacityPct !== null && (
                  <div className="mt-4">
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>
                        {registrationCount} of {event.maxAttendees} spots
                      </span>
                      <span>{capacityPct}%</span>
                    </div>
                    <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted">
                      <div
                        className={cn(
                          "h-full rounded-full transition-all",
                          capacityPct >= 100 ? "bg-destructive" : "bg-primary"
                        )}
                        style={{ width: `${capacityPct}%` }}
                      />
                    </div>
                  </div>
                )}

                {/* Meta list */}
                <div className="mt-5 space-y-3.5 border-t border-border pt-5 text-sm">
                  <div className="flex items-start gap-3">
                    <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <div>
                      <p className="font-medium text-foreground">{fmtDate(event.startDate)}</p>
                      {(event.startTime || event.endTime) && (
                        <p className="text-xs text-muted-foreground">
                          {event.startTime || "TBA"} {event.endTime ? `– ${event.endTime}` : ""}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    {event.eventType === "online" ? (
                      <Video className="mt-0.5 h-4 w-4 shrink-0 text-cyan" />
                    ) : (
                      <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-cyan" />
                    )}
                    <div>
                      <p className="font-medium text-foreground">
                        {event.eventType === "online"
                          ? `Online${event.platform ? ` · ${event.platform}` : ""}`
                          : event.venue || "Venue TBA"}
                      </p>
                      {event.eventType === "hybrid" && (
                        <p className="text-xs text-muted-foreground">Also available online</p>
                      )}
                    </div>
                  </div>
                  {(event.organization || event.organizer) && (
                    <div className="flex items-start gap-3">
                      <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-purple" />
                      {event.organization ? (
                        <Link
                          href={`/organizations/${event.organization.slug}`}
                          className="font-medium text-foreground hover:text-primary"
                        >
                          {event.organization.name}
                          <span className="block text-xs text-muted-foreground">View community →</span>
                        </Link>
                      ) : (
                        <p className="font-medium text-foreground">{event.organizer}</p>
                      )}
                    </div>
                  )}
                </div>

                {/* CTA */}
                <Button
                  className="mt-6 w-full py-3 text-base font-semibold"
                  size="lg"
                  variant={cta.registered ? "outline" : "default"}
                  disabled={cta.disabled}
                  onClick={cta.action ?? (userRegistered ? () => setShowTicketModal(true) : handleRegisterClick)}
                >
                  {cta.registered && <CheckCircle2 className="mr-2 h-4 w-4 text-success" />}
                  {cta.label}
                </Button>

                {isAuthenticated && (
                  <Button
                    variant="outline"
                    className="mt-2.5 w-full"
                    onClick={toggleInterest}
                  >
                    <Star
                      className={`mr-2 h-4 w-4 ${interest?.interested ? "fill-warning text-warning" : ""}`}
                    />
                    {interest?.interested ? "Interested" : "I'm interested"}
                  </Button>
                )}

                {userRegistered && userTicket && (
                  <Button
                    variant="outline"
                    className="mt-2.5 w-full"
                    onClick={() => setShowTicketModal(true)}
                  >
                    <QrCode className="mr-2 h-4 w-4" /> View my ticket
                  </Button>
                )}

                {userRegistered && !userTicket && (
                  <p className="mt-2.5 text-center text-xs text-muted-foreground">
                    Your ticket will appear here once the organizer issues it.
                  </p>
                )}

                {/* Online join link (only when present in public data) */}
                {event.onlineEventLink && status !== "past" && (
                  <Button variant="secondary" className="mt-2.5 w-full" asChild>
                    <a href={safeExternalUrl(event.onlineEventLink) ?? '#'} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="mr-2 h-4 w-4" /> Join online
                    </a>
                  </Button>
                )}

                <button
                  onClick={shareEvent}
                  className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <Share2 className="h-4 w-4" /> Share this event
                </button>
                {event && (
                  <button
                    onClick={shareToFeed}
                    disabled={sharingToFeed}
                    className="flex w-full items-center justify-center gap-2 rounded-lg py-2 text-sm font-medium text-primary transition-colors hover:bg-brand-light disabled:opacity-60"
                  >
                    <Megaphone className="h-4 w-4" />
                    {sharingToFeed ? "Posting…" : "Post to feed"}
                  </button>
                )}

                {/* Real interest preview — only when people actually interested */}
                {interest && interest.count > 0 && (
                  <div className="mt-4 border-t border-border pt-3">
                    <div className="flex items-center gap-2">
                      <div className="flex -space-x-2">
                        {interest.preview.slice(0, 6).map((u: any) => (
                          <UserAvatar key={u._id} user={u} size={26} />
                        ))}
                      </div>
                      <span className="text-xs font-medium text-muted-foreground">
                        {interest.count} interested
                      </span>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <p className="px-2 text-center text-xs text-muted-foreground">
              <BadgeCheck className="mr-1 inline h-3.5 w-3.5 text-success" />
              Secure registration · QR ticket emailed to you
            </p>
          </div>
        </aside>
      </div>

      {/* ── Mobile sticky CTA ────────────────────────────── */}
      <div className="fixed inset-x-0 bottom-16 z-40 border-t border-border bg-background/95 p-3 backdrop-blur-md md:hidden">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold text-foreground">
              {isFree ? "Free" : `₹${event.price}`}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {userRegistered
                ? "You're registered"
                : isFull
                  ? "Event full"
                  : `${fmtShortDate(event.startDate)} · ${event.venue || "Online"}`}
            </p>
          </div>
          <Button
            className="shrink-0 font-semibold"
            variant={cta.registered ? "outline" : "default"}
            disabled={cta.disabled}
            onClick={cta.action ?? (userRegistered ? () => setShowTicketModal(true) : handleRegisterClick)}
          >
            {cta.label}
          </Button>
        </div>
      </div>

      {/* ── Registration dialog ──────────────────────────── */}
      <Dialog open={showRegistration} onOpenChange={setShowRegistration}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Register for {event.title}</DialogTitle>
            <DialogDescription>
              Complete the form below to secure your spot.
            </DialogDescription>
          </DialogHeader>
          <RegistrationForm
            eventId={event._id}
            eventTitle={event.title}
            requiredProfileFields={event.requiredProfileFields}
            customFields={event.registrationForm ?? []}
            onSuccess={handleRegisterSuccess}
            onCancel={() => setShowRegistration(false)}
          />
        </DialogContent>
      </Dialog>

      {/* ── Ticket dialog ────────────────────────────────── */}
      <Dialog open={showTicketModal} onOpenChange={setShowTicketModal}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Your ticket</DialogTitle>
            <DialogDescription>{event.title}</DialogDescription>
          </DialogHeader>
          {userTicket ? (
            <div className="flex flex-col items-center">
              <div className="rounded-xl border border-border bg-white p-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={userTicket.qrCode}
                  alt="Ticket QR code"
                  className="h-52 w-52 object-contain"
                />
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                Ticket ID:{" "}
                <span className="font-mono font-semibold text-foreground">
                  {userTicket.token.slice(0, 12).toUpperCase()}
                </span>
              </p>
              {userTicket.checkedIn ? (
                <span className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-success-light px-3 py-1 text-xs font-semibold text-success">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Checked in
                </span>
              ) : userTicket.status === "pending" ? (
                <span className="mt-3 rounded-full bg-warning-light px-3 py-1 text-xs font-semibold text-warning">
                  Pending approval
                </span>
              ) : (
                <span className="mt-3 rounded-full bg-brand-light px-3 py-1 text-xs font-semibold text-primary">
                  Active — show at entry
                </span>
              )}
              <a href={userTicket.qrCode} download={`eventhub-ticket-${event.slug}.png`}>
                <Button variant="outline" size="sm" className="mt-4">
                  <Download className="mr-2 h-4 w-4" /> Download QR
                </Button>
              </a>
            </div>
          ) : (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Ticket not found — it will appear once issued.
            </p>
          )}
        </DialogContent>
      </Dialog>
    </div>
      <ReportDialog
        open={reporting}
        onOpenChange={setReporting}
        targetType="event"
        targetId={event?._id || ""}
      />
    </>
  );
}
