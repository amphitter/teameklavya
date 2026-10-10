import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const TOUCH_MIN = "[@media(pointer:coarse)]:min-h-[44px] [@media(pointer:coarse)]:min-w-[44px]";

const buttonVariants = cva(
  `inline-flex items-center justify-center whitespace-nowrap rounded-[10px] text-[13px] font-medium tracking-tight ring-offset-background transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0 disabled:pointer-events-none disabled:opacity-50 ${TOUCH_MIN}`,
  {
    variants: {
      variant: {
        default: "bg-[#3b82f6] text-white hover:bg-[#2563eb] active:bg-[#1d4ed8] shadow-sm",
        destructive: "bg-[#ef4444] text-white hover:bg-[#dc2626] active:bg-[#b91c1c]",
        outline: "border bg-transparent hover:bg-accent text-foreground dark:border-[#232326] dark:bg-transparent dark:hover:bg-[#1f1f23] dark:hover:border-[#2a2a30] dark:text-[#e4e4e7] border-border",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80 border border-border dark:bg-[#1f1f23] dark:text-[#e4e4e7] dark:hover:bg-[#27272a] dark:border-[#232326]",
        ghost: "hover:bg-accent text-muted-foreground hover:text-foreground dark:hover:bg-[#1f1f23] dark:text-[#a1a1aa] dark:hover:text-white",
        link: "text-primary underline-offset-4 hover:underline h-auto p-0",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-[8px] px-3 text-[12.5px]",
        lg: "h-10 rounded-[10px] px-6 text-[13.5px]",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, asChild = false, ...props }, ref) => {
  const Comp = asChild ? Slot : "button"
  return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
})
Button.displayName = "Button"

export { Button, buttonVariants }
