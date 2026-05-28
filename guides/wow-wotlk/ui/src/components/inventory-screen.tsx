import * as React from "react"
import {
  ArrowSquareOutIcon,
  DatabaseIcon,
  GearIcon,
  GearSixIcon,
  MagnifyingGlassIcon,
  PackageIcon,
  PaperPlaneTiltIcon,
  SparkleIcon,
  XIcon,
} from "@phosphor-icons/react"
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
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { ScrollProgress } from "@/components/ui/scroll-progress"
import { ShineBorder } from "@/components/ui/shine-border"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ItemIconFramed } from "@/components/item-icon-framed"
import { ItemTooltip } from "@/components/item-tooltip"
import {
  useServerState,
  type GameCharacter,
} from "@/components/server-state-context"
import { trackedInvoke, isTauri } from "@/lib/tauri"
import { cn } from "@/lib/utils"

const ENRICH_NOTICE_ID = "inventory.enrich-info-well"

type IconCacheStatus =
  | { status: "no_client" }
  | { status: "not_extracted"; client_dir: string }
  | {
      status: "ready"
      count: number
      extracted_at: string
      source_dir: string
      stale: boolean
    }

/**
 * Inventory page. v1 scaffolding:
 *  - Character picker (top).
 *  - Search by name + filter by item class + minimum quality.
 *  - Result grid: name (quality-colored), ilvl, required level,
 *    wowhead link, "Send" button.
 *  - "Send" opens a small dialog to set quantity, subject, and body
 *    (the items are delivered via in-game mail since SOAP can't target
 *    an in-world character directly).
 *
 * Not yet built (will land in later iterations):
 *  - Live view of the character's current bags + bank (needs queries
 *    against character_inventory + item_instance + ITEM_DISPLAY_INFO
 *    icon resolution from DBC).
 *  - Local item icons (currently we link out to Wowhead for visuals).
 *  - Bulk add / item-set presets.
 */

type ItemSummary = {
  entry: number
  name: string
  quality: number
  class: number
  subclass: number
  inventory_type: number
  item_level: number
  required_level: number
  display_id: number
}

// Tailwind classes tuned to roughly match Blizzard's canonical quality
// palette (#1eff00 / #0070ff / #a335ee / #ff8000). Default Tailwind
// emerald/sky/purple are slightly off; green/blue/violet read closer.
const QUALITY_COLORS: Record<number, string> = {
  0: "text-zinc-400 dark:text-zinc-500",
  1: "text-foreground",
  2: "text-green-500 dark:text-green-400",
  3: "text-blue-500 dark:text-blue-400",
  4: "text-violet-500 dark:text-violet-400",
  5: "text-orange-500 dark:text-orange-400",
  6: "text-amber-300",
  7: "text-cyan-400",
}

const QUALITY_LABELS: Record<number, string> = {
  0: "Poor",
  1: "Common",
  2: "Uncommon",
  3: "Rare",
  4: "Epic",
  5: "Legendary",
  6: "Artifact",
  7: "Heirloom",
}

/** AC item class enum (TC compatible). */
const ITEM_CLASSES: { value: string; label: string }[] = [
  { value: "0", label: "All classes" },
  { value: "2", label: "Weapon" },
  { value: "4", label: "Armor" },
  { value: "1", label: "Container" },
  { value: "0_consumable", label: "Consumable" },
  { value: "6", label: "Projectile" },
  { value: "7", label: "Trade Goods" },
  { value: "9", label: "Recipe" },
  { value: "11", label: "Quiver" },
  { value: "12", label: "Quest" },
  { value: "13", label: "Key" },
  { value: "15", label: "Miscellaneous" },
  { value: "16", label: "Glyph" },
]

