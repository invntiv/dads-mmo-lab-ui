# Work Goals — 2026-05-27

Planning doc for the current sprint. Pairs with the SteamOS & multi-server audit:
**[STEAMOS_AND_MULTI_SERVER_AUDIT.md](STEAMOS_AND_MULTI_SERVER_AUDIT.md)** — read first; this doc references its findings rather than restating them.

The five tracks below are not strictly ordered, but the **Pre-flight** items (OTA + uninstall) gate a lot of the rest because they make it safe to ship the more invasive module changes.

---

## Track 1 — OTA Updates with transactional migrations

### Goal
The Lab can ship a new AppImage, and when users update to it, all *user data* (settings, install metadata, local caches, WoW server SQL schemas, etc.) gets migrated forward **transactionally** — either every migration step succeeds or the update is rolled back entirely. No partial states.

### Why this is the top priority
- Every other change in this doc (AHBot Plus migration, module config editor, etc.) writes data to user-owned places. Without a versioned migration story, those writes become irreversible footguns for users on older builds.
- We already have the Tauri updater signing keys (in `src-tauri/.secrets/updater.key`) and `createUpdaterArtifacts: true` produces `.sig` files. The plumbing is half-built — we just need GitHub Releases or Actions to host the `latest.json` manifest the updater polls.
- Migrations also unlock the **AHBot → AHBot Plus** swap (Track 2) without breaking existing AHBot installs.

### What "transactional" means here
A migration touches one or more of:
1. `~/.config/dads-mmo-lab/settings.json` (app-level prefs)
2. `~/wow-server*/.dads-mmo-lab/install.json` (per-install metadata)
3. AzerothCore SQL schemas (acore_auth / acore_characters / acore_world / acore_playerbots)
4. Module configs in `<install>/modules/<mod>/*.conf` and AC `worldserver.conf`
5. Local caches (icon cache, tooltip cache, talent dataset)

The migration runner needs to:
- Snapshot each affected resource BEFORE the migration (file copy for JSON/conf; `mysqldump --single-transaction` for schemas)
- Apply migration steps in order, halting on first error
- On any failure: restore from snapshot, mark the update as failed, refuse to launch the new binary, keep the user on the old version (the AppImage update mechanism is binary-replace; we need to keep the old `TheLab.AppImage.bak` alongside)
- On full success: clean up snapshots after a grace period (a week?) so users have a window to roll back manually

### Open questions / decisions needed
- **Migration format**: TypeScript files? Rust modules? SQL files? Probably hybrid — JSON migrations in Rust (cheap to embed) + SQL migration files for server-side schema changes.
- **Migration ordering**: by app version (semver) or by ascending integer? Integer is simpler. The app stores `lastAppliedMigration: N` in `settings.json`; on launch we run every N+1 → current.
- **Server SQL migrations**: do we run them eagerly on Lab launch, or only when the user clicks Start Server? Probably the latter — Lab launch shouldn't require Docker to be healthy.
- **GitHub Releases vs Actions**: Releases as the storage layer, Actions to automate the artifact upload + manifest generation on tag push. Decide after we have one working release.

### Implementation outline
1. Define migration type (Rust trait with `up()` + snapshot/restore helpers)
2. Create migration #1 as a no-op baseline that records the starting version
3. Build the runner: load migrations, find unapplied set, snapshot, run, commit/rollback
4. Configure GitHub Releases manifest generation (`latest.json` with version + URL + signature)
5. Wire the Tauri updater plugin's `endpoints` (already in tauri.conf.json) at the releases URL
6. Test: simulate a failed migration locally, confirm rollback restores state

---

## Track 2 — AHBot → AHBot Plus migration

