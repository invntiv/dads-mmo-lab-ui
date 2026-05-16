#!/bin/bash
# ============================================================
#  Dad's MMO Lab — WoW Server Setup (UI-driven)
#
#  Non-interactive variant of install-wow.sh. All user input
#  is supplied by the Tauri UI via environment variables; this
#  script never calls `read`. Output goes straight to stdout
#  so the UI can stream it into its terminal console.
#
#  Required env vars (set by the UI before invocation):
#    DML_SERVER_TYPE    base | npcbots | playerbots
#
#  Optional env vars:
#    DML_BUILD_METHOD   prebuilt | compile  (only used for npcbots;
#                       playerbots is always compile, base ignores it)
#    DML_ADMIN_USER     stored in the install metadata for later
#    DML_ADMIN_PASS     account creation (account creation itself
#                       still happens after the worldserver is ready)
#    DML_FORCE          "1" to wipe an existing install at the target
#                       directory; otherwise the script aborts if the
#                       directory already exists.
#
#  Differences from install-wow.sh:
#    - No `read` prompts, no `clear`. The script runs straight through.
#    - No keyring-reset prompt: if pacman is broken, we abort with a
#      clear error and let the user run install-wow.sh from a real
#      terminal to handle it interactively. Avoiding silent destructive
#      ops is non-negotiable per CLAUDE.md.
#    - No module installs at install time. Same as install-wow.sh today:
#      modules are added afterward via manage-wow-modules.sh.
#    - No "create accounts" wait loop. The UI handles account creation
#      out-of-band once the worldserver reports ready.
# ============================================================

WIZARD_VERSION="1.1.0-ui"

set -o pipefail

# ─────────────────────────────────────────
# COLORS  (kept so output looks the same in
# a real terminal as in the UI's console)
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
    echo -e "${CYAN}══════════════════════════════════════════════════${NC}"
    echo -e "${WHITE}${BOLD}  DAD'S MMO LAB — WoW Server Installer${NC}"
    echo -e "${BLUE}  github.com/DadsMmoLab/dads-mmo-lab — v${WIZARD_VERSION}${NC}"
    echo -e "${CYAN}══════════════════════════════════════════════════${NC}"
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
# The Tauri UI's forward_lines watches for these sentinel lines and turns
# them into `install:section` events, then hides the sentinel from the
# console. Wrap noisy commands (docker build, docker pull) with these so
# the user gets a collapsible block instead of thousands of lines.
section_start() { echo "::DML::SECTION::START::$1::"; }
section_end()   { echo "::DML::SECTION::END::"; }

# ─────────────────────────────────────────
# RESOLVE INPUTS
# ─────────────────────────────────────────
SERVER_TYPE="${DML_SERVER_TYPE:-}"
BUILD_METHOD="${DML_BUILD_METHOD:-}"
FORCE="${DML_FORCE:-0}"

case "$SERVER_TYPE" in
    base)       SERVER_NAME="Base WoW";        SERVER_DIR="$HOME/wow-server" ;;
    npcbots)    SERVER_NAME="NPCBots WoW";     SERVER_DIR="$HOME/wow-server-npcbots" ;;
    playerbots) SERVER_NAME="Playerbots WoW";  SERVER_DIR="$HOME/wow-server-playerbots" ;;
    *)
        print_error "DML_SERVER_TYPE must be one of: base, npcbots, playerbots (got: '$SERVER_TYPE')"
        exit 2
        ;;
esac

# Default build method per server type
if [ "$SERVER_TYPE" = "playerbots" ]; then
    BUILD_METHOD="compile"
elif [ "$SERVER_TYPE" = "npcbots" ] && [ -z "$BUILD_METHOD" ]; then
    BUILD_METHOD="prebuilt"
fi

# ─────────────────────────────────────────
# SYSTEM CHECKS
# ─────────────────────────────────────────
check_system() {
    print_step "Checking system"

    if [[ "$OSTYPE" != "linux-gnu"* ]]; then
        print_error "This installer requires Linux."
        exit 1
    fi
    print_success "Linux detected"

    AVAILABLE_GB=$(df -BG "$HOME" 2>/dev/null | awk 'NR==2 {print $4}' | sed 's/G//' | tr -d ' ')
    if [ -n "$AVAILABLE_GB" ] && [ "$AVAILABLE_GB" -lt 15 ] 2>/dev/null; then
        print_error "Not enough disk space: ${AVAILABLE_GB}GB free, need at least 15GB."
        exit 1
    fi
    print_success "Disk space OK (${AVAILABLE_GB:-unknown}GB available)"

    if ! ping -c 1 -W 3 github.com &>/dev/null; then
        print_error "No internet connection (ping to github.com failed)."
        exit 1
    fi
    print_success "Internet OK"
}