export function InventoryScreen() {
  // The recipient comes from the global character selection in the
  // sidebar — Inventory is a "act on my character" surface. NPC /
  // bot-targeted flows keep their own dedicated CharacterPickers.
  // iconMap is read from context (loaded once at app start) so
  // navigating away + back doesn't reload the ~1MB icon JSON.
  const { selectedCharacter: character, iconMap } = useServerState()

  const [query, setQuery] = React.useState("")
  const [classFilter, setClassFilter] = React.useState("0")
  const [qualityMin, setQualityMin] = React.useState("0")
  const [items, setItems] = React.useState<ItemSummary[]>([])
  const [searching, setSearching] = React.useState(false)
  const [searchError, setSearchError] = React.useState<string | null>(null)

  const [sendingFor, setSendingFor] = React.useState<ItemSummary | null>(null)

  // Drives the gradient bar between the filter row and the results
  // list. Same pattern as the Settings page — the bar tracks scroll
  // progress of the dynamically sized results container below.
  const scrollRef = React.useRef<HTMLDivElement>(null)

  // Page-level preference: include DEPRECATED items (Blizzard's marker
  // for items that are no longer obtainable). Persists in settings.json
  // via app_settings::inventory_show_deprecated. `null` while loading
  // so we don't fire a search with the wrong value on first mount.
  const [showDeprecated, setShowDeprecated] = React.useState<boolean | null>(
    null
  )

  // The icon-cache STATUS check is still local — it drives the
  // EnrichInfoWell at the top of the grid ("Want real icons? →
  // Settings"). Cache DATA itself comes from context above.
  const [iconStatus, setIconStatus] = React.useState<IconCacheStatus | null>(
    null
  )
  const [enrichDismissed, setEnrichDismissed] = React.useState<boolean | null>(
    null
  )

  const refreshIconStatus = React.useCallback(async () => {
    if (!isTauri()) return
    try {
      const s = await trackedInvoke<IconCacheStatus>("get_icon_cache_status")
      setIconStatus(s)
    } catch (e) {
      console.warn("get_icon_cache_status failed", e)
    }
  }, [])

  React.useEffect(() => {
    void refreshIconStatus()
    if (isTauri()) {
      void trackedInvoke<boolean>("is_notice_dismissed", {
        noticeId: ENRICH_NOTICE_ID,
      })
        .then((d) => setEnrichDismissed(d))
        .catch(() => setEnrichDismissed(false))
      void trackedInvoke<boolean>("get_inventory_show_deprecated")
        .then((v) => setShowDeprecated(v))
        .catch(() => setShowDeprecated(false))
    } else {
      setEnrichDismissed(false)
      setShowDeprecated(false)
    }
  }, [refreshIconStatus])

  const toggleShowDeprecated = (next: boolean) => {
    setShowDeprecated(next)
    if (isTauri()) {
      void trackedInvoke("set_inventory_show_deprecated", { value: next }).catch(
        (e) => console.warn("set_inventory_show_deprecated failed", e)
      )
    }
  }

  // Debounced search — the dataset is large (~40k items in vanilla AC)
  // so wait 300ms after the last keystroke before hitting the DB.
  // showDeprecated participates so toggling the cog's checkbox re-runs
  // the query; gated on `!= null` so we don't fire before the
  // persisted preference has loaded.
  React.useEffect(() => {
    if (!isTauri()) return
    if (showDeprecated == null) return
    const handle = setTimeout(() => {
      void runSearch()
    }, 300)
    return () => clearTimeout(handle)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, classFilter, qualityMin, showDeprecated])

  const runSearch = async () => {
    setSearching(true)
    setSearchError(null)
    try {
      // Special-case: "Consumable" class needs class=0 not class=0_consumable.
      // We treat the synthetic option as "show everything with class 0" since
      // AC's class enum uses 0 for consumables in 3.3.5a TBH the schema is
      // inconsistent across forks — narrow on consumables by name match.
      const isSyntheticConsumable = classFilter === "0_consumable"
      const cls = isSyntheticConsumable ? undefined : parseInt(classFilter, 10)
      const results = await trackedInvoke<ItemSummary[]>("search_items", {
        args: {
          query,
          class: cls,
          qualityMin: parseInt(qualityMin, 10),
          limit: 100,
          hideDeprecated: !showDeprecated,
        },
      })
      // Filter further if user picked consumable synthetic class — keep
      // entries where class is 0 (Consumable in some AC builds).
      setItems(
        isSyntheticConsumable
          ? results.filter((r) => r.class === 0)
          : results
      )
    } catch (err) {
      setSearchError(String(err))
      setItems([])
    } finally {
      setSearching(false)
    }
  }

  return (
    <div className="grid h-full grid-rows-[auto_auto_minmax(0,1fr)] gap-4 p-6">
      <header className="space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <h1 className="flex items-center gap-2 font-heading text-2xl font-semibold leading-tight">
              <DatabaseIcon className="size-6 shrink-0 text-muted-foreground" />
              Item Database
            </h1>
            <p className="text-sm text-muted-foreground">
              Search the entire item database and deliver anything you
              find to your character via in-game mail. Works whether
              the recipient is online or not.
            </p>
          </div>
          <InventoryOptionsMenu
            showDeprecated={showDeprecated ?? false}
            onToggleShowDeprecated={toggleShowDeprecated}
          />
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[2fr_1fr_1fr]">
          <div className="relative">
            <MagnifyingGlassIcon className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Item name…"
              className="pl-9"
            />
          </div>
          <Select value={classFilter} onValueChange={setClassFilter}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ITEM_CLASSES.map((c) => (
                <SelectItem key={c.value} value={c.value}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={qualityMin} onValueChange={setQualityMin}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[0, 1, 2, 3, 4, 5].map((q) => (
                <SelectItem key={q} value={String(q)}>
                  <QualityOption q={q} />
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </header>

      <ScrollProgress
        containerRef={scrollRef}
        className="relative h-[3px] w-full rounded-full"
      />

      <div
        ref={scrollRef}
        className="min-h-0 space-y-3 overflow-y-auto pr-1 pb-3"
      >
        <EnrichInfoWell
          iconStatus={iconStatus}
          dismissed={enrichDismissed}
          onDismiss={() => setEnrichDismissed(true)}
        />
        {searchError ? (
          <ErrorPanel message={searchError} onRetry={runSearch} />
        ) : items.length === 0 && !searching ? (
          <EmptyState hasQuery={query.trim().length > 0} />
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {items.map((item) => (
              <ItemTile
                key={item.entry}
                item={item}
                iconMap={iconMap}
                onSend={() => setSendingFor(item)}
                canSend={character != null}
              />
            ))}
          </div>
        )}
        {searching && (
          <div className="mt-3 text-center text-xs text-muted-foreground">
            Searching…
          </div>
        )}
      </div>

      <SendItemDialog
        item={sendingFor}
        character={character}
        onClose={() => setSendingFor(null)}
      />
    </div>
  )
}

function ItemTile({
  item,
  iconMap,
  onSend,
  canSend,
}: {
  item: ItemSummary
  iconMap: Record<string, string>
  onSend: () => void
  canSend: boolean
}) {
  const quality = QUALITY_COLORS[item.quality] ?? "text-foreground"
  const iconName = iconMap[String(item.display_id)]
  return (
    <div className="group relative flex items-center gap-3 rounded-md border border-border bg-card p-3 shadow-sm transition-all hover:shadow-md">
      <ShineBorder
        className="opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        borderWidth={1.5}
        duration={6}
        shineColor={["#A07CFE", "#FE8FB5", "#FFBE7B"]}
      />
      {/* Hover anywhere on the icon-and-name region to open the
          tooltip. Wowhead link + Send button live OUTSIDE this
          wrapper as siblings, so hovering them doesn't fire the
          tooltip — they're discrete actions that don't need an
          info popover competing for attention. */}
      <ItemTooltip entry={item.entry} side="right">
        <div className="flex min-w-0 flex-1 cursor-help items-center gap-3">
          <ItemIconFramed
            iconName={iconName}
            entry={item.entry}
            quality={item.quality}
            size="large"
            alt={item.name}
          />
          <div className="min-w-0 flex-1">
            <div
              // line-clamp-2 lets long names wrap to a second line
              // instead of truncating to identical "Arcanum of Bl…" /
              // "Arcanum of Bu…" rows. font-semibold + the brighter
              // quality palette keep the name legible on the card.
              className={cn(
                "line-clamp-2 break-words text-sm font-semibold leading-tight",
                quality
              )}
              title={item.name}
            >
              {item.name}
            </div>
            <div className="mt-1 truncate text-[10px] text-muted-foreground">
              ilvl {item.item_level}
              {item.required_level > 0 && ` · req lvl ${item.required_level}`}
              {" · "}
              <span className="font-mono">#{item.entry}</span>
            </div>
          </div>
        </div>
      </ItemTooltip>
      <a
        href={`https://www.wowhead.com/wotlk/item=${item.entry}`}
        target="_blank"
        rel="noreferrer"
        aria-label="View on Wowhead"
        className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowSquareOutIcon className="size-4" />
      </a>
      <Button
        size="sm"
        variant="outline"
        onClick={onSend}
        disabled={!canSend}
        className="shrink-0"
      >
        Send
      </Button>
    </div>
  )
}

function SendItemDialog({
  item,
  character,
  onClose,
}: {
  item: ItemSummary | null
  character: GameCharacter | null
  onClose: () => void
}) {
  const open = item != null && character != null
  const [count, setCount] = React.useState("1")
  const [subject, setSubject] = React.useState("A gift")
  const [body, setBody] = React.useState("Sent from Dad's MMO Lab.")
  const [sending, setSending] = React.useState(false)

  // Reset state every time a new item enters the dialog.
  React.useEffect(() => {
    if (!item) return
    setCount("1")
    setSubject(`Gift: ${item.name}`)
    setBody("Sent from Dad's MMO Lab.")
  }, [item])

  const send = async () => {
    if (!item || !character) return
    const n = parseInt(count, 10)
    if (Number.isNaN(n) || n < 1) {
      toast.error("Count must be at least 1")
      return
    }
    setSending(true)
    const id = toast.loading(`Mailing ${n}× ${item.name} to ${character.name}…`)
    try {
      await trackedInvoke<{ output: string }>("send_item_to_character", {
        args: {
          characterName: character.name,
          itemId: item.entry,
          count: n,
          subject,
          body,
        },
      })
      toast.success(`Sent ${n}× ${item.name} to ${character.name}`, { id })
      // Auto-close on success — the user can re-open the inventory
      // entry if they want to send more. Keeping the dialog open after
      // a successful send made it ambiguous whether a follow-up click
      // would re-send or send a different item.
      onClose()
    } catch (err) {
      toast.error("Failed to send item", {
        id,
        description: typeof err === "string" ? err : String(err),
      })
    } finally {
      setSending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Send item via mail</DialogTitle>
          <DialogDescription>
            Deliver this item to{" "}
            <span className="font-mono">{character?.name}</span>'s in-game
            mailbox. Works whether the character is online or not.
          </DialogDescription>
        </DialogHeader>

        {item && (
          <div className="space-y-3 text-sm">
            <div className="rounded-md border border-border bg-muted/30 p-3">
              <div className={cn("font-medium", QUALITY_COLORS[item.quality])}>
                {item.name}
              </div>
              <div className="font-mono text-xs text-muted-foreground">
                #{item.entry} · ilvl {item.item_level}
              </div>
            </div>

            <Field label="Quantity">
              <Input
                value={count}
                onChange={(e) => setCount(e.target.value)}
                className="h-8"
                inputMode="numeric"
              />
            </Field>
            <Field label="Subject">
              <Input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="h-8"
              />
            </Field>
            <Field label="Body">
              <Input
                value={body}
                onChange={(e) => setBody(e.target.value)}
                className="h-8"
              />
            </Field>

          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button onClick={send} disabled={sending || !item || !character}>
            <PaperPlaneTiltIcon className="size-4" />
            {sending ? "Sending…" : "Send"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      {children}
    </div>
  )
}

function EmptyState({ hasQuery }: { hasQuery: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border bg-muted/20 p-12 text-center text-sm text-muted-foreground">
      <PackageIcon className="size-8" />
      <div>
        {hasQuery
          ? "No items match that search."
          : "Type an item name to search the database."}
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
      <div className="font-medium">Item search failed</div>
      <div className="mt-1 text-xs">{message}</div>
      <Button size="sm" variant="outline" className="mt-3" onClick={onRetry}>
        Retry
      </Button>
    </div>
  )
}

/**
 * Quality dropdown item. Renders "≥ Common" / "≥ Uncommon" / etc.
 * with the rarity name colored to match the WoW palette (the ≥ glyph
 * itself stays in the default text color so the row visually anchors
 * on the comparator). The "Any quality" zero option skips both the
 * glyph and the color since it's a non-filter.
 */
function QualityOption({ q }: { q: number }) {
  if (q === 0) return <span>Any quality</span>
  const color = QUALITY_COLORS[q] ?? "text-foreground"
  return (
    <span className="flex items-center gap-1">
      <span className="text-muted-foreground">≥</span>
      <span className={cn("font-medium", color)}>{QUALITY_LABELS[q]}</span>
    </span>
  )
}

/**
 * Page-level options menu, surfaced as a settings-cog button next to
 * the page title. v1 has one toggle (Show Deprecated) but the menu
 * structure is in place so we can add more without re-thinking
 * placement later.
 */
function InventoryOptionsMenu({
  showDeprecated,
  onToggleShowDeprecated,
}: {
  showDeprecated: boolean
  onToggleShowDeprecated: (next: boolean) => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0"
          aria-label="Inventory options"
        >
          <GearSixIcon className="size-4" />
          Options
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Search filters</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem
          checked={showDeprecated}
          onCheckedChange={(v) => onToggleShowDeprecated(Boolean(v))}
          // Stop the Radix-default close-on-select so the user can
          // toggle multiple options without re-opening the menu.
          onSelect={(e) => e.preventDefault()}
        >
          Show deprecated items
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * Small info well at the top of the inventory grid. Shows ONLY when:
 *   - icon cache status has loaded AND is "not_extracted" AND
 *   - user has a client connected (status would be "no_client" otherwise) AND
 *   - user hasn't clicked dismiss before (persisted to settings.json).
 *
 * Once the user extracts (from the Settings page), status flips to
 * "ready" and the well stops rendering on its own — no need to also
 * dismiss it.
 */
function EnrichInfoWell({
  iconStatus,
  dismissed,
  onDismiss,
}: {
  iconStatus: IconCacheStatus | null
  dismissed: boolean | null
  onDismiss: () => void
}) {
  const { setActivePage } = useServerState()
  if (!iconStatus || dismissed == null) return null
  if (iconStatus.status !== "not_extracted") return null
  if (dismissed) return null

  const persistDismiss = () => {
    onDismiss()
    if (isTauri()) {
      void trackedInvoke("dismiss_notice", { noticeId: ENRICH_NOTICE_ID })
        .catch((e) => console.warn("dismiss_notice failed", e))
    }
  }

  return (
    <div className="flex items-start gap-3 rounded-md border border-sky-500/40 bg-sky-500/10 p-3 text-sky-900 dark:text-sky-200">
      <SparkleIcon className="mt-0.5 size-4 shrink-0 text-sky-600 dark:text-sky-400" />
      <div className="flex-1 text-xs">
        <strong>Want real item icons?</strong> Head to{" "}
        <button
          type="button"
          onClick={() => setActivePage("settings")}
          className="inline-flex items-center gap-1 font-medium underline-offset-2 hover:underline"
        >
          <GearIcon className="size-3.5" />
          Settings
        </button>{" "}
        and run the one-time enrichment. You'll get Wowhead-quality
        icons (plus tooltips and spell data as those land).
      </div>
      <button
        type="button"
        onClick={persistDismiss}
        aria-label="Dismiss"
        className="shrink-0 text-sky-700/70 transition-colors hover:text-sky-900 dark:text-sky-400/70 dark:hover:text-sky-200"
      >
        <XIcon className="size-4" />
      </button>
    </div>
  )
}
