"use client";

import { useRef } from "react";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";
import { UserAvatar } from "@/components/user-avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { storyCategoryIcon, storyCategoryLabel } from "@/lib/story-categories";
import type { StoryGroup } from "@/hooks/use-social";

/**
 * Story rail (§15, §36, §39).
 *
 * The previous rail rendered the first two letters of each event category
 * inside a story ring — the letter placeholders §15 explicitly prohibits.
 * Every avatar here is either a real person (photo, or initials derived from
 * their name) or a category rendered as a Material Symbols icon from the
 * central map. Never a bare two-letter abbreviation standing in for artwork.
 */

export interface StoryRailProps {
  groups: StoryGroup[];
  categories: { key: string; label: string; icon: string; count: number }[];
  loading?: boolean;
  onYourStory?: () => void;
  onOpenGroup?: (index: number) => void;
  onOpenCategory?: (key: string) => void;
  /** Signed-out visitors still see category stories (§15). */
  canCreate?: boolean;
}

export function StoryRail({
  groups,
  categories,
  loading,
  onYourStory,
  onOpenGroup,
  onOpenCategory,
  canCreate = true,
}: StoryRailProps) {
  const railRef = useRef<HTMLDivElement>(null);

  if (loading) return <StoryRailSkeleton />;

  const hasPeople = groups.length > 0;
  const hasCategories = categories.length > 0;
  if (!hasPeople && !hasCategories && !canCreate) return null;

  return (
    <div
      ref={railRef}
      className="rail-scroll -mx-1 flex gap-3 overflow-x-auto px-1 pb-1"
      role="list"
      aria-label="Stories"
    >
      {/* Your story */}
      {canCreate ? (
        <button
          type="button"
          onClick={onYourStory}
          className="group flex w-[4.5rem] shrink-0 flex-col items-center gap-1.5 focus-visible:outline-none"
          aria-label="Add to your story"
        >
          <span className="relative flex h-16 w-16 items-center justify-center rounded-full bg-surface-container transition-transform group-active:scale-95">
            <span className="flex h-[3.25rem] w-[3.25rem] items-center justify-center rounded-full border border-outline-variant bg-surface-container-lowest">
              <Plus className="h-6 w-6 text-primary" />
            </span>
            {/* The gradient is reserved for CTAs (§3) — this is one. */}
            <span className="brand-gradient absolute -bottom-0.5 -right-0.5 flex h-6 w-6 items-center justify-center rounded-full border-[3px] border-surface-container-lowest">
              <Plus className="h-3 w-3 text-white" strokeWidth={3} />
            </span>
          </span>
          <span className="w-full truncate text-center text-[11px] font-medium text-on-surface">Your story</span>
        </button>
      ) : null}

      {/* People you follow */}
      {groups.map((g, i) => (
        <StoryAvatar
          key={g.author._id}
          name={displayName(g.author)}
          src={g.author.profile?.avatar}
          verified={g.author.verified}
          unseen={g.hasUnseen}
          isMe={g.isMe}
          count={g.stories.length}
          onClick={() => onOpenGroup?.(i)}
        />
      ))}

      {/* Category stories — icons, never letters (§39) */}
      {categories.map((c) => (
        <button
          key={c.key}
          type="button"
          onClick={() => onOpenCategory?.(c.key)}
          className="group flex w-[4.5rem] shrink-0 flex-col items-center gap-1.5 transition-transform active:scale-95 focus-visible:outline-none"
          aria-label={`${c.label} stories — ${c.count} active`}
        >
          <span className="relative">
            <span className="rounded-full bg-surface-container p-[2.5px] ring-1 ring-outline-variant">
              <span className="flex h-[3.4rem] w-[3.4rem] items-center justify-center rounded-full bg-gradient-to-br from-brand-light to-purple-light">
                <Icon name={c.icon || storyCategoryIcon(c.key)} size={28} className="text-primary" />
              </span>
            </span>
          </span>
          <span className="w-full truncate text-center text-[11px] font-medium text-on-surface">{c.label}</span>
        </button>
      ))}
    </div>
  );
}

function displayName(a: StoryGroup["author"]) {
  return `${a.firstName || ""} ${a.lastName || ""}`.trim() || a.username || "Unknown";
}

export interface StoryAvatarProps {
  name: string;
  src?: string;
  verified?: boolean;
  /** Unseen stories wear the brand gradient ring (§3 reserved use). */
  unseen?: boolean;
  isMe?: boolean;
  count?: number;
  onClick?: () => void;
  size?: "sm" | "md";
}

export function StoryAvatar({ name, src, verified, unseen, isMe, count, onClick, size = "md" }: StoryAvatarProps) {
  const dim = size === "sm" ? "h-11 w-11" : "h-16 w-16";
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-[4.5rem] shrink-0 flex-col items-center gap-1.5 transition-transform active:scale-95 focus-visible:outline-none"
      aria-label={`${isMe ? "Your" : `${name}'s`} story${count && count > 1 ? ` — ${count} items` : ""}`}
    >
      <span className={cn("relative rounded-full p-[2.5px]", unseen ? "brand-gradient" : "bg-outline-variant")}>
        <span className={cn("relative block rounded-full border-[3px] border-surface-container-lowest", dim)}>
          <UserAvatar
            user={{ firstName: name.split(" ")[0], lastName: name.split(" ").slice(1).join(" "), profile: { avatar: src } }}
            size={size === "sm" ? 40 : 58}
            className="h-full w-full"
          />
        </span>
        {verified ? (
          <Icon
            name="verified"
            size={16}
            filled
            className="absolute -bottom-0.5 -right-0.5 rounded-full border-2 border-surface-container-lowest bg-surface-container-lowest text-primary"
          />
        ) : null}
        {count && count > 1 ? (
          <span className="absolute -top-0.5 -left-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold text-white">
            {count}
          </span>
        ) : null}
      </span>
      <span className="w-full truncate text-center text-[11px] font-medium text-on-surface">{isMe ? "Your story" : name.split(" ")[0]}</span>
    </button>
  );
}

export function StoryRailSkeleton() {
  return (
    <div className="rail-scroll -mx-1 flex gap-3 overflow-hidden px-1 pb-1" aria-busy="true" aria-label="Loading stories">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="flex w-[4.5rem] shrink-0 flex-col items-center gap-1.5">
          <Skeleton className="h-16 w-16 rounded-full" />
          <Skeleton className="h-2.5 w-11" />
        </div>
      ))}
    </div>
  );
}

/** Label helper re-exported so screens don't import the map twice. */
export { storyCategoryIcon, storyCategoryLabel };
