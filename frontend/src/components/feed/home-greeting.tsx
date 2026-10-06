"use client";

import Link from "next/link";

/**
 * Home greeting — time-of-day greeting with the signed-in user's first name,
 * visible on every breakpoint (styled per the phone home reference), plus a
 * live badge pill for the user's ongoing event. The score shown is the user's
 * REAL score on the live quiz leaderboard (nothing fabricated).
 */
export function HomeGreeting({
  firstName,
  liveBadge,
}: {
  firstName?: string;
  liveBadge?: { title: string; href: string; score?: number | null } | null;
}) {
  if (!firstName) return null;

  const hour = new Date().getHours();
  const partOfDay = hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";

  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 flex-col">
        <h1 className="truncate text-xl font-semibold tracking-tight text-foreground">
          Good {partOfDay}, {firstName}!
        </h1>
        <p className="mt-0.5 truncate text-[13px] text-muted-foreground">
          Ready to build, hack, and connect today?
        </p>
      </div>

      {liveBadge && (
        <Link
          href={liveBadge.href}
          className="flex shrink-0 items-center gap-1.5 rounded-full bg-muted px-3 py-1.5 shadow-sm transition-colors hover:bg-muted/70"
          title={`${liveBadge.title} is live now`}
        >
          <span className="h-2 w-2 animate-pulse rounded-full bg-destructive" />
          <span className="max-w-[110px] truncate text-[11px] font-semibold text-foreground sm:max-w-[200px]">
            {liveBadge.title}
          </span>
          {typeof liveBadge.score === "number" && (
            <span className="text-[11px] font-bold text-primary">{liveBadge.score} pts</span>
          )}
        </Link>
      )}
    </div>
  );
}
