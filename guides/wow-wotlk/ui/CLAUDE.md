# CLAUDE.md — UI subproject

Scoped guidance for the Tauri management/install UI at `guides/wow-wotlk/ui/`. The repo-root `CLAUDE.md` describes the wider scripts-and-guides repo. The planning docs at the repo root cover *what* and *why*:

- `VISION.md` — product vision (install + management UI for the offline WoW server)
- `ARCHITECTURE.md` — stack, integration surfaces, phasing

This file tells you *where things are now* and *how to work on them*.

## Stack

- **Tauri 2** (Rust shell + system WebView)
- **React + Vite + TypeScript**
- **shadcn/ui + Tailwind CSS v4** — primitives live in `src/components/ui/`
- **Phosphor icons** (`@phosphor-icons/react`) — **always use the `*Icon` suffix** (`PlayIcon`, not `Play`; bare names are deprecated and TypeScript flags them)
- **Bun** as package manager and JS runtime

Scaffolded with `create-tauri-ui` (Vite + React preset).

## Dev setup on Arch / Omarchy / SteamOS

```sh
# Bun
curl -fsSL https://bun.sh/install | bash

# Rust (for Tauri's Rust backend) — install rustup, default toolchain
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Tauri 2 Linux system deps (cross-check current Tauri docs if anything's missing)
sudo pacman -S --needed \
  webkit2gtk-4.1 base-devel curl wget file openssl \
  appmenu-gtk-module libappindicator-gtk3 librsvg

# Project
cd guides/wow-wotlk/ui
bun install
bun run tauri dev
```

If `bun install` fails with an `msw` postinstall error, run `pnpm install` once instead — there's a known msw + bun postinstall incompatibility. Daily dev still uses `bun`.

## Current state (as of 2026-05-16)

**What renders:**
- Sidebar header shows the WoW logo (custom `<WowIcon>`) + "WoW 3.3.5a Server"
- Prominent `INSTALL SERVER` button — `FloppyDiskBackIcon` + right-aligned `ArrowRightIcon`, 25% taller than default sidebar buttons. Will swap to Play/Stop icons once server detection is wired.
- Main content gates on `installed` from `ServerStateContext`:
  - `installed === false` (default): `<WelcomeScreen>` — placeholder logo div, "Install server to get started", big Install button
  - `installed === true`: `<DemoDashboard>` — preserved starter content (charts/cards/datatable). Acts as a placeholder until we build the real server dashboard.
- Header title is dynamic via `SiteHeader title=...` (`Welcome!` vs `Documents`)
- Both Install buttons (sidebar + welcome) open the same `<InstallOnboarding>` 4-step modal: server type → modules → admin account → summary
- All non-Install nav items grey out when no server: `disabled` attribute for button-wrapped items in `nav-main`, `pointer-events-none opacity-50` for anchor-wrapped items in `nav-documents` and `nav-secondary`
- Dev-mode debug panel (Ctrl+D) is the starter's, untouched

**What's hardcoded / stubbed:**
- `installed = false` in `server-state-context.tsx`. The TODO comment marks the swap-in point.
- Onboarding modal's final button just closes the modal — does not actually run `install-wow.sh` yet.
- No Tauri commands exist beyond the scaffold's `greet` demo.

**Next obvious slices** (see `ARCHITECTURE.md` §6 for full phasing):
1. **Install detection** — Tauri command that scans `~/wow-server*` for a `docker-compose.yml`, returns the variant. Replaces hardcoded `installed = false`.
2. **Wire the install button** to spawn `install-wow.sh` via `tauri-plugin-shell`, stream stdout to a log panel.
3. **Container control** — `docker compose up/down` via shellout, drives the button mode flip (Install → Start → Stop).
4. **SOAP first command** — flip `SOAP.Enabled = 1` in mounted `worldserver.conf`, authenticate as the install's admin account, send first `.dot` command end-to-end (see `ARCHITECTURE.md` §3.1).

