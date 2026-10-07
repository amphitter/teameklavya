"use client";

import Link from "next/link";
import { BadgeCheck, CalendarDays, MapPin } from "lucide-react";
import { UserAvatar, versionedUrl } from "@/components/user-avatar";
import { handleOf, compactCount } from "@/lib/social";
import { OptimizedImage } from "@/components/ui/optimized-image";

export interface ProfileStats {
  posts: number;
  followers: number;
  following: number;
  eventsRegistered: number;
  eventsAttended: number;
  eventsCreated?: number;
  checkIns?: number;
  /* Sent to the profile's owner only: the size of their own archived set and
     how many drafts are sitting unseen. */
  archivedPosts?: number;
  draftPosts?: number;
}

/**
 * Participant profile header — shared by own profile and public profiles.
 * Cover image, avatar, @username, verification, bio, location, interests
 * and real stats. `actions` slot receives Edit / Follow buttons.
 */
/**
 * One number and its label, inline.
 *
 * A button when it opens something (followers/following lists), plain text
 * otherwise — so the affordance matches the behaviour instead of every stat
 * looking tappable.
 */
function Stat({ value, label, onClick }: { value: number; label: string; onClick?: () => void }) {
  const body = (
    <>
      <b className="text-[15px] font-extrabold text-foreground">{compactCount(value)}</b>{" "}
      <span className="text-[13px] text-muted-foreground">{label}</span>
    </>
  );
  if (!onClick) return <span className="flex items-baseline gap-1.5">{body}</span>;
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-baseline gap-1.5 rounded-md transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
    >
      {body}
    </button>
  );
}

