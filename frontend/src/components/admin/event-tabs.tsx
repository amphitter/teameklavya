"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { id: "", label: "Overview" },
  { id: "registrations", label: "Registrations" },
  { id: "communications", label: "Communications" },
  { id: "analytics", label: "Analytics" },
  { id: "activities", label: "Activities" },
  { id: "live", label: "Live" },
  { id: "quiz", label: "Quiz" },
];

/** Tab bar shared by the event management pages (Overview / Registrations / Analytics). */
export function EventTabs({ active }: { active: string }) {
  const { id } = useParams<{ id: string }>();
  const activeTab = useRef<HTMLAnchorElement | null>(null);

  useEffect(() => {
    // The tab row is a horizontal scroller on phones. Keep the current section
    // visible after a route change (including direct links to later tabs).
    activeTab.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active, id]);

  return (
    <nav aria-label="Event management sections" className="no-scrollbar flex w-full min-w-0 max-w-full gap-1.5 overflow-x-auto overscroll-x-contain rounded-full border border-border bg-card p-1">
      {TABS.map((t) => {
        const href = t.id ? `/admin/events/${id}/${t.id}` : `/admin/events/${id}`;
        const isActive = active === t.id;
        return (
          <Link
            key={t.id}
            href={href}
            aria-current={isActive ? "page" : undefined}
            ref={isActive ? activeTab : undefined}
            className={cn(
              "min-h-11 shrink-0 touch-manipulation rounded-full px-4 py-2 text-xs font-semibold transition-colors sm:text-sm",
              isActive
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
