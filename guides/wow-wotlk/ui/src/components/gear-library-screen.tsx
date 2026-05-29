import * as React from "react"
import {
  CameraIcon,
  CircleNotchIcon,
  ClipboardTextIcon,
  DownloadSimpleIcon,
  FloppyDiskIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  SwordIcon,
  TrashIcon,
  XIcon,
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { GearSlotIcon } from "@/components/gear-slot-icon"
import { ItemTooltip, type ItemMini } from "@/components/item-tooltip"
import { useServerState } from "@/components/server-state-context"
import { isTauri, trackedInvoke } from "@/lib/tauri"
import {
  GEAR_SLOT_LABELS,
  GEAR_SLOT_ORDER,
} from "@/lib/party-presets"
import {
  AC_SLOT_TO_NAME,
  buildGearSet,
  gearSetItems,
  type GearPiece,
  type GearSet,
  type GearSetEntry,
} from "@/lib/gear-sets"
import { CLASS_COLORS, CLASS_NAMES } from "@/lib/wow-character-enums"
import { CLASS_KEYWORDS } from "@/lib/party-presets"
import { cn } from "@/lib/utils"

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

interface ItemSummary {
  entry: number
  name: string
  quality: number
  inventoryType: number
  itemLevel: number
  requiredLevel: number
}

interface EquippedItem {
  slot: number
  entry: number
}
interface Paperdoll {
  name: string
  class: number
  equipped: EquippedItem[]
}

export function GearLibraryScreen() {
  const { selectedCharacter } = useServerState()
  const [sets, setSets] = React.useState<GearSetEntry[]>([])
  const [loading, setLoading] = React.useState(true)
  const [importOpen, setImportOpen] = React.useState(false)
  const [buildOpen, setBuildOpen] = React.useState(false)
  // Capture stages a draft (gear + class) that the name dialog finalizes.
  const [draft, setDraft] = React.useState<{
    gear: Record<string, GearPiece>
    className?: string
    defaultName: string
  } | null>(null)

  const refresh = React.useCallback(async () => {
    if (!isTauri()) {
      setLoading(false)
      return
    }
    try {
      setSets(await trackedInvoke<GearSetEntry[]>("list_gear_sets"))
    } catch (e) {
      toast.error("Couldn't load gear sets", {
        description: typeof e === "string" ? e : String(e),
      })
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void refresh()
  }, [refresh])

  const upsert = (entry: GearSetEntry) =>
    setSets((prev) =>
      [...prev.filter((p) => p.id !== entry.id), entry].sort((a, b) =>
        a.id.localeCompare(b.id)
      )
    )

  const handleCapture = async () => {
    if (!selectedCharacter || !isTauri()) {
      toast.error("Pick a character from the sidebar first.")
      return
    }
    const id = toast.loading("Reading your equipped gear…")
    try {
      const pd = await trackedInvoke<Paperdoll>("get_character_paperdoll", {
        guid: selectedCharacter.guid,
      })
      const gear: Record<string, GearPiece> = {}
      for (const eq of pd.equipped) {
        const slot = AC_SLOT_TO_NAME[eq.slot]
        if (slot && eq.entry > 0) gear[slot] = { id: eq.entry }
      }
      if (Object.keys(gear).length === 0) {
        toast.error("No equipped gear found on this character.", { id })
        return
      }
      // Resolve names so the saved set is human-readable.
      try {
        const minis = await trackedInvoke<ItemMini[]>("get_items_by_entries", {
          entries: Object.values(gear).map((g) => g.id),
        })
        const byId = new Map(minis.map((m) => [m.entry, m.name]))
        for (const piece of Object.values(gear)) {
          const name = byId.get(piece.id)
          if (name) piece.name = name
        }
      } catch {
        /* names are advisory — fine to skip */
      }
      toast.dismiss(id)
      setDraft({
        gear,
        className: CLASS_KEYWORDS[pd.class],
        defaultName: `${pd.name}'s gear`,
      })
    } catch (e) {
      toast.error("Couldn't read your gear", {
        id,
        description: typeof e === "string" ? e : String(e),
      })
    }
  }

  const handleDelete = async (entry: GearSetEntry) => {
    try {
      await trackedInvoke("delete_gear_set", { id: entry.id })
      toast.success(`Deleted "${entry.set.name}"`)
      setSets((prev) => prev.filter((p) => p.id !== entry.id))
    } catch (e) {
      toast.error("Delete failed", {
        description: typeof e === "string" ? e : String(e),
      })
    }
  }

  const handleCopy = async (entry: GearSetEntry) => {
    try {
      await navigator.clipboard.writeText(entry.raw_toml)
      toast.success("Gear set TOML copied")
    } catch {
      toast.error("Couldn't copy to clipboard")
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-4 pt-3 pb-6 lg:px-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <SwordIcon className="size-6 text-primary" weight="fill" />
            Gear Library
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Save and share gear sets for your character. Reference loadouts —
            hover any item for its tooltip; equip in-game.
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button>
              <PlusIcon className="size-4" weight="bold" />
              New set
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem onSelect={() => void handleCapture()}>
              <CameraIcon className="text-muted-foreground" />
              Capture current gear
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setBuildOpen(true)}>
              <MagnifyingGlassIcon className="text-muted-foreground" />
              Build with item search
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setImportOpen(true)}>
              <DownloadSimpleIcon className="text-muted-foreground" />
              Import a shared set
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
          <CircleNotchIcon className="size-4 animate-spin" />
          Loading gear sets…
        </div>
      ) : sets.length === 0 ? (
        <EmptyState
          onCapture={() => void handleCapture()}
          onBuild={() => setBuildOpen(true)}
        />
      ) : (
        <div className="space-y-3">
          {sets.map((entry) => (
            <GearSetCard
              key={entry.id}
              entry={entry}
              onCopy={() => handleCopy(entry)}
              onDelete={() => handleDelete(entry)}
            />
          ))}
        </div>
      )}

      <NameGearSetDialog
        draft={draft}
        onOpenChange={(o) => !o && setDraft(null)}
        onSaved={(entry) => {
          upsert(entry)
          setDraft(null)
        }}
      />
      <BuildGearSetDialog
        open={buildOpen}
        onOpenChange={setBuildOpen}
        defaultClassId={selectedCharacter?.class ?? null}
        onSaved={upsert}
      />
      <ImportGearSetDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={upsert}
      />
    </div>
  )
}

