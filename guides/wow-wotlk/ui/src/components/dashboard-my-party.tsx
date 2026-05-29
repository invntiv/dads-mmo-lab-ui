import * as React from "react"
import {
  ArrowLeftIcon,
  FloppyDiskIcon,
  MagnifyingGlassIcon,
  PaperPlaneTiltIcon,
  PlugIcon,
  PlusIcon,
  StarIcon,
  UserCircleIcon,
  UserMinusIcon,
  UsersThreeIcon,
} from "@phosphor-icons/react"
import { toast } from "sonner"

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { useFavoriteBots } from "@/lib/favorite-bots"
import { specName } from "@/lib/wow-spec-roles"

import {
  AddToPartyWizard,
  type AddToPartySelection,
} from "@/components/add-to-party-wizard"
import { SavePartyDialog } from "@/components/save-party-dialog"
import { Button } from "@/components/ui/button"
import { useServerState } from "@/components/server-state-context"
import { isTauri, trackedInvoke } from "@/lib/tauri"
import {
  CLASS_COLOR_HEX,
  CLASS_COLORS,
  CLASS_ICON_NAMES,
  CLASS_NAMES,
  CLASS_SHORT_NAMES,
  RACE_NAMES,
} from "@/lib/wow-character-enums"
import { cn } from "@/lib/utils"

/**
 * Dashboard's "My Party" tab. User's selected character sits at top,
 * 4 bot slots below: filled when an actual group member exists, empty
 * (with an Add-to-Party CTA) otherwise.
 *
 * Slot count = 4 to match a 5-man dungeon party (user is the implicit
 * 5th). Raid composition (10/25-man) is a later concern.
 *
 * Live data: polls `get_user_party` every POLL_INTERVAL_MS so that
 * group changes from outside the Lab (a bot logging off, the user
 * manually inviting/kicking, etc.) reflect within a few seconds.
 * Also refetches immediately after the wizard's add-to-party flow
 * returns so the new bot pops into a slot without waiting.
 */

const PARTY_SLOTS = 4
const POLL_INTERVAL_MS = 4_000

interface PartyMember {
  guid: number
  name: string
  classId: number
  race: number
  level: number
  online: boolean
  isLeader: boolean
  /** Primary spec tab (0/1/2). Null if no talents. */
  specTabIndex?: number | null
  /** Total talent points per tab. Null when specTabIndex is null. */
  talentDistribution?: [number, number, number] | null
}

