import * as React from "react"
import {
  ArrowRightIcon,
  CheckCircleIcon,
  PlugsConnectedIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react"

import { Button } from "@/components/ui/button"
import {
  type MigrationReport,
  useServerState,
} from "@/components/server-state-context"
import { MigrationWizard } from "@/components/migration-wizard"

/**
 * Shown when an install dir + containers exist on disk but `install.json`
 * is missing. `analyze_install` inspects what's actually there and tells us
 * which of four situations we're in:
 *
 *  - **migrate** — a hand-built playerbots server missing Lab bits (SOAP,
 *    Eluna, AHBot). Opens the MigrationWizard to add them + recompile.
 *  - **adopt** — already at full parity, just missing the marker, and the
 *    server is up. Write the marker, no rebuild.
 *  - **resume** — a Lab install that crashed after compile but before the
 *    account bootstrap. "Finish setup" re-runs the script in resume mode.
 *  - **fresh_install_required** — a base/NPCBots/prebuilt stack with nothing
 *    to compile SOAP + Eluna into. The user needs a fresh Playerbots install.
 *
 * Until the analysis returns (or if it fails) we fall back to the old
 * worldserver-running heuristic so the banner never disappears silently.
 */
export function InstallResumeBanner() {
  const {
    installed,
    installComplete,
    installs,
    installStatus,
    worldserverStatus,
    startInstall,
    adoptInstall,
    analyzeInstall,
    openInstall,
  } = useServerState()
  const [adopting, setAdopting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [report, setReport] = React.useState<MigrationReport | null>(null)
  const [wizardOpen, setWizardOpen] = React.useState(false)

  const partial = installs.find((i) => !i.complete) ?? installs[0]
  const partialPath = !installComplete && partial ? partial.path : null

  React.useEffect(() => {
    let cancelled = false
    if (!partialPath) {
      setReport(null)
      return
    }
    void analyzeInstall(partialPath)
      .then((r) => {
        if (!cancelled) setReport(r)
      })
      .catch(() => {
        if (!cancelled) setReport(null)
      })
    return () => {
      cancelled = true
    }
  }, [partialPath, analyzeInstall])

  // Don't double-render once a resume/migrate is already running — the
  // install console screen takes over the main pane in that case.
  if (!installed || installComplete || installStatus !== "idle") return null

  const variant =
    partial?.variant === "playerbots" ||
    partial?.variant === "npcbots" ||
    partial?.variant === "base"
      ? partial.variant
      : "playerbots"

  // Fall back to the legacy heuristic until analysis lands.
  const recommended =
    report?.recommended ?? (worldserverStatus === "running" ? "adopt" : "resume")

  if (recommended === "migrate") {
    return (
      <>
        <div className="rounded-md border border-sky-500/40 bg-sky-500/10 p-4 text-sky-800 dark:text-sky-200">
          <div className="flex items-start gap-3">
            <PlugsConnectedIcon className="mt-0.5 size-5 shrink-0 text-sky-600 dark:text-sky-400" />
            <div className="flex-1 space-y-1.5">
              <div className="font-medium leading-tight">
                Connect your existing server
              </div>
              <p className="text-xs text-sky-700/90 dark:text-sky-300/90">
                We found a WoW server you set up outside The Lab. A quick
                upgrade adds remote control and the bot bridge so the app can
                manage it — your characters and data are left untouched.
              </p>
            </div>
            <Button
              size="sm"
              onClick={() => setWizardOpen(true)}
              className="shrink-0 gap-1.5"
            >
              Set up
              <ArrowRightIcon className="size-4" />
            </Button>
          </div>
        </div>
        <MigrationWizard
          open={wizardOpen}
          report={report}
          onOpenChange={setWizardOpen}
        />
      </>
    )
  }

  if (recommended === "fresh_install_required") {
    return (
      <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-4 text-amber-800 dark:text-amber-200">
        <div className="flex items-start gap-3">
          <WarningCircleIcon className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-400" />
          <div className="flex-1 space-y-1.5">
            <div className="font-medium leading-tight">
              This server can't be upgraded in place
            </div>
            <p className="text-xs text-amber-700/90 dark:text-amber-300/90">
              The Lab needs a Playerbots server built from source. The install
              we found can't have the bot features added to it, so you'll need a
              fresh Playerbots install to manage a server here.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={openInstall}
            className="shrink-0 gap-1.5"
          >
            Install Playerbots
            <ArrowRightIcon className="size-4" />
          </Button>
        </div>
      </div>
    )
  }

  if (recommended === "adopt") {
    const onAdopt = async () => {
      setError(null)
      setAdopting(true)
      try {
        await adoptInstall()
      } catch (e) {
        setError(typeof e === "string" ? e : String(e))
      } finally {
        setAdopting(false)
      }
    }
    return (
      <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-4 text-emerald-800 dark:text-emerald-200">
        <div className="flex items-start gap-3">
          <CheckCircleIcon className="mt-0.5 size-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <div className="flex-1 space-y-1.5">
            <div className="font-medium leading-tight">
              Existing server detected
            </div>
            <p className="text-xs text-emerald-700/90 dark:text-emerald-300/90">
              We found a running WoW server that's already set up for The Lab.
              Adopt it to manage it here — your accounts, characters, and
              settings are left exactly as they are.
            </p>
            {error && (
              <p className="text-xs text-rose-600 dark:text-rose-400">{error}</p>
            )}
          </div>
          <Button
            size="sm"
            onClick={() => void onAdopt()}
            disabled={adopting}
            className="shrink-0 gap-1.5"
          >
            {adopting ? "Adopting…" : "Use this server"}
            {!adopting && <ArrowRightIcon className="size-4" />}
          </Button>
        </div>
      </div>
    )
  }

  // recommended === "resume"
  const onResume = () => {
    void startInstall({
      // Resume always uses the existing install — no module choices,
      // no admin-cred prompts. variant comes from what's on disk.
      serverType: variant,
      adminUser: "admin",
      adminPass: "admin",
      resume: true,
    })
  }

  return (
    <div className="rounded-md border border-rose-500/40 bg-rose-500/10 p-4 text-rose-800 dark:text-rose-200">
      <div className="flex items-start gap-3">
        <WarningCircleIcon className="mt-0.5 size-5 shrink-0 text-rose-600 dark:text-rose-400" />
        <div className="flex-1 space-y-1.5">
          <div className="font-medium leading-tight">
            Your install didn't finish
          </div>
          <p className="text-xs text-rose-700/90 dark:text-rose-300/90">
            The server was installed but the post-install setup (admin
            account, Auction House Bot character, config) didn't complete —
            probably from a crash or interrupted session. You won't be able
            to log into WoW until this finishes.
          </p>
          <p className="text-xs text-rose-700/90 dark:text-rose-300/90">
            Click below to pick up where we left off. This skips the long
            clone/compile (already done) and just finishes the account setup
            — usually under a minute.
          </p>
        </div>
        <Button size="sm" onClick={onResume} className="shrink-0 gap-1.5">
          Finish setup
          <ArrowRightIcon className="size-4" />
        </Button>
      </div>
    </div>
  )
}
