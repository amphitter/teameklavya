"use client";

/**
 * Event Memory page (Part 4, Phase 9 — spec §63).
 * "You were part of {event}" — score, rank, accuracy, answered, time in
 * the event, achievements earned there, certificate status, and a
 * structured share-to-feed composer. Every number comes from the
 * immutable EventResult snapshot via /events/:id/results — nothing here
 * is client-claimed or made up.
 */
import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import {
  Award,
  BadgeCheck,
  CalendarHeart,
  Clock,
  Loader2,
  Radio,
  Send,
  Sparkles,
  Trophy,
} from "lucide-react";
import { api } from "@/utils/api";
import { Button } from "@/components/ui/button";
import { EmptyState, Skeleton } from "@/components/states";
import { useSessionUser } from "@/components/shell/use-session-user";
import { cn } from "@/lib/utils";

export default function MemoryPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-2xl px-3 py-10"><Skeleton className="h-40" /></div>}>
      <MemoryView />
    </Suspense>
  );
}

function fmtDuration(ms: number | null | undefined) {
  if (!ms || ms < 0) return "—";
  const mins = Math.round(ms / 60000);
  if (mins < 1) return "under a minute";
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

function MemoryView() {
  const { slug } = useParams<{ slug: string }>();
  const { user } = useSessionUser();
  const [event, setEvent] = useState<any>(null);
  const [results, setResults] = useState<any>(null);
  const [badgeMeta, setBadgeMeta] = useState<Record<string, { title: string; description: string }>>({});
  const [loading, setLoading] = useState(true);
  const [sharing, setSharing] = useState(false);
  const [shared, setShared] = useState(false);
  const [caption, setCaption] = useState("");
  const [visibility, setVisibility] = useState("public");

  useEffect(() => {
    api
      .get(`/events/slug/${slug}`)
      .then((r) => setEvent(r.data?.event || null))
      .catch(() => setEvent(null));
  }, [slug]);

  useEffect(() => {
    if (!event?._id) return;
    api
      .get(`/events/${event._id}/results`)
      .then((r) => setResults(r.data?.success ? r.data : null))
      .catch(() => setResults(null))
      .finally(() => setLoading(false));
  }, [event?._id]);

  /* Badge metadata (titles/descriptions) for the chips */
  useEffect(() => {
    if (!user?._id) return;
    api
      .get(`/users/${user._id}/achievements`)
      .then((r) => {
        const map: Record<string, { title: string; description: string }> = {};
        for (const b of r.data?.achievements || []) map[b.code] = { title: b.title, description: b.description };
        setBadgeMeta(map);
      })
      .catch(() => {});
  }, [user?._id]);

  const share = useCallback(async () => {
    if (!event?._id || sharing || !caption.trim()) return;
    setSharing(true);
    try {
      const r = await api.post("/posts", {
        content: caption.trim(),
        eventId: event._id,
        type: "event_memory",
        visibility,
      });
      if (r.data?.success) {
        setShared(true);
        toast.success("Shared to your feed");
      } else {
        toast.error(r.data?.message || "Couldn't share");
      }
    } catch (e: any) {
      toast.error(e?.response?.data?.message || "Couldn't share");
    } finally {
      setSharing(false);
    }
  }, [event?._id, caption, visibility, sharing]);

  if (loading) {
    return (
      <div className="mx-auto max-w-2xl px-3 py-10">
        <Skeleton className="h-12 w-2/3" />
        <Skeleton className="mt-3 h-40" />
      </div>
    );
  }

  if (!event) {
    return (
      <div className="mx-auto max-w-xl px-3 py-16">
        <EmptyState icon={Radio} title="Event not found" description="This memory doesn't exist." />
      </div>
    );
  }

  const me = results?.me || null;
  const achievements: string[] = results?.achievements || [];
  const certificate = results?.certificate || { available: false };

  if (!results) {
    return (
      <div className="mx-auto max-w-xl px-3 py-16">
        <EmptyState
          icon={CalendarHeart}
          title="No memory yet"
          description="Results unlock when the event completes — come back after the finale."
        />
        <div className="mt-4 flex justify-center">
          <Button asChild variant="outline">
            <Link href={`/events/${slug}`}>Event page</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-3 py-6 sm:px-6 sm:py-10">
      {/* ── You were part of … (§63) ── */}
      <div className="rounded-2xl border border-border bg-card p-6 text-center">
        <p className="flex items-center justify-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-primary">
          <CalendarHeart className="h-3.5 w-3.5" aria-hidden="true" /> Event memory
        </p>
        <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-foreground sm:text-3xl">
          You were part of {event.title}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {new Date(results.finalizedAt || event.updatedAt).toLocaleDateString("en-IN", {
            day: "numeric",
            month: "long",
            year: "numeric",
          })}{" "}
          · {results.summary?.totalParticipants ?? "—"} participants
        </p>

        {me ? (
          <>
            {/* Stats (§63): score, rank, accuracy, answered, time */}
            <div className="mx-auto mt-5 grid max-w-lg grid-cols-2 gap-2 sm:grid-cols-5">
              <StatCard icon={Trophy} label="Score" value={String(me.score ?? 0)} />
              <StatCard icon={Award} label="Rank" value={me.rank ? `#${me.rank}` : "—"} />
              <StatCard icon={Sparkles} label="Accuracy" value={`${me.accuracy ?? 0}%`} />
              <StatCard icon={BadgeCheck} label="Answered" value={String(me.answered ?? 0)} />
              <StatCard icon={Clock} label="Time in event" value={fmtDuration(me.durationMs)} small />
            </div>

            {/* Achievements earned at this event */}
            {achievements.length > 0 && (
              <div className="mt-5">
                <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Achievements from this event</p>
                <div className="mt-2 flex flex-wrap justify-center gap-1.5">
                  {achievements.map((code) => (
                    <span
                      key={code}
                      title={badgeMeta[code]?.description || code}
                      className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-brand-light px-3 py-1 text-xs font-bold text-primary"
                    >
                      <Award className="h-3 w-3" aria-hidden="true" />
                      {badgeMeta[code]?.title || code.replace(/_/g, " ")}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Certificate (§62) — request recorded, designer comes later */}
            <div
              className={cn(
                "mx-auto mt-5 flex max-w-md items-center gap-2.5 rounded-xl border px-3.5 py-2.5 text-left text-sm",
                certificate.available ? "border-[#006C4C]/40 bg-success-light" : "border-border bg-muted/40"
              )}
            >
              <Award className={cn("h-5 w-5 shrink-0", certificate.available ? "text-[#006C4C]" : "text-muted-foreground")} aria-hidden="true" />
              {certificate.available ? (
                <span className="text-foreground">
                  <span className="font-extrabold capitalize">{certificate.kind} certificate</span> requested
                  {certificate.rank ? ` · rank #${certificate.rank}` : ""} —{" "}
                  <span className="text-muted-foreground">generation is coming in a future update.</span>
                </span>
              ) : (
                <span className="text-muted-foreground">No certificate for this event (answer at least one question next time!).</span>
              )}
            </div>
          </>
        ) : (
          <p className="mx-auto mt-4 max-w-md rounded-xl border border-border bg-muted/40 px-3.5 py-2.5 text-sm text-muted-foreground">
            You watched this one from the sidelines — join the next live event to score, rank and earn achievements.
          </p>
        )}
      </div>

      {/* ── Structured share (§63): caption editable, stats server-frozen ── */}
      {me && !shared ? (
        <div className="mt-4 rounded-2xl border border-border bg-card p-5">
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Share this memory</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Your rank, score, accuracy and achievements are attached automatically from the official results — write your own caption.
          </p>
          <textarea
            value={caption}
            onChange={(e) => setCaption(e.target.value.slice(0, 2000))}
            rows={3}
            placeholder={`What a day at ${event.title}! …`}
            aria-label="Memory caption"
            className="mt-3 w-full resize-none rounded-xl border border-border bg-background p-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <select
              value={visibility}
              onChange={(e) => setVisibility(e.target.value)}
              aria-label="Share visibility"
              className="h-9 rounded-xl border border-input bg-background px-2.5 text-xs font-semibold outline-none focus:border-primary/50"
            >
              <option value="public">Public — everyone</option>
              <option value="followers">Followers only</option>
              <option value="event_participants">Event participants</option>
            </select>
            <Button onClick={share} disabled={sharing || !caption.trim()} className="gap-1.5">
              {sharing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Share to feed
            </Button>
          </div>
        </div>
      ) : null}
      {shared ? (
        <div className="mt-4 rounded-2xl border border-[#006C4C]/40 bg-success-light p-4 text-center text-sm font-bold text-[#006C4C]">
          Shared! Find it on your feed.
        </div>
      ) : null}

      <div className="mt-5 flex justify-center gap-2">
        <Button asChild variant="outline">
          <Link href={`/events/${slug}`}>Back to event page</Link>
        </Button>
      </div>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  small,
}: {
  icon: any;
  label: string;
  value: string;
  small?: boolean;
}) {
  return (
    <div className="rounded-xl bg-muted/60 p-2.5 text-center">
      <Icon className="mx-auto h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
      <p className={cn("mt-1 font-extrabold tabular-nums text-foreground", small ? "text-sm" : "text-lg")}>{value}</p>
      <p className="text-[9px] font-bold uppercase tracking-wide text-muted-foreground">{label}</p>
    </div>
  );
}
