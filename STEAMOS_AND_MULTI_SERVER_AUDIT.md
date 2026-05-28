# SteamOS Updates + Multi-Server Coexistence — Audit Report

> Findings from a 2026-05-27 audit covering: post-SteamOS-update Docker
> breakage (podman shim), vanilla + WotLK container/port topology, and
> the UX surface needed to make both stories smooth in The Lab.

## 1. fix-after-update.sh — upstream parity & podman gap

**Upstream parity**: our `guides/wow-wotlk/fix-after-update.sh` is byte-identical to upstream's (`md5sum` matches). Nothing new from upstream to crib.

**The podman gap is real and the script doesn't handle it.** SteamOS Holiday/Spring updates sometimes ship the `podman-docker` package, which installs a `/usr/bin/docker` wrapper that calls podman. Symptoms users hit:

- `which docker` → returns `/usr/bin/docker` (looks legit)
- `docker ps` → works (podman daemonless mode emulates it)
- `docker compose <anything>` → fails, because the `compose` v2 plugin is a separate package (`docker-compose-plugin` from Arch's `docker` package) and podman-docker doesn't provide it
- Then `pacman -S docker` from our script **fails** because `podman-docker` owns `/usr/bin/docker` and pacman won't overwrite

Our current script just runs `pacman -Sy --noconfirm docker docker-compose` and reports failure. The remediation a user has to figure out manually:

```bash
sudo pacman -Rns --noconfirm podman-docker podman
sudo pacman -S --noconfirm docker docker-compose
```

### Recommended fix

Insert a STEP 3.5 between the keyring rebuild and the docker install:

```bash
# Detect podman-docker shim that recent SteamOS updates install. This
# claims /usr/bin/docker and blocks the real `docker` package from
# installing — and even when it "works", `docker compose` calls fail
# because podman-docker doesn't bundle the compose v2 plugin.
if pacman -Qq podman-docker &>/dev/null; then
    print_warning "Detected podman-docker shim (from SteamOS update)."
    print_info "Removing it so the real docker package can install..."
    sudo pacman -Rns --noconfirm podman-docker podman || \
        print_warning "podman removal failed — pacman -S docker may conflict"
fi

# Belt-and-braces: if /usr/bin/docker exists and isn't owned by `docker`
# package, something else is squatting on it. Bail with a clear message
# rather than letting pacman fail cryptically.
if [ -f /usr/bin/docker ] && ! pacman -Qqo /usr/bin/docker 2>/dev/null | grep -q '^docker$'; then
    OWNER=$(pacman -Qqo /usr/bin/docker 2>/dev/null || echo "unknown")
    print_error "/usr/bin/docker is owned by '$OWNER' — manual cleanup needed."
    exit 1
fi
```

That's the only change needed. The rest of the script (keyring rebuild, install, service start) is fine.

---

## 2. Vanilla vs WotLK topology

### Container naming — clean separation, no collisions

| Server | DB | Auth/Realm | World |
|---|---|---|---|
| Vanilla (cmangos) | `vanilla-db` | `vanilla-realmd` | `vanilla-mangosd` |
| WotLK (azerothcore) | `ac-database` (or `ac_database`) | `ac-authserver` | `ac-worldserver` |

### Install paths — also separate

- Vanilla → `~/wow-vanilla-server/`
- WotLK Base → `~/wow-server/`
- WotLK NPCBots → `~/wow-server-npcbots/`
- WotLK Playerbots → `~/wow-server-playerbots/`

### Port collisions — THE problem

| Port | Vanilla | WotLK | Collides? |
|---|---|---|---|
| 3724 (auth/realm) | ✓ | ✓ | **YES** |
| 8085 (world) | ✓ | ✓ | **YES** |
| 7878 (SOAP) | — | ✓ | no |
| 3306 (MySQL) | — | ✓ | no |

### Why auto-shutdown is unreliable

Both compose files use `restart: unless-stopped`. If a vanilla user does `docker compose stop`, that's fine. But the moment they reboot, restart docker, or pacman-update docker, the vanilla containers come back automatically — and now they're running silently in the background, holding ports 3724/8085 the next time the user opens The Lab and clicks Start.

---

## 3. Recommendations

### 3a. Help page → "Steam Update Recovery" section (low effort, high value)

In The Lab's help page, add a section users see whenever the dashboard detects docker is broken (we already have docker detection). Surface:

- A "what just happened?" explanation (1 paragraph)
- A copy-pasteable terminal command pointing at the script bundled in the AppImage:
  ```
  bash /home/deck/wow-server*/fix-after-update.sh
  ```
- Or, more polished: a button that opens Konsole pre-filled with that command (Tauri can spawn a terminal via `xdg-open konsole`-style)
- **Patch `fix-after-update.sh` first** (per Section 1) so it handles the podman case before we point users at it

This is dashboard-adjacent more than help-page; the user only cares when they hit the problem. Could live in both places.

### 3b. Running-container awareness on server-start (the MVP for multi-server)

Before Start Server runs, the Lab queries `docker ps --format '{{.Names}}'` and looks for:

- `vanilla-realmd` or `vanilla-mangosd` running → "Another server is running. The Lab can't start the WoW 3.3.5a server while vanilla is up. Stop vanilla?" → click → `docker compose -f ~/wow-vanilla-server/compose.yml stop`
- Same in reverse for vanilla's launcher (but that's outside The Lab's scope unless we also wrap vanilla in the UI)

This is the smallest viable fix and matches user mental model. The Lab already detects the WoW client + its installs; adding "any vanilla containers running?" check is a few-line addition to whatever spawns Start Server.

### 3c. Port reassignment (heavier lift, real coexistence)

To allow BOTH servers running simultaneously (rather than mutually-exclusive):

- Change vanilla's published ports from `3724:3724` / `8085:8085` to `13724:3724` / `18085:8085` (container-internal stays the same; only host-mapping shifts)
- Update vanilla's `realmlist` DB row to advertise `127.0.0.1:18085` for world
- Update vanilla client's `realmlist.wtf` to `set realmlist 127.0.0.1:13724`

Trade-offs:

- ✅ True simultaneous play (e.g., user runs vanilla AHbot in background while playing WotLK)
- ❌ Requires modifying vanilla's install script + adding migration for existing vanilla installs
- ❌ Vanilla client config drifts from "stock" (some users may find their old vanilla client broken when they next try it via a different path)
- ❌ Doesn't actually solve the "auto-shutdown unreliable" problem — just makes the symptom less visible

**Recommendation**: ship 3b now (detect + offer to stop), defer 3c until users specifically ask for simultaneous-play. The auto-shutdown reliability is a separate fix (could harden `wow-vanilla-launcher.sh` and remove `restart: unless-stopped` from vanilla services so they don't auto-restore on docker daemon restart).

### 3d. Bring upstream `uninstall.sh` into our repo + surface in The Lab

Our repo doesn't have a top-level `uninstall.sh`. Upstream's is dual-server-aware (knows about both `~/wow-server*` and `~/wow-vanilla-server`). The Lab should either:

- Ship a copy and surface "Uninstall server" from Settings
- Or implement the same logic in Rust as a Tauri command

User specifically called out wanting an **uninstall button at the bottom of Settings**.

### 3e. Vanilla launcher hardening

Independent of The Lab integration:

- Drop `restart: unless-stopped` from vanilla services so `docker compose stop` actually keeps them stopped
- Tighten the shutdown step in `wow-vanilla-launcher.sh` so it survives the client crashing vs. quitting cleanly

---

## Suggested implementation order

1. **Patch `fix-after-update.sh`** to handle podman-docker (one section, ~15 lines)
2. **Add running-container check** to The Lab's Start Server flow (Tauri command + a dialog)
3. **Help/dashboard surface** that points users at fix-after-update.sh when docker is broken
4. **Vanilla launcher hardening**: drop `restart: unless-stopped` from vanilla compose, make `wow-vanilla-launcher.sh` more reliable about its shutdown step
5. **Uninstall button in Settings** (Tauri command wrapping `uninstall.sh`)
6. **Defer**: port reassignment (3c) until there's user demand for simultaneous-play

---

## Out-of-scope but worth noting

- The full backup → uninstall → fresh-install → restore flow is now the canonical
  upgrade path for legacy installs (per the 2026-05-27 retrofit discussion). This
  audit's recommendations dovetail with that: a Lab-side "Upgrade legacy install"
  wizard would chain backup, container/port checks, uninstall, fresh install
  through `install-wow-ui.sh`, and restore — all using code paths we already test.

- The "mesh of servers via Tailscale" use case the user has on the roadmap will
  rely on the same container/port hygiene this audit surfaces. Port reassignment
  (3c) might be worth revisiting if mesh users want to run multiple WotLK servers
  on one box, not just one of each variant.
