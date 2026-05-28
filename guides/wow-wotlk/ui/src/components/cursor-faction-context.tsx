import * as React from "react"

import { Cursor } from "@/components/ui/warcraftcn/cursor"
import { trackedInvoke } from "@/lib/tauri"

export type CursorFaction = "default" | "human" | "elf" | "undead" | "orc"

const VALID: CursorFaction[] = ["default", "human", "elf", "undead", "orc"]

interface CursorFactionContextValue {
  faction: CursorFaction
  setFaction: (next: CursorFaction) => void
}

const CursorFactionContext = React.createContext<CursorFactionContextValue | null>(null)

/**
 * Provider for the in-app cursor faction. Loads the persisted value on
 * mount, defaults to "human" (matching the BE default), persists on
 * change. Wraps children with `<Cursor faction={...}>` so the
 * faction-specific CSS class lands on the outermost div and cascades
 * to every nested element via `* { cursor: ... }` rules.
 *
 * Scope is the Tauri webview only — the cursor doesn't leak into other
 * applications because CSS `cursor:` only affects elements inside this
 * window.
 */
export function CursorFactionProvider({
  children,
}: {
  children: React.ReactNode
}) {
  // Start at "human" so the first paint has a sensible cursor even
  // before the BE call resolves. If BE returns something different,
  // the next render applies it without flicker (cursor class is just
  // CSS, no remount).
  const [faction, setFactionState] = React.useState<CursorFaction>("human")

  React.useEffect(() => {
    let cancelled = false
    void trackedInvoke<string>("get_cursor_faction")
      .then((v) => {
        if (cancelled) return
        if ((VALID as string[]).includes(v)) {
          setFactionState(v as CursorFaction)
        }
      })
      .catch((e) => console.warn("get_cursor_faction failed", e))
    return () => {
      cancelled = true
    }
  }, [])

  const setFaction = React.useCallback((next: CursorFaction) => {
    setFactionState(next) // optimistic
    void trackedInvoke("set_cursor_faction", { value: next }).catch((e) => {
      console.warn("set_cursor_faction failed", e)
    })
  }, [])

  const value = React.useMemo(() => ({ faction, setFaction }), [faction, setFaction])

  return (
    <CursorFactionContext.Provider value={value}>
      {/* The size-full + min-h-screen keep the wrapper as a "real"
          rectangle that hosts the cursor CSS — otherwise a zero-size
          wrapper wouldn't actually scope the cursor to anything
          visible. */}
      <Cursor faction={faction} className="min-h-screen">
        {children}
      </Cursor>
    </CursorFactionContext.Provider>
  )
}

export function useCursorFaction(): CursorFactionContextValue {
  const ctx = React.useContext(CursorFactionContext)
  if (!ctx) {
    throw new Error("useCursorFaction must be used inside <CursorFactionProvider>")
  }
  return ctx
}
