import * as React from "react"
import type { CSSProperties } from "react"

import { AhBotIntroOverlay } from "@/components/ahbot-intro-overlay"
import { AutoShutdownAlertDialog } from "@/components/auto-shutdown-alert-dialog"
import { CursorFactionProvider } from "@/components/cursor-faction-context"
import { SplashScreen } from "@/components/splash-screen"
import { AppSidebar } from "@/components/app-sidebar"
import { BotDetailScreen } from "@/components/bot-detail-screen"
import { DashboardShell } from "@/components/dashboard-shell"
import { HelpScreen } from "@/components/help-screen"
import { InstallOnboarding } from "@/components/install-onboarding"
import { InstallProgressScreen } from "@/components/install-progress-screen"
import { GearLibraryScreen } from "@/components/gear-library-screen"
import { InventoryScreen } from "@/components/inventory-screen"
import { PartyPresetsScreen } from "@/components/party-presets-screen"
import { PlayerbotsScreen } from "@/components/playerbots-screen"
import { ServerControlScreen } from "@/components/server-control-screen"
import { SettingsScreen } from "@/components/settings-screen"
import { SteamosFixScreen } from "@/components/steamos-fix-screen"
import { AuctionHouseScreen } from "@/components/auction-house-screen"
import { TeleportScreen } from "@/components/teleport-screen"
import { WorldSettingsScreen } from "@/components/world-settings-screen"
import { UninstallSuccessDialog } from "@/components/uninstall-success-dialog"
import {
  ServerStateProvider,
  useServerState,
} from "@/components/server-state-context"
import { SiteHeader } from "@/components/site-header"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { WelcomeScreen } from "@/components/welcome-screen"

export default function App() {
  // Splash overlay sits above the shell until it fades out (3s window
  // with a 500ms fade). The app behind it mounts/renders in parallel,
  // so by the time the splash clears the UI is ready.
  const [splashDone, setSplashDone] = React.useState(false)
  return (
    <TooltipProvider>
      {/* CursorFactionProvider wraps the entire tree so the Warcraft
          cursor class lands on an outer element and cascades down via
          its `* { cursor: ... }` rule. Scope is the webview, so other
          apps are unaffected. */}
      <CursorFactionProvider>
        <ServerStateProvider>
          <AppShell />
          {/* Mounted alongside AppShell (inside the provider so it can
              read uninstallStatus) so the dialog SURVIVES the route
              change when `installs` empties and App.tsx kicks the user
              from Settings back to WelcomeScreen. Without this, the
              inline success card unmounted before the user could read it. */}
          <UninstallSuccessDialog />
        </ServerStateProvider>
        {/* Sonner mount — every toast() call anywhere in the app
            renders through here. Outside ServerStateProvider so a
            provider error still surfaces a toast. */}
        <Toaster position="top-right" richColors closeButton />
        {/* Listens for the backend's auto-shutdown event and shows an
            explanatory AlertDialog so users aren't blindsided when the
            server stops on its own. Mounted outside ServerStateProvider
            for the same reason as the Toaster. */}
        <AutoShutdownAlertDialog />
        {!splashDone && <SplashScreen onDone={() => setSplashDone(true)} />}
      </CursorFactionProvider>
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
  const showTeleport = isPagedView && activePage === "teleport"
  const showWorldSettings = isPagedView && activePage === "worldSettings"
  const showInventory = isPagedView && activePage === "inventory"
  const showGearLibrary = isPagedView && activePage === "gearLibrary"
  const showAuctionHouse = isPagedView && activePage === "auctionHouse"
  const showPlayerbots = isPagedView && activePage === "playerbots"
  const showPartyPresets = isPagedView && activePage === "partyPresets"
  const showBotDetail = isPagedView && activePage === "botDetail"
  const showSettings = isPagedView && activePage === "settings"
  const showDashboard = isPagedView && activePage === "dashboard"
  // Help lives under the always-available "More" menu, so it routes even
  // before a server is installed (an install that won't start is exactly
  // when people need it).
  const showHelp =
    !showInstallScreen && !showServerActionScreen && activePage === "help"
  // SteamOS Update Fix is always reachable for the same reason: a broken
  // post-update Docker is precisely when the server won't run, and the
  // user needs to get to the fix regardless of install state.
  const showSteamosFix =
    !showInstallScreen && !showServerActionScreen && activePage === "steamosFix"

  let mainContent
  if (showInstallScreen) {
    mainContent = <InstallProgressScreen />
  } else if (showServerActionScreen) {
    mainContent = <ServerControlScreen />
  } else if (showTeleport) {
    mainContent = <TeleportScreen />
  } else if (showWorldSettings) {
    mainContent = <WorldSettingsScreen />
  } else if (showInventory) {
    mainContent = <InventoryScreen />
  } else if (showGearLibrary) {
    mainContent = <GearLibraryScreen />
  } else if (showAuctionHouse) {
    mainContent = <AuctionHouseScreen />
  } else if (showPlayerbots) {
    mainContent = <PlayerbotsScreen />
  } else if (showPartyPresets) {
    mainContent = <PartyPresetsScreen />
  } else if (showBotDetail) {
    mainContent = <BotDetailScreen />
  } else if (showSettings) {
    mainContent = <SettingsScreen />
  } else if (showHelp) {
    mainContent = <HelpScreen />
  } else if (showSteamosFix) {
    mainContent = <SteamosFixScreen />
  } else if (showDashboard) {
    // DashboardShell owns the banner row + the [Player View] / [My
    // Party] tab structure. Banners are part of the shell so both
    // tabs see the same context (install-resume nag, realmlist
    // reminder); tab state stays local to the shell.
    mainContent = <DashboardShell />
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
