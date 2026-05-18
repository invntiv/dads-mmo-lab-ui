import * as React from "react"
import {
  ArrowRightIcon,
  CheckCircleIcon,
  FolderOpenIcon,
  GearIcon,
  GlobeIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react"

import { Button } from "@/components/ui/button"
import { useServerState } from "@/components/server-state-context"
import { trackedInvoke, isTauri } from "@/lib/tauri"
import { cn } from "@/lib/utils"

/**
 * Three things this card does:
 *
 *  1. Lets the user pick their WoW 3.3.5a client install directory
 *     via the native Tauri directory picker. The path persists in
 *     `~/.config/dads-mmo-lab/settings.json` so we have it for future
 *     features (ConsolePortLK addon install, etc.).
 *
 *  2. Validates that the picked dir contains `Data/<locale>/realmlist.wtf`
 *     and reads the realmlist contents. If it's already pointing at
 *     `127.0.0.1`, the card collapses to a small "all good" line.
 *
 *  3. Periodically rechecks the realmlist file while the dashboard is
 *     visible. Some private-server WoW clients ship update scripts that
 *     forcibly overwrite realmlist.wtf — the poll catches that and
 *     re-surfaces the "Fix realmlist" affordance without the user
 *     having to refresh.
 *
 * Replaces the original RealmlistReminderCard, which was instruction-
 * only (no path knowledge, no auto-fix).
 */

type WowClientState = {
  directory: string | null
  locale: string | null
  realmlist_path: string | null
  realmlist_contents: string | null
  realmlist_correct: boolean
}

const POLL_INTERVAL_MS = 30_000

export function WowClientCard() {
  const { setActivePage } = useServerState()
  const [state, setState] = React.useState<WowClientState | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)

  const refresh = React.useCallback(async () => {
    if (!isTauri()) return
    try {
      const s = await trackedInvoke<WowClientState>("get_wow_client_state")
      setState(s)
    } catch (e) {
      // Soft-fail — the card just stays in its previous state. The
      // periodic poll will retry.
      console.warn("get_wow_client_state failed:", e)
    }
  }, [])

  // Initial load + polling. Polling only runs while this component is
  // mounted, so we're not wasting cycles when the user is on a
  // different page.
  React.useEffect(() => {
    void refresh()
    const handle = setInterval(refresh, POLL_INTERVAL_MS)
    return () => clearInterval(handle)
  }, [refresh])

  const handleFix = React.useCallback(async () => {
    setError(null)
    setBusy(true)
    try {
      const next = await trackedInvoke<WowClientState>("fix_realmlist")
      setState(next)
    } catch (e) {
      setError(typeof e === "string" ? e : String(e))
    } finally {
      setBusy(false)
    }
  }, [])

  const handleClear = React.useCallback(async () => {
    setError(null)
    setBusy(true)
    try {
      const next = await trackedInvoke<WowClientState>("clear_wow_directory")
      setState(next)
    } catch (e) {
      setError(typeof e === "string" ? e : String(e))
    } finally {
      setBusy(false)
    }
  }, [])

  // While the initial fetch is in flight, render nothing — avoids a
  // jarring "Select your WoW client" flash before settings load.
  if (state === null) return null

  // No directory chosen yet → big "select your client" CTA. The
  // browse dialog itself lives on the Settings page now (next to
  // Forget client), so this button routes there. Keeping the
  // dashboard notification because the dashboard is the natural
  // landing surface where the user notices "something's missing."
  if (!state.directory) {
    return (
      <CardShell tone="amber">
        <FolderOpenIcon className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-400" />
        <div className="flex-1 space-y-1.5">
          <div className="font-medium leading-tight">
            Connect your WoW client
          </div>
          <p className="text-xs text-amber-700/90 dark:text-amber-300/90">
            Point us at your WoW 3.3.5a install folder so we can set the
            realmlist for you. We'll also use this later to manage
            client-side things like the ConsolePortLK addon for
            controller support.
          </p>
          {error && <ErrorRow message={error} />}
        </div>
        <Button
          size="sm"
          onClick={() => setActivePage("settings")}
          disabled={busy}
          className="shrink-0 gap-1.5"
        >
          <GearIcon className="size-4" />
          Open Settings
          <ArrowRightIcon className="size-4" />
        </Button>
      </CardShell>
    )
  }

  // Directory set but realmlist points somewhere else → "fix it" CTA
  if (!state.realmlist_correct) {
    return (
      <CardShell tone="rose">
        <WarningCircleIcon className="mt-0.5 size-5 shrink-0 text-rose-600 dark:text-rose-400" />
        <div className="flex-1 space-y-1.5">
          <div className="font-medium leading-tight">
            Realmlist needs fixing
          </div>
          <p className="text-xs text-rose-700/90 dark:text-rose-300/90">
            Your client's <span className="font-mono">realmlist.wtf</span> isn't
            pointing at the local server. WoW will try to reach the
            official servers instead. Hit "Fix realmlist" and we'll
            rewrite it for you.
          </p>
          <div className="space-y-1 text-xs text-rose-700/80 dark:text-rose-300/80">
            <DetailRow label="Client" value={state.directory} />
            <DetailRow label="Realmlist file" value={state.realmlist_path} />
            <DetailRow
              label="Current contents"
              value={trimmedRealmlist(state.realmlist_contents)}
              mono
            />
          </div>
          {error && <ErrorRow message={error} />}
        </div>
        <div className="flex shrink-0 flex-col gap-2">
          <Button size="sm" onClick={handleFix} disabled={busy}>
            {busy ? "Fixing…" : "Fix realmlist"}
          </Button>
          <button
            type="button"
            onClick={handleClear}
            disabled={busy}
            className="text-xs text-rose-600/80 hover:text-rose-700 dark:text-rose-400/80 disabled:opacity-50"
          >
            Forget client
          </button>
        </div>
      </CardShell>
    )
  }

  // Directory set + realmlist correct → small confirmation strip.
  // Intentionally NOT dismissable — earlier versions had an X here that
  // routed to handleClear (= forget client), which read as "dismiss
  // notification" and silently disconnected. Disconnect now lives in
  // Settings → WoW client.
  return (
    <CardShell tone="emerald">
      <CheckCircleIcon className="mt-0.5 size-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
      <div className="flex-1 space-y-1">
        <div className="text-sm font-medium leading-tight">
          WoW client connected — realmlist points at <span className="font-mono">127.0.0.1</span>
        </div>
        <div className="text-xs text-emerald-700/80 dark:text-emerald-300/80">
          <span className="font-mono">{state.directory}</span>
          {state.locale && (
            <span className="text-emerald-600/70 dark:text-emerald-400/70">
              {" "}
              · locale {state.locale}
            </span>
          )}
        </div>
      </div>
    </CardShell>
  )
}

