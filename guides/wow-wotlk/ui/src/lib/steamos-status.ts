import * as React from "react"

import { isTauri, trackedInvoke } from "@/lib/tauri"

/**
 * SteamOS update status — shared across the sidebar badge and the fix
 * screen via a window-event store (same pattern as favorite-bots). The
 * backend remembers the last-acknowledged OS version; `updatePending`
 * is true once a SteamOS update has bumped the live version past it.
 *
 * Kept out of the big server-state context on purpose: this is a small,
 * SteamOS-only concern with no coupling to install/character/module
 * state, so a focused hook keeps the change surgical.
 */
export interface SteamOsStatus {
  isSteamos: boolean
  currentVersion: string | null
  lastVersion: string | null
  updatePending: boolean
}

const EVENT = "dml-steamos-status-changed"
const EMPTY: SteamOsStatus = {
  isSteamos: false,
  currentVersion: null,
  lastVersion: null,
  updatePending: false,
}

let cached: SteamOsStatus | null = null
let inflight: Promise<SteamOsStatus> | null = null

async function fetchStatus(): Promise<SteamOsStatus> {
  if (!isTauri()) return EMPTY
  try {
    return await trackedInvoke<SteamOsStatus>("steamos_status")
  } catch {
    return EMPTY
  }
}

function ensureLoaded(): Promise<SteamOsStatus> {
  if (cached) return Promise.resolve(cached)
  if (!inflight) {
    inflight = fetchStatus().then((s) => {
      cached = s
      inflight = null
      // Notify any already-mounted consumers that the first value landed.
      window.dispatchEvent(new Event(EVENT))
      return s
    })
  }
  return inflight
}

export function useSteamOsStatus(): {
  status: SteamOsStatus | null
  refresh: () => Promise<SteamOsStatus>
  acknowledge: () => Promise<void>
} {
  const [status, setStatus] = React.useState<SteamOsStatus | null>(cached)

  React.useEffect(() => {
    let cancelled = false
    const handler = () => {
      if (cached && !cancelled) setStatus(cached)
    }
    window.addEventListener(EVENT, handler)
    void ensureLoaded().then((s) => {
      if (!cancelled) setStatus(s)
    })
    return () => {
      cancelled = true
      window.removeEventListener(EVENT, handler)
    }
  }, [])

  const refresh = React.useCallback(async () => {
    const s = await fetchStatus()
    cached = s
    window.dispatchEvent(new Event(EVENT))
    return s
  }, [])

  const acknowledge = React.useCallback(async () => {
    if (!isTauri()) return
    try {
      await trackedInvoke("acknowledge_steamos_version")
    } finally {
      await refresh()
    }
  }, [refresh])

  return { status, refresh, acknowledge }
}
