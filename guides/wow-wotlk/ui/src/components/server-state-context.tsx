import * as React from "react"
import { listen } from "@tauri-apps/api/event"

import { trackedInvoke, isTauri } from "@/lib/tauri"

export type InstallVariant = "base" | "npcbots" | "playerbots"

export type DetectedInstall = {
  path: string
  variant: InstallVariant | "unknown"
}

export type InstallStatus =
  | "idle"
  | "running"
  | "cancelling"
  | "cleaning"
  | "succeeded"
  | "failed"
  | "cancelled"

/**
 * Per-module config the onboarding wizard knows how to ask about.
 * Mirrors the Rust `AhBotConfig` / `IndividualProgressionConfig` / `ModuleConfig`
 * shapes in install.rs — Tauri serializes camelCase here to snake_case in
 * Rust via serde's rename_all. Anything left undefined falls back to the
 * upstream `.conf.dist` default in install-wow-ui.sh.
 */
export type OnboardingAhBotConfig = {
  itemsPerCycle?: number
  /** 0 = long (1-3d), 1 = medium (1-24h), 2 = short (10-60min) per AC enum */
  elapsingTimeClass?: 0 | 1 | 2
  enableBuyer?: boolean
  vendorItems?: boolean
  professionItems?: boolean
}

export type OnboardingIpConfig = {
  authenticDifficulty?: boolean
  disableRdf?: boolean
  dkRequiresTbc?: boolean
}

export type OnboardingModuleConfig = {
  ahbot?: OnboardingAhBotConfig
  ip?: OnboardingIpConfig
}

export type OnboardingChoices = {
  serverType: InstallVariant
  adminUser: string
  adminPass: string
  buildMethod?: "prebuilt" | "compile"
  force?: boolean
  /** Module keys to clone + compile in (e.g. `["mod-ah-bot", "mod-solocraft"]`). */
  modules?: string[]
  /** Per-module config — only ones the user actually went through a config step for. */
  moduleConfig?: OnboardingModuleConfig
}

export type InstallLogLine = {
  id: number
  /**
   * `stdout` / `stderr` are pipe sources from the spawned subprocess.
   * `system` is for our own status messages (cancellation, cleanup, etc.)
   * — rendered amber. `highlight` is for celebratory final-step messages
   * like "AZEROTH IS READY!" — rendered bright purple.
   */
  stream: "stdout" | "stderr" | "system" | "highlight"
  text: string
}

export type InstallSection = {
  id: number
  title: string
  state: "active" | "done"
  lines: InstallLogLine[]
  /**
   * Transient progress line currently in-flight inside this section
   * (e.g. a `\r`-updated docker layer download bar). When the section
   * closes or a non-transient final line of the same stream lands, this
   * is committed/cleared the same way the top-level pending is.
   */
  pending: InstallLogLine | null
}

/**
 * The install log is a flat list of entries that the console renders top
 * to bottom. Section entries own their own nested lines so the console
 * can render them as collapsibles — that's how noisy ranges like the
 * docker build get tucked behind a single expandable header instead of
 * spamming thousands of lines.
 */
export type InstallLogEntry =
  | { kind: "line"; data: InstallLogLine }
  | { kind: "section"; data: InstallSection }

type InstallOutputEvent = {
  stream: "stdout" | "stderr" | "system" | "highlight"
  line: string
  transient: boolean
}

type InstallSectionEvent = {
  stage: "start" | "end"
  title: string | null
}

type InstallCleanupEvent = {
  stage: "started" | "finished"
  path: string
  deleted: boolean
  skippedReason: string | null
  error: string | null
}

type InstallDoneEvent = {
  success: boolean
  code: number | null
  message: string | null
  cancelled: boolean
}

// ── Server-control types ────────────────────────────────────────────────

/** Mirror of Rust's `WorldserverStatus` (serde rename_all = "lowercase"). */
export type WorldserverStatus =
  | "notpresent"
  | "stopped"
  | "starting"
  | "crashed"
  | "running"

export type ServerStatusPayload = {
  worldserver: WorldserverStatus
  installPath: string | null
}

export type ServerActionKind = "start" | "stop" | "restart"

/** State machine for an in-flight start/stop. Mirrors install lifecycle. */
export type ServerActionStatus = "idle" | "running" | "succeeded" | "failed"

type ServerOutputEvent = {
  stream: "stdout" | "stderr" | "system" | "highlight"
  line: string
  transient: boolean
}

