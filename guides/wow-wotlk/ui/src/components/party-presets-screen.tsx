import * as React from "react"
import {
  CheckCircleIcon,
  CircleNotchIcon,
  ClipboardTextIcon,
  DownloadSimpleIcon,
  FloppyDiskIcon,
  HeartIcon,
  PencilSimpleIcon,
  PlayIcon,
  ShieldIcon,
  SwordIcon,
  TrashIcon,
  UsersThreeIcon,
  WarningCircleIcon,
  WarningIcon,
  XCircleIcon,
} from "@phosphor-icons/react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card"
import { Label } from "@/components/ui/label"
import { GearSlotIcon } from "@/components/gear-slot-icon"
import { ItemTooltip, type ItemMini } from "@/components/item-tooltip"
import { useServerState } from "@/components/server-state-context"
import { isTauri, trackedInvoke } from "@/lib/tauri"
import {
  GEAR_SLOT_LABELS,
  parseGear,
  parseGearSpec,
  presetBotClassId,
  talentDistribution,
  targetSummary,
  type GearItem,
  type ImportResult,
  type PresetBot,
  type PresetEntry,
} from "@/lib/party-presets"
import { CLASS_COLORS, CLASS_NAMES } from "@/lib/wow-character-enums"
import { ROLE_LABELS, type Role } from "@/lib/wow-spec-roles"
import { cn } from "@/lib/utils"

// Quality → text color, mirroring the inventory grid + item tooltip.
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

/**
 * Party Presets page. Lists saved party compositions, lets the user
 * import a shared TOML block, and — with one click — tears down the
 * current party and re-summons a preset's bots, each leveled, specced,
 * and auto-geared via the existing `add_bot_to_party` pipeline.
 */

interface PartyMember {
  guid: number
  name: string
  isLeader: boolean
}

export function PartyPresetsScreen() {
  const { selectedCharacter } = useServerState()
  const [presets, setPresets] = React.useState<PresetEntry[]>([])
  const [loading, setLoading] = React.useState(true)
  const [importOpen, setImportOpen] = React.useState(false)
  const [setupTarget, setSetupTarget] = React.useState<PresetEntry | null>(null)

  const refresh = React.useCallback(async () => {
    if (!isTauri()) {
      setLoading(false)
      return
    }
    try {
      const list = await trackedInvoke<PresetEntry[]>("list_party_presets")
      setPresets(list)
    } catch (e) {
      toast.error("Couldn't load presets", {
        description: typeof e === "string" ? e : String(e),
      })
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void refresh()
  }, [refresh])

  const handleDelete = async (entry: PresetEntry) => {
    try {
      await trackedInvoke("delete_party_preset", { id: entry.id })
      toast.success(`Deleted "${entry.preset.preset_info.name}"`)
      setPresets((prev) => prev.filter((p) => p.id !== entry.id))
    } catch (e) {
      toast.error("Delete failed", {
        description: typeof e === "string" ? e : String(e),
      })
    }
  }

  const handleCopy = async (entry: PresetEntry) => {
    try {
      await navigator.clipboard.writeText(entry.raw_toml)
      toast.success("Preset TOML copied", {
        description: "Paste it in Discord to share this party.",
      })
    } catch {
      toast.error("Couldn't copy to clipboard")
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-4 pt-3 pb-6 lg:px-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <UsersThreeIcon className="size-6 text-primary" weight="fill" />
            Party Presets
            <span className="text-sm font-medium text-orange-500">
              [EXPERIMENTAL]
            </span>
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Save party setups and rebuild them in one click — or import a
            party someone shared.
          </p>
        </div>
        <Button variant="outline" onClick={() => setImportOpen(true)}>
          <DownloadSimpleIcon className="size-4" />
          Import
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
          <CircleNotchIcon className="size-4 animate-spin" />
          Loading presets…
        </div>
      ) : presets.length === 0 ? (
        <EmptyState onImport={() => setImportOpen(true)} />
      ) : (
        <div className="space-y-3">
          {presets.map((entry) => (
            <PresetCard
              key={entry.id}
              entry={entry}
              onSetup={() => setSetupTarget(entry)}
              onCopy={() => handleCopy(entry)}
              onDelete={() => handleDelete(entry)}
              onEdited={(updated) =>
                setPresets((prev) =>
                  prev.map((p) => (p.id === updated.id ? updated : p))
                )
              }
            />
          ))}
        </div>
      )}

      <ImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={(result) => {
          setPresets((prev) => {
            const without = prev.filter((p) => p.id !== result.entry.id)
            return [...without, result.entry].sort((a, b) =>
              a.id.localeCompare(b.id)
            )
          })
        }}
      />

      <SetupDialog
        entry={setupTarget}
        onOpenChange={(open) => {
          if (!open) setSetupTarget(null)
        }}
        playerName={selectedCharacter?.name ?? null}
        playerGuid={selectedCharacter?.guid ?? null}
      />
    </div>
  )
}

