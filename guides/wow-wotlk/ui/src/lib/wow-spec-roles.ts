/**
 * Spec names + canonical roles per (class, tab_index).
 *
 * Source of truth: matches the names that come out of TalentTab.dbc
 * (cached in talent-data.json) — verified for WotLK 3.3.5a against the
 * live extraction. tab_index 0/1/2 maps to the trees in Blizzard's
 * canonical order: Paladin 0=Holy, 1=Prot, 2=Ret etc.
 *
 * Role classification uses each class's "primary" canonical role per
 * spec for 3.3.5a. Sub-builds exist (Bear-form Feral Druid tanks,
 * Frost DK can off-tank in some kits) but the browser's Role filter
 * is meant for the common case — the Phase 2 My Party wizard will be
 * more rigorous about hybrid builds.
 */

export type Role = "tank" | "healer" | "dps"

export const ROLE_LABELS: Record<Role, string> = {
  tank: "Tank",
  healer: "Healer",
  dps: "DPS",
}

/** Spec names per class, indexed by tab_index 0/1/2. Keys mirror
 *  CLASS_NAMES; class 10 is intentionally absent (skipped in WotLK). */
export const SPEC_NAMES: Record<number, [string, string, string]> = {
  1: ["Arms", "Fury", "Protection"],
  2: ["Holy", "Protection", "Retribution"],
  3: ["Beast Mastery", "Marksmanship", "Survival"],
  4: ["Assassination", "Combat", "Subtlety"],
  5: ["Discipline", "Holy", "Shadow"],
  6: ["Blood", "Frost", "Unholy"],
  7: ["Elemental", "Enhancement", "Restoration"],
  8: ["Arcane", "Fire", "Frost"],
  9: ["Affliction", "Demonology", "Destruction"],
  11: ["Balance", "Feral Combat", "Restoration"],
}

/** Shorter labels for tight UI surfaces. Most match the full name, but
 *  e.g. "Beast Mastery" → "BM" and "Feral Combat" → "Feral". */
export const SPEC_SHORT_NAMES: Record<number, [string, string, string]> = {
  1: ["Arms", "Fury", "Prot"],
  2: ["Holy", "Prot", "Ret"],
  3: ["BM", "MM", "Surv"],
  4: ["Assn", "Combat", "Subt"],
  5: ["Disc", "Holy", "Shadow"],
  6: ["Blood", "Frost", "Unholy"],
  7: ["Ele", "Enh", "Resto"],
  8: ["Arcane", "Fire", "Frost"],
  9: ["Affl", "Demo", "Destro"],
  11: ["Bal", "Feral", "Resto"],
}

/** Canonical role for each (class, tab_index) — WotLK conventions:
 *   - DK Blood = tank (the canonical tank tree pre-Cata)
 *   - Druid Feral = DPS (Cat); Bear-form tanks are a sub-build
 *   - Frost Mage / Frost DK both DPS at 3.3.5a */
export const SPEC_ROLES: Record<number, [Role, Role, Role]> = {
  1: ["dps", "dps", "tank"], // Warrior
  2: ["healer", "tank", "dps"], // Paladin
  3: ["dps", "dps", "dps"], // Hunter
  4: ["dps", "dps", "dps"], // Rogue
  5: ["healer", "healer", "dps"], // Priest
  6: ["tank", "dps", "dps"], // Death Knight
  7: ["dps", "dps", "healer"], // Shaman
  8: ["dps", "dps", "dps"], // Mage
  9: ["dps", "dps", "dps"], // Warlock
  11: ["dps", "dps", "healer"], // Druid
}

export function specName(
  classId: number,
  tabIndex: number | null | undefined,
  short = false
): string | null {
  if (tabIndex == null) return null
  const table = short ? SPEC_SHORT_NAMES : SPEC_NAMES
  return table[classId]?.[tabIndex] ?? null
}

export function specRole(
  classId: number,
  tabIndex: number | null | undefined
): Role | null {
  if (tabIndex == null) return null
  return SPEC_ROLES[classId]?.[tabIndex] ?? null
}
