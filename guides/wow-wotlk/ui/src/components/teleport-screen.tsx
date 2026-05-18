import * as React from "react"
import {
  ArrowClockwiseIcon,
  CompassIcon,
  HeartIcon,
  HeartStraightIcon,
  MagnifyingGlassIcon,
  MapPinIcon,
  StarIcon,
} from "@phosphor-icons/react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useServerState } from "@/components/server-state-context"
import { trackedInvoke, isTauri } from "@/lib/tauri"
import { cn } from "@/lib/utils"

/**
 * Teleport page. v1 scaffolding:
 *  - Character picker (top).
 *  - Continent tabs (Eastern Kingdoms / Kalimdor / Outland / Northrend
 *    / Dungeons & Raids), each populated from `game_tele` filtered by
 *    map id.
 *  - Search box that filters across the active continent.
 *  - "Favorites" list backed by localStorage so user picks survive
 *    restarts. Star toggle on every row.
 *  - Custom-coords panel for arbitrary teleports (x, y, z, map).
 *  - Status strip at the bottom showing the last worldserver reply.
 *
 * The "high-res map of Azeroth" the user asked for is the natural
 * follow-up here — drop a real zone-map image into each continent tab
 * and overlay the teleport locations as pins. For now we surface them
 * as a scrollable grid so the feature is usable end-to-end.
 */

type TeleportLocation = {
  id: number
  name: string
  map: number
  x: number
  y: number
  z: number
}

const CONTINENTS: { id: string; label: string; mapIds: number[] | "other" }[] = [
  { id: "ek", label: "Eastern Kingdoms", mapIds: [0] },
  { id: "kal", label: "Kalimdor", mapIds: [1] },
  { id: "outland", label: "Outland", mapIds: [530] },
  { id: "northrend", label: "Northrend", mapIds: [571] },
  { id: "instances", label: "Dungeons & Raids", mapIds: "other" },
]

const FAVORITES_KEY = "dml.teleport.favorites.v1"