type ServerDoneEvent = {
  action: ServerActionKind
  success: boolean
  code: number | null
  message: string | null
}

type ConsoleState = {
  log: InstallLogEntry[]
  /**
   * Transient progress line outside of any active section. When a section
   * opens, we commit this to history first so it doesn't get attributed
   * to the section.
   */
  topPending: InstallLogLine | null
}

type ServerState = {
  // Detection
  installs: DetectedInstall[]
  installed: boolean
  detecting: boolean
  refreshInstalls: () => Promise<void>

  // Onboarding modal
  installOpen: boolean
  setInstallOpen: (open: boolean) => void
  openInstall: () => void

  // Install lifecycle
  installStatus: InstallStatus
  installLog: InstallLogEntry[]
  installPending: InstallLogLine | null
  installExitCode: number | null
  startInstall: (choices: OnboardingChoices) => Promise<void>
  cancelInstall: () => Promise<void>
  resetInstall: () => void

  // Server runtime status (polled from docker)
  worldserverStatus: WorldserverStatus | "checking"
  refreshServerStatus: () => Promise<void>

  // Server start/stop lifecycle (uses same console primitives as install)
  serverActionStatus: ServerActionStatus
  serverActionKind: ServerActionKind | null
  serverActionLog: InstallLogEntry[]
  serverActionPending: InstallLogLine | null
  startServer: () => Promise<void>
  stopServer: () => Promise<void>
  restartServer: () => Promise<void>
  resetServerAction: () => void
}

const ServerStateContext = React.createContext<ServerState | null>(null)

const EMPTY_CONSOLE_STATE: ConsoleState = { log: [], topPending: null }

// ── Console-state reducers ──────────────────────────────────────────────
// Pulled out of the component so the install:* handlers stay short and
// the state transitions are easier to read in isolation.

function isActiveSection(
  entry: InstallLogEntry | undefined
): entry is { kind: "section"; data: InstallSection } {
  return entry?.kind === "section" && entry.data.state === "active"
}

function applyTransient(
  prev: ConsoleState,
  stream: InstallLogLine["stream"],
  text: string,
  nextId: () => number
): ConsoleState {
  const last = prev.log[prev.log.length - 1]
  const newLine: InstallLogLine = { id: nextId(), stream, text }

  if (isActiveSection(last)) {
    const sec = last.data
    // Cross-stream pending inside a section → commit the old pending to
    // the section's lines before replacing it with the new one.
    const nextLines =
      sec.pending && sec.pending.stream !== stream
        ? [...sec.lines, sec.pending]
        : sec.lines
    return {
      log: [
        ...prev.log.slice(0, -1),
        {
          kind: "section",
          data: { ...sec, lines: nextLines, pending: newLine },
        },
      ],
      topPending: null,
    }
  }

  // Top-level transient
  if (prev.topPending && prev.topPending.stream !== stream) {
    return {
      log: [...prev.log, { kind: "line", data: prev.topPending }],
      topPending: newLine,
    }
  }
  return { log: prev.log, topPending: newLine }
}

function applyFinal(
  prev: ConsoleState,
  stream: InstallLogLine["stream"],
  text: string,
  nextId: () => number
): ConsoleState {
  const last = prev.log[prev.log.length - 1]
  const newLine: InstallLogLine = { id: nextId(), stream, text }

  if (isActiveSection(last)) {
    const sec = last.data
    // Same terminal-overwrite semantics as top-level: drop same-stream
    // pending (the new final replaces it), preserve cross-stream pending.
    const nextLines =
      sec.pending && sec.pending.stream !== stream
        ? [...sec.lines, sec.pending, newLine]
        : [...sec.lines, newLine]
    return {
      log: [
        ...prev.log.slice(0, -1),
        {
          kind: "section",
          data: { ...sec, lines: nextLines, pending: null },
        },
      ],
      topPending: null,
    }
  }

  // Top-level final
  if (prev.topPending && prev.topPending.stream !== stream) {
    return {
      log: [
        ...prev.log,
        { kind: "line", data: prev.topPending },
        { kind: "line", data: newLine },
      ],
      topPending: null,
    }
  }
  return {
    log: [...prev.log, { kind: "line", data: newLine }],
    topPending: null,
  }
}

