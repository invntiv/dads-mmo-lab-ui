"use client"

import * as React from "react"
import {
  BookOpenIcon,
  CaretLeftIcon,
  CoinsIcon,
  EyeIcon,
  EyeSlashIcon,
  PaletteIcon,
  ScalesIcon,
  StackIcon,
  StorefrontIcon,
  SwordIcon,
  UserIcon,
} from "@phosphor-icons/react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { useServerState } from "@/components/server-state-context"
import { cn } from "@/lib/utils"

type ServerType = "base" | "npcbots" | "playerbots"

type ModuleKey =
  | "mod-ah-bot"
  | "mod-solocraft"
  | "mod-autobalance"
  | "mod-transmog"
  | "mod-individual-progression"
  | "mod-1v1-arena"
  | "mod-aoe-loot"
  | "mod-learn-spells"

// Per-module config shapes. Only ahbot and ip have onboarding-worthy
// knobs (see MODULES_PLAN.md Phase 1) — every other module is a
// zero-question install.
type AhBotConfig = {
  itemsPerCycle: number
  /** 0 = long (1-3d), 1 = medium (1-24h), 2 = short (10-60min). */
  elapsingTimeClass: 0 | 1 | 2
  enableBuyer: boolean
  vendorItems: boolean
  professionItems: boolean
}

type IpConfig = {
  authenticDifficulty: boolean
  disableRdf: boolean
  dkRequiresTbc: boolean
}

type FormState = {
  serverType: ServerType
  modules: Record<ModuleKey, boolean>
  ahbot: AhBotConfig
  ip: IpConfig
  adminUser: string
  adminPass: string
}

const DEFAULT_STATE: FormState = {
  serverType: "playerbots",
  modules: {
    "mod-ah-bot": true,
    "mod-solocraft": true,
    "mod-autobalance": true,
    "mod-transmog": true,
    "mod-individual-progression": false,
    "mod-1v1-arena": false,
    "mod-aoe-loot": false,
    "mod-learn-spells": false,
  },
  // Defaults pulled from mod_ahbot.conf.dist (see MODULES_PLAN.md §Phase 1),
  // with two overrides that match the offline single-player use case
  // better than upstream's MMO defaults:
  //   - enableBuyer ON so the bot bids on player listings — gives the
  //     player liquidity, otherwise they're stuck with no buyers.
  //   - professionItems ON so herbs/ores/leather show up on the AH;
  //     without other players supplying them, they'd be nearly
  //     impossible to obtain in quantity.
  ahbot: {
    itemsPerCycle: 200,
    elapsingTimeClass: 1,
    enableBuyer: true,
    vendorItems: false,
    professionItems: true,
  },
  // Defaults preserve a "vanilla feel without difficulty tweaks" — the
  // module's intended design. dkRequiresTbc on by default per module
  // upstream.
  ip: {
    authenticDifficulty: false,
    disableRdf: false,
    dkRequiresTbc: true,
  },
  adminUser: "admin",
  adminPass: "admin",
}

const MODULES: {
  key: ModuleKey
  label: string
  blurb: string
  Icon: React.ComponentType<{ className?: string }>
}[] = [
  { key: "mod-ah-bot", label: "Auction House Bot", blurb: "Populates the AH with items so the economy isn't empty.", Icon: StorefrontIcon },
  { key: "mod-solocraft", label: "Solocraft", blurb: "Scales dungeons and raids down to a single player.", Icon: UserIcon },
  { key: "mod-autobalance", label: "Auto Balance", blurb: "Dynamic difficulty based on party size and gear.", Icon: ScalesIcon },
  { key: "mod-transmog", label: "Transmogrification", blurb: "Change the appearance of your gear.", Icon: PaletteIcon },
  { key: "mod-individual-progression", label: "Individual Progression", blurb: "Vanilla → TBC → WotLK gating per character.", Icon: StackIcon },
  { key: "mod-1v1-arena", label: "1v1 Arena", blurb: "Solo arena queues.", Icon: SwordIcon },
  { key: "mod-aoe-loot", label: "AoE Loot", blurb: "Loot all nearby corpses with one click.", Icon: CoinsIcon },
  { key: "mod-learn-spells", label: "Learn Spells on Levelup", blurb: "Skip the trainer trips.", Icon: BookOpenIcon },
]

