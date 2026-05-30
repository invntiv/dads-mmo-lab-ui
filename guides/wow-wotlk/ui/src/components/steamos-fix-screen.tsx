import * as React from "react"
import { listen } from "@tauri-apps/api/event"
import {
  ArrowLeftIcon,
  CheckCircleIcon,
  CircleNotchIcon,
  WarningIcon,
  WrenchIcon,
  XCircleIcon,
} from "@phosphor-icons/react"

import { Button } from "@/components/ui/button"
import { InstallConsole } from "@/components/install-console"
import { useServerState } from "@/components/server-state-context"
import type {
  InstallLogEntry,
  InstallLogLine,
} from "@/components/server-state-context"
import { useSteamOsStatus } from "@/lib/steamos-status"
import { isTauri, trackedInvoke } from "@/lib/tauri"
import { cn } from "@/lib/utils"

/**
 * SteamOS Update Fix page.
 *
 * A SteamOS system update swaps the rootfs and routinely wipes Docker +
 * breaks the pacman keyring, so a server that worked yesterday won't
 * start. This screen explains the situation, then runs the root-level
 * `fix-after-update-ui.sh` (via pkexec) and streams its output into the
 * same console the installer uses. On success the "update pending" badge
 * clears (the backend advances the acknowledged OS version).
 */

type Phase = "idle" | "running" | "done"

type Stream = InstallLogLine["stream"]

interface LogState {
  entries: InstallLogEntry[]
  pending: InstallLogLine | null
  activeSection: number | null
  nextId: number
}

type LogAction =
  | { t: "output"; stream: Stream; line: string; transient: boolean }
  | { t: "section"; stage: "start" | "end"; title: string | null }
  | { t: "reset" }

const EMPTY_LOG: LogState = {
  entries: [],
  pending: null,
  activeSection: null,
  nextId: 1,
}

function logReducer(state: LogState, action: LogAction): LogState {
  switch (action.t) {
    case "reset":
      return { ...EMPTY_LOG }

    case "section": {
      if (action.stage === "start") {
        const id = state.nextId
        return {
          ...state,
          nextId: id + 1,
          activeSection: id,
          // Commit any in-flight top-level transient before the section.
          entries: [
            ...state.entries,
            ...(state.pending
              ? [{ kind: "line" as const, data: state.pending }]
              : []),
            {
              kind: "section" as const,
              data: {
                id,
                title: action.title ?? "Working…",
                state: "active" as const,
                lines: [],
                pending: null,
                progress: null,
              },
            },
          ],
          pending: null,
        }
      }
      // end — mark the active section done, committing its pending line.
      return {
        ...state,
        activeSection: null,
        entries: state.entries.map((e) =>
          e.kind === "section" && e.data.id === state.activeSection
            ? {
                ...e,
                data: {
                  ...e.data,
                  state: "done" as const,
                  lines: e.data.pending
                    ? [...e.data.lines, e.data.pending]
                    : e.data.lines,
                  pending: null,
                },
              }
            : e
        ),
      }
    }

    case "output": {
      const id = state.nextId
      const line: InstallLogLine = {
        id,
        stream: action.stream,
        text: action.line,
      }
      const bump = { nextId: id + 1 }

      // Inside a live section?
      if (state.activeSection != null) {
        return {
          ...state,
          ...bump,
          entries: state.entries.map((e) => {
            if (e.kind !== "section" || e.data.id !== state.activeSection) {
              return e
            }
            if (action.transient) {
              return { ...e, data: { ...e.data, pending: line } }
            }
            return {
              ...e,
              data: {
                ...e.data,
                lines: [...e.data.lines, line],
                pending: null,
              },
            }
          }),
        }
      }

      // Top level.
      if (action.transient) {
        return { ...state, ...bump, pending: line }
      }
      return {
        ...state,
        ...bump,
        pending: null,
        entries: [...state.entries, { kind: "line", data: line }],
      }
    }
  }
}

