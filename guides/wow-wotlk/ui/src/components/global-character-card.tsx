import * as React from "react"
import {
  ArrowClockwiseIcon,
  DotsThreeVerticalIcon,
  UserCircleIcon,
} from "@phosphor-icons/react"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import {
  useServerState,
  type GameCharacter,
} from "@/components/server-state-context"
import {
  CLASS_COLORS,
  CLASS_NAMES,
  RACE_NAMES,
} from "@/lib/wow-character-enums"
import { cn } from "@/lib/utils"

/**
 * Sidebar slot showing the user's globally-selected "main" character.
 * Replaces the demo NavUser. Clicking opens a custom selection dialog
 * (not a small dropdown) since the character list can grow + we want
 * room for race/class/level details + future bits like 3D avatars or
 * equipment thumbnails.
 *
 * Per-page CharacterPickers still exist for surfaces that operate on a
 * NON-user character (AH Bot wizard, NPC actions, etc.); this card is
 * specifically the "act on MY character" anchor.
 */

export function GlobalCharacterCard() {
  const [open, setOpen] = React.useState(false)
  const { selectedCharacter } = useServerState()

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          size="lg"
          onClick={() => setOpen(true)}
          className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
          tooltip={
            selectedCharacter
              ? selectedCharacter.name
              : "Select a character…"
          }
        >
          <CharacterAvatar character={selectedCharacter} />
          <div className="grid flex-1 text-left text-sm leading-tight">
            {selectedCharacter ? (
              <>
                <span className="truncate font-medium">
                  {selectedCharacter.name}
                </span>
                <CharacterDetail character={selectedCharacter} />
              </>
            ) : (
              <span className="truncate text-muted-foreground">
                Select a character…
              </span>
            )}
          </div>
          <DotsThreeVerticalIcon className="ml-auto size-4" />
        </SidebarMenuButton>
      </SidebarMenuItem>
      <CharacterSelectionDialog open={open} onOpenChange={setOpen} />
    </SidebarMenu>
  )
}

/**
 * Avatar circle. Placeholder for now — when the client extraction
 * pipeline grows we can swap in race/class portraits from the WoW
 * client (or a Wowhead-style headshot composite). For v1 we draw a
 * subtle user-circle icon over a class-tinted ring so the user still
 * gets a visual cue of who's selected.
 */
function CharacterAvatar({
  character,
}: {
  character: GameCharacter | null
}) {
  const ring = character ? CLASS_COLORS[character.class] : null
  return (
    <Avatar
      className={cn(
        "h-8 w-8 rounded-lg ring-2 ring-transparent",
        ring && ring.replace("text-", "ring-")
      )}
    >
      <AvatarFallback className="rounded-lg bg-muted">
        <UserCircleIcon className="size-5 text-muted-foreground" />
      </AvatarFallback>
    </Avatar>
  )
}

function CharacterDetail({ character }: { character: GameCharacter }) {
  const race = RACE_NAMES[character.race] ?? `Race ${character.race}`
  const klass = CLASS_NAMES[character.class] ?? `Class ${character.class}`
  const klassColor = CLASS_COLORS[character.class] ?? "text-foreground"
  return (
    <span className="truncate text-xs text-muted-foreground">
      Lvl {character.level} | {race}{" "}
      <span className={cn("font-medium", klassColor)}>{klass}</span>
    </span>
  )
}

function CharacterSelectionDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const {
    characters,
    refreshCharacters,
    selectedCharacterGuid,
    setSelectedCharacterGuid,
  } = useServerState()
  const [refreshing, setRefreshing] = React.useState(false)
  const [refreshError, setRefreshError] = React.useState<string | null>(null)

  // Hide the AHBot seller from the global picker — that character is
  // managed by the AH Bot wizard and isn't a "real" play character.
  // Other surfaces (the AHBot wizard itself) still see it via their
  // own CharacterPicker.
  //
  // Case-insensitive match: the install script now creates the row as
  // "Ahbotseller" (normalized — see [[ac-normalizes-character-names]]),
  // but installs done before that fix landed have the mixed-case
  // "AHBotSeller". Both should be filtered.
  const visible = React.useMemo(
    () => characters.filter((c) => c.name.toLowerCase() !== "ahbotseller"),
    [characters]
  )

  const doRefresh = React.useCallback(async () => {
    setRefreshing(true)
    setRefreshError(null)
    try {
      await refreshCharacters()
    } catch (err) {
      setRefreshError(String(err))
    } finally {
      setRefreshing(false)
    }
  }, [refreshCharacters])

  // Refresh once on open so a newly-created in-game character shows up
  // without the user needing to manually retry.
  React.useEffect(() => {
    if (!open) return
    void doRefresh()
  }, [open, doRefresh])

  const pick = async (guid: number) => {
    await setSelectedCharacterGuid(guid)
    onOpenChange(false)
  }

  const clear = async () => {
    await setSelectedCharacterGuid(null)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Select your character</DialogTitle>
          <DialogDescription>
            Pick the character you want pages like Inventory and
            Teleport to act on. You can change this any time — actions
            that target NPCs or the AH Bot still use their own pickers.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Characters
            </span>
            <button
              type="button"
              onClick={doRefresh}
              disabled={refreshing}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
            >
              <ArrowClockwiseIcon
                className={cn("size-3.5", refreshing && "animate-spin")}
              />
              {refreshing ? "Refreshing…" : "Refresh"}
            </button>
          </div>

          {refreshError && (
            <div className="rounded-md border border-rose-500/30 bg-rose-500/5 p-2 text-xs text-rose-600 dark:text-rose-400">
              {refreshError}
            </div>
          )}

          {visible.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="max-h-80 space-y-1.5 overflow-y-auto pr-1">
              {visible.map((c) => (
                <CharacterRow
                  key={c.guid}
                  character={c}
                  selected={c.guid === selectedCharacterGuid}
                  onSelect={() => pick(c.guid)}
                />
              ))}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          {selectedCharacterGuid != null && (
            <Button
              variant="outline"
              onClick={clear}
              className="border-rose-500/30 text-rose-600 hover:bg-rose-500/10 hover:text-rose-700 dark:text-rose-400"
            >
              Clear selection
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CharacterRow({
  character,
  selected,
  onSelect,
}: {
  character: GameCharacter
  selected: boolean
  onSelect: () => void
}) {
  const race = RACE_NAMES[character.race] ?? `Race ${character.race}`
  const klass = CLASS_NAMES[character.class] ?? `Class ${character.class}`
  const klassColor = CLASS_COLORS[character.class] ?? "text-foreground"
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex w-full items-center gap-3 rounded-md border p-2.5 text-left transition-colors",
        selected
          ? "border-primary/40 bg-primary/5"
          : "border-border hover:border-primary/30 hover:bg-muted/30"
      )}
    >
      <CharacterAvatar character={character} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium leading-tight">
          {character.name}
        </div>
        <div className="truncate text-xs text-muted-foreground">
          Lvl {character.level} | {race}{" "}
          <span className={cn("font-medium", klassColor)}>{klass}</span>
        </div>
      </div>
      {selected && (
        <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-medium text-primary">
          Selected
        </span>
      )}
    </button>
  )
}

function EmptyState() {
  return (
    <div className="rounded-md border border-dashed border-border bg-muted/30 p-4 text-center text-xs text-muted-foreground">
      No characters found. Log into WoW, create a character, then come
      back and hit Refresh.
    </div>
  )
}
