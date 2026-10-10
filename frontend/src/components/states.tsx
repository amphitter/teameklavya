"use client";

import { cn } from "@/lib/utils";
import { AlertCircle, CalendarSearch, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export function PageLoader({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-muted-foreground dark:text-[#71717a]">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-border dark:border-[#232326] border-t-primary dark:border-t-[#3b82f6]" />
      <p className="text-[13px]">{label}</p>
    </div>
  );
}

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
  compact?: boolean;
}) {
  if (compact) {
    return (
      <div
        className={cn(
          "flex flex-col items-center justify-center rounded-[12px] border border-dashed bg-card px-4 py-6 text-center dark:border-[#232326] dark:bg-[#121214]",
          className
        )}
      >
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-primary" />
          <h3 className="text-[13px] font-semibold text-foreground dark:text-white">{title}</h3>
        </div>
        {description && <p className="mt-1.5 max-w-sm text-[12px] text-muted-foreground dark:text-[#71717a]">{description}</p>}
        {(action || actionLabel) && (
          <div className="mt-3">
            {action ?? (
              <Button size="sm" onClick={onAction} className="h-8 rounded-[8px] bg-primary text-primary-foreground">
                {actionLabel}
              </Button>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-[12px] border border-dashed bg-card px-6 py-14 text-center dark:border-[#232326] dark:bg-[#121214]",
        className
      )}
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-[12px] bg-muted text-primary border border-border dark:bg-[#1f1f23] dark:text-[#3b82f6] dark:border-[#232326]">
        <Icon className="h-6 w-6" />
      </div>
      <h3 className="mt-4 text-[14px] font-semibold text-foreground dark:text-white">{title}</h3>
      {description && <p className="mt-1.5 max-w-sm text-[13px] text-muted-foreground dark:text-[#71717a]">{description}</p>}
      {(action || actionLabel) && (
        <div className="mt-5">
          {action ?? (
            <Button size="sm" onClick={onAction} className="h-8 rounded-[8px] bg-primary text-primary-foreground">
              {actionLabel}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

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
        "flex flex-col items-center justify-center rounded-[12px] border border-destructive/20 bg-destructive/5 px-6 py-12 text-center dark:border-[#ef4444]/20 dark:bg-[#1a0f0f]",
        className
      )}
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-[12px] bg-destructive/10 text-destructive border border-destructive/20">
        <AlertCircle className="h-6 w-6" />
      </div>
      <h3 className="mt-4 text-[14px] font-semibold text-foreground dark:text-white">{title}</h3>
      {description && <p className="mt-1.5 max-w-sm text-[13px] text-muted-foreground dark:text-[#a1a1aa]">{description}</p>}
      {onRetry && (
        <Button size="sm" variant="outline" className="mt-5 h-8 rounded-[8px]" onClick={onRetry}>
          <RefreshCw className="mr-2 h-4 w-4" /> Try again
        </Button>
      )}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("shimmer rounded-[10px] bg-muted dark:bg-[#1f1f23]", className)} />;
}

export function EventCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-[12px] border bg-card dark:border-[#1f1f23] dark:bg-[#121214]">
      <Skeleton className="h-44 w-full rounded-none" />
      <div className="space-y-3 p-4">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
        <div className="flex gap-2 pt-2">
          <Skeleton className="h-7 flex-1" />
          <Skeleton className="h-7 flex-1" />
        </div>
      </div>
    </div>
  );
}
