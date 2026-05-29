import { GEAR_ICON_PATHS } from "@/lib/gear-slot-icons"
import { cn } from "@/lib/utils"

/**
 * Renders an armor/equipment glyph for a WoW equip slot, drawn from the
 * inlined game-icons.net armor set (see gear-slot-icons.ts). The set is
 * armor-focused, so jewelry maps to an orb and weapons to a fist — close
 * enough to read at a glance. Unmapped slots fall back to a full battle-
 * gear silhouette.
 */
const SLOT_ICON: Record<string, string> = {
  head: "crested-helmet",
  neck: "morph-ball",
  shoulder: "shoulder-armor",
  back: "cape-armor",
  chest: "breastplate",
  shirt: "armor-vest",
  tabard: "cape-armor",
  wrist: "bracers",
  hands: "gauntlet",
  waist: "belt-armor",
  legs: "armored-pants",
  feet: "boots",
  finger1: "morph-ball",
  finger2: "morph-ball",
  trinket1: "morph-ball",
  trinket2: "morph-ball",
  main_hand: "mailed-fist",
  off_hand: "mailed-fist",
  ranged: "mailed-fist",
}

export function GearSlotIcon({
  slot,
  className,
}: {
  slot: string
  className?: string
}) {
  const iconName = SLOT_ICON[slot] ?? "battle-gear"
  const d = GEAR_ICON_PATHS[iconName] ?? GEAR_ICON_PATHS["battle-gear"]
  return (
    <svg
      viewBox="0 0 512 512"
      className={cn("size-4 shrink-0", className)}
      fill="currentColor"
      aria-hidden
    >
      <path d={d} />
    </svg>
  )
}
