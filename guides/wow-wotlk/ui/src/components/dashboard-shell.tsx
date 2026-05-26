import * as React from "react"
import {
  ShieldCheckIcon,
  TreeStructureIcon,
  UserCircleIcon,
  UsersThreeIcon,
} from "@phosphor-icons/react"

import { DashboardMyParty } from "@/components/dashboard-my-party"
import { DashboardPlayerView } from "@/components/dashboard-player-view"
import { InstallResumeBanner } from "@/components/install-resume-banner"
import { WowClientCard } from "@/components/wow-client-card"
import { useServerState } from "@/components/server-state-context"
import { cn } from "@/lib/utils"

/**
 * Dashboard wrapper. Two top-level tabs:
 *
 *   - Player View — paperdoll/status + the player's own talent tree,
 *                   split into INNER Gear / Talents sub-tabs (the
 *                   same pattern the bot detail page uses)
 *   - My Party   — live group view, Add-to-Party wizard, per-slot
 *                  popovers for bot actions
 *
 * Header row layout:
 *   [Player View] [My Party]                       [Gear] [Talents]
 *
 * The inner Gear/Talents pair is right-aligned in the same row as
 * the top-level tabs, but only rendered when Player View is active.
 * When the user navigates to My Party the inner pair disappears.
 *
 * Tab state is local — when the user navigates away and back the
 * dashboard re-mounts and we land on Player View / Gear by design.
 */

type DashboardTab = "player" | "party"
export type PlayerViewSubTab = "gear" | "talents"

const TABS: { id: DashboardTab; label: string; icon: React.ReactNode }[] = [
  {
    id: "player",
    label: "Player View",
    icon: <UserCircleIcon className="size-3.5" />,
  },
  {
    id: "party",
    label: "My Party",
    icon: <UsersThreeIcon className="size-3.5" />,
  },
]

const SUB_TABS: { id: PlayerViewSubTab; label: string; icon: React.ReactNode }[] = [
  {
    id: "gear",
    label: "Gear",
    icon: <ShieldCheckIcon className="size-3.5" />,
  },
  {
    id: "talents",
    label: "Talents",
    icon: <TreeStructureIcon className="size-3.5" />,
  },
]

export function DashboardShell() {
  const { installComplete } = useServerState()
  const [tab, setTab] = React.useState<DashboardTab>("player")
  const [subTab, setSubTab] = React.useState<PlayerViewSubTab>("gear")

  return (
    <div className="flex flex-1 flex-col">
      {/* Banners + tab row pinned at the top of the dashboard. The
          tab row sits below the banners so the install-resume nag
          (when present) doesn't get visually relegated. */}
      <div className="space-y-3 px-4 pt-4 lg:px-6">
        <InstallResumeBanner />
        {installComplete && <WowClientCard />}
        <div className="flex items-center justify-between gap-2">
          <DashboardTabs active={tab} onChange={setTab} />
          {tab === "player" && (
            <PlayerSubTabs active={subTab} onChange={setSubTab} />
          )}
        </div>
      </div>
      {tab === "player" ? (
        <DashboardPlayerView subTab={subTab} />
      ) : (
        <DashboardMyParty />
      )}
    </div>
  )
}

function DashboardTabs({
  active,
  onChange,
}: {
  active: DashboardTab
  onChange: (id: DashboardTab) => void
}) {
  return (
    <div className="flex w-fit gap-1.5 rounded-md border border-border bg-muted/30 p-1">
      {TABS.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onChange(t.id)}
          className={cn(
            "flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium transition-colors",
            active === t.id
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
          )}
        >
          {t.icon}
          {t.label}
        </button>
      ))}
    </div>
  )
}

function PlayerSubTabs({
  active,
  onChange,
}: {
  active: PlayerViewSubTab
  onChange: (id: PlayerViewSubTab) => void
}) {
  return (
    <div className="flex w-fit gap-1.5 rounded-md border border-border bg-muted/30 p-1">
      {SUB_TABS.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onChange(t.id)}
          className={cn(
            "flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium transition-colors",
            active === t.id
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
          )}
        >
          {t.icon}
          {t.label}
        </button>
      ))}
    </div>
  )
}
