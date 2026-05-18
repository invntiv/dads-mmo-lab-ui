import * as React from "react"
import {
  ArrowClockwiseIcon,
  CheckCircleIcon,
  DownloadSimpleIcon,
  FolderOpenIcon,
  ImageIcon,
  MagicWandIcon,
  PlugsIcon,
  ScrollIcon,
  SparkleIcon,
  TrashIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react"
import { listen } from "@tauri-apps/api/event"
import { open as openDialog } from "@tauri-apps/plugin-dialog"

import { Button } from "@/components/ui/button"
import { trackedInvoke, isTauri } from "@/lib/tauri"
import { cn } from "@/lib/utils"

type ExtractProgress = {
  kind: "icons" | "tooltips"
  phase: string
  detail: string | null
}

type WowClientState = {
  directory: string | null
  locale: string | null
  realmlist_path: string | null
  realmlist_contents: string | null
  realmlist_correct: boolean
}

/**
 * Settings page. v1 scope is just the data-enrichment section: the
 * one-time imports we extract from the user's WoW client MPQs to make
 * the Inventory / Spell / Tooltip surfaces feel like Wowhead.
 *
 *  - Icon import (working) — pulls displayid→icon-name from
 *    ItemDisplayInfo.dbc and caches it locally.
 *  - Full tooltips, spells (stubs) — wired into the UI as disabled
 *    buttons so the structure is in place when the extractors land.
 *  - "Import everything" — convenience runner that chains the above
 *    once they're all implemented.
 *
 * The page is intentionally one column / scroll-y. Future surfaces
 * (general preferences, paths, debug toggles) can land below the
 * enrichment block under their own headings.
 */

type IconCacheStatus =
  | { status: "no_client" }
  | { status: "not_extracted"; client_dir: string }
  | {
      status: "ready"
      count: number
      extracted_at: string
      source_dir: string
      stale: boolean
    }

type TooltipCacheStatus =
  | { status: "no_client" }
  | { status: "not_extracted"; client_dir: string }
  | {
      status: "ready"
      spell_count: number
      set_count: number
      extracted_at: string
      source_dir: string
      stale: boolean
    }

export function SettingsScreen() {
  const [iconStatus, setIconStatus] = React.useState<IconCacheStatus | null>(
    null
  )
  const [tooltipStatus, setTooltipStatus] =
    React.useState<TooltipCacheStatus | null>(null)
  const [clientState, setClientState] = React.useState<WowClientState | null>(
    null
  )
  const [busy, setBusy] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  // Latest phase-progress event per extractor kind, surfaced next to
  // the busy spinner. Cleared when the extract completes.
  const [progress, setProgress] = React.useState<
    Partial<Record<"icons" | "tooltips", { phase: string; detail: string | null }>>
  >({})

  const refreshStatuses = React.useCallback(async () => {
    if (!isTauri()) return
    // Run in parallel — all three calls hit local files and are
    // independent. No need to await sequentially.
    const [iconRes, tooltipRes, clientRes] = await Promise.allSettled([
      trackedInvoke<IconCacheStatus>("get_icon_cache_status"),
      trackedInvoke<TooltipCacheStatus>("get_tooltip_cache_status"),
      trackedInvoke<WowClientState>("get_wow_client_state"),
    ])
    if (iconRes.status === "fulfilled") setIconStatus(iconRes.value)
    else console.warn("get_icon_cache_status failed", iconRes.reason)
    if (tooltipRes.status === "fulfilled") setTooltipStatus(tooltipRes.value)
    else console.warn("get_tooltip_cache_status failed", tooltipRes.reason)
    if (clientRes.status === "fulfilled") setClientState(clientRes.value)
    else console.warn("get_wow_client_state failed", clientRes.reason)
  }, [])

  React.useEffect(() => {
    void refreshStatuses()
  }, [refreshStatuses])

  // Subscribe to `client_assets:progress` from Rust. Each event names
  // the extractor kind + current phase + optional detail (e.g. "27,234
  // spells found"). Uses the promise-thenable cleanup pattern (see
  // feedback-no-strictmode in memory) so HMR doesn't stack listeners.
  React.useEffect(() => {
    if (!isTauri()) return
    const unlistenPromise = listen<ExtractProgress>(
      "client_assets:progress",
      (e) => {
        setProgress((prev) => ({
          ...prev,
          [e.payload.kind]: {
            phase: e.payload.phase,
            detail: e.payload.detail,
          },
        }))
      }
    )
    return () => {
      void unlistenPromise.then((fn) => fn()).catch(() => {})
    }
  }, [])

  const noClient =
    iconStatus?.status === "no_client" || tooltipStatus?.status === "no_client"

  const clearProgress = (kind: "icons" | "tooltips") => {
    setProgress((prev) => {
      const { [kind]: _drop, ...rest } = prev
      return rest
    })
  }

  const runIconImport = async () => {
    setBusy("icons")
    setError(null)
    clearProgress("icons")
    try {
      await trackedInvoke("extract_item_icons")
      await refreshStatuses()
    } catch (e) {
      setError(typeof e === "string" ? e : String(e))
    } finally {
      setBusy(null)
      clearProgress("icons")
    }
  }

  const runTooltipImport = async () => {
    setBusy("tooltips")
    setError(null)
    clearProgress("tooltips")
    try {
      await trackedInvoke("extract_tooltip_data")
      await refreshStatuses()
    } catch (e) {
      setError(typeof e === "string" ? e : String(e))
    } finally {
      setBusy(null)
      clearProgress("tooltips")
    }
  }

  const runImportAll = async () => {
    setBusy("all")
    setError(null)
    clearProgress("icons")
    clearProgress("tooltips")
    try {
      // Sequential, not parallel: both extractors open the same MPQ
      // patch-chain and reading it concurrently from two open()s would
      // double the disk pressure for no real wall-clock win.
      await trackedInvoke("extract_item_icons")
      await trackedInvoke("extract_tooltip_data")
      await refreshStatuses()
    } catch (e) {
      setError(typeof e === "string" ? e : String(e))
    } finally {
      setBusy(null)
      clearProgress("icons")
      clearProgress("tooltips")
    }
  }

  const wipe = async (command: "wipe_icon_cache" | "wipe_tooltip_cache") => {
    setError(null)
    try {
      await trackedInvoke(command)
      await refreshStatuses()
    } catch (e) {
      setError(typeof e === "string" ? e : String(e))
    }
  }

  const browseForClient = async () => {
    setError(null)
    setBusy("browse-client")
    try {
      const picked = await openDialog({
        directory: true,
        multiple: false,
        title: "Select your WoW 3.3.5a install directory",
      })
      if (!picked || Array.isArray(picked)) {
        // User cancelled the native dialog — leave state untouched.
        return
      }
      await trackedInvoke<WowClientState>("set_wow_directory", {
        path: picked,
      })
      await refreshStatuses()
    } catch (e) {
      setError(typeof e === "string" ? e : String(e))
    } finally {
      setBusy(null)
    }
  }

  const forgetClient = async () => {
    setError(null)
    setBusy("forget-client")
    try {
      // Intentionally does NOT wipe the icon/tooltip caches. The
      // extracted DBC data is universal across 3.3.5a clients (the
      // game data doesn't vary by which copy of the install you use),
      // so disconnecting one client and pointing at another shouldn't
      // throw away minutes of extraction work. Cache wipe is its own
      // explicit action via the per-card trash buttons above.
      await trackedInvoke("clear_wow_directory")
      await refreshStatuses()
    } catch (e) {
      setError(typeof e === "string" ? e : String(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="grid h-[calc(100svh-var(--header-height))] grid-rows-[auto_minmax(0,1fr)] gap-4 p-6">
      <header className="space-y-1">
        <h1 className="font-heading text-2xl font-semibold leading-tight">
          Settings
        </h1>
        <p className="text-sm text-muted-foreground">
          One-time imports and preferences. Enrichments below pull from
          your WoW client's own files — nothing is scraped, and the
          downloaded data stays on this machine.
        </p>
      </header>

      <div className="min-h-0 space-y-6 overflow-y-auto pr-1 pb-3">
        <Section
          title="Data enrichment"
          subtitle="Pull metadata out of your WoW client so the Inventory, Teleport, and (eventually) Spellbook pages show real icons, tooltips, and descriptions instead of raw IDs."
        >
          {noClient && <NoClientCallout />}
          {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

          <div className="grid gap-3 lg:grid-cols-2">
            <EnrichmentCard
              icon={<ImageIcon className="size-5" />}
              title="Icons"
              speed="Fast"
              description="Item-icon names from ItemDisplayInfo.dbc. ~40k entries, finishes in seconds. The cheapest visual upgrade — flips Inventory tiles from #entry chits to real WoW icons."
              status={iconStatusLine(iconStatus)}
              busy={busy === "icons" || busy === "all"}
              progress={progress.icons}
              disabled={noClient || busy !== null}
              actionLabel={
                iconStatus?.status === "ready" ? "Re-extract" : "Extract icons"
              }
              onAction={runIconImport}
              onWipe={
                iconStatus?.status === "ready"
                  ? () => wipe("wipe_icon_cache")
                  : undefined
              }
            />
            <EnrichmentCard
              icon={<ScrollIcon className="size-5" />}
              title="Full item tooltips"
              speed="Medium"
              description="Spell descriptions (for Equip: / Use: lines) + set bonuses. Pulls Spell.dbc (~47MB), SpellIcon.dbc, and ItemSet.dbc — the inventory's tooltip-on-hover gets Wowhead-quality detail."
              status={tooltipStatusLine(tooltipStatus)}
              busy={busy === "tooltips" || busy === "all"}
              progress={progress.tooltips}
              disabled={noClient || busy !== null}
              actionLabel={
                tooltipStatus?.status === "ready"
                  ? "Re-extract"
                  : "Extract tooltips"
              }
              onAction={runTooltipImport}
              onWipe={
                tooltipStatus?.status === "ready"
                  ? () => wipe("wipe_tooltip_cache")
                  : undefined
              }
            />
            <EnrichmentCard
              icon={<SparkleIcon className="size-5" />}
              title="Spells"
              speed="Medium"
              description="Spell names, ranks, icons, and descriptions from Spell.dbc. Foundation for a future Spellbook page and richer Equip-line tooltips."
              status="Not yet implemented"
              busy={false}
              disabled
              actionLabel="Extract spells"
              onAction={() => {}}
            />
            <EnrichmentCard
              icon={<MagicWandIcon className="size-5" />}
              title="Import everything"
              speed="Longest, best experience"
              description="Runs every enrichment above end-to-end. Sit back, grab a coffee. Subsequent re-extracts can re-run individual items above."
              status="Chains the items above"
              busy={busy === "all"}
              disabled={noClient || busy !== null}
              actionLabel="Import everything"
              onAction={runImportAll}
              primary
            />
          </div>
        </Section>

        <Section
          title="WoW client"
          subtitle="Manage the connection to your local WoW 3.3.5a install. Connecting + setting the realmlist happen on the Dashboard via the WoW Client card; disconnecting (Forget) lives here so it can't be triggered by accident."
        >
          <ClientCard
            state={clientState}
            busyKind={
              busy === "forget-client"
                ? "forget"
                : busy === "browse-client"
                  ? "browse"
                  : null
            }
            disabled={busy !== null}
            onBrowse={browseForClient}
            onForget={forgetClient}
          />
        </Section>
      </div>
    </div>
  )
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children: React.ReactNode
}) {
  return (
    <section className="space-y-3">
      <div className="space-y-1">
        <h2 className="text-base font-semibold leading-tight">{title}</h2>
        {subtitle && (
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        )}
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  )
}

function EnrichmentCard({
  icon,
  title,
  speed,
  description,
  status,
  busy,
  progress,
  disabled,
  actionLabel,
  onAction,
  onWipe,
  primary,
}: {
  icon: React.ReactNode
  title: string
  speed: string
  description: string
  status: string
  busy: boolean
  /** Live phase update emitted from Rust during extraction. When set
   * and `busy` is true, shown next to the spinner so the user knows
   * which DBC we're chewing on. */
  progress?: { phase: string; detail: string | null }
  disabled: boolean
  actionLabel: string
  onAction: () => void
  /** Optional — only present when there's something cached to wipe. */
  onWipe?: () => void
  primary?: boolean
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-md border p-4",
        primary
          ? "border-primary/40 bg-primary/5"
          : "border-border bg-card"
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "mt-0.5 shrink-0 rounded p-1.5",
            primary
              ? "bg-primary/15 text-primary"
              : "bg-muted text-muted-foreground"
          )}
        >
          {icon}
        </div>
        <div className="flex-1 space-y-0.5">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold leading-tight">
              {title}
            </span>
            <span className="rounded-full bg-muted px-1.5 py-0 text-[10px] text-muted-foreground">
              {speed}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
      </div>
      {busy && progress && (
        <div className="flex items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-primary">
          <ArrowClockwiseIcon className="size-3.5 animate-spin" />
          <div className="flex-1 truncate">
            <span className="font-medium">{progress.phase}</span>
            {progress.detail && (
              <span className="text-primary/70"> · {progress.detail}</span>
            )}
          </div>
        </div>
      )}
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs text-muted-foreground">{status}</div>
        <div className="flex items-center gap-2">
          {onWipe && !busy && (
            <Button
              size="sm"
              variant="ghost"
              onClick={onWipe}
              disabled={disabled}
              className="text-muted-foreground hover:text-rose-600 dark:hover:text-rose-400"
              aria-label="Wipe cached data"
              title="Wipe cached data"
            >
              <TrashIcon className="size-3.5" />
            </Button>
          )}
          <Button
            size="sm"
            variant={primary ? "default" : "outline"}
            onClick={onAction}
            disabled={disabled}
          >
            {busy ? (
              <>
                <ArrowClockwiseIcon className="size-3.5 animate-spin" />
                Extracting…
              </>
            ) : (
              <>
                <DownloadSimpleIcon className="size-3.5" />
                {actionLabel}
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}

function ClientCard({
  state,
  busyKind,
  disabled,
  onBrowse,
  onForget,
}: {
  state: WowClientState | null
  /** Which action this card is currently running, so we can spin the
   * right button without spilling state into the parent. */
  busyKind: "browse" | "forget" | null
  disabled: boolean
  onBrowse: () => void
  onForget: () => void
}) {
  // Loading-shimmer: keep visual height stable while the initial fetch
  // resolves so the section doesn't jump.
  if (state === null) {
    return (
      <div className="h-16 animate-pulse rounded-md border border-border bg-muted/20" />
    )
  }

  // No client connected → primary CTA is the file browser. This is the
  // single source-of-truth UI for connecting; the dashboard's amber
  // notification routes here rather than showing its own picker.
  if (!state.directory) {
    return (
      <div className="flex items-start gap-3 rounded-md border border-border bg-card p-4">
        <PlugsIcon className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
        <div className="flex-1 space-y-1">
          <div className="text-sm font-medium leading-tight">
            No WoW client connected
          </div>
          <p className="text-xs text-muted-foreground">
            Point us at your WoW 3.3.5a install folder. We'll use it to
            set your realmlist and to pull metadata for the icon /
            tooltip enrichments above.
          </p>
        </div>
        <Button
          size="sm"
          onClick={onBrowse}
          disabled={disabled}
          className="shrink-0 gap-1.5"
        >
          {busyKind === "browse" ? (
            <>
              <ArrowClockwiseIcon className="size-3.5 animate-spin" />
              Working…
            </>
          ) : (
            <>
              <FolderOpenIcon className="size-3.5" />
              Browse
            </>
          )}
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border bg-card p-4">
      <div className="flex items-start gap-3">
        <FolderOpenIcon className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
        <div className="flex-1 space-y-0.5">
          <div className="text-sm font-medium leading-tight">
            Connected client
          </div>
          <div className="font-mono text-xs text-muted-foreground break-all">
            {state.directory}
            {state.locale && (
              <span className="text-muted-foreground/70">
                {" "}
                · locale {state.locale}
              </span>
            )}
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs text-muted-foreground">
          Disconnects the client only. Any extracted icons / tooltips
          stay in the app's cache — wipe those separately above if you
          want to start clean.
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={onBrowse}
            disabled={disabled}
          >
            {busyKind === "browse" ? (
              <>
                <ArrowClockwiseIcon className="size-3.5 animate-spin" />
                Working…
              </>
            ) : (
              <>
                <FolderOpenIcon className="size-3.5" />
                Change…
              </>
            )}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={onForget}
            disabled={disabled}
            className="border-rose-500/40 text-rose-600 hover:bg-rose-500/10 hover:text-rose-700 dark:text-rose-400 dark:hover:text-rose-300"
          >
            {busyKind === "forget" ? (
              <>
                <ArrowClockwiseIcon className="size-3.5 animate-spin" />
                Forgetting…
              </>
            ) : (
              <>
                <TrashIcon className="size-3.5" />
                Forget client
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}

function iconStatusLine(status: IconCacheStatus | null): string {
  if (!status) return "Loading status…"
  if (status.status === "no_client") return "Connect a WoW client first"
  if (status.status === "not_extracted") return "Not extracted yet"
  return `${status.count.toLocaleString()} icons cached${
    status.stale ? " · cache is from a different client" : ""
  }`
}

function tooltipStatusLine(status: TooltipCacheStatus | null): string {
  if (!status) return "Loading status…"
  if (status.status === "no_client") return "Connect a WoW client first"
  if (status.status === "not_extracted") return "Not extracted yet"
  return `${status.spell_count.toLocaleString()} spells · ${status.set_count.toLocaleString()} item sets${
    status.stale ? " · cache is from a different client" : ""
  }`
}

function NoClientCallout() {
  return (
    <div className="flex items-start gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-amber-800 dark:text-amber-200">
      <WarningCircleIcon className="mt-0.5 size-4 shrink-0" />
      <div className="text-xs">
        <strong>Connect a WoW client first.</strong> Open the Dashboard
        and point the WoW Client card at your install directory. The
        extractors need to read files out of <span className="font-mono">Data/*.MPQ</span>.
      </div>
    </div>
  )
}

function ErrorBanner({
  message,
  onDismiss,
}: {
  message: string
  onDismiss: () => void
}) {
  return (
    <div className="flex items-start gap-3 rounded-md border border-rose-500/40 bg-rose-500/10 p-3 text-rose-800 dark:text-rose-200">
      <WarningCircleIcon className="mt-0.5 size-4 shrink-0" />
      <div className="flex-1 text-xs">{message}</div>
      <button
        type="button"
        onClick={onDismiss}
        className="text-rose-600/70 hover:text-rose-800 dark:text-rose-400/70 dark:hover:text-rose-200"
        aria-label="Dismiss"
      >
        <CheckCircleIcon className="size-4" />
      </button>
    </div>
  )
}
