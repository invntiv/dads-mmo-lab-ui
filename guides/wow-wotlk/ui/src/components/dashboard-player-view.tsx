import * as React from "react"
import {
  ArrowClockwiseIcon,
  CoinsIcon,
  FirstAidIcon,
  HeartIcon,
  LightningIcon,
  PencilIcon,
  SkullIcon,
  UserCircleIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { ItemIconFramed } from "@/components/item-icon-framed"
import { ItemTooltip } from "@/components/item-tooltip"
import { useServerState } from "@/components/server-state-context"
import { trackedInvoke, isTauri } from "@/lib/tauri"
import {
  CLASS_COLOR_HEX,
  CLASS_COLORS,
  CLASS_NAMES,
  CLASS_PRIMARY_POWER,
  EQUIP_SLOT_LABELS,
  POWER_BAR_COLORS,
  POWER_INDEX_FROM_KIND,
  POWER_LABELS,
  RACE_NAMES,
  type PowerKind,
} from "@/lib/wow-character-enums"
import { cn } from "@/lib/utils"

/**
 * Dashboard's player view. Shows the globally-selected character's
 * status bars + paperdoll of equipped items. Each bar (HP / resource /
 * gold) is a popover trigger that exposes the relevant GM action.
 *
 * No character selected → empty state pointing the user at the sidebar
 * picker. No data flickering during loading; the layout reserves space
 * so swapping characters doesn't reshuffle the page.
 *
 * Refresh model:
 *  - Loads once on mount + on character change
 *  - Polls every 8 s so HP/mana/money values stay roughly current
 *  - Manual Refresh button for the impatient
 *  - Action commands trigger an immediate refresh so the bars update
 */

type TooltipData = {
  spells: Record<
    string,
    { name: string; description: string; aura_description: string; icon: string }
  >
  sets: Record<
    string,
    { name: string; items: number[]; bonuses: { threshold: number; spell_id: number }[] }
  >
}

type EquippedItem = { slot: number; entry: number; count: number }

type CharacterPaperdoll = {
  guid: number
  name: string
  account: number
  level: number
  race: number
  class: number
  gender: number
  online: boolean
  money: number
  health: number
  power1: number
  power2: number
  power3: number
  power4: number
  power7: number
  maxHealth: number
  maxPower1: number
  maxPower2: number
  maxPower3: number
  maxPower4: number
  maxPower7: number
  equipped: EquippedItem[]
}

const REFRESH_INTERVAL_MS = 8_000

// Paperdoll slot layout (matches WoW's in-game arrangement).
// Left column: Head → Wrist. Right column: Hands → Trinkets.
// Bottom row: MainHand, OffHand, Ranged.
const LEFT_SLOTS = [0, 1, 2, 14, 4, 3, 18, 8] // Head, Neck, Shoulder, Back, Chest, Shirt, Tabard, Wrist
const RIGHT_SLOTS = [9, 5, 6, 7, 10, 11, 12, 13] // Hands, Waist, Legs, Feet, Ring1, Ring2, Trinket1, Trinket2
const BOTTOM_SLOTS = [15, 16, 17] // MainHand, OffHand, Ranged

export function DashboardPlayerView() {
  const { selectedCharacter } = useServerState()
  const [data, setData] = React.useState<CharacterPaperdoll | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  // Icon + tooltip cache for the paperdoll's item slots. These come
  // from the Settings enrichment; both load silently on mount and
  // degrade gracefully (icons fall back to a quality-colored chit,
  // tooltips skip the spell/set lines) if the user hasn't extracted.
  const [iconMap, setIconMap] = React.useState<Record<string, string>>({})
  const [tooltipData, setTooltipData] = React.useState<TooltipData | null>(null)
  React.useEffect(() => {
    if (!isTauri()) return
    void trackedInvoke<Record<string, string>>("load_item_icon_map")
      .then(setIconMap)
      .catch(() => setIconMap({}))
    void trackedInvoke<{ spells: TooltipData["spells"]; sets: TooltipData["sets"] }>(
      "load_tooltip_data"
    )
      .then((c) => setTooltipData({ spells: c.spells, sets: c.sets }))
      .catch(() => setTooltipData(null))
  }, [])

  const guid = selectedCharacter?.guid ?? null

  const refresh = React.useCallback(async () => {
    if (!guid || !isTauri()) {
      setData(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const result = await trackedInvoke<CharacterPaperdoll>(
        "get_character_paperdoll",
        { guid }
      )
      setData(result)
    } catch (e) {
      setError(typeof e === "string" ? e : String(e))
    } finally {
      setLoading(false)
    }
  }, [guid])

  // Reset + reload when the selected character changes; clearing
  // `data` first prevents the stale character's stats from flashing
  // briefly during the new fetch.
  React.useEffect(() => {
    setData(null)
    void refresh()
  }, [refresh])

  // Lightweight polling so HP/mana/money values track game changes.
  // Stopped when no character is selected.
  React.useEffect(() => {
    if (!guid) return
    const handle = setInterval(refresh, REFRESH_INTERVAL_MS)
    return () => clearInterval(handle)
  }, [guid, refresh])

  if (!selectedCharacter) {
    return <EmptyState />
  }

  return (
    <div className="flex-1 space-y-6 p-6">
      <CharacterStatusHeader
        data={data}
        loading={loading && !data}
        error={error}
        onRefresh={refresh}
      />
      <Paperdoll
        data={data}
        iconMap={iconMap}
        tooltipData={tooltipData}
      />
    </div>
  )
}

// ── Empty state ─────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div className="max-w-md space-y-3 rounded-md border border-dashed border-border bg-muted/20 p-8 text-center">
        <UserCircleIcon className="mx-auto size-12 text-muted-foreground" />
        <div>
          <div className="text-base font-medium">No character selected</div>
          <div className="text-sm text-muted-foreground">
            Pick your active character from the card in the sidebar to
            see their stats, equipment, and quick GM actions here.
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Status header ───────────────────────────────────────────────────

function CharacterStatusHeader({
  data,
  loading,
  error,
  onRefresh,
}: {
  data: CharacterPaperdoll | null
  loading: boolean
  error: string | null
  onRefresh: () => void
}) {
  if (loading) {
    return <div className="h-32 animate-pulse rounded-md border border-border bg-muted/20" />
  }
  if (error || !data) {
    return (
      <div className="flex items-start gap-3 rounded-md border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-700 dark:text-rose-300">
        <WarningCircleIcon className="mt-0.5 size-4 shrink-0" />
        <div className="flex-1">
          <div className="font-medium">Couldn't load character data</div>
          {error && <div className="mt-1 text-xs">{error}</div>}
        </div>
        <Button size="sm" variant="outline" onClick={onRefresh}>
          Retry
        </Button>
      </div>
    )
  }

  const classColor = CLASS_COLORS[data.class] ?? "text-foreground"
  const className = CLASS_NAMES[data.class] ?? `Class ${data.class}`
  const raceName = RACE_NAMES[data.race] ?? `Race ${data.race}`
  const powerKind = CLASS_PRIMARY_POWER[data.class] ?? "mana"
  const dead = data.health === 0

  return (
    <div className="rounded-md border border-border bg-card p-4">
      <div className="flex items-start gap-4">
        {/* Class-color-ringed avatar placeholder — same component
            family as the sidebar GlobalCharacterCard. Real avatars are
            a future-work item if/when we extract race/class portraits
            from the client. */}
        <div
          className="flex size-14 shrink-0 items-center justify-center rounded-md ring-2"
          style={{
            backgroundColor: "rgba(0,0,0,0.3)",
            color: CLASS_COLOR_HEX[data.class] ?? "#aaa",
            // Inline style for the ring color since Tailwind can't
            // ring-arbitrary on a per-class value.
            boxShadow: `inset 0 0 0 2px ${CLASS_COLOR_HEX[data.class] ?? "#666"}`,
          }}
        >
          <UserCircleIcon className="size-9" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={cn("text-lg font-semibold leading-tight", classColor)}>
              {data.name}
            </span>
            {dead && (
              <span className="inline-flex items-center gap-1 rounded-full border border-rose-500/40 bg-rose-500/10 px-2 py-0.5 text-[10px] font-medium text-rose-600">
                <SkullIcon className="size-3" />
                Dead
              </span>
            )}
            {data.online && (
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-600">
                <span className="size-1.5 rounded-full bg-emerald-500" />
                Online
              </span>
            )}
          </div>
          <div className="text-sm text-muted-foreground">
            Level {data.level} | {raceName}{" "}
            <span className={cn("font-medium", classColor)}>{className}</span>
          </div>

          {/* HP + Resource bars, side by side. */}
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <HpBar data={data} onChanged={onRefresh} />
            <ResourceBar
              data={data}
              powerKind={powerKind}
              onChanged={onRefresh}
            />
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onRefresh}
            aria-label="Refresh character data"
          >
            <ArrowClockwiseIcon className={cn("size-4", loading && "animate-spin")} />
            Refresh
          </Button>
          <MoneyDisplay data={data} onChanged={onRefresh} />
        </div>
      </div>

      {data.online && (
        <div className="mt-3 flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          <WarningCircleIcon className="mt-0.5 size-3.5 shrink-0" />
          <span>
            Character is logged into WoW — GM changes (HP, money, etc.)
            will only take effect the next time they log in.
          </span>
        </div>
      )}
    </div>
  )
}

// ── HP / resource / money widgets ───────────────────────────────────

function HpBar({
  data,
  onChanged,
}: {
  data: CharacterPaperdoll
  onChanged: () => void
}) {
  const pct = data.maxHealth > 0
    ? Math.min(100, Math.round((data.health / data.maxHealth) * 100))
    : 0
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="group block w-full cursor-pointer text-left"
          aria-label="HP — click for GM actions"
        >
          <BarLabel
            icon={<HeartIcon className="size-3.5" weight="fill" />}
            label="Health"
            current={data.health}
            max={data.maxHealth}
            colorClass="text-rose-400"
          />
          <Bar
            pct={pct}
            fillClass="bg-gradient-to-b from-rose-500 to-rose-700"
          />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64" side="bottom" align="start">
        <HpActions data={data} onChanged={onChanged} />
      </PopoverContent>
    </Popover>
  )
}