## File map

```
src/
├── App.tsx                              ← Provider tree + Welcome/Demo page switcher
├── main.tsx                             ← Root mount + dev DebugPanel
├── assets/icons/                        ← WoW logo SVGs (480px is canonical; 48/96 are redundant copies)
├── components/
│   ├── server-state-context.tsx         ← Single source of truth: installed, installOpen, openInstall
│   ├── welcome-screen.tsx               ← Install-first landing page
│   ├── demo-dashboard.tsx               ← Preserved starter demo (charts/cards/table)
│   ├── install-onboarding.tsx           ← Multi-step install modal (4 steps)
│   ├── wow-icon.tsx                     ← <WowIcon size={N} /> — img-based, scalable
│   ├── app-sidebar.tsx                  ← Sidebar shell + hardcoded nav data
│   ├── nav-main.tsx                     ← Install button + main nav (items disabled when no server)
│   ├── nav-documents.tsx                ← Documents nav (greyed when no server)
│   ├── nav-secondary.tsx                ← Settings/Help/Search (greyed when no server)
│   ├── site-header.tsx                  ← Takes a required `title` prop
│   ├── debug-panel.tsx                  ← Starter's dev-mode inspector (Ctrl+D)
│   └── ui/                              ← shadcn primitives — add new ones via `bunx shadcn@latest add <name>`
├── index.css                            ← Tailwind v4 theme tokens + global scrollbar + Edge ::-ms-reveal suppression
└── lib/utils.ts                         ← cn(), Tauri helpers
```

Rust backend at `src-tauri/`. Currently scaffold-default; new commands go in `src-tauri/src/` exposed via `#[tauri::command]`.

## Conventions

- **Shared server state** goes through `useServerState()` — don't reach for local `useState` if more than one component needs to react to it.
- **shadcn primitives only** — no other component libraries. Add with `bunx shadcn@latest add <name>` and the file lands in `src/components/ui/`.
- **Phosphor v2 naming** — always use the `*Icon` suffix. Bare exports trigger TS deprecation warnings.
- **Icon sizing inside SidebarMenuButton** — the cva variant sets `[&_svg]:size-4`. Override with `[&_svg]:size-5!` (or other size). The `!` matters; twMerge doesn't reliably collapse arbitrary variants.
- **Themed scrollbars are global** — `index.css` styles `::-webkit-scrollbar` against `var(--foreground)` via `color-mix`. No per-component wrapping needed.
- **Steam Deck resolution** — design target is **1280×800**. The onboarding modal at 900×560 was sized specifically to leave Deck-friendly margins; test new modals at this resolution.
- **No new languages/runtimes at the repo level** (per root `CLAUDE.md`). Rust is the lone exception, scoped to `src-tauri/`.
- **Tauri commands** are the only path from the WebView to anything dangerous (shell, FS, DB, SOAP). The frontend never calls those APIs directly.

## Known issues / cleanup candidates

- `install-wow.sh` (the bash installer the UI will eventually call) hardcodes the `deck` username in its NOPASSWD sudoers rule. Will need generalization for Omarchy + non-Steam Deck Linux — use `$USER` instead of `deck`.
- `src/assets/icons/icons8-world-of-warcraft-{48,96}.svg` are identical vector content to the 480 — safe to delete.
- `nav-main.tsx` still imports `Button` (unused after an earlier inline edit). Trivial.
- `site-header.tsx` has `title` as a required prop with no default — adding a new page will be a compile error until you pass the title from `App.tsx`. Intentional.

## When in doubt

1. Check `ARCHITECTURE.md` §6 for what phase we're targeting.
2. Look at the surrounding component for conventions before introducing a new pattern.
3. Smoke test: `bun run tauri dev`, click `INSTALL SERVER`, walk through all 4 steps, hit confirm — should land back at the welcome screen with no errors.
