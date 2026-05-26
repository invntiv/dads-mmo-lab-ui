import * as React from "react"
import {
  ArrowLeftIcon,
  ArrowUpIcon,
  CheckCircleIcon,
  FolderOpenIcon,
  UploadSimpleIcon,
  UserCircleIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react"
import { open as openDialog } from "@tauri-apps/plugin-dialog"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { isTauri, trackedInvoke } from "@/lib/tauri"
import {
  CLASS_COLORS,
  CLASS_NAMES,
  CLASS_SHORT_NAMES,
  RACE_NAMES,
} from "@/lib/wow-character-enums"
import { cn } from "@/lib/utils"

/**
 * Character Restore wizard — four steps:
 *
 *   1. File — `.dmlbak` picker; validate_backup parses the manifest
 *      so we know what's inside before showing the character list.
 *   2. Characters — checkboxes; "All" master toggle defaults on.
 *   3. Account — username of the TARGET account that should own the
 *      restored characters. Same lookup_account flow as backup.
 *   4. Run — restore_characters; surfaces guid-collision errors
 *      verbatim so the user knows which chars to drop and retry.
 */

type Step = "file" | "characters" | "account" | "running"

interface AccountInfo {
  id: number
  username: string
}

interface CharacterSummary {
  guid: number
  name: string
  race: number
  class: number
  gender: number
  level: number
}

interface BackupManifest {
  version: number
  createdAt: string
  sourceAccountId: number
  sourceAccountName: string
  characters: CharacterSummary[]
}

interface RestoreResult {
  restoredCharacters: number
  skippedDueToConflict: number[]
}

export function CharacterRestoreWizard({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (next: boolean) => void
}) {
  const [step, setStep] = React.useState<Step>("file")
  const [filePath, setFilePath] = React.useState("")
  const [manifest, setManifest] = React.useState<BackupManifest | null>(null)
  const [selected, setSelected] = React.useState<Set<number>>(new Set())
  const [username, setUsername] = React.useState("")
  const [password, setPassword] = React.useState("")
  const [account, setAccount] = React.useState<AccountInfo | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!open) {
      setStep("file")
      setFilePath("")
      setManifest(null)
      setSelected(new Set())
      setUsername("")
      setPassword("")
      setAccount(null)
      setBusy(false)
      setError(null)
    }
  }, [open])

  const pickFile = async () => {
    if (!isTauri()) return
    try {
      const picked = await openDialog({
        title: "Select character backup",
        multiple: false,
        filters: [{ name: "Dad's MMO Lab backup", extensions: ["dmlbak"] }],
      })
      if (!picked || typeof picked !== "string") return
      setFilePath(picked)
      setError(null)
      setBusy(true)
      try {
        const m = await trackedInvoke<BackupManifest>("validate_backup", {
          path: picked,
        })
        setManifest(m)
        setSelected(new Set(m.characters.map((c) => c.guid)))
        setStep("characters")
      } catch (e) {
        setError(typeof e === "string" ? e : String(e))
        setManifest(null)
      } finally {
        setBusy(false)
      }
    } catch (e) {
      setError(typeof e === "string" ? e : String(e))
    }
  }

  const toggleAll = () => {
    if (!manifest) return
    if (selected.size === manifest.characters.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(manifest.characters.map((c) => c.guid)))
    }
  }
  const toggleOne = (guid: number) => {
    const next = new Set(selected)
    if (next.has(guid)) next.delete(guid)
    else next.add(guid)
    setSelected(next)
  }

  const runAccountLookup = async () => {
    setBusy(true)
    setError(null)
    try {
      const acct = await trackedInvoke<AccountInfo | null>("lookup_account", {
        username: username.trim(),
      })
      if (!acct) {
        setError("No account found with that username.")
        return
      }
      setAccount(acct)
    } catch (e) {
      setError(typeof e === "string" ? e : String(e))
    } finally {
      setBusy(false)
    }
  }

  const runRestore = async () => {
    if (!account || !manifest || selected.size === 0) return
    setStep("running")
    setBusy(true)
    setError(null)
    const id = toast.loading(`Restoring ${selected.size} character(s)…`)
    try {
      const result = await trackedInvoke<RestoreResult>("restore_characters", {
        args: {
          backupPath: filePath,
          targetAccountId: account.id,
          characterGuids: [...selected],
        },
      })
      toast.success(`Restored ${result.restoredCharacters} character(s)`, {
        id,
        description: `Account: ${account.username}`,
      })
      onOpenChange(false)
    } catch (e) {
      toast.error("Restore failed", {
        id,
        description: typeof e === "string" ? e : String(e),
      })
      setError(typeof e === "string" ? e : String(e))
      setStep("account")
    } finally {
      setBusy(false)
    }
  }

  const goBack = () => {
    if (step === "characters") setStep("file")
    else if (step === "account") setStep("characters")
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UploadSimpleIcon className="size-5 text-primary" />
            Restore characters
          </DialogTitle>
          <DialogDescription>
            <StepCrumbs
              step={step}
              filePath={filePath}
              selectedCount={selected.size}
              account={account}
            />
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-[260px]">
          {step === "file" && (
            <FileStep
              filePath={filePath}
              onPick={pickFile}
              manifest={manifest}
              error={error}
              busy={busy}
            />
          )}
          {step === "characters" && manifest && (
            <CharacterStep
              manifest={manifest}
              selected={selected}
              onToggleAll={toggleAll}
              onToggleOne={toggleOne}
            />
          )}
          {step === "account" && (
            <AccountStep
              username={username}
              setUsername={setUsername}
              password={password}
              setPassword={setPassword}
              account={account}
              error={error}
              busy={busy}
              onLookup={runAccountLookup}
            />
          )}
          {step === "running" && <RunningStep />}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          {step !== "file" && step !== "running" && (
            <Button variant="outline" onClick={goBack} disabled={busy}>
              <ArrowLeftIcon className="size-4" />
              Back
            </Button>
          )}
          {step === "file" && manifest && (
            <Button onClick={() => setStep("characters")} className="ml-auto">
              Continue
            </Button>
          )}
          {step === "characters" && (
            <Button
              onClick={() => setStep("account")}
              disabled={selected.size === 0}
              className="ml-auto"
            >
              Continue ({selected.size})
            </Button>
          )}
          {step === "account" && (
            <Button
              onClick={account ? runRestore : runAccountLookup}
              disabled={busy || (!account && username.trim().length === 0)}
              className="ml-auto"
            >
              {account ? (
                <>
                  <ArrowUpIcon className="size-4" weight="bold" />
                  Restore
                </>
              ) : (
                <>
                  <UserCircleIcon className="size-4" />
                  Find account
                </>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function FileStep({
  filePath,
  onPick,
  manifest,
  error,
  busy,
}: {
  filePath: string
  onPick: () => void
  manifest: BackupManifest | null
  error: string | null
  busy: boolean
}) {
  return (
    <div className="space-y-3">
      <div className="rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
        Pick a <code>.dmlbak</code> file produced by the backup flow.
        We'll validate the manifest, show you the character list, and let you
        choose which ones to restore.
      </div>
      <div className="flex gap-2">
        <Input
          readOnly
          value={filePath || "(no file selected)"}
          className="flex-1 text-xs"
        />
        <Button variant="outline" onClick={onPick} disabled={busy}>
          <FolderOpenIcon className="size-4" />
          Choose…
        </Button>
      </div>
      {manifest && (
        <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs text-emerald-700 dark:text-emerald-400">
          <div className="flex items-start gap-2">
            <CheckCircleIcon className="mt-0.5 size-4 shrink-0" />
            <div className="flex-1 space-y-1">
              <div className="font-medium">Valid backup</div>
              <div>
                {manifest.characters.length} character
                {manifest.characters.length === 1 ? "" : "s"} from{" "}
                <span className="font-mono">{manifest.sourceAccountName}</span>
                {" · "}
                created {manifest.createdAt.slice(0, 10)}
              </div>
            </div>
          </div>
        </div>
      )}
      {error && (
        <div className="flex items-start gap-2 rounded-md border border-rose-500/30 bg-rose-500/5 p-2.5 text-xs text-rose-700 dark:text-rose-400">
          <WarningCircleIcon className="mt-0.5 size-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </div>
  )
}

function CharacterStep({
  manifest,
  selected,
  onToggleAll,
  onToggleOne,
}: {
  manifest: BackupManifest
  selected: Set<number>
  onToggleAll: () => void
  onToggleOne: (guid: number) => void
}) {
  const allSelected = selected.size === manifest.characters.length
  const someSelected = selected.size > 0 && !allSelected
  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={onToggleAll}
        className="flex w-full items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-left text-sm font-medium transition-colors hover:bg-muted/50"
      >
        <Checkbox
          checked={allSelected ? true : someSelected ? "indeterminate" : false}
          onCheckedChange={onToggleAll}
        />
        <span className="flex-1">All characters in backup</span>
        <span className="font-mono text-xs text-muted-foreground">
          {selected.size} / {manifest.characters.length}
        </span>
      </button>
      <div className="max-h-[280px] space-y-1 overflow-y-auto pr-1">
        {manifest.characters.map((c) => {
          const isSel = selected.has(c.guid)
          const cls = CLASS_NAMES[c.class] ?? `#${c.class}`
          const shortCls = CLASS_SHORT_NAMES[c.class] ?? cls
          const race = RACE_NAMES[c.race] ?? `#${c.race}`
          const color = CLASS_COLORS[c.class] ?? "text-foreground"
          return (
            <button
              key={c.guid}
              type="button"
              onClick={() => onToggleOne(c.guid)}
              className={cn(
                "flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left transition-colors",
                isSel
                  ? "border-primary/40 bg-primary/5"
                  : "border-border bg-card hover:border-border/60"
              )}
            >
              <Checkbox
                checked={isSel}
                onCheckedChange={() => onToggleOne(c.guid)}
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">
                  <span className={color}>{c.name}</span>
                  <span className="text-muted-foreground"> · {race}</span>
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  Lv {c.level} · {shortCls}
                </div>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function AccountStep({
  username,
  setUsername,
  password,
  setPassword,
  account,
  error,
  busy,
  onLookup,
}: {
  username: string
  setUsername: (s: string) => void
  password: string
  setPassword: (s: string) => void
  account: AccountInfo | null
  error: string | null
  busy: boolean
  onLookup: () => void
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
        Restored characters will be assigned to this account. Their original
        account ownership is overwritten — handy when restoring to a fresh
        install where account IDs differ.
      </div>
      <div className="space-y-2">
        <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Target account username
        </label>
        <Input
          autoFocus
          value={username}
          onChange={(e) => {
            setUsername(e.target.value)
            if (account) {
              // Typing a different name invalidates the resolved
              // account — force a fresh lookup.
            }
          }}
          placeholder="e.g. admin"
          onKeyDown={(e) => {
            if (e.key === "Enter" && username.trim().length > 0 && !busy)
              onLookup()
          }}
        />
      </div>
      <div className="space-y-2">
        <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Password (optional)
        </label>
        <Input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="(skipped if blank)"
        />
      </div>
      {account && (
        <div className="flex items-start gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-2.5 text-xs text-emerald-700 dark:text-emerald-400">
          <CheckCircleIcon className="mt-0.5 size-3.5 shrink-0" />
          <span>
            Account found: <span className="font-mono">{account.username}</span>{" "}
            (id {account.id}). Click Restore to apply.
          </span>
        </div>
      )}
      {error && (
        <div className="flex items-start gap-2 rounded-md border border-rose-500/30 bg-rose-500/5 p-2.5 text-xs text-rose-700 dark:text-rose-400">
          <WarningCircleIcon className="mt-0.5 size-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </div>
  )
}

function RunningStep() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12 text-sm text-muted-foreground">
      <CheckCircleIcon className="size-8 animate-pulse" />
      Sourcing SQL into the chardb…
    </div>
  )
}

function StepCrumbs({
  step,
  filePath,
  selectedCount,
  account,
}: {
  step: Step
  filePath: string
  selectedCount: number
  account: AccountInfo | null
}) {
  const crumbs = [
    { id: "file", label: filePath ? "Loaded" : "File" },
    {
      id: "characters",
      label: selectedCount > 0 ? `${selectedCount} selected` : "Characters",
    },
    { id: "account", label: account ? account.username : "Account" },
  ]
  return (
    <span className="flex flex-wrap items-center gap-1 text-xs">
      {crumbs.map((c, i) => (
        <React.Fragment key={c.id}>
          {i > 0 && <span className="text-muted-foreground/50">›</span>}
          <span
            className={cn(
              step === c.id
                ? "font-semibold text-foreground"
                : "text-muted-foreground"
            )}
          >
            {c.label}
          </span>
        </React.Fragment>
      ))}
    </span>
  )
}
