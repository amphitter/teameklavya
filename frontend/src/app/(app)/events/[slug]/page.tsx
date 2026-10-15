"use client";

import { safeExternalUrl } from "@/utils/safe-url";
import { useEffect, useMemo, useState, useCallback } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  BadgeCheck,
  Building2,
  CalendarDays,
  CheckCircle2,
  Clock,
  Download,
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
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/utils/api";
import { trackFunnel } from "@/lib/funnel";
import { getImageUrl } from "@/utils/image";
import RegistrationForm, { type RegistrationField } from "@/components/RegistrationForm";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EventCard, type EventCardData } from "@/components/event-card";
import { UserAvatar } from "@/components/user-avatar";
import { ReportDialog } from "@/components/moderation/report-dialog";
import { Memories } from "@/components/events/memories";
import { ShareKit } from "@/components/events/share-kit";
import { ErrorState, PageLoader } from "@/components/states";
import { cn } from "@/lib/utils";
import { useQuery } from "@/lib/query";
import { queryClient } from "@/lib/query";

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

function computeStatus(startDate?: string, endDate?: string): "upcoming" | "ongoing" | "past" {
  const now = new Date();
  if (endDate && now > new Date(endDate)) return "past";
  if (startDate && now < new Date(startDate)) return "upcoming";
  return "ongoing";
}
function fmtRangeDate(start?: string, end?: string) {
  if (!start) return "TBA";
  const s = new Date(start);
  const e = end ? new Date(end) : null;
  const sStr = s.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  if (!e) return sStr;
  const eStr = e.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  return sStr === eStr ? sStr : `${sStr} – ${eStr}`;
}
function fmtShortDate(d?: string) {
  if (!d) return "";
  return new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}
function isSafeReturnUrl(url: string): boolean {
  if (!url) return false;
  if (!url.startsWith("/")) return false;
  if (url.startsWith("//")) return false;
  if (url.includes("://")) return false;
  if (url.includes("\\")) return false;
  if (/^\s*javascript:/i.test(url)) return false;
  return true;
}

// Success checkmark animation — polished, theme-aware, reduced-motion safe
function SuccessCheckmark({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="animate-in fade-in zoom-in-95 flex flex-col items-center rounded-[1.5rem] border border-[#262626] bg-[#0a0a0a] px-10 py-12 shadow-[0px_20px_60px_rgba(0,0,0,0.8)]">
        <div className="relative flex h-20 w-20 items-center justify-center rounded-full bg-[#052e16] border border-[#14532d]/50">
          <CheckCircle2 className="h-12 w-12 text-[#22c55e] animate-[checkmark_0.6s_cubic-bezier(0.22,1,0.36,1)_forwards]" />
          <style>{`
            @keyframes checkmark {
              0% { transform: scale(0); opacity: 0; }
              50% { transform: scale(1.2); opacity: 1; }
              100% { transform: scale(1); opacity: 1; }
            }
            @media (prefers-reduced-motion: reduce) {
              .animate-[checkmark_0.6s_cubic-bezier(0.22,1,0.36,1)_forwards] {
                animation: none !important;
                transform: scale(1) !important;
                opacity: 1 !important;
              }
            }
          `}</style>
        </div>
        <h3 className="mt-6 text-[20px] font-bold tracking-[-0.01em] text-white" style={{ fontFamily: "Inter, sans-serif" }}>You&apos;re in!</h3>
        <p className="mt-2 text-[14px] text-[#a1a1aa]">Registration successful</p>
        <div className="mt-4 flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin text-[#3b82f6]" />
          <span className="text-[12px] text-[#71717a]">Opening your ticket…</span>
        </div>
      </div>
    </div>
  );
}

