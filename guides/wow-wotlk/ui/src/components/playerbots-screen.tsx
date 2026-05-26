import * as React from "react"
import {
  ArrowClockwiseIcon,
  ArrowUUpLeftIcon,
  ChartBarIcon,
  CheckCircleIcon,
  GearSixIcon,
  MagicWandIcon,
  MagnifyingGlassIcon,
  MapPinIcon,
  PaperPlaneTiltIcon,
  RobotIcon,
  TreeStructureIcon,
  UserMinusIcon,
  UsersThreeIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { ScrollFade, useCanScrollDown } from "@/components/ui/scroll-fade"
import { ScrollProgress } from "@/components/ui/scroll-progress"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import {
  CLASS_COLOR_HEX,
  CLASS_COLORS,
  CLASS_ICON_NAMES,
  CLASS_NAMES,
  CLASS_SHORT_NAMES,
  RACE_NAMES,
} from "@/lib/wow-character-enums"
import { mapName } from "@/lib/wow-map-names"
import {
  ROLE_LABELS,
  SPEC_NAMES,
  type Role,
  specName,
  specRole,
} from "@/lib/wow-spec-roles"
import { zoneName } from "@/lib/wow-zone-names"
import { useServerState } from "@/components/server-state-context"
import { trackedInvoke, isTauri } from "@/lib/tauri"
import { cn } from "@/lib/utils"

/**
 * Player Bots browser. Three tabs:
 *   - "In the world" — every currently ONLINE bot (regardless of
 *     account_type). Random bots, AddClass alts attached to a player,
 *     teleported-and-stranded pool bots — they all show here so the
 *     user has one place to answer "where are the bots near me right
 *     now?". Optional "In your zone" filter narrows to the user's
 *     saved zone (chardb can be ~15min stale while logged in).
 *   - "Bot pool" — every OFFLINE bot. Dominated by the AddClass pool
 *     waiting to be invited; also includes random bots cycling
 *     offline via BotActiveAlone scaling. Rendered as a compact list
 *     since offline bots have no zone/map info worth a tile.
 *   - "Settings" → placeholder for the chatter slider + ambient
 *     density slider. Lives here so the bot config doesn't pollute
 *     the global Settings page.
 *
 * The In-the-world / Bot-pool split is by `online` flag, NOT by
 * `account_type` — that source-pool distinction matters at the mod
 * level (random bots auto-pick talents; AddClass bots are master-
 * driven), but answering "where are the bots right now?" only needs
 * the runtime status.
 *
 * Clicking a bot card opens a Popover with per-bot actions. The
 * popover auto-closes after 4s with no hover on either the card or
 * the popover; outside-click closes immediately (Radix default).
 */

type Playerbot = {
  guid: number
  name: string
  race: number
  class: number
  gender: number
  level: number
  map: number
  zone: number
  account: number
  /** Source pool classification — 1=RNDBot, 2=AddClass. Retained so
   *  per-bot actions can branch on capabilities (re-roll only works
   *  on RNDBots; addclass-by-class only spawns AddClass entries),
   *  but the tab split uses `online` instead. */
  botType: 1 | 2
  /** True iff the bot is currently logged into the world. Drives the
   *  In-the-world vs Bot-pool tab assignment. */
  online: boolean
  /** Primary spec tab (0/1/2) inferred from talent distribution.
   *  null/undefined when the bot has no talents or the talent cache
   *  hasn't been extracted yet. */
  specTabIndex?: number | null
}

type TabId = "world" | "pool" | "settings"

const TABS: { id: TabId; label: string; description: string }[] = [
  {
    id: "world",
    label: "In the world",
    description:
      "Bots currently logged in — random roamers, party companions, and any pool bots you've teleported but haven't recruited. Use 'In your zone' to find the ones near your character.",
  },
  {
    id: "pool",
    label: "Bot pool",
    description:
      "Offline bots waiting in the wings. Most are pre-leveled AddClass entries ready to be summoned via Add to Party; a few are random bots cycling offline.",
  },
  {
    id: "settings",
    label: "Settings",
    description:
      "Tune how Playerbots behaves — chatter level, ambient density, and other bot-specific knobs.",
  },
]

// CLASS_NAMES is keyed by id; alphabetize by display name for the
// dropdown while preserving the id-based filter value.
const CLASS_FILTER_OPTIONS = [
  { value: "0", label: "All classes" },
  ...Object.entries(CLASS_NAMES)
    .map(([id, name]) => ({ value: id, label: name }))
    .sort((a, b) => a.label.localeCompare(b.label)),
]

// Level options support both ranges ("1-10") and floors ("10+"). The
// shape carries explicit min/max so the filter logic doesn't have to
// re-parse the label.
type LevelOption = { value: string; label: string; min: number; max?: number }
const LEVEL_OPTIONS: LevelOption[] = [
  { value: "any", label: "Any level", min: 1 },
  { value: "1-10", label: "Level 1-10", min: 1, max: 10 },
  { value: "10+", label: "Level 10+", min: 10 },
  { value: "20+", label: "Level 20+", min: 20 },
  { value: "40+", label: "Level 40+", min: 40 },
  { value: "60+", label: "Level 60+", min: 60 },
  { value: "70+", label: "Level 70+", min: 70 },
  { value: "80", label: "Level 80", min: 80, max: 80 },
]

const ROLE_OPTIONS: { value: "any" | Role; label: string }[] = [
  { value: "any", label: "Any role" },
  { value: "tank", label: ROLE_LABELS.tank },
  { value: "healer", label: ROLE_LABELS.healer },
  { value: "dps", label: ROLE_LABELS.dps },
]

const POPOVER_AUTO_CLOSE_MS = 4000

export function PlayerbotsScreen() {
  const { selectedCharacter, worldserverStatus, openBotDetail } = useServerState()
  // SOAP-backed actions need the worldserver responding on :7878. Browsing
  // works without it (DB container is enough), so we keep the list usable
  // and just gate per-action with a clear reason in the popover.
  const serverRunning = worldserverStatus === "running"

  const [bots, setBots] = React.useState<Playerbot[]>([])
  const [loading, setLoading] = React.useState(false)
  const [loadError, setLoadError] = React.useState<string | null>(null)

  const [activeTab, setActiveTab] = React.useState<TabId>("world")
  const [search, setSearch] = React.useState("")
  const [roleFilter, setRoleFilter] = React.useState<"any" | Role>("any")
  const [classFilter, setClassFilter] = React.useState("0")
  // Spec filter holds the tab_index as a string ("0"/"1"/"2") or "any".
  // Only meaningful when classFilter is set — disabled UI otherwise.
  const [specFilter, setSpecFilter] = React.useState<string>("any")
  const [levelFilter, setLevelFilter] = React.useState<string>("any")
  const [inYourZone, setInYourZone] = React.useState(false)

  // Resetting spec when class changes prevents stale-spec mismatches
  // (e.g. user picks Paladin → Holy, then switches class to Warrior,
  // which has no "Holy" spec at tab_index=0 == Arms).
  React.useEffect(() => {
    setSpecFilter("any")
  }, [classFilter])

  // Which bot's popover is currently open. Only one at a time — clicking
  // another bot closes the previous via the parent Popover's onOpenChange.
  const [openBotGuid, setOpenBotGuid] = React.useState<number | null>(null)

  // Guids of bots currently in the user's party — used to swap the
  // popover's primary action between "Add to my party" and "Kick from
  // party" without forcing the user to navigate to My Party first.
  // Refreshed on mount, on character change, and after add/kick.
  const [partyGuids, setPartyGuids] = React.useState<Set<number>>(new Set())
  const refreshPartyGuids = React.useCallback(async () => {
    const playerGuid = selectedCharacter?.guid
    if (!playerGuid || !isTauri()) {
      setPartyGuids(new Set())
      return
    }
    try {
      const members = await trackedInvoke<{ guid: number; isLeader: boolean }[]>(
        "get_user_party",
        { playerGuid }
      )
      setPartyGuids(new Set(members.filter((m) => !m.isLeader).map((m) => m.guid)))
    } catch {
      setPartyGuids(new Set())
    }
  }, [selectedCharacter?.guid])
  React.useEffect(() => {
    void refreshPartyGuids()
  }, [refreshPartyGuids])
  // Set-level dialog state, mounted at page-root so the popover can
  // close cleanly when the dialog opens (Radix would otherwise stack
  // them and the popover's outside-click would dismiss the dialog).
  const [levelDialogBot, setLevelDialogBot] = React.useState<Playerbot | null>(
    null
  )
  const [actionToast, setActionToast] = React.useState<{
    kind: "ok" | "err"
    msg: string
  } | null>(null)

  const scrollRef = React.useRef<HTMLDivElement>(null)
  const canScrollDown = useCanScrollDown(scrollRef)

  const refresh = React.useCallback(async () => {
    if (!isTauri()) return
    setLoading(true)
    setLoadError(null)
    try {
      const list = await trackedInvoke<Playerbot[]>("list_playerbots")
      setBots(list)
    } catch (err) {
      setLoadError(String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void refresh()
  }, [refresh])

  /** Which online-state the active tab is filtering for. null on
   *  Settings (no bot list rendered). */
  const wantsOnline: boolean | null =
    activeTab === "world" ? true : activeTab === "pool" ? false : null

  const filtered = React.useMemo(() => {
    if (wantsOnline == null) return []
    const q = search.trim().toLowerCase()
    const cls = parseInt(classFilter, 10)
    const specTab = specFilter === "any" ? null : parseInt(specFilter, 10)
    const lvlOpt = LEVEL_OPTIONS.find((o) => o.value === levelFilter)
    const userZone = selectedCharacter?.zone
    return bots.filter((b) => {
      if (b.online !== wantsOnline) return false
      if (q && !b.name.toLowerCase().includes(q)) return false
      if (cls !== 0 && b.class !== cls) return false
      if (specTab != null && b.specTabIndex !== specTab) return false
      if (roleFilter !== "any") {
        // A bot with no spec inferred (low-level / no cache) can't be
        // role-classified, so it's excluded from any role filter.
        const role = specRole(b.class, b.specTabIndex)
        if (role !== roleFilter) return false
      }
      if (lvlOpt && lvlOpt.value !== "any") {
        if (b.level < lvlOpt.min) return false
        if (lvlOpt.max != null && b.level > lvlOpt.max) return false
      }
      // "In your zone" only makes sense for online bots — offline
      // pool bots have no current zone in the world.
      if (inYourZone && wantsOnline && userZone != null && b.zone !== userZone) {
        return false
      }
      return true
    })
  }, [
    bots,
    wantsOnline,
    search,
    roleFilter,
    classFilter,
    specFilter,
    levelFilter,
    inYourZone,
    selectedCharacter,
  ])

  // Lazy render — same pattern as TeleportScreen.
  const PAGE_SIZE = 60
  const [shown, setShown] = React.useState(PAGE_SIZE)
  React.useEffect(() => {
    setShown(PAGE_SIZE)
  }, [activeTab, search, roleFilter, classFilter, specFilter, levelFilter, inYourZone, bots])
  const paged = React.useMemo(() => filtered.slice(0, shown), [filtered, shown])
  const onListScroll = React.useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      const el = e.currentTarget
      if (
        el.scrollHeight - el.scrollTop - el.clientHeight < 320 &&
        shown < filtered.length
      ) {
        setShown((n) => Math.min(n + PAGE_SIZE, filtered.length))
      }
    },
    [shown, filtered.length]
  )

  const tabMeta = TABS.find((t) => t.id === activeTab)!
  const totalForTab =
    wantsOnline == null
      ? 0
      : bots.filter((b) => b.online === wantsOnline).length

  const runAction = async (
    label: string,
    promise: Promise<{ output: string }>
  ) => {
    try {
      const r = await promise
      setActionToast({
        kind: "ok",
        msg: `✓ ${label}: ${r.output.trim() || "OK"}`,
      })
      setOpenBotGuid(null)
    } catch (e) {
      setActionToast({ kind: "err", msg: `${label} failed: ${String(e)}` })
    }
  }

  return (
    // Flex-col instead of a fixed-row grid: the toast row used to
    // reserve gap space even when empty, leaving a bigger gap below
    // the card list than above the page edges. Flex naturally
    // collapses null children.
    <div className="flex h-full flex-col gap-3 p-6">
      <header className="space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <h1 className="flex items-center gap-2 font-heading text-2xl font-semibold leading-tight">
              <RobotIcon className="size-6 shrink-0 text-muted-foreground" />
              Player Bots
            </h1>
            <p className="text-sm text-muted-foreground">
              Browse the bots Playerbots maintains for you. Random bots
              live in the world and roam on their own; party bots are a
              pre-leveled pool waiting to be invited.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
            <ArrowClockwiseIcon
              className={cn("size-4", loading && "animate-spin")}
            />
            Refresh
          </Button>
        </div>

        <BotTypeTabs
          active={activeTab}
          onChange={setActiveTab}
          counts={countByType(bots)}
        />

        <p className="text-xs text-muted-foreground">{tabMeta.description}</p>

        {activeTab !== "settings" && (
          // Flex row, left-aligned. Search has a fixed sensible width,
          // dropdowns hug their content, the In Your Zone checkbox
          // sits at the right end (only on the world tab). Extra space
          // at the end is intentional — the user wants left-alignment
          // over edge-to-edge spread.
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-56">
              <MagnifyingGlassIcon className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search bot name…"
                className="pl-9"
              />
            </div>
            <Select
              value={roleFilter}
              onValueChange={(v) => setRoleFilter(v as "any" | Role)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLE_OPTIONS.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={classFilter} onValueChange={setClassFilter}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CLASS_FILTER_OPTIONS.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <SpecSelect
              classFilter={classFilter}
              value={specFilter}
              onValueChange={setSpecFilter}
            />
            <Select value={levelFilter} onValueChange={setLevelFilter}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LEVEL_OPTIONS.map((l) => (
                  <SelectItem key={l.value} value={l.value}>
                    {l.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {activeTab === "world" && (
              <label
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-1.5 text-xs",
                  !selectedCharacter && "cursor-not-allowed opacity-60"
                )}
                title={
                  !selectedCharacter
                    ? "Pick a character first — we use their saved zone to filter"
                    : `Filter to bots in your character's current zone (${selectedCharacter.zone})`
                }
              >
                <Checkbox
                  checked={inYourZone}
                  disabled={!selectedCharacter}
                  onCheckedChange={(v) => setInYourZone(v === true)}
                />
                <MapPinIcon className="size-3.5 text-muted-foreground" />
                <span>
                  In your zone
                  {selectedCharacter && (
                    <span className="ml-1 font-mono text-muted-foreground">
                      (#{selectedCharacter.zone})
                    </span>
                  )}
                </span>
              </label>
            )}
          </div>
        )}
      </header>

      {activeTab !== "settings" && (
        <ScrollProgress
          containerRef={scrollRef}
          className="relative h-[3px] w-full rounded-full"
        />
      )}

      {activeTab === "settings" ? (
        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          <BotSettingsTab />
        </div>
      ) : (
        // Relative wrapper hosts the ScrollFade overlay so it sits at
        // the bottom edge of the scroll viewport regardless of how
        // many cards fit. The scroll container itself takes h-full of
        // this wrapper.
        <div className="relative min-h-0 flex-1">
        <div
          ref={scrollRef}
          className="h-full overflow-y-auto pr-1 pb-3"
          onScroll={onListScroll}
        >
          {loadError ? (
            <ErrorPanel message={loadError} onRetry={refresh} />
          ) : loading && bots.length === 0 ? (
            <SkeletonGrid />
          ) : filtered.length === 0 ? (
            <EmptyState
              hasQuery={
                search.trim().length > 0 ||
                roleFilter !== "any" ||
                classFilter !== "0" ||
                specFilter !== "any" ||
                levelFilter !== "any" ||
                inYourZone
              }
              totalForTab={totalForTab}
            />
          ) : (
            <>
              <div
                className={cn(
                  // In-the-world tab keeps the existing 3-up tile grid
                  // since location info is meaningful and worth visual
                  // space. Bot pool tab switches to a single-column
                  // list — offline bots have no zone, so dense rows
                  // serve the "scan a long list of names" use case
                  // better.
                  activeTab === "pool"
                    ? "flex flex-col gap-1.5"
                    : "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
                )}
              >
                {paged.map((bot) => (
                  <BotTileWithMenu
                    key={bot.guid}
                    bot={bot}
                    compact={activeTab === "pool"}
                    open={openBotGuid === bot.guid}
                    onOpenChange={(o) =>
                      setOpenBotGuid(o ? bot.guid : null)
                    }
                    serverRunning={serverRunning}
                    hasCharacter={selectedCharacter != null}
                    onSetLevel={() => {
                      setOpenBotGuid(null)
                      setLevelDialogBot(bot)
                    }}
                    onSummon={() => {
                      if (!selectedCharacter) return
                      void runAction(
                        "Summon",
                        trackedInvoke("summon_playerbot_to_character", {
                          args: {
                            botName: bot.name,
                            characterName: selectedCharacter.name,
                          },
                        })
                      )
                    }}
                    onInspect={() => {
                      setOpenBotGuid(null)
                      openBotDetail({
                        guid: bot.guid,
                        classId: bot.class,
                        name: bot.name,
                      })
                    }}
                    isInParty={partyGuids.has(bot.guid)}
                    onInviteToParty={() => {
                      if (!selectedCharacter) return
                      void runAction(
                        "Invite to party",
                        trackedInvoke("invite_bot_to_party", {
                          args: {
                            botName: bot.name,
                            characterName: selectedCharacter.name,
                          },
                        })
                      ).then(() => void refreshPartyGuids())
                    }}
                    onKickFromParty={() => {
                      void runAction(
                        "Kick from party",
                        trackedInvoke("kick_bot_from_party", {
                          args: { botName: bot.name },
                        })
                      ).then(() => void refreshPartyGuids())
                    }}
                  />
                ))}
              </div>
              <div className="py-3 text-center text-xs text-muted-foreground">
                {shown < filtered.length
                  ? `Showing ${paged.length} of ${filtered.length} — scroll for more`
                  : `${filtered.length} bot${filtered.length === 1 ? "" : "s"}`}
              </div>
            </>
          )}
        </div>
        <ScrollFade visible={canScrollDown} />
        </div>
      )}

      {actionToast && (
        <div
          className={cn(
            "rounded-md border p-3 text-xs",
            actionToast.kind === "ok"
              ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400"
              : "border-rose-500/30 bg-rose-500/5 text-rose-600 dark:text-rose-400"
          )}
        >
          <button
            type="button"
            onClick={() => setActionToast(null)}
            className="float-right ml-2 text-muted-foreground hover:text-foreground"
            aria-label="Dismiss"
          >
            ×
          </button>
          {actionToast.msg}
        </div>
      )}

      <SetLevelDialog
        bot={levelDialogBot}
        onClose={() => setLevelDialogBot(null)}
        onApply={async (newLevel) => {
          if (!levelDialogBot) return
          await runAction(
            `Set ${levelDialogBot.name} to lvl ${newLevel}`,
            trackedInvoke("set_playerbot_level", {
              args: { botName: levelDialogBot.name, level: newLevel },
            })
          )
          setLevelDialogBot(null)
        }}
      />
    </div>
  )
}

function countByType(bots: Playerbot[]): Record<TabId, number | null> {
  let world = 0
  let pool = 0
  for (const b of bots) {
    if (b.online) world++
    else pool++
  }
  return { world, pool, settings: null }
}

function BotTypeTabs({
  active,
  onChange,
  counts,
}: {
  active: TabId
  onChange: (id: TabId) => void
  counts: Record<TabId, number | null>
}) {
  return (
    <div className="flex flex-wrap gap-1.5 rounded-md border border-border bg-muted/30 p-1">
      {TABS.map((t) => {
        const Icon =
          t.id === "world"
            ? RobotIcon
            : t.id === "pool"
              ? UsersThreeIcon
              : GearSixIcon
        const count = counts[t.id]
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onChange(t.id)}
            className={cn(
              "flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium transition-colors",
              active === t.id
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            <Icon className="size-3.5" />
            {t.label}
            {count != null && (
              <span
                className={cn(
                  "rounded-full px-1.5 py-0 text-[10px]",
                  active === t.id
                    ? "bg-primary-foreground/20 text-primary-foreground"
                    : "bg-muted text-muted-foreground"
                )}
              >
                {count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

function BotTileWithMenu({
  bot,
  open,
  onOpenChange,
  serverRunning,
  hasCharacter,
  isInParty,
  compact = false,
  onSetLevel,
  onSummon,
  onInspect,
  onInviteToParty,
  onKickFromParty,
}: {
  bot: Playerbot
  open: boolean
  onOpenChange: (open: boolean) => void
  /** True when the worldserver is up. SOAP actions silently fail without
   * it, so we surface that to the user. */
  serverRunning: boolean
  /** True when the user has picked a sidebar character. Summon needs
   * one as the destination. */
  hasCharacter: boolean
  /** True when this bot is currently a member of the user's group.
   *  Swaps the primary popover action between Add-to-Party / Kick. */
  isInParty: boolean
  /** Compact single-row layout. Used on the Bot Pool tab where bots
   *  have no live zone info worth a 3-line tile. */
  compact?: boolean
  onSetLevel: () => void
  onSummon: () => void
  onInspect: () => void
  onInviteToParty: () => void
  onKickFromParty: () => void
}) {
  // Auto-close timer — restart whenever the user enters either the
  // card or the popover, expire after 4s of no hover on either.
  const timerRef = React.useRef<number | null>(null)
  const startTimer = React.useCallback(() => {
    if (timerRef.current != null) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(
      () => onOpenChange(false),
      POPOVER_AUTO_CLOSE_MS
    )
  }, [onOpenChange])
  const clearTimer = React.useCallback(() => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])
  React.useEffect(() => {
    if (open) startTimer()
    else clearTimer()
    return clearTimer
  }, [open, startTimer, clearTimer])

  const fullClassName = CLASS_NAMES[bot.class] ?? `#${bot.class}`
  const shortClassName = CLASS_SHORT_NAMES[bot.class] ?? fullClassName
  const raceName = RACE_NAMES[bot.race] ?? `#${bot.race}`
  const classColor = CLASS_COLORS[bot.class] ?? "text-foreground"
  const iconName = CLASS_ICON_NAMES[bot.class]
  const ringColor = CLASS_COLOR_HEX[bot.class] ?? "#888"
  const spec = specName(bot.class, bot.specTabIndex, true)
  const mapLabel = mapName(bot.map)
  const zoneLabel = zoneName(bot.zone)

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          onMouseEnter={clearTimer}
          onMouseLeave={() => {
            if (open) startTimer()
          }}
          className={cn(
            // Asymmetric padding: tighter on the left so the icon sits
            // closer to the card edge per UX feedback. Vertical padding
            // trimmed from p-4 → py-3 to lower overall card height
            // without touching content size. gap-3 restored so the
            // icon-to-text gap is the same as before; the OTHER gap
            // (card-edge to icon) is what shrank.
            "group flex w-full items-center rounded-md border border-border bg-card text-left transition-colors hover:border-primary/40",
            compact
              ? "gap-2.5 py-1.5 pl-2 pr-3"
              : "gap-3 py-3 pl-3 pr-4",
            open && "border-primary/60 ring-1 ring-primary/30"
          )}
        >
          <div
            className={cn(
              "flex shrink-0 items-center justify-center overflow-hidden rounded border-2 bg-muted",
              compact ? "size-9" : "size-14"
            )}
            style={{ borderColor: ringColor }}
          >
            {iconName ? (
              <img
                src={`https://wow.zamimg.com/images/wow/icons/large/${iconName}.jpg`}
                alt={fullClassName}
                className="size-full object-cover"
                draggable={false}
              />
            ) : (
              <RobotIcon className="size-7 text-muted-foreground" />
            )}
          </div>
          {/* space-y-0.5 + leading-tight on every line keeps the three
              lines visually consistent — line 1's text-base was
              previously inflating that gap because line 2/3 used
              default 1.5 leading. */}
          <div className="min-w-0 flex-1 space-y-0.5">
            {/* Line 1 — identity: name in the class-color, race
                rendered in the same muted style as lines 2/3 so only
                the name draws the eye. */}
            <div className="truncate leading-tight" title={`${bot.name} · ${raceName}`}>
              <span
                className={cn(
                  "font-semibold",
                  classColor,
                  compact ? "text-sm" : "text-base"
                )}
              >
                {bot.name}
              </span>
              <span
                className={cn(
                  "text-muted-foreground",
                  compact ? "text-xs" : "text-sm"
                )}
              >
                {" "}· {raceName}
              </span>
            </div>
            {/* Line 2 — combat profile: Lv N · Spec · Class. Spec is
                hidden when unknown rather than showing "—" so low-
                level pool bots without talents read cleanly. */}
            <div
              className={cn(
                "truncate leading-tight text-muted-foreground",
                compact ? "text-xs" : "text-sm"
              )}
            >
              Lv {bot.level}
              {spec && (
                <>
                  {" · "}
                  <span className="font-medium text-foreground/80">{spec}</span>
                </>
              )}
              {" · "}
              {shortClassName}
            </div>
            {/* Line 3 — location: Map · Zone. Skipped in compact mode
                since offline pool bots have no live location (the
                stored zone is wherever they were last). */}
            {!compact && (mapLabel || zoneLabel) && (
              <div className="truncate text-xs leading-tight text-muted-foreground">
                {mapLabel}
                {zoneLabel && (
                  <>
                    {mapLabel ? " · " : ""}
                    {zoneLabel}
                  </>
                )}
              </div>
            )}
          </div>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="center"
        side="bottom"
        className="w-64 p-2"
        onMouseEnter={clearTimer}
        onMouseLeave={startTimer}
        // Don't steal focus from the page — Radix's default focus-trap
        // pulls the scroll position around when the popover opens deep
        // in the grid. Action buttons remain keyboard-focusable from tab.
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        {!serverRunning && (
          <div className="mb-1.5 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-[11px] text-amber-700 dark:text-amber-300">
            <WarningCircleIcon className="mt-px size-3.5 shrink-0" />
            <span>
              Server is stopped. Bot actions need the worldserver
              running — start it from the sidebar.
            </span>
          </div>
        )}
        <div className="space-y-0.5">
          <ActionButton
            icon={<MagnifyingGlassIcon className="size-4" />}
            label="View details"
            onClick={onInspect}
            tooltip="Open the bot's gear + talents detail page"
          />
          <ActionButton
            icon={<ChartBarIcon className="size-4" />}
            label="Set level"
            onClick={onSetLevel}
            disabled={!serverRunning}
            tooltip={
              !serverRunning
                ? "Start the server first — Set Level uses SOAP"
                : undefined
            }
          />
          <ActionButton
            icon={<PaperPlaneTiltIcon className="size-4" />}
            label="Teleport bot to me"
            onClick={onSummon}
            disabled={!serverRunning || !hasCharacter}
            tooltip={
              !serverRunning
                ? "Start the server first — Teleport uses SOAP"
                : !hasCharacter
                  ? "Pick a character first (sidebar)"
                  : "Moves this bot to your character's saved position"
            }
          />
          {isInParty ? (
            <ActionButton
              icon={<UserMinusIcon className="size-4" />}
              label="Kick from party"
              onClick={onKickFromParty}
              disabled={!serverRunning}
              tooltip={
                !serverRunning
                  ? "Start the server first — kick goes through SOAP + Eluna"
                  : "Removes the bot from your group. They stay online and can be re-added later."
              }
            />
          ) : (
            <ActionButton
              icon={<UsersThreeIcon className="size-4" />}
              label="Add to my party"
              onClick={onInviteToParty}
              disabled={!serverRunning || !hasCharacter}
              tooltip={
                !serverRunning
                  ? "Start the server first — invites go through SOAP + Eluna"
                  : !hasCharacter
                    ? "Pick a character first (sidebar)"
                    : "Whispers `invite` to the bot via Eluna — the bot sends you a standard group invite popup; click accept in-game."
              }
            />
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function ActionButton({
  icon,
  label,
  onClick,
  disabled,
  tooltip,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  disabled?: boolean
  tooltip?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={tooltip}
      className={cn(
        "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors",
        disabled
          ? "cursor-not-allowed text-muted-foreground/60"
          : "text-foreground hover:bg-accent hover:text-accent-foreground"
      )}
    >
      <span className="text-muted-foreground">{icon}</span>
      <span className="flex-1">{label}</span>
    </button>
  )
}

function SetLevelDialog({
  bot,
  onClose,
  onApply,
}: {
  bot: Playerbot | null
  onClose: () => void
  onApply: (level: number) => void
}) {
  const [level, setLevel] = React.useState(80)
  React.useEffect(() => {
    if (bot) setLevel(bot.level)
  }, [bot])
  return (
    <Dialog open={bot != null} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Set level</DialogTitle>
          <DialogDescription>
            Change <span className="font-mono">{bot?.name}</span> to a
            new level (1-80). Re-roll afterward if you want the gear to
            match.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">
              New level
            </span>
            <span className="font-mono text-lg font-semibold">{level}</span>
          </div>
          <Slider
            value={[level]}
            min={1}
            max={80}
            step={1}
            onValueChange={(v) => setLevel(v[0] ?? level)}
            aria-label="New level"
          />
        </div>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={onClose}>
            <ArrowUUpLeftIcon className="size-4" />
            Cancel
          </Button>
          <Button onClick={() => onApply(level)} disabled={!bot}>
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Spec dropdown — disabled until a class is picked, since "Holy" is
 * tab 0 for Paladin but tab 1 for Priest, etc. When enabled, shows
 * only the three specs that exist for the selected class.
 */
function SpecSelect({
  classFilter,
  value,
  onValueChange,
}: {
  classFilter: string
  value: string
  onValueChange: (v: string) => void
}) {
  const cls = parseInt(classFilter, 10)
  const enabled = cls > 0 && SPEC_NAMES[cls] != null
  const specs = enabled ? SPEC_NAMES[cls] : null
  return (
    <Select value={value} onValueChange={onValueChange} disabled={!enabled}>
      <SelectTrigger
        title={
          enabled
            ? undefined
            : "Pick a class first — specs are class-specific"
        }
      >
        <SelectValue placeholder={enabled ? undefined : "Any spec"} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="any">Any spec</SelectItem>
        {specs?.map((name, i) => (
          <SelectItem key={i} value={String(i)}>
            {name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

// ── Bot Settings tab ─────────────────────────────────────────────────

type BuildDatasetResult = {
  specCount: number
  buildCount: number
  sourceFile: string
  outputPath: string
  partialDecodes: string[]
}

type BuildTreesResult = {
  classCount: number
  talentCount: number
  outputPath: string
}

function BotSettingsTab() {
  return (
    <div className="space-y-6 pr-1 pb-6">
      <DatasetPanel />
      <TreeDatasetPanel />
      <ComingSoonStub
        icon={<UsersThreeIcon className="size-5" />}
        title="Bot chatter"
        description="Stepped slider — None / Light / Medium / Heavy. Writes the relevant playerbots.conf knobs (RandomBotTalk, RandomBotEmote, broadcast chances) and runs .playerbots rndbot reload to apply at runtime."
      />
      <ComingSoonStub
        icon={<RobotIcon className="size-5" />}
        title="Ambient density"
        description="What percentage of the random bot pool is actively walking around the world at any given time. Surfaces BotActiveAlone from the conf as a 0–100 slider."
      />
    </div>
  )
}

function DatasetPanel() {
  const [result, setResult] = React.useState<BuildDatasetResult | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)

  const run = async () => {
    setBusy(true)
    setError(null)
    try {
      const r = await trackedInvoke<BuildDatasetResult>("build_talent_dataset")
      setResult(r)
    } catch (e) {
      setError(typeof e === "string" ? e : String(e))
      setResult(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3 rounded-md border border-border bg-card p-4">
      <div className="flex items-start gap-3">
        <TreeStructureIcon className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
        <div className="flex-1 space-y-1">
          <div className="text-sm font-semibold leading-tight">
            Talent build dataset
          </div>
          <p className="text-xs text-muted-foreground">
            Parses your installed{" "}
            <span className="font-mono">playerbots.conf.dist</span> for
            its <span className="font-mono">PremadeSpecLink</span> +{" "}
            <span className="font-mono">PremadeSpecName</span> entries,
            decodes the Wowhead-format talent links via the cached
            talent metadata, and writes the result as JSON next to the
            other app data. Covers every spec the mod knows about at Lv
            60 / 65 / 70 / 80 — Vanilla through WotLK endgame. Used by
            the My Party wizard to apply a chosen spec to a recruited
            bot. Re-run after updating the mod.
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button onClick={run} disabled={busy} size="sm">
          {busy ? (
            <>
              <ArrowClockwiseIcon className="size-3.5 animate-spin" />
              Building…
            </>
          ) : (
            <>
              <MagicWandIcon className="size-3.5" />
              {result ? "Rebuild dataset" : "Build talent dataset"}
            </>
          )}
        </Button>
      </div>
      {error && (
        <div className="rounded-md border border-rose-500/30 bg-rose-500/5 p-3 text-xs text-rose-700 dark:text-rose-400">
          <div className="flex items-start gap-2">
            <WarningCircleIcon className="mt-0.5 size-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        </div>
      )}
      {result && <DatasetResultPanel result={result} />}
    </div>
  )
}

function DatasetResultPanel({ result }: { result: BuildDatasetResult }) {
  return (
    <div className="space-y-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs text-emerald-700 dark:text-emerald-400">
      <div className="flex items-start gap-2">
        <CheckCircleIcon className="mt-0.5 size-4 shrink-0" />
        <div className="flex-1 space-y-1">
          <div className="font-medium">
            Built {result.buildCount} build
            {result.buildCount === 1 ? "" : "s"} across{" "}
            {result.specCount} spec{result.specCount === 1 ? "" : "s"}.
          </div>
          <div className="space-y-0.5 font-mono text-[10px] text-emerald-700/70 dark:text-emerald-400/70">
            <div>source: {result.sourceFile}</div>
            <div>output: {result.outputPath}</div>
          </div>
          <div className="text-[11px] text-emerald-700/80 dark:text-emerald-400/80">
            Commit the output file with your next change so released
            builds include it.
          </div>
        </div>
      </div>
      {result.partialDecodes.length > 0 && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-[11px] text-amber-700 dark:text-amber-400">
          <strong>
            {result.partialDecodes.length} build
            {result.partialDecodes.length === 1 ? "" : "s"} decoded
            partially:
          </strong>{" "}
          {result.partialDecodes.slice(0, 12).join(", ")}
          {result.partialDecodes.length > 12 ? "…" : ""} — at least one
          talent in each couldn't be resolved against the talent cache.
          Usually means the cache is from a different patch than the
          conf. Re-run Settings → Talents → Extract.
        </div>
      )}
    </div>
  )
}

function TreeDatasetPanel() {
  const [result, setResult] = React.useState<BuildTreesResult | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)

  const run = async () => {
    setBusy(true)
    setError(null)
    try {
      const r = await trackedInvoke<BuildTreesResult>("build_talent_trees")
      setResult(r)
    } catch (e) {
      setError(typeof e === "string" ? e : String(e))
      setResult(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3 rounded-md border border-border bg-card p-4">
      <div className="flex items-start gap-3">
        <TreeStructureIcon className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
        <div className="flex-1 space-y-1">
          <div className="text-sm font-semibold leading-tight">
            Talent tree layouts
          </div>
          <p className="text-xs text-muted-foreground">
            Reads Talent.dbc / TalentTab.dbc / Spell.dbc / SpellIcon.dbc
            from your connected WoW client and emits a static per-class
            tree layout (name, icon, position, prereqs, rank ladder)
            committed to{" "}
            <span className="font-mono">src/lib/talent-trees.json</span>.
            Powers the in-app talent tree views for player + bot detail.
            Re-run only after a client patch update.
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button onClick={run} disabled={busy} size="sm">
          {busy ? (
            <>
              <ArrowClockwiseIcon className="size-3.5 animate-spin" />
              Building…
            </>
          ) : (
            <>
              <MagicWandIcon className="size-3.5" />
              {result ? "Rebuild trees" : "Build talent trees"}
            </>
          )}
        </Button>
      </div>
      {error && (
        <div className="rounded-md border border-rose-500/30 bg-rose-500/5 p-3 text-xs text-rose-700 dark:text-rose-400">
          <div className="flex items-start gap-2">
            <WarningCircleIcon className="mt-0.5 size-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        </div>
      )}
      {result && (
        <div className="space-y-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs text-emerald-700 dark:text-emerald-400">
          <div className="flex items-start gap-2">
            <CheckCircleIcon className="mt-0.5 size-4 shrink-0" />
            <div className="flex-1 space-y-1">
              <div className="font-medium">
                Built {result.talentCount} talents across{" "}
                {result.classCount} classes.
              </div>
              <div className="font-mono text-[10px] text-emerald-700/70 dark:text-emerald-400/70">
                output: {result.outputPath}
              </div>
              <div className="text-[11px] text-emerald-700/80 dark:text-emerald-400/80">
                Commit the output file with your next change so released
                builds include it.
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function ComingSoonStub({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode
  title: string
  description: string
}) {
  return (
    <div className="rounded-md border border-dashed border-border bg-muted/20 p-4 opacity-70">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 shrink-0 text-muted-foreground">{icon}</div>
        <div className="flex-1 space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">{title}</span>
            <span className="rounded-full bg-muted px-1.5 py-0 text-[10px] text-muted-foreground">
              Coming soon
            </span>
          </div>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
      </div>
    </div>
  )
}

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-1 gap-3 pb-3 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 9 }).map((_, i) => (
        <div
          key={i}
          className="h-20 animate-pulse rounded-md border border-border bg-muted/30"
        />
      ))}
    </div>
  )
}

function EmptyState({
  hasQuery,
  totalForTab,
}: {
  hasQuery: boolean
  totalForTab: number
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border bg-muted/20 p-12 text-center text-sm text-muted-foreground">
      <RobotIcon className="size-8" />
      <div>
        {hasQuery
          ? "No bots match these filters."
          : totalForTab === 0
            ? "No bots in this tab yet — the Playerbots mod hasn't spawned any."
            : "Loading bots…"}
      </div>
    </div>
  )
}

function ErrorPanel({
  message,
  onRetry,
}: {
  message: string
  onRetry: () => void
}) {
  return (
    <div className="rounded-md border border-rose-500/30 bg-rose-500/5 p-4 text-sm text-rose-600 dark:text-rose-400">
      <div className="font-medium">Couldn't load Player Bots</div>
      <div className="mt-1 text-xs">{message}</div>
      <Button size="sm" variant="outline" className="mt-3" onClick={onRetry}>
        Retry
      </Button>
    </div>
  )
}
