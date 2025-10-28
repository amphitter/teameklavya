// components/ui/switch.tsx
"use client";

import * as React from "react";
import { cn } from "@/components/lib/utlis";

export interface SwitchProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  size?: "sm" | "md" | "lg";
  variant?: "default" | "primary" | "success" | "warning" | "destructive";
}

const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(
  ({ 
    className, 
    checked, 
    onCheckedChange, 
    disabled, 
    size = "md", 
    variant = "default",
    ...props 
  }, ref) => {
    const [isChecked, setIsChecked] = React.useState(checked || false);

    React.useEffect(() => {
      if (checked !== undefined) {
        setIsChecked(checked);
      }
    }, [checked]);

    const handleToggle = () => {
      if (disabled) return;
      const newChecked = !isChecked;
      setIsChecked(newChecked);
      onCheckedChange?.(newChecked);
    };

    const sizeClasses = {
      sm: "h-4 w-7",
      md: "h-5 w-9",
      lg: "h-6 w-11"
    };

    const thumbSizeClasses = {
      sm: "h-3 w-3",
      md: "h-4 w-4",
      lg: "h-5 w-5"
    };

    const thumbPositionClasses = {
      sm: isChecked ? "translate-x-3" : "translate-x-0",
      md: isChecked ? "translate-x-4" : "translate-x-0",
      lg: isChecked ? "translate-x-5" : "translate-x-0"
    };

    const variantClasses = {
      default: isChecked 
        ? "bg-gray-900 hover:bg-gray-800" 
        : "bg-gray-200 hover:bg-gray-300",
      primary: isChecked 
        ? "bg-blue-600 hover:bg-blue-700" 
        : "bg-gray-200 hover:bg-gray-300",
      success: isChecked 
        ? "bg-green-600 hover:bg-green-700" 
        : "bg-gray-200 hover:bg-gray-300",
      warning: isChecked 
        ? "bg-amber-500 hover:bg-amber-600" 
        : "bg-gray-200 hover:bg-gray-300",
      destructive: isChecked 
        ? "bg-red-600 hover:bg-red-700" 
        : "bg-gray-200 hover:bg-gray-300"
    };

    return (
      <button
        type="button"
        role="switch"
        aria-checked={isChecked}
        data-state={isChecked ? "checked" : "unchecked"}
        disabled={disabled}
        className={cn(
          "inline-flex items-center rounded-full transition-all duration-200 ease-in-out",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-950 focus-visible:ring-offset-2",
          "disabled:cursor-not-allowed disabled:opacity-50",
          "border border-transparent",
          sizeClasses[size],
          variantClasses[variant],
          className
        )}
        onClick={handleToggle}
        ref={ref}
        {...props}
      >
        <span
          className={cn(
            "block rounded-full bg-white shadow-lg ring-0 transition-transform duration-200 ease-in-out",
            thumbSizeClasses[size],
            thumbPositionClasses[size],
            disabled && "bg-gray-100"
          )}
        />
      </button>
    );
  }
);

Switch.displayName = "Switch";

export { Switch };