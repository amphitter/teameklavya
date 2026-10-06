"use client";

import Link from "next/link";

export interface PulseEntry {
  rank: number;
  score: number;
  user?: { firstName?: string; lastName?: string } | null;
}

function entryLabel(en: PulseEntry): string {
  const name = en.user?.firstName
    ? `${en.user.firstName}${en.user.lastName ? ` ${en.user.lastName}` : ""}`
    : "Builder";
  return `${en.rank}. ${name} (${en.score} pts)`;
}

/**
 * Live leaderboard snapshot — phone layout (the full widget lives in the
 * desktop right rail). Real entries from the live quiz of the user's ongoing
 * event; renders nothing when nothing is live.
 */
export function LivePulseStrip({ quizId, entries }: { quizId: string; entries: PulseEntry[] }) {
  if (!entries.length) return null;

  return (
    <Link
      href={`/quiz/${quizId}`}
      className="flex items-center justify-between gap-2 rounded-xl bg-card p-3 shadow-sm transition-colors hover:bg-card/80"
    >
      <span className="flex min-w-0 items-center gap-2.5">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-muted">
          <span className="material-symbols-outlined text-[20px] text-primary">trophy</span>
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="text-[11px] font-medium text-muted-foreground">Live Leaderboard</span>
          <span className="truncate text-[13px] font-semibold text-foreground">
            {entries.slice(0, 2).map(entryLabel).join(" • ")}
          </span>
        </span>
      </span>
      <span className="flex shrink-0 items-center text-[11px] font-bold text-primary">
        View
        <span className="material-symbols-outlined text-[16px] leading-none">chevron_right</span>
      </span>
    </Link>
  );
}