# ─────────────────────────────────────────
# INSTALL DOCKER (non-interactive)
# ─────────────────────────────────────────
install_docker() {
    if command -v docker &>/dev/null && docker ps &>/dev/null 2>&1; then
        print_success "Docker already installed and running"
        return 0
    fi

    print_info "Installing Docker..."

    if command -v steamos-readonly &>/dev/null; then
        sudo -n steamos-readonly disable 2>/dev/null || {
            print_error "Need passwordless sudo to disable SteamOS read-only mode."
            print_info  "Run install-wow.sh in a terminal first, or add a NOPASSWD sudoers rule."
            exit 1
        }
    fi

    # Fail fast if pacman is broken — UI mode cannot prompt for a keyring reset
    if command -v pacman &>/dev/null; then
        if ! sudo -n pacman -Sy --noconfirm &>/dev/null; then
            print_error "pacman sync failed. Your keyring may be broken."
            print_info  "Run install-wow.sh from Konsole — it handles the keyring reset interactively."
            exit 1
        fi
        if ! sudo -n pacman -S --noconfirm docker docker-compose; then
            print_error "Failed to install Docker via pacman."
            exit 1
        fi
    elif command -v apt-get &>/dev/null; then
        sudo -n apt-get update -y || true
        if ! sudo -n apt-get install -y docker.io docker-compose; then
            print_error "Failed to install Docker via apt-get."
            exit 1
        fi
    else
        print_error "No supported package manager found (need pacman or apt-get)."
        exit 1
    fi

    sudo -n usermod -aG docker "$USER" || true
    sleep 2
    sudo -n systemctl daemon-reload 2>/dev/null || true
    sudo -n systemctl enable docker 2>/dev/null || true
    if ! sudo -n systemctl start docker 2>/dev/null; then
        print_error "Docker failed to start. Reboot and try again."
        exit 1
    fi
    sleep 3

    print_info "Configuring Docker permissions..."
    echo "$USER ALL=(ALL) NOPASSWD: /usr/bin/docker, /usr/bin/docker-compose" \
        | sudo -n tee /etc/sudoers.d/docker-nopasswd > /dev/null 2>&1 || true
    sudo -n chmod 0440 /etc/sudoers.d/docker-nopasswd 2>/dev/null || true
    sudo -n chmod 666 /var/run/docker.sock 2>/dev/null || true

    if ! docker ps &>/dev/null 2>&1; then
        if sudo -n docker ps &>/dev/null 2>&1; then
            function docker() { sudo -n docker "$@"; }
            export -f docker 2>/dev/null || true
            print_info "Using sudo for Docker — will work directly after next login."
        else
            print_error "Docker installed but not reachable. Try rebooting."
            exit 1
        fi
    fi

    print_success "Docker installed."
}

install_git() {
    if command -v git &>/dev/null; then
        print_success "Git already installed"
        return 0
    fi
    print_info "Installing Git..."
    if command -v pacman &>/dev/null && sudo -n pacman -Sy --noconfirm git; then
        print_success "Git installed."
    elif command -v apt-get &>/dev/null && sudo -n apt-get install -y git; then
        print_success "Git installed."
    else
        print_error "Failed to install Git."
        exit 1
    fi
}

# ─────────────────────────────────────────
# INSTALL SERVER
# ─────────────────────────────────────────
remove_existing_install_if_forced() {
    if [ ! -d "$SERVER_DIR" ]; then
        return 0
    fi
    if [ "$FORCE" != "1" ]; then
        print_error "An existing install already lives at $SERVER_DIR."
        print_info  "Set DML_FORCE=1 to wipe it, or remove it manually and re-run."
        exit 1
    fi
    print_warning "DML_FORCE=1 set — removing existing install at $SERVER_DIR"
    docker compose -f "$SERVER_DIR/docker-compose.yml" down -v 2>/dev/null || true
    sudo -n rm -rf "$SERVER_DIR" 2>/dev/null || rm -rf "$SERVER_DIR"
}

install_server() {
    print_step "Installing $SERVER_NAME"

    print_info "Checking dependencies..."
    install_docker
    install_git
    remove_existing_install_if_forced

    case "$SERVER_TYPE" in
        base)
            print_info "Downloading AzerothCore..."
            git clone --progress --depth 1 \
                https://github.com/azerothcore/acore-docker.git \
                "$SERVER_DIR"

            if [ ! -f "$SERVER_DIR/docker-compose.yml" ]; then
                print_error "Download failed."
                exit 1
            fi

            cat > "$SERVER_DIR/docker-compose.override.yml" << 'EOF'
