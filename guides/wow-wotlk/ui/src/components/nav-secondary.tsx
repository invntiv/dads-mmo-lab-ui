"use client"

import * as React from "react"

import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { useServerState } from "@/components/server-state-context"
import { cn } from "@/lib/utils"

export function NavSecondary({
  items,
  ...props
}: {
  items: {
    title: string
    /** Used when this item is a plain link. Items that pass `onClick`
     * are rendered as buttons and route via the in-app activePage
     * state instead — keeps Settings / Get Help / Search side by side
     * even though only some of them have real screens yet. */
    url: string
    icon: React.ReactNode
    onClick?: () => void
    isActive?: boolean
  }[]
} & React.ComponentPropsWithoutRef<typeof SidebarGroup>) {
  const { installed } = useServerState()
  const disabledClass = !installed ? "pointer-events-none opacity-50" : undefined

  return (
    <SidebarGroup {...props}>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => (
            <SidebarMenuItem
              key={item.title}
              className={cn(disabledClass)}
              aria-disabled={!installed}
            >
              {item.onClick ? (
                <SidebarMenuButton
                  onClick={item.onClick}
                  isActive={item.isActive}
                  tooltip={item.title}
                >
                  {item.icon}
                  <span>{item.title}</span>
                </SidebarMenuButton>
              ) : (
                <SidebarMenuButton asChild>
                  <a href={item.url}>
                    {item.icon}
                    <span>{item.title}</span>
                  </a>
                </SidebarMenuButton>
              )}
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}
