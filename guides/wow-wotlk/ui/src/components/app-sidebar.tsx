import * as React from "react"

import { NavDocuments } from "@/components/nav-documents"
import { NavMain } from "@/components/nav-main"
import { NavSecondary } from "@/components/nav-secondary"
import { NavUser } from "@/components/nav-user"
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
import { SquaresFourIcon, ListIcon, ChartBarIcon, FolderIcon, SwordIcon, UsersIcon, CameraIcon, FileTextIcon, GearIcon, QuestionIcon, MagnifyingGlassIcon, DatabaseIcon, ChartLineIcon, FileIcon } from "@phosphor-icons/react"
import { WowIcon } from "@/components/wow-icon"

const data = {
  user: {
    name: "shadcn",
    email: "m@example.com",
    avatar: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 96 96'%3E%3Crect width='96' height='96' rx='24' fill='%23181f2a'/%3E%3Ccircle cx='48' cy='34' r='18' fill='%23f8fafc'/%3E%3Cpath d='M18 82c6-14 18-22 30-22s24 8 30 22' fill='%23f8fafc'/%3E%3C/svg%3E",
  },
  navMain: [
    {
      title: "Dashboard",
      url: "#",
      icon: (
        <SquaresFourIcon
        />
      ),
    },
    {
      title: "Lifecycle",
      url: "#",
      icon: (
        <ListIcon
        />
      ),
    },
    {
      title: "Analytics",
      url: "#",
      icon: (
        <ChartBarIcon
        />
      ),
    },
    {
      title: "Projects",
      url: "#",
      icon: (
        <FolderIcon
        />
      ),
    },
    {
      title: "Team",
      url: "#",
      icon: (
        <UsersIcon
        />
      ),
    },
  ],
  navClouds: [
    {
      title: "Capture",
      icon: (
        <CameraIcon
        />
      ),
      isActive: true,
      url: "#",
      items: [
        {
          title: "Active Proposals",
          url: "#",
        },
        {
          title: "Archived",
          url: "#",
        },
      ],
    },
    {
      title: "Proposal",
      icon: (
        <FileTextIcon
        />
      ),
      url: "#",
      items: [
        {
          title: "Active Proposals",
          url: "#",
        },
        {
          title: "Archived",
          url: "#",
        },
      ],
    },
    {
      title: "Prompts",
      icon: (
        <FileTextIcon
        />
      ),
      url: "#",
      items: [
        {
          title: "Active Proposals",
          url: "#",
        },
        {
          title: "Archived",
          url: "#",
        },
      ],
    },
  ],
  navSecondary: [
    {
      title: "Settings",
      url: "#",
      icon: (
        <GearIcon
        />
      ),
    },
    {
      title: "Get Help",
      url: "#",
      icon: (
        <QuestionIcon
        />
      ),
    },
    {
      title: "Search",
      url: "#",
      icon: (
        <MagnifyingGlassIcon
        />
      ),
    },
  ],
  documents: [
    {
      name: "Gear Library",
      url: "#",
      icon: (
        <SwordIcon
        />
      ),
    },
    {
      name: "Reports",
      url: "#",
      icon: (
        <ChartLineIcon
        />
      ),
    },
    {
      name: "Word Assistant",
      url: "#",
      icon: (
        <FileIcon
        />
      ),
    },
  ],
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { activePage, setActivePage } = useServerState()
  // Wire the Settings entry to real routing while leaving Get Help /
  // Search as href="#" stubs. The other two come from the shadcn
  // starter and will get real targets when those features land.
  const secondaryItems = data.navSecondary.map((item) =>
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
        <NavMain items={data.navMain} />
        <NavDocuments items={data.documents} />
        <NavSecondary items={secondaryItems} className="mt-auto" />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={data.user} />
      </SidebarFooter>
    </Sidebar>
  )
}
