"use client";

import { SearchBar } from "@/components/search/search-bar";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Bell,
  Building2,
  CalendarDays,
  ChevronUp,
  Clock3,
  Compass,
  Home,
  LayoutDashboard,
  LogOut,
  MessageCircle,
  Moon,
  Newspaper,
  Plus,
  Search,
  Sparkles,
  Sun,
  Ticket,
  UserRound,
  Archive,
  Bookmark,
  Heart,
  UsersRound,
} from "lucide-react";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ThemeToggle } from "@/components/shell/theme-toggle";
import { useTheme } from "@/context/ThemeContext";
import { prefetchInbox, useUnread } from "@/hooks/use-messages";
import { initialsOf, useSessionUser } from "@/components/shell/use-session-user";
import { useLogout } from "@/components/shell/use-logout";
import { AccountMenu, AccountAvatar } from "@/components/shell/account-menu";
import { cn } from "@/lib/utils";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { ComposerProvider, useComposer } from "@/components/post/composer-provider";
import { MessagesNavLink } from "@/components/shell/messages-link";
import { UserAvatar } from "@/components/user-avatar";
import { api } from "@/utils/api";

/* ──────────────────────────────────────────────────────────
   EventHub social application shell
   Desktop: left sidebar + top search bar
   Mobile:  top bar + bottom navigation
   Only links with real routes are enabled — unbuilt areas
   surface an honest "coming soon" state.
   ────────────────────────────────────────────────────────── */

type NavItem = {
  name: string;
  href: string | null;
  icon: React.ComponentType<{ className?: string }>;
  exact?: boolean;
};

const MAIN_NAV: NavItem[] = [
  { name: "Home", href: "/", icon: Home, exact: true },
  { name: "Explore", href: "/explore", icon: Compass },
  { name: "Events", href: "/events", icon: CalendarDays },
  { name: "Communities", href: "/communities", icon: UsersRound },
  { name: "Messages", href: "/messages", icon: MessageCircle },
  { name: "Notifications", href: "/notifications", icon: Bell },
];

const MY_EVENTS_NAV = [
  { name: "Upcoming", href: "/user/registrations?tab=upcoming", icon: CalendarDays, match: "/user/registrations" },
  { name: "Past", href: "/user/registrations?tab=past", icon: Clock3, match: "/user/registrations" },
];


/**
 * The composer is hosted here, inside the shell, so every route that renders the
 * shell can open it — feed, messages, profile, communities, events. A surface
 * that did not want it simply is not inside the shell.
 */
export default function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <ComposerProvider>
      <ShellChrome>{children}</ShellChrome>
    </ComposerProvider>
  );
}

function ShellChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  /* Part 10 — /messages needs the shell to step aside (see the <main> and
   * <nav> comments below). Two distinct flags, because the inbox and an open
   * conversation need different treatment: the inbox keeps the bottom nav,
   * the conversation hides it. */
  const isMessagesRoute = pathname?.startsWith("/messages") ?? false;
  const isChatRoute = /^\/messages\/[^/]+$/.test(pathname ?? "");
  const router = useRouter();
  const { user, role } = useSessionUser();
  const { open: openComposer, openStory } = useComposer();
  /* The bottom nav carries the messages badge on mobile, the account menu
     carries the theme switch — both used to live in the top bar, which is gone
     below lg. Read here (not inside `AccountMenu`, which is re-created on every
     render) so the values stay stable. */
  const { inbox: unreadMessages } = useUnread();
  const { theme, toggleTheme } = useTheme();

  /* Wake the API as soon as the app boots.
   *
   * The backend is hosted on Render, which suspends an idle instance; the
   * first request after a quiet period waits for a cold start. That delay was
   * landing on the user's first tap — opening Messages, of all things, which
   * is exactly where "chats load slowly" was reported. Pinging a cheap
   * endpoint while the user looks at the home screen means the instance is
   * usually warm before any real request is made.
   *
   * Deliberately once per page load, silent, and non-blocking. If it fails,
   * nothing is reported — the real request will surface any genuine problem. */
  useEffect(() => {
    api.get("/health").catch(() => {});
  }, []);
    const [communities, setCommunities] = useState<{ _id: string; name: string; slug: string; logoUrl?: string }[]>([]);

  // Communities = organizations the user follows (real follows only)
  useEffect(() => {
    const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
    if (!token) {
      setCommunities([]);
      return;
    }
    api
      .get("/organizations/mine/followed")
      .then((res) => setCommunities(res.data?.organizations || []))
      .catch(() => setCommunities([]));
  }, [user, pathname]);

  const handleCreateEvent = () => {
    if (!role) {
      router.push("/login?returnUrl=%2Fadmin%2Fevents%2Fcreate");
      return;
    }
    if (role === "admin") {
      router.push("/admin/events/create");
    } else {
      toast.info("Organizer access is required to create events.", {
        description: "Ask the EventHub team to upgrade your account.",
      });
    }
  };

  /* Sign-out lives in one hook — the account menu and Settings must not be two
     different sign-outs (§13). The cache-clearing order is explained there. */
  const handleLogout = useLogout();

  const isActive = (item: NavItem) =>
    item.exact ? pathname === "/" : Boolean(item.href && pathname.startsWith(item.href));

  /* ── Create menu (shared by top bar + mobile nav) ─────── */
  /* §1–§3, §31 — the "+" menu, anchored deterministically.
   *
   * What was wrong: the menu left its side to Radix's default (`side="bottom"`)
   * and `align="end"`. In the bottom nav that meant it first tried to open
   * BELOW a button that sits on the bottom edge of the screen, then flipped —
   * the "appears to move/disappear" the report describes is that flip, happening
   * after the user has already seen the menu. `align="end"` also pinned the
   * menu's right edge to a button that is centred in a five-column grid, so on a
   * narrow phone it ran off to the side.
   *
   * Now the placement is explicit per host: above the button in the bottom nav
   * (aligned to its centre), below it in the desktop top bar, with a collision
   * padding so it can never touch the viewport edge on a 320px screen.
   * One click opens, the same click closes, outside closes, Escape closes —
   * all Radix behaviour, and none of it re-implemented by hand. */
  const CreateMenu = ({
    children,
    placement = "bottom",
    align = "end",
  }: {
    children: React.ReactNode;
    placement?: "top" | "bottom";
    align?: "start" | "center" | "end";
  }) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent
        side={placement}
        align={align}
        sideOffset={10}
        collisionPadding={8}
        className="w-52"
      >
        <DropdownMenuItem onClick={handleCreateEvent} className="gap-2.5 py-2.5">
          <Sparkles className="h-4 w-4 text-primary" />
          <div>
            <div className="text-sm font-semibold">Create Event</div>
            <div className="text-[11px] text-muted-foreground">Set up a new event</div>
          </div>
        </DropdownMenuItem>
        {/* §4/§7 — opens the composer as an overlay in the current page. It used
            to `router.push("/?compose=1")`, which navigated you to the feed and
            discarded your context: from Messages you lost the conversation, from
            a profile you lost the profile. */}
        <DropdownMenuItem onClick={openComposer} className="gap-2.5 py-2.5">
          <Newspaper className="h-4 w-4 text-muted-foreground" />
          <div>
            <div className="text-sm font-semibold">Create Post</div>
            <div className="text-[11px] text-muted-foreground">Share something with your followers</div>
          </div>
        </DropdownMenuItem>

        {/* §41 + Part 9 §14 — the story creator opens IN PLACE. It used to route
            to /?story=1, which navigated the user to the feed and lost their
            context; the creator is hosted by the shell now, so it opens over
            whatever page they were on. The device decides what they get: the
            editor on a phone, an honest explanation on a desktop. */}
        <DropdownMenuItem onClick={openStory} className="gap-2.5 py-2.5">
          <span className="material-symbols-outlined text-[18px] leading-none text-foreground">add_photo_alternate</span>
          <div>
            <div className="text-sm font-semibold">Create Story</div>
            <div className="text-[11px] text-muted-foreground">Post a 9:16 photo or video for 24 hours</div>
          </div>
        </DropdownMenuItem>

        <DropdownMenuItem onClick={() => router.push("/communities")} className="gap-2.5 py-2.5">
          <UsersRound className="h-4 w-4 text-muted-foreground" />
          <div>
            <div className="text-sm font-semibold">Create Community</div>
            <div className="text-[11px] text-muted-foreground">Start a space for your people</div>
          </div>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    /* `min-h-screen` is `min-height: 100vh` — and on a phone `100vh` is the
       viewport WITH the browser's toolbars hidden, i.e. TALLER than what the
       user can actually see. Every route whose content is exactly one visible
       viewport tall (the conversation page is `h-[100dvh]`) was therefore
       inside a box with a 100vh minimum: the document grew taller than the
       screen, the page itself became scrollable, and the chat composer could
       be pushed below the fold — the "chat doesn't fit the viewport" symptom.
       `min-h-[100dvh]` tracks the dynamic viewport instead, so the minimum
       matches the visible area. `min-h-screen` stays as the first declaration
       as the fallback for engines without `dvh`; on desktop the two are
       identical, so nothing changes there. */
    <div className="min-h-screen min-h-[100dvh] bg-background">
      {/* ══ Desktop sidebar ═════════════════════════════════ */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-border bg-card lg:flex">
        <div className="flex h-14 items-center border-b border-border px-5">
          <Link href="/" aria-label="EventHub home">
            <Logo size={40} onDark />
          </Link>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4">
          <ul className="space-y-0.5">
            {MAIN_NAV.map((item) => (
              <li key={item.name}>
                <Link
                  href={item.href!}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3.5 py-2.5 text-sm font-medium transition-colors",
                    isActive(item)
                      ? "bg-primary/10 font-semibold text-primary"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  <item.icon className="h-[18px] w-[18px]" />
                  {item.name}
                </Link>
              </li>
            ))}
          </ul>

          {/* MY EVENTS */}
          <p className="mb-1.5 mt-6 px-3.5 text-[11px] font-bold uppercase tracking-widest text-muted-foreground/70">
            My events
          </p>
          <ul className="space-y-0.5">
            {MY_EVENTS_NAV.map((item) => (
              <li key={item.name}>
                <Link
                  href={item.href}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3.5 py-2 text-[13px] font-medium transition-colors",
                    pathname.startsWith(item.match)
                      ? "bg-primary/10 font-semibold text-primary"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  <item.icon className="h-4 w-4" />
                  {item.name}
                </Link>
              </li>
            ))}
          </ul>

          {/* COMMUNITIES — only real follows */}
          {communities.length > 0 && (
            <>
              <p className="mb-1.5 mt-6 px-3.5 text-[11px] font-bold uppercase tracking-widest text-muted-foreground/70">
                Communities
              </p>
              <ul className="space-y-0.5">
                {communities.slice(0, 4).map((org) => (
                  <li key={org._id}>
                    <Link
                      href={`/organizations/${org.slug}`}
                      className={cn(
                        "flex items-center gap-3 rounded-lg px-3.5 py-2 text-[13px] font-medium transition-colors",
                        pathname === `/organizations/${org.slug}`
                          ? "bg-primary/10 font-semibold text-primary"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground"
                      )}
                    >
                      {org.logoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={org.logoUrl} alt="" className="h-6 w-6 rounded-md object-cover" />
                      ) : (
                        <Building2 className="h-4 w-4" />
                      )}
                      <span className="truncate">{org.name}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </nav>

        {/* Account */}
        <div className="border-t border-border p-3">
          {user ? (
            <AccountMenu>
              <button
                type="button"
                className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-muted"
              >
                <AccountAvatar />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-foreground">
                    {user.firstName} {user.lastName}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    @{user.username || user.email?.split("@")[0]}
                  </span>
                </span>
                <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" />
              </button>
            </AccountMenu>
          ) : (
            <div className="flex gap-2">
              <Button asChild variant="outline" size="sm" className="flex-1">
                <Link href="/login">Sign in</Link>
              </Button>
              <Button asChild size="sm" className="flex-1">
                <Link href="/signup">Join</Link>
              </Button>
            </div>
          )}
        </div>
      </aside>

      {/* ══ Content column ══════════════════════════════════ */}
      <div className="lg:pl-60">
        {/* Top bar */}
        {/* ── Top bar — DESKTOP ONLY (lg and up) ──────────────────────────
         * On a phone this 56px row + the page's own header stacked into
         * ~110px of chrome above every screen, and on an open conversation it
         * pushed the composer down. Every control it held is reachable on
         * mobile without it:
         *   Messages      → bottom nav item, with its unread badge
         *   Notifications → the home header's bell (phone), this bar (desktop)
         *   Create        → the bottom nav's create button
         *   Search        → bottom nav item (the feed's own field was removed
         *                   in Part 14 §9), with trending on /search
         *   Theme         → the account menu
         *   Profile       → the bottom nav's Profile
         * Nothing is orphaned by removing it, which is the only reason this
         * is safe to do. */}
        <header className="sticky top-0 z-30 hidden border-b border-border bg-background/85 backdrop-blur-md lg:block">
          <div className="flex h-14 items-center gap-3 px-4 sm:px-6">
            {/* Mobile: logo */}
            <Link href="/" aria-label="EventHub home" className="lg:hidden">
              <Logo size={32} onDark />
            </Link>

            {/* Global search (Phase 11) — live dropdown + full page */}
            <SearchBar />

            <div className="ml-auto flex items-center gap-1 sm:ml-0">
              <MessagesNavLink />
              <NotificationBell />
              <ThemeToggle />

              <CreateMenu>
                <Button size="sm" className="ml-1 hidden gap-1.5 sm:inline-flex">
                  <Plus className="h-4 w-4" /> Create
                </Button>
              </CreateMenu>

              {/* Mobile search link */}
              <Link
                href="/search"
                aria-label="Search EventHub"
                className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:hidden"
              >
                <Search className="h-5 w-5" />
              </Link>

              {/* Account (desktop) */}
              <div className="hidden lg:block">
                <AccountMenu>
                  <button
                    type="button"
                    aria-label="Account menu"
                    className="ml-1 rounded-full ring-offset-2 transition-all hover:ring-2 hover:ring-primary/40"
                  >
                    <AccountAvatar />
                  </button>
                </AccountMenu>
              </div>
            </div>
          </div>
        </header>

        {/* Part 10 §2, §30 — Messages owns its own viewport maths.
         *
         * Every other page is a document that scrolls, so the shell reserves
         * bottom space for the fixed nav and the document flows past it. A
         * chat cannot work that way: its composer must sit at the bottom of
         * the screen, and any reserved padding puts it below the fold. So on
         * /messages the shell contributes NO padding and the page computes
         * its own height against the real viewport. */}
        <main className={cn(isMessagesRoute ? "pb-0" : "pb-[calc(4.5rem+env(safe-area-inset-bottom))] sm:pb-10 lg:pb-12")}>
          {children}
        </main>
      </div>

      {/* ══ Mobile bottom navigation ═══════════════════════ */}
      <nav
        aria-label="Primary"
        /* Inside an open conversation the nav is hidden: the composer needs
           the bottom edge of the screen, and Back is the way out (§30). On
           the inbox it stays, so the five destinations are always one tap
           away (§32). */
        className={cn(
          "fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 backdrop-blur-md",
          isChatRoute ? "hidden" : "lg:hidden"
        )}
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {/* Five destinations. The bell used to sit here as a sixth item labelled
            "Alerts"; it is now in the phone header next to the greeting, where a
            notification indicator belongs — one tap from the top of the screen,
            leaving the bottom row to navigation only. */}
        <div className="grid grid-cols-5">
          <MobileNavItem icon={Home} label="Home" href="/" active={pathname === "/"} />
          {/* §4/§28 — the second slot is SEARCH (trending + search), not
              Explore. Explore is EVENT discovery and now lives in the phone's
              top bar, so the two concepts never share a button. */}
          <MobileNavItem
            icon={Search}
            label="Search"
            href="/search"
            active={pathname.startsWith("/search")}
          />

          {/* Create — visually strongest */}
          <div className="relative flex items-end justify-center pb-1">
            <CreateMenu placement="top" align="center">
              <button
                type="button"
                aria-label="Create"
                className="-mt-6 flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-[#0070f0] to-[#5030f0] text-white shadow-lg shadow-primary/30 transition-transform active:scale-95"
              >
                <Plus className="h-6 w-6" />
              </button>
            </CreateMenu>
          </div>

          {/* Messages moved into the nav: it was a top-bar icon, and the top
              bar no longer exists on a phone. Prefetching the inbox on tap is
              the same warm-start path the old icon used. */}
          <Link
            href="/messages"
            aria-label={unreadMessages ? `Messages (${unreadMessages} unread)` : "Messages"}
            onClick={() => prefetchInbox()}
            className={cn(
              "relative flex min-w-0 flex-col items-center justify-center gap-0.5 pb-1.5 pt-2 transition-colors",
              pathname.startsWith("/messages") ? "text-primary" : "text-muted-foreground"
            )}
          >
            <MessageCircle className="h-5 w-5" />
            <span className="max-w-full truncate px-0.5 text-[10px] font-semibold">Messages</span>
            {unreadMessages > 0 ? (
              <span className="absolute right-2 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-bold leading-none text-white">
                {unreadMessages > 9 ? "9+" : unreadMessages}
              </span>
            ) : null}
          </Link>

          {user ? (
            <AccountMenu>
              <button
                type="button"
                aria-label="Profile"
                className={cn(
                  "flex flex-col items-center justify-center gap-0.5 pb-1.5 pt-2",
                  pathname.startsWith("/user") ? "text-primary" : "text-muted-foreground"
                )}
              >
                <AccountAvatar size={22} />
                <span className="text-[10px] font-semibold">Profile</span>
              </button>
            </AccountMenu>
          ) : (
            <MobileNavItem icon={UserRound} label="Sign in" href="/login" active={false} />
          )}
        </div>
      </nav>
    </div>
  );
}

function MobileNavItem({
  icon: Icon,
  label,
  href,
  active,
  soon,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  href?: string;
  active: boolean;
  soon?: boolean;
  onClick?: () => void;
}) {
  const inner = (
    <>
      <Icon className="h-5 w-5" />
      {/* Six destinations on a 320px screen is ~53px each, so a long label
          must truncate rather than widen its cell and push the row out. */}
      <span className="max-w-full truncate px-0.5 text-[10px] font-semibold">{label}</span>
      {soon && <span className="absolute right-3 top-1.5 h-1.5 w-1.5 rounded-full bg-primary/70" />}
    </>
  );

  if (soon || !href) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "relative flex flex-col items-center justify-center gap-0.5 pb-1.5 pt-2 text-muted-foreground",
          soon && "opacity-80"
        )}
      >
        {inner}
      </button>
    );
  }

  return (
    <Link
      href={href}
      className={cn(
        "relative flex flex-col items-center justify-center gap-0.5 pb-1.5 pt-2 transition-colors",
        active ? "text-primary" : "text-muted-foreground"
      )}
    >
      {inner}
    </Link>
  );
}
