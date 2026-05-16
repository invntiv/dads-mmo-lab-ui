import * as React from "react"
import Lottie, { type LottieRefCurrentProps } from "lottie-react"

/**
 * Plays a Lottie animation once, waits `delayBetweenLoopsMs`, then replays.
 * Default `delayBetweenLoopsMs` of 0 falls back to the library's native
 * loop (no gap). Use the explicit-delay path for "subtle background"
 * animations where back-to-back looping would be too busy.
 */
export function LottieLoop({
  animationData,
  delayBetweenLoopsMs = 0,
  className,
}: {
  animationData: object
  delayBetweenLoopsMs?: number
  className?: string
}) {
  const lottieRef = React.useRef<LottieRefCurrentProps>(null)
  const timeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  React.useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
  }, [])

  if (delayBetweenLoopsMs <= 0) {
    return (
      <Lottie
        lottieRef={lottieRef}
        animationData={animationData}
        loop
        autoplay
        className={className}
      />
    )
  }

  return (
    <Lottie
      lottieRef={lottieRef}
      animationData={animationData}
      loop={false}
      autoplay
      onComplete={() => {
        timeoutRef.current = setTimeout(() => {
          lottieRef.current?.goToAndPlay(0, true)
        }, delayBetweenLoopsMs)
      }}
      className={className}
    />
  )
}
