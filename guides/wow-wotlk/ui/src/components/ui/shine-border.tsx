/**
 * ShineBorder — animated gradient border overlay, port of MagicUI's
 * component (https://magicui.design/docs/components/shine-border).
 *
 * Drop inside a `relative` parent. The component absolutely-positions
 * itself, fills the parent, and uses a CSS mask trick (content-box vs
 * border-box) to clip the radial-gradient down to a `borderWidth`-thick
 * outline. The gradient itself slides via the `animate-shine` keyframe
 * in index.css.
 *
 * Pair with cards that have non-trivial padding + a shadow for the
 * intended look. The wrapping parent's `rounded-*` value is inherited
 * via `rounded-[inherit]` so the shine traces whatever corner radius
 * the card uses.
 */

import * as React from "react"

import { cn } from "@/lib/utils"

export interface ShineBorderProps {
  /** Border thickness in px. Default 1. */
  borderWidth?: number
  /** One full sweep duration in seconds. Default 14. */
  duration?: number
  /** Single color or array (joined into the gradient stops). */
  shineColor?: string | string[]
  className?: string
  style?: React.CSSProperties
}

export function ShineBorder({
  borderWidth = 1,
  duration = 14,
  shineColor = "#000000",
  className,
  style,
}: ShineBorderProps) {
  const color = Array.isArray(shineColor) ? shineColor.join(",") : shineColor
  return (
    <div
      style={
        {
          "--border-width": `${borderWidth}px`,
          "--duration": `${duration}s`,
          backgroundImage: `radial-gradient(transparent,transparent, ${color},transparent,transparent)`,
          backgroundSize: "300% 300%",
          mask: `linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)`,
          WebkitMask: `linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)`,
          WebkitMaskComposite: "xor",
          maskComposite: "exclude",
          padding: "var(--border-width)",
          ...style,
        } as React.CSSProperties
      }
      className={cn(
        // Note: `animate-shine` is our custom utility in index.css —
        // Tailwind v4's `motion-safe:` modifier doesn't apply cleanly
        // to custom utilities (it generates a class name that doesn't
        // exist), so we use the bare `animate-shine` here. Users with
        // prefers-reduced-motion: reduce are catered to globally via
        // CSS reset elsewhere if needed.
        "pointer-events-none absolute inset-0 size-full rounded-[inherit] animate-shine will-change-[background-position]",
        className
      )}
    />
  )
}
