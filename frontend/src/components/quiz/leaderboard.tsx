"use client";

import { UserAvatar } from "@/components/user-avatar";
import { cn } from "@/lib/utils";

export interface LeaderboardEntry {
  rank: number;
  user: { _id: string; firstName: string; lastName: string; username?: string; profile?: any } | null;
  score: number;
  correct: number;
  answered: number;
}

/** Ranked leaderboard — shared by the quiz page and the organizer console. */
export function Leaderboard({
  entries,
  myUserId,
  total,
  compact = false,
}: {
  entries: LeaderboardEntry[];
  myUserId?: string;
  total?: number;
  compact?: boolean;
}) {
  if (!entries.length) {
    return (
      <p className="rounded-xl border border-dashed border-border bg-muted/40 px-4 py-8 text-center text-sm text-muted-foreground">
        No players yet — be the first on the board.
      </p>
    );
  }

  const medal = (rank: number) =>
    rank === 1 ? "1st" : rank === 2 ? "2nd" : rank === 3 ? "3rd" : `#${rank}`;

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <ul className="divide-y divide-border">
        {entries.map((entry) => {
          const isMe = myUserId && entry.user?._id === myUserId;
          return (
            <li
              key={`${entry.rank}-${entry.user?._id}`}
              className={cn("flex items-center gap-3 px-4 py-3", isMe && "bg-brand-light")}
            >
              <span className={cn("w-9 shrink-0 text-center text-sm font-extrabold", entry.rank <= 3 ? "text-lg" : "text-muted-foreground")}>
                {medal(entry.rank)}
              </span>
              <UserAvatar user={entry.user} size={compact ? 30 : 34} />
              <div className="min-w-0 flex-1">
                <p className={cn("truncate text-sm font-bold", isMe ? "text-primary" : "text-foreground")}>
                  {entry.user?.firstName} {entry.user?.lastName}
                  {isMe && <span className="ml-1.5 rounded-full bg-primary px-1.5 py-0.5 text-[9px] font-bold uppercase text-primary-foreground">You</span>}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {entry.correct}/{entry.answered} correct
                </p>
              </div>
              <span className="shrink-0 text-right">
                <span className="block text-sm font-extrabold text-foreground">{entry.score}</span>
                <span className="block text-[10px] text-muted-foreground">pts</span>
              </span>
            </li>
          );
        })}
      </ul>
      {typeof total === "number" && total > entries.length && (
        <p className="border-t border-border bg-muted/30 px-4 py-2 text-center text-[11px] text-muted-foreground">
          Showing top {entries.length} of {total} players
        </p>
      )}
    </div>
  );
}
