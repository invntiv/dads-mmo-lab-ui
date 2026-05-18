import type { CSSProperties } from "react"

import { AhBotIntroOverlay } from "@/components/ahbot-intro-overlay"
import { AppSidebar } from "@/components/app-sidebar"
import { DemoDashboard } from "@/components/demo-dashboard"
import { InstallOnboarding } from "@/components/install-onboarding"
import { InstallProgressScreen } from "@/components/install-progress-screen"
import { InstallResumeBanner } from "@/components/install-resume-banner"
import { ModulesScreen } from "@/components/modules-screen"
import { ServerControlScreen } from "@/components/server-control-screen"
import { WowClientCard } from "@/components/wow-client-card"
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
    installComplete,
    installOpen,
    setInstallOpen,
    installStatus,
    serverActionStatus,
    serverActionKind,
    activePage,
  } = useServerState()

  // Routing priority: install lifecycle takes the main pane first, then
  // any in-flight server action, then the user-selected page (dashboard
  // / modules), then the welcome screen for pre-install state.
  const showInstallScreen = installStatus !== "idle"
  const showServerActionScreen =
    !showInstallScreen && serverActionStatus !== "idle"
  const isPagedView =
    !showInstallScreen && !showServerActionScreen && installed
  const showModules = isPagedView && activePage === "modules"
  const showDashboard = isPagedView && activePage === "dashboard"

  let title = "Welcome!"
  if (showInstallScreen) title = "Installing"
  else if (showServerActionScreen)
    title =
      serverActionKind === "stop"
        ? "Stopping server"
        : serverActionKind === "restart"
          ? "Restarting server"
          : "Starting server"
  else if (showModules) title = "Modules"
  else if (showDashboard) title = "Dashboard"

  let mainContent
  if (showInstallScreen) {
    mainContent = <InstallProgressScreen />
  } else if (showServerActionScreen) {
    mainContent = <ServerControlScreen />
  } else if (showModules) {
    mainContent = <ModulesScreen />
  } else if (showDashboard) {
    mainContent = (
      // Realmlist reminder sits above the dashboard content. Self-
      // dismissing per localStorage, so it doesn't pester on every visit.
      <div className="flex flex-1 flex-col">
        <div className="space-y-3 px-4 pt-4 lg:px-6">
          {/* Resume banner only shows for partial installs (banner
              self-guards on installComplete). The realmlist reminder
              is gated on installComplete here so the two are mutually
              exclusive — a half-done install has bigger problems than
              a missing realmlist edit. */}
          <InstallResumeBanner />
          {installComplete && <WowClientCard />}
        </div>
        <DemoDashboard />
      </div>
    )
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
      {/* First-time overlay only renders when on the dashboard — we
          don't want it to pop up during install or while a server
          action is in flight. The overlay checks ahbotNeedsConfig
          internally and respects a localStorage dismissal flag. */}
      {showDashboard && <AhBotIntroOverlay />}
    </>
  )
}
