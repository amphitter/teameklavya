"use client";

import Link from "next/link";
import { BadgeCheck, CalendarDays, MapPin } from "lucide-react";
import { UserAvatar } from "@/components/user-avatar";
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
}

/**
 * Participant profile header — shared by own profile and public profiles.
 * Cover image, avatar, @username, verification, bio, location, interests
 * and real stats. `actions` slot receives Edit / Follow buttons.
 */
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
            src={p.coverImage}
            alt=""
            preset="banner"
            size="large"
            priority
            sizes="100vw"
            className="h-full w-full object-cover"
            /* The stored focal point. A 1600×400 banner is shown here in a
               112px strip, so centring the crop is what decapitates photos —
               this is what the reposition control in the editor sets. */
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
          <div className="rounded-full border-4 border-card">
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

        {/* Stats — real numbers only; followers/following open lists */}
        {stats && (
          <div className="mt-6 grid grid-cols-3 gap-2.5 border-t border-border pt-5 sm:grid-cols-5">
            {[
              { label: "Events", value: stats.eventsRegistered, onClick: undefined },
              { label: "Attended", value: stats.eventsAttended, onClick: undefined },
              { label: "Posts", value: stats.posts, onClick: undefined },
              { label: "Followers", value: stats.followers, onClick: onOpenFollowers },
              { label: "Following", value: stats.following, onClick: onOpenFollowing },
            ].map((s) => {
              const inner = (
                <>
                  <div className="text-lg font-extrabold text-foreground">{compactCount(s.value)}</div>
                  <div className="text-[11px] font-medium text-muted-foreground">{s.label}</div>
                </>
              );
              return s.onClick ? (
                <button
                  key={s.label}
                  type="button"
                  onClick={s.onClick}
                  className="rounded-lg bg-muted/50 px-3.5 py-3 text-center transition-colors hover:bg-muted"
                >
                  {inner}
                </button>
              ) : (
                <div key={s.label} className="rounded-lg bg-muted/50 px-3.5 py-3 text-center">
                  {inner}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
