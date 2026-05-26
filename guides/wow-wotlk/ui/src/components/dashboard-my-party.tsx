import * as React from "react"
import {
  PlusIcon,
  UserCircleIcon,
  UsersThreeIcon,
} from "@phosphor-icons/react"
import { toast } from "sonner"

import {
  AddToPartyWizard,
  type AddToPartySelection,
} from "@/components/add-to-party-wizard"
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
 * 4 dashed-border bot slots below; hovering an empty slot reveals an
 * "Add to party" CTA that opens the AddToPartyWizard.
 *
 * Slot count = 4 to match a 5-man dungeon party (user is the implicit
 * 5th). Raid composition (10/25-man) is a later concern.
 *
 * No party state is persisted in this component — once Phase 2e wires
 * the spawn flow, the filled slots will be derived from a live query
 * of the user's `group_member` rows.
 */

const PARTY_SLOTS = 4

export function DashboardMyParty() {
  const { selectedCharacter, installComplete } = useServerState()
  const [wizardOpen, setWizardOpen] = React.useState(false)

  // The wizard's onConfirm currently can't actually spawn a bot —
  // Phase 2e wires `add_bot_to_party`. What we CAN do today: catch
  // the "character isn't online" case before the user expects a bot
  // to materialize, and acknowledge the click either way.
  const handleConfirm = async (selection: AddToPartySelection) => {
    const guid = selectedCharacter?.guid
    if (!guid || !isTauri()) {
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
      toast.warning(`${selectedCharacter?.name ?? "Your character"} isn't logged in`, {
        description:
          "Log into the game first — adding a bot summons it to your character's position and invites it to your party, both of which need you in-world.",
      })
      return
    }
    // Phase 2e: invoke add_bot_to_party with `selection` here.
    toast.success("Selection captured", {
      description: `${selection.role} · ${selection.spec.specName} · Lv ${selection.targetLevel} (Lv ${selection.build.level} build) — backend wiring lands in Phase 2e; the bot won't actually spawn yet.`,
    })
  }

  return (
    <div className="flex flex-1 flex-col gap-4 px-4 pt-3 pb-6 lg:px-6">
      <UserPartyHeader character={selectedCharacter} installed={installComplete} />
      <div className="space-y-2">
        {Array.from({ length: PARTY_SLOTS }, (_, i) => (
          <EmptyPartySlot
            key={i}
            slotIndex={i}
            onAdd={() => setWizardOpen(true)}
          />
        ))}
      </div>
      <PartyHelpFooter />
      <AddToPartyWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        characterLevel={selectedCharacter?.level}
        onConfirm={handleConfirm}
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

