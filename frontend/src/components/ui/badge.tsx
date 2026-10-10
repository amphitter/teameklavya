import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium tracking-tight transition-colors focus:outline-none",
  {
    variants: {
      variant: {
        default: "border-border bg-muted text-muted-foreground dark:border-[#2a2a30] dark:bg-[#1f1f23] dark:text-[#e4e4e7]",
        secondary: "border-border bg-secondary text-secondary-foreground dark:border-[#232326] dark:bg-[#18181b] dark:text-[#a1a1aa]",
        destructive: "border-destructive/30 bg-destructive/10 text-destructive dark:border-[#7f1d1d]/30 dark:bg-[#450a0a]/50 dark:text-[#fca5a5]",
        outline: "text-muted-foreground border-border bg-transparent dark:text-[#a1a1aa] dark:border-[#232326]",
        success: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-[#065f46]/30 dark:bg-[#052e1f]/80 dark:text-[#6ee7b7]",
        warning: "border-amber-200 bg-amber-50 text-amber-700 dark:border-[#92400e]/30 dark:bg-[#2a1e05]/80 dark:text-[#fcd34d]",
        info: "border-blue-200 bg-blue-50 text-blue-700 dark:border-[#1e40af]/30 dark:bg-[#1e293b]/80 dark:text-[#93c5fd]",
        premium: "border-[#3b82f6]/20 bg-[#3b82f6]/10 text-[#3b82f6] dark:text-[#93c5fd]",
        verified: "border-[#3b82f6]/20 bg-[#3b82f6]/10 text-[#3b82f6] dark:text-[#93c5fd]",
        open: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-[#065f46]/30 dark:bg-[#052e1f]/80 dark:text-[#6ee7b7]",
        pending: "border-amber-200 bg-amber-50 text-amber-700 dark:border-[#92400e]/30 dark:bg-[#2a1e05]/80 dark:text-[#fcd34d]",
        coming: "border-purple-200 bg-purple-50 text-purple-700 dark:border-[#6b21a8]/20 dark:bg-[#2a1650]/50 dark:text-[#d8b4fe]",
      },
      size: {
        sm: "px-2 py-0.5 text-[10px]",
        md: "px-2.5 py-0.5 text-[11px]",
        lg: "px-3 py-1 text-[12px]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "md",
    },
  }
)

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, size, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant, size }), className)} {...props} />
}

export { Badge, badgeVariants }
