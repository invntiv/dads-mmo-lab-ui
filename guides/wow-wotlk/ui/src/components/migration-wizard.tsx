"use client"

import * as React from "react"
import {
  CaretLeftIcon,
  CheckCircleIcon,
  EyeIcon,
  EyeSlashIcon,
  PlugIcon,
  UserSwitchIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import {
  type AdminVerifyResult,
  type CharacterSummary,
  type MigrationReport,
  useServerState,
} from "@/components/server-state-context"
import {
  MODULES,
  ModulesStep,
  type ModuleKey,
} from "@/components/install-onboarding"
import { CLASS_NAMES, RACE_NAMES } from "@/lib/wow-character-enums"
import { cn } from "@/lib/utils"

/**
 * Migration wizard — brings a hand-built (non-Lab) playerbots server up to
 * parity: rewrites the compose override to add SOAP + the Eluna bridge,
 * clones mod-ale + any chosen modules, recompiles (ccache keeps this cheap),
 * then bootstraps the admin + AHBot accounts and writes the marker. The
 * user's characters and data volumes are never touched.
 *
 * Routed here from InstallResumeBanner when `analyze_install` recommends
 * "migrate". The report tells us exactly what's missing so we can show the
 * user a plain-English diff before they commit to the rebuild.
 */

// Admin sub-flow: the user either adopts an existing account (we confirm it
// + list its characters) or creates a brand-new admin.
type AdminMode = "adopt" | "create"

type Step = { id: "intro" | "admin" | "modules" | "summary"; title: string; description: string }

function buildSteps(): Step[] {
  return [
    {
      id: "intro",
      title: "Bring your server into The Lab",
      description:
        "We found a WoW server you set up outside the app. To manage it here we need to add a couple of things and rebuild — your characters and data stay exactly as they are.",
    },
    {
      id: "admin",
      title: "Your admin account",
      description:
        "The Lab sends GM commands as one account. Tell us the account you already play, and we'll confirm it and show its characters.",
    },
    {
      id: "modules",
      title: "Add any modules?",
      description:
        "We're recompiling anyway, so adding modules now is free. Skip this if you just want parity with your current setup.",
    },
    {
      id: "summary",
      title: "Ready to migrate",
      description:
        "Review what we'll do. The rebuild reuses your existing compiled server, so it's usually minutes — not the full first-time compile.",
    },
  ]
}

const NO_MODULES: Record<ModuleKey, boolean> = MODULES.reduce(
  (acc, m) => {
    acc[m.key] = false
    return acc
  },
  {} as Record<ModuleKey, boolean>
)

export function MigrationWizard({
  open,
  report,
  onOpenChange,
}: {
  open: boolean
  report: MigrationReport | null
  onOpenChange: (open: boolean) => void
}) {
  const { startInstall } = useServerState()
  const [step, setStep] = React.useState(0)
  const [adminUser, setAdminUser] = React.useState("")
  const [adminPass, setAdminPass] = React.useState("")
  const [adminMode, setAdminMode] = React.useState<AdminMode | null>(null)
  const [verify, setVerify] = React.useState<AdminVerifyResult | null>(null)
  const [modules, setModules] = React.useState<Record<ModuleKey, boolean>>(NO_MODULES)

  // Reset when the dialog closes so reopening starts clean.
  React.useEffect(() => {
    if (!open) {
      const t = setTimeout(() => {
        setStep(0)
        setAdminUser("")
        setAdminPass("")
        setAdminMode(null)
        setVerify(null)
        setModules(NO_MODULES)
      }, 200)
      return () => clearTimeout(t)
    }
  }, [open])

  const steps = React.useMemo(() => buildSteps(), [])
  const current = steps[step]
  const isLast = step === steps.length - 1

  const selectedModuleKeys = (Object.keys(modules) as ModuleKey[]).filter(
    (k) => modules[k]
  )

  // The admin step gates advancement: you can't move on until you've either
  // confirmed an existing account or chosen to create a new one, with a
  // password entered either way.
  const adminReady = adminMode !== null && adminPass.length > 0 && adminUser.length > 0
  const canAdvance = current.id === "admin" ? adminReady : true

  const advance = () => {
    if (!canAdvance) return
    if (isLast) {
      onOpenChange(false)
      void startInstall({
        serverType: "playerbots",
        migrate: true,
        adminUser,
        adminPass,
        modules: selectedModuleKeys,
      })
      return
    }
    setStep((s) => s + 1)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="grid h-140 grid-cols-[2fr_3fr] gap-0 overflow-hidden rounded-xl p-0 text-sm sm:max-w-225"
        aria-description="server migration"
      >
        {/* LEFT — title, description, step dots, back */}
        <div className="flex flex-col bg-muted/40 p-6">
          {step > 0 ? (
            <button
              onClick={() => setStep((s) => Math.max(0, s - 1))}
              className="inline-flex items-center gap-1 self-start text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              <CaretLeftIcon className="size-3.5" />
              Back
            </button>
          ) : (
            <span className="h-4" />
          )}

          <div className="mt-8 flex-1 space-y-2">
            <h2 className="font-heading text-2xl font-semibold leading-tight">
              {current.title}
            </h2>
            <p className="text-sm text-muted-foreground">{current.description}</p>
          </div>

          <StepDots total={steps.length} current={step} />
        </div>

        {/* RIGHT — step content + advance button */}
        <div className="flex min-h-0 flex-col p-6">
          <div className="min-h-0 flex-1 overflow-y-auto pr-1 pb-3">
            {current.id === "intro" && <IntroStep report={report} />}
            {current.id === "admin" && (
              <AdminStep
                user={adminUser}
                pass={adminPass}
                mode={adminMode}
                verify={verify}
                onUserChange={(u) => {
                  setAdminUser(u)
                  // Editing the name invalidates a prior confirmation.
                  setAdminMode(null)
                  setVerify(null)
                }}
                onPassChange={setAdminPass}
                onVerified={(result) => {
                  setVerify(result)
                  setAdminMode(result.exists ? "adopt" : null)
                }}
                onCreateNew={() => {
                  setVerify(null)
                  setAdminMode("create")
                }}
              />
            )}
            {current.id === "modules" && (
              <ModulesStep value={modules} onChange={setModules} />
            )}
            {current.id === "summary" && (
              <SummaryStep
                adminUser={adminUser}
                adminMode={adminMode}
                report={report}
                selectedModules={MODULES.filter((m) => modules[m.key])}
              />
            )}
          </div>

          <Button
            size="lg"
            className="mt-4 w-full"
            onClick={advance}
            disabled={!canAdvance}
          >
            {isLast ? "Start migration" : "Next"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function StepDots({ total, current }: { total: number; current: number }) {
  return (
    <div className="flex items-center gap-1.5">
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className={cn(
            "h-1.5 rounded-full transition-all",
            i === current ? "w-6 bg-foreground" : "w-1.5 bg-muted-foreground/30"
          )}
        />
      ))}
    </div>
  )
}

function IntroStep({ report }: { report: MigrationReport | null }) {
  // Translate the report's missing-pieces into plain-English bullets so the
  // user understands what the rebuild is actually adding.
  const items: { label: string; detail: string }[] = []
  if (report) {
    if (!report.hasSoapEnv)
      items.push({
        label: "Remote control (SOAP)",
        detail: "lets the app send commands like teleport, give item, and bot setup.",
      })
    if (!report.hasModAle || report.luaScriptsMissing.length > 0)
      items.push({
        label: "Bot bridge (Eluna)",
        detail: "powers My Party, talents, and auto-gear for your bots.",
      })
    items.push({
      label: "Auction House Bot",
      detail: "a seller account so the auction house isn't empty.",
    })
  }

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs text-emerald-700 dark:text-emerald-400">
        <CheckCircleIcon className="mb-1 inline size-4" /> Nothing is deleted.
        Your characters, accounts, and saved worlds are left exactly as they
        are.
      </div>

      <div className="space-y-2">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          What we'll add
        </div>
        {items.map((it) => (
          <div
            key={it.label}
            className="flex items-start gap-2.5 rounded-lg border border-border p-3"
          >
            <PlugIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <div className="space-y-0.5">
              <div className="text-sm font-medium text-foreground">{it.label}</div>
              <p className="text-xs text-muted-foreground">{it.detail}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-400">
        This rebuilds your server once. Because it reuses your already-compiled
        build, it's usually a few minutes — not the full first-time compile.
        Keep your device plugged in.
      </div>
    </div>
  )
}

function AdminStep({
  user,
  pass,
  mode,
  verify,
  onUserChange,
  onPassChange,
  onVerified,
  onCreateNew,
}: {
  user: string
  pass: string
  mode: AdminMode | null
  verify: AdminVerifyResult | null
  onUserChange: (u: string) => void
  onPassChange: (p: string) => void
  onVerified: (result: AdminVerifyResult) => void
  onCreateNew: () => void
}) {
  const { verifyAdminAccount } = useServerState()
  const [showPassword, setShowPassword] = React.useState(true)
  const [checking, setChecking] = React.useState(false)

  const confirm = async () => {
    const name = user.trim()
    if (!name) return
    setChecking(true)
    try {
      const result = await verifyAdminAccount(name)
      onVerified(result)
      if (!result.exists) {
        toast.info(`No account named "${name}" yet — you can create it as a new admin.`)
      }
    } catch (e) {
      toast.error(typeof e === "string" ? e : "Couldn't check that account — is the server running?")
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="migrate-user">Account name</Label>
        <Input
          id="migrate-user"
          value={user}
          onChange={(e) => onUserChange(e.target.value)}
          autoComplete="off"
          placeholder="The account you log into WoW with"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="migrate-pass">Password</Label>
        <div className="relative">
          <Input
            id="migrate-pass"
            type={showPassword ? "text" : "password"}
            value={pass}
            onChange={(e) => onPassChange(e.target.value)}
            autoComplete="new-password"
            className="pr-8"
          />
          <button
            type="button"
            tabIndex={-1}
            onClick={() => setShowPassword((s) => !s)}
            aria-label={showPassword ? "Hide password" : "Show password"}
            className="absolute top-1/2 right-2 -translate-y-1/2 text-primary transition-colors hover:text-primary/80"
          >
            {showPassword ? (
              <EyeSlashIcon className="size-4" />
            ) : (
              <EyeIcon className="size-4" />
            )}
          </button>
        </div>
        <p className="text-xs text-muted-foreground">
          Stored locally on your device. We never change your in-game password.
        </p>
      </div>

      {/* Confirm — unless we've already adopted/created. */}
      {mode === null && (
        <Button
          variant="secondary"
          className="w-full"
          onClick={() => void confirm()}
          disabled={checking || user.trim().length === 0}
        >
          {checking ? "Checking…" : "Confirm account"}
        </Button>
      )}

      {/* Found an existing account → adopt it. */}
      {mode === "adopt" && verify?.exists && (
        <div className="space-y-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3">
          <div className="flex items-center gap-2 text-sm font-medium text-emerald-700 dark:text-emerald-300">
            <CheckCircleIcon className="size-4" />
            Found your account
            {verify.gmLevel != null && verify.gmLevel < 3 && (
              <Badge variant="outline" className="text-[10px] font-normal">
                we'll grant GM access
              </Badge>
            )}
          </div>
          <CharacterList characters={verify.characters} />
          <button
            onClick={onCreateNew}
            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
          >
            Not this one — create a new admin instead
          </button>
        </div>
      )}

      {/* No such account, or the user chose to make a fresh one. */}
      {mode === "create" && (
        <div className="space-y-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
          <div className="flex items-center gap-2 text-sm font-medium text-amber-700 dark:text-amber-300">
            <UserSwitchIcon className="size-4" />
            New admin account
          </div>
          <p className="text-xs text-amber-700/90 dark:text-amber-300/90">
            We'll create <span className="font-mono">{user.trim() || "this account"}</span> fresh.
            The Lab won't see any of your existing characters this way — you can
            import them later from a backup.
          </p>
        </div>
      )}

      {/* Offer the create path when an account WAS found, as the grey escape
          hatch the design calls for. (When none was found, confirm already
          surfaces the create option via the toast + button below.) */}
      {verify?.exists === false && mode === null && (
        <Button variant="outline" className="w-full" onClick={onCreateNew}>
          Create "{user.trim()}" as a new admin
        </Button>
      )}
    </div>
  )
}

function CharacterList({ characters }: { characters: CharacterSummary[] }) {
  if (characters.length === 0) {
    return (
      <p className="text-xs text-emerald-700/80 dark:text-emerald-300/80">
        This account has no characters yet — that's fine, you can make some in
        WoW after migrating.
      </p>
    )
  }
  return (
    <div className="space-y-1">
      <p className="text-xs text-emerald-700/80 dark:text-emerald-300/80">
        These characters will appear in The Lab:
      </p>
      <div className="max-h-40 space-y-1 overflow-y-auto pr-1">
        {characters.map((c) => (
          <div
            key={c.guid}
            className="flex items-center justify-between rounded-md bg-background/50 px-2.5 py-1.5 text-xs"
          >
            <span className="font-medium text-foreground">{c.name}</span>
            <span className="text-muted-foreground">
              Lv {c.level} {RACE_NAMES[c.race] ?? ""} {CLASS_NAMES[c.class] ?? ""}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function SummaryStep({
  adminUser,
  adminMode,
  report,
  selectedModules,
}: {
  adminUser: string
  adminMode: AdminMode | null
  report: MigrationReport | null
  selectedModules: { key: ModuleKey; label: string }[]
}) {
  return (
    <div className="space-y-4">
      <SummaryRow label="Admin account">
        <span className="font-mono">{adminUser}</span>
        <span className="text-muted-foreground">
          {adminMode === "create" ? " · new account" : " · your existing account"}
        </span>
      </SummaryRow>
      <SummaryRow label="Adds">
        <div className="flex flex-wrap gap-1.5">
          {report && !report.hasSoapEnv && (
            <Badge variant="secondary" className="font-normal">SOAP</Badge>
          )}
          {report && (!report.hasModAle || report.luaScriptsMissing.length > 0) && (
            <Badge variant="secondary" className="font-normal">Eluna bridge</Badge>
          )}
          <Badge variant="secondary" className="font-normal">Auction House Bot</Badge>
        </div>
      </SummaryRow>
      <SummaryRow label="New modules">
        {selectedModules.length === 0 ? (
          <span className="text-muted-foreground">None</span>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {selectedModules.map((m) => (
              <Badge key={m.key} variant="secondary" className="font-normal">
                {m.label}
              </Badge>
            ))}
          </div>
        )}
      </SummaryRow>
      <SummaryRow label="Install location">
        <span className="font-mono text-xs">~/wow-server-playerbots</span>
      </SummaryRow>
      <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-400">
        <WarningCircleIcon className="mb-0.5 mr-1 inline size-3.5" />
        Your existing compose override is backed up before we replace it. The
        server restarts once at the end to finish setup.
      </div>
    </div>
  )
}

function SummaryRow({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="grid grid-cols-[110px_1fr] items-start gap-3 border-b border-border/60 pb-3 last:border-b-0">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="text-sm">{children}</div>
    </div>
  )
}
