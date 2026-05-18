import * as React from "react"

import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card"
import { trackedInvoke, isTauri } from "@/lib/tauri"
import {
  BONDING_LABELS,
  DAMAGE_TYPE_LABELS,
  INVENTORY_TYPE_LABELS,
  SPELL_TRIGGER_LABELS,
  STAT_TYPE_LABELS,
  formatMoney,
  itemTypeLabel,
} from "@/lib/wow-item-enums"
import { cn } from "@/lib/utils"

/**
 * Wowhead-style item tooltip popover. Mimics the in-game WoW tooltip:
 * quality-colored name, yellow ilvl line, white attribute lines,
 * green Equip/Use/Chance-on-hit prose, gold/silver/copper sell price.
 *
 * Triggered on hover (mirrors WoW's in-game behavior). Wraps any
 * arbitrary trigger element via `children`. The trigger receives a
 * click no-op so it can still drive other actions (e.g. an existing
 * "Send" button in the row).
 *
 * Data flow:
 *   - Lazy-fetch `get_item_details(entry)` on first hover; cache per
 *     entry id in a module-level Map (one fetch per item per session).
 *   - Spell descriptions come from the tooltip-data cache the user
 *     extracted via Settings; if not loaded, those rows just skip
 *     (we don't block the tooltip waiting for enrichment).
 *
 * Usage:
 *   <ItemTooltip entry={item.entry} iconMap={iconMap} tooltipData={tt}>
 *     <ItemIconFramed iconName={...} entry={...} />
 *   </ItemTooltip>
 */

// Mirror of the inventory::ItemDetails Rust struct.
export type ItemDetails = {
  entry: number
  name: string
  quality: number
  displayId: number
  bonding: number
  flags: number
  itemLevel: number
  requiredLevel: number
  inventoryType: number
  class: number
  subclass: number
  maxCount: number
  maxDurability: number
  armor: number
  dmgMin1: number
  dmgMax1: number
  dmgType1: number
  dmgMin2: number
  dmgMax2: number
  dmgType2: number
  delay: number
  holyRes: number
  fireRes: number
  natureRes: number
  frostRes: number
  shadowRes: number
  arcaneRes: number
  stats: { statType: number; value: number }[]
  spells: { spellId: number; trigger: number; cooldownMs: number }[]
  itemSet: number
  sellPrice: number
  description: string
}

type SpellEntry = {
  name: string
  description: string
  aura_description: string
  icon: string
}

type ItemSetEntry = {
  name: string
  items: number[]
  bonuses: { threshold: number; spell_id: number }[]
}

type TooltipData = {
  spells: Record<string, SpellEntry>
  sets: Record<string, ItemSetEntry>
}

// Quality color palette — mirrors the inventory grid + ItemIconFramed.
const QUALITY_COLORS: Record<number, string> = {
  0: "text-zinc-400",
  1: "text-white",
  2: "text-green-400",
  3: "text-blue-400",
  4: "text-violet-400",
  5: "text-orange-400",
  6: "text-amber-300",
  7: "text-cyan-400",
}

// Module-level details cache so re-hovering an item is instant. Cleared
// on full reload; that's intentional — fresh server data on app restart.
const detailsCache: Map<number, ItemDetails> = new Map()
const inflight: Map<number, Promise<ItemDetails>> = new Map()

async function loadItemDetails(entry: number): Promise<ItemDetails> {
  const cached = detailsCache.get(entry)
  if (cached) return cached
  const existing = inflight.get(entry)
  if (existing) return existing

  const p = (async () => {
    const result = await trackedInvoke<ItemDetails>("get_item_details", {
      entry,
    })
    detailsCache.set(entry, result)
    inflight.delete(entry)
    return result
  })()
  inflight.set(entry, p)
  return p
}

// Minimal projection — name + quality — for set-member rendering and
// any other "I just need the colored name" surface. Cached per entry.
export type ItemMini = {
  entry: number
  name: string
  quality: number
}

const miniCache: Map<number, ItemMini> = new Map()