export function TeleportScreen() {
  // Reads the user's globally-selected character. Teleport doesn't
  // need its own picker — pages that target a non-user character
  // (NPCs, AH Bot) still own their dedicated CharacterPicker.
  const { selectedCharacter: character } = useServerState()

  const [locations, setLocations] = React.useState<TeleportLocation[]>([])
  const [loading, setLoading] = React.useState(false)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [activeContinent, setActiveContinent] = React.useState("ek")
  const [search, setSearch] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const [lastResult, setLastResult] = React.useState<string | null>(null)
  const [resultKind, setResultKind] = React.useState<"ok" | "err" | null>(null)
  const [favorites, setFavorites] = React.useState<number[]>(loadFavorites)

  const refresh = React.useCallback(async () => {
    if (!isTauri()) return
    setLoading(true)
    setLoadError(null)
    try {
      const list = await trackedInvoke<TeleportLocation[]>(
        "list_teleport_locations"
      )
      setLocations(list)
    } catch (err) {
      setLoadError(String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void refresh()
  }, [refresh])

  React.useEffect(() => {
    try {
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites))
    } catch {
      /* localStorage unavailable in some embeddings — non-fatal */
    }
  }, [favorites])

  const toggleFavorite = (id: number) => {
    setFavorites((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    )
  }

  const tele = async (loc: TeleportLocation) => {
    if (!character) {
      setLastResult("Pick a character first.")
      setResultKind("err")
      return
    }
    setBusy(true)
    setLastResult(null)
    setResultKind(null)
    try {
      const r = await trackedInvoke<{ output: string }>(
        "teleport_character_to_location",
        {
          args: {
            characterName: character.name,
            locationName: loc.name,
          },
        }
      )
      setLastResult(`✓ ${loc.name}: ${r.output.trim() || "OK"}`)
      setResultKind("ok")
    } catch (err) {
      setLastResult(String(err))
      setResultKind("err")
    } finally {
      setBusy(false)
    }
  }

  const teleToCoords = async (
    map: number,
    x: number,
    y: number,
    z: number
  ) => {
    if (!character) {
      setLastResult("Pick a character first.")
      setResultKind("err")
      return
    }
    setBusy(true)
    setLastResult(null)
    setResultKind(null)
    try {
      const r = await trackedInvoke<{ output: string }>(
        "teleport_character_to_coords",
        {
          args: {
            characterName: character.name,
            map,
            x,
            y,
            z,
          },
        }
      )
      setLastResult(`✓ Custom coords: ${r.output.trim() || "OK"}`)
      setResultKind("ok")
    } catch (err) {
      setLastResult(String(err))
      setResultKind("err")
    } finally {
      setBusy(false)
    }
  }

  // Slice the location list by the active continent, then filter by
  // the search text (name LIKE %search%).
  const visible = React.useMemo(() => {
    const cont = CONTINENTS.find((c) => c.id === activeContinent)
    if (!cont) return []
    const knownMapIds = new Set(
      CONTINENTS.flatMap((c) => (c.mapIds === "other" ? [] : c.mapIds))
    )
    const matchesContinent = (loc: TeleportLocation) => {
      if (cont.mapIds === "other") return !knownMapIds.has(loc.map)
      return cont.mapIds.includes(loc.map)
    }
    const q = search.trim().toLowerCase()
    return locations.filter(
      (l) => matchesContinent(l) && (q === "" || l.name.toLowerCase().includes(q))
    )
  }, [locations, activeContinent, search])

  const favoriteLocations = React.useMemo(() => {
    const byId = new Map(locations.map((l) => [l.id, l] as const))
    return favorites
      .map((id) => byId.get(id))
      .filter((l): l is TeleportLocation => l != null)
  }, [favorites, locations])

  return (
    <div className="grid h-[calc(100svh-var(--header-height))] grid-rows-[auto_minmax(0,1fr)_auto] gap-4 p-6">
      <header className="space-y-3">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-1">
            <h1 className="font-heading text-2xl font-semibold leading-tight">
              Teleport
            </h1>
            <p className="text-sm text-muted-foreground">
              Beam any of your characters to a named location or arbitrary
              coordinates. The character must be online in WoW for the
              teleport to take effect.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={refresh}
            disabled={loading}
          >
            <ArrowClockwiseIcon
              className={cn("size-4", loading && "animate-spin")}
            />
            Refresh locations
          </Button>
        </div>

        {/* Favorites + Custom coords sit side-by-side under the
            header. Favorites takes the full half-row even when
            empty so the grid stays balanced — coords form was too
            wide alone after the character picker moved out. */}
        <div className="grid gap-3 md:grid-cols-2">
          <FavoritesStrip
            favorites={favoriteLocations}
            onTeleport={tele}
            onUnfavorite={toggleFavorite}
            busy={busy}
          />
          <CustomCoordsForm onTeleport={teleToCoords} busy={busy} />
        </div>
      </header>

      <div className="min-h-0 space-y-3 overflow-hidden">
        <ContinentTabs
          active={activeContinent}
          onChange={setActiveContinent}
          counts={countByContinent(locations)}
        />

        <div className="relative">
          <MagnifyingGlassIcon className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search teleport locations…"
            className="pl-9"
          />
        </div>

        <div className="min-h-0 overflow-y-auto pr-1">
          {loadError ? (
            <ErrorPanel message={loadError} onRetry={refresh} />
          ) : loading && locations.length === 0 ? (
            <SkeletonGrid />
          ) : visible.length === 0 ? (
            <EmptyZone />
          ) : (
            <div className="grid grid-cols-1 gap-2 pb-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {visible.map((loc) => (
                <LocationTile
                  key={loc.id}
                  loc={loc}
                  isFavorite={favorites.includes(loc.id)}
                  onTeleport={tele}
                  onToggleFavorite={toggleFavorite}
                  busy={busy}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {lastResult && (
        <div
          className={cn(
            "rounded-md border p-3 text-xs",
            resultKind === "ok"
              ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400"
              : "border-rose-500/30 bg-rose-500/5 text-rose-600 dark:text-rose-400"
          )}
        >
          {lastResult}
        </div>
      )}
    </div>
  )
}

function loadFavorites(): number[] {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed)
      ? parsed.filter((n): n is number => typeof n === "number")
      : []
  } catch {
    return []
  }
}

function countByContinent(locs: TeleportLocation[]): Record<string, number> {
  const out: Record<string, number> = {}
  const known = new Set(
    CONTINENTS.flatMap((c) => (c.mapIds === "other" ? [] : c.mapIds))
  )
  for (const cont of CONTINENTS) {
    out[cont.id] =
      cont.mapIds === "other"
        ? locs.filter((l) => !known.has(l.map)).length
        : locs.filter((l) => (cont.mapIds as number[]).includes(l.map)).length
  }
  return out
}

function ContinentTabs({
  active,
  onChange,
  counts,
}: {
  active: string
  onChange: (id: string) => void
  counts: Record<string, number>
}) {
  return (
    <div className="flex flex-wrap gap-1.5 rounded-md border border-border bg-muted/30 p-1">
      {CONTINENTS.map((c) => (
        <button
          key={c.id}
          type="button"
          onClick={() => onChange(c.id)}
          className={cn(
            "flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium transition-colors",
            active === c.id
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
          )}
        >
          <CompassIcon className="size-3.5" />
          {c.label}
          <span
            className={cn(
              "rounded-full px-1.5 py-0 text-[10px]",
              active === c.id
                ? "bg-primary-foreground/20 text-primary-foreground"
                : "bg-muted text-muted-foreground"
            )}
          >
            {counts[c.id] ?? 0}
          </span>
        </button>
      ))}
    </div>
  )
}

function FavoritesStrip({
  favorites,
  onTeleport,
  onUnfavorite,
  busy,
}: {
  favorites: TeleportLocation[]
  onTeleport: (loc: TeleportLocation) => void
  onUnfavorite: (id: number) => void
  busy: boolean
}) {
  return (
    <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400">
        <StarIcon className="size-3.5" weight="fill" />
        Favorites
      </div>
      {favorites.length === 0 ? (
        <div className="text-xs text-amber-700/70 dark:text-amber-300/70">
          No favorites yet. Tap the heart on any location below to save
          it here for quick access.
        </div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {favorites.map((loc) => (
            <div
              key={loc.id}
              className="group flex items-center gap-1 rounded-full border border-amber-500/40 bg-background px-2.5 py-1 text-xs"
            >
              <button
                type="button"
                onClick={() => onTeleport(loc)}
                disabled={busy}
                className="font-medium hover:text-amber-700 dark:hover:text-amber-400 disabled:opacity-50"
              >
                {loc.name}
              </button>
              <button
                type="button"
                onClick={() => onUnfavorite(loc.id)}
                aria-label="Remove favorite"
                className="text-amber-600/60 hover:text-amber-700 dark:hover:text-amber-400"
              >
                <HeartIcon className="size-3" weight="fill" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function LocationTile({
  loc,
  isFavorite,
  onTeleport,
  onToggleFavorite,
  busy,
}: {
  loc: TeleportLocation
  isFavorite: boolean
  onTeleport: (loc: TeleportLocation) => void
  onToggleFavorite: (id: number) => void
  busy: boolean
}) {
  return (
    <div className="group flex items-center gap-2 rounded-md border border-border bg-card p-2.5 transition-colors hover:border-primary/40">
      <MapPinIcon className="size-4 shrink-0 text-muted-foreground" />
      <div className="flex-1 min-w-0">
        <div className="truncate text-sm font-medium leading-tight">
          {loc.name}
        </div>
        <div className="truncate font-mono text-[10px] text-muted-foreground">
          map {loc.map} · {loc.x.toFixed(0)}, {loc.y.toFixed(0)}, {loc.z.toFixed(0)}
        </div>
      </div>
      <button
        type="button"
        onClick={() => onToggleFavorite(loc.id)}
        aria-label={isFavorite ? "Remove favorite" : "Add favorite"}
        className={cn(
          "shrink-0 transition-colors",
          isFavorite
            ? "text-amber-500 hover:text-amber-600"
            : "text-muted-foreground hover:text-amber-500"
        )}
      >
        {isFavorite ? (
          <HeartIcon className="size-4" weight="fill" />
        ) : (
          <HeartStraightIcon className="size-4" />
        )}
      </button>
      <Button
        size="sm"
        variant="outline"
        onClick={() => onTeleport(loc)}
        disabled={busy}
        className="shrink-0"
      >
        Tele
      </Button>
    </div>
  )
}

function CustomCoordsForm({
  onTeleport,
  busy,
}: {
  onTeleport: (map: number, x: number, y: number, z: number) => void
  busy: boolean
}) {
  const [map, setMap] = React.useState("0")
  const [x, setX] = React.useState("")
  const [y, setY] = React.useState("")
  const [z, setZ] = React.useState("")

  const submit = () => {
    const m = parseInt(map, 10)
    const xn = parseFloat(x)
    const yn = parseFloat(y)
    const zn = parseFloat(z)
    if (Number.isNaN(m) || Number.isNaN(xn) || Number.isNaN(yn) || Number.isNaN(zn)) {
      return
    }
    onTeleport(m, xn, yn, zn)
  }

  const valid =
    map !== "" && x !== "" && y !== "" && z !== "" &&
    !Number.isNaN(parseInt(map, 10)) &&
    !Number.isNaN(parseFloat(x)) &&
    !Number.isNaN(parseFloat(y)) &&
    !Number.isNaN(parseFloat(z))

  return (
    <div className="rounded-md border border-border bg-card p-3">
      <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Custom coordinates
      </div>
      <div className="grid grid-cols-4 gap-2">
        <CoordInput label="Map" value={map} onChange={setMap} />
        <CoordInput label="X" value={x} onChange={setX} />
        <CoordInput label="Y" value={y} onChange={setY} />
        <CoordInput label="Z" value={z} onChange={setZ} />
      </div>
      <Button
        size="sm"
        onClick={submit}
        disabled={!valid || busy}
        className="mt-2 w-full"
      >
        Teleport to coordinates
      </Button>
    </div>
  )
}

function CoordInput({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="space-y-1">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 font-mono text-xs"
      />
    </div>
  )
}

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-1 gap-2 pb-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: 12 }).map((_, i) => (
        <div
          key={i}
          className="h-14 animate-pulse rounded-md border border-border bg-muted/30"
        />
      ))}
    </div>
  )
}

function EmptyZone() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border bg-muted/20 p-12 text-center text-sm text-muted-foreground">
      <MapPinIcon className="size-8" />
      <div>No locations match this continent / search.</div>
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
      <div className="font-medium">Couldn't load teleport locations</div>
      <div className="mt-1 text-xs">{message}</div>
      <Button size="sm" variant="outline" className="mt-3" onClick={onRetry}>
        Retry
      </Button>
    </div>
  )
}
