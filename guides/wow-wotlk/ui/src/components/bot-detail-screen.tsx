import * as React from "react"
import {
  ArrowLeftIcon,
  ShieldCheckIcon,
  TreeStructureIcon,
  UserCircleIcon,
} from "@phosphor-icons/react"

import {
  Paperdoll,
  type CharacterPaperdoll,
} from "@/components/dashboard-player-view"
import { TalentTree } from "@/components/talent-tree"
import { useServerState } from "@/components/server-state-context"
import { Button } from "@/components/ui/button"
import { isTauri, trackedInvoke } from "@/lib/tauri"
import {
  CLASS_COLOR_HEX,
  CLASS_COLORS,
  CLASS_ICON_NAMES,
  CLASS_NAMES,
} from "@/lib/wow-character-enums"
import { cn } from "@/lib/utils"

/**
 * Bot detail page — Gear / Talents tabs for any bot guid. Entered via
 * `openBotDetail(...)` from the Player Bots list or My Party slots.
 *
 * Reuses the player paperdoll component for gear (same SQL command,
 * same renderer) and the TalentTree component for talents. Stats
 * sidebar from the player view is intentionally NOT included here —
 * bots are managed via whisper commands, not direct HP/power edits.
 */
export function BotDetailScreen() {
  const { selectedBot, setActivePage, iconMap } = useServerState()
  const [tab, setTab] = React.useState<"gear" | "talents">("gear")
  const [paperdoll, setPaperdoll] = React.useState<CharacterPaperdoll | null>(
    null
  )
  const [points, setPoints] = React.useState<Record<number, number>>({})
  const [error, setError] = React.useState<string | null>(null)

  const guid = selectedBot?.guid ?? null
  const classId = selectedBot?.classId ?? null

  // Two parallel fetches kept simple — these are unrelated SQL paths,
  // so concurrent invokes are cheaper than chaining them.
  React.useEffect(() => {
    if (!guid || !isTauri()) {
      setPaperdoll(null)
      setPoints({})
      return
    }
    let cancelled = false
    setError(null)
    void Promise.all([
      trackedInvoke<CharacterPaperdoll>("get_character_paperdoll", { guid }),
      trackedInvoke<Record<string, number>>("get_character_talents", { guid }),
    ])
      .then(([pd, ts]) => {
        if (cancelled) return
        setPaperdoll(pd)
        const coerced: Record<number, number> = {}
        for (const [k, v] of Object.entries(ts)) {
          coerced[Number(k)] = v
        }
        setPoints(coerced)
      })
      .catch((e) => {
        if (cancelled) return
        setError(typeof e === "string" ? e : String(e))
      })
    return () => {
      cancelled = true
    }
  }, [guid])

  if (!selectedBot || classId === null) {
    return (
      <div className="flex-1 p-4">
        <div className="rounded-md border border-dashed border-border bg-muted/20 p-4 text-sm text-muted-foreground">
          No bot selected. Pick one from the Player Bots list.
        </div>
      </div>
    )
  }

  // Talent points unlock at Lv 10; one per level from there. Falls
  // back to the bot's character row level (more authoritative than
  // anything we'd have client-side at navigate time).
  const botLevel = paperdoll?.level ?? 0
  const totalPointsAvailable = Math.max(0, botLevel - 9)

  return (
    <div className="flex flex-1 flex-col gap-3 p-4">
      <BotHeader bot={selectedBot} level={botLevel} onBack={() => setActivePage("playerbots")} />
      <BotDetailTabs active={tab} onChange={setTab} />
      {error && (
        <div className="rounded-md border border-rose-500/30 bg-rose-500/5 p-3 text-xs text-rose-700 dark:text-rose-400">
          Failed to load bot: {error}
        </div>
      )}
      {tab === "gear" ? (
        <Paperdoll data={paperdoll} iconMap={iconMap} />
      ) : (
        <TalentTree
          classId={classId}
          pointsByTalentId={points}
          totalPointsAvailable={totalPointsAvailable}
        />
      )}
    </div>
  )
}

function BotHeader({
  bot,
  level,
  onBack,
}: {
  bot: { guid: number; classId: number; name: string }
  level: number
  onBack: () => void
}) {
  const className = CLASS_NAMES[bot.classId] ?? `Class ${bot.classId}`
  const classColor = CLASS_COLORS[bot.classId] ?? "text-foreground"
  const ringColor = CLASS_COLOR_HEX[bot.classId] ?? "#888"
  const iconName = CLASS_ICON_NAMES[bot.classId]
  return (
    <div className="flex items-center gap-3 rounded-md border border-border bg-card py-3 pl-3 pr-4">
      <Button variant="outline" size="sm" onClick={onBack} className="shrink-0">
        <ArrowLeftIcon className="size-4" />
        Back
      </Button>
      <div
        className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded border-2 bg-muted"
        style={{ borderColor: ringColor }}
      >
        {iconName ? (
          <img
            src={`https://wow.zamimg.com/images/wow/icons/large/${iconName}.jpg`}
            alt={className}
            className="size-full object-cover"
            draggable={false}
          />
        ) : (
          <UserCircleIcon className="size-6 text-muted-foreground" />
        )}
      </div>
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="truncate text-base font-semibold leading-tight">
          <span className={classColor}>{bot.name}</span>
        </div>
        <div className="truncate text-xs leading-tight text-muted-foreground">
          {level > 0 ? `Lv ${level} · ` : ""}
          {className}
        </div>
      </div>
    </div>
  )
}

function BotDetailTabs({
  active,
  onChange,
}: {
  active: "gear" | "talents"
  onChange: (id: "gear" | "talents") => void
}) {
  const tabs: { id: "gear" | "talents"; label: string; icon: React.ReactNode }[] = [
    { id: "gear", label: "Gear", icon: <ShieldCheckIcon className="size-3.5" /> },
    {
      id: "talents",
      label: "Talents",
      icon: <TreeStructureIcon className="size-3.5" />,
    },
  ]
  return (
    <div className="flex w-fit gap-1.5 rounded-md border border-border bg-muted/30 p-1">
      {tabs.map((t) => (
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
