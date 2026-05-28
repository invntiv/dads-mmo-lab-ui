import * as React from "react"

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
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
  CaretRightIcon,
  FloppyDiskBackIcon,
  PlayIcon,
  StopIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { LottieLoop } from "@/components/lottie-loop"
import { PreInstallTooltip } from "@/components/pre-install-tooltip"
import {
  useServerState,
  type ActivePage,
} from "@/components/server-state-context"
import { cn } from "@/lib/utils"
import { trackedInvoke } from "@/lib/tauri"
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

/**
 * A top-level nav node: either a direct route (`item`) or a collapsible
 * group of routes (`group`) shown with the sidebar-07 tree-line styling.
 */
export type NavNode =
  | ({ kind: "item" } & NavEntry)
  | {
      kind: "group"
      title: string
      icon: React.ReactNode
      items: NavEntry[]
      /** Whether the group starts expanded (default true). */
      defaultOpen?: boolean
    }

/**
 * Top of the sidebar: the install/start/stop server button. Stays
 * separate from the routing nav because its state depends on the
 * server lifecycle, not on what page the user is looking at.
 */
export function ServerActionGroup() {
  const {
    installed,
    openInstall,
    worldserverStatus,
    serverActionStatus,
    installStatus,
    startServer,
    stopServer,
    restartServer,
  } = useServerState()

  const actionInFlight = serverActionStatus === "running"
  // An install (or its cancel/cleanup) is actively running. The main pane
  // shows the install console; the sidebar button reflects it as a disabled
  // "Installing…" so it can't be re-triggered mid-run.
  const installing =
    installStatus === "running" ||
    installStatus === "cancelling" ||
    installStatus === "cleaning"
  // "Stop" or "Restart" is meaningful when the server is up or
  // thrashing. We show the button-group + dropdown variant in both
  // of those states.
  const showStopGroup =
    installed &&
    !actionInFlight &&
    !installing &&
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
                installing={installing}
                actionInFlight={actionInFlight}
                worldserverStatus={worldserverStatus}
                onInstall={openInstall}
                onStart={() => void startServer()}
              />
            )}
          </SidebarMenuItem>
          {installed && (
            <SidebarMenuItem className="mt-2">
              <AutoShutdownToggle worldserverStatus={worldserverStatus} />
            </SidebarMenuItem>
          )}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}

/**
 * Auto-shutdown toggle: when ON, a backend watcher polls every 5s for
 * `Wow.exe`. Once it has SEEN the client running at least once and then
 * sees it exit, it auto-stops the server. The two-phase "see first, then
 * watch for exit" design means flipping this on without the client open
 * doesn't immediately kill a server you're actively administering.
 *
 * Idempotent on the backend: `ensure_client_watcher` no-ops if a watcher
 * is already alive, and the watcher self-exits when the setting is
 * turned off or the server stops on its own.
 */
