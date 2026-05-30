import * as React from "react"

import { CharacterSwitcher } from "@/components/character-switcher"
import { NavMain, ServerActionGroup, type NavNode } from "@/components/nav-main"
import { NavSecondary } from "@/components/nav-secondary"
import { useServerState } from "@/components/server-state-context"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import {
  CompassIcon,
  DatabaseIcon,
  GavelIcon,
  GlobeHemisphereWestIcon,
  HouseIcon,
  PackageIcon,
  RobotIcon,
  SwordIcon,
  UsersThreeIcon,
} from "@phosphor-icons/react"
import { WowIcon } from "@/components/wow-icon"

/**
 * Source-of-truth for the scrollable nav. Direct routes are `item`s;
 * collapsible groups (Inventory, Bots) are `group`s with sub-items.
 * Disabled entries render greyed so users see what's coming.
 */
function buildNavNodes(_ahbotNeedsConfig: boolean): NavNode[] {
  // Modules used to be a standalone nav item; it now lives as a
  // section inside Settings. The AH Bot needs-config notify that
  // used to pulse on this item is intentionally dropped — the
  // settings page surfaces the same alert inline.
  return [
    { kind: "item", title: "Dashboard", icon: <HouseIcon />, page: "dashboard" },
    { kind: "item", title: "Teleport", icon: <CompassIcon />, page: "teleport" },
    {
      kind: "item",
      title: "World Settings",
      icon: <GlobeHemisphereWestIcon />,
      page: "worldSettings",
    },
    {
      kind: "group",
      title: "Inventory",
      icon: <PackageIcon />,
      items: [
        // Routed internally as `inventory`; display name is "Item Database".
        { title: "Item Database", icon: <DatabaseIcon />, page: "inventory" },
        { title: "Gear Library", icon: <SwordIcon />, page: "gearLibrary" },
        { title: "Auction House", icon: <GavelIcon />, page: "auctionHouse" },
      ],
    },
    {
      kind: "group",
      title: "Bots",
      icon: <RobotIcon />,
      items: [
        { title: "Player Bots", icon: <RobotIcon />, page: "playerbots" },
        {
          title: "Party Presets",
          icon: <UsersThreeIcon />,
          page: "partyPresets",
        },
      ],
    },
  ]
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { ahbotNeedsConfig, setActivePage } = useServerState()
  const nodes = React.useMemo(
    () => buildNavNodes(ahbotNeedsConfig),
    [ahbotNeedsConfig]
  )

  return (
    <Sidebar collapsible="offcanvas" {...props}>
      {/* Static header: logo + the server action button stay put while the
          nav below scrolls. Tight vertical padding — the logo button
          already carries its own. */}
      <SidebarHeader className="gap-1 pt-1 pb-1">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              onClick={() => setActivePage("dashboard")}
              className="data-[slot=sidebar-menu-button]:p-1.5!"
            >
              <WowIcon size={32} />
              <span className="text-lg font-semibold">WoW 3.3.5a Server</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <ServerActionGroup />
      </SidebarHeader>

      {/* Scrollable nav. */}
      <SidebarContent>
        <NavMain nodes={nodes} />
      </SidebarContent>

      {/* Static footer: Settings/More/Quit, then the character switcher. */}
      <SidebarFooter className="gap-1 pt-1 pb-2">
        <NavSecondary className="py-0.5" />
        <CharacterSwitcher />
      </SidebarFooter>
    </Sidebar>
  )
}
