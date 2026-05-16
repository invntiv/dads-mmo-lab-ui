import * as React from "react"
import {
  ArrowClockwiseIcon,
  CheckCircleIcon,
  CheckIcon,
  ProhibitIcon,
  WarningCircleIcon,
  XCircleIcon,
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
import { InstallConsole } from "@/components/install-console"
import { LottieLoop } from "@/components/lottie-loop"
import { useServerState } from "@/components/server-state-context"
import { cn } from "@/lib/utils"
import successAnimation from "@/assets/lottie/Success.json"
import loadingAnimation from "@/assets/lottie/loadingV4.json"

export function InstallProgressScreen() {
  const {
    installStatus,
    installLog,
    installPending,
    installExitCode,
    cancelInstall,
    resetInstall,
  } = useServerState()
  const [confirmOpen, setConfirmOpen] = React.useState(false)

  // Reset the confirm dialog if the install ends while it's open.
  React.useEffect(() => {
    if (installStatus !== "running") setConfirmOpen(false)
  }, [installStatus])

  const isRunning = installStatus === "running"
  const isCancelling = installStatus === "cancelling"
  const isCleaning = installStatus === "cleaning"
  const isTerminal =
    installStatus === "failed" ||
    installStatus === "succeeded" ||
    installStatus === "cancelled"

  const cancelButtonLabel = isCleaning
    ? "Cleaning up…"
    : isCancelling
      ? "Cancelling…"
      : "Cancel install"

  return (
    // CSS grid: top header row + console row that takes all remaining
    // space + bottom button row. The middle row is `minmax(0, 1fr)` so
    // it can shrink — that's what gives the console a real bounded
    // height regardless of how much output streams in. The explicit
    // `h-[calc(100svh-var(--header-height))]` is what stops the page
    // from growing: the install screen never asks its parent for more
    // height than the viewport minus the site header.
    <div
      className="grid h-[calc(100svh-var(--header-height))] grid-rows-[auto_minmax(0,1fr)_auto] gap-4 p-6"
    >
      <header className="flex items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="font-heading text-2xl font-semibold leading-tight">
            Installing your server
          </h1>
          <p className="text-sm text-muted-foreground">
            Streaming output from <span className="font-mono">install-wow-ui.sh</span>.
            This takes a while — leave the window open.
          </p>
        </div>
        <StatusBadge status={installStatus} exitCode={installExitCode} />
      </header>

      <div className="relative min-h-0">
        <InstallConsole
          entries={installLog}
          pending={installPending}
          className="h-full min-h-0"
        />
        {installStatus === "succeeded" && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-md bg-zinc-950/70 backdrop-blur-sm">
            <LottieLoop
              animationData={successAnimation}
              delayBetweenLoopsMs={2000}
              className="size-56"
            />
          </div>
        )}
      </div>

      <div className="flex justify-end gap-2">
        {(isRunning || isCancelling || isCleaning) && (
          <Button
            variant="destructive"
            size="sm"
            disabled={isCancelling || isCleaning}
            onClick={() => setConfirmOpen(true)}
          >
            <ProhibitIcon className="size-4" />
            {cancelButtonLabel}
          </Button>
        )}
        {isTerminal &&
          (installStatus === "succeeded" ? (
            <Button
              size="sm"
              onClick={resetInstall}
              className="bg-[#5ea500] text-white hover:bg-[#5ea500]/90"
            >
              Complete!
              <CheckIcon className="size-4" />
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={resetInstall}>
              <ArrowClockwiseIcon className="size-4" />
              Back to welcome
            </Button>
          ))}
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Cancel the installation?</DialogTitle>
            <DialogDescription>
              The installer process and anything it spawned (git clone, docker
              build, etc.) will be stopped immediately. Any partially-downloaded
              files in <span className="font-mono">~/wow-server-*</span> will
              stay on disk and need to be removed before re-installing.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              variant="outline"
              onClick={() => setConfirmOpen(false)}
            >
              Keep installing
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setConfirmOpen(false)
                void cancelInstall()
              }}
            >
              Cancel install
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function StatusBadge({
  status,
  exitCode,
}: {
  status: ReturnType<typeof useServerState>["installStatus"]
  exitCode: number | null
}) {
  if (status === "running") {
    return (
      <span className="inline-flex items-center gap-2 rounded-full border border-border bg-muted/40 px-3 py-1 text-xs font-medium text-foreground">
        <LottieLoop animationData={loadingAnimation} className="size-4" />
        Running
      </span>
    )
  }
  if (status === "cancelling") {
    return (
      <span className="inline-flex items-center gap-2 rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-600 dark:text-amber-400">
        <LottieLoop animationData={loadingAnimation} className="size-4" />
        Cancelling…
      </span>
    )
  }
  if (status === "cleaning") {
    return (
      <span className="inline-flex items-center gap-2 rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-600 dark:text-amber-400">
        <LottieLoop animationData={loadingAnimation} className="size-4" />
        Cleaning up…
      </span>
    )
  }
  if (status === "succeeded") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
        <CheckCircleIcon className="size-3.5" />
        Done
      </span>
    )
  }
  if (status === "cancelled") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-500/40 bg-zinc-500/10 px-3 py-1 text-xs font-medium text-zinc-600 dark:text-zinc-300">
        <XCircleIcon className="size-3.5" />
        Cancelled
      </span>
    )
  }
  if (status === "failed") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium",
          "border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-400"
        )}
      >
        <WarningCircleIcon className="size-3.5" />
        Failed{exitCode != null ? ` (exit ${exitCode})` : ""}
      </span>
    )
  }
  return null
}
