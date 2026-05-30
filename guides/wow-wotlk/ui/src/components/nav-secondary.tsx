"use client"

import * as React from "react"
import { getCurrentWindow } from "@tauri-apps/api/window"
import {
  DiscordLogoIcon,
  DotsThreeOutlineIcon,
  GearIcon,
  PowerIcon,
  QuestionIcon,
  TipJarIcon,
  WrenchIcon,
} from "@phosphor-icons/react"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { PreInstallTooltip } from "@/components/pre-install-tooltip"
import { useServerState } from "@/components/server-state-context"
import { getSfxPrefs, playSfx } from "@/lib/sfx"
import { useSteamOsStatus } from "@/lib/steamos-status"
import { isTauri } from "@/lib/tauri"
import { cn } from "@/lib/utils"

/**
 * Static footer nav: Settings, More (Get Help + Support Us in a popover),
 * Quit. Settings gates on install like the rest of the menu; More and Quit
 * are always available — a user who can't get the server going is exactly
 * who needs Help/Support, and Quit must work in fullscreen where there's no
 * window close button.
 */
export function NavSecondary({
  ...props
}: React.ComponentPropsWithoutRef<typeof SidebarGroup>) {
  const { installed, activePage, setActivePage } = useServerState()
  const { status: steamos } = useSteamOsStatus()
  // The fix entry only makes sense on a SteamOS host; the pulsing dot
  // calls it out once an update has actually landed.
  const showSteamosFix = steamos?.isSteamos ?? false
  const steamosUpdatePending = steamos?.updatePending ?? false

  const handleQuit = React.useCallback(async () => {
    if (!isTauri()) return
    // Play the stealth cue, then give it a beat to be audible before the
    // window closes (closing kills the audio). Skip the delay entirely
    // when SFX are off.
    playSfx("stealth")
    const delay = getSfxPrefs().enabled ? 450 : 0
    const close = async () => {
      try {
        await getCurrentWindow().close()
      } catch (err) {
        console.error("quit failed", err)
      }
    }
    if (delay === 0) {
      void close()
    } else {
      setTimeout(() => void close(), delay)
    }
  }, [])

  return (
    <SidebarGroup {...props}>
      <SidebarGroupContent>
        <SidebarMenu>
          {/* Settings — gated until a server exists */}
          <SidebarMenuItem>
            <PreInstallTooltip show={!installed}>
              <SidebarMenuButton
                size="sm"
                onClick={() => setActivePage("settings")}
                isActive={activePage === "settings"}
                disabled={!installed}
                tooltip="Settings"
              >
                <GearIcon />
                <span>Settings</span>
              </SidebarMenuButton>
            </PreInstallTooltip>
          </SidebarMenuItem>

          {/* More — popover with Help + Support (always available) */}
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton size="sm" tooltip="More" className="relative">
                  <DotsThreeOutlineIcon />
                  <span>More</span>
                  {steamosUpdatePending && (
                    // Amber dot mirrors the "needs attention" cue used
                    // elsewhere; clears once the fix runs (or is dismissed).
                    <span className="absolute right-2 top-1.5 flex size-2">
                      <span className="absolute inline-flex size-full animate-ping rounded-full bg-amber-400 opacity-75" />
                      <span className="relative inline-flex size-2 rounded-full bg-amber-500" />
                    </span>
                  )}
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                side="right"
                align="end"
                className="w-56 rounded-lg"
              >
                {showSteamosFix && (
                  <DropdownMenuItem
                    onSelect={() => setActivePage("steamosFix")}
                    className={cn(
                      steamosUpdatePending &&
                        "text-amber-600 focus:text-amber-600 dark:text-amber-400 dark:focus:text-amber-400"
                    )}
                  >
                    <WrenchIcon
                      className={cn(
                        !steamosUpdatePending && "text-muted-foreground"
                      )}
                    />
                    <span className="flex-1">SteamOS Update Fix</span>
                    {steamosUpdatePending && (
                      <span className="size-2 rounded-full bg-amber-500" />
                    )}
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onSelect={() => setActivePage("help")}>
                  <QuestionIcon className="text-muted-foreground" />
                  <span>Get Help</span>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <a
                    href="https://discord.gg/tUpmvSyxKb"
                    target="_blank"
                    rel="noreferrer"
                  >
                    <DiscordLogoIcon className="text-muted-foreground" />
                    <span>Discord</span>
                  </a>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <a
                    href="https://www.patreon.com/c/0xV31l"
                    target="_blank"
                    rel="noreferrer"
                  >
                    <TipJarIcon className="text-muted-foreground" />
                    <span>Support Us</span>
                  </a>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>

          {/* Quit — always available (fullscreen has no titlebar close) */}
          <SidebarMenuItem>
            <SidebarMenuButton
              size="sm"
              onClick={() => void handleQuit()}
              tooltip="Quit"
              className="text-muted-foreground hover:bg-red-500/10 hover:text-red-500"
            >
              <PowerIcon />
              <span>Quit</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}
