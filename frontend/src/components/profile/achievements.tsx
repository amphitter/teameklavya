"use client";

import { Award, CalendarDays, Lock } from "lucide-react";
import { cn } from "@/lib/utils";

export interface AchievementBadge {
  code: string;
  title: string;
  description: string;
  icon: string; // material symbol name (see backend config/achievements.js)
  unlocked: boolean;
  unlockedAt: string | null;
}

/**
 * Achievements (Part 3, Phase 8) — every badge is unlocked by the backend
 * achievement engine from REAL data. Locked badges show requirements,
 * never fake earn dates. Nothing here is simulated.
 */
export function AchievementsGrid({
  achievements,
  memberSince,
}: {
  achievements: AchievementBadge[];
  memberSince?: string;
}) {
  if (!achievements || achievements.length === 0) return null;

  const sorted = [...achievements].sort((a, b) => Number(b.unlocked) - Number(a.unlocked));
  const unlockedCount = sorted.filter((a) => a.unlocked).length;

  return (
    <div className="space-y-4">
      {memberSince && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <CalendarDays className="h-4 w-4 text-primary" />
          On this journey since{" "}
          {new Date(memberSince).toLocaleDateString("en-IN", { month: "long", year: "numeric" })} ·{" "}
          <span className="font-semibold text-foreground">
            {unlockedCount}/{sorted.length} badges
          </span>
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {sorted.map((b) => (
          <div
            key={b.code}
            className={cn(
              "flex items-start gap-3.5 rounded-xl border p-4 transition-colors",
              b.unlocked ? "border-primary/30 bg-brand-light" : "border-dashed border-border bg-muted/40"
            )}
          >
            <div
              className={cn(
                "flex h-11 w-11 shrink-0 items-center justify-center rounded-full",
                b.unlocked ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
              )}
            >
              {b.unlocked ? (
                <span className="material-symbols-outlined text-[20px] leading-none">{b.icon}</span>
              ) : (
                <Lock className="h-4 w-4" />
              )}
            </div>
            <div className="min-w-0">
              <p className={cn("text-sm font-bold", b.unlocked ? "text-foreground" : "text-muted-foreground")}>
                {b.title}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {b.unlocked
                  ? b.unlockedAt
                    ? `Earned ${new Date(b.unlockedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}`
                    : "Earned"
                  : b.description}
              </p>
            </div>
          </div>
        ))}
      </div>
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Award className="h-3.5 w-3.5" /> Badges unlock automatically as you participate — no shortcuts, no simulations.
      </p>
    </div>
  );
}

