import * as React from "react"
import { listen } from "@tauri-apps/api/event"

import { trackedInvoke, isTauri } from "@/lib/tauri"
import { playSfx } from "@/lib/sfx"

export type InstallVariant = "base" | "npcbots" | "playerbots"

export type DetectedInstall = {
  path: string
  variant: InstallVariant | "unknown"
  /** True when `.dads-mmo-lab/install.json` exists at the install root.
   * False = partial install (clone+compile done, bootstrap didn't run). */
  complete: boolean
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
  /** Skip clone/compile, only run wait-for-server + bootstrap + write-metadata.
   * Used by the "Finish setup" banner on the dashboard when a crash
   * left an install partial. */
  resume?: boolean
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
  /**
   * Latest CMake compile percentage seen in this section's output, parsed
   * from lines like `[ 80%] Building CXX object …`. Drives the progress
   * bar in the collapsed section header. null until the first `[ NN%]`
   * marker shows up (e.g. during the apt-get phase before the compile).
   */
  progress: number | null
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

// ── Modules-page types ──────────────────────────────────────────────────

export type InstalledModule = {
  /** Repo key e.g. `mod-ah-bot`. */
  key: string
  /** Display name e.g. "Auction House Bot". */
  name: string
  module_path: string
  conf_path: string | null
  /** Parsed `key = value` pairs from the module's active conf. */
  conf: Record<string, string>
}

export type GameCharacter = {
  guid: number
  name: string
  account: number
  level: number
  race: number
  class: number
}

// ── Enrichment caches (icon map + tooltip data) ────────────────────
// These two JSON blobs come from the Settings page extractors. We
// load them ONCE at app start into context so:
//   - the Inventory grid and Dashboard paperdoll don't pay the
//     ~250-500ms IPC + parse cost on every navigation back
//   - any future surface that renders items / spells (NPC browser,
//     bag/bank tab, etc.) reads from the same shared state
// Loaders silently no-op if the cache file is missing — pages
// degrade gracefully (icons fall back to entry chits, tooltips
// skip the green Equip/Use lines).

export type SpellEntry = {
  name: string
  description: string
  aura_description: string
  icon: string
}

export type ItemSetEntry = {
  name: string
  items: number[]
  bonuses: { threshold: number; spell_id: number }[]
}

export type TooltipData = {
  spells: Record<string, SpellEntry>
  sets: Record<string, ItemSetEntry>
}

/** UI page-level routing — no router lib, just an enum in context. */
export type ActivePage =
  | "dashboard"
  | "modules"
  | "teleport"
  | "inventory"
  | "settings"
  | "help"

type ServerState = {
  // Detection
  installs: DetectedInstall[]
  installed: boolean
  /** True when at least one install exists AND it has install.json (full bootstrap done). */
  installComplete: boolean
  detecting: boolean
  refreshInstalls: () => Promise<void>
  /** Mark an externally-installed (non-UI) server as a complete, managed
   * install — writes the metadata marker without re-running bootstrap. */
  adoptInstall: () => Promise<void>

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

  // Page routing
  activePage: ActivePage
  setActivePage: (page: ActivePage) => void

  // Modules
  installedModules: InstalledModule[]
  refreshInstalledModules: () => Promise<void>
  /** Derived: AH Bot installed but Account/GUID still placeholder (0). */
  ahbotNeedsConfig: boolean
  /** Characters list, populated on demand by the AH Bot wizard. */
  characters: GameCharacter[]
  refreshCharacters: () => Promise<void>
  /** Apply AH Bot character config + restart worldserver. */
  configureAhbotCharacter: (account: number, guid: number) => Promise<void>

  // Globally-selected "main" character. Surfaced via the sidebar's
  // GlobalCharacterCard and consumed by Inventory/Teleport (and any
  // future page that acts on "the user's character"). Persisted by
  // GUID in settings.json so the choice survives restarts.
  selectedCharacterGuid: number | null
  selectedCharacter: GameCharacter | null
  setSelectedCharacterGuid: (guid: number | null) => Promise<void>
  /** Characters in the sidebar switcher (curated subset), resolved + ordered. */
  switcherCharacters: GameCharacter[]
  /** Add a character to the switcher and make it active. */
  addSwitcherCharacter: (guid: number) => Promise<void>
  /** Remove from the switcher list only — never deletes from the chardb. */
  removeSwitcherCharacter: (guid: number) => Promise<void>

  // Enrichment caches — loaded once at app start, shared by every
  // item-rendering surface. Empty / null means the extractor hasn't
  // been run yet (Settings → Data enrichment). Call
  // `refreshEnrichmentCaches()` after a successful extract to pull
  // the new data in without an app restart.
  iconMap: Record<string, string>
  tooltipData: TooltipData | null
  refreshEnrichmentCaches: () => Promise<void>
}

const ServerStateContext = React.createContext<ServerState | null>(null)

/**
 * Flatten the nested log structure (lines + sections-with-lines) into a
 * plain-text string suitable for a `.txt` download. Sections are
 * annotated with header/footer markers so the user can tell what was
 * inside a collapsed section in the UI. Used by the "Download log"
 * button on the install + server-control screens so users can attach
 * an install transcript to bug reports.
 */
export function serializeLog(
  entries: InstallLogEntry[],
  pending: InstallLogLine | null
): string {
  const out: string[] = []
  for (const entry of entries) {
    if (entry.kind === "line") {
      out.push(entry.data.text)
      continue
    }
    const sec = entry.data
    const tag = sec.state === "active" ? "ACTIVE" : "DONE"
    out.push("")
    out.push(`==== Section: ${sec.title}  [${tag}] ====`)
    for (const line of sec.lines) out.push(line.text)
    if (sec.pending) out.push(sec.pending.text)
    out.push(`==== End: ${sec.title} ====`)
    out.push("")
  }
  if (pending) out.push(pending.text)
  return out.join("\n")
}

const EMPTY_CONSOLE_STATE: ConsoleState = { log: [], topPending: null }

// ── Console-state reducers ──────────────────────────────────────────────
// Pulled out of the component so the install:* handlers stay short and
// the state transitions are easier to read in isolation.

function isActiveSection(
  entry: InstallLogEntry | undefined
): entry is { kind: "section"; data: InstallSection } {
  return entry?.kind === "section" && entry.data.state === "active"
}

/**
 * Pull a CMake build percentage out of a compile line, e.g.
 * `#24 1996.5 [ 80%] Building CXX object …` → 80. Returns null if the line
 * has no `[ NN%]` marker. Powers the section-header progress bar.
 */
function parseCompilePercent(text: string): number | null {
  const m = text.match(/\[\s*(\d{1,3})%\]/)
  if (!m) return null
  const n = Number(m[1])
  return n >= 0 && n <= 100 ? n : null
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
          data: {
            ...sec,
            lines: nextLines,
            pending: newLine,
            progress: parseCompilePercent(text) ?? sec.progress,
          },
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
          data: {
            ...sec,
            lines: nextLines,
            pending: null,
            progress: parseCompilePercent(text) ?? sec.progress,
          },
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
    progress: null,
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

  // ── Page routing + modules state ──────────────────────────────────────
  const [activePage, setActivePage] = React.useState<ActivePage>("dashboard")
  const [installedModules, setInstalledModules] = React.useState<
    InstalledModule[]
  >([])
  const [characters, setCharacters] = React.useState<GameCharacter[]>([])
  const [selectedCharacterGuid, setSelectedCharacterGuidState] = React.useState<
    number | null
  >(null)
  // Curated list of GUIDs in the sidebar character switcher (a subset of
  // `characters`). Persisted; removing only drops from the switcher.
  const [switcherGuids, setSwitcherGuidsState] = React.useState<number[]>([])
  const [iconMap, setIconMap] = React.useState<Record<string, string>>({})
  const [tooltipData, setTooltipData] = React.useState<TooltipData | null>(null)

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

  // Adopt an externally-installed server (no install.json) as a managed,
  // complete install — writes the marker without running the UI bootstrap.
  const adoptInstall = React.useCallback(async () => {
    if (!isTauri()) return
    const target = installs.find((i) => !i.complete) ?? installs[0]
    if (!target) return
    await trackedInvoke("adopt_install", { path: target.path })
    await refreshInstalls()
  }, [installs, refreshInstalls])

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

  // ── Module + character refreshers ─────────────────────────────────────
  const refreshInstalledModules = React.useCallback(async () => {
    if (!isTauri()) {
      setInstalledModules([])
      return
    }
    try {
      const list = await trackedInvoke<InstalledModule[]>(
        "list_installed_modules"
      )
      setInstalledModules(list)
    } catch (err) {
      // Not installed yet, or installer hasn't run the bind mount setup
      // — silent. The Modules page handles the empty case.
      console.warn("list_installed_modules failed:", err)
      setInstalledModules([])
    }
  }, [])

  React.useEffect(() => {
    void refreshInstalledModules()
  }, [refreshInstalledModules, installs])

  const refreshCharacters = React.useCallback(async () => {
    if (!isTauri()) {
      setCharacters([])
      return
    }
    try {
      const list = await trackedInvoke<GameCharacter[]>("list_characters")
      setCharacters(list)
    } catch (err) {
      // Server may not be running yet — the wizard surfaces the error.
      console.warn("list_characters failed:", err)
      setCharacters([])
      throw err
    }
  }, [])

  // Selected-character lifecycle. Load the persisted GUID once on
  // mount; setter pushes both into React state AND back to settings.json
  // so the choice survives restarts. We DON'T validate the GUID against
  // `characters` here — the selectedCharacter selector below resolves
  // it lazily, which gracefully handles "characters list still loading"
  // and "stored GUID is from a chardb that's since been wiped".
  React.useEffect(() => {
    if (!isTauri()) return
    void trackedInvoke<number | null>("get_selected_character_guid")
      .then((g) => setSelectedCharacterGuidState(g ?? null))
      .catch((e) => console.warn("get_selected_character_guid failed", e))
    void trackedInvoke<number[]>("get_switcher_character_guids")
      .then((g) => setSwitcherGuidsState(Array.isArray(g) ? g : []))
      .catch((e) => console.warn("get_switcher_character_guids failed", e))
  }, [])

  // Auto-refresh the characters list when the worldserver is
  // reachable. Without this, the persisted selectedCharacterGuid
  // never resolves to a real character on app start — pickers do
  // their own refresh on open, but the sidebar card needs the list
  // populated BEFORE the user interacts with anything to surface
  // their previous selection. We also re-fetch when the worldserver
  // transitions to "running" so newly-started servers pick up.
  React.useEffect(() => {
    if (!isTauri()) return
    // Fire on EVERY worldserverStatus value (incl. the initial "checking"
    // tick on mount). The DB container is usually up before the
    // worldserver finishes initializing, so this lands characters early;
    // if it isn't ready yet the call quietly errors out and the next
    // status flip re-runs us. Previously gated on === "running", which
    // left the sidebar character picker empty until the first user
    // interaction triggered a re-render.
    refreshCharacters().catch(() => {
      // Quiet — worldserver might be mid-transition.
    })
  }, [worldserverStatus, refreshCharacters])

  // Enrichment-cache loader. Pulls both JSON blobs in parallel; each
  // tolerates failure (sets to empty) so a missing cache file just
  // means consumers degrade gracefully.
  const refreshEnrichmentCaches = React.useCallback(async () => {
    if (!isTauri()) return
    const [iconRes, tooltipRes] = await Promise.allSettled([
      trackedInvoke<Record<string, string>>("load_item_icon_map"),
      trackedInvoke<{
        spells: TooltipData["spells"]
        sets: TooltipData["sets"]
      }>("load_tooltip_data"),
    ])
    setIconMap(iconRes.status === "fulfilled" ? iconRes.value : {})
    setTooltipData(
      tooltipRes.status === "fulfilled"
        ? { spells: tooltipRes.value.spells, sets: tooltipRes.value.sets }
        : null
    )
  }, [])

  // Eager-load on provider mount. The ~5-10MB tooltip JSON is the
  // expensive one — doing it once here at app start (during the
  // welcome / install screen) instead of every Dashboard / Inventory
  // mount eliminates the 250-500ms hang on every navigation back.
  React.useEffect(() => {
    void refreshEnrichmentCaches()
  }, [refreshEnrichmentCaches])

  const setSelectedCharacterGuid = React.useCallback(
    async (guid: number | null) => {
      setSelectedCharacterGuidState(guid)
      if (!isTauri()) return
      try {
        await trackedInvoke("set_selected_character_guid", { guid })
      } catch (e) {
        console.warn("set_selected_character_guid failed", e)
      }
    },
    []
  )

  const persistSwitcherGuids = React.useCallback(async (next: number[]) => {
    setSwitcherGuidsState(next)
    if (!isTauri()) return
    try {
      await trackedInvoke("set_switcher_character_guids", { guids: next })
    } catch (e) {
      console.warn("set_switcher_character_guids failed", e)
    }
  }, [])

  // Add a character to the switcher (dedup) and make it active.
  const addSwitcherCharacter = React.useCallback(
    async (guid: number) => {
      if (!switcherGuids.includes(guid)) {
        await persistSwitcherGuids([...switcherGuids, guid])
      }
      await setSelectedCharacterGuid(guid)
    },
    [switcherGuids, persistSwitcherGuids, setSelectedCharacterGuid]
  )

  // Remove from the switcher list only (never touches the chardb). If the
  // active character was removed, fall back to the first remaining or clear.
  const removeSwitcherCharacter = React.useCallback(
    async (guid: number) => {
      const next = switcherGuids.filter((g) => g !== guid)
      await persistSwitcherGuids(next)
      if (selectedCharacterGuid === guid) {
        await setSelectedCharacterGuid(next[0] ?? null)
      }
    },
    [
      switcherGuids,
      selectedCharacterGuid,
      persistSwitcherGuids,
      setSelectedCharacterGuid,
    ]
  )

  // The switcher list resolved to character objects (drops any GUID whose
  // character no longer exists in the chardb).
  const switcherCharacters = React.useMemo(
    () =>
      switcherGuids
        .map((g) => characters.find((c) => c.guid === g))
        .filter((c): c is GameCharacter => c != null),
    [switcherGuids, characters]
  )

  // Resolved character object. Returns null if (a) nothing's selected,
  // (b) the list hasn't loaded yet, or (c) the GUID refers to a
  // character that no longer exists. Consumers should treat "null" as
  // "no character to act on".
  const selectedCharacter = React.useMemo(() => {
    if (selectedCharacterGuid == null) return null
    return (
      characters.find((c) => c.guid === selectedCharacterGuid) ?? null
    )
  }, [selectedCharacterGuid, characters])

  // Derive whether AH Bot is installed but unconfigured. AH Bot's conf
  // ships with Account=0 / GUID=0 / EnableSeller=0 from
  // install-wow-ui.sh as a placeholder. The bootstrap step (or the
  // post-install wizard) sets Account=<id> and EnableSeller=1.
  //
  // IMPORTANT: GUID=0 alone is NOT a "not configured" signal — per AHB
  // source (AuctionHouseBotWorldScript.cpp:35), GUID=0 with Account>0
  // means "use EVERY character on the account", which is exactly what
  // bootstrap_accounts_and_ahbot configures. The real signal is
  // Account=0 OR EnableSeller!=1. Earlier code that also tripped on
  // GUID=0 flagged the working state as broken.
  const ahbotNeedsConfig = React.useMemo(() => {
    const ahbot = installedModules.find((m) => m.key === "mod-ah-bot")
    if (!ahbot) return false
    const account = ahbot.conf["AuctionHouseBot.Account"] ?? "0"
    const enableSeller = ahbot.conf["AuctionHouseBot.EnableSeller"] ?? "0"
    return account === "0" || enableSeller !== "1"
  }, [installedModules])

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
      if (nextStatus === "succeeded") playSfx("questComplete")
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
        playSfx("levelUp")
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
      playSfx("questActivate")

      // One-time privileged setup (Docker + BuildKit). Pops a single
      // PolicyKit password prompt only when needed — a no-op if Docker is
      // already usable or passwordless sudo is available. Must succeed
      // before the installer runs, or its docker calls would fail.
      try {
        const boot = await trackedInvoke<{
          needed: boolean
          ran: boolean
          message: string
        }>("bootstrap_privileges")
        if (boot.ran) {
          setConsoleState((prev) =>
            applyFinal(prev, "system", `✓ ${boot.message}`, nextId)
          )
        }
      } catch (err) {
        setInstallStatus("failed")
        setConsoleState((prev) =>
          applyFinal(
            prev,
            "system",
            `Setup needs permission — ${String(err)}`,
            nextId
          )
        )
        return
      }

      try {
        await trackedInvoke("start_install", {
          request: {
            serverType: choices.serverType,
            buildMethod: choices.buildMethod,
            adminUser: choices.adminUser,
            adminPass: choices.adminPass,
            force: choices.force ?? false,
            resume: choices.resume ?? false,
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

  const restartServerInternal = restartServer
  const configureAhbotCharacter = React.useCallback(
    async (account: number, guid: number) => {
      if (!isTauri()) return
      await trackedInvoke("configure_ahbot_character", { account, guid })
      // Refresh modules so ahbotNeedsConfig flips to false straight away,
      // before the restart even starts streaming output.
      await refreshInstalledModules()
      // Restart worldserver so the new conf is picked up. The user sees
      // the server-control screen with the live restart output and the
      // celebratory "AZEROTH IS READY!" line on completion.
      await restartServerInternal()
    },
    [refreshInstalledModules, restartServerInternal]
  )

  const value = React.useMemo<ServerState>(
    () => ({
      installs,
      installed: installs.length > 0,
      installComplete: installs.length > 0 && installs.every((i) => i.complete),
      detecting,
      refreshInstalls,
      adoptInstall,
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
      activePage,
      setActivePage,
      installedModules,
      refreshInstalledModules,
      ahbotNeedsConfig,
      characters,
      refreshCharacters,
      configureAhbotCharacter,
      selectedCharacterGuid,
      selectedCharacter,
      setSelectedCharacterGuid,
      switcherCharacters,
      addSwitcherCharacter,
      removeSwitcherCharacter,
      iconMap,
      tooltipData,
      refreshEnrichmentCaches,
    }),
    [
      installs,
      detecting,
      refreshInstalls,
      adoptInstall,
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
      activePage,
      installedModules,
      refreshInstalledModules,
      ahbotNeedsConfig,
      characters,
      refreshCharacters,
      configureAhbotCharacter,
      selectedCharacterGuid,
      selectedCharacter,
      setSelectedCharacterGuid,
      switcherCharacters,
      addSwitcherCharacter,
      removeSwitcherCharacter,
      iconMap,
      tooltipData,
      refreshEnrichmentCaches,
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
