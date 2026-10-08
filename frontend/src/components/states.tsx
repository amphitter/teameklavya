"use client";

import { cn } from "@/lib/utils";
import { AlertCircle, CalendarSearch, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Page-level spinner */
export function PageLoader({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-muted-foreground">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-primary" />
      <p className="text-sm">{label}</p>
    </div>
  );
}

/** Intentional empty state with a clear explanation + optional CTA */
export function EmptyState({
  icon: Icon = CalendarSearch,
  title,
  description,
  action,
  actionLabel,
  onAction,
  className,
  compact = false,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: React.ReactNode;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
  /**
   * §96 — tighter proportions for an empty state that sits INSIDE a page which
   * already has a header (a profile tab). The default reserves ~220px, which
   * under a profile header read as "this page failed to load" rather than
   * "there is nothing here yet". Opt-in, so every other caller keeps the
   * original proportions.
   */
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/40 text-center",
        compact ? "px-4 py-8" : "px-6 py-14",
        className
      )}
    >
      <div
        className={cn(
          "flex items-center justify-center rounded-full bg-brand-light text-primary",
          compact ? "h-11 w-11" : "h-14 w-14"
        )}
      >
        <Icon className={compact ? "h-5 w-5" : "h-7 w-7"} />
      </div>
      <h3 className={cn("font-semibold text-foreground", compact ? "mt-3 text-sm" : "mt-4 text-base")}>{title}</h3>
      {description && (
        <p className={cn("max-w-sm text-muted-foreground", compact ? "mt-1 text-[13px]" : "mt-1.5 text-sm")}>
          {description}
        </p>
      )}
      {(action || actionLabel) && (
        <div className={compact ? "mt-3" : "mt-5"}>
          {action ?? (
            <Button size="sm" onClick={onAction}>
              {actionLabel}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/** Human-readable error state with retry */
export function ErrorState({
  title = "Something went wrong",
  description,
  onRetry,
  className,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-xl border border-destructive/20 bg-destructive/5 px-6 py-12 text-center",
        className
      )}
    >
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <AlertCircle className="h-7 w-7" />
      </div>
      <h3 className="mt-4 text-base font-semibold text-foreground">{title}</h3>
      {description && <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">{description}</p>}
      {onRetry && (
        <Button size="sm" variant="outline" className="mt-5" onClick={onRetry}>
          <RefreshCw className="mr-2 h-4 w-4" /> Try again
        </Button>
      )}
    </div>
  );
}

/** Skeleton block */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("shimmer rounded-lg", className)} />;
}

/** Event card skeleton for grids */
export function EventCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <Skeleton className="h-44 w-full rounded-none" />
      <div className="space-y-3 p-4">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-5 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
        <div className="flex gap-2 pt-2">
          <Skeleton className="h-8 flex-1" />
          <Skeleton className="h-8 flex-1" />
        </div>
      </div>
    </div>
  );
}
