# Work Goals — 2026-05-30

Forward-looking planning doc. Everything from the 5/30 session is **shipped** (party presets + gear popover/editor + auto-gear schema, Gear Library, World page with rates/MoTD/difficulty/QoL + transmog summon, SteamOS Update Fix with Gaming/Desktop gating, mod-npc-enchanter added as a default module). This doc captures the two NEXT tracks raised at the end of that session.

Pairs with [WorkGoals_5-27-2026.md](WorkGoals_5-27-2026.md) (OTA / AHBot Plus / module config / uninstall / new modules) — that sprint's tracks still stand; this adds two new ones.

---

## Track A — Module-aware feature gating

### Goal
Gate Lab features on whether the module they depend on is actually installed. If a user unchecks **Auction House Bot** during onboarding, the **Auction House** nav entry should be disabled with a clear "this needs mod-ah-bot-plus — add it from Settings → Modules" message — not silently broken. Same pattern for transmog (Gear Library transmog actions / World → Server "Summon Transmogrifier"), individual-progression, etc.

### Why now
This session surfaced it twice:
- The **Summon Transmogrifier** button only works if mod-transmog is installed (it now errors gracefully, but nothing *up front* tells the user it's unavailable).
- A user who declines AH Bot at install still sees a fully-live Auction House page that can't work.

As we add more module-dependent surfaces (enchanter, dungeon-scale, etc.) this gets worse. We want one consistent "feature requires module X" gate.

### The hard part: knowing what's installed
Two sources of truth, and they can disagree:
1. **What the user selected at install** — we send `DML_MODULES_ADD` to `install-wow-ui.sh`, but we **don't currently persist the selected list** anywhere the running app can read it. Fix: write the selected module keys into `<install>/.dads-mmo-lab/install.json` at install time (alongside `admin_user`, `build_method`, etc.).
2. **What's actually on disk / compiled in** — users can hand-install modules later (clone into `<install>/modules/` + rebuild), or remove them. So we should *also* detect from reality:
   - `<install>/modules/<key>/` directory presence (cloned source), and/or
   - a DB/SOAP probe per module (e.g. mod-transmog → `creature_template` entry 190010 exists; mod-ah-bot-plus → its config/table; mod-npc-enchanter → its NPC entry).

Recommended: **persist the install-time list as the baseline, then reconcile with a disk/DB scan** so manual changes are reflected. Surface the union/most-truthful answer.

### Implementation outline
- **Backend**: write `modules: ["mod-ah-bot-plus", ...]` into `install.json` during install; add a `list_installed_modules()`-style command (there's already a `modules.rs` with `list_installed_modules` — extend it to merge the install.json list + a `<install>/modules/` scan, returning `{ key, source: "selected" | "detected" | "both" }`).
- **Frontend**: a `useInstalledModules()` hook + a `feature → required module` map. Nav items (`app-sidebar.tsx`) and pages render disabled + a `PreInstallTooltip`-style "Coming soon → needs mod-X" message when the module is absent. Reuse the existing disabled-nav pattern (Gear Library was disabled this way before we shipped it).
- **Per-feature gates** to wire: Auction House → mod-ah-bot-plus; transmog actions (Gear Library, World→Server) → mod-transmog; IP-specific UI → mod-individual-progression; enchanter affordances → mod-npc-enchanter.

### Open questions
- Detection cost: a per-module DB probe on every launch is wasteful — cache the result in memory, refresh on demand / after a rebuild.
- Manual-install UX: if we detect a module on disk that wasn't in the install.json list, do we silently adopt it (treat as installed) — probably yes.
- Do we offer an in-app "add this module to an existing install" flow here, or defer to the existing Modules page? (Ties into 5/27 Track 1 migration framework for clean rebuilds.)

---

## Track B — P2P server mesh / server browser

### Goal
Let people host their locally-running AzerothCore server for friends (or the public) **from inside The Lab**, with a server browser + share codes, and move characters between servers using the import/export we already have. The realization: **everything needed already exists in pieces** — people are already exposing servers over the internet, and we already have character export/import + temp accounts. This track is about **automating the glue**.

### Why Tailscale
Port-forwarding + dynamic-IP juggling (see the community how-to in the appendix) is the painful manual path most people can't/won't do. **Tailscale** (WireGuard mesh VPN) gives every Deck a stable address on a private mesh with NAT traversal and no router config — turning "expose your server" into "join the mesh + share a code." It sidesteps the ISP-IP-churn problem entirely.

### Proposed flow
1. **Person A** flips their server to *public* (or *friends*) in The Lab.
2. The Lab sets up the Tailscale connection / makes the server reachable, generates a **share code**, and asks whether to list it in the public **server browser**.
3. **Person B** finds it in the browser (or pastes the share code) and clicks **Connect**.
4. The Lab handshakes to A's server and runs a **character import** into one of a pool of **temp accounts** on A's server (reusing our `.dmlbak`/character-transfer machinery).
5. The Lab rewrites B's client `realmlist.wtf` to A's address and hands B the temp account name + password.
6. B logs in.

### What we already have to lean on
- **Character export/import** (`character_backup.rs`, `.dmlbak`, transactional staging-schema restore) — the transfer mechanism for step 4.
- **realmlist rewrite** (`wow_client.rs`) — step 5.
- **SOAP + admin account** — creating/seeding temp accounts on the host.
- **The community how-to** (appendix) documents the manual realmlist/ports/IP process we're automating — use as the baseline of what must happen under the hood (and what Tailscale removes).

### Big open questions / risks
- **Tailscale install + auth on SteamOS** (immutable rootfs): how to install the client + do the login (`tailscale up`) from the app. Likely another `pkexec`/bootstrap-style step. Verify it survives SteamOS updates (ties into the SteamOS-fix work).
- **Server browser backend**: where does the public list live? Needs a lightweight hosted directory/registry (servers publish `{ name, tailscale addr / share code, player count, version, modules }`). Privacy: opt-in only; share-code-only servers never hit the registry.
- **Account/security model**: temp-account pooling, password handling, what a guest can do, cleanup of stale temp accounts, griefing/abuse on public servers.
- **Version/module compatibility**: B's client + A's server must match (3.3.5a + same content); surface mismatches before connecting. Module differences (B's character built with modules A lacks) — how gracefully does import degrade?
- **Realmlist juggling on the guest**: switching `realmlist.wtf` to join A and back to their own server — make it reversible/one-click "return home."
- **Character ownership**: is the imported character a *copy* (snapshot) on A's server, or do we sync it back to B on disconnect? v1 is almost certainly a one-way copy (play as a guest), with sync-back a later ambition.

### Suggested first steps
1. Spike: Tailscale install + `tailscale up` automation on a Deck, confirm two Decks can reach each other's `ac-worldserver` (port 8085) + auth (3724) over the mesh.
2. Manual end-to-end: export a character from B, import to a temp account on A over Tailscale, repoint realmlist, log in. Prove the pipeline by hand before building UI.
3. Design the registry/share-code format + the "public vs friends vs code-only" privacy model.
4. Then build the in-app **Server browser** + **Host my server** surfaces.

---

## Appendix — Community how-to: exposing an AzerothCore server (the manual path we're automating)

Captured from a community member (2026-05-26). This is the manual process today — Track B automates it (and Tailscale removes most of the port-forward / IP steps). Kept verbatim-ish as reference.

> **Goal:** let others (LAN or internet) connect to the Steam-Deck-hosted server.
>
> **Boot the server (manual docker, not the Lab script, since we'll be restarting):**
> - Desktop Mode → Konsole. `cd ~/wow-server-playerbots` (or SSH in).
> - `docker compose up -d` (detached).
> - Note the containers — one is `ac-database`.
>
> **Get both IPs:**
> - Local: `ip route get 1.1.1.1 | awk '{print $7}'` → e.g. `192.168.68.10`.
> - External: `curl icanhazip.com`.
>
> **Point the realm at your external IP (internet play):**
> ```
> docker exec -it ac-database mysql -uroot -ppassword -e \
>   "UPDATE acore_auth.realmlist SET address = '<EXTERNAL IP>', localAddress = '<INTERNAL IP or 127.0.0.1>' WHERE id = 1;"
> ```
>
> **Open ports on the Deck:**
> ```
> sudo systemctl enable ufw
> sudo systemctl start ufw
> sudo ufw allow 3724/tcp
> sudo ufw allow 8085/tcp
> sudo ufw reload
> ```
> (Requires a Deck sudo password set.) AzerothCore uses **3724/tcp** (auth) and **8085/tcp** (world).
>
> **Router port-forwarding (internet only, not needed for LAN):** forward 3724/tcp + 8085/tcp to the Deck's (static) local IP. Varies by router (`routerlogin.net` for Netgear, `192.168.1.1`/`192.168.0.1`, or a phone app).
>
> **Client side:** set `realmlist.wtf` to the external IP. Restart the server: `docker compose down` then `docker compose up -d`.
>
> **LAN-only variant:** skip router/modem; still open the Deck ports. Use the internal IP:
> ```
> docker exec -it ac-database mysql -uroot -ppassword -e \
>   "UPDATE acore_auth.realmlist SET address = 'steamdeck', localAddress = '127.0.0.1' WHERE id = 1;"
> ```
> Then point `realmlist.wtf` (on the *client*, not the Deck) at `steamdeck` (or the internal IP if hostname resolution isn't on).
>
> **Gotcha:** ISPs rotate your external IP (Cox/Xfinity especially, or after a modem power-cycle) — if it stops working, redo the realmlist `address` + client `realmlist.wtf`. A purchased domain pointed at the Deck avoids this but is out of scope. *(← exactly the pain Tailscale removes.)*
