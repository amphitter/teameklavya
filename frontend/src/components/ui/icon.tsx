"use client";

import { cn } from "@/lib/utils";

/**
 * Material Symbols icon (Part 8 §15/§39).
 *
 * The supplied references and DESIGN.md both use Material Symbols ligatures,
 * so category icons are rendered by NAME rather than by importing a named
 * export per glyph. That is what lets the icon live in a data map
 * (storyCategoryIcon) instead of being hard-coded per page.
 *
 * The font is loaded in app/layout.tsx. `decorative` hides it from
 * screen readers — every icon-only button still needs its own aria-label.
 */
export function Icon({
  name,
  className,
  size = 24,
  filled = false,
  weight = 400,
  decorative = true,
  label,
}: {
  name: string;
  className?: string;
  size?: number;
  filled?: boolean;
  weight?: 100 | 200 | 300 | 400 | 500 | 600 | 700;
  decorative?: boolean;
  label?: string;
}) {
  return (
    <span
      className={cn("material-symbols-outlined select-none leading-none", className)}
      style={{
        fontSize: `${size}px`,
        width: `${size}px`,
        height: `${size}px`,
        fontVariationSettings: `'FILL' ${filled ? 1 : 0}, 'wght' ${weight}, 'GRAD' 0, 'opsz' ${size}`,
      }}
      aria-hidden={decorative && !label ? true : undefined}
      aria-label={label}
      role={label ? "img" : undefined}
      translate="no"
    >
      {name}
    </span>
  );
}
