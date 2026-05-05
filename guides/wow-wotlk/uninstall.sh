#!/bin/bash
# ============================================================
#  Dad's MMO Lab — WoW Offline Server UNINSTALLER
#  Completely removes the AzerothCore server from your Steam Deck
#
#  https://github.com/DadsMmoLab/dads-mmo-lab
#
#  Usage:
#    chmod +x uninstall.sh
#    ./uninstall.sh
#
#  What this removes:
#    - All running Docker containers (worldserver, authserver, database)
#    - All Docker images downloaded for the server
#    - The Docker volume containing your character data
#    - The ~/wow-server folder and all its contents
#
#  What this does NOT touch:
#    - Your WoW 3.3.5a client files
#    - Docker itself (in case you use it for other things)
#    - Any other games or projects
#
#  ⚠️  THIS WILL DELETE YOUR CHARACTERS AND PROGRESS ⚠️
#  Make a backup first if you want to keep your character data!
# ============================================================

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
    echo -e "${RED}╔══════════════════════════════════════════════════╗${NC}"
    echo -e "${RED}║${WHITE}${BOLD}         ⚙️  DAD'S MMO LAB                        ${NC}${RED}║${NC}"
    echo -e "${RED}║${WHITE}         WoW Server — UNINSTALLER                 ${NC}${RED}║${NC}"
    echo -e "${RED}║${BLUE}         github.com/DadsMmoLab/dads-mmo-lab       ${NC}${RED}║${NC}"
    echo -e "${RED}╚══════════════════════════════════════════════════╝${NC}"
    echo ""
}

print_step() {
    echo ""
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${WHITE}${BOLD} $1${NC}"
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

print_success() { echo -e "${GREEN}✅ $1${NC}"; }
print_warning() { echo -e "${YELLOW}⚠️  $1${NC}"; }
print_error()   { echo -e "${RED}❌ $1${NC}"; }
print_info()    { echo -e "${BLUE}ℹ️  $1${NC}"; }

ask_yes_no() {
    while true; do
        echo -e "${WHITE}$1 (y/n): ${NC}"
        read -r answer
        case $answer in
            [Yy]* ) return 0;;
            [Nn]* ) return 1;;
            * ) echo "Please answer y or n.";;
        esac
    done
}

INSTALL_DIR="$HOME/wow-server"

# ─────────────────────────────────────────
# DOCKER CHECK
# ─────────────────────────────────────────
if ! command -v docker &>/dev/null; then
    echo -e "\033[0;31m❌ Docker is not installed. Nothing to uninstall!\033[0m"
    echo -e "\033[0;34mℹ️  If you installed using install.sh, Docker should be present.\033[0m"
    exit 1
fi

if ! docker ps &>/dev/null 2>&1 && ! sudo docker ps &>/dev/null 2>&1; then
    echo -e "\033[1;33m⚠️  Docker is installed but not running. Starting it now...\033[0m"
    sudo systemctl start docker 2>/dev/null || true
    sleep 3
fi

# ─────────────────────────────────────────
# START
# ─────────────────────────────────────────
clear
print_header

echo -e "${WHITE}This will completely remove your WoW offline server.${NC}"
echo ""
echo -e "${YELLOW}This includes:${NC}"
echo -e "  • All server containers (worldserver, authserver, database)"
echo -e "  • All downloaded Docker images for the server"
echo -e "  • Your server folder: ${CYAN}$INSTALL_DIR${NC}"
echo -e "  • ${RED}All character data and progress${NC}"
echo ""
echo -e "${GREEN}This does NOT touch:${NC}"
echo -e "  • Your WoW 3.3.5a client files"
echo -e "  • Docker itself"
echo -e "  • Any other projects"
echo ""

# ─────────────────────────────────────────
# BACKUP OFFER
# ─────────────────────────────────────────
print_warning "Do you want to back up your character data first?"
echo -e "${BLUE}ℹ️  This saves your characters, items, and progress to a backup file.${NC}"
echo ""

BACKUP_DIR=""

if ask_yes_no "Create a backup before uninstalling?"; then

    BACKUP_DIR="$HOME/wow-server-backup-$(date +%Y%m%d_%H%M%S)"
    mkdir -p "$BACKUP_DIR"

    print_info "Backing up all server databases..."

    if docker ps 2>/dev/null | grep -qiE "ac.database|ac_database" || \
       sudo docker ps 2>/dev/null | grep -qiE "ac.database|ac_database"; then

        # Detect actual container name
        BACKUP_DB=$(docker ps --format '{{.Names}}' 2>/dev/null | grep -iE "ac.database|ac_database" | head -1)
        BACKUP_DB="${BACKUP_DB:-acore-docker-ac-database-1}"

        docker exec "$BACKUP_DB" mysqldump \
            -uroot -ppassword \
            --databases acore_characters acore_auth acore_world \
            > "$BACKUP_DIR/full_server_backup.sql" 2>/dev/null || \
        sudo docker exec "$BACKUP_DB" mysqldump \
            -uroot -ppassword \
            --databases acore_characters acore_auth acore_world \
            > "$BACKUP_DIR/full_server_backup.sql" 2>/dev/null || true

        if [ -f "$BACKUP_DIR/full_server_backup.sql" ] && \
           [ -s "$BACKUP_DIR/full_server_backup.sql" ]; then
            BACKUP_SIZE=$(du -sh "$BACKUP_DIR/full_server_backup.sql" | cut -f1)
            print_success "Backup saved! (${BACKUP_SIZE})"
            print_success "Location: $BACKUP_DIR/full_server_backup.sql"
            print_info "Keep this file — it contains ALL your characters, items and progress!"
        else
            print_warning "Backup file is empty or missing — database may not be running."
            print_info "Start the server first with: cd ~/wow-server && ./start.sh"
            print_info "Then re-run this uninstaller to get a clean backup."
            BACKUP_DIR=""
        fi
    else
        print_warning "Database container not running — cannot create backup."
        print_info "To back up first: start the server with ~/wow-server/start.sh"
        print_info "Then run this uninstaller again."
        BACKUP_DIR=""

        echo ""
        if ! ask_yes_no "Continue uninstalling WITHOUT a backup?"; then
            echo -e "${GREEN}Good call — start the server, back it up, then uninstall.${NC}"
            exit 0
        fi
    fi
