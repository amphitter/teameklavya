"use client";

import { cn } from "@/lib/utils";

/**
 * EventHub brand marks — always the official assets from /public/brand.
 * Never hand-draw the wordmark; use the logo image.
 */

/** Icon-only mark (favicons, tight spaces). */
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
    />
  );
}

/**
 * Full logo WITH tagline (official brand image, 3:1 aspect).
 * `size` = rendered height in px; width follows the image ratio.
 */
export function Logo({
  className,
  size = 32,
  /** On dark surfaces: lift brightness slightly so the blue mark stays readable */
  onDark = false,
}: {
  className?: string;
  size?: number;
  /** kept for API compatibility — the tagline is baked into the official image */
  showTagline?: boolean;
  onDark?: boolean;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      /* The same mark the mobile bar uses. The tagline version was replaced
         everywhere (Part 13 follow-up: "the logo we are using in mobile phone
         should be used in desktop nav login pages and extra places") — at the
         24–44px every one of these call sites renders, "People • Events •
         Opportunities" is a grey smudge, and the icon-only mark loses the name.
         One asset, one component: changing it here changes the desktop
         sidebar, the auth pages, the admin header and the rest together. */
      src="/brand/eventhub-logo-plain.png"
      alt="EventHub"
      className={cn("w-auto object-contain", onDark && "dark:brightness-[1.45] dark:saturate-[1.15]", className)}
      style={{ height: size }}
      draggable={false}
    />
  );
}
