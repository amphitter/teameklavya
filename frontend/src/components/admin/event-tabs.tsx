"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { id: "", label: "Overview" },
  { id: "registrations", label: "Registrations" },
  { id: "analytics", label: "Analytics" },
  { id: "activities", label: "Activities" },
  { id: "live", label: "Live" },
  { id: "quiz", label: "Quiz" },
];

/** Tab bar shared by the event management pages (Overview / Registrations / Analytics). */
export function EventTabs({ active }: { active: string }) {
  const { id } = useParams<{ id: string }>();

  return (
    <div className="no-scrollbar flex gap-1.5 overflow-x-auto rounded-full border border-border bg-card p-1 sm:w-fit">
      {TABS.map((t) => {
        const href = t.id ? `/admin/events/${id}/${t.id}` : `/admin/events/${id}`;
        return (
          <Link
            key={t.id}
            href={href}
            className={cn(
              "shrink-0 rounded-full px-4 py-2 text-xs font-semibold transition-colors sm:text-sm",
              active === t.id
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
