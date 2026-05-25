import * as React from "react"
import {
  ArrowClockwiseIcon,
  CheckCircleIcon,
  PackageIcon,
  PuzzlePieceIcon,
  UserIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react"

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { AhBotWizard } from "@/components/ahbot-wizard"
import {
  useServerState,
  type InstalledModule,
} from "@/components/server-state-context"
import { cn } from "@/lib/utils"

/**
 * Modules management page. v1 scope:
 * - List installed modules in collapsible accordion sections.
 * - For each module: status indicator + current config key/value table.
 * - AH Bot gets a "Configure character" call-to-action when its
 *   placeholder config from install (Account=0/GUID=0/EnableSeller=0)
 *   hasn't been replaced yet.
 *
 * Out of scope for v1 (will land in later iterations):
 * - Adding / removing modules from this page (requires rebuild flow).
 * - Editing arbitrary conf knobs in place (requires per-knob forms +
 *   restart on save).
 */
/**
 * Embedded modules content — the accordion + AH Bot needs-config
 * alert + wizard, *without* the page-level header/refresh chrome.
 * Used as a section inside the Settings page. The standalone
 * ModulesScreen wraps this with the page chrome for backwards
 * compatibility (we no longer route to it directly, but the
 * component is kept so external callers don't break).
 */
export function ModulesEmbedded() {
  const { installedModules, ahbotNeedsConfig } = useServerState()
  const [wizardOpen, setWizardOpen] = React.useState(false)

  // Sort: AH Bot first if it needs config, then by display name. Keeps
  // the user's eye on the call-to-action.
  const sorted = React.useMemo(() => {
    const copy = [...installedModules]
    copy.sort((a, b) => {
      if (a.key === "mod-ah-bot" && ahbotNeedsConfig) return -1
      if (b.key === "mod-ah-bot" && ahbotNeedsConfig) return 1
      return a.name.localeCompare(b.name)
    })
    return copy
  }, [installedModules, ahbotNeedsConfig])

  return (
    <>
      {ahbotNeedsConfig && (
        <Alert className="mb-4 border-amber-500/40 bg-amber-500/10 text-amber-700 [&_svg]:text-amber-600 dark:text-amber-400 dark:[&_svg]:text-amber-400">
          <WarningCircleIcon />
          <AlertTitle className="font-semibold">
            Auction House Bot needs a character
          </AlertTitle>
          <AlertDescription className="text-amber-700/90 dark:text-amber-300/90">
            The AH Bot module is installed but inactive. Open the wizard
            below to pick the character it should use as the seller.
            <div className="mt-2">
              <Button
                size="sm"
                onClick={() => setWizardOpen(true)}
                className="bg-amber-600 text-white hover:bg-amber-600/90"
              >
                <UserIcon className="size-4" />
                Configure character
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {sorted.length === 0 ? (
        <EmptyState />
      ) : (
        <Accordion
          type="multiple"
          // Default open: AH Bot (if it needs config) so the user
          // immediately sees the call-to-action context.
          defaultValue={ahbotNeedsConfig ? ["mod-ah-bot"] : []}
          className="space-y-2"
        >
          {sorted.map((m) => (
            <ModuleSection
              key={m.key}
              module={m}
              ahbotNeedsConfig={ahbotNeedsConfig}
              onOpenAhbotWizard={() => setWizardOpen(true)}
            />
          ))}
        </Accordion>
      )}

      <AhBotWizard open={wizardOpen} onOpenChange={setWizardOpen} />
    </>
  )
}

export function ModulesScreen() {
  const { refreshInstalledModules } = useServerState()
  const [refreshing, setRefreshing] = React.useState(false)

  const doRefresh = async () => {
    setRefreshing(true)
    try {
      await refreshInstalledModules()
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <div className="grid h-full grid-rows-[auto_minmax(0,1fr)] gap-4 p-6">
      <header className="flex items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="flex items-center gap-2 font-heading text-2xl font-semibold leading-tight">
            <PuzzlePieceIcon className="size-6 shrink-0 text-muted-foreground" />
            Modules
          </h1>
          <p className="text-sm text-muted-foreground">
            Per-module configuration for your AzerothCore server. Settings
            apply on the next worldserver restart.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={doRefresh}
          disabled={refreshing}
        >
          <ArrowClockwiseIcon
            className={cn("size-4", refreshing && "animate-spin")}
          />
          Refresh
        </Button>
      </header>

      <div className="min-h-0 overflow-y-auto pr-1 pb-3">
        <ModulesEmbedded />
      </div>
    </div>
  )
}

function ModuleSection({
  module,
  ahbotNeedsConfig,
  onOpenAhbotWizard,
}: {
  module: InstalledModule
  ahbotNeedsConfig: boolean
  onOpenAhbotWizard: () => void
}) {
  const isAhbot = module.key === "mod-ah-bot"
  const needsAction = isAhbot && ahbotNeedsConfig

  // Surface the most-useful conf entries first per module. Keys we
  // don't have a curated order for fall through alphabetically. This is
  // PURELY display ordering — we still show every key in the conf.
  const curatedOrder = curatedKeysFor(module.key)
  const entries = React.useMemo(() => sortConfEntries(module.conf, curatedOrder), [
    module.conf,
    curatedOrder,
  ])

  return (
    <AccordionItem
      value={module.key}
      className="rounded-md border border-border bg-card data-[state=open]:border-primary/30"
    >
      <AccordionTrigger className="px-4 py-3 hover:no-underline">
        <div className="flex flex-1 items-center gap-3 text-left">
          <PuzzlePieceIcon className="size-5 text-muted-foreground" />
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="font-medium">{module.name}</span>
              <ModuleStatusBadge module={module} needsAction={needsAction} />
            </div>
            <div className="text-xs text-muted-foreground font-mono">
              {module.key}
            </div>
          </div>
        </div>
      </AccordionTrigger>
      <AccordionContent className="px-4 pb-4">
        {needsAction && (
          <div className="mb-3 flex items-start gap-3 rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
            <UserIcon className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <div className="flex-1 text-xs text-amber-700 dark:text-amber-300">
              <strong>Inactive until a character is configured.</strong>{" "}
              The bot needs an in-game character to act as the seller.
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={onOpenAhbotWizard}
              className="border-amber-500/40 text-amber-700 hover:bg-amber-500/10 dark:text-amber-400"
            >
              Configure
            </Button>
          </div>
        )}

        <ConfPath path={module.conf_path} />

        {entries.length === 0 ? (
          <div className="text-xs text-muted-foreground">
            No config file detected for this module yet. The worldserver
            generates it on first start; click Refresh after the server
            is running once.
          </div>
        ) : (
          <ConfTable entries={entries} />
        )}
      </AccordionContent>
    </AccordionItem>
  )
}

function ConfPath({ path }: { path: string | null }) {
  if (!path) return null
  return (
    <div className="mb-2 text-xs text-muted-foreground">
      <span className="font-medium text-foreground/80">Conf:</span>{" "}
      <span className="font-mono">{path}</span>
    </div>
  )
}

function ConfTable({ entries }: { entries: [string, string][] }) {
  return (
    <div className="rounded-md border border-border/60">
      <div className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-0.5 px-3 py-2 font-mono text-[12px] leading-relaxed">
        {entries.map(([k, v], i) => (
          <React.Fragment key={k + i}>
            <span className="break-all text-muted-foreground">{k}</span>
            <span className="text-right break-all text-foreground">{v}</span>
          </React.Fragment>
        ))}
      </div>
    </div>
  )
}

function ModuleStatusBadge({
  module,
  needsAction,
}: {
  module: InstalledModule
  needsAction: boolean
}) {
  if (needsAction) {
    return (
      <Badge variant="outline" className="border-amber-500/40 text-amber-700 dark:text-amber-400">
        Inactive
      </Badge>
    )
  }
  if (module.conf_path) {
    return (
      <Badge variant="outline" className="border-emerald-500/40 text-emerald-700 dark:text-emerald-400">
        <CheckCircleIcon className="mr-0.5 size-3" />
        Active
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className="text-muted-foreground">
      Installed
    </Badge>
  )
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-md border border-dashed border-border bg-muted/20 p-12 text-center">
      <PackageIcon className="size-10 text-muted-foreground" />
      <div>
        <div className="text-base font-medium">No modules installed</div>
        <div className="text-sm text-muted-foreground">
          User modules are selected during the install wizard. Re-run the
          installer to add modules (post-install adding is coming soon).
        </div>
      </div>
    </div>
  )
}

/**
 * Curated display ordering — the user-facing knobs come first per
 * module so the conf table feels scannable. Anything not in this list
 * falls through alphabetically.
 */
function curatedKeysFor(moduleKey: string): string[] {
  switch (moduleKey) {
    case "mod-ah-bot":
      return [
        "AuctionHouseBot.EnableSeller",
        "AuctionHouseBot.EnableBuyer",
        "AuctionHouseBot.Account",
        "AuctionHouseBot.GUID",
        "AuctionHouseBot.ItemsPerCycle",
        "AuctionHouseBot.ElapsingTimeClass",
        "AuctionHouseBot.VendorItems",
        "AuctionHouseBot.ProfessionItems",
      ]
    case "mod-solocraft":
      return [
        "Solocraft.Enable",
        "Solocraft.Dungeon",
        "Solocraft.Heroic",
        "Solocraft.Raid10",
        "Solocraft.Raid25",
        "Solocraft.Raid40",
      ]
    case "mod-autobalance":
      return [
        "AutoBalance.Enable",
        "AutoBalance.InflectionPoint",
        "AutoBalance.LevelScaling",
      ]
    case "mod-transmog":
      return [
        "Transmogrification.EnablePortable",
        "Transmogrification.ScaledCostModifier",
        "Transmogrification.AllowMixedArmorTypes",
      ]
    case "mod-individual-progression":
      return [
        "IndividualProgression.VanillaPowerAdjustment",
        "IndividualProgression.TBCPowerAdjustment",
        "IndividualProgression.DisableRDF",
        "IndividualProgression.DeathKnightUnlockProgression",
      ]
    case "mod-1v1-arena":
      return [
        "Arena1v1.Enable",
        "Arena1v1.Costs",
        "Arena1v1.PreventHealingTalents",
      ]
    case "mod-aoe-loot":
      return ["AOELoot.Enable", "AOELoot.Range", "AOELoot.GroupLoot"]
    case "mod-learn-spells":
      return [
        "LearnSpells.OnLoginEnabled",
        "LearnSpells.OnLevelUpEnabled",
        "LearnSpells.OnFirstLogin",
      ]
    default:
      return []
  }
}

function sortConfEntries(
  conf: Record<string, string>,
  curated: string[]
): [string, string][] {
  const entries = Object.entries(conf).filter(([k]) => k !== "__section__")
  const curatedSet = new Set(curated)
  const inCurated: [string, string][] = []
  const others: [string, string][] = []
  for (const e of entries) {
    if (curatedSet.has(e[0])) inCurated.push(e)
    else others.push(e)
  }
  inCurated.sort(
    (a, b) => curated.indexOf(a[0]) - curated.indexOf(b[0])
  )
  others.sort((a, b) => a[0].localeCompare(b[0]))
  return [...inCurated, ...others]
}