function EmptyState({
  onCapture,
  onBuild,
}: {
  onCapture: () => void
  onBuild: () => void
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-md border border-dashed border-border bg-muted/10 p-8 text-center">
      <SwordIcon className="size-10 text-muted-foreground/50" />
      <div className="space-y-1">
        <div className="font-semibold">No gear sets yet</div>
        <p className="mx-auto max-w-sm text-sm text-muted-foreground">
          Snapshot what your character is wearing, or build a set from the
          item database.
        </p>
      </div>
      <div className="flex gap-2">
        <Button variant="outline" onClick={onCapture}>
          <CameraIcon className="size-4" />
          Capture current gear
        </Button>
        <Button variant="outline" onClick={onBuild}>
          <MagnifyingGlassIcon className="size-4" />
          Build a set
        </Button>
      </div>
    </div>
  )
}

// ── set card ──────────────────────────────────────────────────────────

function GearSetCard({
  entry,
  onCopy,
  onDelete,
}: {
  entry: GearSetEntry
  onCopy: () => void
  onDelete: () => void
}) {
  const [confirmDelete, setConfirmDelete] = React.useState(false)
  const { set } = entry
  const items = React.useMemo(() => gearSetItems(set.gear), [set.gear])

  const [meta, setMeta] = React.useState<Map<number, ItemMini>>(new Map())
  React.useEffect(() => {
    if (items.length === 0 || !isTauri()) return
    let cancelled = false
    trackedInvoke<ItemMini[]>("get_items_by_entries", {
      entries: items.map((i) => i.id),
    })
      .then((rows) => {
        if (!cancelled) setMeta(new Map(rows.map((r) => [r.entry, r])))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [items])

  const classId = set.class
    ? Object.entries(CLASS_KEYWORDS).find(([, kw]) => kw === set.class)?.[0]
    : undefined
  const classColor = classId
    ? CLASS_COLORS[Number(classId)] ?? "text-foreground"
    : "text-foreground"

  return (
    <div className="rounded-md border border-border bg-card p-4">
      <div className="min-w-0">
        <div className="truncate text-base font-semibold">{set.name}</div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          {set.class && (
            <Badge variant="secondary" className={cn("font-normal", classColor)}>
              {CLASS_NAMES[Number(classId)] ?? set.class}
            </Badge>
          )}
          <span>
            {items.length} item{items.length === 1 ? "" : "s"}
          </span>
          {set.note && <span className="italic">· {set.note}</span>}
        </div>
      </div>

      {/* Item grid */}
      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-0.5 sm:grid-cols-3">
        {items.map((it) => {
          const quality = meta.get(it.id)?.quality
          const colorClass =
            quality != null
              ? QUALITY_COLORS[quality] ?? "text-foreground"
              : "text-foreground"
          return (
            <div key={it.slot} className="flex items-center gap-1.5">
              <GearSlotIcon
                slot={it.slot}
                className="size-3.5 shrink-0 text-muted-foreground"
              />
              <ItemTooltip entry={it.id} side="top" align="start">
                <span
                  className={cn(
                    "min-w-0 flex-1 cursor-default truncate text-xs hover:underline",
                    colorClass
                  )}
                  title={GEAR_SLOT_LABELS[it.slot] ?? it.slot}
                >
                  {it.name ?? `Item #${it.id}`}
                </span>
              </ItemTooltip>
            </div>
          )
        })}
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
    </div>
  )
}

// ── name dialog (capture finalizer) ───────────────────────────────────

function NameGearSetDialog({
  draft,
  onOpenChange,
  onSaved,
}: {
  draft: {
    gear: Record<string, GearPiece>
    className?: string
    defaultName: string
  } | null
  onOpenChange: (open: boolean) => void
  onSaved: (entry: GearSetEntry) => void
}) {
  const [name, setName] = React.useState("")
  const [note, setNote] = React.useState("")
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    if (draft) {
      setName(draft.defaultName)
      setNote("")
      setSaving(false)
    }
  }, [draft])

  const handleSave = async () => {
    if (!draft || !name.trim() || !isTauri()) return
    setSaving(true)
    try {
      const set = buildGearSet({
        name,
        className: draft.className,
        note,
        gear: draft.gear,
      })
      const entry = await trackedInvoke<GearSetEntry>("save_gear_set", { set })
      toast.success(`Saved "${entry.set.name}"`)
      onSaved(entry)
    } catch (e) {
      toast.error("Couldn't save the gear set", {
        description: typeof e === "string" ? e : String(e),
      })
      setSaving(false)
    }
  }

  const count = draft ? Object.keys(draft.gear).length : 0

  return (
    <Dialog open={draft !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CameraIcon className="size-5 text-primary" />
            Save gear set
          </DialogTitle>
          <DialogDescription>
            Captured {count} equipped item{count === 1 ? "" : "s"}. Name it to
            save.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="gs-name">Name</Label>
            <Input
              id="gs-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="gs-note">Note (optional)</Label>
            <Input
              id="gs-note"
              placeholder="e.g. Pre-raid BiS"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!name.trim() || saving}>
            <FloppyDiskIcon className="size-4" weight="fill" />
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── build dialog (per-slot item search) ───────────────────────────────

function BuildGearSetDialog({
  open,
  onOpenChange,
  defaultClassId,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultClassId: number | null
  onSaved: (entry: GearSetEntry) => void
}) {
  const [name, setName] = React.useState("")
  const [classId, setClassId] = React.useState<number | null>(null)
  const [gear, setGear] = React.useState<Record<string, GearPiece>>({})
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    if (open) {
      setName("")
      setClassId(defaultClassId)
      setGear({})
      setSaving(false)
    }
  }, [open, defaultClassId])

  const setSlot = (slot: string, piece: GearPiece | null) => {
    setGear((prev) => {
      const next = { ...prev }
      if (piece) next[slot] = piece
      else delete next[slot]
      return next
    })
  }

  const filledCount = Object.keys(gear).length

  const handleSave = async () => {
    if (!name.trim() || filledCount === 0 || !isTauri()) return
    setSaving(true)
    try {
      const set = buildGearSet({
        name,
        className: classId != null ? CLASS_KEYWORDS[classId] : undefined,
        gear,
      })
      const entry = await trackedInvoke<GearSetEntry>("save_gear_set", { set })
      toast.success(`Saved "${entry.set.name}"`)
      onSaved(entry)
      onOpenChange(false)
    } catch (e) {
      toast.error("Couldn't save the gear set", {
        description: typeof e === "string" ? e : String(e),
      })
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MagnifyingGlassIcon className="size-5 text-primary" />
            Build a gear set
          </DialogTitle>
          <DialogDescription>
            Search the item database and pick a piece per slot. Leave a slot
            empty to skip it.
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-2">
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="build-name">Name</Label>
            <Input
              id="build-name"
              placeholder="e.g. Frost Mage PvP"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="w-40 space-y-1.5">
            <Label>Class (optional)</Label>
            <Select
              value={classId != null ? String(classId) : "none"}
              onValueChange={(v) => setClassId(v === "none" ? null : Number(v))}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">—</SelectItem>
                {Object.keys(CLASS_KEYWORDS).map((cid) => (
                  <SelectItem key={cid} value={cid}>
                    {CLASS_NAMES[Number(cid)] ?? `#${cid}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="max-h-[320px] space-y-0.5 overflow-y-auto rounded-md border border-border p-1.5">
          {GEAR_SLOT_ORDER.map((slot) => (
            <SlotPicker
              key={slot}
              slot={slot}
              piece={gear[slot]}
              onPick={(p) => setSlot(slot, p)}
            />
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={!name.trim() || filledCount === 0 || saving}
          >
            <FloppyDiskIcon className="size-4" weight="fill" />
            {saving ? "Saving…" : `Save (${filledCount})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function SlotPicker({
  slot,
  piece,
  onPick,
}: {
  slot: string
  piece?: GearPiece
  onPick: (piece: GearPiece | null) => void
}) {
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState("")
  const [results, setResults] = React.useState<ItemSummary[]>([])
  const [searching, setSearching] = React.useState(false)

  React.useEffect(() => {
    if (!open || !isTauri()) return
    if (query.trim().length < 2) {
      setResults([])
      return
    }
    let cancelled = false
    setSearching(true)
    const t = window.setTimeout(() => {
      trackedInvoke<ItemSummary[]>("search_items", {
        args: { query, limit: 30 },
      })
        .then((rows) => {
          if (!cancelled) setResults(rows)
        })
        .catch(() => {})
        .finally(() => {
          if (!cancelled) setSearching(false)
        })
    }, 300)
    return () => {
      cancelled = true
      window.clearTimeout(t)
    }
  }, [query, open])

  return (
    <div className="flex items-center gap-2 rounded px-2 py-1">
      <GearSlotIcon slot={slot} className="size-4 shrink-0 text-muted-foreground" />
      <span className="w-20 shrink-0 text-xs text-muted-foreground">
        {GEAR_SLOT_LABELS[slot] ?? slot}
      </span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(
              "flex min-w-0 flex-1 items-center gap-1 rounded border border-border bg-card px-2 py-1 text-left text-xs transition-colors hover:border-primary/50",
              piece ? "text-foreground" : "text-muted-foreground"
            )}
          >
            {piece ? (
              <span
                className={cn(
                  "min-w-0 flex-1 truncate",
                  piece.name ? "" : "italic"
                )}
              >
                {piece.name ?? `Item #${piece.id}`}
              </span>
            ) : (
              <span className="flex min-w-0 flex-1 items-center gap-1">
                <MagnifyingGlassIcon className="size-3" />
                Search…
              </span>
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 p-2">
          <Input
            autoFocus
            placeholder="Item name…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="mb-2 h-8"
          />
          <div className="max-h-56 space-y-0.5 overflow-y-auto">
            {searching && (
              <div className="flex items-center gap-2 px-1 py-1 text-xs text-muted-foreground">
                <CircleNotchIcon className="size-3 animate-spin" />
                Searching…
              </div>
            )}
            {!searching && query.trim().length >= 2 && results.length === 0 && (
              <div className="px-1 py-1 text-xs text-muted-foreground">
                No items found.
              </div>
            )}
            {results.map((r) => (
              <button
                key={r.entry}
                type="button"
                onClick={() => {
                  onPick({ id: r.entry, name: r.name })
                  setOpen(false)
                }}
                className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-xs hover:bg-accent"
              >
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate",
                    QUALITY_COLORS[r.quality] ?? "text-foreground"
                  )}
                >
                  {r.name}
                </span>
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  iLvl {r.itemLevel}
                </span>
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
      {piece && (
        <button
          type="button"
          onClick={() => onPick(null)}
          title="Clear slot"
          className="shrink-0 text-muted-foreground hover:text-destructive"
        >
          <XIcon className="size-3.5" />
        </button>
      )}
    </div>
  )
}

// ── import dialog ─────────────────────────────────────────────────────

function ImportGearSetDialog({
  open,
  onOpenChange,
  onImported,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onImported: (entry: GearSetEntry) => void
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
      const entry = await trackedInvoke<GearSetEntry>("import_gear_set_toml", {
        tomlText: text,
      })
      toast.success(`Imported "${entry.set.name}"`)
      onImported(entry)
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
            Import a gear set
          </DialogTitle>
          <DialogDescription>
            Paste a gear set (TOML) someone shared.
          </DialogDescription>
        </DialogHeader>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
          placeholder={
            'schema_version = 1\nname = "Prot Warrior BiS"\nclass = "warrior"\n\n[gear.head]\nid = 12640\nname = "Crown of Destruction"'
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