fi

echo ""

# ─────────────────────────────────────────
# FINAL CONFIRMATION
# ─────────────────────────────────────────
echo -e "${RED}${BOLD}⚠️  THIS CANNOT BE UNDONE ⚠️${NC}"
echo ""

if ! ask_yes_no "Are you absolutely sure you want to uninstall?"; then
    echo ""
    echo -e "${GREEN}Smart choice! Your server is safe. Run this script again when you're ready.${NC}"
    echo ""
    exit 0
fi

echo ""
echo -e "${RED}Last chance — type DELETE to confirm:${NC} "
read -r confirm
if [ "$confirm" != "DELETE" ]; then
    echo ""
    echo -e "${GREEN}Cancelled — your server is safe!${NC}"
    echo ""
    exit 0
fi

echo ""
print_info "Uninstalling... this will take about 30-60 seconds."

# ─────────────────────────────────────────
# STEP 1 — STOP AND REMOVE CONTAINERS
# ─────────────────────────────────────────
print_step "STEP 1/4 — Stopping Server"

if [ -f "$INSTALL_DIR/docker-compose.yml" ]; then
    cd "$INSTALL_DIR"
    docker compose down --remove-orphans 2>/dev/null || \
    sudo docker compose down --remove-orphans 2>/dev/null || true
    print_success "Server stopped and containers removed"
else
    # Try to stop containers directly if compose file is missing
    for container in acore-docker-ac-worldserver-1 acore-docker-ac-authserver-1 acore-docker-ac-database-1; do
        if docker ps -a 2>/dev/null | grep -q "$container"; then
            docker stop "$container" 2>/dev/null || \
            sudo docker stop "$container" 2>/dev/null || true
            docker rm "$container" 2>/dev/null || \
            sudo docker rm "$container" 2>/dev/null || true
            print_success "Removed container: $container"
        fi
    done
fi

# ─────────────────────────────────────────
# STEP 2 — REMOVE DOCKER IMAGES
# ─────────────────────────────────────────
print_step "STEP 2/4 — Removing Docker Images"

IMAGES=(
    "acore/ac-worldserver"
    "acore/ac-authserver"
    "acore/ac-db-import"
    "mysql:8.0"
)

for image in "${IMAGES[@]}"; do
    if docker images | grep -q "${image%%:*}"; then
        docker rmi "$image" 2>/dev/null || true
        print_success "Removed image: $image"
    fi
done

# Remove any dangling images
docker image prune -f 2>/dev/null || true
print_success "Cleaned up unused images"

# ─────────────────────────────────────────
# STEP 3 — REMOVE DOCKER VOLUME
# ─────────────────────────────────────────
print_step "STEP 3/4 — Removing Database Volume"

if docker volume ls | grep -q "dads_mmo_wow_db"; then
    docker volume rm dads_mmo_wow_db 2>/dev/null || true
    print_success "Removed database volume"
else
    # Try generic volume name as fallback
    docker volume rm wow-server_ac-database 2>/dev/null || true
    print_success "Removed database volume"
fi

# Remove the docker network
docker network rm dads_mmo_network 2>/dev/null || true

# ─────────────────────────────────────────
# STEP 4 — REMOVE SERVER FOLDER
# ─────────────────────────────────────────
print_step "STEP 4/4 — Removing Server Files"

if [ -d "$INSTALL_DIR" ]; then
    sudo rm -rf "$INSTALL_DIR"
    print_success "Removed server folder: $INSTALL_DIR"
else
    print_info "Server folder not found — already removed"
fi

# ─────────────────────────────────────────
# DONE
# ─────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}${BOLD}║   ✅ UNINSTALL COMPLETE                           ║${NC}"
echo -e "${GREEN}${BOLD}╚══════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${WHITE}Your WoW server has been completely removed.${NC}"
echo -e "${WHITE}Your WoW client files are untouched.${NC}"
echo ""

if [ -n "$BACKUP_DIR" ] && [ -d "$BACKUP_DIR" ]; then
    echo -e "${CYAN}Your backup is saved at:${NC}"
    echo -e "  ${CYAN}$BACKUP_DIR/full_server_backup.sql${NC}"
    echo -e "${CYAN}To restore it later, reinstall the server then run:${NC}"
    echo -e "  ${CYAN}docker exec -i acore-docker-ac-database-1 mysql -uroot -ppassword < full_server_backup.sql${NC}"
    echo ""
fi

echo -e "${WHITE}Want to reinstall from scratch? Just run:${NC}"
echo -e "  ${CYAN}chmod +x install.sh && ./install.sh${NC}"
echo ""
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${WHITE}  📺 youtube.com/@DadsMmoLab${NC}"
echo -e "${WHITE}  📦 github.com/DadsMmoLab/dads-mmo-lab${NC}"
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "${GREEN}${BOLD}See you in Azeroth again soon. ⚔️${NC}"
echo ""
