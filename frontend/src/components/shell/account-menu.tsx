"use client";

/**
 * The account menu — one implementation, two hosts.
 *
 * Part 14 §1/§27 puts a profile/menu action in the phone's top bar, and the
 * desktop sidebar and bottom nav already had one. Three copies of "the menu
 * that opens from your avatar" is how a menu ends up with a Sign out in one
 * place and a Log out in another, so the whole thing lives here and every host
 * renders this component.
 *
 * It reads its own session, theme and unread state, which is why it can be
 * dropped anywhere without threading props through a shell.
 */

import Link from "next/link";
import {
  Archive,
  Bell,
  Bookmark,
  Heart,
  LayoutDashboard,
  LogOut,
  Moon,
  Search,
  Sun,
  Ticket,
  UserRound,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { UserAvatar } from "@/components/user-avatar";
import { useSessionUser } from "@/components/shell/use-session-user";
import { useLogout } from "@/components/shell/use-logout";
import { useTheme } from "@/context/ThemeContext";
import { cn } from "@/lib/utils";

/** The signed-in avatar (or a placeholder), always through the canonical crop. */
export function AccountAvatar({ size = 32, user }: { size?: number; user?: any }) {
  const { user: sessionUser } = useSessionUser();
  const u = user ?? sessionUser;
  if (u) return <UserAvatar user={u} size={size} alt="" />;
  return (
    <span
      className={cn("flex items-center justify-center rounded-full bg-muted text-muted-foreground")}
      style={{ width: size, height: size }}
    >
      <UserRound className="h-4 w-4" />
    </span>
  );
}

export function AccountMenu({ children }: { children: React.ReactNode }) {
  const { user, role } = useSessionUser();
  const { theme, toggleTheme } = useTheme();
  const logout = useLogout();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        {user && (
          <DropdownMenuLabel>
            <div className="text-sm font-bold">
              {user.firstName} {user.lastName}
            </div>
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
            <Ticket className="h-4 w-4" /> My events &amp; tickets
          </Link>
        </DropdownMenuItem>
        {/* The feed's top bar carries the bell, but that bar is feed-only — and
            the bottom nav is navigation, not notifications. Without this entry a
            phone could only reach /notifications from the feed. */}
        <DropdownMenuItem asChild className="gap-2.5 py-2.5">
          <Link href="/notifications">
            <Bell className="h-4 w-4" /> Notifications
          </Link>
        </DropdownMenuItem>
        {/* The three owner-only lists, reachable without opening your profile.
            They are different things — saved is a bookmark you made, liked is a
            reaction you gave, archive is your own post set aside — so they get
            three entries rather than one vague "My stuff". */}
        <DropdownMenuItem asChild className="gap-2.5 py-2.5">
          <Link href="/saved">
            <Bookmark className="h-4 w-4" /> Saved posts
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild className="gap-2.5 py-2.5">
          <Link href="/liked">
            <Heart className="h-4 w-4" /> Liked posts
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild className="gap-2.5 py-2.5">
          <Link href="/archived">
            <Archive className="h-4 w-4" /> Archive
          </Link>
        </DropdownMenuItem>
        {/* Search and the theme switch were top-bar controls. Both live here so
            neither needs a desktop to reach. */}
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
        <DropdownMenuItem onClick={logout} className="gap-2.5 py-2.5 text-destructive focus:text-destructive">
          <LogOut className="h-4 w-4" /> Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
