import * as React from "react"
import { FloppyDiskIcon, UsersThreeIcon } from "@phosphor-icons/react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { isTauri, trackedInvoke } from "@/lib/tauri"
import {
  PRESET_TYPES,
  buildPreset,
  captureBot,
  typeNeedsContent,
  type PartyMemberLike,
  type PresetEntry,
} from "@/lib/party-presets"
import { specName, specRole, ROLE_LABELS, type Role } from "@/lib/wow-spec-roles"
import { CLASS_NAMES, CLASS_COLORS } from "@/lib/wow-character-enums"
import { cn } from "@/lib/utils"

/**
 * "Save current party" dialog. Captures the live bot party (class /
 * level / spec→talent-link, gear left to autogear) plus a name, a
 * type, and — for dungeons/raids — the content name, then writes it
 * through `save_party_preset`.
 *
 * The bots are captured from whatever's currently in the player's
 * group. We snapshot them when the dialog opens so the preview is
 * stable even if the background party poll ticks mid-edit.
 */

/** One live bot, enough to capture + preview. */
export interface SavablePartyBot extends PartyMemberLike {
  name: string
}

interface SavePartyDialogProps {
  open: boolean
  onOpenChange: (next: boolean) => void
  bots: SavablePartyBot[]
  /** The player's own class — used to default their declared role. */
  playerClassId?: number | null
  playerSpecTabIndex?: number | null
  onSaved?: (entry: PresetEntry) => void
}

export function SavePartyDialog({
  open,
  onOpenChange,
  bots,
  playerClassId,
  playerSpecTabIndex,
  onSaved,
}: SavePartyDialogProps) {
  const [name, setName] = React.useState("")
  const [type, setType] = React.useState<string>("dungeon")
  const [content, setContent] = React.useState("")
  const [playerRole, setPlayerRole] = React.useState<Role>("dps")
  const [saving, setSaving] = React.useState(false)

  // Snapshot the party on open so the preview/capture is stable.
  const [snapshot, setSnapshot] = React.useState<SavablePartyBot[]>([])
  React.useEffect(() => {
    if (open) {
      setSnapshot(bots)
      // Default the player's declared role from their own spec if known.
      const inferred =
        playerClassId != null
          ? specRole(playerClassId, playerSpecTabIndex ?? null)
          : null
      setPlayerRole(inferred ?? "dps")
    } else {
      // Reset edit fields on close.
      setName("")
      setType("dungeon")
      setContent("")
      setSaving(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const needsContent = typeNeedsContent(type)
  const canSave =
    name.trim().length > 0 &&
    snapshot.length > 0 &&
    (!needsContent || content.trim().length > 0)

  const handleSave = async () => {
    if (!canSave || !isTauri()) {
      if (!isTauri()) toast.error("Saving presets needs the desktop app.")
      return
    }
    setSaving(true)
    const preset = buildPreset({
      name,
      type,
      content,
      playerRole,
      bots: snapshot.map(captureBot),
    })
    try {
      const entry = await trackedInvoke<PresetEntry>("save_party_preset", {
        preset,
      })
      toast.success(`Saved "${entry.preset.preset_info.name}"`, {
        description: `${snapshot.length} bot${snapshot.length === 1 ? "" : "s"} · find it on the Party Presets page.`,
      })
      onSaved?.(entry)
      onOpenChange(false)
    } catch (e) {
      toast.error("Couldn't save the preset", {
        description: typeof e === "string" ? e : String(e),
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FloppyDiskIcon className="size-5 text-primary" weight="fill" />
            Save this party
          </DialogTitle>
          <DialogDescription>
            Store your current bots as a preset you can re-summon with one
            click, or share. Talents and roles are captured; gear is
            auto-rolled when you set the party up again.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="preset-name">Name</Label>
            <Input
              id="preset-name"
              placeholder="e.g. Early BRD party"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>

          <div className="flex gap-2">
            <div className="flex-1 space-y-1.5">
              <Label>Type</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRESET_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {needsContent && (
              <div className="flex-1 space-y-1.5">
                <Label htmlFor="preset-content">
                  {type === "raid" ? "Raid name" : "Dungeon name"}
                </Label>
                <Input
                  id="preset-content"
                  placeholder={type === "raid" ? "e.g. MC" : "e.g. BRD"}
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                />
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Your role in this party</Label>
            <Select
              value={playerRole}
              onValueChange={(v) => setPlayerRole(v as Role)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(["tank", "healer", "dps"] as Role[]).map((r) => (
                  <SelectItem key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Captured-bots preview */}
          <div className="space-y-1.5">
            <Label className="text-muted-foreground">
              Bots in this party ({snapshot.length})
            </Label>
            {snapshot.length === 0 ? (
              <div className="flex items-center gap-2 rounded-md border border-dashed border-border bg-muted/20 p-3 text-sm text-muted-foreground">
                <UsersThreeIcon className="size-4" />
                No bots in your party yet — add some first.
              </div>
            ) : (
              <div className="space-y-1">
                {snapshot.map((b) => {
                  const cls = CLASS_NAMES[b.classId] ?? `#${b.classId}`
                  const color = CLASS_COLORS[b.classId] ?? "text-foreground"
                  const spec = specName(b.classId, b.specTabIndex ?? null, false)
                  return (
                    <div
                      key={b.name}
                      className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-1.5 text-sm"
                    >
                      <span className="truncate">
                        <span className={cn("font-medium", color)}>
                          {b.name}
                        </span>
                        <span className="text-muted-foreground">
                          {" "}
                          · {spec ? `${spec} ` : ""}
                          {cls}
                        </span>
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        Lv {b.level}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!canSave || saving}>
            <FloppyDiskIcon className="size-4" weight="fill" />
            {saving ? "Saving…" : "Save preset"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