// ── empty state ───────────────────────────────────────────────────────

function EmptyState({ onImport }: { onImport: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-md border border-dashed border-border bg-muted/10 p-8 text-center">
      <UsersThreeIcon className="size-10 text-muted-foreground/50" />
      <div className="space-y-1">
        <div className="font-semibold">No saved parties yet</div>
        <p className="mx-auto max-w-sm text-sm text-muted-foreground">
          Build a party on the Dashboard's{" "}
          <span className="font-medium">My Party</span> tab, then hit{" "}
          <span className="font-medium">Save party</span> to keep it here.
          Or import one a friend shared.
        </p>
      </div>
      <Button variant="outline" onClick={onImport}>
        <DownloadSimpleIcon className="size-4" />
        Import a shared party
      </Button>
    </div>
  )
}

// ── role glyphs ───────────────────────────────────────────────────────

function RoleIcon({ role, className }: { role: string; className?: string }) {
  if (role === "tank")
    return (
      <ShieldIcon className={cn("text-blue-400", className)} weight="fill" />
    )
  if (role === "healer")
    return (
      <HeartIcon className={cn("text-emerald-400", className)} weight="fill" />
    )
  return <SwordIcon className={cn("text-rose-400", className)} weight="fill" />
}

// ── preset card ───────────────────────────────────────────────────────

function PresetCard({
  entry,
  onSetup,
  onCopy,
  onDelete,
  onEdited,
}: {
  entry: PresetEntry
  onSetup: () => void
  onCopy: () => void
  onDelete: () => void
  onEdited: (updated: PresetEntry) => void
}) {
  const [confirmDelete, setConfirmDelete] = React.useState(false)
  const [editOpen, setEditOpen] = React.useState(false)
  const { preset } = entry
  const bots = preset.party.bots

  // Resolve every gear id once per card → real name + rarity. Feeds the
  // hover popovers' coloring AND the "names don't match their ID" badge
  // on the Edit button.
  const gearIds = React.useMemo(() => {
    const s = new Set<number>()
    for (const b of bots) for (const g of parseGear(b.gear)) s.add(g.id)
    return [...s]
  }, [bots])

  const [meta, setMeta] = React.useState<Map<number, ItemMini>>(new Map())
  React.useEffect(() => {
    if (gearIds.length === 0 || !isTauri()) return
    let cancelled = false
    trackedInvoke<ItemMini[]>("get_items_by_entries", { entries: gearIds })
      .then((rows) => {
        if (!cancelled) setMeta(new Map(rows.map((r) => [r.entry, r])))
      })
      .catch(() => {
        /* coloring/validation just degrade gracefully */
      })
    return () => {
      cancelled = true
    }
  }, [gearIds])

  const mismatchCount = React.useMemo(() => {
    let n = 0
    for (const b of bots) {
      for (const g of parseGear(b.gear)) {
        const real = meta.get(g.id)?.name
        if (
          real &&
          g.name &&
          real.trim().toLowerCase() !== g.name.trim().toLowerCase()
        ) {
          n++
        }
      }
    }
    return n
  }, [bots, meta])

  return (
    <div className="rounded-md border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-base font-semibold">
            {preset.preset_info.name}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <Badge variant="secondary" className="font-normal">
              {targetSummary(preset.preset_info.target)}
            </Badge>
            <span>
              {bots.length} bot{bots.length === 1 ? "" : "s"}
            </span>
            {preset.preset_info.author && (
              <span>· by {preset.preset_info.author}</span>
            )}
            {preset.party.player?.role && (
              <span>· you: {preset.party.player.role}</span>
            )}
          </div>
        </div>
        <Button size="sm" onClick={onSetup} className="shrink-0">
          <PlayIcon className="size-4" weight="fill" />
          Set up
        </Button>
      </div>

      {/* Bot chips */}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {bots.map((b, i) => (
          <BotChip key={i} bot={b} meta={meta} />
        ))}
      </div>

      <div className="mt-3 flex items-center gap-1.5">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs text-muted-foreground"
          onClick={onCopy}
        >
          <ClipboardTextIcon className="size-3.5" />
          Copy TOML
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            "h-7 px-2 text-xs",
            mismatchCount > 0
              ? "text-amber-600 dark:text-amber-400"
              : "text-muted-foreground"
          )}
          onClick={() => setEditOpen(true)}
          title={
            mismatchCount > 0
              ? `${mismatchCount} item name${mismatchCount === 1 ? "" : "s"} don't match their ID — click Edit to fix`
              : "Edit the raw TOML"
          }
        >
          <PencilSimpleIcon className="size-3.5" />
          Edit
          {mismatchCount > 0 && (
            <WarningIcon className="size-3.5 text-amber-500" weight="fill" />
          )}
        </Button>
        {confirmDelete ? (
          <>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-destructive"
              onClick={onDelete}
            >
              <TrashIcon className="size-3.5" />
              Confirm delete
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-muted-foreground"
              onClick={() => setConfirmDelete(false)}
            >
              Cancel
            </Button>
          </>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-muted-foreground"
            onClick={() => setConfirmDelete(true)}
          >
            <TrashIcon className="size-3.5" />
            Delete
          </Button>
        )}
      </div>

      <EditPresetDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        entry={entry}
        initialMeta={meta}
        onSaved={onEdited}
      />
    </div>
  )
}

