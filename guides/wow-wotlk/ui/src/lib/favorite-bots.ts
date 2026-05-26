import * as React from "react"

/**
 * Favorite bots — client-side preference, persisted to localStorage.
 *
 * Why localStorage and not the Rust app settings: favorites are pure
 * UX bookmarking with no server-side semantics, so a roundtrip to
 * disk via Tauri would add latency without buying durability the user
 * cares about. Bots come and go but their guids are stable, and a
 * stale guid (favorite of a deleted bot) is harmless — it just
 * doesn't match anything when filtering.
 */

const STORAGE_KEY = "dml.favorite_bot_guids"

function readSet(): Set<number> {
  if (typeof window === "undefined") return new Set()
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return new Set()
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return new Set()
    return new Set(arr.filter((n) => typeof n === "number"))
  } catch {
    return new Set()
  }
}

function writeSet(s: Set<number>) {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([...s].sort((a, b) => a - b))
    )
  } catch {
    // QuotaExceeded etc. — drop silently; favorites are non-critical.
  }
}

/**
 * Hook into the favorite-bots set. Returns the current set + helpers
 * for toggling. All open consumers share state via a window-level
 * 'storage' event listener so adding a favorite from one popover
 * updates every other tile in the same render tree.
 */
export function useFavoriteBots(): {
  favorites: Set<number>
  isFavorite: (guid: number) => boolean
  toggle: (guid: number) => void
  add: (guid: number) => void
  remove: (guid: number) => void
} {
  const [favorites, setFavorites] = React.useState<Set<number>>(() => readSet())

  // Sync across windows + manual storage events. `storage` only fires
  // on OTHER tabs in browsers, but Tauri's single-window apps still
  // need an explicit dispatch when WE write — see `dispatchUpdate`.
  React.useEffect(() => {
    const handler = () => setFavorites(readSet())
    window.addEventListener("dml-favorites-changed", handler)
    window.addEventListener("storage", handler)
    return () => {
      window.removeEventListener("dml-favorites-changed", handler)
      window.removeEventListener("storage", handler)
    }
  }, [])

  const persist = (next: Set<number>) => {
    setFavorites(next)
    writeSet(next)
    window.dispatchEvent(new Event("dml-favorites-changed"))
  }

  const isFavorite = (guid: number) => favorites.has(guid)
  const add = (guid: number) => {
    if (favorites.has(guid)) return
    persist(new Set([...favorites, guid]))
  }
  const remove = (guid: number) => {
    if (!favorites.has(guid)) return
    const next = new Set(favorites)
    next.delete(guid)
    persist(next)
  }
  const toggle = (guid: number) => {
    if (favorites.has(guid)) remove(guid)
    else add(guid)
  }

  return { favorites, isFavorite, toggle, add, remove }
}
