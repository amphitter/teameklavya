"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  BadgeCheck,
  CalendarDays,
  CheckCircle2,
  Clock,
  Loader2,
  Link as LinkIcon,
  LogOut,
  MapPin,
  Pencil,
  QrCode,
  Ticket as TicketIcon,
  UserRound,
  Video,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/utils/api";
import { getImageUrl, cloudinaryUrl } from "@/utils/image";
import { UserAvatar, versionedUrl } from "@/components/user-avatar";
import { EditProfileSheet } from "@/components/profile/edit-profile-sheet";
import { updateSessionUser, SESSION_EVENT } from "@/components/shell/use-session-user";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState, ErrorState, PageLoader, Skeleton } from "@/components/states";
import { cn } from "@/lib/utils";

/**
 * The user as `/auth/me` returns it.
 *
 * The `profile` shape here used to list only institution/course/year, which
 * is exactly the set of fields this screen could edit — the type was
 * describing the limitation rather than the data. Extended to the full
 * sub-document the backend actually stores and the edit sheet actually
 * writes, so the header can display what was saved.
 */
interface ProfileUser {
  _id: string;
  firstName: string;
  lastName: string;
  email: string;
  username?: string;
  role: string;
  emailVerified: boolean;
  profile?: {
    avatar?: string;
    coverImage?: string;
    coverPosition?: number;
    coverVersion?: number;
    avatarVersion?: number;
    bio?: string;
    location?: string;
    website?: string;
    institution?: string;
    course?: string;
    year?: string;
    interests?: string[];
  };
  createdAt?: string;
}

interface RegEvent {
  _id: string;
  slug?: string;
  title: string;
  bannerUrl?: string;
  startDate?: string;
  endDate?: string;
  startTime?: string;
  venue?: string;
  eventType?: string;
  category?: string;
}

interface UserTicket {
  _id: string;
  eventId: RegEvent;
  qrCode: string;
  token: string;
  status?: string;
  checkedIn: boolean;
}

function statusOf(startDate?: string, endDate?: string): "upcoming" | "ongoing" | "past" {
  const now = new Date();
  if (endDate && now > new Date(endDate)) return "past";
  if (startDate && now < new Date(startDate)) return "upcoming";
  return "ongoing";
}