function ResourceBar({
  data,
  powerKind,
  onChanged,
}: {
  data: CharacterPaperdoll
  powerKind: PowerKind
  onChanged: () => void
}) {
  const idx = POWER_INDEX_FROM_KIND[powerKind]
  const current = (() => {
    switch (idx) {
      case 1: return data.power1
      case 2: return data.power2
      case 3: return data.power3
      case 4: return data.power4
      case 7: return data.power7
      default: return 0
    }
  })()
  const max = (() => {
    switch (idx) {
      case 1: return data.maxPower1
      case 2: return data.maxPower2
      case 3: return data.maxPower3
      case 4: return data.maxPower4
      case 7: return data.maxPower7
      default: return 0
    }
  })()
  const pct = max > 0 ? Math.min(100, Math.round((current / max) * 100)) : 0
  const colors = POWER_BAR_COLORS[powerKind]

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="group block w-full cursor-pointer text-left"
          aria-label={`${POWER_LABELS[powerKind]} — click for GM actions`}
        >
          <BarLabel
            icon={<LightningIcon className="size-3.5" weight="fill" />}
            label={POWER_LABELS[powerKind]}
            current={current}
            max={max}
            colorClass={colors.label}
          />
          <Bar pct={pct} fillClass={colors.fill} />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64" side="bottom" align="start">
        <ResourceActions
          data={data}
          powerKind={powerKind}
          onChanged={onChanged}
        />
      </PopoverContent>
    </Popover>
  )
}

