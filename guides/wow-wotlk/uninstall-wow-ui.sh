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
#    DML_WIPE_APP_CONFIG  "1" removes ~/.config/dads-mmo-lab/settings.json
#                         (selected character, dismissed notices, etc.)
#                         Useful for fresh-install testing. "0" default.
#    DML_WIPE_CACHES      "1" removes the item-icons / tooltip-data /
#                         talent-data JSON caches in ~/.config/dads-mmo-lab/.
#                         "0" default — caches are universal across
#                         3.3.5a clients and re-extracting is slow.
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
    sudo rm -rf "$target"
    print_success "Removed $label: $target"
}

# ─────────────────────────────────────────
# RESOLVE TARGET
# ─────────────────────────────────────────
print_header

DML_VARIANT="${DML_VARIANT:-}"
DML_KEEP_CLIENT_DATA="${DML_KEEP_CLIENT_DATA:-1}"
DML_REMOVE_IMAGES="${DML_REMOVE_IMAGES:-0}"
DML_WIPE_APP_CONFIG="${DML_WIPE_APP_CONFIG:-0}"
DML_WIPE_CACHES="${DML_WIPE_CACHES:-0}"

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
print_info "Wipe app config:    $([ "$DML_WIPE_APP_CONFIG" = "1" ] && echo yes || echo no)"
print_info "Wipe caches:        $([ "$DML_WIPE_CACHES" = "1" ] && echo yes || echo no)"

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

    # Belt-and-suspenders: kill any matching containers by name.
    for cname in ac_worldserver ac_authserver ac_database ac_eluna \
                 worldserver authserver ac-database ac-eluna; do
        dkr rm -f "$cname" 2>/dev/null && print_info "Removed container: $cname" || true
    done
    section_end
else
    print_info "Docker unavailable — skipping container stop."
fi

# ─────────────────────────────────────────
# STEP 2/4 — REMOVE VOLUMES + NETWORKS
# ─────────────────────────────────────────
print_step "STEP 2/4 — Cleaning Volumes and Networks"

if [ "$DOCKER_AVAILABLE" = "1" ]; then
    # Named volumes the installer creates. The first set is database state;
    # the second set is client data (kept by default — re-extracting on a
    # fresh install takes ~15 minutes).
    DB_VOLUMES=(
        dads_mmo_wow_db
        wow-server_ac-database
        wow-server-npcbots_ac-database
        wow-server-playerbots_ac-database
        ac-database
    )
    CLIENT_VOLUMES=(
        wow-server_ac-client-data
        wow-server-npcbots_ac-client-data
        wow-server-playerbots_ac-client-data
        ac-client-data
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

safe_rm_rf "$TARGET_DIR" "$DML_VARIANT install"

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
print_step "STEP 4/4 — App Data Cleanup"

CONFIG_BASE="${XDG_CONFIG_HOME:-$HOME/.config}/dads-mmo-lab"

if [ "$DML_WIPE_APP_CONFIG" = "1" ]; then
    if [ -f "$CONFIG_BASE/settings.json" ]; then
        rm -f "$CONFIG_BASE/settings.json"
        print_success "Removed app settings: $CONFIG_BASE/settings.json"
    else
        print_info "App settings already absent."
    fi
else
    print_info "Keeping app settings ($CONFIG_BASE/settings.json)."
fi

if [ "$DML_WIPE_CACHES" = "1" ]; then
    for cache in item-icons.json tooltip-data.json talent-data.json; do
        if [ -f "$CONFIG_BASE/$cache" ]; then
            rm -f "$CONFIG_BASE/$cache"
            print_success "Removed cache: $cache"
        fi
    done
else
    print_info "Keeping enrichment caches (icons/tooltips/talents)."
fi

# Remove the empty config dir if we emptied it.
if [ -d "$CONFIG_BASE" ] && [ -z "$(ls -A "$CONFIG_BASE" 2>/dev/null)" ]; then
    rmdir "$CONFIG_BASE" 2>/dev/null && print_info "Removed empty $CONFIG_BASE"
fi

# ─────────────────────────────────────────
# DONE
# ─────────────────────────────────────────
echo ""
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
