"use client";

/**
 * UserAvatar — the one way EventHub draws a person.
 *
 * Cross-device consistency (§7, §26)
 * ----------------------------------
 * Two things make the same person look like the same person on every screen:
 *
 * 1. **One canonical asset.** The stored avatar is already the user's chosen
 *    square (rendered by the crop editor), so every request is a pure scale of
 *    the same picture — never a fresh crop of the original.
 *
 * 2. **Square requests only.** This is the part that used to be wrong. The old
 *    srcset asked for `w_64,h_40`, `w_160,h_40`, `w_400,h_40`… — a fixed
 *    HEIGHT with a varying width, i.e. a different aspect ratio per variant.
 *    A browser on a 1× screen picked the 64×40 entry, one on a 3× screen
 *    picked 160×40, and after `object-fit: cover` each landed on a different
 *    slice of the photo. That is "only a nose on one device, the whole face on
 *    another", and no amount of CSS could fix it because the *requested crop*
 *    was different. Every variant is now requested square, so the composition
 *    is fixed and only the resolution changes.
 *
 * The box is also explicit — width, height, aspect-ratio 1/1, object-fit cover,
 * centred — so nothing here depends on the container it is dropped into, and
 * no call site gets to pass its own `object-position`.
 */

import { cn } from "@/lib/utils";
import { OptimizedImage } from "@/components/ui/optimized-image";

export interface AvatarUser {
  _id?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  username?: string;
  profile?: { avatar?: string; avatarVersion?: number };
  /** Legacy shape: some payloads carry the URL at the top level. */
  avatar?: string;
  avatarVersion?: number;
}

/** The avatar's own URL, whichever shape the payload uses. */
export function avatarUrlOf(user?: AvatarUser | null): string {
  if (!user) return "";
  return user.profile?.avatar || user.avatar || "";
}

/** The asset version, whichever shape the payload uses. */
export function avatarVersionOf(user?: AvatarUser | null): number | undefined {
  if (!user) return undefined;
  return user.profile?.avatarVersion ?? user.avatarVersion ?? undefined;
}

/**
 * Append the asset version so a replaced photo is never served from cache.
 *
 * `v` only changes when the file changes, so an unchanged avatar stays cached
 * indefinitely while a new one is fetched immediately (§27). Any query already
 * on the URL is preserved — the CDN URL may carry its own parameters.
 */
export function versionedUrl(url: string, version?: number): string {
  if (!url || !version) return url;
  if (url.includes(`v=${version}`)) return url;
  return url + (url.includes("?") ? "&" : "?") + `v=${version}`;
}

export function initialsOf(user?: AvatarUser | null): string {
  if (!user) return "?";
  const initials = `${user.firstName?.[0] ?? ""}${user.lastName?.[0] ?? ""}`.toUpperCase();
  return initials || (user.email?.[0] ?? "?").toUpperCase();
}

/**
 * The initials tile — the fallback when someone has no photo.
 *
 * Exported separately so places that render their own markup (the shell's
 * account button, story rings) can use the same look without duplicating it.
 */
export function AvatarFallback({
  user,
  size = 40,
  className,
}: {
  user?: AvatarUser | null;
  size?: number;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex shrink-0 select-none items-center justify-center rounded-full",
        user ? "bg-brand-light font-bold text-primary" : "bg-muted text-muted-foreground",
        className
      )}
      style={{ width: size, height: size, fontSize: Math.max(10, size * 0.36) }}
    >
      {initialsOf(user)}
    </span>
  );
}

export function UserAvatar({
  user,
  size = 40,
  className,
  /** Alt text override — the header avatar is decorative, a profile is not. */
  alt,
}: {
  user?: AvatarUser | null;
  size?: number;
  className?: string;
  alt?: string;
}) {
  const raw = avatarUrlOf(user);
  const avatar = versionedUrl(raw, avatarVersionOf(user));
  const label = alt ?? (user?.firstName ? `${user.firstName}${user.lastName ? ` ${user.lastName}` : ""}` : "User");

  if (avatar) {
    return (
      <OptimizedImage
        src={avatar}
        alt={label}
        preset="avatar"
        width={size}
        height={size}
        sizes={`${size}px`}
        className={cn("shrink-0 rounded-full object-cover", className)}
        /* Explicit box + square aspect + centred crop. `objectPosition` is
           deliberately NOT settable from outside: a caller that could shift it
           could put a different part of someone's face in the circle than every
           other surface shows — the exact inconsistency this component exists
           to prevent (§7 — "no random object-position values"). */
        style={{
          width: size,
          height: size,
          aspectRatio: "1 / 1",
          objectFit: "cover",
          objectPosition: "50% 50%",
        }}
      />
    );
  }

  return <AvatarFallback user={user} size={size} className={className} />;
}