// ── Helpers ──────────────────────────────────────────────────────────

function CardShell({
  tone,
  children,
}: {
  tone: "amber" | "rose" | "emerald"
  children: React.ReactNode
}) {
  const ring =
    tone === "amber"
      ? "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-200"
      : tone === "rose"
        ? "border-rose-500/40 bg-rose-500/10 text-rose-800 dark:text-rose-200"
        : "border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200"
  return (
    <div className={cn("rounded-md border p-4", ring)}>
      <div className="flex items-start gap-3">{children}</div>
    </div>
  )
}

function DetailRow({
  label,
  value,
  mono,
}: {
  label: string
  value: string | null
  mono?: boolean
}) {
  if (!value) return null
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-rose-600/70 dark:text-rose-400/70">{label}:</span>
      <span className={cn("truncate", mono && "font-mono")}>{value}</span>
    </div>
  )
}

function ErrorRow({ message }: { message: string }) {
  return (
    <div className="mt-1 inline-flex items-center gap-1.5 rounded-md border border-rose-500/40 bg-rose-500/10 px-2.5 py-1 text-xs text-rose-700 dark:text-rose-300">
      <GlobeIcon className="size-3.5" />
      {message}
    </div>
  )
}

/** Realmlist.wtf is typically a single short line, but might have
 * extras (patchlist, portal). Trim + collapse whitespace to keep the
 * detail row scannable. */
function trimmedRealmlist(contents: string | null): string | null {
  if (!contents) return null
  const lines = contents
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
  if (lines.length === 0) return "(empty file)"
  if (lines.length === 1) return lines[0]
  return `${lines[0]}  (+${lines.length - 1} more)`
}
