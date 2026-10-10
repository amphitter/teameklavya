import * as React from "react"
import { cn } from "@/lib/utils"

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(({ className, type, ...props }, ref) => {
  return (
    <input
      type={type}
      className={cn(
        "flex h-10 w-full rounded-[10px] border bg-card px-3 py-2 text-[13.5px] text-foreground placeholder:text-muted-foreground ring-offset-background focus-visible:outline-none focus-visible:border-primary focus-visible:ring-0 focus-visible:shadow-[0_0_0_3px_rgba(59,130,246,0.15)] disabled:cursor-not-allowed disabled:opacity-50 transition-all duration-150",
        "border-border bg-white dark:border-[#232326] dark:bg-[#18181b] dark:text-white dark:placeholder:text-[#71717a] dark:focus-visible:border-[#3b82f6]",
        className
      )}
      ref={ref}
      {...props}
    />
  )
})
Input.displayName = "Input"

export { Input }
