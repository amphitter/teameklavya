"use client";

/**
 * Synced question timer (Part 4, Phase 4 — spec §17–18).
 *
 * The client is NEVER the source of truth: remaining time is derived from
 * the SERVER's startedAt + durationSec, corrected by the measured clock
 * offset (serverTime − clientTime). While paused (startedAt === null) the
 * countdown freezes at the server-supplied remainingMs.
 *
 * Restrained urgency (§18): warning/critical states change BOTH label text
 * and styling — never color alone — and never flash or shake.
 */
import { useEffect, useState } from "react";
import { Clock, AlertTriangle, TimerIcon } from "lucide-react";

export function QuestionTimer({
  startedAt,
  durationSec,
  elapsedBeforePause = 0,
  remainingMs: frozenRemainingMs,
  offset = 0,
  size = "md",
}: {
  startedAt: number | null; // ms epoch, null = paused
  durationSec: number;
  elapsedBeforePause?: number;
  remainingMs?: number; // authoritative while paused (or already closed)
  offset?: number; // serverTime − clientTime (ms)
  size?: "sm" | "md" | "lg";
}) {
  const totalMs = Math.max(1, durationSec * 1000);
  const [now, setNow] = useState(() => Date.now() + offset);

  useEffect(() => {
    // One tick per second is enough — the server decides everything anyway.
    const t = setInterval(() => setNow(Date.now() + offset), 250);
    return () => clearInterval(t);
  }, [offset]);

  let remaining: number;
  if (startedAt == null) {
    // Paused / closed: trust the frozen server value
    remaining = Math.max(0, frozenRemainingMs ?? totalMs);
  } else {
    const elapsed = elapsedBeforePause + Math.max(0, now - startedAt);
    remaining = Math.max(0, totalMs - elapsed);
  }

  const seconds = Math.ceil(remaining / 1000);
  const ratio = remaining / totalMs;
  const state: "normal" | "warning" | "critical" | "done" =
    remaining <= 0 ? "done" : ratio < 0.1 ? "critical" : ratio < 0.3 ? "warning" : "normal";

  const mm = Math.floor(seconds / 60);
  const ss = seconds % 60;
  const label = `${mm}:${String(ss).padStart(2, "0")}`;

  const sizeCls =
    size === "lg" ? "text-3xl px-5 py-2.5" : size === "sm" ? "text-sm px-2.5 py-1" : "text-xl px-3.5 py-1.5";

  const skin =
    state === "done"
      ? "bg-zinc-800 text-zinc-400 border-zinc-700"
      : state === "critical"
        ? "bg-red-950/60 text-red-300 border-red-800"
        : state === "warning"
          ? "bg-amber-950/50 text-amber-300 border-amber-800"
          : "bg-zinc-900 text-zinc-100 border-zinc-700";

  const Icon = state === "critical" || state === "done" ? AlertTriangle : state === "warning" ? TimerIcon : Clock;
  const stateText =
    state === "done" ? "Time's up" : state === "critical" ? "Almost up" : state === "warning" ? "Ending soon" : "Time left";

  return (
    <div
      role="timer"
      aria-label={`${stateText}: ${label}`}
      className={`inline-flex items-center gap-2 rounded-lg border font-mono font-semibold tabular-nums ${skin} ${sizeCls}`}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
      <span>{state === "done" ? "0:00" : label}</span>
      <span className="sr-only">{stateText}</span>
    </div>
  );
}
