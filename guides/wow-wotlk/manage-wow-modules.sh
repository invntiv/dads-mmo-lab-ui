#!/bin/bash
# ============================================================
#  Dad's MMO Lab — WoW Module Manager
#  manage-wow-modules.sh
#
#  Post-install management for AzerothCore WoW servers:
#    - Add/remove modules (AH Bot, Solocraft, Transmog, etc.)
#    - Start / stop / restart / check status of the server
#    - View live logs
#    - Attach to worldserver console (for `account create` etc.)
#    - Configure AH Bot with a bot character
#
#  Works with all three install variants from install-wow.sh:
#    - Base WoW (acore-docker, prebuilt images)
#    - NPCBots (acore-docker with NPCBots SQL)
#    - Playerbots (mod-playerbots fork, already source-built)
#
#  Module operations only work on Playerbots (which is already
#  set up for source build). For Base/NPCBots, the rebuild path
#  is EXPERIMENTAL and clearly marked.
#
#  Usage:
#    chmod +x manage-wow-modules.sh
#    ./manage-wow-modules.sh
#
#  https://github.com/DadsMmoLab/dads-mmo-lab
# ============================================================

MANAGER_VERSION="2.0.0"

set -o pipefail

RST='\033[0m'; BOLD='\033[1m'
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; WHITE='\033[1;37m'; CYAN='\033[0;36m'
GOLD='\033[38;5;220m'; DIM='\033[2m'

# ─────────────────────────────────────────────────────────────
# UI HELPERS
# ─────────────────────────────────────────────────────────────
print_header() {
    clear
    echo ""
    echo -e "${GOLD}╔══════════════════════════════════════════════════╗${RST}"
    echo -e "${GOLD}║${WHITE}${BOLD}    🛠️  DAD'S MMO LAB — WoW Module Manager       ${RST}${GOLD}║${RST}"
    echo -e "${GOLD}║${WHITE}        v${MANAGER_VERSION}                                    ${RST}${GOLD}║${RST}"
    echo -e "${GOLD}╚══════════════════════════════════════════════════╝${RST}"
    echo ""
}

print_step()    { echo ""; echo -e "${GOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RST}"
                   echo -e "${WHITE}${BOLD} $1${RST}"
                   echo -e "${GOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RST}"; }
print_success() { echo -e "${GREEN}✅ $1${RST}"; }
print_warning() { echo -e "${YELLOW}⚠️  $1${RST}"; }
print_error()   { echo -e "${RED}❌ $1${RST}"; }
print_info()    { echo -e "${BLUE}ℹ️  $1${RST}"; }

ask_yes_no() {
    while true; do
        printf "${WHITE}$1 (y/n): ${RST}"
        read -r answer
        case $answer in
            [Yy]*) return 0 ;;
            [Nn]*) return 1 ;;
            *) echo "Please answer y or n." ;;
        esac
    done
}

press_enter() {
    echo ""
    printf "${WHITE}Press ENTER to continue...${RST}"
    read -r
}

# ─────────────────────────────────────────────────────────────
# CONFIG — populated by detect_install
# ─────────────────────────────────────────────────────────────
SERVER_DIR=""
SERVER_TYPE=""    # "base" | "npcbots" | "playerbots"
SERVER_NAME=""    # human-readable e.g. "Playerbots"
WORLD_CONTAINER=""
DB_CONTAINER=""
AUTH_CONTAINER=""
DB_ROOT_PASSWORD="password"   # acore-docker default

# Module registry: key|name|repo url|sql dirs (comma-sep)
declare -a MODULE_REGISTRY=(
    "mod-ah-bot|Auction House Bot|https://github.com/azerothcore/mod-ah-bot.git|world"
    "mod-solocraft|Solocraft (solo dungeon/raid scaling)|https://github.com/azerothcore/mod-solocraft.git|world"
    "mod-aoe-loot|AoE Loot|https://github.com/azerothcore/mod-aoe-loot.git|world"
    "mod-learn-spells|Learn Spells on Levelup|https://github.com/azerothcore/mod-learn-spells.git|world"
    "mod-individual-progression|Individual Progression (Vanilla → TBC → WotLK)|https://github.com/ZhengPeiRu21/mod-individual-progression.git|world,characters"
    "mod-autobalance|Auto Balance (dynamic difficulty)|https://github.com/azerothcore/mod-autobalance.git|world"
    "mod-transmog|Transmogrification|https://github.com/azerothcore/mod-transmog.git|world,characters"
    "mod-1v1-arena|1v1 Arena|https://github.com/azerothcore/mod-1v1-arena.git|characters"
)

# ─────────────────────────────────────────────────────────────
# INSTALL DETECTION
# ─────────────────────────────────────────────────────────────
# Find all WoW installs by looking for any wow-server* directory
# that contains a docker-compose.yml. Don't break on first match —
# enumerate all so the user can pick if there are multiple.
detect_install() {
    print_step "Detecting WoW installations"

    local -a found_dirs=()
    local d
    # Use a glob with nullglob behavior — handle "no matches" gracefully
    shopt -s nullglob
    for d in "$HOME"/wow-server*; do
        if [ -d "$d" ] && [ -f "$d/docker-compose.yml" ]; then
            found_dirs+=("$d")
        fi
    done
    shopt -u nullglob

    if [ "${#found_dirs[@]}" -eq 0 ]; then
        print_error "No WoW installation found!"
        print_info "Looked for any \$HOME/wow-server* directory with docker-compose.yml"
        echo ""
        print_info "Run install-wow.sh first."
        exit 1
    fi

    # ── One install: use it ───────────────────────────────
    if [ "${#found_dirs[@]}" -eq 1 ]; then
        SERVER_DIR="${found_dirs[0]}"
        print_success "Found one install: $SERVER_DIR"
    else
        # ── Multiple installs: let user pick ──────────────
        echo ""
        echo -e "${WHITE}Multiple WoW installs found:${RST}"
        echo ""
        local i=1
        for d in "${found_dirs[@]}"; do
            local typ
            typ=$(detect_type_for "$d")
            printf "  ${WHITE}%d) ${CYAN}%-40s${RST} ${DIM}(%s)${RST}\n" "$i" "$d" "$typ"
            i=$((i + 1))
        done
        echo ""
        while true; do
            printf "${WHITE}Choose [1-%d]: ${RST}" "${#found_dirs[@]}"
            read -r choice
            if [[ "$choice" =~ ^[0-9]+$ ]] && \
               [ "$choice" -ge 1 ] && \
               [ "$choice" -le "${#found_dirs[@]}" ]; then
                SERVER_DIR="${found_dirs[$((choice - 1))]}"
                break
            fi
            echo "  Please enter a number 1 to ${#found_dirs[@]}."
        done
    fi

    # Classify the install we picked
    SERVER_TYPE=$(detect_type_for "$SERVER_DIR")
    case "$SERVER_TYPE" in
        base)       SERVER_NAME="Base AzerothCore (WotLK)" ;;
        npcbots)    SERVER_NAME="NPCBots" ;;
        playerbots) SERVER_NAME="Playerbots" ;;
        *)          SERVER_NAME="Unknown" ;;
    esac

    print_success "Server: $SERVER_DIR"
    print_success "Type:   $SERVER_NAME"

    # Check docker is usable
    if ! docker ps &>/dev/null 2>&1; then
        if sudo docker ps &>/dev/null 2>&1; then
            docker() { sudo /usr/bin/docker "$@"; }
            export -f docker
            print_info "Using sudo for docker (no group membership active in this shell)"
        else
            print_error "Docker is not running."
            print_info "Try: sudo systemctl start docker"
            exit 1
        fi
    fi

    # Find running containers (will be empty if server is stopped — that's OK)
    refresh_container_names
}

