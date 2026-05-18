import * as React from "react"

import {
  SidebarGroup,
  SidebarGroupContent,
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
  HouseIcon,
  PlayIcon,
  PuzzlePieceIcon,
  StopIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react"
import { LottieLoop } from "@/components/lottie-loop"
import { useServerState } from "@/components/server-state-context"
import loadingAnimation from "@/assets/lottie/loadingV4.json"

export function NavMain({
  items,
}: {
  items: {
    title: string
    url: string
    icon?: React.ReactNode
  }[]
}) {
  const {
    installed,
    openInstall,
    worldserverStatus,
    serverActionStatus,
    startServer,
    stopServer,
    restartServer,
    activePage,
    setActivePage,
    ahbotNeedsConfig,
  } = useServerState()

  const actionInFlight = serverActionStatus === "running"
  // "Stop" or "Restart" is meaningful when the server is up or thrashing.
  // We show the button-group + dropdown variant in both of those states.
  const showStopGroup =
    installed &&
    !actionInFlight &&
    (worldserverStatus === "running" || worldserverStatus === "crashed")

  return (
    <SidebarGroup>
      <SidebarGroupContent className="flex flex-col gap-2">
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
        {/* Real, clickable nav entries — Dashboard + Modules. The rest
            of the data.navMain items below are placeholders kept from
            the shadcn starter (Lifecycle / Analytics / etc.) and stay
            disabled until we build those pages out. */}
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="Dashboard"
              onClick={() => setActivePage("dashboard")}
              isActive={activePage === "dashboard"}
              disabled={!installed}
            >
              <HouseIcon />
              <span>Dashboard</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip={
                ahbotNeedsConfig
                  ? "Modules (Auction House Bot needs setup!)"
                  : "Modules"
              }
              onClick={() => setActivePage("modules")}
              isActive={activePage === "modules"}
              disabled={!installed}
              className="relative"
            >
              <PuzzlePieceIcon />
              <span>Modules</span>
              {/* Soft-blinking amber dot pulls the user toward Modules
                  while AH Bot is installed-but-inert. The animate-ping
                  ring + solid dot pattern is the conventional shadcn
                  "needs attention" indicator. */}
              {ahbotNeedsConfig && (
                <span className="ml-auto flex size-2.5 items-center justify-center">
                  <span className="absolute inline-flex size-2.5 animate-ping rounded-full bg-amber-400 opacity-75" />
                  <span className="relative inline-flex size-2 rounded-full bg-amber-500" />
                </span>
              )}
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>

        <SidebarMenu>
          {items.map((item) => (
            <SidebarMenuItem key={item.title}>
              <SidebarMenuButton tooltip={item.title} disabled>
                {item.icon}
                <span>{item.title}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
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
