"use client";

import Link from "next/link";
import { useState } from "react";
import { BadgeCheck, CalendarDays, Camera, GraduationCap, Link2, MapPin } from "lucide-react";
import { UserAvatar, avatarUrlOf, versionedUrl } from "@/components/user-avatar";
import { AvatarPreview } from "@/components/profile/avatar-preview";
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
 *
 * ── The one rule this file exists to obey (Part 17 §4, §34) ──────────────────
 *
 *   BANNER
 *     ↓
 *   AVATAR OVERLAPS THE BANNER'S LOWER EDGE   ← and NOTHING else does
 *     ↓
 *   IDENTITY · METADATA · BIO · TAGS · ACTIONS · STATS   ← all BELOW the banner
 *
 * The previous build pulled the WHOLE header block — avatar *and* name — up over
 * the banner and put the two side by side. The name, the @username, the metadata
 * and the buttons were therefore drawn on top of the photo, and the buttons (the
 * `shrink-0` half of that row) were clipped over the text on a laptop.
 *
 * So the overlap is now owned by ONE row, and that row contains ONLY the avatar
 * (plus the desktop action region, which sits in its own column to the right).
 * Everything a reader actually reads starts on a fresh block BELOW the banner,
 * which is why no amount of long names, long handles or extra buttons can push
 * text onto the image: there is no shared box to collide in.
 *
 * Geometry, stated once because the numbers have to agree:
 *   avatar 80px on phones / 96px from `sm`  ·  overlap 40px / 48px (half)
 *   → the row's flow height is the avatar's *lower* half, so the name begins
 *     12px under the photo and never under the banner.
 */
function plural(n: number, pluralForm: string) {
  if (n !== 1) return pluralForm;
  if (pluralForm === "Following") return pluralForm;
  return pluralForm.replace(/s$/, "");
}

/**
 * One number and its label, stacked — the reference's stat cell, not a card.
 *
 * A button when it opens something (followers/following lists), plain text
 * otherwise, so the affordance matches the behaviour.
 *
 * `pluralize={false}` exists for labels that are already full phrases
 * ("Events Attended" — naive de-pluralising would strip the final `s` and render
 * "Events Attende"). The count is real in every case; only the grammar differs.
 */
function Stat({
  value,
  label,
  shortLabel,
  onClick,
  pluralize = true,
}: {
  value: number;
  /** The full name of the number (§14). */
  label: string;
  /** What a phone shows instead, when the full name would wrap (§14's own
   *  example numbering reads "Attended · Hosted"). Never a different number. */
  shortLabel?: string;
  onClick?: () => void;
  pluralize?: boolean;
}) {
  const shown = pluralize ? plural(value, label) : label;
  const short = shortLabel ?? shown;
  const body = (
    <span className="flex min-w-0 flex-col items-center leading-tight sm:items-start">
      <b className="text-[15px] font-extrabold tabular-nums text-foreground sm:text-lg">{compactCount(value)}</b>
      {/* Both spellings exist in the DOM; CSS decides which one is shown, so
          the accessibility tree and `innerText` always agree with the screen. */}
      <span className="text-center text-[10px] text-muted-foreground sm:hidden">{short}</span>
      <span className="hidden text-[11px] text-muted-foreground sm:inline">{shown}</span>
    </span>
  );
  if (!onClick) return body;
  return (
    <button
      type="button"
      onClick={onClick}
      className="min-w-0 rounded-md transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
    >
      {body}
    </button>
  );
}

