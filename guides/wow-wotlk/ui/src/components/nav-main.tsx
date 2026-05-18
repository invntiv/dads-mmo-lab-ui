import * as React from "react"

import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { Button } from "@/components/ui/button"
import { ButtonGroup } from "@/components/ui/button-group"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  ArrowClockwiseIcon,
  ArrowRightIcon,
  CaretDownIcon,
  FloppyDiskBackIcon,
  PlayIcon,
  StopIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react"
import { LottieLoop } from "@/components/lottie-loop"
import {
  useServerState,
  type ActivePage,
} from "@/components/server-state-context"
import loadingAnimation from "@/assets/lottie/loadingV4.json"

/**
 * One sidebar entry — a real route, a disabled placeholder, or a
 * route with a notification indicator (e.g. AH Bot needs setup).
 */
export type NavEntry = {
  title: string
  icon: React.ReactNode
  /** ActivePage value to route to. When `disabled` is true, ignored. */
  page?: ActivePage
  /** Disabled stubs render but don't navigate. Used for future
   * features (Auction House, NPCs, etc.) so users can see what's
   * coming. */
  disabled?: boolean
  /** When true, draws the pulsing amber dot used to call attention
   * to a needed action (currently: Modules when AH Bot is unconfigured). */
  notify?: boolean
  /** Overrides the default tooltip (which is the title). */
  tooltip?: string
}

export type NavGroupSpec = {
  /** Optional group heading. Without one, the group renders flush
   * with whatever's above it — matches the "no heading on the first
   * group" pattern in the design. */
  heading?: string
  items: NavEntry[]
}

/**
 * Top of the sidebar: the install/start/stop server button. Stays
 * separate from the routing nav because its state depends on the
 * server lifecycle, not on what page the user is looking at.
 */