# Classify an install by looking at directory name AND, if needed,
# at the compose file contents. The dir name is the cheapest signal.
detect_type_for() {
    local d="$1"
    case "$d" in
        *-playerbots)   echo "playerbots"; return ;;
        *-npcbots)      echo "npcbots"; return ;;
    esac
    # For dirs not named with a suffix, peek at the compose / override
    # for telltale strings.
    if [ -f "$d/docker-compose.override.yml" ] && \
       grep -qi "playerbot\|AC_AI_PLAYERBOT" "$d/docker-compose.override.yml" 2>/dev/null; then
        echo "playerbots"; return
    fi
    if [ -d "$d/modules/mod-playerbots" ]; then
        echo "playerbots"; return
    fi
    if [ -d "$d/data/sql/custom/db_world" ] && \
       ls "$d/data/sql/custom/db_world"/*npcbot* &>/dev/null; then
        echo "npcbots"; return
    fi
    echo "base"
}

# Find the actual running container names by docker label.
# Containers may not exist (server stopped) — that's not an error.
refresh_container_names() {
    WORLD_CONTAINER=$(docker ps -a --format '{{.Names}}' 2>/dev/null | \
        grep -iE "worldserver" | head -1)
    DB_CONTAINER=$(docker ps -a --format '{{.Names}}' 2>/dev/null | \
        grep -iE "ac-database|wow.*database" | head -1)
    AUTH_CONTAINER=$(docker ps -a --format '{{.Names}}' 2>/dev/null | \
        grep -iE "authserver" | head -1)
}

# Is a given container actually running (not just defined)?
container_running() {
    local name="$1"
    [ -z "$name" ] && return 1
    docker ps --format '{{.Names}}' 2>/dev/null | grep -q "^${name}$"
}

# ─────────────────────────────────────────────────────────────
# SERVER LIFECYCLE
# ─────────────────────────────────────────────────────────────
server_status() {
    print_step "Server Status"
    refresh_container_names

    local any_running=false
    local all=$(docker ps -a --format '{{.Names}}\t{{.Status}}' 2>/dev/null)

    # Filter to just THIS install's containers — use the project name (dir name)
    local project
    project=$(basename "$SERVER_DIR" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9-')

    echo ""
    echo -e "${WHITE}Containers for this install:${RST}"
    echo ""
    if [ -z "$all" ]; then
        echo "  (no containers found)"
    else
        # Show all WoW-related containers regardless of project, since users
        # may run multiple installs. Mark each with running/stopped status.
        local saw_one=false
        while IFS=$'\t' read -r name status; do
            [ -z "$name" ] && continue
            if echo "$name" | grep -qiE "worldserver|authserver|ac-database|ac-client|ac-eluna|ac-db-import|ac-tools"; then
                saw_one=true
                if echo "$status" | grep -qi "^up"; then
                    any_running=true
                    printf "  ${GREEN}●${RST} %-35s ${DIM}%s${RST}\n" "$name" "$status"
                else
                    printf "  ${DIM}○${RST} %-35s ${DIM}%s${RST}\n" "$name" "$status"
                fi
            fi
        done <<< "$all"
        [ "$saw_one" = false ] && echo "  (no WoW containers found)"
    fi

    echo ""
    if [ "$any_running" = "true" ]; then
        print_success "Server is RUNNING"
        if [ -n "$WORLD_CONTAINER" ] && container_running "$WORLD_CONTAINER"; then
            print_info "Worldserver: $WORLD_CONTAINER"
            # Show last few lines of worldserver log
            echo ""
            echo -e "${WHITE}Recent worldserver activity:${RST}"
            docker logs --tail 5 "$WORLD_CONTAINER" 2>&1 | sed 's/^/  /'
        fi
    else
        print_warning "Server is STOPPED"
    fi
}

server_start() {
    print_step "Starting Server"
    cd "$SERVER_DIR" || { print_error "Can't cd to $SERVER_DIR"; return 1; }

    # ── Playerbots-specific: fix UID/GID mismatch on env/dist ─────────
    # Per azerothcore/azerothcore-wotlk#17656: AzerothCore containers
    # are hardcoded to run as acore:1000:1000. The volume-mounted
    # paths env/dist/etc and env/dist/logs MUST be owned by 1000:1000
    # or ac-db-import fails with "Permission denied" → exit 1.
    #
    # Important: these directories may not exist before the first
    # build. We create them with correct ownership up-front so the
    # volume mounts pick up the right perms from the very first run.
    if [ "$SERVER_TYPE" = "playerbots" ] || [ "$SERVER_TYPE" = "npcbots" ]; then
        local fix_dirs=("env/dist/etc" "env/dist/logs")
        local need_action=false
        local d
        for d in "${fix_dirs[@]}"; do
            if [ ! -d "$d" ]; then
                need_action=true
                break
            fi
            local owner
            owner=$(stat -c '%u:%g' "$d" 2>/dev/null)
            if [ "$owner" != "1000:1000" ]; then
                need_action=true
                break
            fi
        done

        if [ "$need_action" = "true" ]; then
            print_info "Ensuring env/dist ownership is 1000:1000 (AzerothCore requirement)..."
            # Create dirs first — they may not exist on a brand-new install
            sudo mkdir -p env/dist/etc env/dist/logs
            # chown errors are SHOWN, not silenced, so user knows if sudo failed
            if sudo chown -R 1000:1000 env/dist/etc env/dist/logs; then
                print_success "Ownership fixed (env/dist/etc, env/dist/logs → 1000:1000)"
            else
                print_warning "chown failed — server may fail with ac-db-import error"
                print_info "If prompted for sudo password and you didn't provide it,"
                print_info "run manually: sudo chown -R 1000:1000 env/dist/etc env/dist/logs"
            fi
        fi
    fi

    # ── Detect whether phpmyadmin service exists before scaling ───────
    # Base/NPCBots installs ship docker-compose.override.yml with phpmyadmin.
    # Playerbots does NOT — so --scale phpmyadmin=0 errors out with
    # "no such service: phpmyadmin: not found". Detect first and pick
    # the right command.
    local has_phpmyadmin=false
    if docker compose config --services 2>/dev/null | grep -qx "phpmyadmin"; then
        has_phpmyadmin=true
    fi

    print_info "Bringing up containers..."
    local up_log="/tmp/wow-server-start.log"
    local up_rc
    if [ "$has_phpmyadmin" = "true" ]; then
        docker compose up -d --scale phpmyadmin=0 > "$up_log" 2>&1
        up_rc=$?
    else
        docker compose up -d > "$up_log" 2>&1
        up_rc=$?
    fi

    if [ "$up_rc" -ne 0 ]; then
        print_error "Failed to start server (exit code: $up_rc)"
        echo ""
        print_info "Last 20 lines of /tmp/wow-server-start.log:"
        tail -20 "$up_log" 2>/dev/null | sed 's/^/    /'
        echo ""
        # Diagnose the most common failure modes
        if grep -q "didn't complete successfully" "$up_log" 2>/dev/null && \
           grep -q "ac-db-import" "$up_log" 2>/dev/null; then
            print_warning "DIAGNOSIS: ac-db-import failed."
            print_info "Check the real error with:"
            print_info "  docker compose logs ac-db-import | tail -50"
            print_info ""
            print_info "Most common causes and fixes:"
            print_info ""
            print_info "  • ${CYAN}'Table X already exists' errors${RST}: a previous module install"
            print_info "    corrupted update tracking. Use menu option 12 (Repair install state)."
            print_info ""
            print_info "  • ${CYAN}'Permission denied' errors${RST}: UID/GID mismatch on env/dist."
            print_info "    Run: sudo chown -R 1000:1000 env/dist/etc env/dist/logs"
            print_info ""
            print_info "  • ${CYAN}'No such file or directory' on dbimport binary${RST}: build problem."
            print_info "    Try: docker compose build --no-cache ac-db-import"
        elif grep -qi "address already in use\|port is already allocated" "$up_log" 2>/dev/null; then
            print_warning "DIAGNOSIS: A port is already in use."
            print_info "Check what's using the conflicting port:"
            print_info "  sudo ss -tlnp | grep -E '3306|3724|8085'"
        elif grep -qi "no space left on device" "$up_log" 2>/dev/null; then
            print_warning "DIAGNOSIS: Disk full."
        else
            print_info "Full logs: docker compose logs"
        fi
        return 1
    fi

    print_success "Containers started"

    print_info "Waiting for worldserver to be ready..."
    refresh_container_names
    if [ -z "$WORLD_CONTAINER" ]; then
        print_warning "Couldn't identify worldserver container — server may still be starting"
        return 0
    fi

    # Poll worldserver logs for ready signal (up to 90s)
    local i
    for i in $(seq 1 18); do
        if docker logs "$WORLD_CONTAINER" 2>&1 | \
           grep -qiE "World initialized|Loading World|Loading complete"; then
            print_success "Worldserver is ready! ⚔️"
            return 0
        fi
        sleep 5
    done
    print_warning "Worldserver didn't signal ready within 90s — may still be loading"
    print_info "Use 'View logs' to check progress."
}

server_stop() {
    print_step "Stopping Server"
    cd "$SERVER_DIR" || { print_error "Can't cd to $SERVER_DIR"; return 1; }

    print_info "Stopping containers (graceful shutdown)..."
    if docker compose down; then
        print_success "Server stopped"
    else
        print_warning "docker compose down had non-zero exit — checking state..."
        if ! docker ps --format '{{.Names}}' | grep -qE "worldserver|authserver"; then
            print_success "Containers are gone — stop was effective"
        else
            print_error "Some containers may still be running"
        fi
    fi
}

server_restart() {
    server_stop
    echo ""
    sleep 3
    server_start
}

server_logs() {
    print_step "Server Logs"
    refresh_container_names

    if [ -z "$WORLD_CONTAINER" ]; then
        print_error "Worldserver container not found"
        print_info "Start the server first."
        return 1
    fi
    if ! container_running "$WORLD_CONTAINER"; then
        print_warning "Worldserver isn't running. Showing last lines from when it last ran:"
        echo ""
        docker logs --tail 50 "$WORLD_CONTAINER" 2>&1 | sed 's/^/  /'
        return 0
    fi

    echo ""
    print_info "Following worldserver log (Ctrl+C to exit)..."
    print_info "This won't stop the server — only stops following the log."
    echo ""
    sleep 2
    docker logs -f --tail 30 "$WORLD_CONTAINER"
}

server_attach() {
    print_step "Attach to Worldserver Console"
    refresh_container_names

    if ! container_running "$WORLD_CONTAINER"; then
        print_error "Worldserver isn't running."
        print_info "Start the server first."
        return 1
    fi

    echo ""
    echo -e "${YELLOW}⚠️  You're about to attach to the worldserver console.${RST}"
    echo ""
    echo -e "${WHITE}Use this to run server commands like:${RST}"
    echo -e "  ${CYAN}account create USERNAME PASSWORD${RST}"
    echo -e "  ${CYAN}account set gmlevel USERNAME 3 -1${RST}"
    echo ""
    echo -e "${RED}${BOLD}CRITICAL — How to detach safely:${RST}"
    echo -e "${WHITE}  Press ${BOLD}Ctrl+P then Ctrl+Q${RST}${WHITE} (in sequence)${RST}"
    echo -e "${WHITE}  This detaches without stopping the server.${RST}"
    echo ""
    echo -e "${RED}${BOLD}DO NOT press Ctrl+C — that STOPS the server!${RST}"
    echo ""
    ask_yes_no "Ready to attach?" || return 0

    docker attach "$WORLD_CONTAINER"
    echo ""
    print_info "Detached from worldserver console."
}

# ─────────────────────────────────────────────────────────────
# REPAIR INSTALL STATE
# ─────────────────────────────────────────────────────────────
# AzerothCore's auto-update system tracks applied SQL files in
# an `updates` table per database. When that tracking gets out
# of sync with actual schema state, ac-db-import fails with
# errors like "Table X already exists" — AC sees the SQL needs
# applying (no `updates` row) but the table already exists, so
# the CREATE TABLE blows up.
#
# DESIGN PHILOSOPHY: This function NEVER drops tables. It only
# clears rows from the `updates` tracking table. AzerothCore's
# auto-update on next start will then re-detect the SQL files
# as needing application and run them. Module SQL uses
# CREATE TABLE IF NOT EXISTS / INSERT IGNORE semantics, so
# re-application is safe whether the table exists or not.
#
# Why this matters: an earlier version of this function dropped
# tables based on a hand-coded module-to-table map. That conflated
# "tables a module reads from" with "tables a module owns" — and
# dropped `character_arena_stats` (a base AzerothCore schema table
# that mod-1v1-arena merely READS from). That broke worldserver's
# prepared-statement initialization and required manually restoring
# the table from the base SQL file. This version cannot have that
# class of bug because it doesn't touch tables at all.

# Per-module SQL filename registry. These are the EXACT strings as
# they appear in `updates.name` column. To find these for a new
# module: ls modules/<mod>/data/sql/db-<dbname>/
# Format: "module-key|database|filename1.sql filename2.sql ..."
declare -a MODULE_UPDATE_FILES=(
    "mod-ah-bot|acore_world|auctionhousebot_professionItems.sql mod_auctionhousebot.sql"
    "mod-transmog|acore_characters|trasmorg.sql"
    "mod-1v1-arena|acore_characters|"
    "mod-solocraft|acore_world|"
    "mod-aoe-loot|acore_world|"
    "mod-learn-spells|acore_world|"
    "mod-individual-progression|acore_world|"
    "mod-autobalance|acore_world|"
)

# Discover the actual SQL filenames in a module's sql dir.
# This is what AC's auto-update will use as the `updates.name` value.
# Returns space-separated filenames, or empty if dir doesn't exist.
discover_module_sql_files() {
    local key="$1" db_short="$2"  # db_short is "world", "characters", etc.
    local sql_dir="$SERVER_DIR/modules/$key/data/sql/db-${db_short}"
    [ ! -d "$sql_dir" ] && sql_dir="$SERVER_DIR/modules/$key/sql/${db_short}"
    [ ! -d "$sql_dir" ] && return 0
    # Find .sql files at top level only (subdirs are usually versioned variants)
    (cd "$sql_dir" && ls *.sql 2>/dev/null | tr '\n' ' ')
}

# Run a DELETE on the updates table for a given database and SQL file name.
# Returns the number of rows affected (0 if nothing matched, useful diagnostic).
clear_update_tracking_row() {
    local db_full="$1" sql_filename="$2"
    # Count rows first so we can report success accurately
    local rows
    rows=$(docker exec "$DB_CONTAINER" mysql -uroot -p"$DB_ROOT_PASSWORD" -N \
        "$db_full" \
        -e "SELECT COUNT(*) FROM updates WHERE name = '$sql_filename';" \
        2>/dev/null | tr -d '[:space:]')
    if [ -z "$rows" ] || [ "$rows" = "0" ]; then
        return 1  # Nothing to clear
    fi
    docker exec "$DB_CONTAINER" mysql -uroot -p"$DB_ROOT_PASSWORD" \
        "$db_full" \
        -e "DELETE FROM updates WHERE name = '$sql_filename';" 2>/dev/null
    return 0
}

# Show what's currently tracked in the updates table for a given module.
# Useful for diagnosis — users can SEE what AC thinks has been applied.
show_module_tracking() {
    local key="$1"
    echo ""
    echo -e "${WHITE}Currently tracked updates that mention '${key}' or related terms:${RST}"
    local stripped="${key#mod-}"  # mod-ah-bot → ah-bot
    local term1="${stripped//-/_}"  # ah-bot → ah_bot (covers underscored names)
    local rows_world rows_chars rows_auth
    rows_world=$(docker exec "$DB_CONTAINER" mysql -uroot -p"$DB_ROOT_PASSWORD" -N \
        acore_world \
        -e "SELECT name FROM updates WHERE name LIKE '%${stripped}%' \
            OR name LIKE '%${term1}%';" 2>/dev/null)
    rows_chars=$(docker exec "$DB_CONTAINER" mysql -uroot -p"$DB_ROOT_PASSWORD" -N \
        acore_characters \
        -e "SELECT name FROM updates WHERE name LIKE '%${stripped}%' \
            OR name LIKE '%${term1}%';" 2>/dev/null)
    rows_auth=$(docker exec "$DB_CONTAINER" mysql -uroot -p"$DB_ROOT_PASSWORD" -N \
        acore_auth \
        -e "SELECT name FROM updates WHERE name LIKE '%${stripped}%' \
            OR name LIKE '%${term1}%';" 2>/dev/null)
    if [ -n "$rows_world" ]; then
        echo -e "  ${DIM}acore_world:${RST}"
        echo "$rows_world" | sed 's/^/    /'
    fi
    if [ -n "$rows_chars" ]; then
        echo -e "  ${DIM}acore_characters:${RST}"
        echo "$rows_chars" | sed 's/^/    /'
    fi
    if [ -n "$rows_auth" ]; then
        echo -e "  ${DIM}acore_auth:${RST}"
        echo "$rows_auth" | sed 's/^/    /'
    fi
    if [ -z "$rows_world$rows_chars$rows_auth" ]; then
        echo -e "  ${DIM}(no matching rows in any database)${RST}"
    fi
}

# Repair flow for a single module — clear its tracking rows.
# Tries the known filename list first, then offers auto-discovery from
# the module's SQL directory, then offers manual filename entry.
repair_module() {
    local key="$1" db_full="$2" known_files="$3"

    print_step "Repairing: $key"
    show_module_tracking "$key"
    echo ""

    # Determine which SQL filenames to clear
    local files_to_clear=""

    # 1. Try the known list first
    if [ -n "$known_files" ]; then
        echo -e "${WHITE}Known SQL files to clear from ${db_full}.updates:${RST}"
        local f
        for f in $known_files; do
            echo -e "  ${CYAN}$f${RST}"
        done
        echo ""
        if ask_yes_no "Clear tracking rows for these files?"; then
            files_to_clear="$known_files"
        fi
    fi

    # 2. If no known list or user declined, offer auto-discovery
    if [ -z "$files_to_clear" ]; then
        # Map db_full back to db_short for the sql dir
        local db_short="${db_full#acore_}"
        local discovered
        discovered=$(discover_module_sql_files "$key" "$db_short")
        if [ -n "$discovered" ]; then
            echo -e "${WHITE}Auto-discovered SQL files in module's sql dir:${RST}"
            local f
            for f in $discovered; do
                echo -e "  ${CYAN}$f${RST}"
            done
            echo ""
            if ask_yes_no "Clear tracking rows for these auto-discovered files?"; then
                files_to_clear="$discovered"
            fi
        fi
    fi

    # 3. Final fallback: manual entry
    if [ -z "$files_to_clear" ]; then
        echo ""
        echo -e "${WHITE}Enter SQL filenames manually (space-separated)${RST}"
        echo -e "${DIM}Example: foo.sql bar.sql${RST}"
        echo -e "${DIM}Or just press ENTER to skip this module.${RST}"
        printf "${WHITE}Files: ${RST}"
        read -r files_to_clear
        [ -z "$files_to_clear" ] && { print_info "Skipped."; return 0; }
    fi

    # Apply the clears, report per-file
    echo ""
    local cleared=0 missing=0
    local f
    for f in $files_to_clear; do
        if clear_update_tracking_row "$db_full" "$f"; then
            echo -e "  ${GREEN}✓${RST} Cleared: $f"
            cleared=$((cleared + 1))
        else
            echo -e "  ${DIM}○${RST} Not found in updates: $f"
            missing=$((missing + 1))
        fi
    done
    echo ""
    if [ "$cleared" -gt 0 ]; then
        print_success "Cleared $cleared tracking row(s) for $key"
        print_info "AzerothCore will re-apply this SQL on next server start."
    fi
    if [ "$cleared" -eq 0 ] && [ "$missing" -gt 0 ]; then
        print_info "All filenames searched were already absent from updates table."
        print_info "This could mean:"
        print_info "  • The filenames don't exactly match what AC tracked"
        print_info "  • The module's SQL was never applied (fresh install case)"
        print_info "  • The repair was already run successfully before"
    fi
}

repair_install_state() {
    print_step "Repair Install State"

    echo ""
    echo -e "${WHITE}Use this when ac-db-import fails with errors like:${RST}"
    echo -e "${WHITE}  • ${CYAN}ERROR 1050: Table 'X' already exists${RST}"
    echo -e "${WHITE}  • ${CYAN}ac-db-import: didn't complete successfully: exit 1${RST}"
    echo ""
    echo -e "${WHITE}${BOLD}How this works:${RST}"
    echo -e "${WHITE}  This clears rows from AzerothCore's ${CYAN}updates${WHITE} tracking table${RST}"
    echo -e "${WHITE}  for selected modules. On next server start, AC will detect${RST}"
    echo -e "${WHITE}  the SQL files as needing application and run them. Module SQL${RST}"
    echo -e "${WHITE}  uses IF NOT EXISTS semantics, so re-apply is safe even when${RST}"
    echo -e "${WHITE}  the tables already exist.${RST}"
    echo ""
    echo -e "${GREEN}This function does NOT drop tables — it's safe and non-destructive.${RST}"
    echo ""

    # Need DB running
    refresh_container_names
    if ! container_running "$DB_CONTAINER"; then
        print_info "Starting database container..."
        (cd "$SERVER_DIR" && docker compose up -d ac-database 2>/dev/null) || true
        refresh_container_names
        local i
        for i in $(seq 1 15); do
            if docker exec "$DB_CONTAINER" mysqladmin ping \
                -uroot -p"$DB_ROOT_PASSWORD" &>/dev/null 2>&1; then
                break
            fi
            sleep 2
        done
        if ! container_running "$DB_CONTAINER"; then
            print_error "Couldn't start database — can't repair"
            return 1
        fi
    fi

    # Build menu of installed modules from the registry
    local -a repair_keys=()
    local -a repair_dbs=()
    local -a repair_files=()
    local entry key db files
    for entry in "${MODULE_UPDATE_FILES[@]}"; do
        IFS='|' read -r key db files <<< "$entry"
        if module_is_installed "$key"; then
            repair_keys+=("$key")
            repair_dbs+=("$db")
            repair_files+=("$files")
        fi
    done

    # Also include any modules in the modules dir that we DON'T have
    # in the registry — let user repair them via manual filename entry
    local d dn in_registry
    for d in "$SERVER_DIR/modules"/*/; do
        [ -d "$d" ] || continue
        dn=$(basename "$d")
        # Skip the bundled-with-source mod-playerbots — it's special
        [ "$dn" = "mod-playerbots" ] && continue
        in_registry=false
        for entry in "${MODULE_UPDATE_FILES[@]}"; do
            IFS='|' read -r key _ _ <<< "$entry"
            if [ "$key" = "$dn" ]; then
                in_registry=true
                break
            fi
        done
        if [ "$in_registry" = false ]; then
            repair_keys+=("$dn")
            repair_dbs+=("")  # Unknown DB — manual entry will handle
            repair_files+=("")  # Unknown files — manual or auto-discover
        fi
    done

    if [ "${#repair_keys[@]}" -eq 0 ]; then
        print_info "No modules installed — nothing to repair."
        return 0
    fi

    # Show menu
    echo -e "${WHITE}Installed modules:${RST}"
    echo ""
    local i=1
    for ((i=0; i<${#repair_keys[@]}; i++)); do
        local marker=""
        if [ -z "${repair_files[$i]}" ]; then
            marker=" ${DIM}(manual filename entry needed)${RST}"
        fi
        printf "  %2d) %s%b\n" "$((i + 1))" "${repair_keys[$i]}" "$marker"
    done
    echo ""
    echo -e "${WHITE}  A) Repair ALL listed modules${RST}"
    echo -e "${WHITE}  S) Show update-tracking state for all modules (diagnostic only)${RST}"
    echo -e "${WHITE}  ENTER to cancel${RST}"
    echo ""
    printf "${WHITE}Choice: ${RST}"
    read -r choice

    case "${choice,,}" in
        "")
            return 0
            ;;
        a)
            for ((i=0; i<${#repair_keys[@]}; i++)); do
                local db="${repair_dbs[$i]}"
                # If we don't know the DB for an unregistered module, try
                # acore_world as a default — most module SQL lives there
                [ -z "$db" ] && db="acore_world"
                repair_module "${repair_keys[$i]}" "$db" "${repair_files[$i]}"
            done
            ;;
        s)
            for ((i=0; i<${#repair_keys[@]}; i++)); do
                show_module_tracking "${repair_keys[$i]}"
            done
            ;;
        *)
            if [[ "$choice" =~ ^[0-9]+$ ]] && \
               [ "$choice" -ge 1 ] && \
               [ "$choice" -le "${#repair_keys[@]}" ]; then
                local idx=$((choice - 1))
                local db="${repair_dbs[$idx]}"
                [ -z "$db" ] && db="acore_world"
                repair_module "${repair_keys[$idx]}" "$db" "${repair_files[$idx]}"
            else
                print_warning "Invalid choice."
            fi
            ;;
    esac

    echo ""
    print_info "Done. Start the server (menu option 7) for AC to re-apply cleared SQL."
}

# ─────────────────────────────────────────────────────────────
# MODULE OPERATIONS
# ─────────────────────────────────────────────────────────────
module_is_installed() {
    local key="$1"
    [ -d "$SERVER_DIR/modules/$key" ]
}

# Source-build state — is the worldserver service set up to build from source?
# For Playerbots, this is ALWAYS true (install-wow sets it up that way).
# For Base/NPCBots, this is false by default (uses prebuilt image).
worldserver_is_source_build() {
    if [ "$SERVER_TYPE" = "playerbots" ]; then
        return 0
    fi
    local override="$SERVER_DIR/docker-compose.override.yml"
    [ -f "$override" ] && \
        grep -qE "^\s*build:" "$override" && \
        grep -qE "ac-worldserver:" "$override"
}

# Clone a module into the install's modules/ directory.
# Module SQL is NOT applied manually — AzerothCore's auto-update system
# (via ac-db-import on next server start) handles SQL automatically and
# tracks which files have been applied in the 'updates' table.
#
# Important: manually applying SQL via `docker exec mysql < file.sql` BREAKS
# AzerothCore's update tracking. The table exists but the update isn't
# recorded, so on next start AC tries to apply the SQL again, hits the
# existing table, and aborts the entire db-import step.
# (Confirmed in real-world testing: a previous version of this manager did
# this and caused the "ac-db-import: didn't complete successfully" error
# with "Table 'auctionhousebot_professionItems' already exists".)
module_install() {
    local key="$1" name="$2" url="$3" sql_dirs="$4"

    print_step "Installing: $name"

    if module_is_installed "$key"; then
        print_info "$name is already cloned — pulling latest"
        (cd "$SERVER_DIR/modules/$key" && git pull --depth 1 2>/dev/null) || \
            print_warning "git pull failed — using existing copy"
    else
        mkdir -p "$SERVER_DIR/modules"
        if ! git clone --depth 1 "$url" "$SERVER_DIR/modules/$key"; then
            print_error "Clone failed for $name!"
            return 1
        fi
        print_success "Cloned $name"
    fi

    # SQL is applied automatically on next worldserver start. No manual import.
    if [ -n "$sql_dirs" ]; then
        print_info "Module SQL will be auto-applied on next server start"
        print_info "(AzerothCore's update system handles this — no manual import needed.)"
    fi
    return 0
}

module_remove() {
    local key="$1" name="$2"

    print_step "Removing: $name"

    if ! module_is_installed "$key"; then
        print_info "$name was not installed — nothing to do"
        return 0
    fi

    if ask_yes_no "  Remove module files from $SERVER_DIR/modules/$key?"; then
        rm -rf "$SERVER_DIR/modules/$key"
        print_success "Module files removed"
        print_info "(Database tables/rows from this module are kept — removing"
        print_info " them risks data loss and they're harmless to leave.)"
    fi
}

# ─────────────────────────────────────────────────────────────
# REBUILD
# ─────────────────────────────────────────────────────────────
rebuild_worldserver() {
    print_step "Rebuilding worldserver"
    cd "$SERVER_DIR" || { print_error "Can't cd to $SERVER_DIR"; return 1; }

    case "$SERVER_TYPE" in
        playerbots)
            # Playerbots is ALREADY source-build — install-wow set it up
            # that way with the mod-playerbots fork. Rebuilding just means
            # `docker compose up -d --build` to pick up new modules.
            echo ""
            echo -e "${WHITE}Playerbots is already configured for source build.${RST}"
            echo -e "${WHITE}Rebuilding will recompile worldserver with any new modules.${RST}"
            echo ""
            echo -e "${YELLOW}⚠️  Expected time: 30-90 minutes on a Steam Deck.${RST}"
            echo -e "${YELLOW}   Keep the Deck plugged in and on a flat surface.${RST}"
            echo ""
            if ! ask_yes_no "Start the rebuild now?"; then
                print_info "Skipped."
                return 0
            fi

            print_info "Stopping worldserver before rebuild..."
            docker compose stop ac-worldserver 2>/dev/null || true

            print_info "Building... (output below — full log: /tmp/wow-modules-build.log)"
            echo ""
            if docker compose up -d --build 2>&1 | \
                tee /tmp/wow-modules-build.log | \
                grep -E "Step|Building|Compiling|Linking|Successfully|ERROR|error:|Created"; then
                print_success "Rebuild complete!"
            else
                print_warning "Build had non-zero exit — check /tmp/wow-modules-build.log"
                return 1
            fi
            ;;

        base|npcbots)
            # Base/NPCBots use prebuilt images by default. To add modules
            # we'd need to switch to source-build, which means cloning
            # azerothcore-wotlk (NOT acore-docker, which has no Dockerfile)
            # and reworking the compose. This is genuinely hard to do
            # cleanly without breaking the existing install.
            echo ""
            print_warning "Rebuild is not supported for $SERVER_NAME installs."
            echo ""
            echo -e "${WHITE}Why: $SERVER_NAME uses prebuilt Docker images from azerothcore-docker.${RST}"
            echo -e "${WHITE}To add modules, the worldserver must be compiled from source —${RST}"
            echo -e "${WHITE}but the prebuilt-image setup doesn't include the source or Dockerfile.${RST}"
            echo ""
            echo -e "${WHITE}${BOLD}Recommended path:${RST}"
            echo -e "${WHITE}  1. Install Playerbots variant instead (re-run install-wow.sh,${RST}"
            echo -e "${WHITE}     pick option 3 — Playerbots).${RST}"
            echo -e "${WHITE}  2. Playerbots is already source-build, so modules work immediately.${RST}"
            echo -e "${WHITE}  3. The module manager will fully support it.${RST}"
            echo ""
            echo -e "${DIM}If you really want to attempt rebuild on $SERVER_NAME, it would${RST}"
            echo -e "${DIM}require manually swapping the compose file to use azerothcore-wotlk${RST}"
            echo -e "${DIM}source with target: worldserver-local. Out of scope for this tool.${RST}"
            return 1
            ;;
    esac
}

# ─────────────────────────────────────────────────────────────
# AH BOT CONFIGURATION
# ─────────────────────────────────────────────────────────────
list_characters() {
    refresh_container_names
    if ! container_running "$DB_CONTAINER"; then
        return 1
    fi
    docker exec "$DB_CONTAINER" mysql -uroot -p"$DB_ROOT_PASSWORD" \
        -e "SELECT guid, name, account FROM acore_characters.characters \
            ORDER BY guid;" 2>/dev/null | tail -n +2
}

configure_ahbot() {
    print_step "Configuring Auction House Bot"

    if ! module_is_installed "mod-ah-bot"; then
        print_error "mod-ah-bot is not installed yet!"
        print_info "Add it first via the main menu (Add modules)."
        return 1
    fi

    echo ""
    echo -e "${WHITE}The Auction House Bot needs a player account and character${RST}"
    echo -e "${WHITE}to act as. The bot uses this character to list items.${RST}"
    echo ""
    echo -e "${WHITE}${BOLD}Required steps:${RST}"
    echo -e "${WHITE}  1. From the main menu, attach to worldserver console${RST}"
    echo -e "${WHITE}  2. Run: ${CYAN}account create AHBOT YourPasswordHere${RST}"
    echo -e "${WHITE}  3. Detach: ${BOLD}Ctrl+P Ctrl+Q${RST}"
    echo -e "${WHITE}  4. Log in with WoW client using that account${RST}"
    echo -e "${WHITE}  5. Create ONE character (race/class/faction don't matter)${RST}"
    echo -e "${WHITE}  6. Log out of WoW completely${RST}"
    echo -e "${WHITE}  7. Come back here${RST}"
    echo ""
    echo -e "${YELLOW}⚠️  The bot character should NOT be used for play.${RST}"
    echo -e "${YELLOW}   It will be busy listing items 24/7.${RST}"
    echo ""

    if ! ask_yes_no "Have you completed steps 1-6 above?"; then
        print_info "OK — run me again when ready."
        return 0
    fi

    echo ""
    print_info "Characters found in your database:"
    echo ""
    local chars
    chars=$(list_characters)
    if [ -z "$chars" ]; then
        print_error "No characters found in the database!"
        print_info "Did you log in with the WoW client and create one?"
        print_info "(The database must be running too — check Server Status.)"
        return 1
    fi
    printf "  %-6s | %-20s | %-10s\n" "GUID" "Name" "Account ID"
    echo "  -------|----------------------|----------"
    echo "$chars" | while IFS=$'\t' read -r guid name account; do
        printf "  %-6s | %-20s | %-10s\n" "$guid" "$name" "$account"
    done
    echo ""

    printf "${WHITE}Enter the GUID of the bot character: ${RST}"
    read -r bot_guid
    if ! [[ "$bot_guid" =~ ^[0-9]+$ ]]; then
        print_error "Not a number — aborting."
        return 1
    fi

    local bot_info
    bot_info=$(echo "$chars" | awk -v g="$bot_guid" -F'\t' '$1 == g')
    if [ -z "$bot_info" ]; then
        print_error "GUID $bot_guid not found in the character list."
        return 1
    fi
    local bot_account=$(echo "$bot_info" | cut -f3)
    local bot_name=$(echo "$bot_info" | cut -f2)
    print_success "Selected: $bot_name (GUID $bot_guid, account $bot_account)"

    local conf_dist="$SERVER_DIR/modules/mod-ah-bot/conf/mod_ahbot.conf.dist"
    if [ ! -f "$conf_dist" ]; then
        print_error "Couldn't find $conf_dist"
        return 1
    fi

    mkdir -p "$SERVER_DIR/conf/modules"
    local conf_active="$SERVER_DIR/conf/modules/mod_ahbot.conf"
    cp "$conf_dist" "$conf_active"

    sed -i \
        -e "s|^AuctionHouseBot.Account *=.*|AuctionHouseBot.Account = ${bot_account}|" \
        -e "s|^AuctionHouseBot.GUID *=.*|AuctionHouseBot.GUID = ${bot_guid}|" \
        -e "s|^AuctionHouseBot.GUIDs *=.*|AuctionHouseBot.GUIDs = \"${bot_guid}\"|" \
        -e "s|^AuctionHouseBot.EnableSeller *=.*|AuctionHouseBot.EnableSeller = 1|" \
        -e "s|^AuctionHouseBot.EnableBuyer *=.*|AuctionHouseBot.EnableBuyer = 1|" \
        -e "s|^AHBot.enabled *=.*|AHBot.enabled = 1|" \
        "$conf_active"

    print_success "Wrote $conf_active"

    refresh_container_names
    if container_running "$WORLD_CONTAINER"; then
        docker cp "$conf_active" \
            "${WORLD_CONTAINER}:/azerothcore/env/dist/etc/modules/mod_ahbot.conf" \
            2>/dev/null || true
        print_info "Conf pushed to running worldserver"
        print_info "Restart worldserver from the main menu (Restart Server) to activate."
    fi

    echo ""
    print_info "AH Bot will start populating auctions on next worldserver start."
    print_info "It adds ~75 items per cycle — full population takes hours."
}

# ─────────────────────────────────────────────────────────────
# MAIN MENUS
# ─────────────────────────────────────────────────────────────
menu_add() {
    print_header
    print_step "Add Modules"

    # Show clear warning for non-playerbots installs
    if [ "$SERVER_TYPE" != "playerbots" ]; then
        echo ""
        print_warning "Module installs on $SERVER_NAME are experimental."
        print_info "Modules will be cloned, but rebuilding the worldserver"
        print_info "to actually USE them is not supported on this install type."
        print_info ""
        print_info "Recommended: reinstall as Playerbots variant for full module support."
        echo ""
        if ! ask_yes_no "Continue anyway (modules will be cloned but inactive)?"; then
            return
        fi
    fi

    echo ""
    echo -e "${WHITE}Available modules:${RST}"
    echo ""

    local i=1
    local -a available_keys=()
    local entry key name url sql_dirs marker
    for entry in "${MODULE_REGISTRY[@]}"; do
        IFS='|' read -r key name url sql_dirs <<< "$entry"
        if module_is_installed "$key"; then
            marker="${GREEN}[installed]${RST}"
        else
            marker="${YELLOW}[available]${RST}"
        fi
        printf "  %2d) %-42s %b\n" "$i" "$name" "$marker"
        available_keys+=("$entry")
        i=$((i + 1))
    done
    echo ""
    echo -e "${WHITE}  Enter numbers separated by spaces (e.g. 1 3 5)${RST}"
    echo -e "${WHITE}  Or just ENTER to cancel.${RST}"
    echo ""
    printf "${WHITE}Choose: ${RST}"
    read -r choices

    [ -z "$choices" ] && return

    local selected=()
    local choice
    for choice in $choices; do
        if [[ "$choice" =~ ^[0-9]+$ ]] && \
           [ "$choice" -ge 1 ] && [ "$choice" -le "${#available_keys[@]}" ]; then
            selected+=("${available_keys[$((choice - 1))]}")
        fi
    done

    if [ "${#selected[@]}" -eq 0 ]; then
        print_warning "No valid choices."
        press_enter; return
    fi

    for entry in "${selected[@]}"; do
        IFS='|' read -r key name url sql_dirs <<< "$entry"
        module_install "$key" "$name" "$url" "$sql_dirs" || true
    done

    echo ""
    print_info "Modules cloned and SQL imported."

    if [ "$SERVER_TYPE" = "playerbots" ]; then
        print_info "Rebuild the worldserver to compile the new modules in."
        echo ""
        if ask_yes_no "Rebuild the worldserver now?"; then
            rebuild_worldserver
        else
            print_info "Run me again later and pick Rebuild from the main menu."
        fi
    else
        print_info "(Skipping rebuild prompt — not supported on this install type.)"
    fi

    # Special handling: AH Bot needs character configuration after add
    for entry in "${selected[@]}"; do
        IFS='|' read -r key name url sql_dirs <<< "$entry"
        if [ "$key" = "mod-ah-bot" ]; then
            echo ""
            print_info "AH Bot is installed but not yet configured."
            if ask_yes_no "Configure AH Bot now (assign a bot character)?"; then
                configure_ahbot
            fi
        fi
    done

    press_enter
}

menu_remove() {
    print_header
    print_step "Remove Modules"

    echo ""
    echo -e "${WHITE}Installed modules:${RST}"
    echo ""

    local i=1
    local -a installed_keys=()
    local entry key name
    for entry in "${MODULE_REGISTRY[@]}"; do
        IFS='|' read -r key name _ _ <<< "$entry"
        if module_is_installed "$key"; then
            printf "  %2d) %s\n" "$i" "$name"
            installed_keys+=("$entry")
            i=$((i + 1))
        fi
    done

    if [ "${#installed_keys[@]}" -eq 0 ]; then
        echo "  (none)"
        press_enter; return
    fi

    echo ""
    printf "${WHITE}Number to remove (or ENTER to cancel): ${RST}"
    read -r choice

    [ -z "$choice" ] && return
    if ! [[ "$choice" =~ ^[0-9]+$ ]] || \
       [ "$choice" -lt 1 ] || [ "$choice" -gt "${#installed_keys[@]}" ]; then
        print_warning "Invalid choice."
        press_enter; return
    fi

    IFS='|' read -r key name _ _ <<< "${installed_keys[$((choice - 1))]}"
    module_remove "$key" "$name"

    if [ "$SERVER_TYPE" = "playerbots" ]; then
        echo ""
        print_info "Rebuild needed for module removal to take effect."
        if ask_yes_no "Rebuild the worldserver now?"; then
            rebuild_worldserver
        fi
    fi

    press_enter
}

menu_list() {
    print_header
    print_step "Installed Modules"

    if [ ! -d "$SERVER_DIR/modules" ]; then
        echo "  (no modules directory yet)"
        press_enter; return
    fi

    local count=0
    local entry key name
    for entry in "${MODULE_REGISTRY[@]}"; do
        IFS='|' read -r key name _ _ <<< "$entry"
        if module_is_installed "$key"; then
            printf "  %-30s — %s\n" "$key" "$name"
            count=$((count + 1))
        fi
    done

    # Catch modules NOT in our registry (manually added, or e.g. mod-playerbots)
    local d dn in_registry
    for d in "$SERVER_DIR/modules"/*/; do
        [ -d "$d" ] || continue
        dn=$(basename "$d")
        in_registry=false
        for entry in "${MODULE_REGISTRY[@]}"; do
            IFS='|' read -r key _ _ _ <<< "$entry"
            if [ "$key" = "$dn" ]; then
                in_registry=true
                break
            fi
        done
        if [ "$in_registry" = false ]; then
            local note="(manually added)"
            [ "$dn" = "mod-playerbots" ] && note="(bundled with Playerbots install)"
            printf "  ${DIM}%-30s — %s${RST}\n" "$dn" "$note"
            count=$((count + 1))
        fi
    done

    [ "$count" -eq 0 ] && echo "  (none installed)"
    press_enter
}

# ─────────────────────────────────────────────────────────────
# FIRST-RUN WELCOME
# ─────────────────────────────────────────────────────────────
# Shown on the very first launch of this manager against an install.
# Drops a marker file so it only displays once per install. The goal
# is to ease first-time-user nerves: explain that read-only menu
# options are safe, that nothing changes unless they explicitly act,
# and that the manager doesn't run anything destructive without asking.
show_first_run_welcome() {
    local marker="$SERVER_DIR/.dml-manager-seen"
    # Returning user: just pause briefly so detection feedback is readable
    if [ -f "$marker" ]; then
        press_enter
        return 0
    fi

    # Detect "this looks fresh" — user-installed modules count.
    # mod-playerbots is bundled with the install so doesn't count.
    local user_module_count=0
    if [ -d "$SERVER_DIR/modules" ]; then
        local d dn
        for d in "$SERVER_DIR/modules"/*/; do
            [ -d "$d" ] || continue
            dn=$(basename "$d")
            [ "$dn" = "mod-playerbots" ] && continue
            user_module_count=$((user_module_count + 1))
        done
    fi

    clear
    echo ""
    echo -e "${GOLD}╔══════════════════════════════════════════════════╗${RST}"
    echo -e "${GOLD}║${WHITE}${BOLD}    👋  Welcome to the WoW Module Manager        ${RST}${GOLD}║${RST}"
    echo -e "${GOLD}╚══════════════════════════════════════════════════╝${RST}"
    echo ""
    echo -e "${WHITE}This is your first time running the manager on:${RST}"
    echo -e "  ${CYAN}$SERVER_DIR${RST}"
    echo ""

    if [ "$user_module_count" -eq 0 ]; then
        echo -e "${WHITE}Looks like a ${BOLD}fresh install${RST}${WHITE} — no user-added modules yet.${RST}"
    else
        echo -e "${WHITE}You have ${BOLD}$user_module_count user-added module(s)${RST}${WHITE} already installed.${RST}"
    fi
    echo ""
    echo -e "${WHITE}${BOLD}A few things to know:${RST}"
    echo ""
    echo -e "${GREEN}  ✓${RST} ${WHITE}Nothing changes until you explicitly choose an action.${RST}"
    echo -e "${WHITE}    The menu options 3 (List modules), 6 (Server status),${RST}"
    echo -e "${WHITE}    and 10 (View logs) are completely read-only — safe to${RST}"
    echo -e "${WHITE}    poke around and see what your install looks like.${RST}"
    echo ""
    echo -e "${GREEN}  ✓${RST} ${WHITE}You'll be asked before anything destructive.${RST}"
    echo -e "${WHITE}    Adding/removing modules, rebuilding the worldserver, and${RST}"
    echo -e "${WHITE}    the repair function all ask for confirmation first.${RST}"
    echo ""
    echo -e "${GREEN}  ✓${RST} ${WHITE}Adding any module triggers a worldserver rebuild.${RST}"
    echo -e "${WHITE}    On Steam Deck this takes 30-90 minutes. Plug in and${RST}"
    echo -e "${WHITE}    keep the device on a flat surface for airflow.${RST}"
    echo ""
    echo -e "${GREEN}  ✓${RST} ${WHITE}The repair function (option 12) only clears SQL update${RST}"
    echo -e "${WHITE}    tracking rows. It never drops database tables.${RST}"
    echo ""
    if [ "$user_module_count" -eq 0 ]; then
        echo -e "${WHITE}${BOLD}Suggested first steps for a fresh install:${RST}"
        echo -e "${WHITE}  1. Option ${CYAN}6${WHITE} (Server status) — see what containers are running${RST}"
        echo -e "${WHITE}  2. Option ${CYAN}3${WHITE} (List modules) — see what's installed${RST}"
        echo -e "${WHITE}  3. When ready: option ${CYAN}1${WHITE} (Add modules) — add AH Bot, etc.${RST}"
    else
        echo -e "${WHITE}${BOLD}Useful options for an existing install:${RST}"
        echo -e "${WHITE}  • Option ${CYAN}3${WHITE} (List modules) — see what's already installed${RST}"
        echo -e "${WHITE}  • Option ${CYAN}6${WHITE} (Server status) — check container state${RST}"
        echo -e "${WHITE}  • Option ${CYAN}12${WHITE} (Repair) — if ac-db-import is failing${RST}"
    fi
    echo ""
    echo -e "${DIM}This welcome shows once per install. The marker file at${RST}"
    echo -e "${DIM}$marker tracks this.${RST}"
    echo ""
    press_enter

    # Drop the marker — silent failure is OK, the welcome just shows again next time
    touch "$marker" 2>/dev/null || true
}

main_menu() {
    while true; do
        print_header
        echo -e "${WHITE}Server: ${CYAN}$SERVER_DIR${RST}"
        echo -e "${WHITE}Type:   ${CYAN}$SERVER_NAME${RST}"

        # Quick running indicator
        refresh_container_names
        if container_running "$WORLD_CONTAINER"; then
            echo -e "${WHITE}State:  ${GREEN}● Running${RST}"
        else
            echo -e "${WHITE}State:  ${DIM}○ Stopped${RST}"
        fi

        if [ "$SERVER_TYPE" = "playerbots" ]; then
            echo -e "${WHITE}Build:  ${GREEN}source (modules fully supported)${RST}"
        else
            echo -e "${WHITE}Build:  ${YELLOW}prebuilt (modules experimental)${RST}"
        fi
        echo ""
        echo -e "  ${GOLD}── Modules ──${RST}"
        echo -e "${WHITE}    1) Add modules${RST}"
        echo -e "${WHITE}    2) Remove modules${RST}"
        echo -e "${WHITE}    3) List installed modules${RST}"
        echo -e "${WHITE}    4) Configure / reconfigure AH Bot${RST}"
        echo -e "${WHITE}    5) Rebuild worldserver${RST}"
        echo ""
        echo -e "  ${GOLD}── Server Controls ──${RST}"
        echo -e "${WHITE}    6) Server status${RST}"
        echo -e "${WHITE}    7) Start server${RST}"
        echo -e "${WHITE}    8) Stop server${RST}"
        echo -e "${WHITE}    9) Restart server${RST}"
        echo -e "${WHITE}   10) View worldserver logs${RST}"
        echo -e "${WHITE}   11) Attach to worldserver console${RST}"
        echo ""
        echo -e "  ${GOLD}── Troubleshooting ──${RST}"
        echo -e "${WHITE}   12) Repair install state (clear stuck SQL update tracking)${RST}"
        echo ""
        echo -e "${WHITE}    Q) Quit${RST}"
        echo ""
        printf "${WHITE}Choice: ${RST}"
        read -r choice
        case "${choice,,}" in
            1)  menu_add ;;
            2)  menu_remove ;;
            3)  menu_list ;;
            4)  configure_ahbot; press_enter ;;
            5)  rebuild_worldserver; press_enter ;;
            6)  server_status; press_enter ;;
            7)  server_start; press_enter ;;
            8)  server_stop; press_enter ;;
            9)  server_restart; press_enter ;;
            10) server_logs ;;
            11) server_attach; press_enter ;;
            12) repair_install_state; press_enter ;;
            q)  echo ""; print_info "Goodbye!"; exit 0 ;;
        esac
    done
}

# ─────────────────────────────────────────────────────────────
# ENTRYPOINT
# ─────────────────────────────────────────────────────────────
print_header
detect_install
show_first_run_welcome
main_menu