/** `https://` and a trailing slash are noise in a one-line metadata row. */
function prettyUrl(url: string) {
  return url.replace(/^https?:\/\//i, "").replace(/\/$/, "");
}

export function ProfileHeader({
  user,
  stats,
  actions,
  onOpenFollowers,
  onOpenFollowing,
  onChangePhoto,
  onEditProfile,
  isOwn,
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
  /** Own profile: the edit flow owns "change photo"; the preview hands off to it. */
  onChangePhoto?: () => void;
  /** Own profile: opens the edit sheet from the banner / avatar shortcuts. */
  onEditProfile?: () => void;
  isOwn?: boolean;
}) {
  const [avatarOpen, setAvatarOpen] = useState(false);
  const p = user.profile || {};
  const interests = (p.interests || []).slice(0, 6);
  const coverPosition = typeof p.coverPosition === "number" ? p.coverPosition : 50;
  const joined = user.createdAt
    ? new Date(user.createdAt).toLocaleDateString("en-IN", { month: "long", year: "numeric" })
    : null;

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      {/* ── Cover (§3) ────────────────────────────────────────────────────────
          A wide, clean banner with rounded top corners (from the card's own
          radius + `overflow-hidden`), a natural crop and no overlay furniture —
          only the owner's "Edit cover" shortcut, which is how the banner is
          changed and is the one control the reference puts here too. The
          gradient behind the image is the fallback for accounts with no banner,
          so the header still reads as designed rather than as a grey hole. */}
      <div data-testid="profile-cover" className="relative h-32 w-full bg-gradient-to-br from-[#2563FF] to-[#6C35FF] sm:h-40 lg:h-48">
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
               a 1440px desktop. The asset itself is the canonical render —
               this positions it, it does not re-crop it (§30). */
            style={{ height: "100%", objectPosition: `50% ${coverPosition}%` }}
          />
        ) : null}

        {isOwn && onEditProfile ? (
          <button
            type="button"
            onClick={onEditProfile}
            className="absolute right-3 top-3 flex h-8 touch-manipulation items-center gap-1.5 rounded-full bg-black/55 px-3 text-[12px] font-semibold text-white transition-colors hover:bg-black/70 active:bg-black/75 sm:right-4 sm:top-4"
          >
            <Camera className="h-3.5 w-3.5" aria-hidden />
            Edit cover
          </button>
        ) : null}
      </div>

      {/* ── Profile content area ───────────────────────────────────────────── */}
      <div className="px-5 pb-5 sm:px-7 sm:pb-7">
        {/* THE OVERLAP ROW (§4, §6). The avatar is lifted exactly half its
            height so the photo straddles the banner's lower edge, and the row's
            flow height is therefore the avatar's LOWER half — the space the
            identity flows past on a phone. Nothing else in this row is
            negative-margined, so nothing else can touch the banner. */}
        <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-4 gap-y-3 sm:gap-x-5 sm:grid-cols-[auto_minmax(0,1fr)_auto]">
          {/* `relative z-10` is load-bearing, not decoration: the cover above is
              `position: relative`, so it paints in the positioned layer ABOVE
              plain in-flow content. The avatar is the one thing that must cross
              that edge, so it is given a stacking context of its own — the
              narrowest possible version of this (previously the whole header
              needed it because the whole header overlapped). */}
          <div
            data-testid="profile-avatar"
            className="relative z-10 -mt-10 w-fit shrink-0 rounded-full border-4 border-card sm:col-start-1 sm:row-start-1 sm:-mt-12"
          >
            <button
              type="button"
              onClick={() => setAvatarOpen(true)}
              /* The label says what is actually there: with no photo the preview
                 shows the initials fallback (and, on your own profile, the way
                 to add one), so announcing "View profile photo" would be a lie. */
              aria-label={avatarUrlOf(user) ? "View profile photo" : "Profile photo, not added yet"}
              className="block rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2"
            >
              <UserAvatar user={user} size={96} className="!h-20 !w-20 sm:!h-24 sm:!w-24" />
            </button>

            {/* Owner shortcut, mirroring the reference's camera chip. A
                separate control from the photo itself: tapping the photo still
                opens the preview (which is how you check the canonical crop),
                this opens the edit sheet. */}
            {isOwn && onEditProfile ? (
              <button
                type="button"
                onClick={onEditProfile}
                aria-label="Change profile photo"
                className="absolute -bottom-1 -right-1 flex h-8 w-8 items-center justify-center rounded-full border-2 border-card bg-primary text-white transition-transform active:scale-95"
              >
                <Camera className="h-3.5 w-3.5" aria-hidden />
              </button>
            ) : null}
          </div>

          {/* Desktop action region (§5, §6, §10): its own third column,
              right-aligned on the same row as the name — the reference's
              arrangement — and padded down by the avatar's overlap so it lines
              up with the identity rather than floating beside the photo. Below
              `sm` it is not rendered here at all: the same node appears in the
              identity column instead (§22). One breakpoint, so the buttons are
              never on screen twice. */}
          {actions ? (
            <div
              data-testid="profile-actions"
              className="hidden min-w-0 flex-wrap items-center justify-end gap-2 sm:col-start-3 sm:row-start-1 sm:flex sm:max-w-[20rem] sm:pt-12"
            >
              {actions}
            </div>
          ) : null}
        {/* (the grid stays open: the identity block belongs to it) */}

        {/* ── Identity (§7, §8, §9) ───────────────────────────────────────────
            Two placements, one rule — never on the banner:

              phones   col 1, row 2   → the avatar owns row 1 alone, so the name
                                        begins under the photo
              sm and up col 2, row 1  → beside the avatar, as the reference draws
                                        it, with `sm:pt-12` reserving the avatar's
                                        overlap so the name still starts at the
                                        banner's lower edge, not above it */}
        <div className="col-start-1 col-end-3 row-start-2 min-w-0 sm:col-start-2 sm:col-end-3 sm:row-start-1 sm:pt-12">
          <h1 className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[22px] font-bold leading-tight tracking-tight text-foreground sm:text-[28px]">
            <span className="min-w-0 break-words">
              {user.firstName} {user.lastName}
            </span>
            {user.verified && <BadgeCheck className="h-5 w-5 shrink-0 text-primary" aria-label="Verified" />}
          </h1>

          {user.username ? (
            <Link
              href={`/profile/${user.username}`}
              data-testid="profile-username"
              className="mt-0.5 inline-block max-w-full truncate text-sm text-muted-foreground hover:text-primary"
            >
              @{user.username}
            </Link>
          ) : (
            <p className="mt-0.5 text-sm text-muted-foreground">@{handleOf(user)}</p>
          )}

          {/* §22 — phones and tablets get the actions in the identity column,
              directly under the handle, and the desktop third column is not
              rendered at all below `sm`. One node visible at any width. */}
          {actions ? (
            <div data-testid="profile-actions" className="mt-4 flex flex-wrap items-center gap-2 sm:hidden">
              {actions}
            </div>
          ) : null}

          {/* ── Metadata (§11) ────────────────────────────────────────────────
            Only what identifies or affiliates the person: where they are, what
            they study at / work for, their link, and when they joined.
            Academic year is deliberately NOT here (§1): "BTech · 2nd Year" was
            a course-and-year chip pair the reference drops, and a year of study
            is the least durable thing about anyone. It stays editable in the
            profile sheet — it is simply not part of the header. */}
        {(p.location || p.institution || p.website || joined) && (
          <div data-testid="profile-meta" className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px] text-muted-foreground">
            {p.location && (
              <span className="flex min-w-0 items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <span className="break-words">{p.location}</span>
              </span>
            )}
            {p.institution && (
              <span className="flex min-w-0 items-center gap-1.5">
                <GraduationCap className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <span className="break-words">{p.institution}</span>
              </span>
            )}
            {p.website && (
              <a
                href={p.website}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="flex min-w-0 items-center gap-1.5 hover:text-primary"
              >
                <Link2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <span className="break-words">{prettyUrl(p.website)}</span>
              </a>
            )}
            {joined && (
              <span className="flex min-w-0 items-center gap-1.5">
                <CalendarDays className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <span className="break-words">Joined {joined}</span>
              </span>
            )}
          </div>
        )}

        {/* ── Bio (§12) — real text or nothing at all ─────────────────────── */}
        {p.bio && (
          <p data-testid="profile-bio" className="mt-3 max-w-xl text-sm leading-relaxed text-foreground/90">
            {p.bio}
          </p>
        )}

        {/* ── Tags (§13) — the user's own interests, wrapping naturally ───── */}
        {interests.length > 0 && (
          <div data-testid="profile-tags" className="mt-3 flex flex-wrap gap-1.5">
            {interests.map((t: string) => (
              <Link
                key={t}
                href={`/explore?q=${encodeURIComponent(t)}`}
                className="rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary transition-colors hover:bg-primary/15"
              >
                {t}
              </Link>
            ))}
          </div>
        )}

          {/* ── Stats (§14, §15) ──────────────────────────────────────────────
              Five real numbers, no tiles and no gauges: a five-column row on a
              phone (so nothing is clipped at 320), a single separated row from
              `sm`. Every value is the server's — the reference's numbers are
              illustrative and are never copied.

              It lives INSIDE the identity column so its left edge lines up with
              the name and the metadata at every width, with no magic offsets:
              the avatar's track is `auto`, so only a real grid sibling can
              follow it. */}
        {stats && (
          <div data-testid="profile-stats" className="mt-5 grid grid-cols-5 gap-y-3 border-t border-border pt-4 sm:flex sm:flex-wrap sm:items-start sm:gap-0 sm:divide-x sm:divide-border">
            <div className="min-w-0 sm:pr-6">
              <Stat value={stats.posts} label="Posts" />
            </div>
            <div className="min-w-0 sm:px-6">
              <Stat value={stats.followers} label="Followers" onClick={onOpenFollowers} />
            </div>
            <div className="min-w-0 sm:px-6">
              <Stat value={stats.following} label="Following" onClick={onOpenFollowing} />
            </div>
            <div className="min-w-0 sm:px-6">
              <Stat value={stats.eventsAttended} label="Events Attended" shortLabel="Attended" pluralize={false} />
            </div>
            <div className="min-w-0 sm:px-6">
              <Stat value={stats.eventsCreated || 0} label="Events Hosted" shortLabel="Hosted" pluralize={false} />
            </div>
          </div>
        )}
          </div>
        </div>
        {/* ── end of the header grid ───────────────────────────────────────────
            The identity block above is inside it, so the name occupies the grid's
            own column beside the avatar and the actions keep their third track.
            The stats row sits outside, spanning the full card width, the way the
            reference draws it. */}

      </div>

      <AvatarPreview
        open={avatarOpen}
        onClose={() => setAvatarOpen(false)}
        user={user}
        isOwn={isOwn}
        onChangePhoto={onChangePhoto}
      />
    </div>
  );
}
