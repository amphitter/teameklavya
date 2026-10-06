"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  BarChart3,
  Building2,
  CalendarDays,
  ExternalLink,
  LayoutDashboard,
  Plus,
  Users,
  Flag,
  ShieldAlert,
  ServerCog,
} from "lucide-react";
import { toast } from "sonner";
import { Logo } from "@/components/logo";
import { PageLoader } from "@/components/states";
import { cn } from "@/lib/utils";

const NAV = [
  { name: "Overview", href: "/admin/dashboard", icon: LayoutDashboard },
  { name: "Events", href: "/admin/events", icon: CalendarDays },
  { name: "Create Event", href: "/admin/events/create", icon: Plus },
  { name: "Communities", href: "/admin/organizations", icon: Building2 },
  { name: "Users", href: "/admin/users", icon: Users },
  { name: "Claims", href: "/admin/claims", icon: Flag },
  { name: "Moderation", href: "/admin/moderation", icon: ShieldAlert },
  { name: "Infrastructure", href: "/admin/infrastructure", icon: ServerCog },
];

/**
 * EventHub Organizer Dashboard shell.
 * Guards the whole /admin area client-side (UI behavior only —
 * the backend enforces authorization on every endpoint).
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [authState, setAuthState] = useState<"checking" | "ok">("checking");

  useEffect(() => {
    const token = localStorage.getItem("token");
    const role = localStorage.getItem("role");
    if (!token) {
      router.replace("/login?returnUrl=" + encodeURIComponent(pathname));
      return;
    }
    if (role !== "admin") {
      toast.error("Organizer access required");
      router.replace("/");
      return;
    }
    setAuthState("ok");
  }, [pathname, router]);

  if (authState === "checking") {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <PageLoader label="Checking access…" />
      </div>
    );
  }

  const isActive = (href: string) =>
    href === "/admin/dashboard"
      ? pathname === "/admin/dashboard"
      : href === "/admin/events"
        ? pathname.startsWith("/admin/events") && !pathname.includes("/create") && !pathname.includes("/edit")
        : pathname.startsWith(href);

  return (
    <div className="min-h-screen bg-muted/40">
      {/* ── Sidebar (desktop) ─────────────────────────── */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-border bg-card lg:flex">
        <div className="border-b border-border p-5">
          <Link href="/admin/dashboard" aria-label="EventHub Organizer">
            <Logo size={38} onDark />
          </Link>
          <p className="mt-2 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            Organizer
          </p>
        </div>
        <nav className="flex-1 space-y-1 p-3">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3.5 py-2.5 text-sm font-medium transition-colors",
                isActive(item.href)
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              <item.icon className="h-[18px] w-[18px]" />
              {item.name}
            </Link>
          ))}
        </nav>
        <div className="border-t border-border p-3">
          <Link
            href="/"
            className="flex items-center gap-3 rounded-lg px-3.5 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ExternalLink className="h-[18px] w-[18px]" /> View site
          </Link>
        </div>
      </aside>

      {/* ── Top bar (mobile) ──────────────────────────── */}
      <div className="sticky top-0 z-40 border-b border-border bg-card/95 backdrop-blur-md lg:hidden">
        <div className="flex items-center justify-between px-4 py-3">
          <Link href="/admin/dashboard">
            <Logo size={32} onDark />
          </Link>
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground"
          >
            <ExternalLink className="h-3.5 w-3.5" /> View site
          </Link>
        </div>
        <nav className="no-scrollbar flex gap-1 overflow-x-auto px-3 pb-3">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors",
                isActive(item.href)
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border text-muted-foreground"
              )}
            >
              <item.icon className="h-3.5 w-3.5" />
              {item.name}
            </Link>
          ))}
        </nav>
      </div>

      {/* ── Content ───────────────────────────────────── */}
      <main className="p-4 sm:p-6 lg:ml-60 lg:p-8">{children}</main>
    </div>
  );
}