### Goal
Move from `mod-ahbot` (current) to **AHBot Plus** (https://www.azerothcore.org/catalogue.html#/details/868234006). AHBot Plus is a fork with significantly more configurability — buy/sell behavior, item filtering, price modifiers — and is the modern default.

### Scope
- Update `install-wow-ui.sh` to clone/install AHBot Plus instead of legacy AHBot
- Existing installs (already running AHBot) need a **migration**:
  1. Stop server
  2. Remove old mod-ahbot from `<install>/modules/`
  3. Clone AHBot Plus
  4. Translate old AHBot config into AHBot Plus's config schema (where settings overlap) — this is the migration's bulk
  5. Rebuild (Playerbots variant) or pull updated container (Base/NPCBots if applicable)
  6. Start server
- Update the AHBot configuration UI in The Lab (the "AH Bot needs setup" notify path) to use AHBot Plus's setting names

### Dependencies
- **Blocks on Track 1** — we need the migration runner to safely transition existing installs. Without it, users would have to nuke + reinstall just to upgrade modules.

### Open questions
- AHBot Plus has additional config knobs we don't currently surface. Do we expose them via the new module config UI (Track 3) or hardcode sensible defaults?

---

## Track 3 — Module Configuration UI (Settings page redesign)

### Goal
The Settings page today is one flat tab. Bottom-of-page module configs are a placeholder. Two changes:

### 3a. Per-module config sections
Each installed module gets its own section with friendly, structured inputs for the settings users actually care about (e.g., AHBot: min/max items, refresh interval; Solocraft: stat multiplier; etc.).

### 3b. Raw config view ("Advanced" tab)
For users who want full control: a tabular view of every line in every module's `.conf` file (and worldserver.conf settings we own). Direct inline editing.

**Display "unapplied" state**: values that take effect only after a server restart. Visual cues:
- Yellow ring / dot on a row that has uncommitted changes
- Banner at top: "X settings changed — restart server to apply"
- One-click "Restart server" button in the banner

### Why both
- Friendly forms cover the 90% case (the user just wants a slider for "how many items in the AH at once?")
- Raw view handles the long tail (any module we don't have a friendly form for yet; debugging weird configs from forums)

### Implementation outline
- Backend: Tauri commands to enumerate module conf files, read them, parse `key = value` lines, write back
- "Unapplied" tracking: compare file-on-disk to what would-be-applied; persist pending changes in `settings.json` until restart-or-discard
- Frontend: settings page becomes tabbed (App / Modules / Advanced). Modules tab lists each installed module with a card. Advanced tab is a virtualized table for performance.

### Cross-references
- The full backup/restore feature already has the pattern for "operation requires server restart" UX cues
- This work is what makes new modules in Track 5 easier to ship — each new module gets a config card

---

## Track 4 — Uninstall support + SteamOS recovery surface

These two are bundled because they're both "things-in-Settings" and they share UI surface.

### 4a. Uninstall server (per audit §3d)
- New Tauri command wrapping `uninstall.sh` (or reimplementing in Rust)
- Surface in Settings: "Uninstall server" button at the bottom of Settings
- Two-step confirmation, character-backup prompt first
- Cross-cuts both vanilla and WotLK installs (uninstall.sh upstream is dual-server-aware)

### 4b. SteamOS post-update recovery (per audit §1 + §3a)
- Patch `fix-after-update.sh` to detect and remove `podman-docker` shim before installing real docker (full diff in audit §1)
- Help page section explaining what to do when Docker breaks after a SteamOS update, with a "Run fix-after-update.sh" button that launches a terminal

### 4c. Running-container awareness on Start (per audit §3b)
- Before `start_server` runs, check `docker ps` for vanilla-* containers
- If found: dialog "Another server is running. Stop it?" → click → `docker compose -f ~/wow-vanilla-server/compose.yml stop`
- Mirror this in vanilla's launcher when it eventually lands in The Lab

### 4d. Vanilla launcher hardening (per audit §3e)
- Drop `restart: unless-stopped` from vanilla's compose so a clean stop sticks across reboots
- Tighten the shutdown step in `wow-vanilla-launcher.sh`

### Dependencies
- 4a benefits from Track 1 (uninstall should snapshot a backup automatically if the user has migrations pending — provides a safety net)

---

## Track 5 — New module additions

Curated shortlist from the AzerothCore catalogue. Each entry: brief, rationale, integration complexity, priority.

### 5a. mod-npc-enchanter ⭐ HIGH PRIORITY
- https://www.azerothcore.org/catalogue.html#/details/123951640
- Adds an NPC that applies enchantments directly without needing a real enchanter character or finding a guildmate. Huge QoL for solo-server play.
- **Integration**: standard module clone + recompile. Probably no special config UI needed beyond enabling/disabling.
- **User explicitly flagged as "super interesting and highly useful"** — promote this in the install wizard's module picker.

### 5b. mod-dungeon-scale (a.k.a. mod-autobalance-style)
- https://www.azerothcore.org/catalogue.html#/details/868235496
- Diablo 2 `/players N` style: scales dungeon creature HP/mana/damage to party size. Optionally scales rewards (XP/gold/loot).
- **Integration**: clone + recompile. Some config tuning expected (do we want loot scaling on by default? probably not — XP yes, loot no).
- **Solo-server killer feature** — pair with mod-npc-enchanter as the "play alone, still have fun" bundle.

### 5c. mod-TimeIsTime + auto-locale
- https://www.azerothcore.org/catalogue.html#/details/342405971
- Alters in-game timescale. The "match player's local time" feature is the interesting bit — sets the in-game clock to follow real wall-clock.
- **Bonus task**: auto-detect the user's timezone offset from the Steam Deck and seed the locale config accordingly. Saves them from editing a `.conf` by hand.
- **Integration**: standard. Config UI surface this as a single toggle "Match real-world time" + a manual offset slider for users who want a different vibe.

### 5d. mod-expansion-finder
- https://www.azerothcore.org/catalogue.html#/details/663985319
- Autostarts new characters at the user's specified expansion (e.g., level 60 with appropriate gear if Burning Crusade chosen).
- **Question**: do we already do this with our admin-bootstrap account flow? Possibly redundant — investigate before committing.
- If kept: surface in install onboarding's "starter level" choice.

### 5e. mod-breaking-news-override
- https://github.com/azerothcore/mod-breaking-news-override
- Replaces the character-select-screen news box with custom content.
- **Use case**: shout out early DML supporters / patrons in the news. Cute branding.
- **Integration**: trivial. The content is HTML/text in a config. Could pull from a hosted URL so we can update it without a server restart.

### 5f. mod-ollama-chat
- https://www.azerothcore.org/catalogue.html#/details/954883822
- Local-LLM-backed chat for bots. Requires Ollama running on the host.
- **Heavy lift**: detection logic for "Ollama running?", a model download flow, latency concerns (bots responding in 3-5s might feel laggy).
- **Lower priority** but a flashy demo if we can ship it. Defer until core modules + config UI are stable.

### 5g. mod-dungeon-master
- https://www.azerothcore.org/catalogue.html#/details/1152284590
- Need to read the docs — could be a GM helper, a dungeon-config tool, or unrelated to mod-ai-playerbots. **Investigate before committing.**

### Cross-cutting
- All new modules benefit from Track 3 (config UI) — the new-module installation flow should auto-register a config card.
- Adding a module to an EXISTING install requires Track 1 (the migration framework) for clean rebuilds.

---

## Suggested ordering for the sprint

| # | Task | Tracks | Why this order |
|---|---|---|---|
| 1 | Patch `fix-after-update.sh` for podman | 4b | 15 lines, unblocks ALL existing users hit by SteamOS updates. Ship first. |
| 2 | OTA migration framework scaffold | 1 | Foundational — every later track wants it. Even a stub-only version unblocks the rest. |
| 3 | Running-container check on Start | 4c | Small, prevents the most-reported user pain. Independent of everything else. |
| 4 | Module config UI — Advanced (raw view) tab | 3b | Faster to ship than per-module forms; gives advanced users a tool today and gives us time to design 3a. |
| 5 | Uninstall button in Settings | 4a | Lands cleanly after Track 1 (auto-backup-on-uninstall). |
| 6 | AHBot Plus migration | 2 | Depends on Track 1 + Track 3's config UI for any new knobs. |
| 7 | mod-npc-enchanter + mod-dungeon-scale | 5a, 5b | Highest user-value modules; bundle as the "solo play" pack. |
| 8 | Vanilla launcher hardening | 4d | Quality-of-life, no blockers, can fit between heavier tracks. |
| 9 | Per-module config forms (Track 3a) | 3a | Build out as we add each new module — incremental rather than big-bang. |
| 10 | The "explore" modules (5c–5g) | 5 | After we have a clean module-add pipeline. |

---

## Cross-reference index

- **Podman-docker shim, port collisions, vanilla launcher reliability** → [STEAMOS_AND_MULTI_SERVER_AUDIT.md](STEAMOS_AND_MULTI_SERVER_AUDIT.md)
- **Character backup/restore (atomic restore pattern that informs Track 1's migration design)** → `guides/wow-wotlk/ui/src-tauri/src/character_backup.rs` (the staging-schema + transaction approach is directly applicable)
- **Updater signing key location** → `guides/wow-wotlk/ui/src-tauri/.secrets/updater.key` (gitignored)
- **AppImage build & naming convention** → `guides/wow-wotlk/ui/build-appimage.sh`

---

## Open questions for the user

1. **GitHub Releases vs Actions for OTA hosting**: preference? Releases is simpler; Actions adds automation but needs CI setup time.
2. **AHBot config migration**: best-effort settings translation, or wipe-and-default? Best-effort is more work but less disruptive.
3. **Solo-play module bundle**: pair mod-npc-enchanter + mod-dungeon-scale (+ mod-TimeIsTime?) as a one-click "Solo Server" preset during install? Could make the install picker a third option alongside Base / NPCBots / Playerbots.
4. **mod-dungeon-master**: need to investigate what this actually does before greenlighting.