function applySectionStart(
  prev: ConsoleState,
  title: string,
  nextId: () => number
): ConsoleState {
  const newSection: InstallSection = {
    id: nextId(),
    title,
    state: "active",
    lines: [],
    pending: null,
  }
  // If a top-level transient is in flight, commit it before opening the
  // section so it stays in the outer log instead of being swallowed.
  const baseLog = prev.topPending
    ? [...prev.log, { kind: "line" as const, data: prev.topPending }]
    : prev.log
  return {
    log: [...baseLog, { kind: "section", data: newSection }],
    topPending: null,
  }
}

function applySectionEnd(prev: ConsoleState): ConsoleState {
  const last = prev.log[prev.log.length - 1]
  if (!isActiveSection(last)) return prev
  const sec = last.data
  const finalLines = sec.pending ? [...sec.lines, sec.pending] : sec.lines
  return {
    log: [
      ...prev.log.slice(0, -1),
      {
        kind: "section",
        data: { ...sec, lines: finalLines, pending: null, state: "done" },
      },
    ],
    topPending: prev.topPending,
  }
}

/**
 * Commit any in-flight transients (top-level + the trailing active section)
 * and mark any trailing active section as done. Used when the install
 * exits so the console doesn't end with an indefinitely-active spinner.
 */
function flushOnTerminate(prev: ConsoleState): ConsoleState {
  let log = prev.topPending
    ? [...prev.log, { kind: "line" as const, data: prev.topPending }]
    : prev.log
  const last = log[log.length - 1]
  if (isActiveSection(last)) {
    const sec = last.data
    const finalLines = sec.pending ? [...sec.lines, sec.pending] : sec.lines
    log = [
      ...log.slice(0, -1),
      {
        kind: "section",
        data: { ...sec, lines: finalLines, pending: null, state: "done" },
      },
    ]
  }
  return { log, topPending: null }
}

