import * as React from "react"
import { listen } from "@tauri-apps/api/event"
import {
  ArrowCounterClockwiseIcon,
  CheckCircleIcon,
  CircleNotchIcon,
  CopySimpleIcon,
  DownloadSimpleIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { trackedInvoke } from "@/lib/tauri"

/** Mirrors migrations::MigrationStatus. */
export type MigrationStatus = {
  pending: boolean
  failed: boolean
  last: number
  target: number
  failureLog: string | null
  canRestore: boolean
}

type RunResult = { success: boolean; log: string }
type StepEvent = {
  id: number
  name: string
  status: "running" | "ok" | "failed"
  detail: string | null
}

/**
 * Full-screen view shown by the NEW binary on first launch when local-data
 * migrations are pending (or a prior run failed). Runs them with live
 * progress; on failure it surfaces a copyable/downloadable log and a
 * "Restore previous version" button that swaps the `.bak` AppImage back and
 * relaunches the old build (per the Track 1 rollback model).
 */
export function UpdatingScreen({
  initial,
  onComplete,
}: {
  initial: MigrationStatus
  onComplete: () => void
}) {
  // If we arrived because a PRIOR run failed, go straight to the failed
  // state with its saved log — don't silently re-run.
  const [phase, setPhase] = React.useState<"running" | "failed">(
    initial.failed ? "failed" : "running"
  )
  const [log, setLog] = React.useState<string>(initial.failureLog ?? "")
  const [done, setDone] = React.useState(0)
  const [restoring, setRestoring] = React.useState(false)
  const total = Math.max(1, initial.target - initial.last)

  // Live step events while running.
  React.useEffect(() => {
    if (phase !== "running") return
    const un = listen<StepEvent>("migration:step", (e) => {
      if (e.payload.status === "ok") setDone((n) => n + 1)
    })
    return () => {
      void un.then((f) => f())
    }
  }, [phase])

  // Kick the run once on mount (only if we're not already in the failed
  // state from a prior attempt).
  const started = React.useRef(false)
  React.useEffect(() => {
    if (phase !== "running" || started.current) return
    started.current = true
    void (async () => {
      try {
        const res = await trackedInvoke<RunResult>("run_migrations")
        setLog(res.log)
        if (res.success) {
          setDone(total)
          // Brief beat so the user sees 100% before the app appears.
          setTimeout(onComplete, 500)
        } else {
          setPhase("failed")
        }
      } catch (e) {
        setLog((l) => `${l}\n${typeof e === "string" ? e : String(e)}`)
        setPhase("failed")
      }
    })()
  }, [phase, total, onComplete])

  const copyLog = async () => {
    try {
      await navigator.clipboard.writeText(log)
      toast.success("Log copied to clipboard")
    } catch {
      toast.error("Couldn't copy the log")
    }
  }

  const downloadLog = () => {
    try {
      const blob = new Blob([log], { type: "text/plain" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = "thelab-update-log.txt"
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error("Couldn't download the log — try Copy instead")
    }
  }

  const onRestore = async () => {
    setRestoring(true)
    try {
      // Relaunches the previous version; this process exits, so we won't
      // return from here on success.
      await trackedInvoke("restore_previous_version")
    } catch (e) {
      setRestoring(false)
      toast.error(typeof e === "string" ? e : "Restore failed")
    }
  }

  const pct = Math.round((Math.min(done, total) / total) * 100)

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background p-6">
      <div className="w-full max-w-lg space-y-5">
        {phase === "running" ? (
          <>
            <div className="flex items-center gap-3">
              <CircleNotchIcon className="size-6 shrink-0 animate-spin text-primary" />
              <div>
                <div className="font-heading text-xl font-semibold">
                  Updating The Lab…
                </div>
                <p className="text-sm text-muted-foreground">
                  Bringing your saved data up to date. This only happens once
                  per update — please don't close the app.
                </p>
              </div>
            </div>
            <Progress value={pct} />
            <pre className="max-h-64 overflow-y-auto rounded-md border border-border bg-muted/30 p-3 text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground">
              {log || "Starting…"}
            </pre>
          </>
        ) : (
          <>
            <div className="flex items-center gap-3">
              <WarningCircleIcon
                className="size-6 shrink-0 text-rose-500"
                weight="fill"
              />
              <div>
                <div className="font-heading text-xl font-semibold">
                  Update failed
                </div>
                <p className="text-sm text-muted-foreground">
                  The Lab saved your previous version. You can restore it now
                  and try the update again later.
                </p>
              </div>
            </div>

            <pre className="max-h-56 overflow-y-auto rounded-md border border-rose-500/30 bg-rose-500/5 p-3 text-xs leading-relaxed whitespace-pre-wrap text-rose-700 dark:text-rose-300">
              {log || "No details were captured."}
            </pre>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void copyLog()}
                className="gap-1.5"
              >
                <CopySimpleIcon className="size-4" />
                Copy log
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={downloadLog}
                className="gap-1.5"
              >
                <DownloadSimpleIcon className="size-4" />
                Download log
              </Button>
              <div className="flex-1" />
              <Button
                onClick={() => void onRestore()}
                disabled={!initial.canRestore || restoring}
                className="gap-1.5"
                title={
                  initial.canRestore
                    ? "Roll back to the previous version"
                    : "No saved previous version to restore (this build wasn't installed via an update)"
                }
              >
                {restoring ? (
                  <CircleNotchIcon className="size-4 animate-spin" />
                ) : (
                  <ArrowCounterClockwiseIcon className="size-4" />
                )}
                Restore previous version
              </Button>
            </div>
            {!initial.canRestore && (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <CheckCircleIcon className="size-3.5" />
                No previous version is saved for this build — reinstall the last
                release manually if you need to roll back.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  )
}
