import { motion, useScroll, type MotionProps } from "motion/react"

import { cn } from "@/lib/utils"

interface ScrollProgressProps extends Omit<
  React.HTMLAttributes<HTMLElement>,
  keyof MotionProps
> {
  ref?: React.Ref<HTMLDivElement>
  /** Optional ref to the scroll container whose scroll progress drives
   * the bar. Omit for window/document scroll (the magic-ui default). */
  containerRef?: React.RefObject<HTMLElement | null>
}

export function ScrollProgress({
  className,
  ref,
  containerRef,
  ...props
}: ScrollProgressProps) {
  const { scrollYProgress } = useScroll(
    containerRef ? { container: containerRef } : undefined
  )

  return (
    <motion.div
      ref={ref}
      className={cn(
        // Caller controls positioning (e.g. `sticky top-0` inside a
        // scroll area, or `fixed inset-x-0 top-0` for window scroll).
        "h-px origin-left bg-linear-to-r from-[#A97CF8] via-[#F38CB8] to-[#FDCC92]",
        className
      )}
      style={{
        scaleX: scrollYProgress,
      }}
      {...props}
    />
  )
}