function BotChip({ bot, meta }: { bot: PresetBot; meta: Map<number, ItemMini> }) {
  const classId = presetBotClassId(bot)
  const cls = classId != null ? CLASS_NAMES[classId] ?? bot.class : bot.class
  const color =
    classId != null ? CLASS_COLORS[classId] ?? "text-foreground" : "text-foreground"
  const unknown = classId == null

  return (
    <HoverCard openDelay={120} closeDelay={140}>
      <HoverCardTrigger asChild>
        <span
          tabIndex={0}
          className={cn(
            "inline-flex cursor-default items-center gap-1.5 rounded-md border px-2 py-1 text-xs outline-none transition-colors hover:border-primary/50 focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30",
            unknown
              ? "border-amber-500/40 bg-amber-500/5"
              : "border-border bg-muted/30"
          )}
        >
          <RoleIcon role={bot.role} className="size-3.5" />
          <span className={cn("font-medium", color)}>
            {bot.spec ? `${bot.spec} ` : ""}
            {cls}
          </span>
          <span className="text-muted-foreground">Lv {bot.level}</span>
        </span>
      </HoverCardTrigger>
      {/* w-max sizes the card to its widest line — the (nowrap) header —
          so the title never wraps. min/max keep short combos from
          collapsing and long item names from blowing it out. */}
      <HoverCardContent
        side="bottom"
        align="start"
        className="w-max min-w-[15rem] max-w-[22rem] p-0"
      >
        <BotDetailCard
          bot={bot}
          classId={classId}
          cls={cls}
          color={color}
          meta={meta}
        />
      </HoverCardContent>
    </HoverCard>
  )
}

/** Contents of the bot badge's hover popover: a header line
 *  (role · class · spec (a/b/c)) and the gear list — slot icon + a
 *  rarity-colored, individually-hoverable item name. */
