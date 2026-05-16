# Dad's MMO Lab — UI Vision

> A unified install-and-manage UI for the offline WoW 3.3.5a (AzerothCore) server, designed for couch-mode use on a Steam Deck.

---

## 1. Background — what already works

The server side of this project is **done and battle-tested**:

- **AzerothCore** is the open-source WoW 3.3.5a server emulator. It already implements all game logic, persistence, GM commands, and module hooks.
- Variants live side-by-side under `~/wow-server`, `~/wow-server-npcbots`, `~/wow-server-playerbots`. Each is a Docker Compose stack (MySQL + authserver + worldserver).
- `install-wow.sh` walks the user through choosing a variant and modules, then installs and starts the server.
- `manage-wow-modules.sh` post-install: detects existing installs, starts/stops/restarts containers, tails logs, attaches to the worldserver console, and adds/removes AzerothCore modules.
- `wow-gaming-mode.sh` (and per-variant launchers) are registered as **Steam Non-Steam games** so the user launches the server from Gaming Mode just like any other title.
- The WoW 3.3.5a client itself is a **separate Non-Steam game entry** that connects to `localhost`.

Modules already wired in via `MODULE_REGISTRY` in `manage-wow-modules.sh`: Auction House Bot, Solocraft, AoE Loot, Learn Spells on Levelup, Individual Progression, AutoBalance, Transmog, 1v1 Arena, NPCBots, Playerbots.

## 2. The problem — what the user has to do today

Even with the install streamlined, **running the server is still a CLI experience**:

- All GM-level operations happen by running `docker attach ac_worldserver` and typing console commands (`account create`, `.gm on`, `.additem`, `.npcbot spawn`, etc.).
- Module-specific behavior (AH Bot population, bot wander settings, individual progression phase) requires editing `.conf` files on disk and restarting.
- "Power-user" persistence — gear loadouts, saved NPC party comps, bot configuration presets — doesn't exist. Every session re-types the same commands.
- On a Steam Deck this is especially painful: tabbing from the WoW client out to Konsole, typing commands with the on-screen keyboard or via SSH, and tabbing back kills the couch-game vibe the project is explicitly built around.

## 3. The vision — what we want to build

A **single companion UI** the user can run alongside the WoW client (Alt+Tab / Steam overlay on the Deck) that owns both the *first-run install* and the *ongoing in-session management*.

### 3.1 Two modes, one app

**Mode A — First-run walkthrough.**
- Detects whether a server is already installed; if not, runs an interactive installer that mirrors `install-wow.sh` but with proper UI controls (radios for variant, checkboxes for modules, progress bars, confirm dialogs) instead of color-coded `read -r` prompts.
- Surfaces all decisions the existing scripts ask about (Base / NPCBots / Playerbots; pre-built vs source build; which modules to enable) and explains them with non-technical copy that matches the existing "dad-friendly" voice.
- Handles account creation, GM-level assignment, and the realmlist.wtf edit as UI steps with clear before/after state.

**Mode B — Live management dashboard.**
- Becomes the default mode once any `~/wow-server*` install is detected.
- Shows server status (containers running, world initialized, players online, current uptime) and gives one-tap start / stop / restart.
- Exposes the operations that currently require the worldserver console or `.conf` editing as UI controls.

### 3.2 In-session player tooling

While the user is logged in and playing, the UI should let them do — with buttons, dropdowns, sliders, toggles — everything they'd otherwise type at the GM console:

- **Character editor**: toggle god mode / fly / speed, set level, set gold, add/remove items by search, learn spells, learn talents, change faction or race.
- **Inventory & gear**: item search with filters (slot, quality, level, stat), one-click add to bags, repair, full bag clear.
- **World**: teleport to known locations (city dropdown + custom-coord input), change weather, set time of day.
- **NPC / mob spawning**: spawn picker with search, despawn nearby, "summon corpse" type quality-of-life.

### 3.3 Bot tooling — the headline feature

NPCBots and Playerbots are the two killer features for solo play. The UI should make these *actually usable* without memorizing commands:

- **NPCBots party manager**: pick class + spec from a roster, drag-to-reorder, save full party as a named preset ("Heroic 5-man", "Naxx 10", "Levelling Duo"), one-click summon-and-equip.
- **Bot loadout presets**: per-bot gear profile saved to local storage; "Apply preset" pushes the items to the bot's inventory and equips them.
- **Wandering Playerbots config**: sliders / toggles for bot count, level range, faction balance, behavior flags — write back to the relevant `.conf` and (if needed) restart the worldserver.
- **Bot AI tuning**: expose the existing `aibot.conf` style knobs (combat priorities, follow distance, loot rules) as form controls.

