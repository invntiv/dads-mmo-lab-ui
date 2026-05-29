/**
 * Party preset domain — types + the logic to turn a live party into a
 * saveable preset, and a preset bot back into the args the spawn
 * pipeline (`add_bot_to_party`) wants.
 *
 * The TOML/JSON shape mirrors the Rust `presets.rs` structs (and
 * `preset_system_handoff.md`), so field names are snake_case to match
 * what crosses the Tauri boundary and lands on disk verbatim.
 *
 * Talent capture: a party bot was itself built from a mod-playerbots
 * premade build, so we recover its talent string by mapping its
 * detected spec (class + primary talent tab) back to the matching
 * premade build's digit-dash link — the same dataset the Add-to-Party
 * wizard picks from. We don't reverse-engineer the exact tree; the
 * premade build is the faithful, re-applyable representation.
 */
import {
  dataset,
  getBuildAtLevel,
  snapToBuildLevel,
  type SpecEntry,
} from "@/lib/talent-builds"
import { specName, specRole } from "@/lib/wow-spec-roles"

// ── on-disk / on-wire shape (snake_case, matches presets.rs) ──────────

export interface PresetTarget {
  /** leveling | dungeon | raid | pvp | other */
  type: string
  /** Content name for dungeon/raid; omitted otherwise. */
  name?: string
}

export interface PresetInfo {
  name: string
  author?: string
  created_at?: string
  target: PresetTarget
}

export interface PresetPlayerSlot {
  role?: string
}

export interface PresetBot {
  /** tank | healer | dps */
  role: string
  /** addclass keyword: warrior, paladin, hunter, rogue, priest, dk,
   *  shaman, mage, warlock, druid */
  class: string
  level: number
  /** Digit-dash talent string. Omitted → bot auto-picks talents. */
  talents?: string
  /** Advisory display name, e.g. "Protection". */
  spec?: string
  name?: string
  /** Author's intended gear/glyphs — preserved, not applied in v1. */
  gear?: unknown
  glyphs?: unknown
}

export interface PresetParty {
  player?: PresetPlayerSlot
  bots: PresetBot[]
}

export interface PartyPreset {
  schema_version: number
  preset_info: PresetInfo
  party: PresetParty
}

export interface PresetEntry {
  id: string
  raw_toml: string
  preset: PartyPreset
}

export interface ImportResult {
  entry: PresetEntry
  warnings: string[]
}

// ── preset "type" taxonomy ────────────────────────────────────────────

export const PRESET_TYPES = [
  { value: "leveling", label: "Leveling" },
  { value: "dungeon", label: "Dungeon" },
  { value: "raid", label: "Raid" },
  { value: "pvp", label: "PvP" },
  { value: "other", label: "Other" },
] as const

export type PresetType = (typeof PRESET_TYPES)[number]["value"]

/** Types that name a specific piece of content (dungeon / raid). */
export function typeNeedsContent(type: string): boolean {
  return type === "dungeon" || type === "raid"
}

export function presetTypeLabel(type: string): string {
  return PRESET_TYPES.find((t) => t.value === type)?.label ?? type
}

// ── class id <-> addclass keyword ─────────────────────────────────────

/** AC class id → mod-playerbots addclass keyword. Mirrors
 *  `class_id_to_name` in playerbots.rs. Class 10 is unused in WotLK. */
export const CLASS_KEYWORDS: Record<number, string> = {
  1: "warrior",
  2: "paladin",
  3: "hunter",
  4: "rogue",
  5: "priest",
  6: "dk",
  7: "shaman",
  8: "mage",
  9: "warlock",
  11: "druid",
}

const CLASS_ID_BY_KEYWORD: Record<string, number> = Object.fromEntries(
  Object.entries(CLASS_KEYWORDS).map(([id, kw]) => [kw, Number(id)])
)

export function presetBotClassId(bot: PresetBot): number | null {
  return CLASS_ID_BY_KEYWORD[bot.class.trim().toLowerCase()] ?? null
}

// ── capture: live party member → preset bot ───────────────────────────

export interface PartyMemberLike {
  classId: number
  level: number
  specTabIndex?: number | null
  talentDistribution?: [number, number, number] | null
}

/**
 * Find the premade build's digit-dash talent link for a class + talent
 * tab at a given level. Prefers a PvE spec variant; snaps to the
 * highest build level ≤ the bot's level. Returns undefined when the
 * tab is unknown or no matching premade build exists.
 */