export function ServerStateProvider({ children }: { children: React.ReactNode }) {
  const [installs, setInstalls] = React.useState<DetectedInstall[]>([])
  const [detecting, setDetecting] = React.useState(true)
  const [installOpen, setInstallOpen] = React.useState(false)

  const [installStatus, setInstallStatus] =
    React.useState<InstallStatus>("idle")
  const [consoleState, setConsoleState] =
    React.useState<ConsoleState>(EMPTY_CONSOLE_STATE)
  const [installExitCode, setInstallExitCode] = React.useState<number | null>(
    null
  )

  // ── Server-control state ──────────────────────────────────────────────
  const [worldserverStatus, setWorldserverStatus] = React.useState<
    WorldserverStatus | "checking"
  >("checking")
  const [serverActionStatus, setServerActionStatus] =
    React.useState<ServerActionStatus>("idle")
  const [serverActionKind, setServerActionKind] =
    React.useState<ServerActionKind | null>(null)
  const [serverConsoleState, setServerConsoleState] =
    React.useState<ConsoleState>(EMPTY_CONSOLE_STATE)

  // Monotonic id so React keys are stable even if text repeats
  const lineCounter = React.useRef(0)
  const nextId = React.useCallback(() => ++lineCounter.current, [])

  const refreshInstalls = React.useCallback(async () => {
    if (!isTauri()) {
      setDetecting(false)
      return
    }
    setDetecting(true)
    try {
      const result = await trackedInvoke<{ installs: DetectedInstall[] }>(
        "detect_installs"
      )
      setInstalls(result.installs)
    } catch (err) {
      console.error("detect_installs failed", err)
      setInstalls([])
    } finally {
      setDetecting(false)
    }
  }, [])

  React.useEffect(() => {
    void refreshInstalls()
  }, [refreshInstalls])

  const refreshServerStatus = React.useCallback(async () => {
    if (!isTauri()) {
      setWorldserverStatus("notpresent")
      return
    }
    try {
      const status = await trackedInvoke<ServerStatusPayload>(
        "get_server_status"
      )
      setWorldserverStatus(status.worldserver)
    } catch (err) {
      console.error("get_server_status failed", err)
      setWorldserverStatus("notpresent")
    }
  }, [])

  React.useEffect(() => {
    void refreshServerStatus()
  }, [refreshServerStatus])

  // Subscribe to install:* events for the whole app lifetime using the
  // promise-thenable cleanup pattern — StrictMode and HMR safe.
  React.useEffect(() => {
    if (!isTauri()) return

    const outputPromise = listen<InstallOutputEvent>("install:output", (e) => {
      const { stream, line, transient } = e.payload
      setConsoleState((prev) =>
        transient
          ? applyTransient(prev, stream, line, nextId)
          : applyFinal(prev, stream, line, nextId)
      )
    })

    const sectionPromise = listen<InstallSectionEvent>(
      "install:section",
      (e) => {
        if (e.payload.stage === "start") {
          const title = e.payload.title ?? "Section"
          setConsoleState((prev) => applySectionStart(prev, title, nextId))
        } else {
          setConsoleState(applySectionEnd)
        }
      }
    )

    const cleanupPromise = listen<InstallCleanupEvent>(
      "install:cleanup",
      (e) => {
        if (e.payload.stage === "started") {
          setInstallStatus("cleaning")
        }
      }
    )

    const donePromise = listen<InstallDoneEvent>("install:done", (e) => {
      setConsoleState(flushOnTerminate)
      setInstallExitCode(e.payload.code)
      const nextStatus: InstallStatus = e.payload.cancelled
        ? "cancelled"
        : e.payload.success
          ? "succeeded"
          : "failed"
      setInstallStatus(nextStatus)
      const msg = e.payload.cancelled
        ? "Installer cancelled."
        : e.payload.success
          ? `Installer exited cleanly (code ${e.payload.code ?? 0}).`
          : `Installer failed (code ${e.payload.code ?? "?"}${
              e.payload.message ? ": " + e.payload.message : ""
            }).`
      setConsoleState((prev) =>
        applyFinal(prev, "system", msg, nextId)
      )
      if (e.payload.success) {
        void refreshInstalls()
      }
    })

    return () => {
      void outputPromise.then((fn) => fn()).catch(() => {})
      void sectionPromise.then((fn) => fn()).catch(() => {})
      void cleanupPromise.then((fn) => fn()).catch(() => {})
      void donePromise.then((fn) => fn()).catch(() => {})
    }
  }, [nextId, refreshInstalls])

  // ── Server start/stop event subscriptions ────────────────────────────
  React.useEffect(() => {
    if (!isTauri()) return

    const outputPromise = listen<ServerOutputEvent>("server:output", (e) => {
      const { stream, line, transient } = e.payload
      setServerConsoleState((prev) =>
        transient
          ? applyTransient(prev, stream, line, nextId)
          : applyFinal(prev, stream, line, nextId)
      )
    })

    const donePromise = listen<ServerDoneEvent>("server:done", (e) => {
      setServerConsoleState(flushOnTerminate)
      const verb =
        e.payload.action === "start"
          ? "Start"
          : e.payload.action === "stop"
            ? "Stop"
            : "Restart"
      const msg = e.payload.success
        ? `${verb} succeeded.`
        : `${verb} failed${e.payload.code != null ? ` (code ${e.payload.code})` : ""}${
            e.payload.message ? ": " + e.payload.message : ""
          }.`
      setServerConsoleState((prev) => applyFinal(prev, "system", msg, nextId))
      // The celebratory ready-line is the language users have seen in
      // every guide and Gaming Mode launcher since v1.0 — they're looking
      // for it. Fire it on successful start *or* restart (both end with
      // the server running and ready), not on stop.
      if (
        e.payload.success &&
        (e.payload.action === "start" || e.payload.action === "restart")
      ) {
        setServerConsoleState((prev) =>
          applyFinal(prev, "highlight", "AZEROTH IS READY! ⚔️", nextId)
        )
      }
      setServerActionStatus(e.payload.success ? "succeeded" : "failed")
      // Always re-check status — even a failed action may have changed
      // the worldserver's state (e.g. half-started containers).
      void refreshServerStatus()
    })

    return () => {
      void outputPromise.then((fn) => fn()).catch(() => {})
      void donePromise.then((fn) => fn()).catch(() => {})
    }
  }, [nextId, refreshServerStatus])

  const startInstall = React.useCallback(
    async (choices: OnboardingChoices) => {
      if (!isTauri()) {
        setInstallStatus("running")
        setConsoleState({
          log: [
            {
              kind: "line",
              data: {
                id: nextId(),
                stream: "system",
                text: "[browser preview] Tauri runtime not detected — no install will run.",
              },
            },
          ],
          topPending: null,
        })
        return
      }
      setConsoleState(EMPTY_CONSOLE_STATE)
      setInstallExitCode(null)
      setInstallStatus("running")
      try {
        await trackedInvoke("start_install", {
          request: {
            serverType: choices.serverType,
            buildMethod: choices.buildMethod,
            adminUser: choices.adminUser,
            adminPass: choices.adminPass,
            force: choices.force ?? false,
            modules: choices.modules ?? [],
            moduleConfig: choices.moduleConfig ?? {},
          },
        })
      } catch (err) {
        setInstallStatus("failed")
        setConsoleState((prev) =>
          applyFinal(
            prev,
            "system",
            `Failed to launch installer: ${String(err)}`,
            nextId
          )
        )
      }
    },
    [nextId]
  )

  const cancelInstall = React.useCallback(async () => {
    if (!isTauri()) {
      setInstallStatus("cancelled")
      return
    }
    setInstallStatus("cancelling")
    setConsoleState((prev) =>
      applyFinal(
        prev,
        "system",
        "Cancelling… (sending SIGTERM to installer process group)",
        nextId
      )
    )
    try {
      await trackedInvoke<boolean>("cancel_install")
    } catch (err) {
      setInstallStatus("running")
      setConsoleState((prev) =>
        applyFinal(prev, "system", `Cancel failed: ${String(err)}`, nextId)
      )
    }
  }, [nextId])

  const resetInstall = React.useCallback(() => {
    setInstallStatus("idle")
    setConsoleState(EMPTY_CONSOLE_STATE)
    setInstallExitCode(null)
  }, [])

  // ── Server action callbacks ───────────────────────────────────────────
  const startServer = React.useCallback(async () => {
    if (!isTauri()) {
      setServerActionStatus("succeeded")
      return
    }
    setServerConsoleState(EMPTY_CONSOLE_STATE)
    setServerActionKind("start")
    setServerActionStatus("running")
    try {
      await trackedInvoke("start_server")
    } catch (err) {
      setServerActionStatus("failed")
      setServerConsoleState((prev) =>
        applyFinal(prev, "system", `Failed to start: ${String(err)}`, nextId)
      )
    }
  }, [nextId])

  const stopServer = React.useCallback(async () => {
    if (!isTauri()) {
      setServerActionStatus("succeeded")
      return
    }
    setServerConsoleState(EMPTY_CONSOLE_STATE)
    setServerActionKind("stop")
    setServerActionStatus("running")
    try {
      await trackedInvoke("stop_server")
    } catch (err) {
      setServerActionStatus("failed")
      setServerConsoleState((prev) =>
        applyFinal(prev, "system", `Failed to stop: ${String(err)}`, nextId)
      )
    }
  }, [nextId])

  const restartServer = React.useCallback(async () => {
    if (!isTauri()) {
      setServerActionStatus("succeeded")
      return
    }
    setServerConsoleState(EMPTY_CONSOLE_STATE)
    setServerActionKind("restart")
    setServerActionStatus("running")
    try {
      await trackedInvoke("restart_server")
    } catch (err) {
      setServerActionStatus("failed")
      setServerConsoleState((prev) =>
        applyFinal(prev, "system", `Failed to restart: ${String(err)}`, nextId)
      )
    }
  }, [nextId])

  const resetServerAction = React.useCallback(() => {
    setServerActionStatus("idle")
    setServerActionKind(null)
    setServerConsoleState(EMPTY_CONSOLE_STATE)
  }, [])

  const value = React.useMemo<ServerState>(
    () => ({
      installs,
      installed: installs.length > 0,
      detecting,
      refreshInstalls,
      installOpen,
      setInstallOpen,
      openInstall: () => setInstallOpen(true),
      installStatus,
      installLog: consoleState.log,
      installPending: consoleState.topPending,
      installExitCode,
      startInstall,
      cancelInstall,
      resetInstall,
      worldserverStatus,
      refreshServerStatus,
      serverActionStatus,
      serverActionKind,
      serverActionLog: serverConsoleState.log,
      serverActionPending: serverConsoleState.topPending,
      startServer,
      stopServer,
      restartServer,
      resetServerAction,
    }),
    [
      installs,
      detecting,
      refreshInstalls,
      installOpen,
      installStatus,
      consoleState,
      installExitCode,
      startInstall,
      cancelInstall,
      resetInstall,
      worldserverStatus,
      refreshServerStatus,
      serverActionStatus,
      serverActionKind,
      serverConsoleState,
      startServer,
      stopServer,
      restartServer,
      resetServerAction,
    ]
  )

  return (
    <ServerStateContext.Provider value={value}>
      {children}
    </ServerStateContext.Provider>
  )
}

export function useServerState() {
  const ctx = React.useContext(ServerStateContext)
  if (!ctx) throw new Error("useServerState must be used inside ServerStateProvider")
  return ctx
}
