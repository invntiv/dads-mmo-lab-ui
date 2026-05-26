import * as React from "react"
import { UserCircleIcon } from "@phosphor-icons/react"

import { TalentTree } from "@/components/talent-tree"
import { useServerState } from "@/components/server-state-context"
import { isTauri, trackedInvoke } from "@/lib/tauri"

/**
 * My Talents tab — renders the selected character's class talent
 * trees with their actual point allocations.
 *
 * Data flow:
 *   1. character_talent.spell rows fetched via `get_character_talents`
 *   2. Backend joins each spell_id against the cached talent metadata
 *      to produce { talentId: rank } pairs (rank is 1-based)
 *   3. <TalentTree /> overlays these onto the static tree layout
 *      from talent-trees.json
 *
 * Re-fetches whenever the selected character changes. The fetch is
 * cheap (a single SELECT keyed by guid + a HashMap-bounded loop in
 * Rust) so we don't need to memoize beyond React's natural caching.
 */
export function DashboardMyTalents() {
  const { selectedCharacter, installComplete } = useServerState()
  const guid = selectedCharacter?.guid ?? null
  const [points, setPoints] = React.useState<Record<number, number>>({})
  const [error, setError] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(false)

  React.useEffect(() => {
    if (!guid || !isTauri()) {
      setPoints({})
      setError(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    trackedInvoke<Record<string, number>>("get_character_talents", { guid })
      .then((result) => {
        if (cancelled) return
        // Tauri serializes Rust HashMap<i32, _> with stringified keys.
        // Coerce back to numbers so the TalentTree component's
        // talent.id (number) lookups hit.
        const coerced: Record<number, number> = {}
        for (const [k, v] of Object.entries(result)) {
          coerced[Number(k)] = v
        }
        setPoints(coerced)
      })
      .catch((e) => {
        if (cancelled) return
        setError(typeof e === "string" ? e : String(e))
        setPoints({})
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [guid])

  if (!installComplete) {
    return (
      <div className="flex-1 p-4">
        <div className="flex items-center gap-3 rounded-md border border-dashed border-border bg-muted/20 p-4 text-sm text-muted-foreground">
          <UserCircleIcon className="size-6 shrink-0" />
          Install the server first to view talents.
        </div>
      </div>
    )
  }
  if (!selectedCharacter) {
    return (
      <div className="flex-1 p-4">
        <div className="flex items-center gap-3 rounded-md border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-700 dark:text-amber-400">
          <UserCircleIcon className="size-6 shrink-0" />
          <div className="flex-1">
            <div className="font-semibold">No character selected</div>
            <div className="text-xs">
              Pick one from the sidebar to view its talents.
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Talent points unlock at Lv 10; one per level from there.
  const totalPointsAvailable = Math.max(0, selectedCharacter.level - 9)

  return (
    <div className="flex-1 space-y-3 p-4">
      {error && (
        <div className="rounded-md border border-rose-500/30 bg-rose-500/5 p-3 text-xs text-rose-700 dark:text-rose-400">
          Failed to load talents: {error}
        </div>
      )}
      <TalentTree
        classId={selectedCharacter.class}
        pointsByTalentId={points}
        totalPointsAvailable={totalPointsAvailable}
      />
      {loading && (
        <div className="text-center text-xs text-muted-foreground">
          Loading talents…
        </div>
      )}
    </div>
  )
}
