import * as React from "react"
import { cn } from "@/lib/utils"

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(({ className, type, ...props }, ref) => {
  return (
    <input
      type={type}
      className={cn(
        "flex h-12 w-full rounded-[12px] border border-[#E4E9F4] bg-white px-4 py-2 text-[15px] leading-6 text-[#0B1235] ring-offset-background placeholder:text-[#64709A] transition-all focus-visible:border-[#2563FF] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[rgba(37,99,255,0.12)] disabled:cursor-not-allowed disabled:opacity-50 dark:border-[#262626] dark:bg-[#0a0a0a] dark:text-[#ededed] dark:placeholder:text-[#a1a1aa]",
        className
      )}
      ref={ref}
      {...props}
    />
  )
})
Input.displayName = "Input"

export { Input }
