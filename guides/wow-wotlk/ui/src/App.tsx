import type { CSSProperties } from "react"

import { AppSidebar } from "@/components/app-sidebar"
import { DemoDashboard } from "@/components/demo-dashboard"
import { InstallOnboarding } from "@/components/install-onboarding"
import { InstallProgressScreen } from "@/components/install-progress-screen"
import { ServerControlScreen } from "@/components/server-control-screen"
import {
  ServerStateProvider,
  useServerState,
} from "@/components/server-state-context"
import { SiteHeader } from "@/components/site-header"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { TooltipProvider } from "@/components/ui/tooltip"
import { WelcomeScreen } from "@/components/welcome-screen"

export default function App() {
  return (
    <TooltipProvider>
      <ServerStateProvider>
        <AppShell />
      </ServerStateProvider>
    </TooltipProvider>
  )
}

function AppShell() {
  const {
    installed,
    installOpen,
    setInstallOpen,
    installStatus,
    serverActionStatus,
    serverActionKind,
  } = useServerState()

  // Routing priority: install lifecycle takes the main pane first, then
  // any in-flight server action, then the dashboard / welcome screen.
  const showInstallScreen = installStatus !== "idle"
  const showServerActionScreen =
    !showInstallScreen && serverActionStatus !== "idle"

  let title = "Welcome!"
  if (showInstallScreen) title = "Installing"
  else if (showServerActionScreen)
    title = serverActionKind === "stop" ? "Stopping server" : "Starting server"
  else if (installed) title = "Documents"

  let mainContent
  if (showInstallScreen) {
    mainContent = <InstallProgressScreen />
  } else if (showServerActionScreen) {
    mainContent = <ServerControlScreen />
  } else if (installed) {
    mainContent = <DemoDashboard />
  } else {
    mainContent = <WelcomeScreen />
  }

  return (
    <>
      <SidebarProvider
        style={
          {
            "--sidebar-width": "calc(var(--spacing) * 72)",
            "--header-height": "calc(var(--spacing) * 12)",
          } as CSSProperties
        }
      >
        <AppSidebar variant="inset" />
        <SidebarInset>
          <SiteHeader title={title} />
          <div className="flex flex-1 flex-col">{mainContent}</div>
        </SidebarInset>
      </SidebarProvider>
      <InstallOnboarding open={installOpen} onOpenChange={setInstallOpen} />
    </>
  )
}