export function DashboardMyParty() {
  const { selectedCharacter, installComplete, setActivePage } = useServerState()
  const [wizardOpen, setWizardOpen] = React.useState(false)
  const [saveOpen, setSaveOpen] = React.useState(false)
  const [party, setParty] = React.useState<PartyMember[]>([])

  const playerGuid = selectedCharacter?.guid ?? null

  const refresh = React.useCallback(async () => {
    if (!playerGuid || !isTauri()) {
      setParty([])
      return
    }
    try {
      const members = await trackedInvoke<PartyMember[]>("get_user_party", {
        playerGuid,
      })
      setParty(members)
    } catch (e) {
      // Silent failure — the My Party UI keeps showing the last
      // known good state. Loud errors would spam the toast queue on
      // every poll tick.
      console.warn("[my-party] get_user_party failed", e)
    }
  }, [playerGuid])

  // Initial fetch + interval polling. Cleanup cancels on unmount /
  // character change.
  React.useEffect(() => {
    void refresh()
    if (!playerGuid) return
    const handle = window.setInterval(() => void refresh(), POLL_INTERVAL_MS)
    return () => window.clearInterval(handle)
  }, [playerGuid, refresh])

  // Bot members = everything that isn't the leader. Ordered by guid
  // so the slot positions stay stable across polls. New bots fill
  // slot 0 first, etc.
  const bots = React.useMemo(
    () =>
      party
        .filter((m) => !m.isLeader)
        .sort((a, b) => a.guid - b.guid)
        .slice(0, PARTY_SLOTS),
    [party]
  )

  // Drives the full spawn → level → talents → gear → maintenance
  // pipeline through `add_bot_to_party`. Pre-flight: character must be
  // online (the spawn flow runs `.playerbots addclass` as the player's
  // session via Eluna, which needs a live player).
  const handleConfirm = async (selection: AddToPartySelection) => {
    const guid = selectedCharacter?.guid
    if (!guid || !isTauri() || !selectedCharacter) {
      toast.error("No character selected — pick one from the sidebar first.")
      return
    }
    let online = false
    try {
      online = await trackedInvoke<boolean>("is_character_online", { guid })
    } catch (e) {
      toast.error("Couldn't reach the database", {
        description: typeof e === "string" ? e : String(e),
      })
      return
    }
    if (!online) {
      toast.warning(`${selectedCharacter.name} isn't logged in`, {
        description:
          "Log into the game first — adding a bot summons it to your character's position and invites it to your party, both of which need you in-world.",
      })
      return
    }

    const loadingId = toast.loading(
      `Spawning ${selection.role} ${selection.spec.specName}…`,
      { description: `Lv ${selection.targetLevel} · Lv ${selection.build.level} build` }
    )
    try {
      const result = await trackedInvoke<{
        botName: string | null
        steps: { label: string; ok: boolean; detail: string }[]
      }>("add_bot_to_party", {
        args: {
          classId: selection.classId,
          targetLevel: selection.targetLevel,
          wowheadLink: selection.build.wowheadLink,
          characterName: selectedCharacter.name,
        },
      })
      const failed = result.steps.filter((s) => !s.ok)
      if (result.botName && failed.length === 0) {
        toast.success(`${result.botName} joined your party`, {
          id: loadingId,
          description: result.steps.map((s) => `✓ ${s.label}`).join(" · "),
        })
      } else if (result.botName) {
        toast.warning(
          `${result.botName} joined, but ${failed.length} step${failed.length === 1 ? "" : "s"} failed`,
          {
            id: loadingId,
            description: failed
              .map((s) => `✗ ${s.label}${s.detail ? ` — ${s.detail}` : ""}`)
              .join(" · "),
          }
        )
      } else {
        toast.error("Bot didn't join the party", {
          id: loadingId,
          description: failed
            .map((s) => `✗ ${s.label}${s.detail ? ` — ${s.detail}` : ""}`)
            .join(" · "),
        })
      }
    } catch (e) {
      toast.error("Add-to-party failed", {
        id: loadingId,
        description: typeof e === "string" ? e : String(e),
      })
    } finally {
      // Always re-poll — even on failure we may have partially
      // filled a slot (e.g. bot joined but autogear errored).
      void refresh()
    }
  }

  return (
    // mx-auto max-w-3xl mirrors the player view's paperdoll card —
    // switching between Player View and My Party keeps the content
    // column the same width so nothing visually shifts.
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-4 pt-3 pb-6 lg:px-6">
      <UserPartyHeader character={selectedCharacter} installed={installComplete} />
      {bots.length > 0 && (
        <div className="flex justify-end">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSaveOpen(true)}
          >
            <FloppyDiskIcon className="size-4" weight="fill" />
            Save party
          </Button>
        </div>
      )}
      <div className="space-y-2">
        {Array.from({ length: PARTY_SLOTS }, (_, i) => {
          const bot = bots[i]
          if (bot) {
            return (
              <FilledPartySlot
                key={bot.guid}
                bot={bot}
                otherOfflineBots={bots.filter(
                  (b) => !b.online && b.guid !== bot.guid
                )}
                playerName={selectedCharacter?.name ?? null}
                onRefresh={() => void refresh()}
              />
            )
          }
          return (
            <EmptyPartySlot
              key={`empty-${i}`}
              slotIndex={i}
              onAdd={() => setWizardOpen(true)}
            />
          )
        })}
      </div>
      <PartyHelpFooter />
      <AddToPartyWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        characterLevel={selectedCharacter?.level}
        onConfirm={handleConfirm}
      />
      <SavePartyDialog
        open={saveOpen}
        onOpenChange={setSaveOpen}
        bots={bots.map((b) => ({
          name: b.name,
          classId: b.classId,
          level: b.level,
          specTabIndex: b.specTabIndex,
          talentDistribution: b.talentDistribution,
        }))}
        playerClassId={selectedCharacter?.class ?? null}
        playerSpecTabIndex={party.find((m) => m.isLeader)?.specTabIndex ?? null}
        onSaved={() => setActivePage("partyPresets")}
      />
    </div>
  )
}

