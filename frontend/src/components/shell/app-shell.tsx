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
  Bookmark,
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
import { resetMessagesStore } from "@/lib/messages/store";
import { clearMessagesCache } from "@/lib/messages/cache";
import { resetSocket } from "@/lib/socket";
import { cn } from "@/lib/utils";
import { NotificationBell, NotificationsNavLink } from "@/components/notifications/notification-bell";
import { MessagesNavLink } from "@/components/shell/messages-link";
import { getImageUrl } from "@/utils/image";
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


export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  /* Part 10 — /messages needs the shell to step aside (see the <main> and
   * <nav> comments below). Two distinct flags, because the inbox and an open
   * conversation need different treatment: the inbox keeps the bottom nav,
   * the conversation hides it. */
  const isMessagesRoute = pathname?.startsWith("/messages") ?? false;
  const isChatRoute = /^\/messages\/[^/]+$/.test(pathname ?? "");
  const router = useRouter();
  const { user, role } = useSessionUser();
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

  const handleLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("role");
    localStorage.removeItem("user");
    /* Part 10 §23 — the messages store and its IndexedDB cache hold this
     * user's conversations. Left in place, the next account to sign in on
     * this device would paint them for a frame before its own loaded: a
     * privacy leak, not a cosmetic bug. Both are cleared here, and the
     * socket is dropped so the new session reconnects with its own token. */
    resetMessagesStore();
    void clearMessagesCache();
    resetSocket();
    toast.success("Logged out");
    router.push("/");
    router.refresh();
  };

  const isActive = (item: NavItem) =>
    item.exact ? pathname === "/" : Boolean(item.href && pathname.startsWith(item.href));

  const avatar = user?.profile?.avatar || (user as any)?.avatar;

  const UserAvatar = ({ size = 32 }: { size?: number }) =>
    avatar ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={getImageUrl(avatar)}
        alt=""
        width={size}
        height={size}
        className="rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    ) : (
      <span
        className={cn(
          "flex items-center justify-center rounded-full bg-brand-light text-xs font-bold text-primary",
          !user && "bg-muted text-muted-foreground"
        )}
        style={{ width: size, height: size }}
      >
        {user ? initialsOf(user) : <UserRound className="h-4 w-4" />}
      </span>
    );

  /* ── Create menu (shared by top bar + mobile nav) ─────── */
  const CreateMenu = ({ children }: { children: React.ReactNode }) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem onClick={handleCreateEvent} className="gap-2.5 py-2.5">
          <Sparkles className="h-4 w-4 text-primary" />
          <div>
            <div className="text-sm font-semibold">Create Event</div>
            <div className="text-[11px] text-muted-foreground">Set up a new event</div>
          </div>
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => router.push("/?compose=1")}
          className="gap-2.5 py-2.5"
        >
          <Newspaper className="h-4 w-4 text-muted-foreground" />
          <div>
            <div className="text-sm font-semibold">Create Post</div>
            <div className="text-[11px] text-muted-foreground">Share something with your followers</div>
          </div>
        </DropdownMenuItem>

        {/* §41 — Story belongs in the create sheet now that stories exist.
            Routed with ?story=1; the feed owns the composer so it can
            refetch the rail after a publish. */}
        <DropdownMenuItem onClick={() => router.push("/?story=1")} className="gap-2.5 py-2.5">
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

  /* ── Account menu ─────────────────────────────────────── */
  const AccountMenu = ({ children }: { children: React.ReactNode }) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        {user && (
          <DropdownMenuLabel>
            <div className="text-sm font-bold">{user.firstName} {user.lastName}</div>
            <div className="text-xs font-normal text-muted-foreground">{user.email}</div>
          </DropdownMenuLabel>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild className="gap-2.5 py-2.5">
          <Link href="/user/profile">
            <UserRound className="h-4 w-4" /> Profile
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild className="gap-2.5 py-2.5">
          <Link href="/user/registrations">
            <Ticket className="h-4 w-4" /> My events & tickets
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild className="gap-2.5 py-2.5">
          <Link href="/saved">
            <Bookmark className="h-4 w-4" /> Saved posts
          </Link>
        </DropdownMenuItem>
        {/* Search and the theme switch were top-bar controls. The top bar is
            desktop-only now, so both live here — otherwise turning the theme
            back to light would need a desktop. */}
        <DropdownMenuItem asChild className="gap-2.5 py-2.5">
          <Link href="/search">
            <Search className="h-4 w-4" /> Search
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={toggleTheme} className="gap-2.5 py-2.5">
          {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          {theme === "dark" ? "Light mode" : "Dark mode"}
        </DropdownMenuItem>
        {role === "admin" && (
          <DropdownMenuItem asChild className="gap-2.5 py-2.5">
            <Link href="/admin/dashboard">
              <LayoutDashboard className="h-4 w-4" /> Organizer dashboard
            </Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleLogout} className="gap-2.5 py-2.5 text-destructive focus:text-destructive">
          <LogOut className="h-4 w-4" /> Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <div className="min-h-screen bg-background">
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
                <UserAvatar />
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
         *   Notifications → bottom nav "Alerts"
         *   Create        → the bottom nav's create button
         *   Search        → the feed's own search field, and the account menu
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
                    <UserAvatar />
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
        <div className="grid grid-cols-6">
          <MobileNavItem icon={Home} label="Home" href="/" active={pathname === "/"} />
          <MobileNavItem icon={Compass} label="Explore" href="/events" active={pathname.startsWith("/events")} />

          {/* Create — visually strongest */}
          <div className="relative flex items-end justify-center pb-1">
            <CreateMenu>
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

          <NotificationsNavLink active={pathname.startsWith("/notifications")} />
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
                <UserAvatar size={22} />
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
