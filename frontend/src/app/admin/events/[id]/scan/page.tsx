"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { BrowserQRCodeReader } from "@zxing/browser";
import { api } from "@/utils/api";
import { PageLoader, ErrorState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  ChevronLeft,
  LogIn,
  LogOut,
  ScanLine,
  Timer,
  UserCheck,
  Users,
  Video,
  VideoOff,
} from "lucide-react";

interface Ticket {
  _id: string;
  token: string;
  status: string;
  checkedIn: boolean;
  checkInTime?: string;
  checkOutTime?: string;
  userId?: { firstName?: string; lastName?: string; email?: string; profile?: any };
  eventId?: { title?: string } | string;
}

export default function EventScanPage() {
  const { id } = useParams<{ id: string }>();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [event, setEvent] = useState<any>(null);
  const [stats, setStats] = useState<any>(null);
  const [recent, setRecent] = useState<any[]>([]);

  const [scanning, setScanning] = useState(false);
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [manualToken, setManualToken] = useState("");
  const [busy, setBusy] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<any>(null);
  const cooldownRef = useRef(false);

  const loadSide = useCallback(() => {
    api.get(`/tickets/event/${id}/stats`).then((r) => setStats(r.data?.stats)).catch(() => {});
    api.get(`/tickets/event/${id}/recent-scans`).then((r) => setRecent(r.data?.scans || [])).catch(() => {});
  }, [id]);

  useEffect(() => {
    api
      .get(`/events/${id}`)
      .then((res) => {
        if (res.data?.event) setEvent(res.data.event);
        else setError("Event not found");
      })
      .catch((err) => setError(err.response?.data?.message || "Failed to load event"))
      .finally(() => setLoading(false));
    loadSide();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const stopCamera = useCallback(() => {
    controlsRef.current?.stop?.();
    controlsRef.current = null;
    setScanning(false);
  }, []);

  // Cleanup on unmount
  useEffect(() => () => controlsRef.current?.stop?.(), []);

  const lookupTicket = useCallback(async (token: string) => {
    try {
      const res = await api.get(`/tickets/token/${encodeURIComponent(token)}`);
      if (res.data?.ticket) {
        setTicket(res.data.ticket);
        stopCamera();
      } else {
        toast.error("Ticket not found");
      }
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Ticket not found");
    }
  }, [stopCamera]);

  const startCamera = async () => {
    setTicket(null);
    try {
      const reader = new BrowserQRCodeReader();
      setScanning(true);
      const controls = await reader.decodeFromVideoDevice(undefined, videoRef.current!, (result) => {
        if (!result || cooldownRef.current) return;
        cooldownRef.current = true;
        setTimeout(() => (cooldownRef.current = false), 2500);
        const text = result.getText();
        try {
          const parsed = JSON.parse(text);
          if (parsed.type === "event-ticket" && parsed.ticketId) {
            lookupTicket(parsed.ticketId);
          } else if (parsed.token) {
            lookupTicket(parsed.token);
          } else {
            toast.error("Not a valid event ticket QR");
          }
        } catch {
          // raw token string
          lookupTicket(text.trim());
        }
      });
      controlsRef.current = controls;
    } catch {
      toast.error("Couldn't access camera — check browser permissions");
      setScanning(false);
    }
  };

  const doScanAction = async (action: "entry" | "exit") => {
    if (!ticket) return;
    setBusy(true);
    try {
      const res = await api.post(`/tickets/scan`, { token: ticket.token, action });
      if (res.data?.ticket) {
        setTicket(res.data.ticket);
        toast.success(action === "entry" ? "Checked in" : "Checked out");
        loadSide();
      } else {
        toast.error(res.data?.message || "Scan failed");
      }
    } catch (err: any) {
      toast.error(err.response?.data?.message || "Scan failed");
      // refresh ticket state in case of "already checked in" etc.
      if (err.response?.data?.ticket) setTicket(err.response.data.ticket);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <PageLoader label="Loading scanner…" />;
  if (error)
    return (
      <div className="space-y-4">
        <Link href="/admin/events" className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-3.5 w-3.5" /> All events
        </Link>
        <ErrorState title="Couldn't load event" description={error} />
      </div>
    );

  const userName = (u: any) => `${u?.firstName ?? ""} ${u?.lastName ?? ""}`.trim() || "Unknown";

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Link href={`/admin/events`} className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground">
            <ChevronLeft className="h-3.5 w-3.5" /> All events
          </Link>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground">Ticket scanner</h1>
          <p className="text-sm text-muted-foreground">{event?.title || "Event"}</p>
        </div>
        <Link href={`/admin/events/${id}/registrations`}>
          <Button variant="outline">Registrations</Button>
        </Link>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Tickets", value: stats?.totalTickets ?? "—", icon: Users, cls: "bg-brand-light text-primary" },
          { label: "Checked in", value: stats?.checkedInTickets ?? "—", icon: UserCheck, cls: "bg-success-light text-success" },
          { label: "Checked out", value: stats?.checkedOutTickets ?? "—", icon: LogOut, cls: "bg-muted text-muted-foreground" },
          {
            label: "Attendance",
            value: stats?.attendanceRate != null ? `${Math.round(stats.attendanceRate)}%` : "—",
            icon: Timer,
            cls: "bg-purple-light text-purple",
          },
        ].map((s) => (
          <div key={s.label} className="flex items-center gap-3 rounded-xl border border-border bg-card p-3.5">
            <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", s.cls)}>
              <s.icon className="h-4.5 w-4.5" />
            </div>
            <div>
              <div className="text-lg font-bold text-foreground">{s.value}</div>
              <div className="text-[11px] text-muted-foreground">{s.label}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        {/* Scanner */}
        <div className="space-y-4 rounded-xl border border-border bg-card p-5">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-base font-bold text-foreground">
              <ScanLine className="h-4.5 w-4.5 text-primary" /> Scan a ticket
            </h2>
            {scanning ? (
              <Button variant="outline" size="sm" onClick={stopCamera}>
                <VideoOff className="mr-1.5 h-4 w-4" /> Stop camera
              </Button>
            ) : (
              <Button size="sm" onClick={startCamera}>
                <Video className="mr-1.5 h-4 w-4" /> Start camera
              </Button>
            )}
          </div>

          <div className="relative aspect-video overflow-hidden rounded-lg border border-dashed border-border bg-muted">
            <video ref={videoRef} className={cn("h-full w-full object-cover", !scanning && "hidden")} muted playsInline />
            {!scanning && (
              <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-muted-foreground">
                <ScanLine className="h-8 w-8" />
                <p className="text-sm font-medium">Camera is off</p>
                <p className="max-w-xs text-center text-xs">Click “Start camera” and point it at a participant&apos;s QR ticket, or enter the token manually below.</p>
              </div>
            )}
            {scanning && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="h-48 w-48 rounded-2xl border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]" />
              </div>
            )}
          </div>

          {/* Manual entry */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (manualToken.trim()) lookupTicket(manualToken.trim());
            }}
            className="flex gap-2"
          >
            <Input
              value={manualToken}
              onChange={(e) => setManualToken(e.target.value)}
              placeholder="Enter ticket token manually…"
            />
            <Button type="submit" variant="outline" className="shrink-0">
              Look up
            </Button>
          </form>

          {/* Scanned ticket card */}
          {ticket && (
            <div
              className={cn(
                "rounded-xl border p-4",
                ticket.checkedIn ? "border-success/40 bg-success-light" : "border-border bg-muted/40"
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-base font-bold text-foreground">{userName(ticket.userId)}</div>
                  <div className="text-sm text-muted-foreground">{ticket.userId?.email}</div>
                </div>
                <span
                  className={cn(
                    "rounded-full px-3 py-1 text-[11px] font-bold",
                    ticket.checkedIn ? "bg-success text-white" : "bg-muted text-muted-foreground"
                  )}
                >
                  {ticket.checkedIn ? "CHECKED IN" : "NOT CHECKED IN"}
                </span>
              </div>
              {ticket.checkedIn && ticket.checkInTime && (
                <p className="mt-2 text-xs text-muted-foreground">
                  In at {new Date(ticket.checkInTime).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                  {ticket.checkOutTime &&
                    ` · Out at ${new Date(ticket.checkOutTime).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}`}
                </p>
              )}
              <div className="mt-3.5 flex gap-2">
                {!ticket.checkedIn ? (
                  <Button onClick={() => doScanAction("entry")} disabled={busy} className="flex-1">
                    <LogIn className="mr-2 h-4 w-4" /> {busy ? "…" : "Check in"}
                  </Button>
                ) : (
                  <Button variant="outline" onClick={() => doScanAction("exit")} disabled={busy} className="flex-1">
                    <LogOut className="mr-2 h-4 w-4" /> {busy ? "…" : "Check out"}
                  </Button>
                )}
                <Button variant="ghost" onClick={() => setTicket(null)} className="shrink-0">
                  Dismiss
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Recent scans */}
        <div className="h-fit rounded-xl border border-border bg-card p-5">
          <h2 className="text-base font-bold text-foreground">Recent activity</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">Latest check-ins for this event</p>
          <div className="mt-4 space-y-2">
            {recent.length === 0 && (
              <p className="rounded-lg border border-dashed border-border bg-muted/40 px-4 py-6 text-center text-sm text-muted-foreground">
                No check-ins yet — scanned tickets will appear here.
              </p>
            )}
            {recent.map((s) => (
              <div key={s._id} className="flex items-center gap-3 rounded-lg border border-border bg-background px-3.5 py-2.5">
                <div
                  className={cn(
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
                    s.checkedIn ? "bg-success-light text-success" : "bg-muted text-muted-foreground"
                  )}
                >
                  <UserCheck className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-foreground">{userName(s.userId)}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {s.checkInTime
                      ? `Checked in ${new Date(s.checkInTime).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}`
                      : "Not checked in"}
                    {s.checkOutTime &&
                      ` · out ${new Date(s.checkOutTime).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}`}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
