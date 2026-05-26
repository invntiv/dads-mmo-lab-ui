import * as React from "react"
import {
  ArrowLeftIcon,
  CheckCircleIcon,
  ShieldIcon,
  SwordIcon,
  HeartIcon,
  UserPlusIcon,
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
import {
  ALL_ROLES,
  type Role,
  type SpecEntry,
  type TalentBuild,
  formatSpecName,
  getBuildAtLevel,
  getBuildLevels,
  getClassesForRole,
  getSpecsForClassRole,
  snapToBuildLevel,
} from "@/lib/talent-builds"
import {
  CLASS_COLOR_HEX,
  CLASS_COLORS,
  CLASS_ICON_NAMES,
  CLASS_NAMES,
} from "@/lib/wow-character-enums"
import { cn } from "@/lib/utils"

/**
 * Add-to-Party wizard (Phase 2d).
 *
 * Four-step flow: Role → Class → Spec → Level. Each step is gated on
 * the previous selection; the user can step back. The final step
 * surfaces the chosen build's tree distribution + wowhead link, then
 * the "Add to Party" CTA fires `onConfirm` with the resolved selection.
 *
 * No backend wiring lives here — the wizard is purely a picker. Phase
 * 2e will provide the `add_bot_to_party` Tauri command that consumes
 * the selection (pick AddClass bot → level → talents spec → autogear
 * → maintenance → summon → .group join, all via Eluna whispers + SOAP).
 *
 * Level snapping: the user's character level is fed in as a hint so
 * the wizard defaults to the highest build level ≤ character level
 * (a Lv 73 character lands on the Lv 70 build by default).
 */

type Step = "role" | "class" | "spec" | "level"

/** Lower / upper bounds for the bot-level input. mod-playerbots allows
 *  1..80 broadly; class-specific constraints (e.g. DK starts at 55)
 *  surface at spawn time rather than being enforced here. */
const MIN_BOT_LEVEL = 1
const MAX_BOT_LEVEL = 80

/** Talent points unlock at Lv 10, one per level. Used to surface the
 *  partial-application warning when a chosen build commits more
 *  points than the bot will have at its target level. */
function pointsAtLevel(level: number): number {
  return Math.max(0, level - 9)
}

export interface AddToPartySelection {
  role: Role
  classId: number
  spec: SpecEntry
  /** Chosen talent template — its level identifies the build, but the
   *  bot's actual level comes from `targetLevel`. */
  build: TalentBuild
  /** Bot's spawn level — independent of the build's intended level.
   *  mod-playerbots fills the template in order, stopping when it
   *  runs out of talent points; remaining points fill on level-up. */
  targetLevel: number
}

interface AddToPartyWizardProps {
  open: boolean
  onOpenChange: (next: boolean) => void
  /** User's character level — used to default the Level step. */
  characterLevel?: number
  onConfirm?: (selection: AddToPartySelection) => void
}

export function AddToPartyWizard({
  open,
  onOpenChange,
  characterLevel,
  onConfirm,
}: AddToPartyWizardProps) {
  const [step, setStep] = React.useState<Step>("role")
  const [role, setRole] = React.useState<Role | null>(null)
  const [classId, setClassId] = React.useState<number | null>(null)
  const [spec, setSpec] = React.useState<SpecEntry | null>(null)
  // Two distinct concerns: WHICH talent template (one of the mod's
  // PremadeSpecLink levels — usually 60/65/70/80) and at WHAT level
  // the bot spawns (free 1..80, defaults to the user's own level).
  const [buildLevel, setBuildLevel] = React.useState<number | null>(null)
  const [targetLevel, setTargetLevel] = React.useState<number | null>(null)

  // Reset everything when the dialog closes. The next open starts at
  // role-pick; we don't try to persist mid-flow state across opens.
  React.useEffect(() => {
    if (!open) {
      setStep("role")
      setRole(null)
      setClassId(null)
      setSpec(null)
      setBuildLevel(null)
      setTargetLevel(null)
    }
  }, [open])

  const handlePickRole = (r: Role) => {
    setRole(r)
    setClassId(null)
    setSpec(null)
    setBuildLevel(null)
    setTargetLevel(null)
    setStep("class")
  }
  const handlePickClass = (cid: number) => {
    setClassId(cid)
    setSpec(null)
    setBuildLevel(null)
    setTargetLevel(null)
    setStep("spec")
  }
  const handlePickSpec = (s: SpecEntry) => {
    setSpec(s)
    // Default the build to the snap-down match for the user's level
    // (Lv 50 → Lv 60 build since most specs only have 60+ entries).
    // Default the spawn level to the user's own level so a Lv 50
    // player gets a Lv 50 companion by default.
    const charLevel = characterLevel ?? 80
    setBuildLevel(snapToBuildLevel(s, charLevel))
    setTargetLevel(clampLevel(charLevel))
    setStep("level")
  }

  const handleBack = () => {
    if (step === "class") setStep("role")
    else if (step === "spec") setStep("class")
    else if (step === "level") setStep("spec")
  }

  const handleConfirm = () => {
    if (!role || classId === null || !spec || buildLevel === null || targetLevel === null) {
      return
    }
    const build = getBuildAtLevel(spec, buildLevel)
    if (!build) return
    onConfirm?.({ role, classId, spec, build, targetLevel })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlusIcon className="size-5 text-primary" />
            Add to Party
          </DialogTitle>
          <DialogDescription>
            <StepCrumbs
              step={step}
              role={role}
              classId={classId}
              spec={spec}
              buildLevel={buildLevel}
              targetLevel={targetLevel}
            />
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-[280px]">
          {step === "role" && <RoleStep onPick={handlePickRole} />}
          {step === "class" && role && (
            <ClassStep role={role} onPick={handlePickClass} />
          )}
          {step === "spec" && role && classId !== null && (
            <SpecStep
              classId={classId}
              role={role}
              onPick={handlePickSpec}
            />
          )}
          {step === "level" && spec && (
            <LevelStep
              spec={spec}
              buildLevel={buildLevel}
              targetLevel={targetLevel}
              onPickBuildLevel={setBuildLevel}
              onPickTargetLevel={setTargetLevel}
              characterLevel={characterLevel}
            />
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          {step !== "role" && (
            <Button variant="outline" onClick={handleBack}>
              <ArrowLeftIcon className="size-4" />
              Back
            </Button>
          )}
          {step === "level" && (
            <Button
              onClick={handleConfirm}
              disabled={buildLevel === null || targetLevel === null}
              className="ml-auto"
            >
              <CheckCircleIcon className="size-4" weight="fill" />
              Add to Party
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ───────────────────────────────────────────────────────────────────
// Step 1 — Role
// ───────────────────────────────────────────────────────────────────

const ROLE_META: Record<
  Role,
  { icon: React.ReactNode; tagline: string; accent: string }
> = {
  Tank: {
    icon: <ShieldIcon className="size-7" weight="fill" />,
    tagline: "Soaks damage, holds threat",
    accent: "text-blue-400",
  },
  Healer: {
    icon: <HeartIcon className="size-7" weight="fill" />,
    tagline: "Keeps the party alive",
    accent: "text-emerald-400",
  },
  DPS: {
    icon: <SwordIcon className="size-7" weight="fill" />,
    tagline: "Deals damage",
    accent: "text-rose-400",
  },
}

function RoleStep({ onPick }: { onPick: (r: Role) => void }) {
  return (
    <div className="space-y-2">
      {ALL_ROLES.map((r) => {
        const meta = ROLE_META[r]
        return (
          <button
            key={r}
            type="button"
            onClick={() => onPick(r)}
            className="flex w-full items-center gap-3 rounded-md border border-border bg-card p-3 text-left transition-colors hover:border-primary/60 hover:bg-primary/5 focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
          >
            <span className={cn("shrink-0", meta.accent)}>{meta.icon}</span>
            <div className="flex-1">
              <div className="text-base font-semibold">{r}</div>
              <div className="text-xs text-muted-foreground">
                {meta.tagline}
              </div>
            </div>
          </button>
        )
      })}
    </div>
  )
}

// ───────────────────────────────────────────────────────────────────
// Step 2 — Class
// ───────────────────────────────────────────────────────────────────

function ClassStep({
  role,
  onPick,
}: {
  role: Role
  onPick: (classId: number) => void
}) {
  const classes = React.useMemo(() => getClassesForRole(role), [role])
  return (
    <div className="grid grid-cols-3 gap-2">
      {classes.map((cid) => {
        const name = CLASS_NAMES[cid] ?? `#${cid}`
        const color = CLASS_COLORS[cid] ?? "text-foreground"
        const ring = CLASS_COLOR_HEX[cid] ?? "#888"
        const iconName = CLASS_ICON_NAMES[cid]
        return (
          <button
            key={cid}
            type="button"
            onClick={() => onPick(cid)}
            className="flex flex-col items-center gap-1.5 rounded-md border border-border bg-card p-2 transition-colors hover:border-primary/60 hover:bg-primary/5 focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
          >
            <div
              className="flex size-12 items-center justify-center overflow-hidden rounded border-2 bg-muted"
              style={{ borderColor: ring }}
            >
              {iconName && (
                <img
                  src={`https://wow.zamimg.com/images/wow/icons/large/${iconName}.jpg`}
                  alt={name}
                  className="size-full object-cover"
                  draggable={false}
                />
              )}
            </div>
            <span className={cn("text-xs font-medium", color)}>{name}</span>
          </button>
        )
      })}
    </div>
  )
}

// ───────────────────────────────────────────────────────────────────
// Step 3 — Spec
// ───────────────────────────────────────────────────────────────────

function SpecStep({
  classId,
  role,
  onPick,
}: {
  classId: number
  role: Role
  onPick: (spec: SpecEntry) => void
}) {
  const specs = React.useMemo(
    () => getSpecsForClassRole(classId, role),
    [classId, role]
  )
  if (specs.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
        No matching specs in the dataset for this class + role.
      </div>
    )
  }
  return (
    <div className="space-y-1.5">
      {specs.map((s) => {
        const levels = getBuildLevels(s)
        return (
          <button
            key={s.specIndex}
            type="button"
            onClick={() => onPick(s)}
            className="flex w-full items-center justify-between gap-3 rounded-md border border-border bg-card px-3 py-2 text-left transition-colors hover:border-primary/60 hover:bg-primary/5 focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
          >
            <span className="text-sm font-medium">
              {formatSpecName(s.specName)}
            </span>
            <span className="text-[10px] text-muted-foreground">
              Lv {levels.join(" · ")}
            </span>
          </button>
        )
      })}
    </div>
  )
}

// ───────────────────────────────────────────────────────────────────
// Step 4 — Build + Level
// ───────────────────────────────────────────────────────────────────
//
// Two controls share this step:
//   1. Build template — which of the mod's PremadeSpecLink entries
//      (usually Lv 60 and Lv 80, sometimes 65/70) defines the talent
//      allocation order
//   2. Bot level — free 1..80 with a number input; defaults to the
//      user's own level so a Lv 50 player gets a Lv 50 companion
//
// mod-playerbots applies the chosen template by walking each talent
// in row-major order, spending points until the bot's pool is empty
// (Lv N → max(0, N-9) points). A Lv 80 template applied to a Lv 50
// bot fills the first 41 points of the template; remaining levels
// auto-fill with AutoPickTalents=1 on the worldserver.

function LevelStep({
  spec,
  buildLevel,
  targetLevel,
  onPickBuildLevel,
  onPickTargetLevel,
  characterLevel,
}: {
  spec: SpecEntry
  buildLevel: number | null
  targetLevel: number | null
  onPickBuildLevel: (lvl: number) => void
  onPickTargetLevel: (lvl: number) => void
  characterLevel?: number
}) {
  const buildLevels = React.useMemo(() => getBuildLevels(spec), [spec])
  const build =
    buildLevel !== null ? getBuildAtLevel(spec, buildLevel) : null
  const botPoints = targetLevel !== null ? pointsAtLevel(targetLevel) : 0
  const buildPoints = build?.totalPoints ?? 0
  const underAllocated = build !== null && botPoints < buildPoints
  const appliedPoints = Math.min(botPoints, buildPoints)

  // Recommend a higher build when the bot's talent pool overshoots
  // the chosen template — picking a higher build keeps more talent
  // assignments on a curated template instead of falling back to
  // mod-playerbots' AutoPickTalents fill. We pick the HIGHEST
  // available higher build so the bot levels toward the most
  // comprehensive premade trajectory (the user's stated preference:
  // "the bot will level into the 80 build").
  const recommendedHigher = React.useMemo(() => {
    if (buildLevel === null) return null
    const higher = buildLevels.filter((b) => b > buildLevel)
    if (higher.length === 0) return null
    if (botPoints <= buildPoints) return null // current build already fits
    return Math.max(...higher)
  }, [buildLevels, buildLevel, botPoints, buildPoints])

  return (
    <div className="space-y-4">
      {/* Build template picker */}
      <div>
        <div className="mb-1.5 text-xs uppercase tracking-wide text-muted-foreground">
          Talent build
        </div>
        <div className="flex flex-wrap gap-1.5">
          {buildLevels.map((lvl) => (
            <button
              key={lvl}
              type="button"
              onClick={() => onPickBuildLevel(lvl)}
              className={cn(
                "rounded-md border px-3 py-1.5 text-sm font-medium transition-colors",
                buildLevel === lvl
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card hover:border-primary/60 hover:bg-primary/5"
              )}
            >
              Lv {lvl} build
            </button>
          ))}
        </div>
        {build && (
          <div className="mt-2 rounded-md border border-border bg-muted/30 p-3 text-xs">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="font-semibold text-foreground">
                {formatSpecName(spec.specName)}
              </span>
              <span className="text-muted-foreground">
                {build.treeDistribution.join(" / ")} ({build.totalPoints} pts)
              </span>
            </div>
            <div className="break-all font-mono text-[10px] text-muted-foreground">
              {build.wowheadLink}
            </div>
          </div>
        )}
      </div>

      {/* Bot level input — independent of the build's intended level */}
      <div>
        <div className="mb-1.5 text-xs uppercase tracking-wide text-muted-foreground">
          Bot level
          {characterLevel !== undefined && (
            <span className="ml-1.5 normal-case tracking-normal">
              · defaults to your Lv {characterLevel}
            </span>
          )}
        </div>
        <LevelStepper
          value={targetLevel ?? characterLevel ?? 80}
          onChange={onPickTargetLevel}
        />
        {build && targetLevel !== null && (
          <div
            className={cn(
              "mt-2 rounded-md border p-2.5 text-xs",
              recommendedHigher !== null
                ? "border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-400"
                : "border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400"
            )}
          >
            {recommendedHigher !== null ? (
              <>
                A higher level build exists for this configuration. Select
                the{" "}
                <button
                  type="button"
                  onClick={() => onPickBuildLevel(recommendedHigher)}
                  className="font-semibold underline underline-offset-2 hover:no-underline"
                >
                  Lv {recommendedHigher} build
                </button>{" "}
                above so the bot levels into that template — otherwise the
                Lv {build.level} build runs out of room at {buildPoints} of
                the {botPoints} talent points available at Lv {targetLevel},
                and the remaining {botPoints - buildPoints} auto-pick.
              </>
            ) : underAllocated ? (
              // mod-playerbots places template talents at fixed
              // (row, col, rank) per the conf — it is NOT random.
              // For party-recruited "alt" bots, level-ups don't
              // auto-trigger the apply; the Lab whispers `maintenance`
              // on level-up to keep the template in sync.
              <>
                At Lv {targetLevel} the bot has {botPoints} talent point
                {botPoints === 1 ? "" : "s"}; this Lv {build.level} build
                commits {buildPoints}. The mod places {appliedPoints}/
                {buildPoints} in template order now — as the bot levels,
                the Lab issues `maintenance` whispers so remaining
                template entries fill in the same order.
              </>
            ) : (
              <>
                Bot has {botPoints} talent points at Lv {targetLevel}; the
                Lv {build.level} build commits {buildPoints}. Full build
                applies.
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/** Number input with +/- buttons and direct edit, clamped to
 *  MIN_BOT_LEVEL..MAX_BOT_LEVEL. */
function LevelStepper({
  value,
  onChange,
}: {
  value: number
  onChange: (next: number) => void
}) {
  const dec = () => onChange(clampLevel(value - 1))
  const inc = () => onChange(clampLevel(value + 1))
  return (
    <div className="flex items-stretch gap-1.5">
      <button
        type="button"
        onClick={dec}
        disabled={value <= MIN_BOT_LEVEL}
        className="flex size-9 items-center justify-center rounded-md border border-border bg-card text-base font-semibold transition-colors hover:border-primary/60 hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-40"
        aria-label="Decrease level"
      >
        −
      </button>
      <input
        type="number"
        inputMode="numeric"
        min={MIN_BOT_LEVEL}
        max={MAX_BOT_LEVEL}
        value={value}
        onChange={(e) => {
          const n = Number(e.target.value)
          if (Number.isFinite(n)) onChange(clampLevel(Math.round(n)))
        }}
        // Hide the native spinner arrows — we ship custom +/- buttons.
        // Scoped via arbitrary-selector utilities so other number
        // inputs in the app keep their default UI.
        className="w-16 rounded-md border border-border bg-card text-center text-base font-semibold tabular-nums focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:m-0 [&::-webkit-outer-spin-button]:appearance-none"
      />
      <button
        type="button"
        onClick={inc}
        disabled={value >= MAX_BOT_LEVEL}
        className="flex size-9 items-center justify-center rounded-md border border-border bg-card text-base font-semibold transition-colors hover:border-primary/60 hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-40"
        aria-label="Increase level"
      >
        +
      </button>
    </div>
  )
}

function clampLevel(n: number): number {
  if (n < MIN_BOT_LEVEL) return MIN_BOT_LEVEL
  if (n > MAX_BOT_LEVEL) return MAX_BOT_LEVEL
  return n
}

// ───────────────────────────────────────────────────────────────────
// Stepper crumbs (shown below dialog title)
// ───────────────────────────────────────────────────────────────────

function StepCrumbs({
  step,
  role,
  classId,
  spec,
  buildLevel,
  targetLevel,
}: {
  step: Step
  role: Role | null
  classId: number | null
  spec: SpecEntry | null
  buildLevel: number | null
  targetLevel: number | null
}) {
  // Final crumb collapses the two related numbers into one chip so
  // the breadcrumb stays a single line on a narrow dialog.
  const levelLabel =
    buildLevel !== null && targetLevel !== null
      ? `Lv ${targetLevel} · Lv ${buildLevel} build`
      : "Build + Level"
  const crumbs: { label: string; active: boolean; placeholder: string }[] = [
    {
      label: role ?? "Role",
      active: step === "role",
      placeholder: "Role",
    },
    {
      label: classId !== null ? CLASS_NAMES[classId] ?? `#${classId}` : "Class",
      active: step === "class",
      placeholder: "Class",
    },
    {
      label: spec ? formatSpecName(spec.specName) : "Spec",
      active: step === "spec",
      placeholder: "Spec",
    },
    {
      label: levelLabel,
      active: step === "level",
      placeholder: "Build + Level",
    },
  ]
  return (
    <span className="flex flex-wrap items-center gap-1 text-xs">
      {crumbs.map((c, i) => (
        <React.Fragment key={c.placeholder}>
          {i > 0 && <span className="text-muted-foreground/50">›</span>}
          <span
            className={cn(
              c.active
                ? "font-semibold text-foreground"
                : c.label === c.placeholder
                  ? "text-muted-foreground/60"
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
