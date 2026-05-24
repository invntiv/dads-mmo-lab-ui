import * as React from "react"

import splashImg from "@/assets/img/TheLab_Splash.png"
import { playSfx } from "@/lib/sfx"
import { cn } from "@/lib/utils"

const SPLASH_TOTAL_MS = 3000
const FADE_MS = 500

/**
 * Full-screen launch splash. Renders on top of the loaded app, plays the
 * startup SFX (respects the user's volume + mute via the sfx store), and
 * fades out after a fixed window so the user gets a deliberate "intro"
 * moment AND we lock in a bit of preload time the app can grow into.
 *
 * Owned by `App` — when `onDone` fires the parent stops rendering us.
 */
export function SplashScreen({ onDone }: { onDone: () => void }) {
  const [fading, setFading] = React.useState(false)

  React.useEffect(() => {
    // playSfx is a no-op when SFX are disabled and respects volume, so
    // muted users see the splash silently with no extra logic here.
    playSfx("splash")

    const fadeAt = window.setTimeout(
      () => setFading(true),
      SPLASH_TOTAL_MS - FADE_MS
    )
    const doneAt = window.setTimeout(onDone, SPLASH_TOTAL_MS)
    return () => {
      window.clearTimeout(fadeAt)
      window.clearTimeout(doneAt)
    }
  }, [onDone])

  return (
    <div
      className={cn(
        "fixed inset-0 z-[9999] flex items-center justify-center bg-background transition-opacity ease-out",
        "duration-500",
        fading && "pointer-events-none opacity-0"
      )}
      aria-hidden={fading}
    >
      <img
        src={splashImg}
        alt="The Lab"
        className="size-full object-cover"
        draggable={false}
      />
    </div>
  )
}
