"use client";

/**
 * Live leaderboard (Part 4, Phase 5 — spec §31–38, §88–89).
 *
 * Ranks are SERVER-derived (score desc, joinedAt asc) — this component only
 * renders. Row movement animates with framer-motion `layout` transitions on
 * STABLE keys (§88: no flash re-rank, no full-list re-render). The podium is
 * restrained: subtle tints and medals, not confetti. Rank changes show a
 * directional icon AND text — never color alone (§18).
 *
 * Team mode (§37 foundation): entries may be teams (name + memberCount);
 * the same component renders both — the scoring engine is never duplicated.
 */
import { AnimatePresence, motion } from "framer-motion";
import { Award, Crown, Minus, TrendingDown, TrendingUp, Users } from "lucide-react";
import { UserAvatar } from "@/components/user-avatar";
import type { LeaderboardEntry } from "@/lib/live-protocol";
import { cn } from "@/lib/utils";

const MEDAL = [
  { label: "1st", cls: "border-amber-500/60 bg-amber-500/10 text-amber-600", height: "h-24", icon: Crown },
  { label: "2nd", cls: "border-zinc-400/60 bg-zinc-400/10 text-zinc-500", height: "h-20", icon: Award },
  { label: "3rd", cls: "border-orange-700/50 bg-orange-700/10 text-orange-700", height: "h-16", icon: Award },
];

function RankChange({ change }: { change: number | null | undefined }) {
  if (change === null || change === undefined) {
    return (
      <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wide text-muted-foreground" aria-label="New on the leaderboard">
        New
      </span>
    );
  }
  if (change > 0) {
    return (
      <span className="inline-flex items-center gap-0.5 text-[10px] font-extrabold text-[#006C4C]" aria-label={`Moved up ${change}`}>
        <TrendingUp className="h-3 w-3" aria-hidden="true" /> {change}
      </span>
    );
  }
  if (change < 0) {
    return (
      <span className="inline-flex items-center gap-0.5 text-[10px] font-extrabold text-[#ba1a1a]" aria-label={`Moved down ${-change}`}>
        <TrendingDown className="h-3 w-3" aria-hidden="true" /> {-change}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-muted-foreground" aria-label="No rank change">
      <Minus className="h-3 w-3" aria-hidden="true" /> 0
    </span>
  );
}

export function LiveLeaderboard({
  entries,
  meUserId,
  variant = "participant",
  compact = false,
}: {
  entries: LeaderboardEntry[];
  meUserId?: string;
  variant?: "participant" | "organizer";
  compact?: boolean;
}) {
  if (!entries.length) {
    return <p className="py-6 text-center text-sm text-muted-foreground">No scores yet — the board fills as answers land.</p>;
  }

  const podium = entries.slice(0, 3);
  const rest = compact ? [] : entries.slice(3);
  // Podium visual order: 2nd · 1st · 3rd (classic pedestal)
  const pedestal = [podium[1], podium[0], podium[2]].filter(Boolean);

  return (
    <div aria-label="Leaderboard">
      {/* Podium — elegant tints, no confetti (§34) */}
      {podium.length > 0 && (
        <div className="mb-4 grid grid-cols-3 items-end gap-2">
          {pedestal.map((e) => {
            const m = MEDAL[e.rank - 1] || MEDAL[2];
            const Icon = m.icon;
            const isMe = meUserId && e.participantId === meUserId;
            return (
              <div
                key={e.participantId || e.team || e.rank}
                className={cn(
                  "flex flex-col items-center justify-end rounded-xl border px-2 pb-2.5 pt-2 text-center",
                  m.cls,
                  m.height,
                  isMe && "ring-2 ring-primary ring-offset-1"
                )}
                aria-label={`Rank ${e.rank}: ${e.team || e.displayName}, ${e.score} points`}
              >
                <Icon className="mb-1 h-4 w-4" aria-hidden="true" />
                <span className="text-[9px] font-extrabold uppercase tracking-widest opacity-80">{m.label}</span>
                {e.team ? (
                  <>
                    <span className="mt-0.5 line-clamp-1 text-xs font-extrabold">{e.team}</span>
                    <span className="text-[10px] opacity-75">{e.memberCount} members</span>
                  </>
                ) : (
                  <>
                    <span className="mt-0.5 line-clamp-1 text-xs font-extrabold">{e.displayName}</span>
                    <span className="text-[10px] opacity-75 tabular-nums">{e.score} pts</span>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Full list — framer-motion layout moves rows by STABLE key (§88) */}
      <ul className="space-y-1.5">
        <AnimatePresence initial={false}>
          {rest.map((e) => {
            const isMe = meUserId && e.participantId === meUserId;
            const isTeam = Boolean(e.team);
            return (
              <motion.li
                key={e.participantId || e.team || e.rank}
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ type: "spring", stiffness: 420, damping: 34 }}
                className={cn(
                  "flex items-center gap-2.5 rounded-xl border px-3 py-2",
                  isMe ? "border-primary/50 bg-brand-light" : "border-border bg-background"
                )}
                aria-label={`Rank ${e.rank}: ${e.team || e.displayName}, ${e.score} points`}
              >
                <span className="w-7 shrink-0 text-center text-sm font-extrabold tabular-nums text-muted-foreground">
                  {e.rank}
                </span>
                {isTeam ? (
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted">
                    <Users className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  </span>
                ) : (
                  <UserAvatar
                    user={{ firstName: e.displayName, profile: { avatar: e.avatar || "" } } as any}
                    size={32}
                    className="shrink-0"
                  />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-bold text-foreground">
                    {isTeam ? e.team : e.displayName}
                    {isMe ? <span className="ml-1.5 rounded-full bg-primary px-1.5 py-0.5 text-[9px] font-extrabold uppercase text-white">You</span> : null}
                  </span>
                  <span className="block truncate text-[10px] text-muted-foreground">
                    {isTeam ? `${e.memberCount} members` : e.username ? `@${e.username}` : ""}
                  </span>
                </span>

                {/* Organizer-only stats (§69) — never broadcast to participants */}
                {variant === "organizer" && typeof e.correctCount === "number" ? (
                  <span className="hidden shrink-0 text-right text-[10px] leading-tight text-muted-foreground sm:block">
                    <span className="block font-bold text-foreground">
                      {e.correctCount}/{e.answeredCount ?? 0} correct
                    </span>
                    <span className="block tabular-nums">
                      {e.avgResponseMs ? `${(e.avgResponseMs / 1000).toFixed(1)}s avg` : "—"}
                    </span>
                  </span>
                ) : null}

                <span className="shrink-0 text-right">
                  <span className="block text-sm font-extrabold tabular-nums text-primary">{e.score}</span>
                  {/* rank-change only when the server sent it (final boards don't) */}
                  {e.rankChange !== undefined || e.previousRank !== undefined ? (
                    <RankChange change={e.rankChange} />
                  ) : null}
                </span>
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ul>
    </div>
  );
}
