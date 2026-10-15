"use client";

import { cn } from "@/lib/utils";

/**
 * EventHub brand marks — theme-aware, no flicker, no layout shift.
 * 
 * Both logos are 488x128, RGBA, same aspect 3.8125:1, so width is identical for same height.
 * Light: eventhub-logo-plain.png (dark text, transparent) — 43KB — for light theme
 * Dark: eventhub-logo-dark-theme.png (white text, transparent) — 37KB — for dark theme
 * 
 * Uses CSS dark: variant (html.dark class) to switch, not JS theme state,
 * so no hydration mismatch, no flicker, both preloaded, instant switch.
 */

export function LogoIcon({ className, size = 32 }: { className?: string; size?: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/brand/eventhub-icon.png"
      alt="EventHub"
      width={size}
      height={size}
      className={cn("h-8 w-8 object-contain", className)}
      style={{ height: size, width: size }}
      loading="eager"
      decoding="async"
    />
  );
}

export function Logo({
  className,
  size = 32,
  onDark = false,
}: {
  className?: string;
  size?: number;
  showTagline?: boolean;
  onDark?: boolean;
}) {
  const aspect = 488 / 128; // 3.8125
  const width = size * aspect;

  return (
    <div
      className={cn("relative shrink-0 overflow-hidden", className)}
      style={{ height: size, width: width }}
      aria-label="EventHub"
    >
      {/* Light theme logo — OLD logo preserved */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/brand/eventhub-logo-plain.png"
        alt="EventHub"
        width={488}
        height={128}
        className={cn(
          "absolute inset-0 h-full w-full object-contain object-left transition-opacity duration-200",
          onDark ? "hidden" : "block dark:hidden"
        )}
        loading="eager"
        decoding="async"
        draggable={false}
      />
      {/* Dark theme logo — White Accent */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/brand/eventhub-logo-dark-theme.png"
        alt="EventHub"
        width={488}
        height={128}
        className={cn(
          "absolute inset-0 h-full w-full object-contain object-left transition-opacity duration-200",
          onDark ? "block" : "hidden dark:block"
        )}
        loading="eager"
        decoding="async"
        draggable={false}
      />
    </div>
  );
}