export function findPremadeLink(
  classId: number,
  tabIndex: number | null,
  level: number
): string | undefined {
  if (tabIndex == null) return undefined

  const candidates: SpecEntry[] = dataset.specs.filter(
    (s) =>
      s.classId === classId &&
      s.builds.some((b) => b.primaryTab === tabIndex)
  )
  if (candidates.length === 0) return undefined

  // Prefer a "pve" variant; otherwise take the first deterministic match.
  const spec =
    candidates.find((s) => s.specName.toLowerCase().includes("pve")) ??
    candidates[0]

  const buildLevel = snapToBuildLevel(spec, level)
  if (buildLevel == null) return undefined
  const build = getBuildAtLevel(spec, buildLevel)
  return build?.wowheadLink || undefined
}

/** Turn one live party member into a preset bot entry. */
export function captureBot(m: PartyMemberLike): PresetBot {
  const tab = m.specTabIndex ?? null
  const role = specRole(m.classId, tab) ?? "dps"
  const spec = specName(m.classId, tab, false) ?? undefined
  const talents = findPremadeLink(m.classId, tab, m.level)
  return {
    role,
    class: CLASS_KEYWORDS[m.classId] ?? "warrior",
    level: m.level,
    ...(talents ? { talents } : {}),
    ...(spec ? { spec } : {}),
  }
}

/** Assemble a full preset from the dialog inputs + captured bots. */
export function buildPreset(opts: {
  name: string
  type: string
  content?: string
  author?: string
  playerRole?: string
  bots: PresetBot[]
}): PartyPreset {
  return {
    schema_version: 1,
    preset_info: {
      name: opts.name.trim(),
      ...(opts.author ? { author: opts.author } : {}),
      created_at: new Date().toISOString(),
      target: {
        type: opts.type,
        ...(opts.content && typeNeedsContent(opts.type)
          ? { name: opts.content.trim() }
          : {}),
      },
    },
    party: {
      ...(opts.playerRole ? { player: { role: opts.playerRole } } : {}),
      bots: opts.bots,
    },
  }
}

/** Human-readable one-liner for a preset's target, e.g. "Dungeon · BRD". */
export function targetSummary(target: PresetTarget): string {
  const label = presetTypeLabel(target.type)
  return target.name ? `${label} · ${target.name}` : label
}

// ── gear ──────────────────────────────────────────────────────────────

/** Canonical equip-slot order (matches the handoff slot enum). */
export const GEAR_SLOT_ORDER = [
  "head",
  "neck",
  "shoulder",
  "back",
  "chest",
  "shirt",
  "tabard",
  "wrist",
  "hands",
  "waist",
  "legs",
  "feet",
  "finger1",
  "finger2",
  "trinket1",
  "trinket2",
  "main_hand",
  "off_hand",
  "ranged",
] as const

export const GEAR_SLOT_LABELS: Record<string, string> = {
  head: "Head",
  neck: "Neck",
  shoulder: "Shoulder",
  back: "Back",
  chest: "Chest",
  shirt: "Shirt",
  tabard: "Tabard",
  wrist: "Wrist",
  hands: "Hands",
  waist: "Waist",
  legs: "Legs",
  feet: "Feet",
  finger1: "Finger",
  finger2: "Finger",
  trinket1: "Trinket",
  trinket2: "Trinket",
  main_hand: "Main Hand",
  off_hand: "Off Hand",
  ranged: "Ranged",
}

export interface GearItem {
  slot: string
  id: number
  name?: string
}

/**
 * Parse a preset bot's opaque `gear` value into an ordered list of
 * {slot, id, name}. Tolerant of the `{ id, name }` shape the handoff
 * uses; silently skips malformed / id-less slots.
 */
export function parseGear(gear: unknown): GearItem[] {
  if (!gear || typeof gear !== "object") return []
  const table = gear as Record<string, unknown>
  const out: GearItem[] = []
  for (const slot of GEAR_SLOT_ORDER) {
    const raw = table[slot]
    if (!raw || typeof raw !== "object") continue
    const cell = raw as { id?: unknown; name?: unknown }
    const id = typeof cell.id === "number" ? cell.id : Number(cell.id)
    if (!Number.isFinite(id) || id <= 0) continue
    out.push({
      slot,
      id,
      name: typeof cell.name === "string" ? cell.name : undefined,
    })
  }
  return out
}

/**
 * Per-tab talent point totals from a digit-dash link. Each `-`-separated
 * segment is one tree; summing its rank digits gives points spent there.
 * Returns null when there's no usable build.
 */
export function talentDistribution(
  talents: string | undefined
): [number, number, number] | null {
  if (!talents) return null
  const tabs = talents.split("-")
  const dist: [number, number, number] = [0, 0, 0]
  for (let i = 0; i < 3; i++) {
    const seg = tabs[i] ?? ""
    let sum = 0
    for (const ch of seg) {
      const n = ch.charCodeAt(0) - 48
      if (n >= 0 && n <= 9) sum += n
    }
    dist[i] = sum
  }
  return dist.some((n) => n > 0) ? dist : null
}