/**
 * Static step identifiers. The wizard's actual step list is built
 * dynamically per render based on selected modules — modules with
 * onboarding-worthy config (currently AH Bot, IP) add their step to the
 * sequence; zero-question modules (Solocraft, AutoBalance, etc.) don't.
 */
type StepId =
  | "server-type"
  | "modules"
  | "ahbot-config"
  | "ip-config"
  | "admin"
  | "summary"

type StepDef = { id: StepId; title: string; description: string }

const STEP_DEFS: Record<StepId, Omit<StepDef, "id">> = {
  "server-type": {
    title: "Choose your server...",
    description:
      "Which AzerothCore variant do you want to install? You can change modules later, but the variant is baked in at install time.",
  },
  modules: {
    title: "Pick your modules",
    description:
      "Optional add-ons. Pre-selected ones are the most-loved defaults. Modules with configurable settings will get a follow-up step.",
  },
  "ahbot-config": {
    title: "Auction House Bot",
    description:
      "Tune how busy the bot keeps your auction house. Sensible defaults pre-filled — you can change these later from the Modules page.",
  },
  "ip-config": {
    title: "Individual Progression",
    description:
      "This module changes WoW fundamentally — characters start in Vanilla and unlock TBC then WotLK by clearing raids. Pick how authentic you want the experience.",
  },
  admin: {
    title: "Admin account",
    description:
      "This account has full GM powers. You'll use it to log into WoW and to send GM commands from this app.",
  },
  summary: {
    title: "Ready to install",
    description:
      "Review your choices. Installing Playerbots compiles AzerothCore from source — plan for 2–4 hours and keep your device plugged in.",
  },
}

function buildSteps(state: FormState): StepDef[] {
  const order: StepId[] = ["server-type", "modules"]
  if (state.modules["mod-ah-bot"]) order.push("ahbot-config")
  if (state.modules["mod-individual-progression"]) order.push("ip-config")
  order.push("admin", "summary")
  return order.map((id) => ({ id, ...STEP_DEFS[id] }))
}