function MoneyDisplay({
  data,
  onChanged,
}: {
  data: CharacterPaperdoll
  onChanged: () => void
}) {
  const gold = Math.floor(data.money / 10000)
  const silver = Math.floor((data.money % 10000) / 100)
  const copper = data.money % 100
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-1.5 text-sm hover:border-primary/40 cursor-pointer"
          aria-label="Money — click for GM actions"
        >
          <CoinsIcon className="size-4 text-amber-400" />
          <Coin amount={gold} kind="gold" />
          <Coin amount={silver} kind="silver" />
          <Coin amount={copper} kind="copper" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72" side="bottom" align="end">
        <MoneyActions data={data} onChanged={onChanged} />
      </PopoverContent>
    </Popover>
  )
}

function BarLabel({
  icon,
  label,
  current,
  max,
  colorClass,
}: {
  icon: React.ReactNode
  label: string
  current: number
  max: number
  colorClass: string
}) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className={cn("inline-flex items-center gap-1.5 font-medium", colorClass)}>
        {icon}
        {label}
      </span>
      <span className="font-mono text-[11px] text-muted-foreground">
        {current.toLocaleString()} / {max.toLocaleString()}
      </span>
    </div>
  )
}

function Bar({ pct, fillClass }: { pct: number; fillClass: string }) {
  return (
    <div className="mt-1 h-2 overflow-hidden rounded-full border border-black/60 bg-zinc-900/80 shadow-[inset_0_1px_0_rgba(0,0,0,0.5)]">
      <div
        className={cn("h-full transition-all", fillClass)}
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

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
    <span className="inline-flex items-center gap-0.5 font-mono text-xs">
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

// ── GM action popovers ─────────────────────────────────────────────

function HpActions({
  data,
  onChanged,
}: {
  data: CharacterPaperdoll
  onChanged: () => void
}) {
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const run = async (pct: number) => {
    setBusy(true)
    setError(null)
    try {
      await trackedInvoke("gm_set_health_pct", { guid: data.guid, pct })
      onChanged()
    } catch (e) {
      setError(typeof e === "string" ? e : String(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">Health</div>
      <div className="grid grid-cols-3 gap-2">
        <Button size="sm" variant="outline" onClick={() => run(100)} disabled={busy}>
          <FirstAidIcon className="size-3.5" />
          Full
        </Button>
        <Button size="sm" variant="outline" onClick={() => run(50)} disabled={busy}>
          50%
        </Button>
        <Button size="sm" variant="outline" onClick={() => run(25)} disabled={busy}>
          25%
        </Button>
      </div>
      {data.health === 0 && (
        <Button
          size="sm"
          className="w-full"
          onClick={() => run(100)}
          disabled={busy}
        >
          <HeartIcon className="size-3.5" weight="fill" />
          Revive
        </Button>
      )}
      {error && <ErrorRow message={error} />}
    </div>
  )
}

function ResourceActions({
  data,
  powerKind,
  onChanged,
}: {
  data: CharacterPaperdoll
  powerKind: PowerKind
  onChanged: () => void
}) {
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const powerIndex = POWER_INDEX_FROM_KIND[powerKind]
  const run = async (pct: number) => {
    setBusy(true)
    setError(null)
    try {
      await trackedInvoke("gm_set_power_pct", {
        guid: data.guid,
        powerIndex,
        pct,
      })
      onChanged()
    } catch (e) {
      setError(typeof e === "string" ? e : String(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">{POWER_LABELS[powerKind]}</div>
      <div className="grid grid-cols-3 gap-2">
        <Button size="sm" variant="outline" onClick={() => run(100)} disabled={busy}>
          Full
        </Button>
        <Button size="sm" variant="outline" onClick={() => run(50)} disabled={busy}>
          50%
        </Button>
        <Button size="sm" variant="outline" onClick={() => run(0)} disabled={busy}>
          Empty
        </Button>
      </div>
      {error && <ErrorRow message={error} />}
    </div>
  )
}

function MoneyActions({
  data,
  onChanged,
}: {
  data: CharacterPaperdoll
  onChanged: () => void
}) {
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [setGold, setSetGold] = React.useState(String(Math.floor(data.money / 10000)))
  const [addGold, setAddGold] = React.useState("100")

  const applySet = async () => {
    const g = Math.max(0, parseInt(setGold, 10) || 0)
    setBusy(true)
    setError(null)
    try {
      await trackedInvoke("gm_set_money", { guid: data.guid, copper: g * 10000 })
      onChanged()
    } catch (e) {
      setError(typeof e === "string" ? e : String(e))
    } finally {
      setBusy(false)
    }
  }
  const applyAdd = async () => {
    const g = parseInt(addGold, 10) || 0
    const newCopper = Math.max(0, data.money + g * 10000)
    setBusy(true)
    setError(null)
    try {
      await trackedInvoke("gm_set_money", { guid: data.guid, copper: newCopper })
      onChanged()
    } catch (e) {
      setError(typeof e === "string" ? e : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="text-sm font-medium">Money</div>

      <div className="space-y-1">
        <label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Add / subtract (gold)
        </label>
        <div className="flex gap-2">
          <Input
            value={addGold}
            onChange={(e) => setAddGold(e.target.value)}
            className="h-8 font-mono text-xs"
            inputMode="numeric"
          />
          <Button size="sm" onClick={applyAdd} disabled={busy}>
            <PencilIcon className="size-3.5" />
            Apply
          </Button>
        </div>
        <div className="text-[10px] text-muted-foreground">
          Use a negative number to remove gold.
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Set total (gold)
        </label>
        <div className="flex gap-2">
          <Input
            value={setGold}
            onChange={(e) => setSetGold(e.target.value)}
            className="h-8 font-mono text-xs"
            inputMode="numeric"
          />
          <Button size="sm" variant="outline" onClick={applySet} disabled={busy}>
            Set
          </Button>
        </div>
      </div>

      {error && <ErrorRow message={error} />}
    </div>
  )
}

function ErrorRow({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-rose-500/40 bg-rose-500/10 p-2 text-xs text-rose-700 dark:text-rose-300">
      {message}
    </div>
  )
}

// ── Paperdoll grid ─────────────────────────────────────────────────

function Paperdoll({
  data,
  iconMap,
  tooltipData,
}: {
  data: CharacterPaperdoll | null
  iconMap: Record<string, string>
  tooltipData: TooltipData | null
}) {
  const bySlot = React.useMemo(() => {
    const map: Record<number, EquippedItem> = {}
    for (const item of data?.equipped ?? []) {
      map[item.slot] = item
    }
    return map
  }, [data])

  return (
    <div className="rounded-md border border-border bg-card p-6">
      <div className="grid grid-cols-[auto_1fr_auto] items-center gap-x-6 gap-y-3">
        {/* Left column */}
        <div className="flex flex-col gap-3">
          {LEFT_SLOTS.map((slot) => (
            <PaperdollSlot
              key={slot}
              slot={slot}
              item={bySlot[slot]}
              iconMap={iconMap}
              tooltipData={tooltipData}
            />
          ))}
        </div>

        {/* Middle — character portrait placeholder. Future: 3D model
            viewer or extracted paperdoll background art. */}
        <div className="flex h-full min-h-[400px] items-center justify-center rounded-md border border-dashed border-border bg-muted/20 text-muted-foreground">
          <div className="space-y-2 text-center">
            <UserCircleIcon className="mx-auto size-20" />
            <div className="text-xs">
              Character model goes here.
              <br />
              <span className="text-[10px] opacity-70">
                (Background art comes from client enrichment;
                <br />
                3D viewer is a future-work item.)
              </span>
            </div>
          </div>
        </div>

        {/* Right column */}
        <div className="flex flex-col gap-3">
          {RIGHT_SLOTS.map((slot) => (
            <PaperdollSlot
              key={slot}
              slot={slot}
              item={bySlot[slot]}
              iconMap={iconMap}
              tooltipData={tooltipData}
            />
          ))}
        </div>

        {/* Bottom row — weapons. Spans the full width below the
            three-column layout, centered. */}
        <div className="col-span-3 flex justify-center gap-3 pt-2">
          {BOTTOM_SLOTS.map((slot) => (
            <PaperdollSlot
              key={slot}
              slot={slot}
              item={bySlot[slot]}
              iconMap={iconMap}
              tooltipData={tooltipData}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function PaperdollSlot({
  slot,
  item,
  iconMap,
  tooltipData,
}: {
  slot: number
  item: EquippedItem | undefined
  iconMap: Record<string, string>
  tooltipData: TooltipData | null
}) {
  const slotLabel = EQUIP_SLOT_LABELS[slot] ?? `Slot ${slot}`

  if (!item) {
    // Empty slot — muted frame with the slot type label inside.
    // Replace with extracted PaperDoll silhouettes once the client
    // enrichment for those lands.
    return (
      <div
        className="flex size-14 shrink-0 items-center justify-center rounded-[3px] border border-black/80 bg-zinc-950/60 px-1 text-center text-[9px] uppercase leading-tight tracking-wide text-muted-foreground/60"
        title={slotLabel}
      >
        {slotLabel}
      </div>
    )
  }

  const iconName = iconMap[String(item.entry)]
  return (
    <ItemTooltip
      entry={item.entry}
      tooltipData={tooltipData}
      side="right"
    >
      <span className="cursor-help">
        <ItemIconFramed
          iconName={iconName}
          entry={item.entry}
          size="large"
          alt={slotLabel}
        />
      </span>
    </ItemTooltip>
  )
}
