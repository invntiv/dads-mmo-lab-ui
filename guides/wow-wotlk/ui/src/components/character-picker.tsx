import * as React from "react"
import { ArrowClockwiseIcon, UserIcon } from "@phosphor-icons/react"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  useServerState,
  type GameCharacter,
} from "@/components/server-state-context"
import { CLASS_NAMES, RACE_NAMES } from "@/lib/wow-character-enums"
import { cn } from "@/lib/utils"

/**
 * Reusable character dropdown for the Teleport and Inventory pages.
 * Polls the character list on mount + every 5s while mounted so newly-
 * created in-game characters appear without the user needing to refresh
 * manually.
 *
 * Owns its own refresh state but reads/writes the shared `characters`
 * list from the server-state context — that way the Modules page's AH
 * Bot wizard sees the same list this picker just refreshed.
 */

const POLL_INTERVAL_MS = 5_000

export function CharacterPicker({
  value,
  onChange,
  placeholder = "Select a character…",
  /** When true, AHBOT-owned characters are hidden — useful for the
   * Teleport / Inventory screens where the user wouldn't want to act
   * on the bot's own seller character by accident. */
  excludeAhbot = false,
}: {
  value: string
  onChange: (guid: string) => void
  placeholder?: string
  excludeAhbot?: boolean
}) {
  const { characters, refreshCharacters } = useServerState()
  const [refreshError, setRefreshError] = React.useState<string | null>(null)
  const [refreshing, setRefreshing] = React.useState(false)

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

  React.useEffect(() => {
    void doRefresh()
    const interval = setInterval(doRefresh, POLL_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [doRefresh])

  // If excludeAhbot is on, drop characters from the AHBOT account
  // (matches the backend account-name filter — we look up by the bot's
  // typical character name AHBotSeller as a fallback since the picker
  // doesn't know the account id).
  const filtered = React.useMemo(() => {
    if (!excludeAhbot) return characters
    // Case-insensitive — fresh installs are "Ahbotseller" (normalized),
    // older installs are "AHBotSeller" (pre-fix).
    return characters.filter(
      (c) => c.name.toLowerCase() !== "ahbotseller"
    )
  }, [characters, excludeAhbot])

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Character
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
      {filtered.length === 0 ? (
        <div className="rounded-md border border-dashed border-border bg-muted/30 p-4 text-center text-xs text-muted-foreground">
          No characters found. Log into WoW, create a character, then come back.
        </div>
      ) : (
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder={placeholder} />
          </SelectTrigger>
          <SelectContent>
            {filtered.map((c) => (
              <SelectItem key={c.guid} value={String(c.guid)}>
                <CharacterRow char={c} />
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {refreshError && (
        <div className="rounded-md border border-rose-500/30 bg-rose-500/5 p-2 text-xs text-rose-600 dark:text-rose-400">
          {refreshError}
        </div>
      )}
    </div>
  )
}

function CharacterRow({ char }: { char: GameCharacter }) {
  const race = RACE_NAMES[char.race] ?? `Race ${char.race}`
  const klass = CLASS_NAMES[char.class] ?? `Class ${char.class}`
  return (
    <div className="flex items-center gap-2">
      <UserIcon className="size-3.5 text-muted-foreground" />
      <span className="font-mono">{char.name}</span>
      <span className="text-xs text-muted-foreground">
        · Lvl {char.level} {race} {klass}
      </span>
    </div>
  )
}

/** Look up a character by guid string. Returned by both screens to
 * make the "selected character" object available without re-parsing. */
export function useSelectedCharacter(guid: string): GameCharacter | undefined {
  const { characters } = useServerState()
  return characters.find((c) => String(c.guid) === guid)
}