export function ProfileHeader({
  user,
  stats,
  actions,
  onOpenFollowers,
  onOpenFollowing,
}: {
  user: {
    _id?: string;
    firstName?: string;
    lastName?: string;
    username?: string;
    verified?: boolean;
    email?: string;
    profile?: any;
    createdAt?: string;
  };
  stats: ProfileStats | null;
  actions?: React.ReactNode;
  onOpenFollowers?: () => void;
  onOpenFollowing?: () => void;
}) {
  const p = user.profile || {};
  const chips = [p.institution, p.course, p.year].filter(Boolean);
  const interests = (p.interests || []).slice(0, 6);

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      {/* Cover */}
      {/* Cover (§7). The gradient behind the image is the clean fallback the
          brief asks for — with no banner the header reads as a designed
          surface, never as an empty grey rectangle. */}
      <div className="relative h-28 w-full bg-gradient-to-r from-[#2563FF] via-[#6C35FF] to-[#D946EF] sm:h-36">
        {p.coverImage ? (
          <OptimizedImage
            src={versionedUrl(p.coverImage, p.coverVersion)}
            alt=""
            preset="banner"
            size="large"
            priority
            sizes="100vw"
            className="h-full w-full object-cover"
            /* The stored focal point, derived from the crop the user chose, so
               the same strip of the banner stays in frame on a 390px phone and
               a 1440px desktop. The asset itself is the 3:1 canonical render —
               this positions it, it does not re-crop it. */
            style={{ height: "100%", objectPosition: `50% ${typeof p.coverPosition === "number" ? p.coverPosition : 50}%` }}
          />
        ) : null}
      </div>

      {/* `relative z-10` is load-bearing, not decoration.
       *
       * The cover above is `position: relative`, so it paints in the positioned
       * layer — ABOVE plain in-flow content. This block overlaps it with
       * `-mt-12`, so without a stacking context of its own the cover covered
       * the name, the @username and every header action: `elementFromPoint` at
       * the centre of "Edit profile" returned the cover div, and the whole
       * edit-profile feature was unclickable with a mouse. Measured before the
       * fix: button top 174, cover bottom 230. */}
      <div className="relative z-10 px-5 pb-5 sm:px-7 sm:pb-7">
        <div className="-mt-12 flex flex-col gap-5 sm:-mt-14 sm:flex-row sm:items-start">
          {/* `w-fit` is load-bearing: in the mobile column the flex container
              stretches its children, so this ring was drawn the full width of
              the card — a giant pill outline lying across the cover, with the
              photo parked at its left edge. The ring must hug the avatar. */}
          <div className="w-fit shrink-0 rounded-full border-4 border-card">
            <UserAvatar user={user} size={96} className="!h-24 !w-24" />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <h1 className="flex flex-wrap items-center gap-1.5 text-xl font-bold tracking-tight text-foreground sm:text-2xl">
                  {user.firstName} {user.lastName}
                  {user.verified && (
                    <BadgeCheck className="h-5 w-5 shrink-0 text-primary" aria-label="Verified" />
                  )}
                </h1>
                {user.username ? (
                  <Link
                    href={`/profile/${user.username}`}
                    className="text-sm text-muted-foreground hover:text-primary"
                  >
                    @{user.username}
                  </Link>
                ) : (
                  <p className="text-sm text-muted-foreground">@{handleOf(user)}</p>
                )}

                {p.bio && <p className="mt-2 max-w-xl text-sm leading-relaxed text-foreground/90">{p.bio}</p>}

                {p.location && (
                  <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <MapPin className="h-3.5 w-3.5" />
                    {p.location}
                  </p>
                )}

                {chips.length > 0 && (
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {chips.map((c: string) => (
                      <span
                        key={c}
                        className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-semibold text-muted-foreground"
                      >
                        {c}
                      </span>
                    ))}
                  </div>
                )}

                {interests.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {interests.map((t: string) => (
                      <Link
                        key={t}
                        href={`/explore?q=${encodeURIComponent(t)}`}
                        className="rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary hover:bg-primary/15"
                      >
                        {t}
                      </Link>
                    ))}
                  </div>
                )}

                {user.createdAt && (
                  <p className="mt-2.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <CalendarDays className="h-3.5 w-3.5" />
                    Joined {new Date(user.createdAt).toLocaleDateString("en-IN", { month: "long", year: "numeric" })}
                  </p>
                )}
              </div>
              {actions && <div className="flex shrink-0 gap-2">{actions}</div>}
            </div>
          </div>
        </div>

        {/* ── Social stat row (§5) ────────────────────────────────────────
         * A compact inline row — Posts · Followers · Following — not five
         * dashboard tiles. The tiles were a card grid with their own
         * backgrounds and padding: 200px of vertical space to say three
         * numbers, and they read as an admin panel rather than a profile.
         *
         * Real numbers only, and the Posts figure now excludes archived posts
         * so it agrees with the Posts tab underneath it.
         *
         * Event-first identity is kept, not dropped: the events line below is
         * the part of this header that no other social product has. */}
        {stats && (
          <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border pt-4 sm:gap-x-5">
            <Stat value={stats.posts} label="Posts" />
            <Stat value={stats.followers} label="Followers" onClick={onOpenFollowers} />
            <Stat value={stats.following} label="Following" onClick={onOpenFollowing} />
            {/* Only when there is something real to say. A brand-new account
                shows no event line rather than "0 events attended". */}
            {(stats.eventsAttended > 0 || (stats.eventsCreated || 0) > 0) && (
              <span className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
                <CalendarDays className="h-3.5 w-3.5" aria-hidden />
                {stats.eventsAttended > 0 && (
                  <span>
                    <b className="font-semibold text-foreground">{compactCount(stats.eventsAttended)}</b> attended
                  </span>
                )}
                {stats.eventsAttended > 0 && (stats.eventsCreated || 0) > 0 && <span aria-hidden>·</span>}
                {(stats.eventsCreated || 0) > 0 && (
                  <span>
                    <b className="font-semibold text-foreground">{compactCount(stats.eventsCreated!)}</b> hosted
                  </span>
                )}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