export function SteamosFixScreen() {
  const { setActivePage, refreshServerStatus } = useServerState()
  const { status, refresh } = useSteamOsStatus()
  // pkexec has no password prompt under gamescope (Gaming Mode), so the
  // fix can only run from Desktop Mode — gate the button on it.
  const [gamingMode, setGamingMode] = React.useState(false)
  React.useEffect(() => {
    if (!isTauri()) return
    void trackedInvoke<boolean>("is_gaming_mode")
      .then(setGamingMode)
      .catch(() => {})
  }, [])
  const [phase, setPhase] = React.useState<Phase>("idle")
  const [confirming, setConfirming] = React.useState(false)
  const [result, setResult] = React.useState<{
    success: boolean
    message: string | null
  } | null>(null)
  const [log, dispatch] = React.useReducer(logReducer, EMPTY_LOG)

  // Wire up event listeners only while a run is in flight. Registered
  // before the command is invoked (inside the same effect) so no early
  // output is missed.
  const runningRef = React.useRef(false)
  const startRun = React.useCallback(async () => {
    if (runningRef.current || !isTauri()) return
    runningRef.current = true
    setConfirming(false)
    setResult(null)
    dispatch({ t: "reset" })
    setPhase("running")

    const unlisteners: Array<() => void> = []
    const cleanup = () => {
      unlisteners.forEach((u) => u())
      unlisteners.length = 0
    }

    const outputUn = await listen<{
      stream: Stream
      line: string
      transient: boolean
    }>("steamos_fix:output", (e) => {
      dispatch({
        t: "output",
        stream: e.payload.stream,
        line: e.payload.line,
        transient: e.payload.transient,
      })
    })
    unlisteners.push(outputUn)

    const sectionUn = await listen<{
      stage: "start" | "end"
      title: string | null
    }>("steamos_fix:section", (e) => {
      dispatch({
        t: "section",
        stage: e.payload.stage,
        title: e.payload.title,
      })
    })
    unlisteners.push(sectionUn)

    const doneUn = await listen<{
      success: boolean
      code: number | null
      message: string | null
    }>("steamos_fix:done", (e) => {
      setResult({ success: e.payload.success, message: e.payload.message })
      setPhase("done")
      runningRef.current = false
      cleanup()
      // Refresh status so the sidebar badge clears on success.
      void refresh()
      // The fix bounces the server (compose down → up), so the sidebar's
      // Start/Stop button is stale — re-poll worldserver status.
      if (e.payload.success) void refreshServerStatus()
    })
    unlisteners.push(doneUn)

    try {
      await trackedInvoke("run_steamos_fix")
    } catch (err) {
      dispatch({
        t: "output",
        stream: "system",
        line: typeof err === "string" ? err : String(err),
        transient: false,
      })
      setResult({
        success: false,
        message: typeof err === "string" ? err : String(err),
      })
      setPhase("done")
      runningRef.current = false
      cleanup()
    }
  }, [refresh, refreshServerStatus])

  // Tear down listeners if the user navigates away mid-run.
  React.useEffect(() => {
    return () => {
      runningRef.current = false
    }
  }, [])

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-4 pt-3 pb-6 lg:px-6">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <WrenchIcon className="size-6 text-primary" weight="fill" />
          SteamOS Update Fix
        </h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          A SteamOS update can wipe Docker and break the package keyring,
          which stops your server from starting. This puts everything back —
          your characters are safe.
        </p>
      </div>

      {status?.updatePending && phase === "idle" && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-700 dark:text-amber-400">
          <WarningIcon className="mt-0.5 size-4 shrink-0" weight="fill" />
          <div>
            <div className="font-semibold">SteamOS was updated</div>
            <div className="text-xs">
              Detected {status.lastVersion ?? "an earlier version"} →{" "}
              {status.currentVersion ?? "now"}. If your server won't start,
              run the fix below.
            </div>
          </div>
        </div>
      )}

      {/* Idle / confirm */}
      {phase === "idle" && (
        <div className="space-y-4 rounded-md border border-border bg-card p-4">
          <div className="space-y-2 text-sm">
            <div className="font-medium">What this does:</div>
            <ul className="ml-1 space-y-1 text-muted-foreground">
              <li>• Re-enables installs on the SteamOS read-only system</li>
              <li>• Rebuilds the pacman keyring</li>
              <li>• Reinstalls Docker + the compose plugin</li>
              <li>• Restarts Docker and refreshes your server's network</li>
            </ul>
          </div>

          <div
            className={cn(
              "flex items-start gap-2 rounded-md border p-3 text-xs",
              gamingMode
                ? "border-rose-500/30 bg-rose-500/5 text-rose-700 dark:text-rose-400"
                : "border-border bg-muted/30 text-muted-foreground"
            )}
          >
            <WarningIcon
              className={cn(
                "mt-0.5 size-4 shrink-0",
                gamingMode ? "" : "text-amber-500"
              )}
            />
            <div>
              This rebuilds the pacman keyring (any custom keys you added
              manually are removed) and asks for your system password. On a
              Steam Deck this needs <span className="font-medium">Desktop
              Mode</span> because Gaming Mode has no password prompt.
            </div>
          </div>

          {confirming ? (
            <div className="flex items-center gap-2">
              <Button onClick={() => void startRun()} disabled={gamingMode}>
                <WrenchIcon className="size-4" weight="fill" />
                Yes, run the fix
              </Button>
              <Button variant="outline" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button
              onClick={() => setConfirming(true)}
              disabled={gamingMode}
              title={
                gamingMode
                  ? "Switch to Desktop Mode to run the fix"
                  : undefined
              }
            >
              <WrenchIcon className="size-4" weight="fill" />
              Run the fix
            </Button>
          )}
        </div>
      )}

      {/* Running / done */}
      {(phase === "running" || phase === "done") && (
        <>
          {phase === "done" && result && (
            <div
              className={cn(
                "flex items-start gap-2 rounded-md border p-3 text-sm",
                result.success
                  ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400"
                  : "border-rose-500/30 bg-rose-500/5 text-rose-700 dark:text-rose-400"
              )}
            >
              {result.success ? (
                <CheckCircleIcon className="mt-0.5 size-4 shrink-0" weight="fill" />
              ) : (
                <XCircleIcon className="mt-0.5 size-4 shrink-0" weight="fill" />
              )}
              <div>
                <div className="font-semibold">
                  {result.success
                    ? "Docker is working again"
                    : "The fix didn't finish"}
                </div>
                <div className="text-xs">
                  {result.message ??
                    (result.success
                      ? "Your server is ready — head to the Dashboard to start it."
                      : "See the log below for details.")}
                </div>
              </div>
            </div>
          )}

          <InstallConsole
            entries={log.entries}
            pending={log.pending}
            className="h-[360px]"
          />

          <div className="flex items-center gap-2">
            {phase === "running" ? (
              <Button disabled>
                <CircleNotchIcon className="size-4 animate-spin" />
                Running the fix…
              </Button>
            ) : (
              <>
                <Button variant="outline" onClick={() => setActivePage("dashboard")}>
                  <ArrowLeftIcon className="size-4" />
                  Back to dashboard
                </Button>
                {!result?.success && (
                  <Button onClick={() => void startRun()} disabled={gamingMode}>
                    <WrenchIcon className="size-4" weight="fill" />
                    Try again
                  </Button>
                )}
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}
