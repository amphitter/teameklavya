"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { avatarUrlOf, avatarVersionOf, versionedUrl } from "@/components/user-avatar";

/**
 * Full-size preview of the canonical avatar (Phase 4, "avatar preview").
 *
 * Why this exists at all: Phase 2 made one square crop the single source of
 * truth for every surface, and the only way to check that crop is to look at
 * it bigger than 96px. That is a real need, not a decoration — the whole point
 * of the canonical image is that what you see here is what everyone else sees.
 *
 * Where it lives: the profile header avatar, and only there. In the feed an
 * avatar is a `<Link>` to the profile and a second tap target on the same image
 * would be ambiguous; on the profile header the avatar had NO handler at all
 * (docs/PHASE4_FEED_AUDIT.md D5).
 *
 * Real data only: it renders the same `versionedUrl(avatar, avatarVersion)` the
 * avatar component uses, so a stale CDN copy can never appear here.
 */
export function AvatarPreview({
  open,
  onClose,
  user,
  isOwn,
  onChangePhoto,
}: {
  open: boolean;
  onClose: () => void;
  user: {
    _id?: string;
    firstName?: string;
    lastName?: string;
    username?: string;
    profile?: { avatar?: string; avatarVersion?: number } | null;
    avatar?: string;
    avatarVersion?: number;
  } | null;
  isOwn?: boolean;
  /** Own profile only: hands off to the existing camera/edit flow. */
  onChangePhoto?: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);

  /* Escape closes; focus moves into the dialog. No focus trap machinery is
     needed for a single-button surface, but keyboard users must be able to
     leave it without reaching for a mouse. */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    closeRef.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !user) return null;

  const raw = avatarUrlOf(user as never);
  const src = raw ? versionedUrl(raw, avatarVersionOf(user as never)) : "";
  const name = `${user.firstName || ""} ${user.lastName || ""}`.trim() || "This member";

  return (
    <div
      className="fixed inset-0 z-[95] flex flex-col items-center justify-center gap-4 bg-[rgba(11,18,53,0.82)] px-6 animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-label={`${name}'s profile photo`}
      onClick={onClose}
    >
      <button
        ref={closeRef}
        type="button"
        onClick={onClose}
        aria-label="Close photo preview"
        className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white transition hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
      >
        <X className="h-5 w-5" />
      </button>

      {/* stopPropagation: tapping the photo must not dismiss the preview. */}
      <div className="flex flex-col items-center gap-4" onClick={(e) => e.stopPropagation()}>
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt={`${name}'s profile photo`}
            data-testid="avatar-preview-image"
            className="h-64 w-64 rounded-full border-4 border-card object-cover shadow-2xl sm:h-72 sm:w-72"
          />
        ) : (
          <div className="grid h-64 w-64 place-items-center rounded-full border-4 border-card bg-muted text-5xl font-bold text-muted-foreground shadow-2xl sm:h-72 sm:w-72">
            {(user.firstName?.[0] || "?").toUpperCase()}
            {(user.lastName?.[0] || "").toUpperCase()}
          </div>
        )}

        <div className="text-center">
          <p className="text-base font-bold text-white">{name}</p>
          {user.username ? <p className="text-sm text-white/70">@{user.username}</p> : null}
        </div>

        <div className="flex items-center gap-2">
          {isOwn && onChangePhoto ? (
            <button
              type="button"
              onClick={() => {
                onClose();
                onChangePhoto();
              }}
              className="rounded-full bg-white px-4 py-2 text-sm font-bold text-[#0B1235] transition hover:bg-white/90"
            >
              Change photo
            </button>
          ) : null}
          {!isOwn && user.username ? (
            <Link
              href={`/profile/${user.username}`}
              onClick={onClose}
              className="rounded-full bg-white px-4 py-2 text-sm font-bold text-[#0B1235] transition hover:bg-white/90"
            >
              View profile
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  );
}
