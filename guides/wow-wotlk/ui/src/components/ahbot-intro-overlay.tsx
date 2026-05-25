import * as React from "react"
import {
  ArrowRightIcon,
  PuzzlePieceIcon,
  UserIcon,
  XIcon,
} from "@phosphor-icons/react"

import { Button } from "@/components/ui/button"
import { useServerState } from "@/components/server-state-context"

const SEEN_KEY = "dml:ahbotIntroSeen"

/**
 * One-time guidance overlay that fires the first time the dashboard
 * mounts while AH Bot is installed-but-inert. Explains *why* the user
 * needs to visit Modules and how the WoW-client-side step works.
 *
 * Dismissal persists in localStorage so it doesn't pester on every
 * dashboard visit. The sidebar's blinking dot is the persistent
 * reminder; this overlay is the introduction.
 */
export function AhBotIntroOverlay() {
  const { ahbotNeedsConfig, setActivePage } = useServerState()
  const [open, setOpen] = React.useState(false)

  // Decide on mount whether to show. The dependency on
  // `ahbotNeedsConfig` lets us also fire if it flips to true mid-session
  // (e.g. user just finished install and the modules refresh detected
  // the inert state).
  React.useEffect(() => {
    if (!ahbotNeedsConfig) {
      setOpen(false)
      return
    }
    try {
      if (window.localStorage.getItem(SEEN_KEY) === "1") return
    } catch {
      // localStorage can be unavailable (private mode, etc). If so we'll
      // just show the overlay each session — annoying but harmless.
    }
    setOpen(true)
  }, [ahbotNeedsConfig])

  const dismiss = () => {
    try {
      window.localStorage.setItem(SEEN_KEY, "1")
    } catch {
      // ignore
    }
    setOpen(false)
  }

  const goToModules = () => {
    // Modules is now a section inside Settings (no standalone nav
    // item). Landing the user on Settings puts the AH Bot needs-config
    // alert + accordion right where they expect it.
    setActivePage("settings")
    dismiss()
  }

  if (!open) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="ahbot-intro-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-6 backdrop-blur-sm animate-in fade-in-0 duration-200"
    >
      <div className="relative w-full max-w-lg rounded-xl border border-border bg-card p-6 shadow-2xl animate-in zoom-in-95 fade-in-0 duration-200">
        <button
          type="button"
          aria-label="Dismiss"
          onClick={dismiss}
          className="absolute top-3 right-3 text-muted-foreground transition-colors hover:text-foreground"
        >
          <XIcon className="size-4" />
        </button>

        <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-amber-500/15">
          <UserIcon className="size-6 text-amber-600 dark:text-amber-400" />
        </div>

        <h2
          id="ahbot-intro-title"
          className="font-heading text-xl font-semibold leading-tight"
        >
          Visit the Modules page to configure AH Bot!
        </h2>

        <p className="mt-2 text-sm text-muted-foreground">
          Your Auction House Bot module is installed but inactive. It
          needs a real character in the game to act as its seller — that
          character has to be created from the WoW client.
        </p>

        <div className="mt-4 rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
          <div className="mb-1 font-medium text-foreground">
            Here's how it works:
          </div>
          <ol className="ml-4 list-decimal space-y-1">
            <li>
              Open your WoW 3.3.5a client and log in (default account is{" "}
              <span className="font-mono text-foreground">admin</span> /{" "}
              <span className="font-mono text-foreground">admin</span>).
            </li>
            <li>
              Create a new character (any race/class) — they'll be the
              bot's seller persona. Name them anything you like.
            </li>
            <li>Log out of WoW completely.</li>
            <li>
              Come back to this app, open Modules, and the wizard will
              find your new character automatically.
            </li>
          </ol>
        </div>

        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
          <button
            type="button"
            onClick={dismiss}
            className="text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            Dismiss for now
          </button>
          <Button onClick={goToModules} className="gap-1.5">
            <PuzzlePieceIcon className="size-4" />
            Open Modules page
            <ArrowRightIcon className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}
