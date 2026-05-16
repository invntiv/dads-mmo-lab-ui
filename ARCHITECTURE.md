# Dad's MMO Lab UI — Architecture

> Companion to [VISION.md](./VISION.md). This doc answers the *how* — stack, process model, integration surfaces, phasing.

---

## 1. Stack

- **Shell**: Tauri 2 (Rust core + system WebView).
- **Frontend**: React + Vite + shadcn/ui + Tailwind CSS, bootstrapped with [`create-tauri-ui`](https://github.com/agmmnn/tauri-ui) (`bunx create-tauri-ui@latest <project-name> -t vite` → React + shadcn). The project root lands in a new subdirectory named after the positional arg — scaffolding into `.` is not supported, so we run the command from `guides/wow-wotlk/` with `ui` as the name to produce `guides/wow-wotlk/ui/`.
- **Package manager**: Bun.
- **Rust crates (backend)**:
  - `tokio` — async runtime
  - `sqlx` (mysql, runtime-tokio-rustls) — typed MySQL queries
  - `reqwest` — HTTP client for SOAP
  - `quick-xml` or `serde_xml_rs` — SOAP envelope encode/decode
  - `serde` + `serde_json` — JSON state store
  - `tauri-plugin-shell` — sandboxed subprocess execution

**Why this stack:** small binary (~10 MB), cross-platform out of the box (Linux/SteamOS today, Windows later — same codebase), Rust backend gives a clean place for the MySQL pool, SOAP client, and shell-out logic so the frontend never touches anything dangerous.

## 2. Process model

One Tauri process. Inside it:

- **WebView (frontend)** — renders UI. Calls into the backend only through declared `#[tauri::command]` handlers. Subscribes to events for streaming output (logs, server-state changes).
- **Rust backend** — owns:
  - Detection of existing installs (`~/wow-server*`)
  - Spawning shell scripts (`install-wow.sh`, `manage-wow-modules.sh`, launchers, `uninstall.sh`) and streaming stdout/stderr back as Tauri events.
  - Docker control (`docker compose up/down`, `docker logs`, `docker ps`, `docker exec`) — same scripts the existing launchers use.
  - MySQL connection pool to `ac_database` (port 3306, default user `root` / password `azeroth` or `password` depending on which compose file was used).
  - SOAP client to `ac_worldserver` (port 7878, HTTP Basic with the user's GM account).
  - JSON state store under `~/.dads-mmo-lab-ui/`.

The frontend cannot exec, cannot open sockets, cannot read arbitrary files. Everything goes through Rust.

## 3. Integration surfaces (in priority order)

| # | Surface | Used for | Phase |
|---|---------|----------|-------|
| 1 | **Shell scripts** (spawn as child process) | Install / uninstall / module add / start / stop. Source of truth — never duplicate this logic in Rust. | 1 |
| 2 | **Docker CLI** | Container status, healthcheck-style "is the world initialized" log polling, fallback `docker exec` for sending console commands when SOAP isn't available. | 1 |
| 3 | **MySQL direct** to `ac_database` | Reading: account list, character list, inventory, equipped gear, bot rosters. Writing: gear-set snapshot/restore, preset metadata in our own tables (later — JSON files first). | 2 |
| 4 | **SOAP** to `ac_worldserver` on `:7878` | Sending GM commands (`.npcbot spawn`, `.additem`, `.teleport`, `.account set gmlevel`) over HTTP Basic. Same command set as the worldserver console, gated by RBAC. | 3 |

### 3.1 SOAP enablement (the only upstream-adjacent thing)

`SOAP.Enabled` is `0` by default in stock AzerothCore. `acore-docker` maps port 7878 externally but leaves SOAP disabled inside the container. To flip it on:

1. Read the mounted `worldserver.conf` (path varies by install — typically `<install>/config/worldserver.conf` or inside the `ac-config` volume).
2. Ensure these three keys are present:
   ```
   SOAP.Enabled = 1
   SOAP.IP      = 0.0.0.0
   SOAP.Port    = 7878
   ```
3. Restart the worldserver container.

The Tauri app does this idempotently as part of its first-run handshake — no upstream PR required to ship the prototype. The upstream contribution (defaulting SOAP on in `install-wow.sh` for new installs) is a follow-up.

The default `admin/admin` account that `install-wow.sh` creates at GM level 3 is sufficient credentials.

## 4. State model

**Authoritative state** lives where it already lives — we don't copy it:

| State | Lives in | We do |
|-------|----------|-------|
| Characters, inventory, accounts, world data | AzerothCore MySQL DB | Read on demand. Write only via SOAP or scripts. |
| Module list, server config | `worldserver.conf`, `modules/` dir, `docker-compose.override.yml` | Read on demand. Write via `manage-wow-modules.sh`. |
| Container state | Docker daemon | Read via `docker ps` / `docker logs`. |

**Our own state** (UI-layer metadata) lives in `~/.dads-mmo-lab-ui/`:

```
~/.dads-mmo-lab-ui/
├── settings.json          # UI prefs, last-active install, GM account creds (keyring-backed later)
├── presets/
│   ├── parties/           # named NPCBot party comps
│   │   └── heroic-5man.json
│   └── modules/           # named worldserver.conf profiles
│       └── hardcore.json
├── gear-sets/
│   └── <character>/       # one folder per character
│       └── pvp-burst.json
└── logs/                  # captured script output for the in-app log viewer
```

JSON files for now. If a feature outgrows JSON (likely candidates: gear sets if we want per-item history), promote that single feature to its own SQLite DB or to a custom table in `ac_database`. Avoid premature schema design.

## 5. Architecture diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                                                                     │
│  Tauri App  (dads-mmo-lab-ui)                                       │
│                                                                     │
│  ┌──────────────────────────────┐  ┌──────────────────────────────┐ │
│  │  WebView (Frontend)          │  │  Rust Backend                │ │
│  │  ────────────────────────    │  │  ────────────────────────    │ │
│  │  React · Vite · shadcn       │◀─┼─▶ #[tauri::command] handlers │ │
│  │  Tailwind · Bun              │  │   Tauri events (streaming)   │ │
│  │                              │  │                              │ │
│  │  Screens:                    │  │  Modules:                    │ │
│  │   ▸ Big Play/Stop button     │  │   ▸ install_detector         │ │
│  │   ▸ Status / health panel    │  │   ▸ script_runner            │ │
│  │   ▸ Server log viewer        │  │   ▸ docker_controller        │ │
│  │   ▸ Character editor   (P2)  │  │   ▸ mysql_client (sqlx)      │ │
│  │   ▸ Bot party manager  (P3)  │  │   ▸ soap_client (reqwest)    │ │
│  │   ▸ Gear sets          (P4)  │  │   ▸ config_patcher           │ │
│  │   ▸ Preset library     (P4)  │  │   ▸ json_state_store         │ │
│  └──────────────────────────────┘  └────────────────┬─────────────┘ │
│                                                     │               │
└─────────────────────────────────────────────────────┼───────────────┘
                                                     │
            ┌────────────────┬───────────────────────┼────────────────────┐
            │                │                       │                    │
            ▼                ▼                       ▼                    ▼
  ┌──────────────────┐  ┌──────────────┐  ┌─────────────────────┐  ┌────────────┐
  │ Shell scripts    │  │ Docker CLI   │  │ AzerothCore stack   │  │ Local FS   │
  │ ───────────────  │  │ ───────────  │  │ ─────────────────── │  │ ────────── │
  │ install-wow.sh   │  │ ps · logs    │  │ ac_database  :3306  │◀─┤ ~/.dads-   │
  │ manage-wow-...sh │  │ compose      │  │ ac_authserver :3724 │  │ mmo-lab-ui │
  │ wow-*-launcher   │  │ exec         │  │ ac_worldserver:8085 │  │   /presets │
  │ uninstall.sh     │  │              │  │           SOAP:7878 │  │   /gear    │
  │ fix-after-update │  │              │  │                     │  │   /logs    │
  └──────────────────┘  └──────┬───────┘  └──────────┬──────────┘  └────────────┘
                               │                     ▲
                               │  manages            │  MySQL (sqlx)
                               └────────────────────▶│  SOAP   (reqwest)
                                                     │  docker exec (fallback)
                                                     │
```

**Reading the diagram:**
- The frontend never talks to anything below the Rust backend.
- Phase 1 only uses the leftmost two columns (shell scripts + Docker CLI). The AzerothCore stack box is treated as an opaque "is it running yes/no" until later phases.
- MySQL and SOAP arrows light up in Phase 2+ once we start reading characters and sending GM commands.
- `docker exec` against `ac_worldserver` is the **fallback path** for sending GM commands when SOAP isn't enabled — useful for Phase 1 sanity checks and as a permanent escape hatch.

## 6. Phasing

### Phase 1 — Big red button (MVP)
*Goal: replace the "launch the Steam Non-Steam game" step with a real UI.*

- Scaffold the Tauri project: from `guides/wow-wotlk/`, run `bunx create-tauri-ui@latest ui -t vite` (produces `guides/wow-wotlk/ui/`).
- Install detection: scan `~/wow-server*` for `docker-compose.yml`. Show "not installed" / "installed: <variant>" state.
- **Play button**:
  - If not installed → run `install-wow.sh`, stream output to a log panel, show the same wizard steps the script asks about (variant + build method) as proper UI controls *before* invocation (eventually — for MVP, just shell out and let the user type into the embedded terminal output).
  - If installed → `docker compose -f <path> up -d`, poll `docker logs ac_worldserver` for `World initialized`, transition status: `starting → ready → running`.
- **Stop button** → `docker compose down`.
- Status panel: container state, uptime, "World initialized" yes/no.
- Embedded log viewer (server logs + script output).
- **Gate**: the rest of the app's UI (tabs for character/bots/presets) is *visible but disabled* until status is `running`.

**Exit criteria:** I can install, start, and stop the server entirely from the Tauri app on a Steam Deck without opening Konsole.

### Phase 2 — Read-only situational awareness
- MySQL connection to `ac_database`. Sqlx schema for `account`, `character`, `character_inventory`, `item_template`.
- Character picker UI (dropdown listing characters on the active account).
- Read-only inventory view + equipped gear preview.
- Account list, GM-level display.

**Exit criteria:** I can see who exists on the server and what they're wearing.

### Phase 3 — SOAP comes online
- Config patcher writes `SOAP.Enabled = 1`, `SOAP.IP = 0.0.0.0` into the mounted `worldserver.conf`. Restart prompt.
- SOAP client + auth (use the `admin` account `install-wow.sh` creates).
- First GM commands wired through:
  - `.additem <id> [count]` (item search UI → add to selected character)
  - `.teleport <location>` (city dropdown)
  - `.npcbot spawn <class>` + `.npcbot delete`
  - `.account set gmlevel <name> <level>`
- Toast notifications for command success/failure.

**Exit criteria:** Common GM operations are point-and-click; the worldserver console is no longer required for them.

### Phase 4 — Persistence layer (the real value-add)
- Gear sets: snapshot `character_inventory` + `character_equipment` for a character, save as named JSON. "Apply" pushes the items back via SOAP `.additem` + `.equip` (or direct DB write if SOAP can't).
- NPCBot party presets: roster + bot config saved per name, "Summon party" runs the sequence of `.npcbot spawn` commands.
- Module config profiles: snapshot of relevant `worldserver.conf` keys, "Apply" patches the conf and restarts.

**Exit criteria:** I can save and restore play states. This is the moment the UI does something AzerothCore can't.

### Phase 5 — Polish & distribution
- Steam Deck-tuned styling (1280×800, touch targets, controller-friendly focus).
- AppImage / single-file binary build.
- One-liner installer that drops the binary, registers a desktop entry, adds it as a Steam Non-Steam game.
- Eventually: Windows MSI build (Tauri does this with zero code change — just `cargo tauri build` on Windows).

## 7. Risks & open items

1. **acore-docker config volume layout** isn't fully verified — we need to confirm exactly which file the worldserver mounts as its config so the patcher writes to the right place. To check during Phase 1 setup.
2. **Default MySQL password** differs between this repo's `docker-compose.yml` (`azeroth`) and upstream `acore-docker` (`password`). The Rust client needs install-aware credential detection — read it out of the compose file rather than hardcoding.
3. **SOAP command coverage** — not every `.dot` command is exposed over SOAP; some require local-console access. We'll discover the boundaries empirically in Phase 3. The `docker exec` fallback covers the rest.
4. **Concurrent installs** — `manage-wow-modules.sh` already handles multiple `~/wow-server*` directories with a picker. The UI needs the same "which install are you targeting?" affordance up front.
5. **`docker-compose.override.yml`** is generated by `install-wow.sh` for the phpMyAdmin port fix. We must preserve it (never overwrite blindly) when patching configs.

---

*Next step after this doc is approved: scaffold the Tauri project (`cd guides/wow-wotlk && bunx create-tauri-ui@latest ui -t vite`) and stub the Phase 1 install-detector + start/stop commands.*
