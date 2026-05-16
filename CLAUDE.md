# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

A collection of **Bash installer scripts and Markdown how-to guides** for running classic-MMO private servers offline on a Steam Deck (and WSL2 on Windows). There is no application source code, no package manager, no build system, and no test suite — the deliverables *are* the scripts and the docs.

The audience is non-technical: "dads who love games, not developers." Every user-facing string, prompt, and guide is written for someone who has never opened a terminal before. Preserve that voice in any edits.

## Repository layout

- `README.md` — landing page, supported games table, project ethos.
- `CONTRIBUTING.md` — contribution rules. Note the hard "open-source emulators only / no game assets / no public-server guides" constraints.
- `HOWTO-WINDOWS-WSL2.md` — top-level guide for running the WoW setup on Windows via WSL2.
- `guides/wow-wotlk/` — WoW 3.3.5a / AzerothCore. The most active area.
  - `install-wow.sh` — main wizard: picks Base / NPCBots / Playerbots, installs Docker, clones AzerothCore, starts containers.
  - `manage-wow-modules.sh` — **post-install** tool for adding/removing AzerothCore modules (AH Bot, Solocraft, Transmog, etc.) and start/stop/log/console actions. Auto-detects existing installs under `~/wow-server*`.
  - `uninstall.sh` — safe removal with character backup.
  - `fix-after-update.sh` — rebuilds pacman keyring + reinstalls Docker after a SteamOS update breaks them.
  - `wow-gaming-mode.sh`, `wow-npcbots-launcher.sh`, `wow-playerbots-launcher.sh` — Steam Gaming Mode launchers that start the server, wait for "world initialized", and auto-shut-down when WoW exits.
  - `docker-compose.yml` — reference compose file (worldserver + authserver + MySQL 8). The real installs use `acore-docker` cloned from upstream; this file is for the manual-install guide.
  - `how-to/HOWTO-*.md` — beginner guides paired with each script.
  - `legacy/` — superseded `install.sh` / `install-npcbots.sh`. Do not edit unless explicitly asked.
- `guides/runescape/` — `install-runescape.sh` plus its how-to. Uses the 2009scape Singleplayer Edition (bundled Java + MySQL, no Docker).

The three WoW server variants install into distinct directories so they can coexist:
- Base: `~/wow-server`
- NPCBots: `~/wow-server-npcbots`
- Playerbots: `~/wow-server-playerbots`

`manage-wow-modules.sh` discovers installs by globbing `~/wow-server*` for any directory containing `docker-compose.yml`, then classifies by dir-name suffix or by peeking at `docker-compose.override.yml` and `modules/`.

## Target platform — important

These scripts run on **SteamOS (Arch-based, immutable rootfs)** and on **Ubuntu under WSL2**. Two practical consequences:

1. **Package manager assumptions**: code paths handle both `pacman` (SteamOS) and `apt-get` (WSL2 / Ubuntu). See `install_git()` in `install-wow.sh` for the pattern — try `pacman`, fall back to `apt-get`, warn (don't fail) if neither works.
2. **SteamOS quirks**: `steamos-readonly disable` is called before package installs; pacman keyring is checked with `check_pacman_keyring()` and only reset after user confirmation (never silently — a previous version did, and broke user systems).
3. **Docker permissions**: after installing Docker the scripts add the user to `docker` group *and* write a `NOPASSWD` sudoers rule for `docker`/`docker-compose`, *and* chmod the socket, *and* fall back to `function docker() { sudo docker "$@"; }` — because group membership doesn't take effect mid-session.

When writing new install logic, follow the same "try the clean way, fall back, never silently fail" pattern.

## Script conventions

All scripts in this repo follow a shared style — match it when editing or adding scripts:

- Header banner with project name, version, GitHub URL, usage, and changelog comment block.
- `set -o pipefail` at the top (not `set -e` — the scripts handle errors explicitly and report human-readable messages).
- ANSI color constants (`RED`, `GREEN`, `YELLOW`, `BLUE`, `CYAN`, `WHITE`, `NC`/`RST`, `BOLD`) and helpers: `print_header`, `print_step`, `print_success`, `print_warning`, `print_error`, `print_info`, `ask_yes_no`, `press_enter`.
- Steps numbered for the user ("STEP 1/6 — Choose Your Experience").
- Errors are *explained*, not just `exit 1`. Tell the user what to do next ("Try rebooting and running the installer again", "Run install-wow.sh first").
- Destructive operations (keyring reset, removing an existing install, uninstall) always require a typed `yes` confirmation, not just `y`.
- Container/service names: `ac_database`, `ac_authserver`, `ac_worldserver`. Network: `dads_mmo_network`. Volume: `dads_mmo_wow_db`.

## Running and developing locally

There is nothing to "run" on Windows for this project itself — the scripts only execute on Linux (SteamOS / WSL2 / Ubuntu). The repo on Windows is for editing.

- **Lint a bash script before committing**: `shellcheck guides/wow-wotlk/install-wow.sh`
- **Smoke-test syntax without running**: `bash -n guides/wow-wotlk/install-wow.sh`
- **Real testing** requires a Steam Deck or a WSL2 Ubuntu instance. The "fast install" path for NPCBots (~10 min, prebuilt images) is the cheapest end-to-end test; Playerbots compiles from source and takes 2-4 hours — avoid in normal dev loops.

## Editing rules specific to this project

- **Never link to, document, or assume the existence of copyrighted game clients or server binaries.** Users supply their own clients; we only orchestrate open-source emulators. This is non-negotiable per `CONTRIBUTING.md`.
- **Voice**: plain English, no jargon without explanation, instructions paste-able as-is. When unsure, read any `how-to/HOWTO-*.md` for the tone.
- **Don't introduce new languages or runtimes** (Python, Node, Go, etc.). The whole point is "one shell script, no dependencies the user has to manage."
- The two videos linked in `README.md` (`youtu.be/0XwLmaz3tao`, `youtu.be/GVUVnngY93I`) are real — don't replace them with placeholders.
- The `.vscode/settings.json` entries about `bg3ModHelper` appear unrelated to this project (looks like a stray VSCode extension config). Don't rely on them.

# CODING & BEHAVIORAL GUIDELINES
Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.