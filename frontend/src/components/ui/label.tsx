// components/ui/label.tsx
"use client";

import * as React from "react";
import { cn } from "@/components/lib/utlis";

export interface LabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> {
  variant?: "default" | "description" | "error" | "success" | "warning";
  size?: "sm" | "md" | "lg";
  required?: boolean;
  disabled?: boolean;
}

const Label = React.forwardRef<HTMLLabelElement, LabelProps>(
  ({ 
    className, 
    variant = "default", 
    size = "md", 
    required = false,
    disabled = false,
    children,
    ...props 
  }, ref) => {
    
    const variantClasses = {
      default: "text-gray-900",
      description: "text-gray-600",
      error: "text-red-600",
      success: "text-green-600",
      warning: "text-amber-600"
    };

    const sizeClasses = {
      sm: "text-sm",
      md: "text-base",
      lg: "text-lg"
    };

    const disabledClasses = disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer";

    return (
      <label
        className={cn(
          "font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70",
          variantClasses[variant],
          sizeClasses[size],
          disabledClasses,
          className
        )}
        ref={ref}
        {...props}
      >
        {children}
        {required && <span className="text-red-500 ml-1">*</span>}
      </label>
    );
  }
);

Label.displayName = "Label";

export { Label };