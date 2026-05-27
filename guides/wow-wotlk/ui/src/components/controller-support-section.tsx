import * as React from "react"
import {
  CaretLeftIcon,
  CaretRightIcon,
  CheckCircleIcon,
  CircleIcon,
  DownloadSimpleIcon,
  GameControllerIcon,
  WarningCircleIcon,
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
import { trackedInvoke, isTauri } from "@/lib/tauri"
import { cn } from "@/lib/utils"

// Vite handles these import paths — the URLs are resolved at build
// time so the screenshots ship inside the app bundle. No runtime
// network fetch; works offline.
import screen1 from "@/assets/consoleportlk/screen-1.png"
import screen2 from "@/assets/consoleportlk/screen-2.png"

/**
 * Settings → Controller Support section. v1 surfaces the
 * ConsolePortLK install flow (extract bundled addon into the WoW
 * client's Interface/AddOns folder). Steam-Deck-friendly controller
 * binding profile distribution is a follow-up.
 *
 * Self-contained: owns its own status fetch + polling, doesn't need
 * props from SettingsScreen. Drop the component into Settings to add
 * the section.
 */

type ConsolePortStatus =
  | { status: "no_client" }
  | { status: "not_installed"; client_dir: string }
  | { status: "installed"; client_dir: string; version: string }

const SCREENSHOTS = [
  { src: screen1, alt: "ConsolePortLK in-game UI overlay" },
  { src: screen2, alt: "ConsolePortLK action bar + controller bindings" },
]

const SLIDESHOW_INTERVAL_MS = 5_000

export function ControllerSupportSection() {
  return (
    <section className="space-y-3">
      <div className="space-y-1">
        <h2 className="flex items-center gap-2 text-base font-semibold leading-tight">
          <GameControllerIcon className="size-5 text-muted-foreground" />
          Controller Support
        </h2>
        <p className="text-xs text-muted-foreground">
          Make WoW 3.3.5a feel right at home on a Steam Deck (or any
          controller setup) by installing community addons + profiles.
        </p>
      </div>
      <ConsolePortLKCard />
    </section>
  )
}

function ConsolePortLKCard() {
  const [status, setStatus] = React.useState<ConsolePortStatus | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [installInfo, setInstallInfo] = React.useState<{
    file_count: number
    folders: string[]
    accounts_seeded: number
    appid: number
  } | null>(null)
  const [noShortcutOpen, setNoShortcutOpen] = React.useState(false)

  const refresh = React.useCallback(async () => {
    if (!isTauri()) return
    try {
      const s = await trackedInvoke<ConsolePortStatus>(
        "get_consoleportlk_status"
      )
      setStatus(s)
    } catch (e) {
      console.warn("get_consoleportlk_status failed", e)
    }
  }, [])

  React.useEffect(() => {
    void refresh()
  }, [refresh])

  const install = async () => {
    setBusy(true)
    setError(null)
    setInstallInfo(null)
    try {
      // Prerequisite: the user must have WoW added to Steam as a non-
      // Steam game — that's the target for our controller layout. If
      // it's missing, prompt and bail (no destructive work done yet).
      const shortcut = await trackedInvoke<{
        appid: number
        name: string
      } | null>("find_wow_steam_shortcut")
      if (!shortcut) {
        setNoShortcutOpen(true)
        return
      }
      const result = await trackedInvoke<{
        file_count: number
        folders: string[]
        version: string
        accounts_seeded: number
      }>("install_consoleportlk")
      // Apply the Steam Workshop controller layout (subscribe + apply
      // via the steam:// URL scheme). Non-fatal if Steam isn't there.
      try {
        await trackedInvoke("apply_controller_preset", {
          appid: shortcut.appid,
        })
      } catch (presetErr) {
        console.warn("apply_controller_preset failed", presetErr)
      }
      setInstallInfo({ ...result, appid: shortcut.appid })
      await refresh()
    } catch (e) {
      setError(typeof e === "string" ? e : String(e))
    } finally {
      setBusy(false)
    }
  }

  const noClient = status?.status === "no_client"
  const installed = status?.status === "installed"

  return (
    <div className="flex flex-col gap-4 rounded-md border border-border bg-card p-4">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 shrink-0 rounded bg-muted p-1.5 text-muted-foreground">
          <GameControllerIcon className="size-5" />
        </div>
        <div className="flex-1 space-y-0.5">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold leading-tight">
              ConsolePortLK
            </span>
            {installed && (
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                <CheckCircleIcon className="size-3" weight="fill" />
                Installed · v{status.version}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Automatically installs the WotLK port of the iconic
            controller-support addon. Drops 8 addon folders into your
            client's <span className="font-mono">Interface/AddOns</span>{" "}
            directory — no manual zip-fiddling. Makes playing WoW on a
            Steam Deck (or any controller) truly comfy.
          </p>
        </div>
      </div>

      <Slideshow />

      {noClient && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          <WarningCircleIcon className="mt-0.5 size-3.5 shrink-0" />
          <span>
            Connect a WoW client in the WoW client section above before
            installing. The addon needs an{" "}
            <span className="font-mono">Interface/AddOns/</span> directory
            to extract into.
          </span>
        </div>
      )}

      {error && (
        <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">
          {error}
        </div>
      )}

      {installInfo && (
        <div className="space-y-1 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300">
          <div>
            ✓ Installed {installInfo.file_count.toLocaleString()} files
            across {installInfo.folders.length} addon folders.
          </div>
          <div>
            {installInfo.accounts_seeded > 0 ? (
              <>
                Applied the controller preset to{" "}
                {installInfo.accounts_seeded} WoW account
                {installInfo.accounts_seeded === 1 ? "" : "s"}. Steam
                should prompt you to subscribe to "The Lab:
                ConsolePortLK" and apply it to your WoW shortcut — say
                yes.
              </>
            ) : (
              <>
                Addon is in, but no WoW account folders exist yet —{" "}
                <span className="font-medium">launch WoW once</span> so
                the per-account folder is created, then click{" "}
                <span className="font-medium">Reinstall</span> to apply
                the controller bindings.
              </>
            )}
          </div>
          <div className="text-emerald-700/70 dark:text-emerald-300/70">
            Restart WoW (or run <span className="font-mono">/reload</span>)
            to pick up the addon.
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <div className="text-xs text-muted-foreground">
          {installed
            ? `Installed at ${shortPath(status.client_dir)}/Interface/Addons/`
            : "Bundled with this app — no internet needed."}
        </div>
        <Button
          size="sm"
          onClick={install}
          disabled={noClient || busy}
          variant={installed ? "outline" : "default"}
        >
          <DownloadSimpleIcon className="size-3.5" />
          {busy
            ? "Installing…"
            : installed
              ? "Reinstall"
              : "Install ConsolePortLK"}
        </Button>
      </div>

      <Dialog open={noShortcutOpen} onOpenChange={setNoShortcutOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add WoW to Steam first</DialogTitle>
            <DialogDescription>
              To apply The Lab's controller layout, your WoW client needs
              to be added to Steam as a non-Steam game. Once it's there,
              come back and click Install ConsolePortLK again.
            </DialogDescription>
          </DialogHeader>
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            <li>
              Switch to <span className="font-medium">Desktop Mode</span>{" "}
              and open Steam.
            </li>
            <li>
              <span className="font-medium">
                Games → Add a Non-Steam Game…
              </span>{" "}
              (or right-click your Lutris WoW entry → Create Steam
              Shortcut).
            </li>
            <li>
              Pick your WoW launcher (or the Lutris WoW entry) and click{" "}
              <span className="font-medium">Add Selected</span>.
            </li>
            <li>
              Return here and click{" "}
              <span className="font-medium">Install ConsolePortLK</span>{" "}
              again.
            </li>
          </ol>
          <DialogFooter>
            <Button onClick={() => setNoShortcutOpen(false)}>Got it</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/**
 * Auto-advancing slideshow of the two ConsolePortLK screenshots.
 * Hover pauses the auto-advance; manual prev/next + dot pagination
 * work the way users expect. Pure CSS sizing — capped at the card's
 * width so the section doesn't blow up the page layout.
 */
function Slideshow() {
  const [index, setIndex] = React.useState(0)
  const [paused, setPaused] = React.useState(false)

  React.useEffect(() => {
    if (paused) return
    const handle = setInterval(() => {
      setIndex((i) => (i + 1) % SCREENSHOTS.length)
    }, SLIDESHOW_INTERVAL_MS)
    return () => clearInterval(handle)
  }, [paused])

  const go = (dir: -1 | 1) => {
    setIndex(
      (i) => (i + dir + SCREENSHOTS.length) % SCREENSHOTS.length
    )
  }

  return (
    <div
      className="relative overflow-hidden rounded-md border border-border bg-black"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {/* aspect-video roughly matches the source 1365×767 (16:9-ish),
          keeping the slideshow height stable as we cross-fade. */}
      <div className="relative aspect-video w-full">
        {SCREENSHOTS.map((s, i) => (
          <img
            key={i}
            src={s.src}
            alt={s.alt}
            className={cn(
              "absolute inset-0 size-full object-cover transition-opacity duration-500",
              i === index ? "opacity-100" : "opacity-0"
            )}
            draggable={false}
          />
        ))}
      </div>

      {/* prev / next chevrons — fade in on slideshow hover. */}
      <button
        type="button"
        onClick={() => go(-1)}
        aria-label="Previous screenshot"
        className="absolute left-1.5 top-1/2 -translate-y-1/2 rounded-full bg-black/40 p-1.5 text-white opacity-0 transition-opacity hover:bg-black/70 group-hover:opacity-100 [.group:hover_&]:opacity-100"
      >
        <CaretLeftIcon className="size-4" />
      </button>
      <button
        type="button"
        onClick={() => go(1)}
        aria-label="Next screenshot"
        className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-full bg-black/40 p-1.5 text-white opacity-0 transition-opacity hover:bg-black/70 group-hover:opacity-100 [.group:hover_&]:opacity-100"
      >
        <CaretRightIcon className="size-4" />
      </button>

      {/* dot pagination */}
      <div className="absolute bottom-2 left-1/2 flex -translate-x-1/2 items-center gap-1.5">
        {SCREENSHOTS.map((_, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setIndex(i)}
            aria-label={`Go to screenshot ${i + 1}`}
            className="rounded-full p-0.5 text-white/70 hover:text-white"
          >
            {i === index ? (
              <CircleIcon className="size-2" weight="fill" />
            ) : (
              <CircleIcon className="size-2" />
            )}
          </button>
        ))}
      </div>
    </div>
  )
}

function shortPath(p: string): string {
  // Trim long paths so the small detail line stays one row.
  return p.length > 50 ? `…${p.slice(-49)}` : p
}
