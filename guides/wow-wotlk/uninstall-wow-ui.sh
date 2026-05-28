#!/bin/bash
# ============================================================
#  Dad's MMO Lab — WoW Server UNINSTALLER (UI-driven)
#
#  Non-interactive variant of uninstall.sh. All input comes
#  from the Tauri UI via environment variables; this script
#  never calls `read`. Output goes straight to stdout so the
#  UI can stream it into its terminal console.
#
#  Required env vars:
#    DML_VARIANT          base | npcbots | playerbots
#
#  Optional env vars:
#    DML_TARGET_DIR       Absolute path to the install directory.
#                         Defaults from DML_VARIANT:
#                           base       -> $HOME/wow-server
#                           npcbots    -> $HOME/wow-server-npcbots
#                           playerbots -> $HOME/wow-server-playerbots
#    DML_KEEP_CLIENT_DATA "1" (default) keeps the ac-client-data volume
#                         (~6GB extracted maps/DBCs) so a re-install
#                         skips the long extraction step. "0" wipes it.
#    DML_REMOVE_IMAGES    "1" removes ACore docker images (~3-5GB).
#                         "0" (default) keeps them — image pulls and
#                         Eluna builds are the slowest part of install,
#                         and keeping them speeds future re-installs.
#
#  Always wipes (no opt-out):
#    - The item-icons / tooltip-data / talent-data JSON caches in
#      ~/.config/dads-mmo-lab/ (re-extracted in seconds on next install)
#    - Server-bound fields in ~/.config/dads-mmo-lab/settings.json
#      (selected character, switcher GUIDs, dismissed notices) — handled
#      by the Rust caller before this script runs, so we never need to
#      touch settings.json from bash. App-level prefs (audio, cursor,
#      client folder, etc.) are preserved.
#
#  Differences from uninstall.sh:
#    - No `read` prompts, no `clear`. Runs straight through.
#    - Targets a single install at a time (the UI knows which one).
#    - Uses `compose down -v` instead of explicit volume rm where
#      possible — matches the pattern from the base repo's master
#      uninstaller and is more robust against name-prefix drift.
#    - Steam shortcuts and ConsolePortLK in the WoW client are
#      NOT touched — the UI surfaces those as a follow-up reminder
#      since editing shortcuts.vdf while Steam is running is unsafe.
# ============================================================

UNINSTALLER_VERSION="1.0.0-ui"

set -o pipefail

# ─────────────────────────────────────────
# COLORS
# ─────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
WHITE='\033[1;37m'
NC='\033[0m'
BOLD='\033[1m'

print_header() {
    echo ""
    echo -e "${RED}══════════════════════════════════════════════════${NC}"
    echo -e "${WHITE}${BOLD}  DAD'S MMO LAB — WoW Server Uninstaller${NC}"
    echo -e "${BLUE}  github.com/DadsMmoLab/dads-mmo-lab — v${UNINSTALLER_VERSION}${NC}"
    echo -e "${RED}══════════════════════════════════════════════════${NC}"
    echo ""
}