function UserPartyHeader({
  character,
  installed,
}: {
  character: ReturnType<typeof useServerState>["selectedCharacter"]
  installed: boolean
}) {
  if (!installed) {
    return (
      <div className="flex items-center gap-3 rounded-md border border-dashed border-border bg-muted/20 p-4 text-sm text-muted-foreground">
        <UserCircleIcon className="size-6 shrink-0" />
        Install the server first to build a party.
      </div>
    )
  }
  if (!character) {
    return (
      <div className="flex items-center gap-3 rounded-md border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-700 dark:text-amber-400">
        <UserCircleIcon className="size-6 shrink-0" />
        <div className="flex-1">
          <div className="font-semibold">No character selected</div>
          <div className="text-xs">
            Pick one from the sidebar — the party is built around your
            character.
          </div>
        </div>
      </div>
    )
  }

  const fullClass = CLASS_NAMES[character.class] ?? `#${character.class}`
  const shortClass = CLASS_SHORT_NAMES[character.class] ?? fullClass
  const raceName = RACE_NAMES[character.race] ?? `#${character.race}`
  const classColor = CLASS_COLORS[character.class] ?? "text-foreground"
  const ringColor = CLASS_COLOR_HEX[character.class] ?? "#888"
  const iconName = CLASS_ICON_NAMES[character.class]

  return (
    <div className="flex items-center gap-3 rounded-md border-2 border-primary/40 bg-card py-3 pl-3 pr-4">
      <div
        className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded border-2 bg-muted"
        style={{ borderColor: ringColor }}
      >
        {iconName ? (
          <img
            src={`https://wow.zamimg.com/images/wow/icons/large/${iconName}.jpg`}
            alt={fullClass}
            className="size-full object-cover"
            draggable={false}
          />
        ) : (
          <UserCircleIcon className="size-7 text-muted-foreground" />
        )}
      </div>
      <div className="min-w-0 flex-1 space-y-0.5">
        <div
          className="truncate leading-tight"
          title={`${character.name} · ${raceName}`}
        >
          <span className={cn("text-base font-semibold", classColor)}>
            {character.name}
          </span>
          <span className="text-sm text-muted-foreground"> · {raceName}</span>
        </div>
        <div className="truncate text-sm leading-tight text-muted-foreground">
          Lv {character.level} · {shortClass}
        </div>
      </div>
      <span className="shrink-0 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
        You
      </span>
    </div>
  )
}