export function InstallOnboarding({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [step, setStep] = React.useState(0)
  const [state, setState] = React.useState<FormState>(DEFAULT_STATE)
  const { startInstall } = useServerState()

  // Reset state when the dialog closes so reopening starts fresh
  React.useEffect(() => {
    if (!open) {
      const t = setTimeout(() => {
        setStep(0)
        setState(DEFAULT_STATE)
      }, 200)
      return () => clearTimeout(t)
    }
  }, [open])

  // Step list is recomputed each render so adding / removing a module
  // checkbox in step 2 immediately changes which follow-up steps appear.
  const steps = React.useMemo(() => buildSteps(state), [state])
  // Clamp `step` if the user de-selected a module and the current step
  // no longer exists in the list (e.g. they were on ahbot-config and
  // unchecked AH Bot via Back -> Modules).
  const safeStep = Math.min(step, steps.length - 1)
  const current = steps[safeStep]
  const isLast = safeStep === steps.length - 1
  const selectedModules = MODULES.filter((m) => state.modules[m.key])

  const advance = () => {
    if (isLast) {
      // Close the modal and hand off to the install console. The install
      // script clones every selected module into <install>/modules/
      // before the worldserver build, so they get compiled in free —
      // no separate rebuild step. AH Bot's bot-character setup remains
      // deferred to the post-install Modules page (it needs a real
      // character that can only be created via the WoW client).
      onOpenChange(false)
      void startInstall({
        serverType: state.serverType,
        adminUser: state.adminUser,
        adminPass: state.adminPass,
        modules: (Object.keys(state.modules) as ModuleKey[]).filter(
          (k) => state.modules[k]
        ),
        // Only forward config for modules the user actually selected —
        // otherwise we'd send AH Bot config for an install that doesn't
        // include AH Bot.
        moduleConfig: {
          ahbot: state.modules["mod-ah-bot"] ? state.ahbot : undefined,
          ip: state.modules["mod-individual-progression"] ? state.ip : undefined,
        },
      })
      return
    }
    // Use safeStep, not raw step, so toggling a module in step 2 that
    // shrinks the step list doesn't leave us stranded at an OOB index.
    setStep(safeStep + 1)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="grid h-140 grid-cols-[2fr_3fr] gap-0 overflow-hidden rounded-xl p-0 text-sm sm:max-w-225" aria-description="onboarding options">
        {/* LEFT — title, description, step dots, back */}
        <div className="flex flex-col bg-muted/40 p-6">
          {safeStep > 0 ? (
            <button
              onClick={() => setStep(Math.max(0, safeStep - 1))}
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

          <StepDots total={steps.length} current={safeStep} />
        </div>

        {/* RIGHT — form for the current step + advance button */}
        <div className="flex min-h-0 flex-col p-6">
          {/*
            Step-content scroll container. Shared by every step on the
            right side of the modal. `pb-3` guarantees the last item in
            any overflowing step (e.g. AH Bot's five-checkbox form) gets
            visible breathing room when scrolled to the bottom — without
            it, the final card's border butts right up against the
            scroll-area edge and looks clipped.
          */}
          <div className="min-h-0 flex-1 overflow-y-auto pr-1 pb-3">
            {current.id === "server-type" && (
              <ServerTypeStep
                value={state.serverType}
                onChange={(serverType) => setState((s) => ({ ...s, serverType }))}
              />
            )}
            {current.id === "modules" && (
              <ModulesStep
                value={state.modules}
                onChange={(modules) => setState((s) => ({ ...s, modules }))}
              />
            )}
            {current.id === "ahbot-config" && (
              <AhBotConfigStep
                value={state.ahbot}
                onChange={(ahbot) => setState((s) => ({ ...s, ahbot }))}
              />
            )}
            {current.id === "ip-config" && (
              <IpConfigStep
                value={state.ip}
                onChange={(ip) => setState((s) => ({ ...s, ip }))}
              />
            )}
            {current.id === "admin" && (
              <AdminStep
                user={state.adminUser}
                pass={state.adminPass}
                onChange={(adminUser, adminPass) =>
                  setState((s) => ({ ...s, adminUser, adminPass }))
                }
              />
            )}
            {current.id === "summary" && (
              <SummaryStep state={state} selectedModules={selectedModules} />
            )}
          </div>

          <Button size="lg" className="mt-4 w-full" onClick={advance}>
            {isLast ? "Install Playerbots server" : "Next"}
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

function ServerTypeStep({
  value,
  onChange,
}: {
  value: ServerType
  onChange: (value: ServerType) => void
}) {
  const options: {
    key: ServerType
    title: string
    blurb: string
    badge: { text: string; variant: "default" | "secondary" | "outline" }
    disabled?: boolean
  }[] = [
    {
      key: "playerbots",
      title: "Playerbots",
      blurb: "Hundreds of AI players roaming the world — quest, dungeon, raid, chat. The most alive solo experience. Compiles from source (2–4 hours).",
      badge: { text: "Recommended", variant: "secondary" },
    },
    {
      key: "npcbots",
      title: "NPCBots",
      blurb: "Hire AI companions to join your party. Faster install but smaller world.",
      badge: { text: "Deprecated", variant: "outline" },
      disabled: true,
    },
    {
      key: "base",
      title: "Base AzerothCore",
      blurb: "Clean server with no bots. Lightest on resources.",
      badge: { text: "Deprecated", variant: "outline" },
      disabled: true,
    },
  ]

  return (
    <RadioGroup
      value={value}
      onValueChange={(v) => onChange(v as ServerType)}
      className="gap-3"
    >
      {options.map((opt) => (
        <Label
          key={opt.key}
          htmlFor={`server-${opt.key}`}
          className={cn(
            "flex cursor-pointer items-start gap-3 rounded-lg border border-border p-4 transition-colors",
            opt.disabled
              ? "cursor-not-allowed opacity-50"
              : "hover:bg-accent has-data-[state=checked]:border-primary has-data-[state=checked]:bg-accent"
          )}
        >
          <RadioGroupItem
            id={`server-${opt.key}`}
            value={opt.key}
            disabled={opt.disabled}
            className="mt-0.5"
          />
          <div className="flex-1 space-y-1">
            <div className="flex items-center gap-2">
              <span className="font-medium text-foreground">{opt.title}</span>
              <Badge variant={opt.badge.variant} className="text-[10px] font-normal">
                {opt.badge.text}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">{opt.blurb}</p>
          </div>
        </Label>
      ))}
    </RadioGroup>
  )
}

function ModulesStep({
  value,
  onChange,
}: {
  value: Record<ModuleKey, boolean>
  onChange: (value: Record<ModuleKey, boolean>) => void
}) {
  return (
    <div className="space-y-2">
      {MODULES.map((m) => (
        <Label
          key={m.key}
          htmlFor={`mod-${m.key}`}
          className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 transition-colors hover:bg-accent has-data-[state=checked]:border-primary/60 has-data-[state=checked]:bg-accent/50"
        >
          <Checkbox
            id={`mod-${m.key}`}
            checked={value[m.key]}
            onCheckedChange={(checked) =>
              onChange({ ...value, [m.key]: checked === true })
            }
            className="mt-0.5"
          />
          <m.Icon className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
          <div className="flex-1 space-y-0.5">
            <div className="text-sm font-medium text-foreground">{m.label}</div>
            <p className="text-xs text-muted-foreground">{m.blurb}</p>
          </div>
        </Label>
      ))}
    </div>
  )
}

function AdminStep({
  user,
  pass,
  onChange,
}: {
  user: string
  pass: string
  onChange: (user: string, pass: string) => void
}) {
  const [useDefaults, setUseDefaults] = React.useState(true)
  const [showPassword, setShowPassword] = React.useState(true)

  const handleDefaultsToggle = (checked: boolean) => {
    setUseDefaults(checked)
    if (checked) onChange("admin", "admin")
  }

  return (
    <div className="space-y-4">
      <Label
        htmlFor="use-defaults"
        className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-border bg-muted/30 p-3"
      >
        <Checkbox
          id="use-defaults"
          checked={useDefaults}
          onCheckedChange={(checked) => handleDefaultsToggle(checked === true)}
        />
        <span className="text-sm">
          Use default credentials
        </span>
      </Label>

      <div className="space-y-1.5">
        <Label htmlFor="admin-user">Username</Label>
        <Input
          id="admin-user"
          value={user}
          onChange={(e) => onChange(e.target.value, pass)}
          disabled={useDefaults}
          autoComplete="off"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="admin-pass">Password</Label>
        <div className="relative">
          <Input
            id="admin-pass"
            type={showPassword ? "text" : "password"}
            value={pass}
            onChange={(e) => onChange(user, e.target.value)}
            disabled={useDefaults}
            autoComplete="new-password"
            className="pr-8"
          />
          <button
            type="button"
            tabIndex={-1}
            onClick={() => setShowPassword((s) => !s)}
            disabled={useDefaults}
            aria-label={showPassword ? "Hide password" : "Show password"}
            className="absolute top-1/2 right-2 -translate-y-1/2 text-primary transition-colors hover:text-primary/80 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {showPassword ? (
              <EyeSlashIcon className="size-4" />
            ) : (
              <EyeIcon className="size-4" />
            )}
          </button>
        </div>
        <p className="text-xs text-muted-foreground">
          WoW account names are case-sensitive and stored locally on your device.
        </p>
      </div>
    </div>
  )
}

function AhBotConfigStep({
  value,
  onChange,
}: {
  value: AhBotConfig
  onChange: (next: AhBotConfig) => void
}) {
  // 0 = long, 1 = medium, 2 = short per AC enum. UI presents the
  // human-readable order short -> medium -> long which is more natural.
  const durationOptions: { val: 0 | 1 | 2; label: string; blurb: string }[] = [
    { val: 2, label: "Short", blurb: "10-60 min" },
    { val: 1, label: "Medium", blurb: "1-24 hours (default)" },
    { val: 0, label: "Long", blurb: "1-3 days" },
  ]

  return (
    <div className="space-y-5">
      <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs text-emerald-700 dark:text-emerald-400">
        The AH Bot character is set up for you automatically — no extra
        steps once the install finishes.
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="ahbot-items-per-cycle">Auctions per cycle</Label>
        <Input
          id="ahbot-items-per-cycle"
          type="number"
          min={50}
          max={2000}
          step={10}
          value={value.itemsPerCycle}
          onChange={(e) => {
            const n = Number(e.target.value)
            if (Number.isFinite(n)) onChange({ ...value, itemsPerCycle: n })
          }}
        />
        <p className="text-xs text-muted-foreground">
          How many items the bot lists per cycle. Higher = busier AH, more CPU.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label>Auction duration</Label>
        <RadioGroup
          value={String(value.elapsingTimeClass)}
          onValueChange={(v) =>
            onChange({
              ...value,
              elapsingTimeClass: Number(v) as 0 | 1 | 2,
            })
          }
          className="gap-2"
        >
          {durationOptions.map((opt) => (
            <Label
              key={opt.val}
              htmlFor={`ahbot-duration-${opt.val}`}
              className="flex cursor-pointer items-center gap-3 rounded-lg border border-border p-3 transition-colors hover:bg-accent has-data-[state=checked]:border-primary has-data-[state=checked]:bg-accent"
            >
              <RadioGroupItem
                id={`ahbot-duration-${opt.val}`}
                value={String(opt.val)}
              />
              <div className="flex-1">
                <div className="text-sm font-medium text-foreground">
                  {opt.label}
                </div>
                <div className="text-xs text-muted-foreground">{opt.blurb}</div>
              </div>
            </Label>
          ))}
        </RadioGroup>
      </div>

      <ToggleRow
        id="ahbot-buyer"
        label="Bot also buys from players"
        blurb="The bot bids on player listings, giving you reliable buyers for whatever you list."
        checked={value.enableBuyer}
        onChange={(v) => onChange({ ...value, enableBuyer: v })}
      />
      <ToggleRow
        id="ahbot-profession"
        label="Include profession materials"
        blurb="Herbs, ores, leather, etc. Recommended for offline play — nobody else is gathering them for the AH."
        checked={value.professionItems}
        onChange={(v) => onChange({ ...value, professionItems: v })}
      />
      <ToggleRow
        id="ahbot-vendor"
        label="Include vendor-purchasable items"
        blurb="Adds vendor goods to the AH (more variety, less authentic)."
        checked={value.vendorItems}
        onChange={(v) => onChange({ ...value, vendorItems: v })}
      />
    </div>
  )
}

function IpConfigStep({
  value,
  onChange,
}: {
  value: IpConfig
  onChange: (next: IpConfig) => void
}) {
  return (
    <div className="space-y-5">
      <div className="rounded-md border border-blue-500/30 bg-blue-500/5 p-3 text-xs text-blue-700 dark:text-blue-400">
        This module changes WoW fundamentally — each character starts in
        Vanilla and must clear raids to unlock TBC, then WotLK. The journey,
        not the destination.
      </div>

      <ToggleRow
        id="ip-authentic"
        label="Authentic difficulty"
        blurb="Reduces player power and healing to 60% in Vanilla and TBC. Recommended for solo play with Playerbots."
        checked={value.authenticDifficulty}
        onChange={(v) => onChange({ ...value, authenticDifficulty: v })}
      />
      <ToggleRow
        id="ip-disable-rdf"
        label="Lock Random Dungeon Finder until WotLK"
        blurb="Forces forming groups manually until late-game."
        checked={value.disableRdf}
        onChange={(v) => onChange({ ...value, disableRdf: v })}
      />
      <ToggleRow
        id="ip-dk-tbc"
        label="Death Knights require completing TBC first"
        blurb="Module default — DKs only unlock after the character clears TBC content. Disable to make DKs available from level 1."
        checked={value.dkRequiresTbc}
        onChange={(v) => onChange({ ...value, dkRequiresTbc: v })}
      />
    </div>
  )
}

function ToggleRow({
  id,
  label,
  blurb,
  checked,
  onChange,
}: {
  id: string
  label: string
  blurb: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <Label
      htmlFor={id}
      className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 transition-colors hover:bg-accent has-data-[state=checked]:border-primary/60 has-data-[state=checked]:bg-accent/50"
    >
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(v) => onChange(v === true)}
        className="mt-0.5"
      />
      <div className="flex-1 space-y-0.5">
        <div className="text-sm font-medium text-foreground">{label}</div>
        <p className="text-xs text-muted-foreground">{blurb}</p>
      </div>
    </Label>
  )
}

function SummaryStep({
  state,
  selectedModules,
}: {
  state: FormState
  selectedModules: { key: ModuleKey; label: string }[]
}) {
  // Pull the configured-knob summary string per module, when relevant.
  // Modules without onboarding config return null and just render as a
  // plain badge.
  const moduleConfigSummary = (key: ModuleKey): string | null => {
    if (key === "mod-ah-bot") {
      const durationLabel =
        state.ahbot.elapsingTimeClass === 2
          ? "short"
          : state.ahbot.elapsingTimeClass === 0
            ? "long"
            : "medium"
      const extras = [
        state.ahbot.enableBuyer ? "buyer on" : null,
        state.ahbot.vendorItems ? "vendor items" : null,
        state.ahbot.professionItems ? "profession items" : null,
      ].filter(Boolean) as string[]
      const extrasStr = extras.length > 0 ? ` · ${extras.join(", ")}` : ""
      return `${state.ahbot.itemsPerCycle}/cycle · ${durationLabel} duration${extrasStr}`
    }
    if (key === "mod-individual-progression") {
      const bits = [
        state.ip.authenticDifficulty ? "authentic difficulty" : null,
        state.ip.disableRdf ? "no RDF until WotLK" : null,
        state.ip.dkRequiresTbc ? "DKs gated by TBC" : "DKs available at start",
      ].filter(Boolean) as string[]
      return bits.join(" · ")
    }
    return null
  }

  return (
    <div className="space-y-4">
      <SummaryRow label="Server">Playerbots</SummaryRow>
      <SummaryRow label="Admin account">
        <span className="font-mono">{state.adminUser}</span>
        <span className="text-muted-foreground"> · </span>
        <span className="font-mono">{"•".repeat(Math.max(state.adminPass.length, 4))}</span>
      </SummaryRow>
      <SummaryRow label="Modules">
        {selectedModules.length === 0 ? (
          <span className="text-muted-foreground">None</span>
        ) : (
          <div className="space-y-1.5">
            {selectedModules.map((m) => {
              const summary = moduleConfigSummary(m.key)
              return (
                <div key={m.key} className="flex flex-col gap-0.5">
                  <Badge variant="secondary" className="w-fit font-normal">
                    {m.label}
                  </Badge>
                  {summary && (
                    <span className="pl-1 text-[11px] text-muted-foreground">
                      {summary}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </SummaryRow>
      <SummaryRow label="Install location">
        <span className="font-mono text-xs">~/wow-server-playerbots</span>
      </SummaryRow>
      <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-400">
        Playerbots compiles AzerothCore from source. Expect 2–4 hours on a Steam Deck.
        Modules are compiled into the same build — no extra time. Keep your
        device plugged in and don't let it sleep.
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
