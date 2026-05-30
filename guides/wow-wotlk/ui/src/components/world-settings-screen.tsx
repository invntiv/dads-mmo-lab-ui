import * as React from "react"
import {
  ArrowsClockwiseIcon,
  CircleNotchIcon,
  FloppyDiskIcon,
  GlobeHemisphereWestIcon,
  SparkleIcon,
} from "@phosphor-icons/react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { isTauri, trackedInvoke } from "@/lib/tauri"
import { cn } from "@/lib/utils"

/**
 * World Settings — curated player-facing global rates from
 * worldserver.conf. Saving writes the conf and `.reload config`s the
 * worldserver so rates apply without a restart.
 */

interface WorldSettings {
  xpKill: number
  xpQuest: number
  xpExplore: number
  dropMoney: number
  reputation: number
  honor: number
  monsterDamage: number
  monsterHealth: number
  loot: number
  restedXp: number
  moveSpeed: number
  crossFaction: boolean
}

type FieldKey = keyof WorldSettings

type Field =
  | { kind: "rate"; key: FieldKey; label: string; help: string }
  | { kind: "toggle"; key: FieldKey; label: string; help: string }

const GROUPS: { title: string; blurb: string; fields: Field[] }[] = [
  {
    title: "Experience",
    blurb: "How fast characters level up.",
    fields: [
      { kind: "rate", key: "xpKill", label: "Kill XP", help: "XP from killing monsters" },
      { kind: "rate", key: "xpQuest", label: "Quest XP", help: "XP from completing quests" },
      {
        kind: "rate",
        key: "xpExplore",
        label: "Exploration XP",
        help: "XP from discovering new areas",
      },
    ],
  },
  {
    title: "Rewards",
    blurb: "Loot, reputation, and PvP gains.",
    fields: [
      { kind: "rate", key: "dropMoney", label: "Gold drops", help: "Money dropped by monsters" },
      { kind: "rate", key: "reputation", label: "Reputation", help: "Reputation gained" },
      { kind: "rate", key: "honor", label: "Honor", help: "Honor from PvP" },
    ],
  },
  {
    title: "Difficulty",
    blurb: "Scale the challenge — affects normal mobs, elites, and bosses.",
    fields: [
      {
        kind: "rate",
        key: "monsterDamage",
        label: "Monster damage",
        help: "Damage monsters deal (melee + spells, all tiers)",
      },
      {
        kind: "rate",
        key: "monsterHealth",
        label: "Monster health",
        help: "Monster HP (all tiers)",
      },
      {
        kind: "rate",
        key: "loot",
        label: "Loot drops",
        help: "Item drop chance across all qualities",
      },
    ],
  },
  {
    title: "Quality of life",
    blurb: "Convenience tweaks.",
    fields: [
      {
        kind: "rate",
        key: "restedXp",
        label: "Rested XP",
        help: "How fast rested (bonus) XP accrues",
      },
      {
        kind: "rate",
        key: "moveSpeed",
        label: "Movement speed",
        help: "Player run/travel speed",
      },
      {
        kind: "toggle",
        key: "crossFaction",
        label: "Cross-faction play",
        help: "Let Alliance and Horde group, chat, trade, and use the same auction house",
      },
    ],
  },
]

/** Quick multipliers that set every XP field at once. */
const XP_PRESETS = [1, 2, 5, 10]

