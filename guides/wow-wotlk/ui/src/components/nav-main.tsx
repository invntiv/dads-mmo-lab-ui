import * as React from "react"

import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import {
  ArrowRightIcon,
  FloppyDiskBackIcon,
  PlayIcon,
  StopIcon,
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
  } = useServerState()

  // Sidebar button reflects (in order): in-flight server action > the
  // worldserver's runtime status > install-not-yet-done. That mirrors
  // the user's mental model — "what should I do next?".
  const actionInFlight = serverActionStatus === "running"

  let label: string
  let leadingIcon: React.ReactNode
  let trailingIcon: React.ReactNode = <ArrowRightIcon />
  let onClick: () => void
  let disabled = false

  if (!installed) {
    label = "INSTALL SERVER"
    leadingIcon = <FloppyDiskBackIcon />
    onClick = openInstall
  } else if (actionInFlight) {
    label = "WORKING…"
    leadingIcon = <LottieLoop animationData={loadingAnimation} className="size-5" />
    trailingIcon = null
    onClick = () => {}
    disabled = true
  } else if (worldserverStatus === "starting") {
    label = "STARTING…"
    leadingIcon = <LottieLoop animationData={loadingAnimation} className="size-5" />
    trailingIcon = null
    onClick = () => {}
    disabled = true
  } else if (worldserverStatus === "running") {
    label = "STOP SERVER"
    leadingIcon = <StopIcon />
    onClick = () => void stopServer()
  } else {
    // stopped, notpresent (containers wiped but install dir exists), or
    // still-checking — treat all as "needs starting".
    label = "START SERVER"
    leadingIcon = <PlayIcon />
    onClick = () => void startServer()
  }

  return (
    <SidebarGroup>
      <SidebarGroupContent className="flex flex-col gap-2">
        <SidebarMenu>
          <SidebarMenuItem className="flex items-center gap-2">
            <SidebarMenuButton
              tooltip={label}
              onClick={onClick}
              disabled={disabled}
              className="min-w-8 h-10! text-sm bg-primary text-primary-foreground duration-200 ease-linear hover:bg-primary/90 hover:text-primary-foreground active:bg-primary/90 active:text-primary-foreground [&_svg]:size-5! [&>svg:last-of-type]:ml-auto"
            >
              {leadingIcon}
              <span>{label}</span>
              {trailingIcon}
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <SidebarMenu>
          {items.map((item) => (
            <SidebarMenuItem key={item.title}>
              <SidebarMenuButton tooltip={item.title} disabled={!installed}>
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
