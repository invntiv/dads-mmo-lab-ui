import * as React from "react"
import {
  ArrowLeftIcon,
  CheckCircleIcon,
  DownloadSimpleIcon,
  FloppyDiskIcon,
  FolderOpenIcon,
  UserCircleIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react"
import { save as saveDialog } from "@tauri-apps/plugin-dialog"
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
 * Character Backup wizard — four steps:
 *
 *   1. Account → username (passes through `lookup_account`; password
 *      is OPTIONAL since SOAP-level access is implicit when the Lab
 *      can read the chardb). We surface a password field anyway so
 *      users who have it can type it for their own peace of mind, but
 *      we don't actually verify against the hash.
 *   2. Characters → checkbox list; "All" master toggle defaults on.
 *      Excludes bot accounts via the same query the Player Bots
 *      browser uses; the user only sees their REAL characters.
 *   3. Output → file picker (defaults to ~/Documents/dml-backup-<ts>.dmlbak).
 *   4. Run → backup_characters Tauri command, success toast + close.
 *
 * Each step has a Back button (except step 1). The final "Back up"
 * button is disabled until enough info is present to run.
 */

type Step = "account" | "characters" | "output" | "running"

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

interface BackupResult {
  outputPath: string
  byteSize: number
  characterCount: number
}

export function CharacterBackupWizard({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (next: boolean) => void
}) {
  const [step, setStep] = React.useState<Step>("account")
  const [username, setUsername] = React.useState("")
  const [password, setPassword] = React.useState("")
  const [account, setAccount] = React.useState<AccountInfo | null>(null)
  const [characters, setCharacters] = React.useState<CharacterSummary[]>([])
  const [selected, setSelected] = React.useState<Set<number>>(new Set())
  const [outputPath, setOutputPath] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  // Reset everything on close. The next open starts fresh — the
  // wizard isn't a long-running task surface, so abandoning it
  // mid-flow shouldn't litter state into the next session.
  React.useEffect(() => {
    if (!open) {
      setStep("account")
      setUsername("")
      setPassword("")
      setAccount(null)
      setCharacters([])
      setSelected(new Set())
      setOutputPath("")
      setBusy(false)
      setError(null)
    }
  }, [open])

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
      const chars = await trackedInvoke<CharacterSummary[]>(
        "list_account_characters",
        { accountId: acct.id }
      )
      setAccount(acct)
      setCharacters(chars)
      // Default: ALL boxes checked. Matches the user's "All checkbox
      // at the top, defaulted to checked" spec.
      setSelected(new Set(chars.map((c) => c.guid)))
      setStep("characters")
    } catch (e) {
      setError(typeof e === "string" ? e : String(e))
    } finally {
      setBusy(false)
    }
  }

  const toggleAll = () => {
    if (selected.size === characters.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(characters.map((c) => c.guid)))
    }
  }
  const toggleOne = (guid: number) => {
    const next = new Set(selected)
    if (next.has(guid)) next.delete(guid)
    else next.add(guid)
    setSelected(next)
  }

  const pickOutput = async () => {
    if (!isTauri()) return
    const ts = new Date().toISOString().slice(0, 10)
    const defaultName = `dml-backup-${account?.username ?? "characters"}-${ts}.dmlbak`
    try {
      const picked = await saveDialog({
        title: "Save character backup",
        defaultPath: defaultName,
        filters: [{ name: "Dad's MMO Lab backup", extensions: ["dmlbak"] }],
      })
      if (picked && typeof picked === "string") {
        setOutputPath(picked)
      }
    } catch (e) {
      setError(typeof e === "string" ? e : String(e))
    }
  }

  const runBackup = async () => {
    if (!account || !outputPath || selected.size === 0) return
    setBusy(true)
    setError(null)
    setStep("running")
    const id = toast.loading(`Backing up ${selected.size} character(s)…`)
    try {
      const result = await trackedInvoke<BackupResult>("backup_characters", {
        args: {
          accountId: account.id,
          accountName: account.username,
          characterGuids: [...selected],
          outputPath,
        },
      })
      toast.success(`Backed up ${result.characterCount} character(s)`, {
        id,
        description: `${formatBytes(result.byteSize)} → ${result.outputPath}`,
      })
      onOpenChange(false)
    } catch (e) {
      toast.error("Backup failed", {
        id,
        description: typeof e === "string" ? e : String(e),
      })
      setError(typeof e === "string" ? e : String(e))
      setStep("output")
    } finally {
      setBusy(false)
    }
  }

  const goBack = () => {
    if (step === "characters") setStep("account")
    else if (step === "output") setStep("characters")
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <DownloadSimpleIcon className="size-5 text-primary" />
            Back up characters
          </DialogTitle>
          <DialogDescription>
            <StepCrumbs step={step} account={account} selectedCount={selected.size} />
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-[260px]">
          {step === "account" && (
            <AccountStep
              username={username}
              setUsername={setUsername}
              password={password}
              setPassword={setPassword}
              error={error}
              busy={busy}
              onSubmit={runAccountLookup}
            />
          )}
          {step === "characters" && (
            <CharacterStep
              characters={characters}
              selected={selected}
              onToggleAll={toggleAll}
              onToggleOne={toggleOne}
            />
          )}
          {step === "output" && (
            <OutputStep
              outputPath={outputPath}
              onPick={pickOutput}
              error={error}
            />
          )}
          {step === "running" && <RunningStep />}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          {step !== "account" && step !== "running" && (
            <Button variant="outline" onClick={goBack} disabled={busy}>
              <ArrowLeftIcon className="size-4" />
              Back
            </Button>
          )}
          {step === "account" && (
            <Button
              onClick={runAccountLookup}
              disabled={busy || username.trim().length === 0}
              className="ml-auto"
            >
              <UserCircleIcon className="size-4" />
              Find characters
            </Button>
          )}
          {step === "characters" && (
            <Button
              onClick={() => setStep("output")}
              disabled={selected.size === 0}
              className="ml-auto"
            >
              Continue ({selected.size})
            </Button>
          )}
          {step === "output" && (
            <Button
              onClick={runBackup}
              disabled={!outputPath || busy}
              className="ml-auto"
            >
              <FloppyDiskIcon className="size-4" weight="fill" />
              Back up
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Steps ──────────────────────────────────────────────────────────────

function AccountStep({
  username,
  setUsername,
  password,
  setPassword,
  error,
  busy,
  onSubmit,
}: {
  username: string
  setUsername: (s: string) => void
  password: string
  setPassword: (s: string) => void
  error: string | null
  busy: boolean
  onSubmit: () => void
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
        Enter the WoW account that owns the characters you want to back up.
        Password is optional — we use the username to find the account in the
        local chardb, not for authentication.
      </div>
      <div className="space-y-2">
        <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Account username
        </label>
        <Input
          autoFocus
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="e.g. admin"
          onKeyDown={(e) => {
            if (e.key === "Enter" && username.trim().length > 0 && !busy)
              onSubmit()
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
  characters,
  selected,
  onToggleAll,
  onToggleOne,
}: {
  characters: CharacterSummary[]
  selected: Set<number>
  onToggleAll: () => void
  onToggleOne: (guid: number) => void
}) {
  if (characters.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border bg-muted/20 p-4 text-sm text-muted-foreground">
        No characters on this account yet — log into the game and create one
        first.
      </div>
    )
  }
  const allSelected = selected.size === characters.length
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
        <span className="flex-1">All characters</span>
        <span className="font-mono text-xs text-muted-foreground">
          {selected.size} / {characters.length}
        </span>
      </button>
      <div className="max-h-[300px] space-y-1 overflow-y-auto pr-1">
        {characters.map((c) => {
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

function OutputStep({
  outputPath,
  onPick,
  error,
}: {
  outputPath: string
  onPick: () => void
  error: string | null
}) {
  return (
    <div className="space-y-3">
      <div className="rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
        The backup is a single <code>.dmlbak</code> file (a zip archive with
        per-table SQL dumps + a manifest). You can move it anywhere, hand it to
        someone else, or hold onto it before switching servers.
      </div>
      <div className="flex gap-2">
        <Input
          readOnly
          value={outputPath || "(no path selected)"}
          className="flex-1 text-xs"
        />
        <Button variant="outline" onClick={onPick}>
          <FolderOpenIcon className="size-4" />
          Choose…
        </Button>
      </div>
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
      Dumping character data…
    </div>
  )
}

function StepCrumbs({
  step,
  account,
  selectedCount,
}: {
  step: Step
  account: AccountInfo | null
  selectedCount: number
}) {
  const crumbs = [
    { id: "account", label: account ? account.username : "Account" },
    {
      id: "characters",
      label: selectedCount > 0 ? `${selectedCount} selected` : "Characters",
    },
    { id: "output", label: step === "output" || step === "running" ? "Output" : "Output" },
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

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
