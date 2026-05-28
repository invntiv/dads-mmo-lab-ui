import * as React from "react"
import { CheckCircleIcon, SteamLogoIcon } from "@phosphor-icons/react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { useServerState } from "@/components/server-state-context"

/**
 * Post-uninstall success dialog. Renders at the App root so it survives
 * the route change that fires when `installs` empties — the user is
 * yanked from Settings to WelcomeScreen by App.tsx the moment
 * `installed` flips to false, which would otherwise hide the inline
 * success card that previously lived in `uninstall-section.tsx`.
 *
 * Trigger: `uninstallStatus` transitioning from "running" → "succeeded".
 * Dismiss: clicking Done (or Escape / overlay click) calls
 * `resetUninstall()`, returning status to "idle".
 *
 * Failure cases are NOT handled here — they stay inline in the section
 * so the user can read the console log without losing the page.
 */
export function UninstallSuccessDialog() {
  const { uninstallStatus, resetUninstall } = useServerState()
  const [open, setOpen] = React.useState(false)

  // Open once when status transitions to succeeded. We don't react to
  // every render; the effect only re-fires when the status string
  // changes, so navigating around won't re-open the dialog after dismiss.
  React.useEffect(() => {
    if (uninstallStatus === "succeeded") {
      setOpen(true)
    }
  }, [uninstallStatus])

  const handleClose = () => {
    setOpen(false)
    // Reset the uninstall lifecycle so the section is fresh next time
    // and so the success-status flag doesn't keep retriggering on
    // subsequent renders.
    resetUninstall()
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) handleClose()
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <CheckCircleIcon className="size-5 text-emerald-600 dark:text-emerald-400" />
            Uninstall complete
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3 text-sm">
              <p>
                Your server is gone. The Lab is back to its pre-install state,
                ready for a fresh install whenever you are.
              </p>
              <div className="rounded-md border border-sky-500/40 bg-sky-500/5 p-3 text-xs text-sky-900 dark:text-sky-200">
                <div className="mb-1.5 flex items-center gap-2 font-semibold">
                  <SteamLogoIcon className="size-4" />
                  One more cleanup step — in Steam
                </div>
                <p className="leading-snug">
                  Steam keeps shortcuts in memory while it's running, so we
                  can't safely edit your library from here. To finish a clean
                  uninstall:
                </p>
                <ol className="mt-1.5 list-decimal space-y-0.5 pl-5 leading-snug">
                  <li>
                    Open Steam, find your <strong>WoW 3.3.5a</strong> entry,
                    right-click → Manage → <em>Remove non-Steam game from your
                    library</em>.
                  </li>
                  <li>
                    If you are deleting <strong>The Lab</strong>, you may also
                    remove it from Steam this way.
                  </li>
                  <li>
                    Your WoW 3.3.5a client folder is still on disk — keep it
                    for next time, or delete it by hand when you're done with
                    WoW.
                  </li>
                </ol>
              </div>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction onClick={handleClose}>Done</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