export default function EventDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const autoRegisterParam = searchParams.get("register") === "1" || searchParams.get("autoRegister") === "1";

  const [event, setEvent] = useState<EventData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [userRegistered, setUserRegistered] = useState<boolean | null>(null);
  const [userTicket, setUserTicket] = useState<UserTicket | null>(null);
  const [registrationCount, setRegistrationCount] = useState<number | null>(null);
  const [regStatusLoading, setRegStatusLoading] = useState(true);
  const [ticketLoading, setTicketLoading] = useState(false);
  const [interest, setInterest] = useState<{ count: number; interested: boolean; preview: any[] } | null>(null);
  const [reporting, setReporting] = useState(false);
  const [showRegistration, setShowRegistration] = useState(false);
  const [showTicketModal, setShowTicketModal] = useState(false);
  const [showShareKit, setShowShareKit] = useState(false);
  const [related, setRelated] = useState<EventCardData[]>([]);
  const [participants, setParticipants] = useState<{ _id: string; firstName: string; lastName: string; avatar: string | null }[]>([]);
  const [liveQuiz, setLiveQuiz] = useState<{ _id: string; title: string } | null>(null);
  const [sharingToFeed, setSharingToFeed] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [ticketFetchError, setTicketFetchError] = useState<string | null>(null);

  // Auth hydration — represent unresolved as loading, not false
  useEffect(() => {
    const token = localStorage.getItem("token");
    setIsAuthenticated(Boolean(token));
    setAuthChecked(true);
  }, []);

  useEffect(() => {
    if (event?._id) trackFunnel("event_view", { eventId: event._id, orgId: event.organization?._id });
  }, [event?._id]);

  const { data: eventRes, error: eventErr, isLoading: eventLoading } = useQuery<{ success?: boolean; event?: any; message?: string }>(
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
      setError((eventErr as any)?.response?.data?.message || "Failed to load event");
    }
  }, [eventRes, eventErr]);

  // Registration count — authoritative
  useEffect(() => {
    if (!event?._id) return;
    api.get(`/registration/responses/${event._id}/count`).then((r) => setRegistrationCount(r.data?.count ?? null)).catch(() => {});
  }, [event?._id]);

  // Interest
  useEffect(() => {
    if (!event?._id) return;
    api.get(`/events/${event._id}/interest`).then((r) => {
      if (r.data?.success) setInterest({ count: r.data.count ?? 0, interested: Boolean(r.data.interested), preview: r.data.preview || [] });
    }).catch(() => {});
  }, [event?._id]);

  const toggleInterest = () => {
    if (!event?._id || !isAuthenticated) {
      const currentUrl = window.location.pathname + window.location.search;
      if (isSafeReturnUrl(currentUrl)) {
        router.push(`/login?returnUrl=${encodeURIComponent(currentUrl)}`);
      }
      return;
    }
    api.post(`/events/${event._id}/interest`).then((r) => {
      if (r.data?.success) {
        setInterest((prev) => (prev ? { ...prev, interested: Boolean(r.data.interested), count: r.data.count ?? prev.count } : prev));
        toast.success(r.data.interested ? "Marked as interested" : "Removed interest");
      }
    }).catch(() => toast.error("Couldn't update interest"));
  };

  // Registration status + ticket — with loading states to prevent flicker
  const fetchRegistrationStatus = useCallback(async () => {
    if (!event?._id || !isAuthenticated) {
      setUserRegistered(null);
      setRegStatusLoading(false);
      return;
    }
    setRegStatusLoading(true);
    try {
      const res = await api.get(`/registration/responses/status/${event._id}`);
      const registered = Boolean(res.data?.registered);
      setUserRegistered(registered);
      if (registered) {
        setTicketLoading(true);
        try {
          const ticketsRes = await api.get("/tickets/user-tickets");
          const t = (ticketsRes.data?.tickets ?? []).find((t: any) => t.eventId?._id === event._id);
          if (t) setUserTicket(t);
        } catch {
          // Ticket fetch failed but registration succeeded — preserve state
          setTicketFetchError("Ticket will be available shortly");
        } finally {
          setTicketLoading(false);
        }
      }
    } catch (err: any) {
      // On network error, don't treat as not registered — keep null to show loading/error
      if (err?.response?.status === 404 || err?.response?.status === 401) {
        setUserRegistered(false);
      } else {
        // Keep as null? For UX, treat as unknown and show retry? But per spec, handle without silently treating as not registered
        // We'll set to false only if 404, else keep previous and show error toast
        console.error("Registration status fetch failed", err);
      }
    } finally {
      setRegStatusLoading(false);
    }
  }, [event?._id, isAuthenticated]);

  useEffect(() => {
    if (!authChecked) return;
    fetchRegistrationStatus();
  }, [authChecked, fetchRegistrationStatus]);

  // Related events — exclude current by ID, dedup by ID, visibility rules
  useEffect(() => {
    if (!event?._id) return;
    const cat = event?.category;
    const params: any = { limit: 12, type: "upcoming" };
    if (cat) params.category = cat;
    api.get("/events", { params }).then((r) => {
      const all = (r.data?.events ?? []) as any[];
      // Exclude current by canonical ID, dedup by ID
      const seen = new Set<string>();
      const filtered: EventCardData[] = [];
      for (const e of all) {
        const id = String(e._id || e.id || "");
        if (!id) continue;
        if (id === String(event._id)) continue; // exclude current
        if (seen.has(id)) continue; // dedup
        // Apply visibility: only public/unlisted? Backend should already filter, but extra safety
        if (e.visibility && !["public", "unlisted"].includes(e.visibility)) continue;
        seen.add(id);
        filtered.push(e);
        if (filtered.length >= 3) break;
      }
      setRelated(filtered);
    }).catch(() => {});

    api.get(`/events/${event._id}/participants`).then((res) => setParticipants(res.data?.participants || [])).catch(() => {});
    api.get(`/quizzes/event/${event._id}`).then((res) => {
      const live = (res.data?.quizzes || []).find((q: any) => q.status === "live");
      setLiveQuiz(live ? { _id: live._id, title: live.title } : null);
    }).catch(() => {});
  }, [event?._id, event?.category]);

  const status = useMemo(() => (event ? computeStatus(event.startDate, event.endDate) : "upcoming"), [event]);
  const isFree = !event?.price || event.price === 0;

  // Availability indicator — use persisted capacity and authoritative counts, clamp, prevent negative
  const capacity = useMemo(() => {
    const max = typeof event?.maxAttendees === "number" ? event.maxAttendees : null;
    const count = typeof registrationCount === "number" ? registrationCount : null;
    if (max === null || max <= 0) return { max: null, count, pct: null, remaining: null, isFull: false };
    const safeCount = count !== null ? Math.max(0, count) : 0;
    const remaining = Math.max(0, max - safeCount);
    const pctRaw = max > 0 ? (safeCount / max) * 100 : 0;
    const pct = Math.min(100, Math.max(0, Math.round(pctRaw)));
    const isFull = safeCount >= max;
    return { max, count: safeCount, pct, remaining, isFull };
  }, [event?.maxAttendees, registrationCount]);

  const isFull = capacity.isFull;

  const shareEvent = async () => {
    setShowShareKit(true);
  };

  const shareToFeed = async () => {
    if (!isAuthenticated) {
      const currentUrl = window.location.pathname + window.location.search;
      if (isSafeReturnUrl(currentUrl)) {
        router.push(`/login?returnUrl=${encodeURIComponent(currentUrl)}`);
      }
      return;
    }
    if (!event || sharingToFeed) return;
    setSharingToFeed(true);
    try {
      const res = await api.post("/posts", { content: `Sharing this event: ${event.title}`, eventId: event._id });
      if (res.data?.success) toast.success("Shared to your feed");
      else toast.error(res.data?.message || "Couldn't share to feed");
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Couldn't share to feed");
    } finally {
      setSharingToFeed(false);
    }
  };

  const handleRegisterClick = () => {
    if (!isAuthenticated) {
      const currentUrl = window.location.pathname + window.location.search;
      const returnWithIntent = currentUrl.includes("?") ? `${currentUrl}&register=1` : `${currentUrl}?register=1`;
      // Store pending intent for auto-open after login
      try {
        localStorage.setItem("pendingRegistration", JSON.stringify({
          slug: event?.slug || slug,
          eventId: event?._id,
          timestamp: Date.now(),
          returnUrl: returnWithIntent,
        }));
        if (isSafeReturnUrl(returnWithIntent)) {
          localStorage.setItem("oauth_returnUrl", returnWithIntent);
        }
      } catch {}
      if (isSafeReturnUrl(returnWithIntent)) {
        router.push(`/login?returnUrl=${encodeURIComponent(returnWithIntent)}`);
      } else {
        router.push(`/login?returnUrl=${encodeURIComponent(`/events/${event?.slug || slug}`)}`);
      }
      return;
    }
    // Authenticated — check if already registered
    if (userRegistered) {
      if (userTicket) setShowTicketModal(true);
      return;
    }
    setShowRegistration(true);
  };

  // Auto-open registration form when returning from login with intent
  useEffect(() => {
    if (!authChecked || !isAuthenticated || !event?._id) return;
    if (status === "past") return;
    if (userRegistered) return;
    if (isFull) return;
    if (regStatusLoading) return; // wait for authoritative state

    const shouldAutoOpen = autoRegisterParam;
    let pendingMatch = false;
    try {
      const raw = localStorage.getItem("pendingRegistration");
      if (raw) {
        const pending = JSON.parse(raw);
        const age = Date.now() - (pending.timestamp || 0);
        // Valid for 15 minutes, same event
        if (age < 15 * 60 * 1000 && (pending.slug === slug || pending.eventId === event._id)) {
          pendingMatch = true;
        }
        // Clear if expired
        if (age >= 15 * 60 * 1000) {
          localStorage.removeItem("pendingRegistration");
        }
      }
    } catch {}

    if (shouldAutoOpen || pendingMatch) {
      // Small delay to let UI settle after auth hydration
      const t = setTimeout(() => {
        setShowRegistration(true);
        // Clear pending after opening
        try { localStorage.removeItem("pendingRegistration"); } catch {}
        // Clean URL — remove register param without reload
        if (autoRegisterParam) {
          const url = new URL(window.location.href);
          url.searchParams.delete("register");
          url.searchParams.delete("autoRegister");
          window.history.replaceState({}, "", url.pathname + url.search);
        }
      }, 300);
      return () => clearTimeout(t);
    }
  }, [authChecked, isAuthenticated, event?._id, status, userRegistered, isFull, regStatusLoading, autoRegisterParam, slug]);

  const handleRegisterSuccess = async () => {
    if (!event) return;
    // Step 1: Show success animation
    setShowSuccess(true);
    trackFunnel("register", { eventId: event._id, orgId: event.organization?._id });

    // Refresh counts and ticket
    let ticket: UserTicket | null = null;
    const currentEventId = event._id;
    const currentOrgId = event.organization?._id;
    try {
      const countRes = await api.get(`/registration/responses/${currentEventId}/count`).catch(() => null);
      if (countRes) setRegistrationCount(countRes.data?.count ?? null);

      // Ticket might be async — retry a couple times
      setTicketLoading(true);
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const ticketsRes = await api.get("/tickets/user-tickets");
          const t = (ticketsRes.data?.tickets ?? []).find((t: any) => t.eventId?._id === currentEventId);
          if (t) { ticket = t; setUserTicket(t); trackFunnel("ticket", { eventId: currentEventId, orgId: currentOrgId }); break; }
        } catch {}
        if (attempt < 2) await new Promise(r => setTimeout(r, 800));
      }
    } finally {
      setTicketLoading(false);
    }

    // Step 2: After animation, close form and open ticket
    setTimeout(() => {
      setShowSuccess(false);
      setShowRegistration(false);
      setUserRegistered(true);
      if (ticket) {
        setShowTicketModal(true);
      } else {
        // If ticket not yet ready, show loading state in modal or retry path
        setTicketFetchError(null);
        setShowTicketModal(true);
        // Try again in background
        const eid = event._id;
        api.get("/tickets/user-tickets").then((r) => {
          const t = (r.data?.tickets ?? []).find((t: any) => t.eventId?._id === eid);
          if (t) setUserTicket(t);
        }).catch(() => {
          setTicketFetchError("Ticket generation is taking longer than expected. Please check My Registrations in a moment.");
        });
      }
      // Invalidate frontend cache to reflect new registration
      queryClient.invalidateQueries(["event", slug]);
    }, 1300);
  };

  if (eventLoading) return <PageLoader label="Loading event…" />;
  if (error || !event) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        <ErrorState title={error === "Event not found" ? "Event not found" : "Couldn't load event"} description={error === "Event not found" ? "This event may have been removed, or the link is incorrect." : error || undefined} />
        <div className="mt-6 text-center">
          <Button variant="outline" asChild className="h-12 rounded-[12px] border-[#E4E9F4] bg-white text-[#0B1235] hover:border-[#2563FF] hover:bg-[#EFF6FF] dark:border-[#262626] dark:bg-[#0a0a0a] dark:text-[#ededed]">
            <Link href="/events"><ArrowLeft className="mr-2 h-4 w-4" /> Back to Discover</Link>
          </Button>
        </div>
      </div>
    );
  }

  const bannerUrl = getImageUrl(event.bannerUrl);
  const logoUrl = getImageUrl(event.logoUrl);

  const registerCta = () => {
    if (!authChecked || regStatusLoading) {
      return { label: "Loading…", disabled: true, loading: true };
    }
    if (status === "past") return { label: "This event has ended", disabled: true };
    if (userTicket?.checkedIn) return { label: "You're in — Live activities", disabled: false, action: () => router.push(`/events/${slug}/live`) };
    if (userTicket) return { label: "View My Ticket", disabled: false, action: () => setShowTicketModal(true) };
    if (userRegistered) return { label: "Registered — Awaiting ticket", disabled: ticketLoading, action: ticketLoading ? undefined : () => fetchRegistrationStatus(), loading: ticketLoading };
    if (isFull) return { label: "Event Full — Join waitlist", disabled: true };
    return { label: isFree ? "Register Now" : `Register Now — ₹${event.price}`, disabled: false, action: handleRegisterClick };
  };
  const cta = registerCta();

  return (
    <>
      <SuccessCheckmark show={showSuccess} />
      <div className="min-h-screen bg-[#F8FAFF] dark:bg-black pb-24 md:pb-10">
        {/* Poster — 16:4 (4:1) banner, enforced upload size fills full blank space edge-to-edge */}
        <div className="w-full bg-[#F8FAFF] dark:bg-black">
          <div className="mx-auto max-w-[1280px] px-4 sm:px-6 lg:px-8 pt-4 sm:pt-6">
            <div className="relative w-full overflow-hidden rounded-[12px] sm:rounded-[16px] bg-black aspect-[16/4]">
              {bannerUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={bannerUrl}
                  alt={event.title}
                  className="h-full w-full object-cover object-center"
                  loading="eager"
                  style={{ objectFit: "cover" }}
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[#0a0a0a] to-[#171717]">
                  <CalendarDays className="h-14 w-14 text-[#3b82f6]/30" />
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Summary panel clearly separated beneath poster — matches reference */}
        <div className="relative mt-4 sm:mt-6">
          <div className="mx-auto max-w-[1280px] px-4 sm:px-6 lg:px-8">
            <div className="relative rounded-[16px] sm:rounded-[1.125rem] border border-[#E4E9F4] bg-white p-4 shadow-[0px_10px_40px_rgba(24,39,75,0.08),0px_2px_6px_rgba(24,39,75,0.03)] dark:border-[#262626] dark:bg-[#0a0a0a] sm:p-7">
              {/* Badges — Competition + attendance mode, positioned neatly as in reference */}
              <div className="mb-4 flex flex-wrap gap-2">
                {event.category && (
                  <span className="inline-flex items-center rounded-full bg-[#F4F2FF] dark:bg-[#1e1b2e] border border-[#E4E9F4] dark:border-[#262626] px-3 py-1 text-[11px] font-semibold tracking-[0.02em] text-[#0B1235] dark:text-[#ededed]">
                    {event.category.replace(/_/g, " ")}
                  </span>
                )}
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white dark:bg-[#171717] border border-[#E4E9F4] dark:border-[#262626] px-3 py-1 text-[11px] font-semibold tracking-[0.02em] text-[#0B1235] dark:text-[#ededed]">
                  <MapPin className="h-3 w-3 text-[#7C3AED]" />
                  {event.eventType === "online" ? "Online" : event.eventType === "hybrid" ? "Hybrid" : "In person"}
                </span>
                {status === "ongoing" && (
                  <span className="flex items-center gap-1.5 rounded-full bg-[#BA1A1A] px-3 py-1 text-[11px] font-semibold text-white shadow-sm">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" /> LIVE NOW
                  </span>
                )}
                {status === "past" && <span className="rounded-full bg-black/80 px-3 py-1 text-[11px] font-semibold text-white/90">Past event</span>}
              </div>
              <div className="flex items-start justify-between gap-3 sm:gap-4">
                {/* Title container — min-w-0, break-words, wraps */}
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-start gap-3">
                    {logoUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={logoUrl} alt="" className="mt-1 h-10 w-10 shrink-0 rounded-[10px] border border-[#E4E9F4] bg-white object-cover dark:border-[#262626] sm:h-12 sm:w-12 sm:rounded-[12px]" />
                    )}
                    <h1 className="min-w-0 flex-1 break-words text-[20px] font-bold leading-tight tracking-[-0.02em] text-[#0B1235] dark:text-[#ededed] sm:text-[28px] sm:leading-[1.15] lg:text-[32px] lg:leading-[40px]" style={{ fontFamily: "Inter, sans-serif", overflowWrap: "anywhere" }}>
                      {event.title}
                    </h1>
                  </div>
                  {event.organizer && (
                    <div className="mt-3 flex min-w-0 flex-wrap items-center gap-2 text-[13px] text-[#64709A] dark:text-[#a1a1aa] sm:text-[14px]">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#EDE9FE] dark:bg-[#1e1b2e] text-[11px] font-bold text-[#7C3AED] dark:text-[#8b5cf6]">{(event.organizer[0] || "E").toUpperCase()}</span>
                      <span className="min-w-0 break-words">
                        Hosted by <span className="font-semibold text-[#0B1235] dark:text-[#ededed]">{event.organizer}</span>
                        {event.organization?.name && <span className="text-[#64709A]"> • {event.organization.name}</span>}
                      </span>
                    </div>
                  )}
                </div>
                {/* Actions — stable, shrink-0, no overlap */}
                <div className="flex shrink-0 items-center gap-2">
                  <Button variant="outline" size="sm" onClick={shareEvent} className="h-9 shrink-0 rounded-[10px] border-[#E4E9F4] bg-white px-3 text-[13px] text-[#0B1235] hover:border-[#2563FF] hover:bg-[#EFF6FF] dark:border-[#262626] dark:bg-black dark:text-[#ededed] sm:h-10 sm:px-4">
                    <Share2 className="mr-1.5 h-4 w-4 shrink-0" /> <span className="hidden sm:inline">Share</span><span className="sm:hidden">Share</span>
                  </Button>
                  {isAuthenticated && (
                    <Button variant="outline" size="sm" onClick={() => setReporting(true)} aria-label="Report event" className="h-9 w-9 shrink-0 rounded-[10px] border-[#E4E9F4] bg-white p-0 dark:border-[#262626] dark:bg-black sm:h-10 sm:w-10">
                      <Flag className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-[13px] text-[#64709A] dark:text-[#a1a1aa] sm:mt-5 sm:gap-x-6 sm:text-[14px]">
                <span className="inline-flex min-w-0 items-center gap-1.5"><CalendarDays className="h-4 w-4 shrink-0 text-[#2563FF]" /> <span className="break-words">{fmtRangeDate(event.startDate, event.endDate)}</span></span>
                {event.startTime && <span className="inline-flex items-center gap-1.5"><Clock className="h-4 w-4 shrink-0 text-[#2563FF]" /> {event.startTime}{event.endTime ? ` – ${event.endTime}` : ""}</span>}
                <span className="inline-flex min-w-0 items-center gap-1.5">
                  {event.eventType === "online" ? <><Video className="h-4 w-4 shrink-0 text-[#7C3AED]" /> <span className="break-words">Online{event.platform ? ` · ${event.platform}` : ""}</span></> : <><MapPin className="h-4 w-4 shrink-0 text-[#7C3AED]" /> <span className="break-words">{event.venue || "Venue TBA"}</span></>}
                </span>
                <span className="inline-flex items-center gap-1.5"><Ticket className="h-4 w-4 shrink-0 text-[#2563FF]" /> {isFree ? "Free" : `₹${event.price}`}</span>
                {registrationCount !== null && <span className="inline-flex items-center gap-1.5"><Users className="h-4 w-4 shrink-0 text-[#2563FF]" /> {registrationCount} registered</span>}
              </div>

              {/* Capacity — consistent numbers and progress width, clamp, handle zero */}
              {capacity.max !== null && (
                <div className="mt-5">
                  <div className="flex justify-between text-[11px] font-semibold tracking-[0.02em] text-[#64709A] dark:text-[#a1a1aa]">
                    <span>{capacity.count !== null ? `${capacity.count} of ${capacity.max} spots filled` : `${capacity.max} spots`}</span>
                    {capacity.pct !== null && <span>{capacity.pct}%</span>}
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#E4E9F4] dark:bg-[#262626]">
                    <div className="h-full rounded-full bg-[linear-gradient(135deg,#2563FF_0%,#6C35FF_52%,#D946EF_100%)] transition-all duration-500" style={{ width: `${capacity.pct ?? 0}%` }} />
                  </div>
                  {capacity.remaining !== null && (
                    <p className="mt-1.5 text-[11px] text-[#64709A] dark:text-[#a1a1aa]">
                      {capacity.remaining === 0 ? "Event is full" : `${capacity.remaining} spots remaining`}
                    </p>
                  )}
                </div>
              )}

              <div className="mt-6 flex flex-wrap gap-3">
                <Button onClick={cta.action} disabled={cta.disabled} className="h-12 min-w-[140px] rounded-[12px] px-6 text-[14px] font-semibold shadow-[0px_8px_24px_rgba(37,99,255,0.25)] hover:shadow-[0px_10px_24px_rgba(108,53,255,0.35)] hover:brightness-[1.05] active:translate-y-px">
                  {(cta as any).loading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…</> : cta.label}
                </Button>
                {liveQuiz && (
                  <Link href={`/quiz/${liveQuiz._id}`} className="inline-flex h-12 items-center justify-center rounded-[12px] bg-[#0B1235] dark:bg-[#0a0a0a] border border-[#E4E9F4] dark:border-[#262626] px-6 text-[14px] font-semibold text-white hover:bg-[#111936] transition-colors">
                    Live quiz: {liveQuiz.title} →
                  </Link>
                )}
                <Button variant="outline" className="h-12 rounded-[12px] border-[#E4E9F4] bg-white text-[#0B1235] hover:border-[#2563FF] hover:bg-[#EFF6FF] dark:border-[#262626] dark:bg-black dark:text-[#ededed]" onClick={toggleInterest}>
                  <Star className={cn("mr-1.5 h-4 w-4", interest?.interested ? "fill-amber-400 text-amber-400" : "text-[#64709A]")} />
                  {interest?.interested ? "Interested" : "Mark interested"} {interest ? `(${interest.count})` : ""}
                </Button>
              </div>
            </div>
          </div>
        </div>

        {status === "ongoing" && (
          <div className="mt-6 border-y border-[#FECACA] bg-[#FEF2F2] dark:border-[#7f1d1d]/30 dark:bg-[#7f1d1d]/10">
            <div className="mx-auto flex max-w-[1280px] items-center gap-2.5 px-4 py-3 text-[14px] font-semibold text-[#DC2626] dark:text-[#f87171] sm:px-6 lg:px-8">
              <span className="h-2 w-2 animate-pulse rounded-full bg-[#DC2626]" /> This event is happening right now — join the action!
            </div>
          </div>
        )}
        {liveQuiz && (
          <div className="border-b border-[#BFDBFE] bg-[#EFF6FF] dark:border-[#1e3a5f]/50 dark:bg-[#0f172a]">
            <div className="mx-auto flex max-w-[1280px] flex-wrap items-center justify-between gap-2 px-4 py-3 sm:px-6 lg:px-8">
              <p className="flex items-center gap-2 text-[14px] font-bold text-[#2563FF] dark:text-[#3b82f6]"><Target className="h-4 w-4" /> Live quiz: {liveQuiz.title}</p>
              <Link href={`/quiz/${liveQuiz._id}`} className="rounded-full bg-[#2563FF] px-4 py-1.5 text-[12px] font-bold text-white hover:bg-[#1677FF] transition-colors">Join & play →</Link>
            </div>
          </div>
        )}

        <div className="mx-auto grid max-w-[1280px] gap-8 px-4 py-8 sm:px-6 lg:grid-cols-3 lg:px-8" style={{ marginLeft: "-9px" }}>
          <div className="space-y-8 lg:col-span-2">
            <section className="rounded-[1.125rem] border border-[#E4E9F4] bg-white p-6 shadow-[0px_4px_16px_rgba(24,39,75,0.04)] dark:border-[#262626] dark:bg-[#0a0a0a]">
              <h2 className="text-[20px] font-semibold leading-7 tracking-[-0.01em] text-[#0B1235] dark:text-[#ededed]" style={{ fontFamily: "Inter, sans-serif" }}>About this event</h2>
              <p className="mt-3 whitespace-pre-line break-words text-[15px] leading-[1.6] text-[#12193c] dark:text-[#ededed]" style={{ fontFamily: "Inter, sans-serif", overflowWrap: "anywhere" }}>{event.description || "No description provided yet."}</p>
            </section>

            {event.schedule && event.schedule.length > 0 && (
              <section className="rounded-[1.125rem] border border-[#E4E9F4] bg-white p-6 shadow-[0px_4px_16px_rgba(24,39,75,0.04)] dark:border-[#262626] dark:bg-[#0a0a0a]">
                <h2 className="text-[20px] font-semibold tracking-[-0.01em] text-[#0B1235] dark:text-[#ededed]" style={{ fontFamily: "Inter, sans-serif" }}>Schedule</h2>
                <div className="mt-5 space-y-0">
                  {event.schedule.map((item, i) => (
                    <div key={i} className="relative flex gap-4 pb-6 last:pb-0">
                      {i < (event.schedule?.length ?? 0) - 1 && <span className="absolute left-[7px] top-5 h-full w-px bg-[#E4E9F4] dark:bg-[#262626]" aria-hidden />}
                      <span className="relative mt-1.5 h-[15px] w-[15px] shrink-0 rounded-full border-[3px] border-[#2563FF] bg-white dark:bg-[#0a0a0a]" />
                      <div className="min-w-0 flex-1 rounded-[1rem] border border-[#E4E9F4] bg-[#F8FAFF] dark:border-[#262626] dark:bg-black p-4">
                        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                          <h3 className="min-w-0 flex-1 break-words text-[14px] font-semibold text-[#0B1235] dark:text-[#ededed]">{item.title}</h3>
                          {(item.day || item.time) && <span className="shrink-0 rounded-full bg-[#EDE9FE] dark:bg-[#1e1b2e] border border-[#DDD6FE] dark:border-[#262626] px-3 py-1 text-[11px] font-semibold text-[#7C3AED] dark:text-[#8b5cf6]">{[fmtShortDate(item.day), item.time].filter(Boolean).join(" · ")}</span>}
                        </div>
                        {item.description && <p className="mt-2 break-words text-[13px] leading-[1.5] text-[#64709A] dark:text-[#a1a1aa]">{item.description}</p>}
                        {item.speakers && item.speakers.length > 0 && <p className="mt-2 inline-flex items-center gap-1.5 text-[12px] text-[#64709A] dark:text-[#a1a1aa]"><Mic className="h-3.5 w-3.5 shrink-0" /> {item.speakers.join(", ")}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {event.speakers && event.speakers.length > 0 && (
              <section className="rounded-[1.125rem] border border-[#E4E9F4] bg-white p-6 shadow-[0px_4px_16px_rgba(24,39,75,0.04)] dark:border-[#262626] dark:bg-[#0a0a0a]">
                <h2 className="text-[20px] font-semibold tracking-[-0.01em] text-[#0B1235] dark:text-[#ededed]" style={{ fontFamily: "Inter, sans-serif" }}>Speakers</h2>
                <div className="mt-5 grid gap-4 sm:grid-cols-2">
                  {event.speakers.map((s, i) => (
                    <div key={i} className="flex min-w-0 items-center gap-4 rounded-[1rem] border border-[#E4E9F4] bg-[#F8FAFF] dark:border-[#262626] dark:bg-black p-4">
                      {s.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={getImageUrl(s.imageUrl)} alt={s.name} className="h-12 w-12 shrink-0 rounded-full border border-[#E4E9F4] object-cover dark:border-[#262626]" />
                      ) : (
                        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#EFF6FF] dark:bg-[#0f172a] text-[16px] font-bold text-[#2563FF]">{(s.name || "?")[0]}</span>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="flex min-w-0 items-center gap-1.5 text-[14px] font-semibold text-[#0B1235] dark:text-[#ededed]">
                          <span className="min-w-0 truncate">{s.name}</span>
                          {s.linkedin && <a href={safeExternalUrl(s.linkedin) ?? "#"} target="_blank" rel="noopener noreferrer" className="shrink-0 text-[#64709A] hover:text-[#2563FF]"><Linkedin className="h-3.5 w-3.5" /></a>}
                        </p>
                        {(s.designation || s.company) && <p className="mt-0.5 truncate text-[12px] text-[#64709A] dark:text-[#a1a1aa]">{[s.designation, s.company].filter(Boolean).join(" · ")}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {event.benefits && event.benefits.length > 0 && (
              <section className="rounded-[1.125rem] border border-[#E4E9F4] bg-white p-6 shadow-[0px_4px_16px_rgba(24,39,75,0.04)] dark:border-[#262626] dark:bg-[#0a0a0a]">
                <h2 className="text-[20px] font-semibold tracking-[-0.01em] text-[#0B1235] dark:text-[#ededed]" style={{ fontFamily: "Inter, sans-serif" }}>What you&apos;ll get</h2>
                <ul className="mt-5 grid gap-3 sm:grid-cols-2">
                  {event.benefits.map((b, i) => (
                    <li key={i} className="flex min-w-0 items-start gap-2.5 rounded-[12px] border border-[#E4E9F4] bg-[#F8FAFF] dark:border-[#262626] dark:bg-black px-4 py-3 text-[14px] leading-[1.4] text-[#0B1235] dark:text-[#ededed]">
                      <Gift className="mt-0.5 h-4 w-4 shrink-0 text-[#7C3AED]" /> <span className="min-w-0 flex-1 break-words">{b}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {event.partners && event.partners.length > 0 && (
              <section className="rounded-[1.125rem] border border-[#E4E9F4] bg-white p-6 shadow-[0px_4px_16px_rgba(24,39,75,0.04)] dark:border-[#262626] dark:bg-[#0a0a0a]">
                <h2 className="text-[20px] font-semibold tracking-[-0.01em] text-[#0B1235] dark:text-[#ededed]" style={{ fontFamily: "Inter, sans-serif" }}>Partners</h2>
                <div className="mt-5 flex flex-wrap gap-3">
                  {event.partners.map((p, i) => (
                    <a key={i} href={p.website || undefined} target={p.website ? "_blank" : undefined} rel="noopener noreferrer" className="flex min-w-0 items-center gap-3 rounded-[12px] border border-[#E4E9F4] bg-[#F8FAFF] dark:border-[#262626] dark:bg-black px-4 py-3 transition-colors hover:border-[#2563FF]/40 hover:bg-[#EFF6FF] dark:hover:bg-[#171717]">
                      {p.logoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={getImageUrl(p.logoUrl)} alt={p.name} className="h-8 w-8 shrink-0 rounded object-contain" />
                      ) : (
                        <Handshake className="h-6 w-6 shrink-0 text-[#64709A]" />
                      )}
                      <div className="min-w-0">
                        <p className="truncate text-[14px] font-semibold text-[#0B1235] dark:text-[#ededed]">{p.name}</p>
                        {p.role && <p className="truncate text-[12px] text-[#64709A] dark:text-[#a1a1aa]">{p.role}</p>}
                      </div>
                    </a>
                  ))}
                </div>
              </section>
            )}

            {event.eventType !== "online" && event.venueIframeLink && (
              <section className="rounded-[1.125rem] border border-[#E4E9F4] bg-white p-6 shadow-[0px_4px_16px_rgba(24,39,75,0.04)] dark:border-[#262626] dark:bg-[#0a0a0a]">
                <h2 className="text-[20px] font-semibold tracking-[-0.01em] text-[#0B1235] dark:text-[#ededed]" style={{ fontFamily: "Inter, sans-serif" }}>Location</h2>
                <div className="mt-4 overflow-hidden rounded-[1rem] border border-[#E4E9F4] dark:border-[#262626]">
                  <iframe src={event.venueIframeLink} className="h-64 w-full border-0" loading="lazy" referrerPolicy="no-referrer-when-downgrade" title={`Map of ${event.venue || event.title}`} />
                </div>
                {event.venue && <p className="mt-3 flex items-center gap-1.5 break-words text-[13px] text-[#64709A] dark:text-[#a1a1aa]"><MapPin className="h-4 w-4 shrink-0 text-[#7C3AED]" /> {event.venue}</p>}
              </section>
            )}

            <section className="rounded-[1.125rem] border border-[#E4E9F4] bg-white p-6 shadow-[0px_4px_16px_rgba(24,39,75,0.04)] dark:border-[#262626] dark:bg-[#0a0a0a]">
              <h2 className="flex items-center gap-2 text-[20px] font-semibold tracking-[-0.01em] text-[#0B1235] dark:text-[#ededed]" style={{ fontFamily: "Inter, sans-serif" }}><Megaphone className="h-5 w-5 shrink-0 text-[#6C35FF]" /> Memories</h2>
              <div className="mt-5">
                <Memories eventId={event._id} eventSlug={event.slug || slug} eventTitle={event.title} status={status} isParticipant={Boolean(userRegistered)} pageSize={6} showViewAll={false} />
              </div>
            </section>

            {related.length > 0 && (
              <section>
                <div className="flex items-center justify-between">
                  <h2 className="text-[18px] font-semibold tracking-[-0.01em] text-[#0B1235] dark:text-[#ededed]" style={{ fontFamily: "Inter, sans-serif" }}>More {event.category} events</h2>
                  <Link href={`/events?category=${encodeURIComponent(event.category || "")}`} className="text-[13px] font-semibold text-[#2563FF] hover:text-[#1677FF]">View all</Link>
                </div>
                <div className="mt-4 grid gap-6 sm:grid-cols-2">
                  {related.map((e) => (
                    <EventCard key={e._id} event={e} />
                  ))}
                </div>
              </section>
            )}
          </div>

          <aside className="space-y-6 lg:sticky lg:top-20">
            <Card className="rounded-[1.125rem] border-[#E4E9F4] shadow-[0px_10px_40px_rgba(24,39,75,0.08)] dark:border-[#262626] dark:bg-[#0a0a0a]">
              <CardContent className="p-6">
                <div className="space-y-4">
                  <div className="flex items-center justify-between text-[14px]">
                    <span className="font-medium text-[#0B1235] dark:text-[#ededed]">Price</span>
                    <span className={cn("rounded-full px-3 py-1 text-[12px] font-semibold", isFree ? "bg-[#E8F9EE] text-[#16a34a] dark:bg-[#052e16] dark:text-[#22c55e]" : "bg-[#EFF6FF] text-[#2563FF] dark:bg-[#0f172a] dark:text-[#3b82f6]")}>{isFree ? "Free" : `₹${event.price}`}</span>
                  </div>
                  {capacity.max !== null && (
                    <div className="flex items-center justify-between text-[14px]">
                      <span className="font-medium text-[#0B1235] dark:text-[#ededed]">Capacity</span>
                      <span className="text-[#64709A] dark:text-[#a1a1aa]">{capacity.max} spots</span>
                    </div>
                  )}
                  {capacity.count !== null && (
                    <div className="flex items-center justify-between text-[14px]">
                      <span className="font-medium text-[#0B1235] dark:text-[#ededed]">Registered</span>
                      <span className="text-[#64709A] dark:text-[#a1a1aa]">{capacity.count}</span>
                    </div>
                  )}
                  {capacity.pct !== null && (
                    <div>
                      <div className="h-2 overflow-hidden rounded-full bg-[#E4E9F4] dark:bg-[#262626]">
                        <div className="h-full rounded-full bg-[linear-gradient(135deg,#2563FF_0%,#6C35FF_52%,#D946EF_100%)] transition-all duration-500" style={{ width: `${capacity.pct}%` }} />
                      </div>
                      <p className="mt-2 flex justify-between text-[11px] font-medium text-[#64709A] dark:text-[#a1a1aa]">
                        <span>{capacity.pct}% filled</span>
                        {capacity.remaining !== null && <span>{capacity.remaining} left</span>}
                      </p>
                    </div>
                  )}
                </div>

                <div className="mt-6">
                  <Button onClick={cta.action} disabled={cta.disabled} className="w-full h-12 rounded-[12px] text-[14px] font-semibold shadow-[0px_8px_24px_rgba(37,99,255,0.25)] hover:shadow-[0px_10px_24px_rgba(108,53,255,0.35)]">
                    {(cta as any).loading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…</> : cta.label}
                  </Button>
                  {userTicket && (
                    <Button variant="outline" className="mt-3 w-full h-12 rounded-[12px] border-[#E4E9F4] bg-white text-[#0B1235] hover:border-[#2563FF] hover:bg-[#EFF6FF] dark:border-[#262626] dark:bg-black dark:text-[#ededed]" onClick={() => setShowTicketModal(true)}>
                      <QrCode className="mr-2 h-4 w-4" /> View Ticket
                    </Button>
                  )}
                </div>

                <div className="mt-6 space-y-3 border-t border-[#E4E9F4] dark:border-[#262626] pt-6">
                  <Button variant="ghost" className="w-full justify-start h-10 rounded-[10px] text-[#0B1235] dark:text-[#ededed] hover:bg-[#EFF6FF] dark:hover:bg-[#171717]" onClick={toggleInterest}>
                    <Star className={cn("mr-2 h-4 w-4", interest?.interested ? "fill-amber-400 text-amber-400" : "")} />
                    {interest?.interested ? "Interested" : "Mark as interested"} {interest ? `· ${interest.count}` : ""}
                  </Button>
                  <Button variant="ghost" className="w-full justify-start h-10 rounded-[10px] text-[#0B1235] dark:text-[#ededed] hover:bg-[#EFF6FF] dark:hover:bg-[#171717]" onClick={shareEvent}>
                    <Share2 className="mr-2 h-4 w-4" /> Share event
                  </Button>
                  <Button variant="ghost" className="w-full justify-start h-10 rounded-[10px] text-[#0B1235] dark:text-[#ededed] hover:bg-[#EFF6FF] dark:hover:bg-[#171717]" onClick={shareToFeed} disabled={sharingToFeed}>
                    <Megaphone className="mr-2 h-4 w-4" /> Share to feed
                  </Button>
                </div>

                {participants.length > 0 && (
                  <div className="mt-6 border-t border-[#E4E9F4] dark:border-[#262626] pt-6">
                    <h3 className="text-[13px] font-semibold tracking-[-0.01em] text-[#0B1235] dark:text-[#ededed]" style={{ fontFamily: "Inter, sans-serif" }}>Participants ({participants.length})</h3>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {participants.slice(0, 8).map((p) => (
                        <Link key={p._id} href={`/profile/${p._id}`} className="group">
                          <UserAvatar user={p as any} size={32} className="ring-2 ring-white dark:ring-black group-hover:ring-[#2563FF]/30 transition-all" />
                        </Link>
                      ))}
                      {participants.length > 8 && <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#E4E9F4] dark:bg-[#171717] text-[11px] font-semibold text-[#64709A]">+{participants.length - 8}</span>}
                    </div>
                  </div>
                )}

                <div className="mt-6 flex items-center justify-center gap-1.5 text-[11px] font-medium text-[#64709A] dark:text-[#a1a1aa]">
                  <BadgeCheck className="h-3.5 w-3.5 text-[#16a34a]" /> Secure registration • QR ticket
                </div>
              </CardContent>
            </Card>

            {event.organization && (
              <Card className="rounded-[1.125rem] border-[#E4E9F4] shadow-[0px_4px_16px_rgba(24,39,75,0.04)] dark:border-[#262626] dark:bg-[#0a0a0a]">
                <CardContent className="p-5">
                  <div className="flex min-w-0 items-center gap-3">
                    {event.organization.logoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={getImageUrl(event.organization.logoUrl)} alt={event.organization.name} className="h-10 w-10 shrink-0 rounded-[12px] border border-[#E4E9F4] object-cover dark:border-[#262626]" />
                    ) : (
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] bg-[#EDE9FE] dark:bg-[#1e1b2e] text-[#7C3AED] dark:text-[#8b5cf6]"><Building2 className="h-5 w-5" /></span>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14px] font-semibold text-[#0B1235] dark:text-[#ededed]">{event.organization.name}</p>
                      <Link href={`/organizations/${event.organization.slug}`} className="text-[12px] font-medium text-[#2563FF] hover:text-[#1677FF] hover:underline">View organization →</Link>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </aside>
        </div>
      </div>

      <Dialog open={showRegistration} onOpenChange={setShowRegistration}>
        <DialogContent className="max-w-[calc(100vw-1rem)] sm:max-w-md max-h-[90vh] sm:max-h-[85vh] overflow-y-auto rounded-[1.125rem] border-[#E4E9F4] bg-white shadow-[0px_10px_40px_rgba(24,39,75,0.08)] dark:border-[#262626] dark:bg-[#0a0a0a] p-0 sm:p-6">
          <div className="sticky top-0 z-10 border-b border-[#E4E9F4] bg-white p-6 pb-4 dark:border-[#262626] dark:bg-[#0a0a0a]">
            <DialogHeader className="pr-8">
              <DialogTitle className="break-words text-[18px] font-semibold tracking-[-0.01em] text-[#0B1235] dark:text-[#ededed] sm:text-[20px]" style={{ fontFamily: "Inter, sans-serif", overflowWrap: "anywhere" }}>Register for {event.title}</DialogTitle>
              <DialogDescription className="break-words text-[13px] text-[#64709A] dark:text-[#a1a1aa] sm:text-[14px]">Complete the form below to secure your spot.</DialogDescription>
            </DialogHeader>
          </div>
          <div className="p-6 pt-4">
            <RegistrationForm eventId={event._id} eventTitle={event.title} requiredProfileFields={event.requiredProfileFields} customFields={event.registrationForm ?? []} onSuccess={handleRegisterSuccess} onCancel={() => setShowRegistration(false)} />
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showTicketModal} onOpenChange={setShowTicketModal}>
        <DialogContent className="max-w-[calc(100vw-1rem)] sm:max-w-sm max-h-[90vh] overflow-y-auto rounded-[1.125rem] border-[#E4E9F4] bg-white dark:border-[#262626] dark:bg-[#0a0a0a]">
          <DialogHeader className="pr-8">
            <DialogTitle className="text-[#0B1235] dark:text-[#ededed]">Your ticket</DialogTitle>
            <DialogDescription className="break-words text-[#64709A] dark:text-[#a1a1aa]">{event.title}</DialogDescription>
          </DialogHeader>
          {ticketLoading ? (
            <div className="flex flex-col items-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-[#3b82f6]" />
              <p className="mt-3 text-[13px] text-[#a1a1aa]">Generating your ticket…</p>
            </div>
          ) : userTicket ? (
            <div className="flex flex-col items-center">
              <div className="rounded-[1rem] border border-[#E4E9F4] bg-white p-3 shadow-[0px_4px_16px_rgba(24,39,75,0.04)] dark:border-[#262626]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={userTicket.qrCode} alt="Ticket QR code" className="h-52 w-52 max-w-[70vw] object-contain" />
              </div>
              <p className="mt-3 break-all text-[12px] text-[#64709A] dark:text-[#a1a1aa]">Ticket ID: <span className="font-mono font-semibold text-[#0B1235] dark:text-[#ededed]">{userTicket.token.slice(0, 12).toUpperCase()}</span></p>
              {userTicket.checkedIn ? (
                <span className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-[#E8F9EE] border border-[#86EFAC]/50 px-3 py-1 text-[12px] font-semibold text-[#16a34a]"><CheckCircle2 className="h-3.5 w-3.5" /> Checked in</span>
              ) : (
                <span className="mt-3 rounded-full bg-[#EFF6FF] border border-[#BFDBFE] px-3 py-1 text-[12px] font-semibold text-[#2563FF]">Active — show at entry</span>
              )}
              {ticketFetchError && <p className="mt-3 text-center text-[12px] text-[#f87171]">{ticketFetchError}</p>}
              <a href={userTicket.qrCode} download={`eventhub-ticket-${event.slug}.png`} className="mt-4">
                <Button variant="outline" size="sm" className="h-10 rounded-[10px] border-[#E4E9F4] bg-white dark:border-[#262626] dark:bg-black"><Download className="mr-2 h-4 w-4" /> Download QR</Button>
              </a>
              <Button variant="ghost" size="sm" className="mt-2 h-9 text-[12px]" onClick={() => { setShowTicketModal(false); fetchRegistrationStatus(); }}>
                Done
              </Button>
            </div>
          ) : (
            <div className="py-6 text-center">
              <p className="text-[13px] text-[#64709A] dark:text-[#a1a1aa]">Ticket not found — it will appear once issued.</p>
              {ticketFetchError && <p className="mt-2 text-[12px] text-[#f87171]">{ticketFetchError}</p>}
              <div className="mt-4 flex justify-center gap-2">
                <Button size="sm" variant="outline" onClick={() => fetchRegistrationStatus()}><Loader2 className="mr-2 h-4 w-4" /> Retry</Button>
                <Button size="sm" variant="ghost" onClick={() => setShowTicketModal(false)}>Close</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <ReportDialog open={reporting} onOpenChange={setReporting} targetType="event" targetId={event?._id || ""} />
      {event && <ShareKit event={event} open={showShareKit} onOpenChange={setShowShareKit} />}
    </>
  );
}
