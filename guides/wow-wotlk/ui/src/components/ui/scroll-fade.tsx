import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Visual cue for "there's more content below" — a soft fade from the
 * page background at the bottom of a scroll container. Hidden when
 * the user has scrolled to the bottom (no more content to reach).
 *
 * Usage:
 *   const scrollRef = useRef<HTMLDivElement>(null)
 *   const canScrollDown = useCanScrollDown(scrollRef)
 *   <div className="relative">
 *     <div ref={scrollRef} className="h-full overflow-y-auto">...</div>
 *     <ScrollFade visible={canScrollDown} />
 *   </div>
 */
export function ScrollFade({
  visible,
  className,
  height = "h-12",
}: {
  visible: boolean
  className?: string
  /** Tailwind height token for the fade strip. Default `h-12` (48px). */
  height?: string
}) {
  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-background to-transparent transition-opacity duration-200",
        height,
        visible ? "opacity-100" : "opacity-0",
        className
      )}
    />
  )
}

/**
 * Track whether a scroll container can scroll further down. Watches
 * scroll position, container resizes, AND content mutations so
 * dynamic lists (filters narrowing results, lazy pagination) get
 * re-checked without per-page wiring.
 */
export function useCanScrollDown(
  ref: React.RefObject<HTMLElement | null>
): boolean {
  const [canScrollDown, setCanScrollDown] = React.useState(false)
  React.useEffect(() => {
    const el = ref.current
    if (!el) return
    const check = () => {
      // 2px hysteresis hides flicker at the scroll-to-bottom boundary
      // — browsers can be off by a fractional pixel at sub-pixel zooms.
      setCanScrollDown(el.scrollHeight - el.scrollTop - el.clientHeight > 2)
    }
    check()
    el.addEventListener("scroll", check, { passive: true })
    const ro = new ResizeObserver(check)
    ro.observe(el)
    const mo = new MutationObserver(check)
    mo.observe(el, { childList: true, subtree: true })
    return () => {
      el.removeEventListener("scroll", check)
      ro.disconnect()
      mo.disconnect()
    }
  }, [ref])
  return canScrollDown
}
