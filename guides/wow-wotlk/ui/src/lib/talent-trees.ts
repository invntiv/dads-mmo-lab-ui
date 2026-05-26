/**
 * Typed wrapper around the per-class talent tree dataset.
 *
 * The JSON is produced by the Rust extractor
 * (src-tauri/src/talent_trees.rs) from the user's WoW 3.3.5a client
 * DBCs. Trigger via Player Bots → Settings → Build talent trees.
 *
 * Static structural data only — the user's / bot's actual point
 * allocations are overlaid by the consuming component using a
 * `pointsByTalentId` lookup built from `character_talent` SQL rows.
 */
import datasetJson from "@/lib/talent-trees.json"

export interface TalentNode {
  /** Talent.dbc primary key — the stable id we key point counts by. */
  id: number
  /** 0-indexed row (tier) in the tree's 4×N grid. */
  row: number
  /** 0-indexed column. */
  col: number
  name: string
  /**
   * Spell icon basename, e.g. "spell_nature_ravenform". Render as
   * `https://wow.zamimg.com/images/wow/icons/large/{iconName}.jpg`.
   */
  iconName: string
  /**
   * Raw description with `$s1` / `$s2` template placeholders. The UI
   * currently shows it verbatim — wider templating can come later.
   */
  description: string
  maxRank: number
  /** spell_id per rank, index 0 = rank 1. */
  rankSpells: number[]
  /** Required prior talent id on this tab (null for base talents). */
  prereqTalentId: number | null
  /** 1-based rank required in the prereq talent. */
  prereqRank: number | null
}

export interface TalentTab {
  tabId: number
  /** 0/1/2 — the spec axis (Beast Mastery / Marks / Survival, etc.). */
  tabIndex: number
  name: string
  /** Spell icon basename for the tree crest. */
  iconName: string
  /**
   * Raw DBC value like "BeastMastery". Reserved for the future
   * ripped-client-background path.
   */
  backgroundFile: string
  talents: TalentNode[]
  maxRow: number
  maxCol: number
}

export interface ClassTrees {
  classId: number
  /** Exactly 3 tabs, sorted by tabIndex. */
  tabs: TalentTab[]
}

export interface TalentTreesDataset {
  version: number
  extractedAt: string
  sourceDir: string
  classCount: number
  talentCount: number
  classes: ClassTrees[]
}

export const dataset = datasetJson as TalentTreesDataset

/** Look up a class's trees by AC class id (1..11). Returns null if not present. */
export function getClassTrees(classId: number): ClassTrees | null {
  return dataset.classes.find((c) => c.classId === classId) ?? null
}

/**
 * `true` when the dataset hasn't been extracted yet. UI should fall
 * back to a "Run extractor in Settings" prompt in that case.
 */
export function isDatasetEmpty(): boolean {
  return dataset.classes.length === 0
}

/**
 * Per-tab points-spent sum from a flat per-talent map.
 * Used by the header "X / 71" displays.
 */
export function tabPointsSpent(
  tab: TalentTab,
  pointsByTalentId: Record<number, number>
): number {
  let total = 0
  for (const t of tab.talents) {
    total += pointsByTalentId[t.id] ?? 0
  }
  return total
}