services:
  phpmyadmin:
    ports:
      - "8181:80"
EOF
            mkdir -p "$SERVER_DIR/scripts/lua"
            print_success "AzerothCore downloaded."

            print_info "Pulling server images..."
            cd "$SERVER_DIR" || exit 1
            if ! docker compose pull; then
                print_error "Failed to pull images."
                exit 1
            fi

            print_info "Starting server..."
            if ! docker compose up -d --scale phpmyadmin=0; then
                print_error "Failed to start server."
                exit 1
            fi
            ;;

        npcbots)
            if [ "$BUILD_METHOD" = "prebuilt" ]; then
                print_info "Using pre-built NPCBots images..."
                git clone --progress --depth 1 \
                    https://github.com/trickerer/AzerothCore-wotlk-with-NPCBots.git \
                    "$SERVER_DIR"

                mkdir -p "$HOME/npcbots-sql"
                cp -r "$SERVER_DIR/data/sql/custom/db_auth"       "$HOME/npcbots-sql/"
                cp -r "$SERVER_DIR/data/sql/custom/db_characters" "$HOME/npcbots-sql/"
                cp -r "$SERVER_DIR/data/sql/custom/db_world"      "$HOME/npcbots-sql/"

                sudo -n rm -rf "$SERVER_DIR" 2>/dev/null || rm -rf "$SERVER_DIR"
                git clone --progress --depth 1 \
                    https://github.com/azerothcore/acore-docker.git \
                    "$SERVER_DIR"

                cat > "$SERVER_DIR/docker-compose.override.yml" << 'EOF'
services:
  phpmyadmin:
    ports:
      - "8181:80"
EOF
                cd "$SERVER_DIR" || exit 1
                if ! docker compose pull; then
                    print_error "Failed to pull NPCBots images."
                    exit 1
                fi
                if ! docker compose up -d --scale phpmyadmin=0; then
                    print_error "Failed to start NPCBots server."
                    exit 1
                fi

                # Apply NPCBots SQL (best-effort, identical to install-wow.sh)
                print_info "Waiting for database to be ready..."
                sleep 15
                DB_CONTAINER=$(docker ps --format '{{.Names}}' 2>/dev/null | grep -i "database" | head -1)
                DB_CONTAINER="${DB_CONTAINER:-wow-server-ac-database-1}"
                local sql_errors=0
                for db in db_auth:acore_auth db_characters:acore_characters db_world:acore_world; do
                    folder="${db%%:*}"; schema="${db##*:}"
                    for f in "$HOME/npcbots-sql/$folder/"*.sql; do
                        [ -f "$f" ] || continue
                        if ! docker exec -i "$DB_CONTAINER" mysql -uroot -ppassword "$schema" < "$f" 2>/dev/null; then
                            print_warning "SQL failed: $(basename "$f")"
                            sql_errors=$((sql_errors + 1))
                        fi
                    done
                done
                if [ "$sql_errors" -gt 0 ]; then
                    print_warning "$sql_errors SQL file(s) failed. NPCBots features may be incomplete."
                else
                    print_success "NPCBots database applied."
                fi
            else
                print_info "Compiling NPCBots from source (2-4 hours)..."
                git clone --progress --depth 1 \
                    https://github.com/trickerer/AzerothCore-wotlk-with-NPCBots.git \
                    "$SERVER_DIR"

                cat > "$SERVER_DIR/docker-compose.override.yml" << 'OVERRIDE'
services:
  ac-worldserver:
    image: dadsmmolab/npcbots-worldserver:latest
    build:
      context: .
      target: worldserver
      dockerfile: apps/docker/Dockerfile
  ac-authserver:
    image: dadsmmolab/npcbots-authserver:latest
    build:
      context: .
      target: authserver
      dockerfile: apps/docker/Dockerfile
  ac-db-import:
    image: dadsmmolab/npcbots-db-import:latest
    build:
      context: .
      target: db-import
      dockerfile: apps/docker/Dockerfile
  ac-client-data-init:
    image: dadsmmolab/npcbots-client-data:latest
    build:
      context: .
      target: client-data
      dockerfile: apps/docker/Dockerfile