async function loadItemMinis(entries: number[]): Promise<ItemMini[]> {
  // Filter out already-cached ids so we only fetch what's missing.
  const missing = entries.filter((e) => !miniCache.has(e))
  if (missing.length > 0) {
    const rows = await trackedInvoke<ItemMini[]>("get_items_by_entries", {
      entries: missing,
    })
    for (const r of rows) miniCache.set(r.entry, r)
  }
  // Return in the SAME ORDER as the input — the ItemSet.dbc array
  // ordering is meaningful (matches the in-game tooltip), so preserve it.
  return entries
    .map((e) => miniCache.get(e))
    .filter((r): r is ItemMini => r != null)
}

export function ItemTooltip({
  entry,
  tooltipData,
  children,
  side = "right",
  align = "start",
}: {
  entry: number
  /** Full tooltip-cache from Settings enrichment (optional). When
   * absent, spell/set lines are skipped. */
  tooltipData?: TooltipData | null
  children: React.ReactNode
  side?: "top" | "right" | "bottom" | "left"
  align?: "start" | "center" | "end"
}) {
  const [details, setDetails] = React.useState<ItemDetails | null>(
    () => detailsCache.get(entry) ?? null
  )
  const [error, setError] = React.useState<string | null>(null)
  const [open, setOpen] = React.useState(false)

  // Fetch on first open. We DON'T pre-fetch on mount — there can be
  // 100+ items on the page and that'd hammer the DB for tooltips the
  // user may never look at.
  React.useEffect(() => {
    if (!open || details || !isTauri()) return
    let cancelled = false
    loadItemDetails(entry)
      .then((d) => {
        if (!cancelled) setDetails(d)
      })
      .catch((e) => {
        if (!cancelled) setError(typeof e === "string" ? e : String(e))
      })
    return () => {
      cancelled = true
    }
  }, [open, details, entry])

  return (
    <HoverCard
      openDelay={150}
      closeDelay={80}
      open={open}
      onOpenChange={setOpen}
    >
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
      <HoverCardContent
        side={side}
        align={align}
        // Replace shadcn's default popover skin with the WoW in-game
        // tooltip look: near-black bg, a thin silver 1px border + a
        // soft inset darken to suggest the beveled metal frame WoW
        // uses, and a heavy drop shadow so the popover reads as
        // floating above the page.
        className={cn(
          "w-[320px] rounded-md border border-[#9a9aaa]/70 bg-[#070712]/95 p-3 text-[12.5px] leading-snug text-white backdrop-blur",
          "shadow-[inset_0_0_0_1px_rgba(0,0,0,0.7),0_8px_24px_rgba(0,0,0,0.7)]"
        )}
      >
        {error ? (
          <div className="text-rose-400">{error}</div>
        ) : details ? (
          <TooltipBody details={details} tooltipData={tooltipData} />
        ) : (
          <div className="flex items-center gap-2 text-zinc-400">
            <span className="size-3 animate-pulse rounded-full bg-zinc-600" />
            Loading…
          </div>
        )}
      </HoverCardContent>
    </HoverCard>
  )
}

