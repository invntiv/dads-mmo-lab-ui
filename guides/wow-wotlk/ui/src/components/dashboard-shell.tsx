import * as React from "react"
import {
  TreeStructureIcon,
  UserCircleIcon,
  UsersThreeIcon,
} from "@phosphor-icons/react"

import { DashboardMyParty } from "@/components/dashboard-my-party"
import { DashboardMyTalents } from "@/components/dashboard-my-talents"
import { DashboardPlayerView } from "@/components/dashboard-player-view"
import { InstallResumeBanner } from "@/components/install-resume-banner"
import { WowClientCard } from "@/components/wow-client-card"
import { useServerState } from "@/components/server-state-context"
import { cn } from "@/lib/utils"

/**
 * Dashboard wrapper. Splits the main pane into three tabs:
 *
 *   - Player View — paperdoll / status / inventory
 *   - My Talents  — the user character's talent tree (visual only for
 *                   now; SQL wiring lands in Phase 3d)
 *   - My Party    — the user's 5-man party (their character + 4 bot
 *                   slots fed by the Add-to-Party wizard)
 *
 * Banner row (InstallResumeBanner + WowClientCard) stays above the
 * tabs since every tab needs that context. Tab state is local — when
 * the user navigates away and back, the dashboard re-mounts on Player
 * View by design.
 */

type DashboardTab = "player" | "talents" | "party"

const TABS: { id: DashboardTab; label: string; icon: React.ReactNode }[] = [
  {
    id: "player",
    label: "Player View",
    icon: <UserCircleIcon className="size-3.5" />,
  },
  {
    id: "talents",
    label: "My Talents",
    icon: <TreeStructureIcon className="size-3.5" />,
  },
  {
    id: "party",
    label: "My Party",
    icon: <UsersThreeIcon className="size-3.5" />,
  },
]

export function DashboardShell() {
  const { installComplete } = useServerState()
  const [tab, setTab] = React.useState<DashboardTab>("player")

  let body: React.ReactNode
  if (tab === "player") body = <DashboardPlayerView />
  else if (tab === "talents") body = <DashboardMyTalents />
  else body = <DashboardMyParty />

  return (
    <div className="flex flex-1 flex-col">
      {/* Banners + tab row pinned at the top of the dashboard. The
          tab row sits below the banners so the install-resume nag
          (when present) doesn't get visually relegated. */}
      <div className="space-y-3 px-4 pt-4 lg:px-6">
        <InstallResumeBanner />
        {installComplete && <WowClientCard />}
        <DashboardTabs active={tab} onChange={setTab} />
      </div>
      {body}
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
