import * as React from "react"
import {
  ArrowClockwiseIcon,
  CheckCircleIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react"

import { Button } from "@/components/ui/button"
import { trackedInvoke, isTauri } from "@/lib/tauri"
import { cn } from "@/lib/utils"

/**
 * Registers The Lab and the WoW client as Steam non-Steam games so
 * they show up in Gaming Mode. Writing to shortcuts.vdf while Steam is
 * running gets reverted on Steam's next exit, so this section gates
 * every action on Steam being closed and refreshes status to nudge the
 * user.
 *
 * Artwork (grid/hero/logo/icon) is a follow-up — once we have the PNG
 * assets in src-tauri/resources/steam-art/ we'll drop them into the
 * grid/ folder keyed by appid. Until then Steam shows a generic tile.
 */
type SteamIntegrationStatus = {
  steam_running: boolean
  user_id: string | null
  thelab_present: boolean
  wow_present: boolean
  thelab_appid: number | null
  wow_appid: number | null
}

type AddOutcome =
  | {
      status: "added"
      appid: number
      artwork_files: number
      compat_tool: string | null
    }
  | {
      status: "already_present"
      appid: number
      artwork_files: number
      compat_tool: string | null
    }

const POLL_INTERVAL_MS = 4_000

export function SteamIntegrationSection() {
  const [status, setStatus] = React.useState<SteamIntegrationStatus | null>(
    null
  )
  const [busy, setBusy] = React.useState<"thelab" | "wow" | null>(null)
  // Per-target notifications so The Lab's success card stays next to The
  // Lab's row (instead of bouncing into WoW's spot when WoW is added).
  const [results, setResults] = React.useState<{
    thelab?: AddOutcome
    wow?: AddOutcome
  }>({})
  const [errors, setErrors] = React.useState<{
    thelab?: string
    wow?: string
  }>({})

  const refresh = React.useCallback(async () => {
    if (!isTauri()) return
    try {
      const s = await trackedInvoke<SteamIntegrationStatus>(
        "get_steam_integration_status"
      )
      setStatus(s)
    } catch (e) {
      console.warn("get_steam_integration_status failed", e)
    }
  }, [])

  // Initial load + poll so the "Steam is running" banner clears as
  // soon as the user actually quits Steam.
  React.useEffect(() => {
    void refresh()
    const h = setInterval(refresh, POLL_INTERVAL_MS)
    return () => clearInterval(h)
  }, [refresh])

  const add = async (target: "thelab" | "wow") => {
    setBusy(target)
    setErrors((prev) => ({ ...prev, [target]: undefined }))
    setResults((prev) => ({ ...prev, [target]: undefined }))
    console.log(`[steam-integration] add_to_steam start: target=${target}`)
    try {
      const outcome = await trackedInvoke<AddOutcome>("add_to_steam", { target })
      console.log(`[steam-integration] add_to_steam ok:`, outcome)
      setResults((prev) => ({ ...prev, [target]: outcome }))
      await refresh()
    } catch (e) {
      const msg = typeof e === "string" ? e : String(e)
      console.warn(`[steam-integration] add_to_steam error:`, msg)
      setErrors((prev) => ({ ...prev, [target]: msg }))
    } finally {
      setBusy(null)
    }
  }

  if (!isTauri() || !status) return null

  const steamRunning = status.steam_running
  const canAct = !steamRunning && status.user_id !== null

  return (
    <div className="space-y-3 rounded-md border border-border bg-card p-4">
      {steamRunning ? (
        <SteamRunningBanner onRefresh={() => void refresh()} />
      ) : (
        <div className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <CheckCircleIcon
            weight="fill"
            className="size-3.5 text-emerald-500"
          />
          Steam is closed — safe to add shortcuts.
        </div>
      )}

      <Row
        target="thelab"
        title="The Lab"
        subtitle="This app, as a non-Steam game so it can run in Gaming Mode."
        present={status.thelab_present}
        appid={status.thelab_appid ?? undefined}
        busy={busy === "thelab"}
        disabled={!canAct || busy !== null}
        result={results.thelab}
        error={errors.thelab}
        onAdd={() => void add("thelab")}
      />
      <div className="border-t border-border" />
      <Row
        target="wow"
        title="World of Warcraft: WotLK"
        subtitle="Your WoW client (the path from the WoW client card)."
        present={status.wow_present}
        appid={status.wow_appid ?? undefined}
        busy={busy === "wow"}
        disabled={!canAct || busy !== null}
        result={results.wow}
        error={errors.wow}
        onAdd={() => void add("wow")}
      />

      <p className="text-[11px] text-muted-foreground">
        We back up your <span className="font-mono">shortcuts.vdf</span> before
        every write, and drop bundled artwork into{" "}
        <span className="font-mono">config/grid/</span> so Gaming Mode shows a
        proper tile instead of a generic placeholder.
      </p>
    </div>
  )
}

function Row({
  target,
  title,
  subtitle,
  present,
  appid,
  busy,
  disabled,
  result,
  error,
  onAdd,
}: {
  target: "thelab" | "wow"
  title: string
  subtitle: string
  present: boolean
  appid: number | undefined
  busy: boolean
  disabled: boolean
  result: AddOutcome | undefined
  error: string | undefined
  onAdd: () => void
}) {
  const name = target === "thelab" ? "The Lab" : "World of Warcraft: WotLK"
  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium leading-tight">{title}</span>
            {present && (
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                <CheckCircleIcon weight="fill" className="size-3" />
                In Steam
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">{subtitle}</p>
          {appid != null && (
            <p className="font-mono text-[10px] text-muted-foreground/70">
              appid {appid}
            </p>
          )}
        </div>
        <Button
          size="sm"
          variant={present ? "outline" : "default"}
          onClick={onAdd}
          disabled={disabled}
        >
          {busy ? "Adding…" : present ? "Re-add" : "Add to Steam"}
        </Button>
      </div>

      {result && (
        <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300">
          {result.status === "added" ? (
            <>
              ✓ Added <span className="font-medium">{name}</span> to Steam
              (appid <span className="font-mono">{result.appid}</span>)
              {result.artwork_files > 0 && (
                <>
                  {" "}
                  + {result.artwork_files} artwork file
                  {result.artwork_files === 1 ? "" : "s"}
                </>
              )}
              {result.compat_tool && (
                <>
                  {" "}
                  + Proton compat set to{" "}
                  <span className="font-mono">{result.compat_tool}</span>
                </>
              )}
              . Start Steam again to see it in your library.
            </>
          ) : (
            <>
              <span className="font-medium">{name}</span> is already in your
              Steam library (appid{" "}
              <span className="font-mono">{result.appid}</span>)
              {result.artwork_files > 0 && (
                <>
                  {" "}
                  — refreshed {result.artwork_files} artwork file
                  {result.artwork_files === 1 ? "" : "s"}
                </>
              )}
              {result.compat_tool && (
                <>
                  {", "}re-confirmed Proton compat as{" "}
                  <span className="font-mono">{result.compat_tool}</span>
                </>
              )}
              .
            </>
          )}
        </div>
      )}

      {error && (
        <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">
          {error}
        </div>
      )}
    </div>
  )
}

function SteamRunningBanner({ onRefresh }: { onRefresh: () => void }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
      <WarningCircleIcon className="mt-0.5 size-4 shrink-0" />
      <div className="flex-1 space-y-1">
        <div className="font-medium">Steam is running — please quit it</div>
        <p className="text-amber-700/90 dark:text-amber-300/90">
          Steam keeps your shortcuts in memory and rewrites them on exit, so
          any change we make now would be reverted. Right-click the Steam
          tray icon and choose <span className="font-medium">Exit</span>{" "}
          (just closing the window isn't enough). This panel refreshes
          automatically when Steam is gone.
        </p>
      </div>
      <Button size="sm" variant="outline" onClick={onRefresh}>
        <ArrowClockwiseIcon className={cn("size-3.5")} />
        Check again
      </Button>
    </div>
  )
}