function TooltipBody({
  details,
  tooltipData,
}: {
  details: ItemDetails
  tooltipData?: TooltipData | null
}) {
  const quality = QUALITY_COLORS[details.quality] ?? "text-white"
  const slot = INVENTORY_TYPE_LABELS[details.inventoryType] ?? ""
  const type = itemTypeLabel(details.class, details.subclass)
  const bondingText = BONDING_LABELS[details.bonding] ?? ""
  const isUnique = details.maxCount === 1

  // Damage line. dmg_type=0 means physical → just "Damage"; >0 is an
  // elemental suffix ("Nature Damage" etc.). Secondary damage line
  // (dmg_min2/max2) is shown with a leading "+" like Thunderfury.
  const hasDamage1 = details.dmgMax1 > 0
  const hasDamage2 = details.dmgMax2 > 0
  const speed = details.delay / 1000

  // DPS calculation matches the in-game formula: average of all
  // damage ranges / attack time.
  const dps = React.useMemo(() => {
    if (!hasDamage1 && !hasDamage2) return null
    const avg1 = hasDamage1 ? (details.dmgMin1 + details.dmgMax1) / 2 : 0
    const avg2 = hasDamage2 ? (details.dmgMin2 + details.dmgMax2) / 2 : 0
    if (!speed) return null
    return (avg1 + avg2) / speed
  }, [details, hasDamage1, hasDamage2, speed])

  // Resistances — only show non-zero. The four most common (fire/
  // nature/frost/shadow) line up with the order WoW renders them.
  const resistances: { label: string; value: number }[] = []
  for (const [label, value] of [
    ["Arcane", details.arcaneRes],
    ["Fire", details.fireRes],
    ["Nature", details.natureRes],
    ["Frost", details.frostRes],
    ["Shadow", details.shadowRes],
    ["Holy", details.holyRes],
  ] as const) {
    if (value !== 0) resistances.push({ label, value })
  }

  const setEntry = details.itemSet
    ? tooltipData?.sets?.[String(details.itemSet)]
    : undefined

  // Fetch set-member names so the set block can render "Warglaive of
  // Azzinoth" instead of "Item #32837". One bulk query per tooltip
  // open; result memoized on the module-level itemMiniCache so flipping
  // between tooltips for set siblings is instant.
  const [setMembers, setSetMembers] = React.useState<ItemMini[] | null>(null)
  React.useEffect(() => {
    if (!setEntry || setEntry.items.length === 0 || !isTauri()) {
      setSetMembers(null)
      return
    }
    let cancelled = false
    loadItemMinis(setEntry.items)
      .then((rows) => {
        if (!cancelled) setSetMembers(rows)
      })
      .catch((e) => console.warn("get_items_by_entries failed", e))
    return () => {
      cancelled = true
    }
  }, [setEntry])

  const money = formatMoney(details.sellPrice)
  const showMoney = details.sellPrice > 0

  // The tooltip body is rendered as stacked "sections" separated by
  // a paragraph-style gap (`pt-3`). Within a section, rows are tight
  // (`space-y-0.5`) — mirrors WoW's in-game tooltip rhythm.
  return (
    <div className="space-y-0.5">
      {/* HEADER — name + ilvl + bind/unique. */}
      <div className={cn("text-[14px] font-semibold leading-tight", quality)}>
        {details.name}
      </div>
      {details.itemLevel > 0 && (
        <div className="text-[#ffd200]">Item Level {details.itemLevel}</div>
      )}
      {bondingText && <div>{bondingText}</div>}
      {isUnique && <div>Unique</div>}

      {/* SLOT / TYPE — justify-between like the in-game tooltip. */}
      {(slot || type) && (
        <div className="flex justify-between gap-3">
          <span>{slot}</span>
          {type && <span>{type}</span>}
        </div>
      )}

      {/* DAMAGE — primary line + optional secondary elemental line +
          DPS. Speed sits on the right of the primary damage row. */}
      {hasDamage1 && (
        <div className="flex justify-between gap-3">
          <span>
            {damageLine(details.dmgMin1, details.dmgMax1, details.dmgType1, false)}
          </span>
          {speed > 0 && (
            <span>Speed {speed.toFixed(2).replace(/\.?0+$/, "")}</span>
          )}
        </div>
      )}
      {hasDamage2 && (
        <div>
          {damageLine(details.dmgMin2, details.dmgMax2, details.dmgType2, true)}
        </div>
      )}
      {dps != null && (
        <div className="text-zinc-300">
          ({dps.toFixed(2)} damage per second)
        </div>
      )}

      {/* ARMOR (armor items only). */}
      {details.armor > 0 && <div>{details.armor.toLocaleString()} Armor</div>}

      {/* STATS — +N STAT lines. Item ordering is preserved since
          stat_type1..10 in the schema is meaningful. */}
      {details.stats.map((s, i) => (
        <div key={i}>
          {s.value >= 0 ? "+" : ""}
          {s.value} {STAT_TYPE_LABELS[s.statType] ?? `Stat ${s.statType}`}
        </div>
      ))}

      {/* RESISTANCES — only non-zero lines. */}
      {resistances.map((r) => (
        <div key={r.label}>
          {r.value >= 0 ? "+" : ""}
          {r.value} {r.label} Resistance
        </div>
      ))}

      {details.maxDurability > 0 && (
        <div>
          Durability {details.maxDurability} / {details.maxDurability}
        </div>
      )}

      {details.requiredLevel > 0 && (
        <div>Requires Level {details.requiredLevel}</div>
      )}

      {/* EQUIP / USE / CHANCE ON HIT — green prose. Spell descriptions
          come from the tooltip cache; if not extracted yet, we silently
          skip these lines rather than show "Equip: Spell 12345". */}
      {details.spells.map((s, i) => {
        const spell = tooltipData?.spells?.[String(s.spellId)]
        if (!spell?.description) return null
        const verb = SPELL_TRIGGER_LABELS[s.trigger] ?? "Equip"
        const cd =
          s.trigger === 0 && s.cooldownMs > 0
            ? ` (${Math.round(s.cooldownMs / 1000)} sec cooldown)`
            : ""
        return (
          <div key={i} className="text-green-400">
            {verb}: {spell.description}
            {cd}
          </div>
        )
      })}

      {/* ITEM SET — blank-line gap above the set header, blank-line
          gap between member list and bonuses (`pt-3` on each sub-
          block). Member names come from the bulk-fetched setMembers;
          while loading we show grey-muted entry ids as a placeholder. */}
      {setEntry && (
        <div className="pt-3 space-y-0.5">
          <div className="text-[#7eb6ff]">
            {setEntry.name} (0/{setEntry.items.length})
          </div>
          {setEntry.items.length > 0 && (
            <div className="space-y-0.5">
              {setEntry.items.map((id) => {
                const member = setMembers?.find((m) => m.entry === id)
                return (
                  <div key={id} className="pl-3 text-zinc-500">
                    {member?.name ?? `Item #${id}`}
                  </div>
                )
              })}
            </div>
          )}
          {setEntry.bonuses.length > 0 && (
            <div className="pt-3 space-y-0.5">
              {setEntry.bonuses.map((b, i) => {
                const spell = tooltipData?.spells?.[String(b.spell_id)]
                return (
                  <div key={i} className="text-zinc-400">
                    ({b.threshold}) Set:{" "}
                    {spell?.description ?? `Spell ${b.spell_id}`}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* FLAVOR TEXT — gap-above, italic yellow. */}
      {details.description && (
        <div className="pt-3 italic text-[#ffd200]">"{details.description}"</div>
      )}

      {/* SELL PRICE — gap-above, hidden for quest items / no-vendor. */}
      {showMoney && (
        <div className="flex items-center gap-1 pt-3">
          <span>Sell Price:</span>
          {money.gold > 0 && <Coin amount={money.gold} kind="gold" />}
          {money.silver > 0 && <Coin amount={money.silver} kind="silver" />}
          {(money.copper > 0 || (money.gold === 0 && money.silver === 0)) && (
            <Coin amount={money.copper} kind="copper" />
          )}
        </div>
      )}
    </div>
  )
}

function damageLine(min: number, max: number, type: number, secondary: boolean): string {
  const element = DAMAGE_TYPE_LABELS[type] ?? ""
  const elementStr = element ? `${element} ` : ""
  const range = `${Math.round(min)} - ${Math.round(max)}`
  return secondary
    ? `+ ${range} ${elementStr}Damage`.trim()
    : `${range} ${elementStr}Damage`.trim()
}

/**
 * Inline copper/silver/gold coin. We don't have real coin sprites
 * extracted yet; for v1 we use Tailwind to draw a colored circle with
 * a single-letter label. Swap for proper sprites later.
 */
function Coin({
  amount,
  kind,
}: {
  amount: number
  kind: "gold" | "silver" | "copper"
}) {
  const ringColor =
    kind === "gold"
      ? "bg-amber-400 text-amber-950"
      : kind === "silver"
        ? "bg-zinc-300 text-zinc-800"
        : "bg-orange-700 text-orange-200"
  return (
    <span className="inline-flex items-center gap-0.5">
      <span>{amount}</span>
      <span
        className={cn(
          "inline-flex size-3.5 items-center justify-center rounded-full text-[8px] font-bold",
          ringColor
        )}
        aria-hidden
      >
        {kind[0].toUpperCase()}
      </span>
    </span>
  )
}
