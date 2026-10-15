import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const TOUCH_MIN = "[@media(pointer:coarse)]:min-h-[44px] [@media(pointer:coarse)]:min-w-[44px]";

const buttonVariants = cva(
  `inline-flex items-center justify-center whitespace-nowrap rounded-[12px] text-[14px] font-semibold ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 ${TOUCH_MIN}`,
  {
    variants: {
      variant: {
        default:
          "bg-[linear-gradient(135deg,#2563FF_0%,#6C35FF_52%,#D946EF_100%)] text-white shadow-[0px_8px_24px_rgba(37,99,255,0.25)] hover:brightness-[1.05] hover:shadow-[0px_10px_24px_rgba(108,53,255,0.35)] active:translate-y-px",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90 rounded-[12px]",
        outline:
          "border border-[#E4E9F4] bg-white text-[#0B1235] hover:border-[#2563FF] hover:bg-[#EFF6FF] dark:border-[#262626] dark:bg-black dark:text-[#ededed] dark:hover:bg-[#171717] dark:hover:border-[#3b82f6] rounded-[12px]",
        secondary:
          "bg-[#EDE9FE] text-[#7C3AED] border border-[#DDD6FE] hover:bg-[#DDD6FE] dark:bg-[#1e1b2e] dark:text-[#8b5cf6] dark:border-[#2a2a3a] rounded-[9999px]",
        ghost: "hover:bg-[#EFF6FF] hover:text-[#0B1235] dark:hover:bg-[#171717] dark:hover:text-[#ededed] rounded-[10px]",
        link: "text-[#2563FF] underline-offset-4 hover:underline rounded-none",
      },
      size: {
        default: "h-12 px-6 py-2",
        sm: "h-9 rounded-[10px] px-3",
        lg: "h-12 rounded-[12px] px-8",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
