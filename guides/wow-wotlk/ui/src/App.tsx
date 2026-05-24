import * as React from "react"
import type { CSSProperties } from "react"

import { AhBotIntroOverlay } from "@/components/ahbot-intro-overlay"
import { SplashScreen } from "@/components/splash-screen"
import { AppSidebar } from "@/components/app-sidebar"
import { DashboardPlayerView } from "@/components/dashboard-player-view"
import { HelpScreen } from "@/components/help-screen"
import { InstallOnboarding } from "@/components/install-onboarding"
import { InstallProgressScreen } from "@/components/install-progress-screen"
import { InstallResumeBanner } from "@/components/install-resume-banner"
import { InventoryScreen } from "@/components/inventory-screen"
import { ModulesScreen } from "@/components/modules-screen"
import { ServerControlScreen } from "@/components/server-control-screen"
import { SettingsScreen } from "@/components/settings-screen"
import { TeleportScreen } from "@/components/teleport-screen"
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
  // Splash overlay sits above the shell until it fades out (3s window
  // with a 500ms fade). The app behind it mounts/renders in parallel,
  // so by the time the splash clears the UI is ready.
  const [splashDone, setSplashDone] = React.useState(false)
  return (
    <TooltipProvider>
      <ServerStateProvider>
        <AppShell />
      </ServerStateProvider>
      {!splashDone && <SplashScreen onDone={() => setSplashDone(true)} />}
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
  const showTeleport = isPagedView && activePage === "teleport"
  const showInventory = isPagedView && activePage === "inventory"
  const showSettings = isPagedView && activePage === "settings"
  const showDashboard = isPagedView && activePage === "dashboard"
  // Help lives under the always-available "More" menu, so it routes even
  // before a server is installed (an install that won't start is exactly
  // when people need it).
  const showHelp =
    !showInstallScreen && !showServerActionScreen && activePage === "help"

  let mainContent
  if (showInstallScreen) {
    mainContent = <InstallProgressScreen />
  } else if (showServerActionScreen) {
    mainContent = <ServerControlScreen />
  } else if (showModules) {
    mainContent = <ModulesScreen />
  } else if (showTeleport) {
    mainContent = <TeleportScreen />
  } else if (showInventory) {
    mainContent = <InventoryScreen />
  } else if (showSettings) {
    mainContent = <SettingsScreen />
  } else if (showHelp) {
    mainContent = <HelpScreen />
  } else if (showDashboard) {
    mainContent = (
      // Banner row above the player paperdoll. Self-dismissing per
      // localStorage, so they don't pester on every visit.
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
        <DashboardPlayerView />
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
        <SidebarInset className="min-h-0 overflow-hidden">
          <SiteHeader />
          <div className="flex flex-1 flex-col overflow-y-auto">
            {mainContent}
          </div>
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