OVERRIDE

                cd "$SERVER_DIR" || exit 1
                section_start "Docker build — NPCBots (collapsed; expand to follow live)"
                if ! docker compose up -d --build 2>&1 | tee "$HOME/npcbots-build.log"; then
                    :
                fi
                section_end
                if [ ${PIPESTATUS[0]} -ne 0 ]; then
                    print_error "Compilation failed. See ~/npcbots-build.log"
                    exit 1
                fi
            fi
            print_success "NPCBots server installed."
            ;;

        playerbots)
            print_info "Cloning Playerbots source..."
            git clone --progress \
                https://github.com/mod-playerbots/azerothcore-wotlk.git \
                --branch=Playerbot \
                "$SERVER_DIR"
            if [ ! -d "$SERVER_DIR" ]; then
                print_error "Clone failed."
                exit 1
            fi

            print_info "Cloning mod-playerbots..."
            git clone --progress --depth 1 \
                https://github.com/mod-playerbots/mod-playerbots.git \
                --branch=master \
                "$SERVER_DIR/modules/mod-playerbots"

            cat > "$SERVER_DIR/docker-compose.override.yml" << 'OVERRIDE'
services:
  ac-worldserver:
    build:
      context: .
      target: worldserver
    volumes:
      - ./modules:/azerothcore/modules
    environment:
      AC_PLAYERBOTS_UPDATES_ENABLE_DATABASES: "1"
      AC_AI_PLAYERBOT_RANDOM_BOT_AUTOLOGIN: "1"
      AC_AI_PLAYERBOT_MIN_RANDOM_BOTS: "50"
      AC_AI_PLAYERBOT_MAX_RANDOM_BOTS: "200"
  ac-authserver:
    build:
      context: .
      target: authserver
  ac-db-import:
    build:
      context: .
      target: db-import
  ac-client-data-init:
    build:
      context: .
      target: client-data
OVERRIDE

            print_info "Compiling Playerbots (2-4 hours)..."
            cd "$SERVER_DIR" || exit 1
            section_start "Docker build — Playerbots (collapsed; expand to follow live)"
            if ! docker compose up -d --build 2>&1 | tee "$HOME/playerbots-build.log"; then
                :
            fi
            section_end
            if [ ${PIPESTATUS[0]} -ne 0 ]; then
                print_error "Compilation failed. See ~/playerbots-build.log"
                exit 1
            fi
            print_success "Playerbots server compiled."
            ;;
    esac
}

# ─────────────────────────────────────────
# WAIT FOR SERVER READY
# ─────────────────────────────────────────
wait_for_server() {
    print_step "Waiting for worldserver"

    TIMEOUT=1800
    ELAPSED=0
    READY=0
    WORLD_CONTAINER=""

    while [ $ELAPSED -lt $TIMEOUT ]; do
        WORLD_CONTAINER=$(docker ps --format '{{.Names}}' 2>/dev/null | grep -i "worldserver" | head -1)
        if [ -n "$WORLD_CONTAINER" ]; then
            if docker logs "$WORLD_CONTAINER" 2>/dev/null | grep -q "ready\.\.\."; then
                READY=1
                break
            fi
        fi
        # Heartbeat the UI every 10s so the console doesn't look frozen
        echo "[..]  still initializing (${ELAPSED}s elapsed)"
        sleep 10
        ELAPSED=$((ELAPSED + 10))
    done

    if [ $READY -eq 1 ]; then
        print_success "Worldserver ready."
    else
        print_warning "Worldserver did not report ready within ${TIMEOUT}s."
        print_info  "Check: docker logs -f $WORLD_CONTAINER"
    fi
}

# ─────────────────────────────────────────
# RECORD INSTALL METADATA
# ─────────────────────────────────────────
write_metadata() {
    print_step "Writing install metadata"
    local meta_dir="$SERVER_DIR/.dads-mmo-lab"
    mkdir -p "$meta_dir"
    cat > "$meta_dir/install.json" << META
{
  "version": "${WIZARD_VERSION}",
  "server_type": "${SERVER_TYPE}",
  "server_name": "${SERVER_NAME}",
  "build_method": "${BUILD_METHOD}",
  "admin_user": "${DML_ADMIN_USER:-admin}",
  "installed_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
META
    print_success "Wrote $meta_dir/install.json"
}

# ─────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────
print_header
print_info "Target:       $SERVER_NAME"
print_info "Install dir:  $SERVER_DIR"
[ -n "$BUILD_METHOD" ] && print_info "Build method: $BUILD_METHOD"
print_info "Admin user:   ${DML_ADMIN_USER:-admin}"

check_system
install_server
wait_for_server
write_metadata

echo ""
echo -e "${GREEN}${BOLD}════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}${BOLD}  Install complete.${NC}"
echo -e "${GREEN}${BOLD}════════════════════════════════════════════════════${NC}"
echo ""
print_info "Next: the UI will pick up the new install and switch to management mode."
print_info "Account creation, modules, and Gaming Mode setup happen from there."
echo ""
exit 0
