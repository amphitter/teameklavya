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
import { getImageUrl } from "@/utils/image";
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

interface ProfileUser {
  _id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  emailVerified: boolean;
  profile?: { institution?: string; course?: string; year?: string };
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
  const [events, setEvents] = useState<RegEvent[]>([]);
  const [tickets, setTickets] = useState<UserTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({ institution: "", course: "", year: "" });
  const [saving, setSaving] = useState(false);

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
        setEditForm({
          institution: u.profile?.institution || "",
          course: u.profile?.course || "",
          year: u.profile?.year || "",
        });
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

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await api.put("/auth/me/profile", editForm);
      setUser((u) => (u ? { ...u, profile: res.data?.profile ?? editForm } : u));
      setEditing(false);
      toast.success("Profile updated");
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Failed to update profile");
    } finally {
      setSaving(false);
    }
  };

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
  const initials = `${user.firstName?.[0] || ""}${user.lastName?.[0] || ""}`.toUpperCase() || "U";

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
      <Card>
        <CardContent className="p-6 sm:p-8">
          <div className="flex flex-col items-start gap-5 sm:flex-row sm:items-center">
            <span className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[#0070f0] to-[#5030f0] text-2xl font-extrabold text-white">
              {initials}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-extrabold tracking-tight text-foreground">{fullName}</h1>
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

      {/* ── Edit profile ───────────────────────────────── */}
      {editing && (
        <Card className="mt-6">
          <CardContent className="p-6">
            <h2 className="text-base font-bold text-foreground">Profile details</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              These auto-fill into event registration forms.
            </p>
            <form onSubmit={saveProfile} className="mt-4 grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="institution">Institution / Organization</Label>
                <Input
                  id="institution"
                  value={editForm.institution}
                  onChange={(e) => setEditForm({ ...editForm, institution: e.target.value })}
                  placeholder="e.g. GITM"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="course">Course / Program</Label>
                <Input
                  id="course"
                  value={editForm.course}
                  onChange={(e) => setEditForm({ ...editForm, course: e.target.value })}
                  placeholder="e.g. B.Tech CSE"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="year">Year</Label>
                <Input
                  id="year"
                  value={editForm.year}
                  onChange={(e) => setEditForm({ ...editForm, year: e.target.value })}
                  placeholder="e.g. 3rd year"
                />
              </div>
              <div className="flex gap-2.5 sm:col-span-3">
                <Button type="submit" className="font-semibold" disabled={saving}>
                  {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Save changes
                </Button>
                <Button type="button" variant="outline" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

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