export function WorldSettingsScreen() {
  const [settings, setSettings] = React.useState<WorldSettings | null>(null)
  const [loaded, setLoaded] = React.useState<WorldSettings | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)

  const load = React.useCallback(async () => {
    if (!isTauri()) {
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const s = await trackedInvoke<WorldSettings>("get_world_settings")
      setSettings(s)
      setLoaded(s)
    } catch (e) {
      toast.error("Couldn't read world settings", {
        description: typeof e === "string" ? e : String(e),
      })
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void load()
  }, [load])

  const dirty =
    settings != null &&
    loaded != null &&
    (Object.keys(settings) as FieldKey[]).some((k) => settings[k] !== loaded[k])

  const setField = (key: FieldKey, value: number | boolean) =>
    setSettings((prev) => (prev ? { ...prev, [key]: value } : prev))

  const setAllXp = (mult: number) =>
    setSettings((prev) =>
      prev ? { ...prev, xpKill: mult, xpQuest: mult, xpExplore: mult } : prev
    )

  const handleSave = async () => {
    if (!settings || !isTauri()) return
    setSaving(true)
    try {
      const msg = await trackedInvoke<string>("set_world_settings", { settings })
      setLoaded(settings)
      toast.success("World settings saved", { description: msg })
    } catch (e) {
      toast.error("Couldn't save world settings", {
        description: typeof e === "string" ? e : String(e),
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-4 pt-3 pb-6 lg:px-6">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <GlobeHemisphereWestIcon className="size-6 text-primary" weight="fill" />
          World Settings
        </h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Tune your server's global rates. A multiplier of{" "}
          <span className="font-medium">1</span> is Blizzlike; higher means
          faster. Saved changes apply live — no restart.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
          <CircleNotchIcon className="size-4 animate-spin" />
          Loading…
        </div>
      ) : !settings ? (
        <div className="rounded-md border border-dashed border-border bg-muted/10 p-6 text-sm text-muted-foreground">
          Couldn't load world settings. Make sure the server has run at least
          once.
        </div>
      ) : (
        <>
          {/* XP quick presets */}
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/20 p-3">
            <SparkleIcon className="size-4 text-primary" weight="fill" />
            <span className="text-sm font-medium">Quick XP</span>
            <span className="text-xs text-muted-foreground">
              set all experience rates to
            </span>
            <div className="flex flex-wrap gap-1.5">
              {XP_PRESETS.map((m) => {
                const active =
                  settings.xpKill === m &&
                  settings.xpQuest === m &&
                  settings.xpExplore === m
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setAllXp(m)}
                    className={cn(
                      "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
                      active
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-card hover:border-primary/60"
                    )}
                  >
                    {m}×
                  </button>
                )
              })}
            </div>
          </div>

          {GROUPS.map((group) => (
            <div
              key={group.title}
              className="rounded-md border border-border bg-card p-4"
            >
              <div className="mb-3">
                <div className="text-sm font-semibold">{group.title}</div>
                <div className="text-xs text-muted-foreground">
                  {group.blurb}
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                {group.fields.map((f) => (
                  <div key={f.key} className="space-y-1.5">
                    <Label htmlFor={`ws-${f.key}`} title={f.help}>
                      {f.label}
                    </Label>
                    {f.kind === "toggle" ? (
                      <div className="flex h-8 items-center gap-2">
                        <Switch
                          id={`ws-${f.key}`}
                          checked={settings[f.key] as boolean}
                          onCheckedChange={(c) => setField(f.key, c)}
                        />
                        <span className="text-xs text-muted-foreground">
                          {settings[f.key] ? "On" : "Off"}
                        </span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <Input
                          id={`ws-${f.key}`}
                          type="number"
                          min={0}
                          step={0.5}
                          value={settings[f.key] as number}
                          onChange={(e) => {
                            const n = Number(e.target.value)
                            if (Number.isFinite(n)) setField(f.key, Math.max(0, n))
                          }}
                          className="w-24 text-right font-mono tabular-nums"
                        />
                        <span className="text-lg font-medium text-muted-foreground">
                          ×
                        </span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}

          <div className="flex items-center gap-2">
            <Button onClick={handleSave} disabled={!dirty || saving}>
              {saving ? (
                <CircleNotchIcon className="size-4 animate-spin" />
              ) : (
                <FloppyDiskIcon className="size-4" weight="fill" />
              )}
              {saving ? "Saving…" : "Save changes"}
            </Button>
            <Button
              variant="outline"
              onClick={() => void load()}
              disabled={saving}
              title="Reload values from worldserver.conf"
            >
              <ArrowsClockwiseIcon className="size-4" />
              Reset
            </Button>
            {dirty && (
              <span className="text-xs text-muted-foreground">
                Unsaved changes
              </span>
            )}
          </div>
        </>
      )}
    </div>
  )
}
