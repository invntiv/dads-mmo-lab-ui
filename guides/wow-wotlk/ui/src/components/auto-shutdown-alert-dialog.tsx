import * as React from "react"
import { listen } from "@tauri-apps/api/event"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { isTauri } from "@/lib/tauri"

type ServerDonePayload = {
  action: "start" | "stop" | "restart"
  success: boolean
  code: number | null
  message: string | null
}

/**
 * Listens for the `server:auto-shutdown-fired` event emitted by the
 * WoW-client watcher, then waits for the FOLLOWING `server:done` to
 * confirm the stop actually succeeded before surfacing the AlertDialog.
 *
 * Why the two-event handshake: the watcher emits "fired" immediately
 * after calling stop_server, but stop_server returns as soon as the
 * docker process is spawned — the actual shutdown is in flight. If we
 * opened the dialog on "fired" alone (the original implementation),
 * the user saw "Server stopped" on top of a still-streaming console.
 * Now the dialog only appears after the docker compose down actually
 * finishes successfully.
 *
 * If the stop FAILS, no dialog — the user already sees the error in
 * the console screen, no point doubling up.
 */
export function AutoShutdownAlertDialog() {
  const [open, setOpen] = React.useState(false)
  // True between "fired" and the next "done". Tracked in a ref so the
  // server:done listener can read the latest value without being
  // re-created when it changes.
  const pendingRef = React.useRef(false)

  React.useEffect(() => {
    if (!isTauri()) return
    const firedPromise = listen("server:auto-shutdown-fired", () => {
      pendingRef.current = true
    })
    const donePromise = listen<ServerDonePayload>("server:done", (e) => {
      if (!pendingRef.current) return
      pendingRef.current = false
      // Only surface the explainer on a successful stop. A failed stop
      // already shows its own error in the console screen.
      if (e.payload.action === "stop" && e.payload.success) {
        setOpen(true)
      }
    })
    return () => {
      void firedPromise.then((unlisten) => unlisten()).catch(() => {})
      void donePromise.then((unlisten) => unlisten()).catch(() => {})
    }
  }, [])

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Server stopped automatically</AlertDialogTitle>
          <AlertDialogDescription>
            The WoW client closed, so the auto-shutdown watcher stopped the
            server. Click Start in the sidebar to bring it back up, or
            disable auto-shutdown if you'd rather the server stay running
            after you exit the game.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction onClick={() => setOpen(false)}>
            Got it
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
