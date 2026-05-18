import * as React from "react"
import { ArrowRightIcon, WarningCircleIcon } from "@phosphor-icons/react"

import { Button } from "@/components/ui/button"
import { useServerState } from "@/components/server-state-context"

/**
 * Fires when an install dir + containers exist on disk but
 * `install.json` is missing — i.e. the install script got past
 * clone/compile but crashed before the post-server-ready bootstrap
 * step could finish (admin + AHBOT accounts, mod_ahbot.conf rewrite).
 *
 * The "Finish setup" button re-runs the install script in resume mode
 * (`DML_RESUME=1`) which skips the expensive clone/compile work and
 * only does wait_for_server + bootstrap + write_metadata. The user
 * sees the install console takeover during the resume run, same as
 * a fresh install.
 *
 * Defaults to admin/admin for the GM credentials — the wizard data
 * from the original install attempt is gone after a crash, so unless
 * we want to re-prompt for it (kicking the user back to the wizard
 * mid-recovery) defaults are the friction-free path. Users with
 * custom creds can change them later from the Modules page.
 */
export function InstallResumeBanner() {
  const {
    installed,
    installComplete,
    installs,
    installStatus,
    startInstall,
  } = useServerState()

  // Don't double-render once a resume is already running — the install
  // console screen takes over the main pane in that case.
  if (!installed || installComplete || installStatus !== "idle") return null

  const variant = installs[0]?.variant ?? "playerbots"

  const onClick = () => {
    void startInstall({
      // Resume always uses the existing install — no module choices,
      // no admin-cred prompts. variant comes from what's on disk.
      serverType:
        variant === "playerbots" || variant === "npcbots" || variant === "base"
          ? variant
          : "playerbots",
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
            The server was installed and the worldserver is running, but
            the post-install setup (admin account, Auction House Bot
            character, config) didn't complete — probably from a crash
            or interrupted session. You won't be able to log into WoW
            until this finishes.
          </p>
          <p className="text-xs text-rose-700/90 dark:text-rose-300/90">
            Click below to pick up where we left off. This skips the
            long clone/compile (already done) and just finishes the
            account setup — usually under a minute.
          </p>
        </div>
        <Button size="sm" onClick={onClick} className="shrink-0 gap-1.5">
          Finish setup
          <ArrowRightIcon className="size-4" />
        </Button>
      </div>
    </div>
  )
}
