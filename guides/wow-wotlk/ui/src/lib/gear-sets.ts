/**
 * Player gear-set domain — named loadouts for the user's own character,
 * stored/shared as TOML (mirrors `gearsets.rs`). Reuses the party-preset
 * gear-slot vocabulary so a gear set and a bot's gear speak the same
 * language. ID is the source of truth; `name` is human-readable only.
 */
import { GEAR_SLOT_ORDER, type GearItem } from "@/lib/party-presets"

export interface GearPiece {
  id: number
  name?: string
}

export interface GearSet {
  schema_version: number
  name: string
  class?: string
  note?: string
  created_at?: string
  gear: Record<string, GearPiece>
}

export interface GearSetEntry {
  id: string
  raw_toml: string
  set: GearSet
}

/**
 * AzerothCore equipment slot index (0..18, from the paperdoll) → our
 * named slot. Mirrors the in-game equip slot order.
 */
export const AC_SLOT_TO_NAME: Record<number, string> = {
  0: "head",
  1: "neck",
  2: "shoulder",
  3: "shirt",
  4: "chest",
  5: "waist",
  6: "legs",
  7: "feet",
  8: "wrist",
  9: "hands",
  10: "finger1",
  11: "finger2",
  12: "trinket1",
  13: "trinket2",
  14: "back",
  15: "main_hand",
  16: "off_hand",
  17: "ranged",
  18: "tabard",
}

/** Gear map → ordered list of {slot, id, name}, skipping id-less slots. */
export function gearSetItems(gear: Record<string, GearPiece>): GearItem[] {
  const out: GearItem[] = []
  for (const slot of GEAR_SLOT_ORDER) {
    const piece = gear[slot]
    const id = piece && typeof piece.id === "number" ? piece.id : NaN
    if (!Number.isFinite(id) || id <= 0) continue
    out.push({ slot, id, name: piece.name })
  }
  return out
}

/** Assemble a GearSet from a slot→{id,name} map (drops empty slots). */
export function buildGearSet(opts: {
  name: string
  className?: string
  note?: string
  gear: Record<string, GearPiece>
}): GearSet {
  const gear: Record<string, GearPiece> = {}
  for (const slot of GEAR_SLOT_ORDER) {
    const piece = opts.gear[slot]
    if (piece && Number.isFinite(piece.id) && piece.id > 0) {
      gear[slot] = { id: piece.id, ...(piece.name ? { name: piece.name } : {}) }
    }
  }
  return {
    schema_version: 1,
    name: opts.name.trim(),
    ...(opts.className ? { class: opts.className } : {}),
    ...(opts.note && opts.note.trim() ? { note: opts.note.trim() } : {}),
    created_at: new Date().toISOString(),
    gear,
  }
}