print_step() {
    echo ""
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${WHITE}${BOLD} $1${NC}"
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

print_success() { echo -e "${GREEN}[OK]  $1${NC}"; }
print_warning() { echo -e "${YELLOW}[WARN] $1${NC}"; }
print_error()   { echo -e "${RED}[ERR] $1${NC}"; }
print_info()    { echo -e "${BLUE}[..]  $1${NC}"; }

# ─────────────────────────────────────────
# UI COLLAPSIBLE-SECTION MARKERS
# ─────────────────────────────────────────
# Same sentinel format as install-wow-ui.sh — the Tauri console
# parses these as `install:section`-style events and hides the
# raw marker lines from the rendered output.
section_start() { echo "::DML::SECTION::START::$1::"; }
section_end()   { echo "::DML::SECTION::END::"; }

# ─────────────────────────────────────────
# SAFE RM -RF — refuses to operate outside $HOME
# ─────────────────────────────────────────
# Try plain rm first; falls back to pkexec for the (likely) case where
# Docker bind-mounts left root-owned files in var/ or data/. pkexec pops
# the same graphical password dialog the install flow uses for its
# privileged bootstrap — the user is already familiar with it.
safe_rm_rf() {
    local target="$1"
    local label="$2"
    if [ -z "$target" ]; then
        print_error "Refusing to delete: empty path."
        return 1
    fi
    if [ "$target" = "/" ] || [ "$target" = "$HOME" ] || [ "$target" = "/home" ]; then
        print_error "Refusing to delete protected path: $target"
        return 1
    fi
    if [[ "$target" != "$HOME/"* ]]; then
        print_error "Refusing to delete '$target' — not inside \$HOME."
        return 1
    fi
    if [ ! -e "$target" ]; then
        print_info "$label: already gone ($target)"
        return 0
    fi

    # Stage 1: plain rm. Quiet failure here means there are root-owned
    # files in the tree — fall through to pkexec for those.
    rm -rf "$target" 2>/dev/null
    if [ ! -e "$target" ]; then
        print_success "Removed $label: $target"
        return 0
    fi

    # Stage 2: pkexec for root-owned bind-mount remnants. This pops a
    # graphical password dialog (the same one bootstrap_privileges uses
    # at install). Errors out cleanly if no polkit agent is available —
    # the UI surfaces the manual `sudo rm -rf` fallback.
    if command -v pkexec >/dev/null 2>&1; then
        print_info "Root-owned files detected (Docker bind mounts)."
        print_info "A password dialog will appear to finish removal."
        if pkexec rm -rf "$target"; then
            if [ ! -e "$target" ]; then
                print_success "Removed $label: $target"
                return 0
            fi
        else
            print_warning "Password dialog was cancelled or failed."
        fi
    else
        print_warning "pkexec not available — can't elevate to remove root-owned files."
    fi

    print_error "Could NOT remove $label: $target"
    print_info "To finish manually, run in a terminal:"
    print_info "  sudo rm -rf $target"
    return 1
}

# ─────────────────────────────────────────
# RESOLVE TARGET
# ─────────────────────────────────────────
print_header

DML_VARIANT="${DML_VARIANT:-}"
DML_KEEP_CLIENT_DATA="${DML_KEEP_CLIENT_DATA:-1}"
DML_REMOVE_IMAGES="${DML_REMOVE_IMAGES:-0}"

case "$DML_VARIANT" in
    base)        DEFAULT_DIR="$HOME/wow-server" ;;
    npcbots)     DEFAULT_DIR="$HOME/wow-server-npcbots" ;;
    playerbots)  DEFAULT_DIR="$HOME/wow-server-playerbots" ;;
    *)
        print_error "DML_VARIANT must be one of: base, npcbots, playerbots (got '$DML_VARIANT')."
        exit 2
        ;;
esac

TARGET_DIR="${DML_TARGET_DIR:-$DEFAULT_DIR}"

if [ ! -d "$TARGET_DIR" ]; then
    print_warning "$TARGET_DIR doesn't exist — nothing to uninstall."
    print_info "Continuing anyway to clean up volumes/launchers/caches the install left behind."
fi

print_info "Variant:            $DML_VARIANT"
print_info "Install directory:  $TARGET_DIR"
print_info "Keep client data:   $([ "$DML_KEEP_CLIENT_DATA" = "1" ] && echo yes || echo no)"
print_info "Remove images:      $([ "$DML_REMOVE_IMAGES" = "1" ] && echo yes || echo no)"

# ─────────────────────────────────────────
# DOCKER CHECK
# ─────────────────────────────────────────
if ! command -v docker &>/dev/null; then
    print_warning "Docker not installed — skipping container/volume cleanup."
    DOCKER_AVAILABLE=0
else
    DOCKER_AVAILABLE=1
    if ! docker ps &>/dev/null 2>&1 && ! sudo docker ps &>/dev/null 2>&1; then
        print_info "Docker is installed but not running. Starting it..."
        if ! sudo systemctl start docker 2>/dev/null; then
            print_warning "Docker failed to start — container cleanup will be skipped."
            DOCKER_AVAILABLE=0
        else
            sleep 2
        fi
    fi
fi

# Helper: docker that falls back to sudo on permission errors.
dkr() {
    if docker "$@" 2>/dev/null; then return 0; fi
    sudo docker "$@"
}

# ─────────────────────────────────────────
# STEP 1/4 — STOP CONTAINERS
# ─────────────────────────────────────────
print_step "STEP 1/4 — Stopping Server"

