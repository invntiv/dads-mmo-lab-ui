/**
 * Race / class / resource enums shared across character-facing UI
 * (sidebar GlobalCharacterCard, dashboard PaperdollView, AHBot wizard
 * picker, future Spellbook/etc.). Single source so colors + labels
 * stay consistent everywhere a character is rendered.
 *
 * Enum values + class colors come from the canonical 3.3.5a constants
 * (AC source + wowpedia "Class colors"). Tuned slightly brighter for
 * dark backgrounds where the pure WoW values were muddy.
 */

export const RACE_NAMES: Record<number, string> = {
  1: "Human",
  2: "Orc",
  3: "Dwarf",
  4: "Night Elf",
  5: "Undead",
  6: "Tauren",
  7: "Gnome",
  8: "Troll",
  10: "Blood Elf",
  11: "Draenei",
}

export const CLASS_NAMES: Record<number, string> = {
  1: "Warrior",
  2: "Paladin",
  3: "Hunter",
  4: "Rogue",
  5: "Priest",
  6: "Death Knight",
  7: "Shaman",
  8: "Mage",
  9: "Warlock",
  11: "Druid",
}

/** Short labels for tight surfaces (bot card line 2, etc.). Mostly
 *  the same as CLASS_NAMES — Death Knight is the long one and gets
 *  shortened to "DK". */
export const CLASS_SHORT_NAMES: Record<number, string> = {
  1: "Warrior",
  2: "Paladin",
  3: "Hunter",
  4: "Rogue",
  5: "Priest",
  6: "DK",
  7: "Shaman",
  8: "Mage",
  9: "Warlock",
  11: "Druid",
}

/** Wowhead/zamimg CDN icon basename for each class. Rendered exactly
 * like item icons — `https://wow.zamimg.com/images/wow/icons/<size>/<name>.jpg`
 * — so the character avatar in the switcher + menu card shows the
 * familiar class crest instead of a generic placeholder. */
export const CLASS_ICON_NAMES: Record<number, string> = {
  1: "classicon_warrior",
  2: "classicon_paladin",
  3: "classicon_hunter",
  4: "classicon_rogue",
  5: "classicon_priest",
  6: "classicon_deathknight",
  7: "classicon_shaman",
  8: "classicon_mage",
  9: "classicon_warlock",
  11: "classicon_druid",
}

/** Tailwind utility class with the WoW-canonical class color. */
export const CLASS_COLORS: Record<number, string> = {
  1: "text-[#C79C6E]", // Warrior — tan
  2: "text-[#F58CBA]", // Paladin — pink
  3: "text-[#ABD473]", // Hunter — light green
  4: "text-[#FFF569]", // Rogue — yellow
  5: "text-[#FFFFFF]", // Priest — white
  6: "text-[#C41F3B]", // Death Knight — red
  7: "text-[#0070DE]", // Shaman — deep blue
  8: "text-[#69CCF0]", // Mage — light blue
  9: "text-[#9482C9]", // Warlock — purple
  11: "text-[#FF7D0A]", // Druid — orange
}

/** Raw hex (no Tailwind wrapper) for places that need the value
 * directly, e.g. SVG fills or bar accents on the paperdoll. */
export const CLASS_COLOR_HEX: Record<number, string> = {
  1: "#C79C6E",
  2: "#F58CBA",
  3: "#ABD473",
  4: "#FFF569",
  5: "#FFFFFF",
  6: "#C41F3B",
  7: "#0070DE",
  8: "#69CCF0",
  9: "#9482C9",
  11: "#FF7D0A",
}

/** "Powers" in the characters table are 7 numbered fields. Each class
 * has a single primary resource: the bar at the bottom of the player
 * frame in-game. Maps class id → which power index (1..7) is primary. */
export type PowerKind = "mana" | "rage" | "focus" | "energy" | "runic_power"

export const POWER_INDEX_FROM_KIND: Record<PowerKind, number> = {
  mana: 1,
  rage: 2,
  focus: 3,
  energy: 4,
  // 5 = happiness (pet only), 6 = runes (separate UI), 7 = runic power
  runic_power: 7,
}

/** Primary resource displayed on the player frame for each class. */
export const CLASS_PRIMARY_POWER: Record<number, PowerKind> = {
  1: "rage", // Warrior
  2: "mana", // Paladin
  3: "mana", // Hunter (the hunter himself; pet uses focus)
  4: "energy", // Rogue
  5: "mana", // Priest
  6: "runic_power", // Death Knight
  7: "mana", // Shaman
  8: "mana", // Mage
  9: "mana", // Warlock
  11: "mana", // Druid (form-aware — DB doesn't know current form; default to mana)
}

/** Bar colors per resource type (Tailwind classes). HP is always red. */
export const POWER_BAR_COLORS: Record<
  PowerKind,
  { fill: string; label: string }
> = {
  mana: { fill: "bg-[#0070DE]", label: "text-[#69CCF0]" },
  rage: { fill: "bg-[#C41F3B]", label: "text-[#FF6B7A]" },
  focus: { fill: "bg-[#CD853F]", label: "text-[#E2A856]" },
  energy: { fill: "bg-[#FFF569]", label: "text-[#FFF569]" },
  runic_power: { fill: "bg-[#00D1FF]", label: "text-[#7EE5FF]" },
}

export const POWER_LABELS: Record<PowerKind, string> = {
  mana: "Mana",
  rage: "Rage",
  focus: "Focus",
  energy: "Energy",
  runic_power: "Runic Power",
}

/** Equipment slot enum from PlayerEquipmentSlots in AC source. Used
 * to pick which inventory rows belong to the paperdoll (slot < 19,
 * bag = 0). */
export const EQUIP_SLOT_LABELS: Record<number, string> = {
  0: "Head",
  1: "Neck",
  2: "Shoulder",
  3: "Shirt",
  4: "Chest",
  5: "Waist",
  6: "Legs",
  7: "Feet",
  8: "Wrist",
  9: "Hands",
  10: "Finger 1",
  11: "Finger 2",
  12: "Trinket 1",
  13: "Trinket 2",
  14: "Back",
  15: "Main Hand",
  16: "Off Hand",
  17: "Ranged",
  18: "Tabard",
}
