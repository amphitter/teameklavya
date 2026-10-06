"use client";

import { cn } from "@/lib/utils";
import { getImageUrl } from "@/utils/image";

/**
 * Consistent circular avatar everywhere (initials fallback).
 * Works with or without a logged-in user.
 */
export function UserAvatar({
  user,
  size = 40,
  className,
}: {
  user?: { _id?: string; firstName?: string; lastName?: string; email?: string; username?: string; profile?: { avatar?: string } } | null;
  size?: number;
  className?: string;
}) {
  const avatar = user?.profile?.avatar || (user as any)?.avatar;
  const initials = user
    ? `${user.firstName?.[0] ?? ""}${user.lastName?.[0] ?? ""}`.toUpperCase() ||
      (user.email?.[0] ?? "?").toUpperCase()
    : "?";

  if (avatar) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={getImageUrl(avatar)}
        alt={user?.firstName || "User"}
        width={size}
        height={size}
        className={cn("shrink-0 rounded-full object-cover", className)}
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <span
      aria-hidden
      className={cn(
        "flex shrink-0 select-none items-center justify-center rounded-full bg-brand-light font-bold text-primary",
        className
      )}
      style={{ width: size, height: size, fontSize: Math.max(10, size * 0.36) }}
    >
      {initials}
    </span>
  );
}
