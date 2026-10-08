"use client";

import Link from "next/link";
import { Compass } from "lucide-react";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { useSessionUser } from "@/components/shell/use-session-user";
import { AccountAvatar, AccountMenu } from "@/components/shell/account-menu";

/**
 * Feed top bar — phones only, on the news feed.
 *
 *   [Explore]        EventHub        [🔔] [avatar]
 *
 * Part 14 §1/§27: the three zones are deliberately different things and must
 * not be confused:
 *
 *   LEFT   Explore → /explore, EVENT DISCOVERY only (§2). It is the one icon
 *          that leads to "find something to attend", and it is where a phone
 *          user reaches events, because the bottom row's second slot is now
 *          Search.
 *   CENTRE the EventHub lockup, opening the feed.
 *   RIGHT  notifications, then the account menu — the same two the bottom nav
 *          used to split between a nav item and a profile button. Account is
 *          still in the bottom nav (it is a destination); this is the quick
 *          menu, and both read the same session.
 *
 * Why it lives here rather than in the shell: the shell's own top bar is
 * desktop-only, and the rest of the app is built around its page heading —
 * adding a second bar above every screen would stack two headers and cost the
 * composer its space on a small phone. The feed is the one screen that has no
 * heading of its own to carry the branding, and the one place the app is
 * "home".
 *
 * The mark is `/brand/eventhub-logo-plain.png` — the official lockup WITHOUT the
 * "People • Events • Opportunities" tagline, which is unreadable at 28px.
 */
export function FeedTopBar() {
  const { user, ready } = useSessionUser();

  return (
    <header
      /* Sticky, inside the feed's own column, so it never affects any other
         route. `pt-safe` keeps the bar clear of a notch, matching the bottom
         nav's handling of the other edge. The hook is what the QA harness
         identifies this bar by — the mark alone also matches the desktop nav. */
      className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur-md lg:hidden"
      data-feed-top-bar=""
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <div className="relative flex h-14 items-center justify-between gap-1 px-2 sm:px-4">
        {/* LEFT — Explore (events). 44px target, label rendered for screen
            readers rather than squeezed onto a 320px bar. */}
        {ready && user ? (
          <Link
            href="/explore"
            aria-label="Explore events"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-95"
          >
            <Compass className="h-[22px] w-[22px]" />
          </Link>
        ) : (
          <span className="h-11 w-11 shrink-0" aria-hidden />
        )}

        {/* CENTRE — the logo, centred on the BAR, not on the leftover space.
            Measured at 320px: the left control is 44px and the right pair is
            88px, so centring inside the flexible middle put the mark 22px left
            of the true centre — off by more than the logo's own dot. Absolute
            centring is only safe because the mark is small: it occupies
            ~107px, so even at 320px it spans 106–213 while the right pair
            begins at 232. `pointer-events` stays enabled — it is a real link. */}
        <Link
          href="/"
          aria-label="EventHub home"
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand/eventhub-logo-plain.png"
            alt="EventHub"
            width={488}
            height={128}
            className="h-7 w-auto max-w-full select-none"
            draggable={false}
          />
        </Link>

        {/* RIGHT — notifications + account menu. */}
        {ready && user ? (
          <div className="flex shrink-0 items-center">
            <NotificationBell />
            <AccountMenu>
              <button
                type="button"
                aria-label="Account menu"
                className="ml-0.5 flex h-11 w-11 items-center justify-center rounded-xl transition-colors hover:bg-muted active:scale-95"
              >
                <AccountAvatar size={26} />
              </button>
            </AccountMenu>
          </div>
        ) : (
          <Link
            href="/login"
            className="flex h-11 shrink-0 items-center rounded-xl px-3 text-[13px] font-bold text-primary"
          >
            Sign in
          </Link>
        )}
      </div>
    </header>
  );
}
