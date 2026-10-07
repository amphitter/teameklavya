"use client";

import Link from "next/link";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { useSessionUser } from "@/components/shell/use-session-user";

/**
 * Feed top bar — the logo, centred, with the notification bell in the right
 * corner. Phones only, and only on the news feed.
 *
 * Why it lives here rather than in the shell: the shell's own top bar is
 * desktop-only, and the rest of the app (Explore, a profile, a community) is
 * built around its page heading — adding a second bar above every screen would
 * stack two headers on top of each other and cost the composer its space on a
 * small phone. The feed is the one screen that has no heading of its own to
 * carry the branding, and the one place the app is "home".
 *
 * The mark is `/brand/eventhub-logo-plain.png` — the official lockup WITHOUT the
 * "People • Events • Opportunities" tagline. The tagline version is unreadable at
 * 28px, and the icon-only version loses the name; this asset is the same
 * official artwork the user supplied, trimmed to its content and exported at
 * 128px tall so it stays crisp on a 4x screen.
 *
 * The bell is the real component, not a link that looks like one: it carries the
 * unread badge and opens the notification dropdown. It polls only while this bar
 * is mounted, which is only on the feed — less background work than the bottom
 * nav's old always-on item.
 */
export function FeedTopBar() {
  const { user, ready } = useSessionUser();

  return (
    <header
      /* Sticky, inside the feed's own column, so it never affects any other
         route. `pt-safe` keeps the bar clear of a notch, matching the bottom
         nav's handling of the other edge. */
      className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur-md lg:hidden"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <div className="relative flex h-14 items-center justify-center px-3 sm:px-6">
        <Link href="/" aria-label="EventHub home" className="flex items-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand/eventhub-logo-plain.png"
            alt="EventHub"
            width={488}
            height={128}
            className="h-7 w-auto select-none"
            draggable={false}
          />
        </Link>

        {/* Absolutely positioned so the logo is centred in the bar, not in the
            space the bell leaves over. */}
        {ready && user ? (
          <div className="absolute right-1.5 top-1/2 -translate-y-1/2 sm:right-4">
            <NotificationBell />
          </div>
        ) : null}
      </div>
    </header>
  );
}