if [ "$DOCKER_AVAILABLE" = "1" ]; then
    section_start "Stopping Docker stack"
    COMPOSE_FILE=""
    [ -f "$TARGET_DIR/compose.yml" ]        && COMPOSE_FILE="$TARGET_DIR/compose.yml"
    [ -f "$TARGET_DIR/docker-compose.yml" ] && COMPOSE_FILE="$TARGET_DIR/docker-compose.yml"
    if [ -n "$COMPOSE_FILE" ]; then
        cd "$TARGET_DIR"
        DOWN_FLAGS=(down --remove-orphans)
        # `-v` removes compose-declared volumes too. Skip when we want to
        # preserve the client-data volume; we'll filter it back explicitly
        # in STEP 3 below.
        [ "$DML_KEEP_CLIENT_DATA" = "1" ] || DOWN_FLAGS=(down -v --remove-orphans)
        if ! dkr compose "${DOWN_FLAGS[@]}"; then
            print_warning "compose down failed — containers may still be running."
            print_info "Trying belt-and-suspenders removal by container name..."
        else
            print_success "Containers stopped via compose"
        fi
    else
        print_info "No compose file at $TARGET_DIR — falling back to name-based removal."
    fi

    # Belt-and-suspenders: kill any container whose compose-project label
    # matches THIS install. Switched from name-matching (which could pick
    # up unrelated acore-docker installs outside The Lab) to label-based
    # filtering, which scopes us strictly to containers `docker compose`
    # created inside $TARGET_DIR. Standard label set by Compose v2.
    PROJECT="$(basename "$TARGET_DIR")"
    LEFTOVER="$(dkr ps -a \
        --filter "label=com.docker.compose.project=$PROJECT" \
        --format '{{.Names}}' 2>/dev/null)"
    if [ -n "$LEFTOVER" ]; then
        while IFS= read -r cname; do
            [ -z "$cname" ] && continue
            dkr rm -f "$cname" >/dev/null 2>&1 \
                && print_info "Removed leftover container: $cname" \
                || true
        done <<< "$LEFTOVER"
    fi
    section_end
else
    print_info "Docker unavailable — skipping container stop."
fi

# ─────────────────────────────────────────
# STEP 2/4 — REMOVE VOLUMES + NETWORKS
# ─────────────────────────────────────────
print_step "STEP 2/4 — Cleaning Volumes and Networks"

if [ "$DOCKER_AVAILABLE" = "1" ]; then
    # Named volumes the installer creates. Only project-prefixed names
    # (= safe — Compose auto-prefixes named volumes with the project
    # name = install-dir basename) plus our one legacy hand-named volume
    # from the older docker-compose.yml reference. We DO NOT list bare
    # `ac-database` / `ac-client-data` here: those names belong to the
    # upstream acore-docker image schema; if a user has a separate
    # acore-docker install outside The Lab, those volumes would belong
    # to it, not us.
    DB_VOLUMES=(
        dads_mmo_wow_db
        wow-server_ac-database
        wow-server-npcbots_ac-database
        wow-server-playerbots_ac-database
    )
    CLIENT_VOLUMES=(
        wow-server_ac-client-data
        wow-server-npcbots_ac-client-data
        wow-server-playerbots_ac-client-data
    )

    for vol in "${DB_VOLUMES[@]}"; do
        if dkr volume ls --format '{{.Name}}' | grep -qx "$vol"; then
            dkr volume rm "$vol" >/dev/null 2>&1 && print_success "Removed volume: $vol" || \
                print_warning "Couldn't remove volume: $vol"
        fi
    done

    if [ "$DML_KEEP_CLIENT_DATA" = "1" ]; then
        print_info "Preserving client-data volume(s) — re-install will be much faster."
    else
        for vol in "${CLIENT_VOLUMES[@]}"; do
            if dkr volume ls --format '{{.Name}}' | grep -qx "$vol"; then
                dkr volume rm "$vol" >/dev/null 2>&1 && print_success "Removed volume: $vol" || \
                    print_warning "Couldn't remove volume: $vol"
            fi
        done
    fi

    # Networks the installer creates. Best-effort removal — failures
    # almost always mean the network was already gone.
    for net in dads_mmo_network \
               wow-server_ac-network wow-server_default \
               wow-server-npcbots_ac-network wow-server-npcbots_default \
               wow-server-playerbots_ac-network wow-server-playerbots_default; do
        dkr network rm "$net" >/dev/null 2>&1 && print_info "Removed network: $net" || true
    done

    if [ "$DML_REMOVE_IMAGES" = "1" ]; then
        section_start "Removing Docker images"
        IMAGES=(
            acore/ac-wotlk-worldserver
            acore/ac-wotlk-authserver
            acore/ac-wotlk-db-import
            acore/ac-wotlk-client-data
            acore/ac-worldserver
            acore/ac-authserver
            acore/ac-db-import
            acore/eluna-ts
            mysql:8.0
            mysql:8.4
        )
        for image in "${IMAGES[@]}"; do
            if dkr images --format '{{.Repository}}:{{.Tag}}' | grep -qE "^${image%%:*}"; then
                dkr rmi "$image" >/dev/null 2>&1 && print_success "Removed image: $image" || \
                    print_info "Image not found or in use: $image"
            fi
        done
        section_end
    else
        print_info "Skipping image removal (keeps re-install fast)."
    fi