function AutoShutdownToggle({
  worldserverStatus,
}: {
  worldserverStatus: ReturnType<typeof useServerState>["worldserverStatus"]
}) {
  const [enabled, setEnabled] = React.useState<boolean | null>(null)

  // Load persisted value on mount. While the initial value is unknown
  // we render the checkbox in an indeterminate visual state (not
  // checked, not interactive) so we don't briefly flash "off" and then
  // snap to "on" if the user previously enabled it.
  React.useEffect(() => {
    let cancelled = false
    void trackedInvoke<boolean>("get_auto_shutdown_on_client_exit")
      .then((v) => {
        if (!cancelled) setEnabled(v)
      })
      .catch((e) => {
        console.warn("get_auto_shutdown_on_client_exit failed", e)
        if (!cancelled) setEnabled(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Whenever (a) toggle is on AND (b) server is actually running, ask
  // the backend to ensure the watcher exists. The backend CAS makes
  // this safe to spam — only one watcher will ever exist at a time.
  React.useEffect(() => {
    if (enabled !== true) return
    if (worldserverStatus !== "running") return
    void trackedInvoke("ensure_client_watcher").catch((e) =>
      console.warn("ensure_client_watcher failed", e)
    )
  }, [enabled, worldserverStatus])

  const handleChange = (next: boolean) => {
    setEnabled(next) // optimistic
    void trackedInvoke("set_auto_shutdown_on_client_exit", { value: next })
      .then(() => {
        if (next && worldserverStatus === "running") {
          return trackedInvoke("ensure_client_watcher")
        }
      })
      .catch((e) => {
        console.warn("set_auto_shutdown_on_client_exit failed", e)
        // Revert on failure so the UI doesn't lie.
        setEnabled(!next)
      })
  }

  const disabled = enabled === null
  return (
    <TooltipProvider delayDuration={150}>
      <label
        className={cn(
          // pl-2 matches the SidebarMenuButton's internal `p-2`. The
          // checkbox is wrapped in a size-5 slot so its center aligns
          // with the size-5 Play/Stop icon in the server button above,
          // and the "Auto-shutdown" text aligns with that button's label.
          "group/auto-shutdown flex w-full cursor-pointer items-center gap-2 pl-2 py-1.5 text-sm text-sidebar-foreground/70 transition-colors hover:text-sidebar-foreground",
          disabled && "cursor-default opacity-60"
        )}
      >
        <span className="flex size-5 items-center justify-center">
          <Checkbox
            className="size-3.5"
            checked={enabled === true}
            disabled={disabled}
            onCheckedChange={(c) => handleChange(c === true)}
            aria-label="Auto-shutdown when WoW client exits"
          />
        </span>
        {/* The explanatory tooltip used to hang off a question-mark
            icon, but the icon was too small to read on a Steam Deck
            screen. Hover lives on the label text itself now. */}
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="select-none">Auto-shutdown</span>
          </TooltipTrigger>
          <TooltipContent side="right" className="max-w-xs whitespace-normal">
            Watches the WoW client process (Wow.exe) once you launch it,
            then automatically stops the server when you close the game.
            Toggling this on without the client running won't shut the
            server down — the watcher only triggers after it has seen
            the client running at least once.
          </TooltipContent>
        </Tooltip>
      </label>
    </TooltipProvider>
  )
}

/**
 * The scrollable nav. Top-level entries are either direct routes or
 * collapsible groups (sidebar-07 style). The server action button is NOT
 * here anymore — it lives in the static SidebarHeader so it stays put
 * while this list scrolls. `nodes` come from app-sidebar.tsx.
 */
export function NavMain({ nodes }: { nodes: NavNode[] }) {
  const { installed } = useServerState()
  return (
    <SidebarGroup>
      <SidebarGroupContent>
        <SidebarMenu>
          {nodes.map((node) =>
            node.kind === "group" ? (
              <NavGroup key={node.title} node={node} installed={installed} />
            ) : (
              <NavItem key={node.title} entry={node} installed={installed} />
            )
          )}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}

/** A direct top-level route. */
function NavItem({
  entry,
  installed,
}: {
  entry: NavEntry
  installed: boolean
}) {
  const { activePage, setActivePage } = useServerState()
  const isActive = entry.page != null && activePage === entry.page
  return (
    <SidebarMenuItem>
      <PreInstallTooltip show={!installed}>
        <SidebarMenuButton
          tooltip={entry.tooltip ?? entry.title}
          onClick={() => {
            if (!entry.disabled && entry.page) setActivePage(entry.page)
          }}
          isActive={isActive}
          disabled={entry.disabled || !installed}
          className={entry.notify ? "relative" : undefined}
        >
          {entry.icon}
          <span>{entry.title}</span>
          {entry.notify && <NotificationDot />}
        </SidebarMenuButton>
      </PreInstallTooltip>
    </SidebarMenuItem>
  )
}

/** A collapsible group with tree-line sub-items. */
function NavGroup({
  node,
  installed,
}: {
  node: Extract<NavNode, { kind: "group" }>
  installed: boolean
}) {
  const { activePage, setActivePage } = useServerState()
  return (
    <Collapsible
      asChild
      defaultOpen={node.defaultOpen ?? true}
      className="group/collapsible"
    >
      <SidebarMenuItem>
        <PreInstallTooltip show={!installed}>
          <CollapsibleTrigger asChild>
            {/* Disabled pre-install like the rest of the menu, so it can't
                expand until there's a server. */}
            <SidebarMenuButton tooltip={node.title} disabled={!installed}>
              {node.icon}
              <span>{node.title}</span>
              <CaretRightIcon className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
            </SidebarMenuButton>
          </CollapsibleTrigger>
        </PreInstallTooltip>
        <CollapsibleContent>
          <SidebarMenuSub>
            {node.items.map((sub) => {
              const disabled = sub.disabled || !installed
              const isActive = sub.page != null && activePage === sub.page
              return (
                <SidebarMenuSubItem key={sub.title}>
                  {/* Intrinsically-disabled stubs (Gear Library, Auction
                      House, etc.) explain themselves on hover, mirroring
                      the pre-install tooltip pattern. */}
                  <PreInstallTooltip show={!!sub.disabled} label="Coming Soon!">
                    <SidebarMenuSubButton
                      isActive={isActive}
                      aria-disabled={disabled}
                      className={cn(
                        "cursor-pointer",
                        disabled && "cursor-default opacity-50"
                      )}
                      onClick={() => {
                        if (!sub.disabled && sub.page) setActivePage(sub.page)
                      }}
                    >
                      {sub.icon}
                      <span>{sub.title}</span>
                    </SidebarMenuSubButton>
                  </PreInstallTooltip>
                </SidebarMenuSubItem>
              )
            })}
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
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
  installing,
  actionInFlight,
  worldserverStatus,
  onInstall,
  onStart,
}: {
  installed: boolean
  installing: boolean
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

  if (installing) {
    label = "Installing…"
    leadingIcon = (
      <LottieLoop animationData={loadingAnimation} className="size-5 invert" />
    )
    trailingIcon = null
    onClick = () => {}
    disabled = true
  } else if (!installed) {
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
