import {
  ArrowClockwiseIcon,
  CheckCircleIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react"

import { Button } from "@/components/ui/button"
import { InstallConsole } from "@/components/install-console"
import { LottieLoop } from "@/components/lottie-loop"
import { useServerState } from "@/components/server-state-context"
import { cn } from "@/lib/utils"
import loadingAnimation from "@/assets/lottie/loadingV4.json"

export function ServerControlScreen() {
  const {
    serverActionStatus,
    serverActionKind,
    serverActionLog,
    serverActionPending,
    resetServerAction,
  } = useServerState()

  const verb = serverActionKind === "stop" ? "Stop" : "Start"
  const verbingNoun =
    serverActionKind === "stop" ? "Stopping the server" : "Starting the server"
  const isRunning = serverActionStatus === "running"
  const isTerminal =
    serverActionStatus === "succeeded" || serverActionStatus === "failed"

  return (
    <div className="grid h-[calc(100svh-var(--header-height))] grid-rows-[auto_minmax(0,1fr)_auto] gap-4 p-6">
      <header className="flex items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="font-heading text-2xl font-semibold leading-tight">
            {verbingNoun}
          </h1>
          <p className="text-sm text-muted-foreground">
            Streaming output from{" "}
            <span className="font-mono">docker compose</span>. First start
            after install can take a minute or two for the worldserver to
            initialise.
          </p>
        </div>
        <ServerActionBadge status={serverActionStatus} verb={verb} />
      </header>

      <InstallConsole
        entries={serverActionLog}
        pending={serverActionPending}
        className="h-full min-h-0"
      />

      <div className="flex justify-end gap-2">
        {isTerminal && (
          <Button
            variant="outline"
            size="sm"
            onClick={resetServerAction}
            className={
              serverActionStatus === "succeeded"
                ? "border-emerald-500/40 text-emerald-600 hover:bg-emerald-500/10 hover:text-emerald-700 dark:text-emerald-400"
                : undefined
            }
          >
            <ArrowClockwiseIcon className="size-4" />
            Back to dashboard
          </Button>
        )}
        {isRunning && (
          <span className="text-xs text-muted-foreground">
            This usually takes a few seconds…
          </span>
        )}
      </div>
    </div>
  )
}

function ServerActionBadge({
  status,
  verb,
}: {
  status: ReturnType<typeof useServerState>["serverActionStatus"]
  verb: string
}) {
  if (status === "running") {
    return (
      <span className="inline-flex items-center gap-2 rounded-full border border-border bg-muted/40 px-3 py-1 text-xs font-medium text-foreground">
        <LottieLoop animationData={loadingAnimation} className="size-4" />
        {verb}ing…
      </span>
    )
  }
  if (status === "succeeded") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
        <CheckCircleIcon className="size-3.5" />
        {verb} succeeded
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
        {verb} failed
      </span>
    )
  }
  return null
}
