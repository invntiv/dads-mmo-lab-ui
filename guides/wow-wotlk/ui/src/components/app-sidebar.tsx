import * as React from "react"

import { GlobalCharacterCard } from "@/components/global-character-card"
import { NavMain, type NavGroupSpec } from "@/components/nav-main"
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
  GearIcon,
  HouseIcon,
  PuzzlePieceIcon,
  QuestionIcon,
  RobotIcon,
  SwordIcon,
  TipJarIcon,
  UsersThreeIcon,
} from "@phosphor-icons/react"
import { WowIcon } from "@/components/wow-icon"

/**
 * Source-of-truth for the sidebar's nav structure. Adding a page =
 * add a new entry here (and route for it in App.tsx + ActivePage).
 *
 * The "Inventory" + "Placeholder group #1" headings come from the
 * `heading` field on the group — disabled placeholder entries
 * (`disabled: true`) render but don't navigate, so users see what's
 * coming as we build it out.
 */
function buildNavGroups(ahbotNeedsConfig: boolean): NavGroupSpec[] {
  return [
    {
      // No heading — top-level routes always present.
      items: [
        { title: "Dashboard", icon: <HouseIcon />, page: "dashboard" },
        {
          title: "Modules",
          icon: <PuzzlePieceIcon />,
          page: "modules",
          notify: ahbotNeedsConfig,
          tooltip: ahbotNeedsConfig
            ? "Modules (Auction House Bot needs setup!)"
            : "Modules",
        },
        { title: "Teleport", icon: <CompassIcon />, page: "teleport" },
      ],
    },
    {
      heading: "Inventory",
      items: [
        // The page is still routed as `inventory` internally — only the
        // display name changed to "Item Database".
        { title: "Item Database", icon: <DatabaseIcon />, page: "inventory" },
        { title: "Gear Library", icon: <SwordIcon />, disabled: true },
      ],
    },
    {
      // Placeholder group — names + icons reflect what we plan to
      // build, even though the screens aren't wired yet.
      heading: "Placeholder group #1",
      items: [
        { title: "NPCs", icon: <UsersThreeIcon />, disabled: true },
        { title: "Player Bots", icon: <RobotIcon />, disabled: true },
        { title: "Auction House", icon: <GavelIcon />, disabled: true },
      ],
    },
  ]
}

const SECONDARY_ITEMS = [
  { title: "Settings", icon: <GearIcon />, url: "#" },
  { title: "Get Help", icon: <QuestionIcon />, url: "#" },
  { title: "Support Us", icon: <TipJarIcon />, url: "#" },
]

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { activePage, setActivePage, ahbotNeedsConfig } = useServerState()
  const groups = React.useMemo(
    () => buildNavGroups(ahbotNeedsConfig),
    [ahbotNeedsConfig]
  )
  // Wire the Settings entry to real routing while Get Help / Support
  // Us stay as href="#" stubs for now.
  const secondaryItems = SECONDARY_ITEMS.map((item) =>
    item.title === "Settings"
      ? {
          ...item,
          onClick: () => setActivePage("settings"),
          isActive: activePage === "settings",
        }
      : item
  )
  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              className="data-[slot=sidebar-menu-button]:p-1.5!"
            >
              <a href="#">
                <WowIcon size={20} />
                <span className="text-base font-semibold">WoW 3.3.5a Server</span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain groups={groups} />
        <NavSecondary items={secondaryItems} className="mt-auto" />
      </SidebarContent>
      <SidebarFooter>
        <GlobalCharacterCard />
      </SidebarFooter>
    </Sidebar>
  )
}