function FilledPartySlot({
  bot,
  otherOfflineBots,
  playerName,
  onRefresh,
}: {
  bot: PartyMember
  /** Other offline party members (excluding this bot). Drives the
   *  Bring-Online submenu: if non-empty AND this bot is offline,
   *  the action splits into a back/just-this/all submenu instead of
   *  a one-tap action. */
  otherOfflineBots: PartyMember[]
  playerName: string | null
  /** Called after Kick / Teleport / Bring-online succeeds so the
   *  party list re-fetches. */
  onRefresh: () => void
}) {
  const { openBotDetail } = useServerState()
  const favoriteBots = useFavoriteBots()
  const isFavorite = favoriteBots.isFavorite(bot.guid)
  const [open, setOpen] = React.useState(false)
  // Two-view popover: "main" lists the action set; "bring-online"
  // is the disambiguation submenu shown when bringing this bot back
  // and other offline bots exist that the user might also want to
  // bring back in a single action.
  const [view, setView] = React.useState<"main" | "bring-online">("main")
  // Reset to the main view every time the popover closes so the next
  // open starts fresh.
  React.useEffect(() => {
    if (!open) setView("main")
  }, [open])

  const fullClass = CLASS_NAMES[bot.classId] ?? `#${bot.classId}`
  const shortClass = CLASS_SHORT_NAMES[bot.classId] ?? fullClass
  const raceName = RACE_NAMES[bot.race] ?? `#${bot.race}`
  const classColor = CLASS_COLORS[bot.classId] ?? "text-foreground"
  const ringColor = CLASS_COLOR_HEX[bot.classId] ?? "#888"
  const iconName = CLASS_ICON_NAMES[bot.classId]
  // Line 2 prefers the spec + distribution (e.g. "Frost (0/19/52)").
  // Falls back to the class name when the bot has no talents (low-
  // level or fresh from the pool).
  const specShort = specName(bot.classId, bot.specTabIndex ?? null, true)

  const runKick = async () => {
    setOpen(false)
    const id = toast.loading(`Kicking ${bot.name}…`)
    try {
      await trackedInvoke("kick_bot_from_party", {
        args: { botName: bot.name },
      })
      toast.success(`${bot.name} kicked from party`, { id })
      onRefresh()
    } catch (e) {
      toast.error("Kick failed", {
        id,
        description: typeof e === "string" ? e : String(e),
      })
    }
  }
  const runTeleport = async () => {
    setOpen(false)
    if (!playerName) return
    const id = toast.loading(`Summoning ${bot.name}…`)
    try {
      await trackedInvoke("summon_playerbot_to_character", {
        args: { botName: bot.name, characterName: playerName },
      })
      toast.success(`${bot.name} teleported to you`, { id })
    } catch (e) {
      toast.error("Teleport failed", {
        id,
        description: typeof e === "string" ? e : String(e),
      })
    }
  }
  const bringOnlineOne = async (target: PartyMember) => {
    if (!playerName) return
    await trackedInvoke("bring_bot_online", {
      args: { botName: target.name, characterName: playerName },
    })
  }
  const bringOnlineJustThis = async () => {
    setOpen(false)
    if (!playerName) return
    const id = toast.loading(`Bringing ${bot.name} online…`)
    try {
      await bringOnlineOne(bot)
      toast.success(`${bot.name} coming online`, { id })
      onRefresh()
    } catch (e) {
      toast.error("Bring-online failed", {
        id,
        description: typeof e === "string" ? e : String(e),
      })
    }
  }
  const bringOnlineAll = async () => {
    setOpen(false)
    if (!playerName) return
    const targets = [bot, ...otherOfflineBots]
    const id = toast.loading(`Bringing ${targets.length} bots online…`)
    const failures: string[] = []
    // Serial loop — addclass-style logins queue a GroupInviteOperation
    // per bot, and racing those can confuse the post-login hook. A
    // simple sequential loop is plenty fast for a 4-bot party.
    for (const t of targets) {
      try {
        await bringOnlineOne(t)
      } catch (e) {
        failures.push(`${t.name}: ${typeof e === "string" ? e : String(e)}`)
      }
    }
    if (failures.length === 0) {
      toast.success(`${targets.length} bots coming online`, { id })
    } else {
      toast.warning(
        `${targets.length - failures.length}/${targets.length} bots back online`,
        { id, description: failures.join(" · ") }
      )
    }
    onRefresh()
  }
  const onBringOnlineClick = () => {
    if (otherOfflineBots.length === 0) {
      void bringOnlineJustThis()
    } else {
      setView("bring-online")
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex w-full items-center gap-3 rounded-md border border-border bg-card py-3 pl-3 pr-4 text-left transition-colors hover:border-primary/40 focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
            open && "border-primary/60 ring-1 ring-primary/30"
          )}
        >
          <div
            className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded border-2 bg-muted"
            style={{ borderColor: ringColor }}
          >
            {iconName ? (
              <img
                src={`https://wow.zamimg.com/images/wow/icons/large/${iconName}.jpg`}
                alt={fullClass}
                className="size-full object-cover"
                draggable={false}
              />
            ) : (
              <UsersThreeIcon className="size-7 text-muted-foreground" />
            )}
          </div>
          <div className="min-w-0 flex-1 space-y-0.5">
            <div
              className="truncate leading-tight"
              title={`${bot.name} · ${raceName}`}
            >
              <span className={cn("text-base font-semibold", classColor)}>
                {bot.name}
              </span>
              <span className="text-sm text-muted-foreground"> · {raceName}</span>
            </div>
            <div className="truncate text-sm leading-tight text-muted-foreground">
              Lv {bot.level}
              {specShort ? (
                <>
                  {" · "}
                  <span className="font-medium text-foreground/80">
                    {specShort}
                  </span>
                  {bot.talentDistribution && (
                    <span className="font-mono text-xs">
                      {" "}({bot.talentDistribution.join("/")})
                    </span>
                  )}
                </>
              ) : (
                <>
                  {" · "}
                  {shortClass}
                </>
              )}
            </div>
          </div>
          {!bot.online && (
            <span className="shrink-0 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">
              Offline
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="center"
        side="bottom"
        className="w-64 p-2"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        {view === "bring-online" ? (
          <div className="space-y-0.5">
            <BackHeader onBack={() => setView("main")} />
            <PartySlotAction
              icon={<PlugIcon className="size-4" />}
              label={`Just ${bot.name}`}
              onClick={() => void bringOnlineJustThis()}
              disabled={!playerName}
            />
            <PartySlotAction
              icon={<UsersThreeIcon className="size-4" />}
              label={`All offline bots (${otherOfflineBots.length + 1})`}
              onClick={() => void bringOnlineAll()}
              disabled={!playerName}
            />
          </div>
        ) : (
          <div className="space-y-0.5">
            <PartySlotAction
              icon={
                <StarIcon
                  className="size-4"
                  weight={isFavorite ? "fill" : "regular"}
                />
              }
              label={isFavorite ? "Remove from favorites" : "Add to favorites"}
              onClick={() => {
                setOpen(false)
                favoriteBots.toggle(bot.guid)
              }}
            />
            <PartySlotAction
              icon={<MagnifyingGlassIcon className="size-4" />}
              label="View details"
              onClick={() => {
                setOpen(false)
                openBotDetail({
                  guid: bot.guid,
                  classId: bot.classId,
                  name: bot.name,
                })
              }}
            />
            {!bot.online && (
              <PartySlotAction
                icon={<PlugIcon className="size-4" />}
                label="Bring online"
                onClick={onBringOnlineClick}
                disabled={!playerName}
                tooltip={
                  !playerName ? "Pick a character first" : undefined
                }
              />
            )}
            {bot.online && (
              <PartySlotAction
                icon={<PaperPlaneTiltIcon className="size-4" />}
                label="Teleport to me"
                onClick={runTeleport}
                disabled={!playerName}
                tooltip={!playerName ? "Pick a character first" : undefined}
              />
            )}
            <PartySlotAction
              icon={<UserMinusIcon className="size-4" />}
              label="Kick from party"
              onClick={runKick}
            />
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

/** Compact "back" header for popover submenus. Thinner row + smaller
 *  text + darker background to make the "step backwards" affordance
 *  obvious without stealing visual weight from the actions below. */
function BackHeader({ onBack }: { onBack: () => void }) {
  return (
    <button
      type="button"
      onClick={onBack}
      className="flex w-full items-center gap-2 rounded bg-muted/60 px-2 py-1 text-left text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      <ArrowLeftIcon className="size-3" />
      <span>Back</span>
    </button>
  )
}

function PartySlotAction({
  icon,
  label,
  onClick,
  disabled,
  tooltip,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  disabled?: boolean
  tooltip?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={tooltip}
      className={cn(
        "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors",
        disabled
          ? "cursor-not-allowed text-muted-foreground/60"
          : "text-foreground hover:bg-accent hover:text-accent-foreground"
      )}
    >
      <span className="text-muted-foreground">{icon}</span>
      <span className="flex-1">{label}</span>
    </button>
  )
}

function EmptyPartySlot({
  slotIndex,
  onAdd,
}: {
  slotIndex: number
  onAdd: () => void
}) {
  return (
    <button
      type="button"
      onClick={onAdd}
      className="group relative flex h-20 w-full items-center justify-center overflow-hidden rounded-md border-2 border-dashed border-border bg-muted/10 transition-colors hover:border-primary/50 hover:bg-primary/5 focus-visible:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
      aria-label={`Add a bot to party slot ${slotIndex + 1}`}
    >
      {/* Default state — visible until hover. Subtle so the row feels
          like an empty placeholder, not an unfilled control. */}
      <div className="flex items-center gap-2 text-muted-foreground/70 transition-opacity duration-150 group-hover:opacity-0 group-focus-visible:opacity-0">
        <UsersThreeIcon className="size-5" />
        <span className="text-xs uppercase tracking-wide">
          Empty party slot
        </span>
      </div>
      {/* Hover state — large CTA. Positioned absolutely so it
          replaces the default content in-place without layout shift. */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100">
        <div className="flex items-center gap-2 rounded-md bg-primary px-5 py-2 text-primary-foreground shadow-sm">
          <PlusIcon className="size-5" weight="bold" />
          <span className="text-sm font-semibold">Add to party</span>
        </div>
      </div>
    </button>
  )
}

function PartyHelpFooter() {
  return (
    <div className="rounded-md border border-border bg-muted/20 p-3 text-xs text-muted-foreground">
      <div className="flex items-start gap-2">
        <UsersThreeIcon className="mt-0.5 size-4 shrink-0" />
        <div>
          <strong>5-man party setup.</strong> Your character is the
          group leader; the four slots below are bot followers. Pick
          role, class, spec, and level — a matching bot will be drawn
          from the AddClass pool, leveled, gear-rolled, talent-specced,
          then teleported to you and added to your group.
        </div>
      </div>
    </div>
  )
}
