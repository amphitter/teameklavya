"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CalendarDays,
  CheckCircle2,
  Clock,
  MapPin,
  QrCode,
  Ticket as TicketIcon,
  Video,
} from "lucide-react";
import { api } from "@/utils/api";
import { getImageUrl } from "@/utils/image";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState, ErrorState, EventCardSkeleton, PageLoader } from "@/components/states";
import { cn } from "@/lib/utils";

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

export default function MyRegistrationsPage() {
  const router = useRouter();

  const [events, setEvents] = useState<RegEvent[]>([]);
  const [tickets, setTickets] = useState<UserTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [tab, setTab] = useState<"upcoming" | "past">(() =>
    typeof window !== "undefined" && new URLSearchParams(window.location.search).get("tab") === "past"
      ? "past"
      : "upcoming"
  );
  const [ticketModal, setTicketModal] = useState<UserTicket | null>(null);

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) {
      router.replace("/login?returnUrl=%2Fuser%2Fregistrations");
      return;
    }
    (async () => {
      try {
        // Canonical endpoints — one call each
        const [eventsRes, ticketsRes] = await Promise.all([
          api.get("/registration/user/events").catch(() => ({ data: { events: [] } })),
          api.get("/tickets/user-tickets").catch(() => ({ data: { tickets: [] } })),
        ]);
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
  const shown = tab === "upcoming" ? upcoming : past;

  if (loading) return <PageLoader label="Loading your registrations…" />;

  if (error) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-14">
        <ErrorState title="Couldn't load your registrations" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            My registrations
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {events.length} event{events.length === 1 ? "" : "s"} · {tickets.length} ticket
            {tickets.length === 1 ? "" : "s"}
          </p>
        </div>
        <Button variant="outline" asChild>
          <Link href="/events">Discover more events</Link>
        </Button>
      </div>

      {/* Tabs */}
      <div className="mt-6 inline-flex rounded-xl border border-border bg-card p-1">
        {(
          [
            { id: "upcoming", label: `Upcoming (${upcoming.length})` },
            { id: "past", label: `Past (${past.length})` },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "rounded-lg px-4 py-2 text-sm font-semibold transition-colors",
              tab === t.id
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* List */}
      <div className="mt-6 space-y-3">
        {shown.length === 0 ? (
          <EmptyState
            icon={TicketIcon}
            title={tab === "upcoming" ? "No upcoming registrations" : "No past events"}
            description={
              tab === "upcoming"
                ? "Register for an event and it'll show up here with your ticket."
                : "Events you attend will be listed here."
            }
            actionLabel="Discover events"
            onAction={() => router.push("/events")}
          />
        ) : (
          shown.map((event) => {
            const ticket = ticketByEvent.get(event._id);
            const st = statusOf(event.startDate, event.endDate);
            return (
              <div
                key={event._id}
                className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/30 sm:flex-row sm:items-center"
              >
                {/* Banner */}
                <div className="h-20 w-full shrink-0 overflow-hidden rounded-lg bg-muted sm:h-16 sm:w-28">
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
                  <Link
                    href={event.slug ? `/events/${event.slug}` : "/events"}
                    className="line-clamp-1 font-semibold text-foreground hover:text-primary"
                  >
                    {event.title}
                  </Link>
                  <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    {event.startDate && (
                      <span className="inline-flex items-center gap-1">
                        <CalendarDays className="h-3 w-3" />
                        {new Date(event.startDate).toLocaleDateString("en-IN", {
                          weekday: "short",
                          day: "numeric",
                          month: "short",
                        })}
                        {event.startTime ? ` · ${event.startTime}` : ""}
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
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-destructive" />
                        Live now
                      </span>
                    )}
                  </p>
                </div>

                {/* Status / ticket */}
                <div className="flex shrink-0 items-center gap-2">
                  {ticket ? (
                    <>
                      {ticket.checkedIn ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-success-light px-2.5 py-1 text-[11px] font-semibold text-success">
                          <CheckCircle2 className="h-3.5 w-3.5" /> Checked in
                        </span>
                      ) : ticket.status === "pending" ? (
                        <span className="rounded-full bg-warning-light px-2.5 py-1 text-[11px] font-semibold text-warning">
                          Pending
                        </span>
                      ) : null}
                      <Button size="sm" variant="outline" onClick={() => setTicketModal(ticket)}>
                        <QrCode className="mr-1.5 h-4 w-4" /> View ticket
                      </Button>
                    </>
                  ) : (
                    <span className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-semibold text-muted-foreground">
                      Registered
                    </span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Ticket QR modal */}
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