function BotDetailCard({
  bot,
  classId,
  cls,
  color,
  meta,
}: {
  bot: PresetBot
  classId: number | null
  cls: string
  color: string
  /** Resolved item id → {name, quality}, fetched once by the card. */
  meta: Map<number, ItemMini>
}) {
  const gearSpec = React.useMemo(() => parseGearSpec(bot.gear), [bot.gear])
  const dist = talentDistribution(bot.talents)
  const roleLabel = ROLE_LABELS[bot.role as Role] ?? bot.role

  return (
    <div className="overflow-hidden rounded-md">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-3 py-2">
        <RoleIcon role={bot.role} className="size-4 shrink-0" />
        <div className="whitespace-nowrap text-sm">
          <span className="text-muted-foreground">{roleLabel} · </span>
          <span className={cn("font-semibold", color)}>{cls}</span>
          {bot.spec && (
            <span className="text-foreground/80"> · {bot.spec}</span>
          )}
          {dist && (
            <span className="font-mono text-xs text-muted-foreground">
              {" "}
              ({dist.join("/")})
            </span>
          )}
        </div>
      </div>

      {/* Gear — `w-0 min-w-full` makes this stretch to the header-set
          width without its (long) item names contributing to the card's
          intrinsic width, so names truncate to the header instead. */}
      <div className="w-0 min-w-full max-h-72 overflow-y-auto p-1.5">
        {classId == null && (
          <div className="px-2 py-1.5 text-xs text-amber-600 dark:text-amber-400">
            Unknown class "{bot.class}" — this bot may not spawn.
          </div>
        )}
        {gearSpec.allAuto ? (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">
            All gear is auto-rolled for this bot's level and spec when you
            set the party up.
          </div>
        ) : (
          <>
            {gearSpec.items.map((g) => (
              <GearRow key={g.slot} item={g} quality={meta.get(g.id)?.quality} />
            ))}
            {gearSpec.autoSlots.map((slot) => (
              <AutoGearRow key={slot} slot={slot} />
            ))}
            {/* Any slot the author didn't name is auto-filled too, and a
                failed explicit equip falls back to auto — so note it. */}
            <div className="px-2 pt-1 text-[11px] text-muted-foreground/80">
              Unlisted slots are auto-filled.
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function GearRow({
  item,
  quality,
}: {
  item: GearItem
  quality?: number
}) {
  const colorClass =
    quality != null ? QUALITY_COLORS[quality] ?? "text-foreground" : "text-foreground"
  return (
    <div className="flex items-center gap-2 rounded px-2 py-1">
      <GearSlotIcon
        slot={item.slot}
        className="size-4 text-muted-foreground"
      />
      <ItemTooltip entry={item.id} side="left" align="start">
        <span
          className={cn(
            "min-w-0 flex-1 cursor-default truncate text-sm hover:underline",
            colorClass
          )}
          title={GEAR_SLOT_LABELS[item.slot] ?? item.slot}
        >
          {item.name ?? `Item #${item.id}`}
        </span>
      </ItemTooltip>
    </div>
  )
}

/** A gear slot the author left to the module (auto = true). */
function AutoGearRow({ slot }: { slot: string }) {
  return (
    <div className="flex items-center gap-2 rounded px-2 py-1 text-muted-foreground">
      <GearSlotIcon slot={slot} className="size-4 opacity-60" />
      <span className="min-w-0 flex-1 truncate text-sm">
        {GEAR_SLOT_LABELS[slot] ?? slot}
      </span>
      <span className="shrink-0 rounded-sm border border-border px-1 text-[10px] uppercase tracking-wide">
        Auto
      </span>
    </div>
  )
}

// ── import dialog ─────────────────────────────────────────────────────

function ImportDialog({
  open,
  onOpenChange,
  onImported,
}: {
  open: boolean
  onOpenChange: (next: boolean) => void
  onImported: (result: ImportResult) => void
}) {
  const [text, setText] = React.useState("")
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    if (!open) {
      setText("")
      setBusy(false)
    }
  }, [open])

  const handleImport = async () => {
    if (!text.trim() || !isTauri()) return
    setBusy(true)
    try {
      const result = await trackedInvoke<ImportResult>(
        "import_party_preset_toml",
        { tomlText: text }
      )
      onImported(result)
      if (result.warnings.length > 0) {
        toast.warning(`Imported "${result.entry.preset.preset_info.name}"`, {
          description: result.warnings.join(" "),
          duration: 8000,
        })
      } else {
        toast.success(`Imported "${result.entry.preset.preset_info.name}"`)
      }
      onOpenChange(false)
    } catch (e) {
      toast.error("Import failed", {
        description: typeof e === "string" ? e : String(e),
        duration: 8000,
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <DownloadSimpleIcon className="size-5 text-primary" />
            Import a party
          </DialogTitle>
          <DialogDescription>
            Paste a party preset (TOML) someone shared. Talents are read
            from Wowhead links or talent strings; gear is auto-rolled when
            you set the party up.
          </DialogDescription>
        </DialogHeader>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
          placeholder={
            'schema_version = 1\n\n[preset_info]\nname = "Early BRD"\ntarget = { type = "dungeon", name = "BRD" }\n\n[[party.bots]]\nrole = "tank"\nclass = "warrior"\nlevel = 54\ntalents = "..."'
          }
          className="h-64 w-full resize-none rounded-md border border-border bg-muted/20 p-3 font-mono text-xs leading-relaxed focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
        />

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleImport} disabled={!text.trim() || busy}>
            <DownloadSimpleIcon className="size-4" />
            {busy ? "Importing…" : "Import"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── setup (clear + resummon) dialog ───────────────────────────────────

type StepStatus = "pending" | "running" | "done" | "warn" | "error"

interface BotProgress {
  label: string
  status: StepStatus
  detail?: string
}

function SetupDialog({
  entry,
  onOpenChange,
  playerName,
  playerGuid,
}: {
  entry: PresetEntry | null
  onOpenChange: (open: boolean) => void
  playerName: string | null
  playerGuid: number | null
}) {
  const open = entry !== null
  // "saved" → each bot at its stored level; number → all bots at that level.
  const [levelMode, setLevelMode] = React.useState<"saved" | number>("saved")
  const [running, setRunning] = React.useState(false)
  const [finished, setFinished] = React.useState(false)
  const [clearStatus, setClearStatus] = React.useState<StepStatus>("pending")
  const [botProgress, setBotProgress] = React.useState<BotProgress[]>([])

  React.useEffect(() => {
    if (open) {
      setLevelMode("saved")
      setRunning(false)
      setFinished(false)
      setClearStatus("pending")
      setBotProgress(
        (entry?.preset.party.bots ?? []).map((b) => ({
          label: b.spec ? `${b.spec} ${b.class}` : b.class,
          status: "pending",
        }))
      )
    }
  }, [open, entry])

  if (!entry) return null
  const bots = entry.preset.party.bots

  const run = async () => {
    if (!playerName || playerGuid == null || !isTauri()) {
      toast.error("Pick a character from the sidebar first.")
      return
    }
    // Preflight: the spawn pipeline runs as the player's session, so the
    // character must be logged in.
    let online = false
    try {
      online = await trackedInvoke<boolean>("is_character_online", {
        guid: playerGuid,
      })
    } catch (e) {
      toast.error("Couldn't reach the server", {
        description: typeof e === "string" ? e : String(e),
      })
      return
    }
    if (!online) {
      toast.warning(`${playerName} isn't logged in`, {
        description:
          "Log into the game first — setting up a party summons bots to you and invites them to your group.",
      })
      return
    }

    setRunning(true)

    // Step 1 — clear the current party (kick every non-leader member).
    setClearStatus("running")
    try {
      const members = await trackedInvoke<PartyMember[]>("get_user_party", {
        playerGuid,
      })
      const toKick = members.filter((m) => !m.isLeader)
      for (const m of toKick) {
        try {
          await trackedInvoke("kick_bot_from_party", {
            args: { botName: m.name },
          })
        } catch {
          // Best-effort — a stale member that won't kick shouldn't block
          // the rebuild.
        }
      }
      setClearStatus("done")
    } catch (e) {
      setClearStatus("error")
      toast.error("Couldn't clear the current party", {
        description: typeof e === "string" ? e : String(e),
      })
      setRunning(false)
      return
    }

    // Step 2 — summon each preset bot in turn.
    for (let i = 0; i < bots.length; i++) {
      const bot = bots[i]
      const classId = presetBotClassId(bot)
      if (classId == null) {
        setBotProgress((prev) =>
          prev.map((p, idx) =>
            idx === i
              ? { ...p, status: "error", detail: `Unknown class "${bot.class}"` }
              : p
          )
        )
        continue
      }
      const targetLevel = levelMode === "saved" ? bot.level : levelMode
      setBotProgress((prev) =>
        prev.map((p, idx) => (idx === i ? { ...p, status: "running" } : p))
      )
      try {
        const result = await trackedInvoke<{
          botName: string | null
          steps: { label: string; ok: boolean; detail: string }[]
        }>("add_bot_to_party", {
          args: {
            classId,
            targetLevel,
            wowheadLink: bot.talents ?? "",
            characterName: playerName,
          },
        })
        const failed = result.steps.filter((s) => !s.ok)
        setBotProgress((prev) =>
          prev.map((p, idx) =>
            idx === i
              ? {
                  ...p,
                  label: result.botName
                    ? `${result.botName} · ${p.label}`
                    : p.label,
                  status: !result.botName
                    ? "error"
                    : failed.length > 0
                      ? "warn"
                      : "done",
                  detail:
                    failed.length > 0
                      ? failed
                          .map((s) => `${s.label}${s.detail ? `: ${s.detail}` : ""}`)
                          .join("; ")
                      : undefined,
                }
              : p
          )
        )
      } catch (e) {
        setBotProgress((prev) =>
          prev.map((p, idx) =>
            idx === i
              ? {
                  ...p,
                  status: "error",
                  detail: typeof e === "string" ? e : String(e),
                }
              : p
          )
        )
      }
    }

    setRunning(false)
    setFinished(true)
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !running && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PlayIcon className="size-5 text-primary" weight="fill" />
            Set up "{entry.preset.preset_info.name}"
          </DialogTitle>
          <DialogDescription>
            This clears your current party, then summons {bots.length} bot
            {bots.length === 1 ? "" : "s"} to you — leveled, specced, and
            auto-geared. Takes a few seconds per bot.
          </DialogDescription>
        </DialogHeader>

        {/* Level option — only before running */}
        {!running && !finished && (
          <div className="space-y-2">
            <Label className="text-muted-foreground">Bot levels</Label>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => setLevelMode("saved")}
                className={cn(
                  "rounded-md border px-3 py-1.5 text-sm transition-colors",
                  levelMode === "saved"
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card hover:border-primary/60"
                )}
              >
                Saved levels
              </button>
              <button
                type="button"
                onClick={() =>
                  setLevelMode(typeof levelMode === "number" ? levelMode : 80)
                }
                className={cn(
                  "rounded-md border px-3 py-1.5 text-sm transition-colors",
                  typeof levelMode === "number"
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card hover:border-primary/60"
                )}
              >
                Same level for all
              </button>
              {typeof levelMode === "number" && (
                <input
                  type="number"
                  min={1}
                  max={80}
                  value={levelMode}
                  onChange={(e) => {
                    const n = Math.round(Number(e.target.value))
                    if (Number.isFinite(n)) {
                      setLevelMode(Math.min(80, Math.max(1, n)))
                    }
                  }}
                  className="w-16 rounded-md border border-border bg-card text-center text-sm font-semibold tabular-nums focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
                />
              )}
            </div>
          </div>
        )}

        {/* Progress */}
        <div className="space-y-1.5">
          {(running || finished) && (
            <ProgressRow
              label="Clear current party"
              status={clearStatus}
            />
          )}
          {(running || finished
            ? botProgress
            : bots.map((b) => ({
                label: b.spec ? `${b.spec} ${b.class}` : b.class,
                status: "pending" as StepStatus,
                detail: undefined,
              }))
          ).map((p, i) => (
            <ProgressRow
              key={i}
              label={p.label}
              status={p.status}
              detail={p.detail}
              sublabel={
                !running && !finished
                  ? `Lv ${levelMode === "saved" ? bots[i].level : levelMode}`
                  : undefined
              }
            />
          ))}
        </div>

        <DialogFooter>
          {finished ? (
            <Button onClick={() => onOpenChange(false)}>Done</Button>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={running}
              >
                Cancel
              </Button>
              <Button onClick={run} disabled={running}>
                {running ? (
                  <>
                    <CircleNotchIcon className="size-4 animate-spin" />
                    Setting up…
                  </>
                ) : (
                  <>
                    <PlayIcon className="size-4" weight="fill" />
                    Set up party
                  </>
                )}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ProgressRow({
  label,
  status,
  detail,
  sublabel,
}: {
  label: string
  status: StepStatus
  detail?: string
  sublabel?: string
}) {
  return (
    <div className="rounded-md border border-border bg-card/50 px-3 py-2">
      <div className="flex items-center gap-2 text-sm">
        <StatusGlyph status={status} />
        <span className="flex-1 truncate">{label}</span>
        {sublabel && (
          <span className="shrink-0 text-xs text-muted-foreground">
            {sublabel}
          </span>
        )}
      </div>
      {detail && (
        <div className="mt-1 pl-6 text-xs text-muted-foreground">{detail}</div>
      )}
    </div>
  )
}

function StatusGlyph({ status }: { status: StepStatus }) {
  switch (status) {
    case "running":
      return <CircleNotchIcon className="size-4 shrink-0 animate-spin text-primary" />
    case "done":
      return (
        <CheckCircleIcon
          className="size-4 shrink-0 text-emerald-500"
          weight="fill"
        />
      )
    case "warn":
      return (
        <WarningCircleIcon
          className="size-4 shrink-0 text-amber-500"
          weight="fill"
        />
      )
    case "error":
      return <XCircleIcon className="size-4 shrink-0 text-destructive" weight="fill" />
    default:
      return <div className="size-4 shrink-0 rounded-full border border-border" />
  }
}

// ── edit dialog (raw TOML, with gutter mismatch markers) ──────────────

interface LineIssue {
  id: number
  tomlName: string
  realName: string
}

const ID_LINE_RE = /\bid\s*=\s*(\d+)/
const NAME_LINE_RE = /\bname\s*=\s*"([^"]*)"/
const NAME_REPLACE_RE = /(\bname\s*=\s*")([^"]*)(")/
const ID_GLOBAL_RE = /\bid\s*=\s*(\d+)/g

/**
 * Raw-TOML editor for a preset. Code-editor styling (monospace, line
 * numbers in a gutter). Lines whose gear `name` disagrees with the real
 * item for that `id` get an amber ⚠ in the gutter — hover for the
 * suggested name, click to replace it. Saving writes the text verbatim
 * (must parse) over the preset.
 */
function EditPresetDialog({
  open,
  onOpenChange,
  entry,
  initialMeta,
  onSaved,
}: {
  open: boolean
  onOpenChange: (next: boolean) => void
  entry: PresetEntry
  initialMeta: Map<number, ItemMini>
  onSaved: (updated: PresetEntry) => void
}) {
  const [text, setText] = React.useState(entry.raw_toml)
  const [saving, setSaving] = React.useState(false)
  const [metaVersion, setMetaVersion] = React.useState(0)
  const metaRef = React.useRef<Map<number, ItemMini>>(new Map(initialMeta))
  const taRef = React.useRef<HTMLTextAreaElement>(null)
  const gutterInnerRef = React.useRef<HTMLDivElement>(null)

  // Snapshot text + the resolved-name map each time the dialog opens.
  React.useEffect(() => {
    if (!open) return
    setText(entry.raw_toml)
    metaRef.current = new Map(initialMeta)
    setMetaVersion((v) => v + 1)
    setSaving(false)
    // initialMeta intentionally excluded — we snapshot it at open time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, entry.raw_toml])

  // Resolve names for any id referenced in the text we don't have yet
  // (e.g. the user pasted/typed a new id).
  React.useEffect(() => {
    if (!open || !isTauri()) return
    const ids = [
      ...new Set(
        [...text.matchAll(ID_GLOBAL_RE)].map((m) => Number(m[1]))
      ),
    ]
    const missing = ids.filter((id) => !metaRef.current.has(id))
    if (missing.length === 0) return
    const t = window.setTimeout(() => {
      trackedInvoke<ItemMini[]>("get_items_by_entries", { entries: missing })
        .then((rows) => {
          rows.forEach((r) => metaRef.current.set(r.entry, r))
          setMetaVersion((v) => v + 1)
        })
        .catch(() => {})
    }, 350)
    return () => window.clearTimeout(t)
  }, [text, open])

  const lines = React.useMemo(() => text.split("\n"), [text])

  // lineIndex (of the `name = "…"` line) → mismatch.
  //
  // toml serializes gear as `[party.bots.gear.<slot>]` sub-tables with
  // `id` and `name` on SEPARATE lines, so we can't match both on one
  // line. Instead we track the most recent `id` within the current
  // table block (reset on each `[header]`) and pair the block's `name`
  // line with it. An inline `{ id = …, name = … }` (same line) still
  // works — the same-line id takes precedence.
  const issues = React.useMemo(() => {
    const map = new Map<number, LineIssue>()
    let blockId: number | null = null
    lines.forEach((ln, i) => {
      if (ln.trim().startsWith("[")) {
        blockId = null
        return
      }
      const idM = ln.match(ID_LINE_RE)
      if (idM) blockId = Number(idM[1])
      const nameM = ln.match(NAME_LINE_RE)
      if (!nameM) return
      const id = idM ? Number(idM[1]) : blockId
      if (id == null) return
      const tomlName = nameM[1]
      const real = metaRef.current.get(id)?.name
      if (real && real.trim().toLowerCase() !== tomlName.trim().toLowerCase()) {
        map.set(i, { id, tomlName, realName: real })
      }
    })
    return map
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, metaVersion])

  const applyFix = (ls: string[], i: number, issue: LineIssue) => {
    const safe = issue.realName.replace(/"/g, "")
    ls[i] = ls[i].replace(NAME_REPLACE_RE, (_m, a, _b, c) => `${a}${safe}${c}`)
  }

  const fixLine = (i: number) => {
    const issue = issues.get(i)
    if (!issue) return
    const ls = text.split("\n")
    applyFix(ls, i, issue)
    setText(ls.join("\n"))
  }

  const fixAll = () => {
    const ls = text.split("\n")
    issues.forEach((issue, i) => applyFix(ls, i, issue))
    setText(ls.join("\n"))
  }

  // Keep the gutter vertically aligned with the textarea as it scrolls.
  const onScroll = () => {
    const ta = taRef.current
    const gi = gutterInnerRef.current
    if (ta && gi) gi.style.transform = `translateY(${-ta.scrollTop}px)`
  }

  const handleSave = async () => {
    if (!isTauri()) return
    setSaving(true)
    try {
      const updated = await trackedInvoke<PresetEntry>("save_preset_toml", {
        id: entry.id,
        tomlText: text,
      })
      toast.success(`Saved "${updated.preset.preset_info.name}"`)
      onSaved(updated)
      onOpenChange(false)
    } catch (e) {
      toast.error("Couldn't save the preset", {
        description: typeof e === "string" ? e : String(e),
      })
    } finally {
      setSaving(false)
    }
  }

  const issueCount = issues.size

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PencilSimpleIcon className="size-5 text-primary" />
            Edit preset
          </DialogTitle>
          <DialogDescription>
            The item ID is the source of truth; the name is only there to be
            readable.{" "}
            {issueCount > 0
              ? `${issueCount} name${issueCount === 1 ? "" : "s"} don't match their ID — click the ⚠ in the gutter to fix one, or Fix all.`
              : "No name/ID mismatches detected."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex h-[420px] overflow-hidden rounded-md border border-zinc-800 bg-zinc-950 font-mono text-[12.5px] leading-5">
          {/* Gutter: line numbers + mismatch markers, scroll-synced. */}
          <div className="relative w-14 shrink-0 select-none overflow-hidden border-r border-zinc-800 bg-zinc-900/60">
            <div
              ref={gutterInnerRef}
              className="absolute inset-x-0 top-0 will-change-transform"
            >
              {lines.map((_line, i) => {
                const issue = issues.get(i)
                return (
                  <div key={i} className="flex h-5 items-center gap-1 pl-1 pr-2">
                    <span className="flex w-4 justify-center">
                      {issue && (
                        <button
                          type="button"
                          onClick={() => fixLine(i)}
                          title={`Should be "${issue.realName}" (id ${issue.id}) — click to fix`}
                          className="inline-flex"
                        >
                          <WarningIcon
                            className="size-3.5 text-amber-400 hover:text-amber-300"
                            weight="fill"
                          />
                        </button>
                      )}
                    </span>
                    <span className="flex-1 text-right text-[11px] tabular-nums text-zinc-600">
                      {i + 1}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Editor. wrap=off keeps one logical line == one row so the
              gutter stays aligned. */}
          <textarea
            ref={taRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onScroll={onScroll}
            wrap="off"
            spellCheck={false}
            className="ui-selectable flex-1 resize-none whitespace-pre bg-transparent px-2 py-0 leading-5 text-zinc-200 outline-none"
          />
        </div>

        <DialogFooter className="sm:justify-between">
          <div>
            {issueCount > 0 && (
              <Button variant="outline" size="sm" onClick={fixAll}>
                <WarningIcon className="size-4 text-amber-500" weight="fill" />
                Fix all {issueCount} name{issueCount === 1 ? "" : "s"}
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? (
                <CircleNotchIcon className="size-4 animate-spin" />
              ) : (
                <FloppyDiskIcon className="size-4" weight="fill" />
              )}
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
