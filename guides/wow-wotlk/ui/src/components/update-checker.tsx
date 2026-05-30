import * as React from "react"
import { check, type Update } from "@tauri-apps/plugin-updater"
import { relaunch } from "@tauri-apps/plugin-process"
import { getVersion } from "@tauri-apps/api/app"
import {
  ArrowClockwiseIcon,
  CheckCircleIcon,
  DownloadSimpleIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Progress } from "@/components/ui/progress"
import { LottieLoop } from "@/components/lottie-loop"
import { isTauri, trackedInvoke } from "@/lib/tauri"
import loadingAnimation from "@/assets/lottie/loadingV4.json"

/**
 * "Check for updates" control. Click → v4 spinner while it checks; if the
 * app is current, it flashes a green checkmark, then resets. If an update
 * exists, a small dialog asks to confirm ("Found update: X → Y") and, on
 * OK, downloads + installs (with progress) and relaunches into the new
 * version. Backed by tauri-plugin-updater (signed) + tauri-plugin-process.
 */
type Phase = "idle" | "checking" | "uptodate" | "error"
type DownloadPhase = "prompt" | "downloading" | "installing"

export function UpdateChecker() {
  const [phase, setPhase] = React.useState<Phase>("idle")
  const [error, setError] = React.useState<string | null>(null)
  const [update, setUpdate] = React.useState<Update | null>(null)
  const [dl, setDl] = React.useState<DownloadPhase>("prompt")
  const [pct, setPct] = React.useState(0)
  const [currentVersion, setCurrentVersion] = React.useState("")

  React.useEffect(() => {
    if (!isTauri()) return
    void getVersion()
      .then(setCurrentVersion)
      .catch(() => {})
  }, [])

  const onCheck = React.useCallback(async () => {
    if (!isTauri()) return
    setError(null)
    setPhase("checking")
    try {
      const found = await check()
      if (!found) {
        setPhase("uptodate")
        window.setTimeout(() => setPhase("idle"), 1800)
        return
      }
      setDl("prompt")
      setPct(0)
      setUpdate(found) // opens the dialog
      setPhase("idle")
    } catch (e) {
      setError(errMsg(e))
      setPhase("error")
      window.setTimeout(() => setPhase("idle"), 5000)
    }
  }, [])

  const onInstall = React.useCallback(async () => {
    if (!update) return
    setDl("downloading")
    setPct(0)
    try {
      // Stash a copy of the current AppImage before the updater overwrites
      // it, so the new binary can roll back to it if its data migrations
      // fail. Best-effort: a no-op outside an AppImage, never blocks update.
      try {
        await trackedInvoke("backup_current_binary")
      } catch (e) {
        console.warn("backup_current_binary failed (continuing):", e)
      }
      let total = 0
      let got = 0
      await update.downloadAndInstall((ev) => {
        switch (ev.event) {
          case "Started":
            total = ev.data.contentLength ?? 0
            break
          case "Progress":
            got += ev.data.chunkLength
            if (total > 0) setPct(Math.min(100, Math.round((got / total) * 100)))
            break
          case "Finished":
            setPct(100)
            break
        }
      })
      setDl("installing")
      await relaunch()
    } catch (e) {
      setError(errMsg(e))
      setUpdate(null)
      setPhase("error")
      window.setTimeout(() => setPhase("idle"), 5000)
    }
  }, [update])

  // Don't allow dismissing mid-install.
  const closeDialog = () => {
    if (dl === "prompt") setUpdate(null)
  }

  if (!isTauri()) {
    return (
      <p className="text-xs text-muted-foreground">
        Updates are available when running the desktop app.
      </p>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        variant="outline"
        size="sm"
        onClick={() => void onCheck()}
        disabled={phase === "checking"}
        className="gap-2"
      >
        {phase === "checking" ? (
          <>
            <LottieLoop animationData={loadingAnimation} className="size-4" />
            Checking…
          </>
        ) : phase === "uptodate" ? (
          <>
            <CheckCircleIcon weight="fill" className="size-4 text-emerald-500" />
            Up to date
          </>
        ) : (
          <>
            <ArrowClockwiseIcon className="size-4" />
            Check for updates
          </>
        )}
      </Button>

      {currentVersion && (
        <span className="font-mono text-xs text-muted-foreground">
          v{currentVersion}
        </span>
      )}

      {phase === "error" && error && (
        <span className="inline-flex items-center gap-1 text-xs text-rose-500">
          <WarningCircleIcon className="size-3.5 shrink-0" />
          {error}
        </span>
      )}

      <Dialog
        open={update !== null}
        onOpenChange={(open) => {
          if (!open) closeDialog()
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Update available</DialogTitle>
            <DialogDescription>
              Found update:{" "}
              <span className="font-mono text-foreground">
                {update?.currentVersion ?? currentVersion} → {update?.version}
              </span>
              . Download and install update?
            </DialogDescription>
          </DialogHeader>

          {dl !== "prompt" && (
            <div className="space-y-1.5">
              <Progress value={pct} />
              <div className="text-xs text-muted-foreground">
                {dl === "downloading"
                  ? `Downloading… ${pct}%`
                  : "Installing — the app will restart."}
              </div>
            </div>
          )}

          <DialogFooter>
            {dl === "prompt" ? (
              <>
                <Button variant="outline" onClick={closeDialog}>
                  Cancel
                </Button>
                <Button onClick={() => void onInstall()} className="gap-2">
                  <DownloadSimpleIcon className="size-4" />
                  OK
                </Button>
              </>
            ) : (
              <Button disabled className="gap-2">
                <LottieLoop animationData={loadingAnimation} className="size-4" />
                {dl === "downloading" ? "Downloading…" : "Installing…"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function errMsg(e: unknown): string {
  const s =
    typeof e === "string" ? e : e instanceof Error ? e.message : String(e)
  return s.length > 120 ? s.slice(0, 117) + "…" : s
}