function ServerActionGroup() {
  const {
    installed,
    openInstall,
    worldserverStatus,
    serverActionStatus,
    startServer,
    stopServer,
    restartServer,
  } = useServerState()

  const actionInFlight = serverActionStatus === "running"
  // "Stop" or "Restart" is meaningful when the server is up or
  // thrashing. We show the button-group + dropdown variant in both
  // of those states.
  const showStopGroup =
    installed &&
    !actionInFlight &&
    (worldserverStatus === "running" || worldserverStatus === "crashed")

  return (
    <SidebarGroup>
      <SidebarGroupContent>
        <SidebarMenu>
          <SidebarMenuItem className="flex items-center gap-2">
            {showStopGroup ? (
              <StopRestartButtonGroup
                isCrashed={worldserverStatus === "crashed"}
                onStop={() => void stopServer()}
                onRestart={() => void restartServer()}
              />
            ) : (
              <PrimaryServerButton
                installed={installed}
                actionInFlight={actionInFlight}
                worldserverStatus={worldserverStatus}
                onInstall={openInstall}
                onStart={() => void startServer()}
              />
            )}
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}

/**
 * Renders the server-action button followed by an arbitrary list of
 * navigation groups. Groups are rendered as separate `<SidebarGroup>`
 * blocks, which gives natural vertical spacing between them.
 *
 * The shape of `groups` is dictated by app-sidebar.tsx — that's where
 * "what's in the sidebar today" lives, so reordering / adding pages
 * happens there, not here.
 */
export function NavMain({ groups }: { groups: NavGroupSpec[] }) {
  const { installed, activePage, setActivePage } = useServerState()
  return (
    <>
      <ServerActionGroup />
      {groups.map((group, gi) => (
        <SidebarGroup key={gi}>
          {group.heading && (
            <SidebarGroupLabel>{group.heading}</SidebarGroupLabel>
          )}
          <SidebarGroupContent>
            <SidebarMenu>
              {group.items.map((entry) => {
                const isDisabled = entry.disabled || !installed
                const isActive =
                  entry.page != null && activePage === entry.page
                return (
                  <SidebarMenuItem key={entry.title}>
                    <SidebarMenuButton
                      tooltip={entry.tooltip ?? entry.title}
                      onClick={() => {
                        if (!entry.disabled && entry.page) {
                          setActivePage(entry.page)
                        }
                      }}
                      isActive={isActive}
                      disabled={isDisabled}
                      className={entry.notify ? "relative" : undefined}
                    >
                      {entry.icon}
                      <span>{entry.title}</span>
                      {entry.notify && <NotificationDot />}
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      ))}
    </>
  )
}

/** Pulsing amber dot — conventional shadcn "needs attention" indicator. */
function NotificationDot() {
  return (
    <span className="ml-auto flex size-2.5 items-center justify-center">
      <span className="absolute inline-flex size-2.5 animate-ping rounded-full bg-amber-400 opacity-75" />
      <span className="relative inline-flex size-2 rounded-full bg-amber-500" />
    </span>
  )
}

// Shared base classes for the primary sidebar button "look". We split
// out the trailing-arrow rule from the rest because the ButtonGroup
// variant doesn't have a trailing arrow — applying `ml-auto` to its
// only icon would shove the icon to the right edge of the button.
const PRIMARY_BUTTON_BASE =
  "min-w-8 h-10! text-sm bg-primary text-primary-foreground duration-200 ease-linear hover:bg-primary/90 hover:text-primary-foreground active:bg-primary/90 active:text-primary-foreground [&_svg]:size-5!"

// Only apply this on the SidebarMenuButton variant where we render a
// trailing `→` (or chevron) — pushes that last svg to the right edge.
const TRAILING_ARROW_AUTO = "[&>svg:last-of-type]:ml-auto"

const PRIMARY_BUTTON_CLASS = `${PRIMARY_BUTTON_BASE} ${TRAILING_ARROW_AUTO}`

function PrimaryServerButton({
  installed,
  actionInFlight,
  worldserverStatus,
  onInstall,
  onStart,
}: {
  installed: boolean
  actionInFlight: boolean
  worldserverStatus: ReturnType<typeof useServerState>["worldserverStatus"]
  onInstall: () => void
  onStart: () => void
}) {
  let label: string
  let leadingIcon: React.ReactNode
  let trailingIcon: React.ReactNode = <ArrowRightIcon />
  let onClick: () => void
  let disabled = false

  if (!installed) {
    label = "INSTALL SERVER"
    leadingIcon = <FloppyDiskBackIcon />
    onClick = onInstall
  } else if (actionInFlight) {
    label = "WORKING…"
    leadingIcon = <LottieLoop animationData={loadingAnimation} className="size-5 invert" />
    trailingIcon = null
    onClick = () => {}
    disabled = true
  } else if (worldserverStatus === "starting") {
    label = "STARTING…"
    leadingIcon = <LottieLoop animationData={loadingAnimation} className="size-5 invert" />
    trailingIcon = null
    onClick = () => {}
    disabled = true
  } else {
    // stopped, notpresent, or still-checking — needs starting
    label = "START SERVER"
    leadingIcon = <PlayIcon />
    onClick = onStart
  }

  return (
    <SidebarMenuButton
      tooltip={label}
      onClick={onClick}
      disabled={disabled}
      className={PRIMARY_BUTTON_CLASS}
    >
      {leadingIcon}
      <span>{label}</span>
      {trailingIcon}
    </SidebarMenuButton>
  )
}

function StopRestartButtonGroup({
  isCrashed,
  onStop,
  onRestart,
}: {
  isCrashed: boolean
  onStop: () => void
  onRestart: () => void
}) {
  const leadingIcon = isCrashed ? (
    <WarningCircleIcon className="size-5!" />
  ) : (
    <StopIcon className="size-5!" />
  )
  const label = isCrashed ? "SERVER CRASHED — STOP" : "STOP SERVER"

  return (
    // `rounded-none` on the buttons matches the SidebarMenuButton style
    // (sidebar.tsx:469 defines its base as `rounded-none`). Without it
    // the ButtonGroup variant would render with rounded-md corners that
    // visually clash with the INSTALL/START SERVER button.
    //
    // PRIMARY_BUTTON_BASE (not _CLASS) — we don't want the trailing-
    // arrow `ml-auto` rule here; with only the StopIcon present it
    // would push the icon to the right edge of the button.
    <ButtonGroup className="w-full">
      <Button
        type="button"
        onClick={onStop}
        className={`${PRIMARY_BUTTON_BASE} flex-1 justify-start gap-2 rounded-none px-2`}
      >
        {leadingIcon}
        <span className="truncate">{label}</span>
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            aria-label="More server actions"
            className={`${PRIMARY_BUTTON_BASE} shrink-0 rounded-none px-2`}
          >
            <CaretDownIcon className="size-4!" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem onSelect={onRestart}>
            <ArrowClockwiseIcon className="size-4" />
            Restart server
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </ButtonGroup>
  )
}
