import * as React from "react"
import {
  ArrowClockwiseIcon,
  CheckCircleIcon,
  TrashIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { InstallConsole } from "@/components/install-console"
import {
  useServerState,
  type InstallVariant,
} from "@/components/server-state-context"
import { cn } from "@/lib/utils"

const VARIANT_LABEL: Record<InstallVariant, string> = {
  base: "Standard (no bots)",
  npcbots: "NPCBots",
  playerbots: "Playerbots",
}

/**
 * Settings → Uninstall server. Tears down the current WoW install,
 * its Docker containers + named volumes, and (optionally) the app's
 * own caches / persisted settings.
 *
 * Two confirmations:
 *   1. AlertDialog summarising what gets removed + "type DELETE".
 *   2. After success, a follow-up panel reminds the user that Steam
 *      shortcuts (WoW + The Lab) and the ConsolePortLK addon inside
 *      the WoW client are NOT auto-removed — we can't safely edit
 *      shortcuts.vdf while Steam is running.
 *
 * Why expose this in Settings rather than as its own page:
 *   - Discoverability — users browse Settings looking for "remove" /
 *     "delete" / "uninstall" affordances.
 *   - Same place as other destructive-but-bounded actions like wiping
 *     the enrichment caches; consistent mental model.
 */
export function UninstallSection() {
  const {
    installs,
    uninstallStatus,
    uninstallLog,
    uninstallPending,
    uninstallExitCode,
    startUninstall,
    resetUninstall,
  } = useServerState()

  // Pre-select the only install. When there's more than one we let the
  // user pick — multiple coexisting `wow-server*` dirs are unusual but
  // possible (e.g. someone installed both Base and Playerbots).
  const initialVariant = React.useMemo<InstallVariant>(() => {
    if (installs.length === 0) return "playerbots"
    const v = installs[0].variant
    return v === "unknown" ? "playerbots" : v
  }, [installs])

  const [variant, setVariant] = React.useState<InstallVariant>(initialVariant)
  // Keep in sync when installs are detected/refreshed.
  React.useEffect(() => {
    setVariant(initialVariant)
  }, [initialVariant])

  // Defaults match the script: keep client volume (fast reinstall),
  // keep images (fast reinstall). The character/notice wipe + cache
  // wipe are unconditional now — see the dialog body for what's auto.
  const [keepClientData, setKeepClientData] = React.useState(true)
  const [removeImages, setRemoveImages] = React.useState(false)

  const [confirmOpen, setConfirmOpen] = React.useState(false)
  const [confirmText, setConfirmText] = React.useState("")

  const validInstalls = installs.filter((i) => i.variant !== "unknown")
  const noInstalls = validInstalls.length === 0
  const inFlight = uninstallStatus === "running"
  // Only the failure branch renders inline now — success is surfaced via
  // <UninstallSuccessDialog/> at the App root so it survives the
  // immediate route-out to WelcomeScreen when `installs` empties.
  const showFailure = uninstallStatus === "failed"

  const handleConfirm = async () => {
    setConfirmOpen(false)
    setConfirmText("")
    await startUninstall({
      variant,
      keepClientData,
      removeImages,
    })
  }

  // When no install exists, fall back to a quiet empty card.
  if (noInstalls && uninstallStatus === "idle") {
    return (
      <div className="flex items-start gap-3 rounded-md border border-border bg-card p-4">
        <CheckCircleIcon className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
        <div className="flex-1 space-y-1">
          <div className="text-sm font-medium leading-tight">
            No installation detected
          </div>
          <p className="text-xs text-muted-foreground">
            There's nothing to uninstall. Once you install a server via
            the Install button, this card will let you tear it down.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div
        className={cn(
          "flex flex-col gap-4 rounded-md border p-4",
          "border-rose-500/40 bg-rose-500/5"
        )}
      >
        {/* ── Pre-uninstall: variant + options + button ─────────────── */}
        {uninstallStatus === "idle" && (
          <>
            <div className="flex items-start gap-3">
              <TrashIcon className="mt-0.5 size-5 shrink-0 text-rose-600 dark:text-rose-400" />
              <div className="flex-1 space-y-1">
                <div className="text-sm font-semibold leading-tight">
                  Uninstall this server
                </div>
                <p className="text-xs text-muted-foreground">
                  Stops the containers, removes the install folder
                  (containing your character data), drops the database
                  volume, and removes the Steam Deck launcher script. Your
                  WoW client files are not touched.
                </p>
              </div>
            </div>

            {validInstalls.length > 1 && (
              <div className="space-y-1">
                <Label htmlFor="uninstall-variant" className="text-xs">
                  Which installation?
                </Label>
                <Select
                  value={variant}
                  onValueChange={(v) => setVariant(v as InstallVariant)}
                >
                  <SelectTrigger id="uninstall-variant">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {validInstalls.map((i) => (
                      <SelectItem key={i.path} value={i.variant as InstallVariant}>
                        {VARIANT_LABEL[i.variant as InstallVariant]}
                        <span className="ml-2 text-xs text-muted-foreground">
                          {i.path}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="grid gap-2 sm:grid-cols-2">
              <OptionCheckbox
                checked={keepClientData}
                onCheckedChange={setKeepClientData}
                label="Keep client data volume"
                description="Skip wiping the ~6GB extracted maps/DBCs so the next install is fast. Only reused if you reinstall the same variant to the same path."
                recommended
              />
              <OptionCheckbox
                checked={removeImages}
                onCheckedChange={setRemoveImages}
                label="Remove Docker images"
                description="Saves ~3-5GB but re-pulling on the next install takes a while."
              />
            </div>
            <p className="text-[11px] leading-snug text-muted-foreground">
              Always wiped: your selected character, character switcher,
              dismissed notices, and the icon / tooltip / talent caches.
              Always kept: audio, cursor, WoW client folder, and other
              app-level preferences.
            </p>

            <div className="flex items-center justify-end gap-2 pt-1">
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setConfirmOpen(true)}
              >
                <TrashIcon className="size-3.5" />
                Uninstall…
              </Button>
            </div>
          </>
        )}

        {/* ── In-flight: spinner + live console ─────────────────────── */}
        {inFlight && (
          <>
            <div className="flex items-start gap-3">
              <ArrowClockwiseIcon className="mt-0.5 size-5 shrink-0 animate-spin text-rose-600 dark:text-rose-400" />
              <div className="flex-1 space-y-1">
                <div className="text-sm font-semibold leading-tight">
                  Uninstalling {VARIANT_LABEL[variant]}…
                </div>
                <p className="text-xs text-muted-foreground">
                  Hold tight — this takes 30-60 seconds. Don't close the
                  app until it finishes.
                </p>
              </div>
            </div>
            <InstallConsole
              entries={uninstallLog}
              pending={uninstallPending}
              className="h-64"
            />
          </>
        )}

        {/* ── Failure: summary + console + dismiss ──────────────────── */}
        {/* Success is intentionally NOT rendered here — see
            `showFailure` comment above and `<UninstallSuccessDialog/>`. */}
        {showFailure && (
          <>
            <div className="flex items-start gap-3">
              <WarningCircleIcon className="mt-0.5 size-5 shrink-0 text-rose-600 dark:text-rose-400" />
              <div className="flex-1 space-y-1">
                <div className="text-sm font-semibold leading-tight">
                  Uninstall failed (exit {uninstallExitCode ?? "?"})
                </div>
                <p className="text-xs text-muted-foreground">
                  Check the log below — you may need to stop containers or
                  remove volumes by hand.
                </p>
              </div>
            </div>

            <InstallConsole
              entries={uninstallLog}
              pending={uninstallPending}
              className="h-56"
            />

            <div className="flex items-center justify-end gap-2 pt-1">
              <Button variant="outline" size="sm" onClick={resetUninstall}>
                Dismiss
              </Button>
            </div>
          </>
        )}
      </div>

      {/* ── Confirmation dialog ───────────────────────────────────── */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Uninstall {VARIANT_LABEL[variant]}?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm">
                <p>
                  This will permanently remove your server, including all
                  character data and progress. You can't undo this.
                </p>
                <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
                  <li>Stops all containers (worldserver, authserver, database)</li>
                  <li>
                    Removes the install folder and database volume
                    {keepClientData && (
                      <span> (client-data volume kept for fast reinstall)</span>
                    )}
                  </li>
                  {removeImages && <li>Removes downloaded Docker images</li>}
                  <li>
                    Clears your selected character, switcher, and dismissed
                    notices from The Lab
                  </li>
                  <li>Wipes the icon / tooltip / talent caches</li>
                </ul>
                <div className="space-y-1.5">
                  <Label htmlFor="uninstall-confirm" className="text-xs">
                    Type{" "}
                    <span className="font-mono font-semibold">DELETE</span> to
                    confirm
                  </Label>
                  <Input
                    id="uninstall-confirm"
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                    className="font-mono"
                  />
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setConfirmText("")}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={confirmText !== "DELETE"}
              onClick={handleConfirm}
              className="bg-destructive text-white hover:bg-destructive/90 dark:bg-destructive/60"
            >
              <TrashIcon className="size-3.5" />
              Uninstall now
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function OptionCheckbox({
  checked,
  onCheckedChange,
  label,
  description,
  recommended,
}: {
  checked: boolean
  onCheckedChange: (v: boolean) => void
  label: string
  description: string
  recommended?: boolean
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2 rounded-md border border-border bg-background/40 p-2.5 hover:bg-background/70">
      <Checkbox
        checked={checked}
        onCheckedChange={(v) => onCheckedChange(v === true)}
        className="mt-0.5"
      />
      <div className="flex-1 space-y-0.5">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium leading-tight">{label}</span>
          {recommended && (
            <span className="rounded-full bg-emerald-500/15 px-1.5 py-0 text-[10px] text-emerald-700 dark:text-emerald-300">
              Recommended
            </span>
          )}
        </div>
        <p className="text-[11px] leading-snug text-muted-foreground">
          {description}
        </p>
      </div>
    </label>
  )
}