fi

# ─────────────────────────────────────────
# STEP 3/4 — REMOVE SERVER FILES AND LAUNCHER
# ─────────────────────────────────────────
print_step "STEP 3/4 — Removing Server Files"

REMOVAL_FAILED=0
if ! safe_rm_rf "$TARGET_DIR" "$DML_VARIANT install"; then
    REMOVAL_FAILED=1
fi

case "$DML_VARIANT" in
    base)
        [ -f "$HOME/wow-gaming-mode.sh" ] && \
            rm -f "$HOME/wow-gaming-mode.sh" && \
            print_success "Removed launcher: wow-gaming-mode.sh"
        ;;
    npcbots)
        [ -f "$HOME/wow-npcbots-launcher.sh" ] && \
            rm -f "$HOME/wow-npcbots-launcher.sh" && \
            print_success "Removed launcher: wow-npcbots-launcher.sh"
        ;;
    playerbots)
        [ -f "$HOME/wow-playerbots-launcher.sh" ] && \
            rm -f "$HOME/wow-playerbots-launcher.sh" && \
            print_success "Removed launcher: wow-playerbots-launcher.sh"
        ;;
esac

# ─────────────────────────────────────────
# STEP 4/4 — APP-DATA CLEANUP (UI-specific)
# ─────────────────────────────────────────
# Always wipes the enrichment caches — extraction takes seconds on the
# next install and the cached data has no bearing on app-level prefs.
# settings.json is intentionally NOT touched here: the Rust caller
# already cleared its server-bound fields (selected character, switcher
# GUIDs, dismissed notices) before launching us; the remaining fields
# are app-level prefs that should survive an uninstall.
print_step "STEP 4/4 — App Data Cleanup"

CONFIG_BASE="${XDG_CONFIG_HOME:-$HOME/.config}/dads-mmo-lab"

for cache in item-icons.json tooltip-data.json talent-data.json; do
    if [ -f "$CONFIG_BASE/$cache" ]; then
        rm -f "$CONFIG_BASE/$cache"
        print_success "Removed cache: $cache"
    fi
done

print_info "App preferences (audio, cursor, client folder) preserved."

# ─────────────────────────────────────────
# DONE
# ─────────────────────────────────────────
echo ""
if [ "$REMOVAL_FAILED" = "1" ]; then
    echo -e "${RED}${BOLD}══════════════════════════════════════════════════${NC}"
    echo -e "${RED}${BOLD}  Uninstall FAILED — server folder still on disk.${NC}"
    echo -e "${RED}${BOLD}══════════════════════════════════════════════════${NC}"
    echo ""
    print_info "Containers, volumes, and caches were cleaned up, but the"
    print_info "install directory could not be removed. See above for the"
    print_info "manual fallback command."
    echo ""
    exit 1
fi

echo -e "${GREEN}${BOLD}══════════════════════════════════════════════════${NC}"
echo -e "${GREEN}${BOLD}  Uninstall complete.${NC}"
echo -e "${GREEN}${BOLD}══════════════════════════════════════════════════${NC}"
echo ""
echo -e "${YELLOW}Don't forget to clean these up by hand:${NC}"
echo -e "  ${WHITE}• Remove WoW from your Steam library${NC} — Steam → right-click"
echo -e "    WoW 3.3.5a → Manage → Remove non-Steam game from your library."
echo -e "  ${WHITE}• If you are deleting The Lab${NC}, you may also remove it from"
echo -e "    Steam this way."
echo -e "  ${WHITE}• Your WoW 3.3.5a client folder is untouched${NC} — keep it for"
echo -e "    next time, or delete it manually if you're done with WoW."
echo ""
exit 0
