import * as React from "react"
import { invoke } from "@tauri-apps/api/core"

import { isTauri } from "@/lib/tauri"

/**
 * Tiny sound-effects layer. WoW-classic cues, fired on app events
 * (install start/finish, server start, quit). Prefs (enabled + volume)
 * live here as a small external store backed by localStorage, so the
 * two UI controls that edit them — the Audio section in Settings and
 * the mute toggle in the title bar — share one source of truth, and
 * any module (not just React components) can call `playSfx`.
 *
 * Playback itself is NOT done in the WebView: WebKitGTK on SteamOS is
 * missing the GStreamer audio sinks, so HTML5 <audio> is silent there.
 * Instead `playSfx` invokes the native `play_sfx` command, which shells
 * out to the Deck's PipeWire player. See src-tauri/src/sfx.rs.
 */

export type SfxName =
  | "questActivate"
  | "questComplete"
  | "levelUp"
  | "stealth"
  | "splash"

export type SfxPrefs = {
  enabled: boolean
  /** 0–100, matches the slider + the "NN%" readout. */
  volume: number
}

const STORAGE_KEY = "dml.audio.v1"

function clampVolume(v: number): number {
  if (Number.isNaN(v)) return 75
  return Math.max(0, Math.min(100, Math.round(v)))
}

function load(): SfxPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const p = JSON.parse(raw)
      return {
        enabled: typeof p.enabled === "boolean" ? p.enabled : true,
        volume: clampVolume(typeof p.volume === "number" ? p.volume : 75),
      }
    }
  } catch {
    /* corrupt/unavailable storage — fall through to defaults */
  }
  return { enabled: true, volume: 75 }
}

let prefs: SfxPrefs = load()
const listeners = new Set<() => void>()

export function getSfxPrefs(): SfxPrefs {
  return prefs
}

export function setSfxPrefs(patch: Partial<SfxPrefs>): void {
  prefs = {
    enabled: patch.enabled ?? prefs.enabled,
    volume: patch.volume != null ? clampVolume(patch.volume) : prefs.volume,
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
  } catch {
    /* non-fatal */
  }
  for (const l of listeners) l()
}

/**
 * Fire-and-forget cue. No-op when SFX are disabled or outside Tauri.
 * Delegates to the native player; failures are swallowed.
 */
export function playSfx(name: SfxName): void {
  if (!prefs.enabled) return
  if (!isTauri()) return
  void invoke("play_sfx", {
    name,
    volume: clampVolume(prefs.volume) / 100,
  }).catch(() => {
    /* non-fatal */
  })
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

/** React binding for the audio prefs. */
export function useSfx() {
  const snapshot = React.useSyncExternalStore(
    subscribe,
    getSfxPrefs,
    getSfxPrefs
  )
  return {
    enabled: snapshot.enabled,
    volume: snapshot.volume,
    setEnabled: (enabled: boolean) => setSfxPrefs({ enabled }),
    setVolume: (volume: number) => setSfxPrefs({ volume }),
    toggleEnabled: () => setSfxPrefs({ enabled: !getSfxPrefs().enabled }),
    playSfx,
  }
}