### 3.4 Player-side persistence — things AzerothCore won't do for you

These are the features that genuinely *don't exist today* and would be the UI's unique value-add:

- **Gear hot-swap sets**: save your currently equipped items as a named set, hot-swap on demand. (DB-backed snapshot of `character_inventory` + `character_equipment` rows for the active character.)
- **Saved NPC party presets**: as above for bots — composition + gear + per-bot config.
- **Module config presets**: save the current `worldserver.conf` module section as a named profile ("Hardcore", "Casual weekend", "Bring-a-friend") and switch between them.
- **Session bookmarks**: "remember where I was, what was in my bags, what bots I had out" — restore on next launch.

### 3.5 Module surface area

For each module already in `MODULE_REGISTRY`, expose its meaningful runtime parameters as UI:

- **AH Bot**: enable/disable, item count, price range, refresh cadence, bot character name.
- **Solocraft**: scaling on/off, multiplier per role.
- **Transmog**: cost, faction-restricted yes/no.
- **Individual Progression**: current phase (Vanilla / TBC / WotLK), per-character override.
- **AutoBalance**: difficulty curve.
- **1v1 Arena**: enabled, queue config.

## 4. How it talks to the system

The UI is a thin layer over things that already exist. Three integration surfaces:

1. **Shell scripts**: invoke `install-wow.sh`, `manage-wow-modules.sh`, the launchers, and `uninstall.sh` as subprocesses. Stream stdout/stderr to a UI log panel. Mostly used during install and module-add operations.
2. **Worldserver console**: pipe GM commands into `docker attach ac_worldserver` (or `docker exec` against the running worldserver) for in-session actions like `.additem`, `.npcbot spawn`, `.teleport`.
3. **MySQL directly**: connect to the `ac_database` container (port 3306, configured root password) for things the console can't do cleanly — bulk gear-set save/restore, scanning `character_inventory` for the gear-set feature, reading account/character lists for the UI's character picker, writing preset metadata to our own tables.

The UI never re-implements game logic. It only:
- Renders what's in the DB / config files,
- Sends commands the server already understands,
- Saves its own UI-layer metadata (presets, bookmarks) to its own tables or local files.

## 5. Constraints & non-goals

**Constraints:**

- **Steam Deck first.** The UI must be usable at 1280×800, touch-friendly, and reachable via Steam overlay or Alt+Tab while WoW is in the foreground.
- **Local-only.** No cloud. No accounts. No telemetry. The whole project's value is offline-forever.
- **Plays nice with existing scripts.** The shell scripts stay the source of truth for install/uninstall/module add — the UI is a frontend over them, not a replacement that diverges.
- **Dad-friendly voice.** Same plain-English copy as the existing guides. No jargon without an explanation.

**Non-goals:**

- Not a server *emulator* — AzerothCore is the emulator, we're a frontend.
- Not a multi-server admin panel. One server per install, one user, one machine.
- Not a public-server tool. Personal offline use only, same as the rest of the project.
- Not a replacement for the CLI scripts — those still need to work standalone for users who prefer them.

## 6. Open questions for the tech-stack discussion

These are what I want to lock down next:

1. **Runtime target** — does the UI run as a desktop app on the Deck (Electron/Tauri/native), as a browser tab against a local web server, or both?
2. **Process model** — single process that shells out, or split client/server with the backend owning the DB connection and shell execution?
3. **State store** — do we add our own tables inside `ac_database`, use a separate SQLite alongside the install, or stick to JSON files in `~/.wow-server-ui/`?
4. **In-game integration** — pure out-of-game companion app, or also ship an in-game addon (Lua, like every WoW UI mod) that talks to the companion?
5. **Reaching the worldserver** — `docker attach` (stateful, ugly to parse), `docker exec`, SOAP (AzerothCore exposes a SOAP endpoint for GM commands), or direct DB writes?
6. **Distribution** — one more `install-*.sh` that the user runs from Konsole, an AppImage / Flatpak, or both?

---

*This document captures intent only. Concrete architecture and tech-stack decisions land in a follow-up doc once we've agreed on the answers to §6.*
