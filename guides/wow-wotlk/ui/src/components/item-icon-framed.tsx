import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Framed item icon, modeled on Wowhead's `.iconlarge`/`.iconmedium`/
 * `.iconsmall` classes. The frame is a beveled dark border around the
 * Wowhead-CDN icon image — it's the visual we want everywhere an item
 * appears (inventory grid, equipment slots, send-mail dialog, bag-
 * view, etc.) so behavior + look stay consistent.
 *
 * Reusable across surfaces. Pass `iconName` (lowercase, no extension)
 * and we render the Wowhead CDN URL. If the icon hasn't been extracted
 * yet (the icon-cache enrichment hasn't been run on the client) we
 * fall back to a quality-colored entry-id chit so the grid is still
 * scannable.
 */

export type ItemIconSize = "xs" | "small" | "medium" | "large"

const SIZE_PX: Record<ItemIconSize, number> = {
  xs: 18,
  small: 24,
  medium: 36,
  large: 56,
}

// The pixel-to-Tailwind-size mapping (`size-N`). Tailwind v4 supports
// arbitrary sizes via `size-[Npx]`, but using the predefined units
// keeps the bundle smaller and lets the rest of the UI scale uniformly
// if we ever change spacing.
const SIZE_CLASS: Record<ItemIconSize, string> = {
  xs: "size-[18px]",
  small: "size-6",
  medium: "size-9",
  large: "size-14",
}

/** Quality colors used for the fallback chit + optional border tint. */
const QUALITY_TEXT_COLORS: Record<number, string> = {
  0: "text-zinc-400 dark:text-zinc-500",
  1: "text-foreground",
  2: "text-green-500 dark:text-green-400",
  3: "text-blue-500 dark:text-blue-400",
  4: "text-violet-500 dark:text-violet-400",
  5: "text-orange-500 dark:text-orange-400",
  6: "text-amber-300",
  7: "text-cyan-400",
}

export function ItemIconFramed({
  iconName,
  entry,
  quality = 1,
  size = "medium",
  className,
  alt,
}: {
  /** Lowercase icon basename from ItemDisplayInfo.dbc (e.g. `inv_sword_84`). */
  iconName: string | null | undefined
  /** Item entry id — used for the fallback chit when iconName is null. */
  entry: number
  /** 0–7 item quality. Currently only used for the fallback chit color. */
  quality?: number
  size?: ItemIconSize
  className?: string
  /** Accessibility label. Defaults to the entry id if not supplied. */
  alt?: string
}) {
  const [imgError, setImgError] = React.useState(false)
  const sizeClass = SIZE_CLASS[size]
  const px = SIZE_PX[size]

  // Frame: mimics the in-game item-slot. Composed of multiple layers
  // of inset/outer shadow on a near-black background:
  //   - hard 1px black outer edge so the frame stands off any bg
  //   - 1px warm-tan inner ring (rgb(168,144,96)/30%) — the metallic
  //     "frame" you see on Wowhead's .iconlarge
  //   - top-edge highlight + bottom-edge shadow for the bevel
  //   - subtle drop shadow to float the icon off its container
  const frameClass = cn(
    sizeClass,
    "relative inline-block shrink-0 overflow-hidden rounded-[3px] bg-black",
    "shadow-[inset_0_0_0_1px_rgba(168,144,96,0.55),inset_0_1px_0_rgba(255,232,160,0.18),inset_0_-1px_0_rgba(0,0,0,0.8),0_1px_2px_rgba(0,0,0,0.6),0_0_0_1px_rgba(0,0,0,0.9)]",
    className
  )

  if (iconName && !imgError) {
    // Wowhead's CDN serves three sizes; pick the one closest to ours
    // so we don't ship 56px renders for an 18px tile.
    const cdnSize = size === "xs" ? "small" : size === "large" ? "large" : "medium"
    const url = `https://wow.zamimg.com/images/wow/icons/${cdnSize}/${iconName}.jpg`
    return (
      <span className={frameClass}>
        <img
          src={url}
          alt={alt ?? `Item ${entry}`}
          width={px}
          height={px}
          loading="lazy"
          onError={() => setImgError(true)}
          className="absolute inset-0 size-full rounded-[2px] object-cover"
          draggable={false}
        />
      </span>
    )
  }

  // Fallback: quality-colored entry id. Keeps the tile scannable so
  // the user can still tell items apart before they extract icons.
  const fallbackColor = QUALITY_TEXT_COLORS[quality] ?? "text-foreground"
  return (
    <span
      className={cn(
        frameClass,
        "flex items-center justify-center bg-zinc-900 font-mono leading-none",
        fallbackColor,
        size === "xs" ? "text-[7px]" : size === "small" ? "text-[8px]" : "text-[10px]"
      )}
      title={`Item ${entry}`}
      aria-label={alt ?? `Item ${entry}`}
    >
      #{entry}
    </span>
  )
}
