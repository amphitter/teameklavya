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
  /** §23/§45 — the viewer's own ring: tapping it watches, the ⊕ creates. */
  hasStory?: boolean;
  onViewYourStory?: () => void;
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
  hasStory = false,
  onViewYourStory,
  onOpenGroup,
  onOpenCategory,
  canCreate = true,
}: StoryRailProps) {
  const railRef = useRef<HTMLDivElement>(null);
  /* The user's own group as the server reports it — one source for the ring's
     avatar, count and unseen state. */
  const myStory = groups.find((g) => g.isMe);

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
      {/* Your story.
          With an active story the ring means "watch mine" — the same thing a
          follower's ring means — and creating moves to the ⊕ on its corner, so
          a user can always see what they just published (§23: it appears in
          Your Story; §45: the viewer's own gestures). With nothing active the
          whole item is the create entry (§15: Camera / Gallery / Text).
          When a story IS active the ring is the SAME `StoryAvatar` their
          followers get, so "your story" and "their story" cannot drift. */}
      {canCreate ? (
        <div className="relative flex w-[4.5rem] shrink-0 flex-col items-center">
          {hasStory && myStory ? (
            <StoryAvatar
              name={displayName(myStory.author)}
              src={myStory.author.profile?.avatar}
              version={myStory.author.profile?.avatarVersion}
              verified={myStory.author.verified}
              unseen={myStory.hasUnseen}
              isMe
              count={myStory.stories.length}
              onClick={() => onViewYourStory?.()}
            />
          ) : (
            <button
              type="button"
              onClick={onYourStory}
              className="group flex w-full shrink-0 flex-col items-center gap-1.5 transition-transform active:scale-95 focus-visible:outline-none"
              aria-label="Add to your story"
            >
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-surface-container">
                <span className="flex h-[3.25rem] w-[3.25rem] items-center justify-center rounded-full border border-outline-variant bg-surface-container-lowest">
                  <Plus className="h-6 w-6 text-primary" />
                </span>
              </span>
              <span className="w-full truncate text-center text-[11px] font-medium text-on-surface">Your story</span>
            </button>
          )}
          {/* The ⊕ badge is a SECOND control next to the ring, so its hit area
              must not cover the ring's own centre: measured, a 44px box at the
              ring's corner swallowed taps aimed at the middle of the avatar and
              "view my story" opened the creator instead. The box is 36px, sits
              on the disc's bottom-right corner and starts 2px outside the
              column, so a tap on the face always reaches the ring. */}
          {hasStory ? (
            <button
              type="button"
              onClick={onYourStory}
              aria-label="Add to your story"
              className="absolute -right-0.5 top-[44px] flex h-9 w-9 items-center justify-center"
            >
              {/* The gradient is reserved for CTAs (§3) — this is one. */}
              <span className="brand-gradient flex h-6 w-6 items-center justify-center rounded-full border-[3px] border-surface-container-lowest">
                <Plus className="h-3 w-3 text-white" strokeWidth={3} />
              </span>
            </button>
          ) : null}
        </div>
      ) : null}

      {/* People you follow — your own row is skipped, because "Your story"
          above IS your row. It used to render twice: the rail showed a ring
          labelled "Your story" and then, right beside it, your group again
          (measured: two buttons with that label, at x=12 and x=96). The index
          stays the index in `groups` so the viewer still opens the right one. */}
      {groups.map((g, i) =>
        g.isMe ? null : (
        <StoryAvatar
          key={g.author._id}
          name={displayName(g.author)}
          src={g.author.profile?.avatar}
          version={g.author.profile?.avatarVersion}
          verified={g.author.verified}
          unseen={g.hasUnseen}
          isMe={g.isMe}
          count={g.stories.length}
          onClick={() => onOpenGroup?.(i)}
        />
        )
      )}

      {/* Category stories — icons, never letters (§39) */}
      {categories.map((c) => (
        <button
          key={c.key}
          type="button"
          onClick={() => onOpenCategory?.(c.key)}
          className="group flex w-[4.5rem] shrink-0 flex-col items-center gap-1.5 transition-transform active:scale-95 focus-visible:outline-none"
          aria-label={`${c.label} stories — ${c.count} active`}
        >
          {/* §27/§28 — a category is a ring with its ICON on a tinted disc, and
              the tint carries the meaning: `brand-light` → `purple-light` is the
              same lavender-blue wash the story rings use, so a category reads as
              "stories in this topic" rather than as a plain avatar.
              `block` on the ring is not cosmetic: as an inline box holding a
              flex child it split, and the browser painted its ring as two
              vertical lines running past the circle (measured in the 320/390
              sweep). A block box cannot split. */}
          <span className="relative block">
            <span className="block rounded-full bg-surface-container p-[2.5px] ring-1 ring-outline-variant">
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
  /** Bumped only when the photo changes — see `user-avatar`. */
  version?: number;
}

export function StoryAvatar({ name, src, verified, unseen, isMe, count, onClick, size = "md", version }: StoryAvatarProps) {
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
            user={{
              firstName: name.split(" ")[0],
              lastName: name.split(" ").slice(1).join(" "),
              profile: { avatar: src, avatarVersion: version },
            }}
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
