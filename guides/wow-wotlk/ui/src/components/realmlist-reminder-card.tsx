import * as React from "react"
import { GlobeIcon, XIcon } from "@phosphor-icons/react"

const SEEN_KEY = "dml:realmlistSeen"

/**
 * Dashboard banner reminding the user to point their WoW client at the
 * local server. We can't do this for them — `realmlist.wtf` lives in
 * the user's WoW client install directory, which we have no way to find
 * (it's wherever they extracted the 3.3.5a client). Dismissal persists
 * in localStorage so it doesn't pester on every dashboard visit.
 *
 * Mirrors the realmlist step that the original `install-wow.sh`'s
 * `show_completion` printed to the terminal — we just made it a UI
 * element so the user doesn't have to scroll through the install log
 * to find it.
 */
export function RealmlistReminderCard() {
  const [dismissed, setDismissed] = React.useState(() => {
    try {
      return window.localStorage.getItem(SEEN_KEY) === "1"
    } catch {
      return false
    }
  })

  if (dismissed) return null

  const dismiss = () => {
    try {
      window.localStorage.setItem(SEEN_KEY, "1")
    } catch {
      // localStorage unavailable (private mode); we just won't persist.
    }
    setDismissed(true)
  }

  return (
    <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-4 text-amber-800 dark:text-amber-200">
      <div className="flex items-start gap-3">
        <GlobeIcon className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-400" />
        <div className="flex-1 space-y-1.5">
          <div className="font-medium leading-tight">
            One last step: point your WoW client at this server
          </div>
          <p className="text-xs text-amber-700/90 dark:text-amber-300/90">
            Open your WoW 3.3.5a install folder and find{" "}
            <span className="font-mono text-foreground/90">realmlist.wtf</span>{" "}
            inside <span className="font-mono text-foreground/90">Data/&lt;locale&gt;/</span>{" "}
            (e.g. <span className="font-mono text-foreground/90">Data/enUS/</span>).
            Replace its contents with exactly:
          </p>
          <pre className="ml-0 rounded border border-amber-500/30 bg-amber-500/5 px-2.5 py-1.5 font-mono text-xs text-amber-900 dark:text-amber-100">
            set realmlist 127.0.0.1
          </pre>
          <p className="text-xs text-amber-700/90 dark:text-amber-300/90">
            Without this, your WoW client will try to reach the official
            servers instead of your local one. Log in with{" "}
            <span className="font-mono text-foreground/90">admin</span> /{" "}
            <span className="font-mono text-foreground/90">admin</span> (or
            the credentials you set during install).
          </p>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className="text-amber-700/70 transition-colors hover:text-amber-800 dark:text-amber-300/70 dark:hover:text-amber-200"
        >
          <XIcon className="size-4" />
        </button>
      </div>
    </div>
  )
}