export default function ProfileView() {
  const router = useRouter();

  const [user, setUser] = useState<ProfileUser | null>(null);
  /* An image upload writes immediately and does not pass through the sheet's
   * Save, so this screen is told about it the same way every other consumer
   * is: through the session. Without this the banner and photo here kept the
   * old values until a reload while the header had already changed. */
  useEffect(() => {
    const onSessionChange = () => {
      try {
        const raw = localStorage.getItem("user");
        if (!raw) return;
        const stored = JSON.parse(raw);
        setUser((prev) => {
          if (!prev) return prev;
          if (stored?._id && prev._id && stored._id !== prev._id) return prev;
          return { ...prev, profile: { ...((prev as any).profile || {}), ...(stored.profile || {}) } } as ProfileUser;
        });
      } catch {
        /* storage unavailable — the next fetch reconciles it */
      }
    };
    window.addEventListener(SESSION_EVENT, onSessionChange);
    return () => window.removeEventListener(SESSION_EVENT, onSessionChange);
  }, []);


  const [events, setEvents] = useState<RegEvent[]>([]);
  const [tickets, setTickets] = useState<UserTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  /* §2-7 — one edit surface, not two. This screen used to open an inline
   * form with institution / course / year only: no username, no photo, no
   * banner. It now opens the same EditProfileSheet the public profile uses,
   * so "Edit profile" means the same thing wherever the user finds it. */
  const [editing, setEditing] = useState(false);

  const [ticketModal, setTicketModal] = useState<UserTicket | null>(null);

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) {
      router.replace("/login?returnUrl=%2Fuser%2Fprofile");
      return;
    }
    (async () => {
      try {
        const [meRes, eventsRes, ticketsRes] = await Promise.all([
          api.get("/auth/me").catch(() => null),
          api.get("/registration/user/events").catch(() => ({ data: { events: [] } })),
          api.get("/tickets/user-tickets").catch(() => ({ data: { tickets: [] } })),
        ]);
        if (!meRes?.data?.user) {
          // Token invalid/expired
          localStorage.removeItem("token");
          localStorage.removeItem("role");
          localStorage.removeItem("user");
          router.replace("/login");
          return;
        }
        const u = meRes.data.user;
        setUser(u);
        setEvents(eventsRes.data?.events ?? []);
        setTickets(ticketsRes.data?.tickets ?? []);
      } catch {
        setError(true);
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  const ticketByEvent = useMemo(() => {
    const map = new Map<string, UserTicket>();
    tickets.forEach((t) => t.eventId?._id && map.set(t.eventId._id, t));
    return map;
  }, [tickets]);

  const upcoming = events.filter((e) => statusOf(e.startDate, e.endDate) !== "past");
  const past = events.filter((e) => statusOf(e.startDate, e.endDate) === "past");
  const checkedInCount = tickets.filter((t) => t.checkedIn).length;


  const handleLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("role");
    localStorage.removeItem("user");
    toast.success("Logged out");
    router.push("/");
    router.refresh();
  };

  if (loading) return <PageLoader label="Loading your profile…" />;

  if (error || !user) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-14">
        <ErrorState title="Couldn't load profile" description="Please try again." />
      </div>
    );
  }

  const fullName = `${user.firstName} ${user.lastName || ""}`.trim();
  const EventRow = ({ event }: { event: RegEvent }) => {
    const ticket = ticketByEvent.get(event._id);
    const st = statusOf(event.startDate, event.endDate);
    return (
      <div className="flex items-center gap-4 rounded-xl border border-border bg-card p-3.5 transition-colors hover:border-primary/30">
        <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-muted">
          {event.bannerUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={getImageUrl(event.bannerUrl)}
              alt={event.title}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-brand-light">
              <CalendarDays className="h-5 w-5 text-primary/50" />
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <Link
            href={event.slug ? `/events/${event.slug}` : "/events"}
            className="line-clamp-1 text-sm font-semibold text-foreground hover:text-primary"
          >
            {event.title}
          </Link>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
            {event.startDate && (
              <span className="inline-flex items-center gap-1">
                <CalendarDays className="h-3 w-3" />
                {new Date(event.startDate).toLocaleDateString("en-IN", {
                  day: "numeric",
                  month: "short",
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
            {st === "ongoing" && (
              <span className="inline-flex items-center gap-1 font-semibold text-destructive">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-destructive" /> Live
              </span>
            )}
          </p>
        </div>
        <div className="shrink-0">
          {ticket ? (
            <Button size="sm" variant="outline" onClick={() => setTicketModal(ticket)}>
              <QrCode className="mr-1.5 h-4 w-4" /> Ticket
            </Button>
          ) : st !== "past" ? (
            <span className="rounded-full bg-success-light px-2.5 py-1 text-[11px] font-semibold text-success">
              Registered
            </span>
          ) : (
            <span className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-semibold text-muted-foreground">
              {"Past"}
            </span>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      {/* ── Profile header ─────────────────────────────── */}
      <Card className="overflow-hidden">
        {/* Cover (§7). This screen previously showed neither a banner nor the
            uploaded avatar — it drew the user's INITIALS in a gradient box —
            so a member could upload a photo, save it successfully, and see
            nothing change anywhere. The gradient behind the image is the
            intended empty state, not a placeholder: a profile without a
            banner reads as designed rather than as a broken grey rectangle. */}
        <div className="relative h-32 w-full bg-gradient-to-r from-[#2563FF] via-[#6C35FF] to-[#D946EF] sm:h-40">
          {user.profile?.coverImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={
                cloudinaryUrl(versionedUrl(user.profile.coverImage, user.profile?.coverVersion), { w: 1200, h: 400 }) ||
                getImageUrl(user.profile.coverImage) ||
                ""
              }
              alt=""
              className="h-full w-full object-cover"
              /* The focal point set by the reposition control in the editor. */
              style={{
                objectPosition: `50% ${typeof user.profile?.coverPosition === "number" ? user.profile.coverPosition : 50}%`,
              }}
            />
          ) : null}
        </div>

        <CardContent className="p-6 sm:p-8">
          <div className="flex flex-col items-start gap-5 sm:flex-row sm:items-start">
            {/* The real avatar, not initials. Negative margin pulls it onto
                the cover the way every social profile does. */}
            <div className="-mt-16 shrink-0 rounded-full border-4 border-card bg-card sm:-mt-20">
              <UserAvatar user={user} size={80} className="!h-20 !w-20" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-extrabold tracking-tight text-foreground">{fullName}</h1>
                {user.username ? (
                  <span className="text-sm font-semibold text-muted-foreground">@{user.username}</span>
                ) : null}
                {user.emailVerified && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-success-light px-2.5 py-1 text-[11px] font-semibold text-success">
                    <BadgeCheck className="h-3.5 w-3.5" /> Verified
                  </span>
                )}
                {user.role === "admin" && (
                  <span className="rounded-full bg-purple-light px-2.5 py-1 text-[11px] font-semibold text-purple">
                    Organizer
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-sm text-muted-foreground">{user.email}</p>
              {user.profile?.bio ? (
                <p className="mt-2 max-w-prose text-sm text-foreground">{user.profile.bio}</p>
              ) : null}
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                {user.profile?.location ? (
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="h-3.5 w-3.5" /> {user.profile.location}
                  </span>
                ) : null}
                {user.profile?.website ? (
                  <a
                    href={user.profile.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 font-semibold text-primary hover:underline"
                  >
                    <LinkIcon className="h-3.5 w-3.5" /> {user.profile.website.replace(/^https?:\/\//, "")}
                  </a>
                ) : null}
              </div>
              {(user.profile?.interests || []).length ? (
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {(user.profile?.interests || []).slice(0, 8).map((t) => (
                    <span key={t} className="rounded-full bg-purple-light px-2.5 py-1 text-[11px] font-semibold text-purple">
                      {t}
                    </span>
                  ))}
                </div>
              ) : null}
              {user.createdAt && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Member since{" "}
                  {new Date(user.createdAt).toLocaleDateString("en-IN", {
                    month: "long",
                    year: "numeric",
                  })}
                </p>
              )}
            </div>
            <div className="flex shrink-0 gap-2">
              <Button variant="outline" size="sm" onClick={() => setEditing((s) => !s)}>
                <Pencil className="mr-1.5 h-3.5 w-3.5" /> Edit profile
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:bg-destructive/5 hover:text-destructive"
                onClick={handleLogout}
              >
                <LogOut className="mr-1.5 h-3.5 w-3.5" /> Log out
              </Button>
            </div>
          </div>

          {/* Stats */}
          <div className="mt-6 grid grid-cols-3 gap-3 border-t border-border pt-6">
            {[
              { label: "Events registered", value: events.length, icon: CalendarDays },
              { label: "Tickets", value: tickets.length, icon: TicketIcon },
              { label: "Checked in", value: checkedInCount, icon: CheckCircle2 },
            ].map((s) => (
              <div key={s.label} className="rounded-xl bg-muted/50 px-4 py-3.5 text-center">
                <p className="text-xl font-extrabold text-foreground">{s.value}</p>
                <p className="mt-0.5 text-[11px] font-medium text-muted-foreground">{s.label}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Edit profile (§2-7) — the full sheet: photo, banner, username,
          display name, bio, location, website, institution, skills, privacy. */}
      <EditProfileSheet
        open={editing}
        onClose={() => setEditing(false)}
        user={user}
        onSaved={(saved) => {
          /* Propagate without logout: this screen's copy AND the shared
           * session (header avatar, nav, author labels, other tabs). */
          if (saved) {
            setUser((prev) => (prev ? { ...prev, ...saved } : prev));
            updateSessionUser(saved);
            // Re-read /auth/me so anything the sheet did not return (e.g.
            // derived stats) is refreshed through the same code path.
            api.get("/auth/me").then((r) => r.data?.user && setUser(r.data.user)).catch(() => {});
          }
        }}
      />

      {/* ── Upcoming events ────────────────────────────── */}
      <section className="mt-10">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-lg font-bold text-foreground">
            <Clock className="h-5 w-5 text-primary" /> My upcoming events
          </h2>
          <Link href="/events" className="text-sm font-semibold text-primary hover:underline">
            Discover more
          </Link>
        </div>
        <div className="mt-4 space-y-3">
          {upcoming.length === 0 ? (
            <EmptyState
              icon={CalendarDays}
              title="No upcoming events"
              description="You haven't registered for any upcoming events yet."
              actionLabel="Discover events"
              onAction={() => router.push("/events")}
            />
          ) : (
            upcoming.map((e) => <EventRow key={e._id} event={e} />)
          )}
        </div>
      </section>

      {/* ── Past events ────────────────────────────────── */}
      {past.length > 0 && (
        <section className="mt-10">
          <h2 className="flex items-center gap-2 text-lg font-bold text-foreground">
            <UserRound className="h-5 w-5 text-muted-foreground" /> Past events
          </h2>
          <div className="mt-4 space-y-3">
            {past.map((e) => (
              <EventRow key={e._id} event={e} />
            ))}
          </div>
        </section>
      )}

      {/* ── Ticket QR modal ────────────────────────────── */}
      <Dialog open={Boolean(ticketModal)} onOpenChange={(o) => !o && setTicketModal(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Your ticket</DialogTitle>
            <DialogDescription>{ticketModal?.eventId?.title}</DialogDescription>
          </DialogHeader>
          {ticketModal && (
            <div className="flex flex-col items-center">
              <div className="rounded-xl border border-border bg-white p-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={ticketModal.qrCode}
                  alt="Ticket QR code"
                  className="h-52 w-52 object-contain"
                />
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                Ticket ID:{" "}
                <span className="font-mono font-semibold text-foreground">
                  {ticketModal.token.slice(0, 12).toUpperCase()}
                </span>
              </p>
              {ticketModal.checkedIn ? (
                <span className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-success-light px-3 py-1 text-xs font-semibold text-success">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Checked in
                </span>
              ) : ticketModal.status === "pending" ? (
                <span className="mt-3 rounded-full bg-warning-light px-3 py-1 text-xs font-semibold text-warning">
                  Pending approval
                </span>
              ) : (
                <span className="mt-3 rounded-full bg-brand-light px-3 py-1 text-xs font-semibold text-primary">
                  Active — show at entry
                </span>
              )}
              <a href={ticketModal.qrCode} download="eventhub-ticket.png">
                <Button variant="outline" size="sm" className="mt-4">
                  Download QR
                </Button>
              </a>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
