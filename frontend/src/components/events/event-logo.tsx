"use client";

import { CalendarDays } from "lucide-react";
import { OptimizedImage } from "@/components/ui/optimized-image";
import { getImageUrl } from "@/utils/image";
import { cn } from "@/lib/utils";

/** Event-owned square mark. It deliberately does not fall back to an
 * associated Organization/Community logo: association is not ownership, and
 * legacy Events without their own logo get a neutral calendar mark. */
export function EventLogo({
  logoUrl,
  title,
  className,
}: {
  logoUrl?: string | null;
  title: string;
  className?: string;
}) {
  const src = getImageUrl(logoUrl);
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-muted",
        className
      )}
      aria-label={src ? `${title} logo` : `${title} event`}
      role="img"
    >
      {src ? (
        <OptimizedImage
          src={src}
          alt=""
          preset="logo"
          size="small"
          sizes="64px"
          className="h-full w-full object-cover"
          style={{ height: "100%" }}
        />
      ) : (
        <CalendarDays aria-hidden="true" className="h-1/2 w-1/2 text-primary/55" />
      )}
    </span>
  );
}
