"use client";

/**
 * Presence UI (Part 11 §4)
 * ────────────────────────
 * Two small components, both fed by `usePresence` — which subscribes to ONE
 * user's presence slice, so a peer going online re-renders a dot, not a list.
 *
 * Deliberately absent: exact timestamps, "last seen 7 minutes and 12 seconds
 * ago", typing-in-a-typing-indicator-style noise. "Active now" or "Last seen
 * 5m ago" is what the user asked for and all a chat needs.
 */

import { useEffect, useState } from "react";
import { presenceLabel, usePresence } from "@/hooks/use-messages";
import { cn } from "@/lib/utils";

/** Re-render every minute so a relative label does not go stale. */
function useMinuteTick(enabled: boolean) {
  const [, force] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const t = setInterval(() => force((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, [enabled]);
}

/**
 * The green "active now" dot that sits on the avatar's corner.
 * Renders nothing when the peer is offline — an offline dot is noise.
 */
export function PresenceDot({ userId, size = 12, ring = "surface" }: { userId?: string | null; size?: number; ring?: string }) {
  const p = usePresence(userId);
  if (!p?.online) return null;
  return (
    <span
      aria-label="Active now"
      title="Active now"
      /* `bg-success` is the design system's green (globals.css), used here
       * for the one thing green means in every chat app: online. */
      className={cn(
        "absolute -bottom-0.5 -right-0.5 block rounded-full bg-success",
        ring === "surface" && "border-2 border-surface-container-lowest"
      )}
      style={{ width: size, height: size }}
    />
  );
}

/**
 * "Active now" / "Last seen 5m ago".
 * Returns null when nothing is known, so callers render nothing rather than
 * a claim they cannot support.
 */
export function PresenceText({
  userId,
  onlineClassName = "text-primary",
  className,
}: {
  userId?: string | null;
  onlineClassName?: string;
  className?: string;
}) {
  const p = usePresence(userId);
  useMinuteTick(!p?.online && Boolean(p?.lastSeenAt));
  const label = presenceLabel(p);
  if (!label) return null;
  return (
    <span className={cn("truncate", p?.online ? onlineClassName : className)}>{label}</span>
  );
}
